'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'

type Domain = { id: string; domain_name: string; is_verified: boolean }
type EventRow = { id: string; domain_id: string; type: string; url: string; perte_dh: number; created_at: string }
type DailyLoss = { domain_id: string; loss_date: string; problem_count: number; total_loss_dh: number }

const TYPE_LABELS: Record<string, string> = {
  erreur_js: 'Erreur JavaScript',
  erreur_api: 'Erreur API',
  page_lente: 'Page lente',
  fichier_casse: 'Fichier cassé',
  formulaire_abandonne: 'Formulaire abandonné',
}

const TYPE_COLORS: Record<string, string> = {
  erreur_js: '#ef4444', erreur_api: '#ef4444', formulaire_abandonne: '#facc15',
  page_lente: '#facc15', fichier_casse: '#facc15',
}

function formatDh(value: number) {
  return new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(value) + ' DH'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default function DashboardPage() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [domains, setDomains] = useState<Domain[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [daily, setDaily] = useState<DailyLoss[]>([])
  const [selectedDomain, setSelectedDomain] = useState('tous')
  const [demo, setDemo] = useState(false)
  const [status, setStatus] = useState<'chargement' | 'ok' | 'empty' | 'error' | 'setup'>('chargement')

  useEffect(() => {
    const client = getSupabase()
    if (!client) { setStatus('setup'); return }
    setSupabase(client)
    void loadData(client)
  }, [])

  async function loadData(client: SupabaseClient) {
    setStatus('chargement')
    const { data: sessionData } = await client.auth.getSession()
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel()
    if (!sessionData.session || aal?.currentLevel !== 'aal2') { window.location.replace('/login?next=/dashboard'); return }
    const profile = await client.from('profiles').select('organization_id').eq('id', sessionData.session.user.id).maybeSingle()
    if (profile.error || !profile.data?.organization_id) { setStatus('error'); return }
    const organizationId = profile.data.organization_id
    const organization = await client.from('organizations').select('is_demo').eq('id', organizationId).single()
    if (organization.data?.is_demo === true) setDemo(true)
    const [domainResult, eventResult, dailyResult] = await Promise.all([
      client.from('domains').select('id, domain_name, is_verified').eq('organization_id', organizationId).eq('is_verified', true).order('domain_name'),
      client.from('error_events').select('id, domain_id, type, url, perte_dh, created_at').eq('organization_id', organizationId).gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString()).order('created_at', { ascending: false }).limit(500),
      client.from('daily_losses').select('domain_id, loss_date, problem_count, total_loss_dh').eq('organization_id', organizationId).gte('loss_date', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).order('loss_date'),
    ])
    if (domainResult.error || eventResult.error || dailyResult.error) { setStatus('error'); return }
    setDomains(domainResult.data ?? [])
    setEvents(eventResult.data ?? [])
    setDaily(dailyResult.data ?? [])
    setStatus((eventResult.data?.length || dailyResult.data?.length) ? 'ok' : 'empty')
  }

  const visibleEvents = useMemo(() => selectedDomain === 'tous' ? events : events.filter((event) => event.domain_id === selectedDomain), [events, selectedDomain])
  const visibleDaily = useMemo(() => selectedDomain === 'tous' ? daily : daily.filter((item) => item.domain_id === selectedDomain), [daily, selectedDomain])
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const totalLoss = visibleDaily.filter((item) => item.loss_date >= sevenDaysAgo).reduce((sum, item) => sum + Number(item.total_loss_dh || 0), 0)
  const maxDaily = Math.max(1, ...visibleDaily.map((item) => Number(item.total_loss_dh || 0)))
  const topErrors = useMemo(() => {
    const grouped = new Map<string, { type: string; count: number; loss: number }>()
    visibleEvents.forEach((event) => {
      const current = grouped.get(event.type) ?? { type: event.type, count: 0, loss: 0 }
      current.count += 1
      current.loss += Number(event.perte_dh || 0)
      grouped.set(event.type, current)
    })
    return [...grouped.values()].sort((a, b) => b.loss - a.loss || b.count - a.count).slice(0, 5)
  }, [visibleEvents])
  const domainName = (id: string) => domains.find((domain) => domain.id === id)?.domain_name ?? 'Domaine inconnu'

  return <main className="shell">
    <header className="header"><div className="brand"><span className="mark">BEM</span><div><strong>Business Error Monitor</strong><small>Tableau de bord</small></div></div><span className="live"><i /> Live</span></header>
    {demo && <div className="demo" role="status"><strong>Données de démonstration</strong><span>Ces données sont fictives et servent uniquement à présenter l&apos;interface.</span></div>}
    <section className="heading"><p className="eyebrow">Vue d&apos;ensemble</p><h1>Les problèmes qui coûtent.</h1><p>Une estimation calculée côté serveur à partir des règles configurées.</p></section>
    {status === 'setup' && <div className="notice"><strong>Connexion Supabase non configurée</strong><span>Ajoutez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY pour charger les données réelles. Aucune donnée fictive n&apos;est affichée.</span></div>}
    {status === 'empty' && <div className="notice"><strong>Aucune donnée disponible</strong><span>Connectez-vous avec un compte rattaché à une organisation et vérifiez au moins un domaine.</span></div>}
    {status === 'error' && <div className="notice error"><strong>Impossible de charger les données</strong><span>Vérifiez votre connexion et les politiques RLS Supabase.</span></div>}
    <div className="toolbar"><label htmlFor="domain">Domaine</label><select id="domain" value={selectedDomain} onChange={(event) => setSelectedDomain(event.target.value)}><option value="tous">Tous les domaines</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.domain_name}</option>)}</select><button type="button" onClick={() => supabase && void loadData(supabase)}>Actualiser</button></div>
    <section className="hero-card"><span className="label">Perte estimée · 7 derniers jours</span><strong>{status === 'setup' ? '—' : formatDh(totalLoss)}</strong><p>Cette valeur est une estimation, calculée avec les règles de perte définies par votre organisation.</p></section>
    <section className="grid"><article className="card"><div className="card-title"><h2>Top 5 des erreurs coûteuses</h2><span>{visibleEvents.length} problèmes</span></div>{topErrors.length === 0 ? <Empty text="Aucune erreur enregistrée sur cette période." /> : <div className="rows">{topErrors.map((item) => <div className="row" key={item.type}><span className="dot" style={{ background: TYPE_COLORS[item.type] ?? '#737373' }} /><div><strong>{TYPE_LABELS[item.type] ?? item.type}</strong><small>{item.count} événement{item.count > 1 ? 's' : ''}</small></div><b>{formatDh(item.loss)}</b></div>)}</div>}</article><article className="card"><div className="card-title"><h2>Activité récente</h2><span>7 jours</span></div>{visibleEvents.length === 0 ? <Empty text="Aucun problème détecté." /> : <div className="rows">{visibleEvents.slice(0, 5).map((event) => <div className="row" key={event.id}><span className="dot" style={{ background: TYPE_COLORS[event.type] ?? '#737373' }} /><div><strong>{TYPE_LABELS[event.type] ?? event.type}</strong><small>{domainName(event.domain_id)} · {formatDate(event.created_at)}</small></div><b>{formatDh(Number(event.perte_dh))}</b></div>)}</div>}</article></section>
    <section className="card daily"><div className="card-title"><h2>Pertes par jour</h2><span>30 jours</span></div>{visibleDaily.length === 0 ? <Empty text="Aucune agrégation disponible." /> : <div className="bars">{visibleDaily.slice(-14).map((item) => <div className="bar-item" key={`${item.domain_id}-${item.loss_date}`}><div className="bar" style={{ height: `${Math.max(8, Math.min(100, Number(item.total_loss_dh) / maxDaily * 100))}%` }} title={formatDh(Number(item.total_loss_dh))} /><small>{new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(new Date(item.loss_date))}</small></div>)}</div>}</section>
    <footer>Les données affichées sont soumises aux règles d&apos;accès de votre organisation.</footer>
    <style jsx>{`*{box-sizing:border-box}.shell{min-height:100vh;max-width:1100px;margin:auto;padding:24px clamp(18px,4vw,52px) 56px;background:#0a0a0a;color:#f5f5f5;font-family:Inter,ui-sans-serif,system-ui,sans-serif}.header{display:flex;align-items:center;justify-content:space-between}.brand{display:flex;align-items:center;gap:12px}.brand>div{display:flex;flex-direction:column;gap:3px}.brand strong{font-size:14px}.brand small{color:#737373;font-size:11px}.mark{display:grid;place-items:center;width:42px;height:42px;border-radius:12px;background:#facc15;color:#0a0a0a;font-weight:900;font-size:13px}.live{color:#22c55e;font-size:12px;font-weight:800}.live i{display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;background:#22c55e}.heading{padding:70px 0 28px}.eyebrow{margin:0 0 10px;color:#facc15;font-size:11px;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.heading h1{margin:0 0 12px;font-size:clamp(32px,6vw,54px);letter-spacing:-.05em;line-height:1}.heading p:last-child{margin:0;color:#a3a3a3}.demo,.notice{display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px;margin-bottom:18px;border:1px solid #66520a;border-radius:14px;background:#211b06;color:#facc15;font-size:13px;line-height:1.5}.demo span,.notice span{color:#d4b84c}.notice{border-color:#1e1e1e;background:#111;color:#f5f5f5}.notice span{color:#a3a3a3}.notice.error{border-color:#5c2020;background:#1f0d0d}.notice.error span{color:#fca5a5}.toolbar{display:flex;align-items:center;gap:10px;margin-bottom:18px}.toolbar label{color:#a3a3a3;font-size:12px}.toolbar select,.toolbar button{border:1px solid #2b2b2b;border-radius:9px;background:#111;color:#f5f5f5;padding:10px 12px;font:inherit;font-size:13px}.toolbar select{min-width:210px}.toolbar button{margin-left:auto;cursor:pointer}.toolbar button:hover,.toolbar button:focus-visible{border-color:#facc15}.hero-card,.card{border:1px solid #1e1e1e;border-radius:14px;background:#111}.hero-card{padding:24px;margin-bottom:18px}.label{display:block;color:#a3a3a3;font-size:12px}.hero-card strong{display:block;margin:10px 0;font-size:clamp(32px,6vw,52px);letter-spacing:-.05em}.hero-card p{margin:0;color:#737373;font-size:12px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{padding:20px}.card-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.card-title h2{margin:0;font-size:16px}.card-title span{color:#737373;font-size:11px}.rows{display:flex;flex-direction:column}.row{display:flex;align-items:center;gap:10px;padding:14px 0;border-top:1px solid #1e1e1e}.row>div{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}.row strong{font-size:13px}.row small{overflow:hidden;color:#737373;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.row b{font-size:12px;color:#facc15;white-space:nowrap}.dot{width:8px;height:8px;flex:none;border-radius:50%}.daily{margin-top:18px}.bars{display:flex;align-items:end;gap:9px;height:170px;padding-top:20px}.bar-item{display:flex;flex:1;min-width:12px;height:100%;flex-direction:column;align-items:center;justify-content:end;gap:8px}.bar{width:100%;min-height:8px;border-radius:5px 5px 2px 2px;background:#facc15}.bar-item small{color:#737373;font-size:9px}.empty{padding:25px 0;color:#737373;font-size:13px}footer{padding-top:24px;color:#525252;font-size:11px}@media(max-width:680px){.grid{grid-template-columns:1fr}.heading{padding-top:54px}.toolbar{align-items:flex-start;flex-wrap:wrap}.toolbar select{flex:1;min-width:0}.toolbar button{margin-left:0}.bars{gap:4px}}`}</style>
  </main>
}

function Empty({ text }: { text: string }) { return <p className="empty">{text}</p> }
