'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthGate } from '@/components/auth-gate'
import type { ReadyAuth } from '@/lib/auth'
import { Card, Logo, Shell, btnCls, dangerCls, ghostCls, inputCls } from '@/components/bem-ui'

const EVENT_TYPES = [
  ['formulaire_abandonne', 'Formulaire abandonné'],
  ['erreur_api', 'Erreur API ou réseau'],
  ['page_lente', 'Page lente'],
  ['fichier_casse', 'Fichier non chargé'],
  ['erreur_js', 'Erreur JavaScript'],
] as const

type Org = { id: string; name: string; ice: string | null; is_demo: boolean; created_at: string }
type Dom = { id: string; domain_name: string; is_verified: boolean; verification_token: string }
type Member = { user_id: string; email: string; role: string }
type AuditRow = {
  id: number
  occurred_at: string
  actor_id: string | null
  action: string
  table_name: string
  organization_id: string | null
  changes: unknown
}

const normDomain = (value: string) =>
  value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')

const fmtDate = (value: string) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })

export default function AdminPage() {
  return <AuthGate roles={['owner', 'admin']}>{(auth) => <Admin auth={auth} />}</AuthGate>
}

function Admin({ auth }: { auth: ReadyAuth }) {
  const { supabase, role } = auth
  const isOwner = role === 'owner'
  const [tab, setTab] = useState<'orgs' | 'audit'>('orgs')
  const [orgs, setOrgs] = useState<Org[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [ice, setIce] = useState('')
  const [busy, setBusy] = useState(false)

  const notify = useCallback((text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 5000)
  }, [])

  const loadOrgs = useCallback(async () => {
    const { data, error } = await supabase.from('organizations').select('id, name, ice, is_demo, created_at').order('name')
    if (error) {
      notify('Chargement impossible.')
      return
    }
    const rows = (data ?? []) as Org[]
    setOrgs(rows)
    setSelected((current) => (current && rows.some((org) => org.id === current) ? current : rows.length === 1 ? rows[0].id : null))
  }, [supabase, notify])

  useEffect(() => {
    void loadOrgs()
  }, [loadOrgs])

  async function createOrg(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: name.trim(), ice: ice.trim() || null })
      .select('id')
      .single()
    setBusy(false)
    if (error || !data) {
      notify(error?.message ?? 'Création impossible.')
      return
    }
    setName('')
    setIce('')
    notify('Organisation créée.')
    await loadOrgs()
    setSelected(data.id)
  }

  const current = orgs.find((org) => org.id === selected) ?? null

  return (
    <Shell>
      <header className="flex items-center justify-between gap-3">
        <Logo />
        <span className="rounded-full border border-[#1e1e1e] bg-[#111] px-3 py-1 text-xs text-white/60">
          {isOwner ? 'Propriétaire' : 'Administrateur'}
        </span>
      </header>

      <nav className="mt-6 flex gap-2" aria-label="Sections">
        <button type="button" onClick={() => setTab('orgs')} className={tab === 'orgs' ? btnCls : ghostCls}>Organisations</button>
        {isOwner && (
          <button type="button" onClick={() => setTab('audit')} className={tab === 'audit' ? btnCls : ghostCls}>Journal d&apos;audit</button>
        )}
      </nav>

      {message && (
        <p role="status" className="mt-4 rounded-[10px] border border-[#facc15]/30 bg-[#facc15]/10 px-3 py-2 text-sm text-[#facc15]">
          {message}
        </p>
      )}

      {tab === 'audit' && isOwner && <AuditLog supabase={supabase} />}

      {tab === 'orgs' && (
        <div className="mt-4 space-y-4">
          {isOwner && (
            <Card>
              <h2 className="text-sm font-bold">Nouvelle organisation</h2>
              <form onSubmit={createOrg} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input className={inputCls} placeholder="Nom de l'entreprise" value={name} onChange={(event) => setName(event.target.value)} required />
                <input className={inputCls} placeholder="ICE (facultatif)" value={ice} onChange={(event) => setIce(event.target.value)} />
                <button className={btnCls} disabled={busy}>Créer</button>
              </form>
            </Card>
          )}

          <Card>
            <h2 className="text-sm font-bold">Organisations</h2>
            {orgs.length === 0 && <p className="mt-2 text-sm text-white/50">Aucune organisation.</p>}
            <ul className="mt-2 divide-y divide-[#1a1a1a]">
              {orgs.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(org.id === selected ? null : org.id)}
                    aria-pressed={org.id === selected}
                    className={`flex w-full items-center justify-between gap-3 py-3 text-left text-sm ${org.id === selected ? 'text-[#facc15]' : ''}`}
                  >
                    <span>
                      {org.name}
                      {org.is_demo && <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/60">démo</span>}
                    </span>
                    <span className="text-xs text-white/40">{fmtDate(org.created_at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {current && (
            <OrgDetail
              key={current.id}
              supabase={supabase}
              org={current}
              isOwner={isOwner}
              notify={notify}
              onErased={async () => {
                setSelected(null)
                await loadOrgs()
              }}
            />
          )}
        </div>
      )}
    </Shell>
  )
}

function OrgDetail({
  supabase,
  org,
  isOwner,
  notify,
  onErased,
}: {
  supabase: SupabaseClient
  org: Org
  isOwner: boolean
  notify: (text: string) => void
  onErased: () => Promise<void>
}) {
  const [domains, setDomains] = useState<Dom[]>([])
  const [rules, setRules] = useState<Record<string, string>>({})
  const [members, setMembers] = useState<Member[]>([])
  const [domainInput, setDomainInput] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<'viewer' | 'admin'>('viewer')
  const [confirmName, setConfirmName] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const [d, r, m] = await Promise.all([
      supabase.from('domains').select('id, domain_name, is_verified, verification_token').eq('organization_id', org.id).order('domain_name'),
      supabase.from('loss_rules').select('event_type, amount_dh').eq('organization_id', org.id),
      supabase.rpc('list_org_members', { target_organization_id: org.id }),
    ])
    if (d.error || r.error || m.error) {
      notify('Chargement impossible.')
      return
    }
    setDomains((d.data ?? []) as Dom[])
    setRules(Object.fromEntries((r.data ?? []).map((row: { event_type: string; amount_dh: number }) => [row.event_type, String(row.amount_dh)])))
    setMembers((m.data ?? []) as Member[])
  }, [supabase, org.id, notify])

  useEffect(() => {
    void reload()
  }, [reload])

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, success: string) {
    setBusy(true)
    const { error } = await action()
    setBusy(false)
    if (error) {
      notify(error.message)
      return false
    }
    notify(success)
    await reload()
    return true
  }

  async function addDomain(event: FormEvent) {
    event.preventDefault()
    const domain = normDomain(domainInput)
    if (!domain) return
    const ok = await run(() => supabase.from('domains').insert({ organization_id: org.id, domain_name: domain }), 'Domaine ajouté (non vérifié).')
    if (ok) setDomainInput('')
  }

  async function removeDomain(domain: Dom) {
    if (!window.confirm(`Supprimer ${domain.domain_name} et tous ses événements ?`)) return
    await run(() => supabase.from('domains').delete().eq('id', domain.id), 'Domaine supprimé.')
  }

  async function saveRules(event: FormEvent) {
    event.preventDefault()
    const rows: Array<{ organization_id: string; event_type: string; amount_dh: number; updated_at: string }> = []
    const empty: string[] = []
    for (const [type] of EVENT_TYPES) {
      const raw = (rules[type] ?? '').trim()
      if (raw === '') {
        empty.push(type)
        continue
      }
      const amount = Number(raw)
      if (!Number.isFinite(amount) || amount < 0) {
        notify('Entrez un montant positif.')
        return
      }
      rows.push({ organization_id: org.id, event_type: type, amount_dh: amount, updated_at: new Date().toISOString() })
    }
    setBusy(true)
    let failure: { message: string } | null = null
    if (rows.length) {
      const result = await supabase.from('loss_rules').upsert(rows, { onConflict: 'organization_id,event_type' })
      failure = result.error
    }
    if (!failure && empty.length) {
      const result = await supabase.from('loss_rules').delete().eq('organization_id', org.id).in('event_type', empty)
      failure = result.error
    }
    setBusy(false)
    if (failure) notify(failure.message)
    else {
      notify('Valeurs enregistrées.')
      await reload()
    }
  }

  async function attach(event: FormEvent) {
    event.preventDefault()
    const email = memberEmail.trim()
    if (!email) return
    const ok = await run(
      () => supabase.rpc('attach_user_to_org', { user_email: email, target_organization_id: org.id, target_role: memberRole }),
      'Utilisateur rattaché.',
    )
    if (ok) setMemberEmail('')
  }

  async function detach(member: Member) {
    if (!window.confirm(`Retirer ${member.email} de cette organisation ?`)) return
    await run(() => supabase.rpc('detach_user_from_org', { target_user_id: member.user_id }), 'Utilisateur retiré.')
  }

  async function exportData() {
    setBusy(true)
    const { data, error } = await supabase.rpc('export_organization_data', { target_organization_id: org.id })
    setBusy(false)
    if (error) {
      notify(error.message)
      return
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bem-export-${org.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    notify('Export téléchargé.')
  }

  async function erase() {
    setBusy(true)
    const { error } = await supabase.rpc('erase_organization', { target_organization_id: org.id })
    setBusy(false)
    if (error) {
      notify(error.message)
      return
    }
    notify('Organisation supprimée.')
    await onErased()
  }

  const api = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ingest`
  const snippet = (token: string) =>
    `<script src="${window.location.origin}/audit.js" defer data-token="${token}" data-api="${api}"></script>`

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      notify('Copié.')
    } catch {
      notify('Copie impossible, sélectionnez le texte manuellement.')
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-bold">Domaines de {org.name}</h2>
        <p className="mt-1 text-xs text-white/50">
          Un domaine n&apos;accepte des événements qu&apos;une fois vérifié. {isOwner ? 'Validez-le seulement quand le client a bien installé le script sur ce domaine.' : 'La validation est faite par le propriétaire de la plateforme.'}
        </p>
        <ul className="mt-3 space-y-3">
          {domains.map((domain) => (
            <li key={domain.id} className="rounded-[10px] border border-[#1e1e1e] bg-[#0a0a0a] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">{domain.domain_name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${domain.is_verified ? 'bg-[#22c55e]/15 text-[#22c55e]' : 'bg-[#facc15]/15 text-[#facc15]'}`}>
                  {domain.is_verified ? 'Vérifié' : 'Non vérifié'}
                </span>
              </div>
              <textarea readOnly rows={3} aria-label={`Script pour ${domain.domain_name}`} value={snippet(domain.verification_token)} className={`${inputCls} mt-2 resize-none font-mono text-[11px]`} />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={ghostCls} onClick={() => void copy(snippet(domain.verification_token))}>Copier le script</button>
                {isOwner && (
                  <button
                    type="button"
                    className={ghostCls}
                    disabled={busy}
                    onClick={() => void run(() => supabase.from('domains').update({ is_verified: !domain.is_verified }).eq('id', domain.id), domain.is_verified ? 'Domaine désactivé.' : 'Domaine vérifié.')}
                  >
                    {domain.is_verified ? 'Retirer la vérification' : 'Marquer comme vérifié'}
                  </button>
                )}
                <button type="button" className={dangerCls} disabled={busy} onClick={() => void removeDomain(domain)}>Supprimer</button>
              </div>
            </li>
          ))}
          {domains.length === 0 && <li className="text-sm text-white/50">Aucun domaine.</li>}
        </ul>
        <form onSubmit={addDomain} className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="atlas-construction.ma" value={domainInput} onChange={(event) => setDomainInput(event.target.value)} aria-label="Nouveau domaine" />
          <button className={btnCls} disabled={busy}>Ajouter</button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Valeur d&apos;un événement (DH)</h2>
        <p className="mt-1 text-xs text-white/50">Laissez vide si le type ne doit pas compter dans la perte estimée. La perte est toujours calculée côté serveur.</p>
        <form onSubmit={saveRules} className="mt-3 space-y-2">
          {EVENT_TYPES.map(([type, label]) => (
            <label key={type} className="flex items-center justify-between gap-3 text-sm">
              <span>{label}</span>
              <input
                className={`${inputCls} w-28 text-right`}
                type="number"
                min={0}
                step="1"
                inputMode="numeric"
                placeholder="0"
                value={rules[type] ?? ''}
                onChange={(event) => setRules((previous) => ({ ...previous, [type]: event.target.value }))}
              />
            </label>
          ))}
          <button className={`${btnCls} w-full`} disabled={busy}>Enregistrer les valeurs</button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Accès au tableau de bord</h2>
        <p className="mt-1 text-xs text-white/50">
          Créez d&apos;abord le compte dans Supabase (Authentication, Users, Add user), puis rattachez son email ici.
        </p>
        <ul className="mt-3 divide-y divide-[#1a1a1a]">
          {members.map((member) => (
            <li key={member.user_id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 truncate">
                {member.email} <span className="text-xs text-white/40">({member.role})</span>
              </span>
              <button type="button" className={ghostCls} disabled={busy} onClick={() => void detach(member)}>Retirer</button>
            </li>
          ))}
          {members.length === 0 && <li className="py-2 text-sm text-white/50">Aucun utilisateur.</li>}
        </ul>
        <form onSubmit={attach} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
          <input className={inputCls} type="email" placeholder="contact@client.ma" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} aria-label="Email de l'utilisateur" />
          <select className={inputCls} value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'viewer' | 'admin')} aria-label="Rôle">
            <option value="viewer">Lecture</option>
            <option value="admin">Administrateur</option>
          </select>
          <button className={btnCls} disabled={busy}>Rattacher</button>
        </form>
      </Card>

      <Card>
        <h2 className="text-sm font-bold">Données de l&apos;organisation</h2>
        <p className="mt-1 text-xs text-white/50">Export complet (portabilité) et suppression définitive en fin de contrat.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={ghostCls} disabled={busy} onClick={() => void exportData()}>Exporter en JSON</button>
        </div>
        {isOwner && (
          <div className="mt-4 rounded-[10px] border border-[#ef4444]/30 p-3">
            <p className="text-xs text-white/60">
              Supprime l&apos;organisation, ses domaines, événements, règles et agrégats. Action irréversible. Tapez <strong className="text-white">{org.name}</strong> pour confirmer.
            </p>
            <div className="mt-2 flex gap-2">
              <input className={inputCls} value={confirmName} onChange={(event) => setConfirmName(event.target.value)} aria-label="Nom à retaper pour confirmer" />
              <button type="button" className={dangerCls} disabled={busy || confirmName !== org.name} onClick={() => void erase()}>Supprimer</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function AuditLog({ supabase }: { supabase: SupabaseClient }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void supabase
      .from('audit_log')
      .select('id, occurred_at, actor_id, action, table_name, organization_id, changes')
      .order('id', { ascending: false })
      .limit(100)
      .then(({ data, error }) => {
        if (error) setFailed(true)
        else setRows((data ?? []) as AuditRow[])
      })
  }, [supabase])

  return (
    <Card className="mt-4">
      <h2 className="text-sm font-bold">Journal d&apos;audit (100 derniers)</h2>
      <p className="mt-1 text-xs text-white/50">En ajout seul. Les tokens n&apos;y figurent jamais.</p>
      {failed && <p className="mt-3 text-sm text-[#ef4444]">Lecture impossible (security.sql exécuté ?).</p>}
      {rows === null && !failed && <p className="mt-3 text-sm text-white/50">Chargement…</p>}
      <ul className="mt-3 divide-y divide-[#1a1a1a]">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-[#facc15]">{row.action} {row.table_name}</span>
              <span className="text-white/40">{fmtDate(row.occurred_at)}</span>
            </div>
            <p className="mt-0.5 text-white/50">Acteur: {row.actor_id ? row.actor_id.slice(0, 8) : 'système'}</p>
            <p className="mt-0.5 break-all font-mono text-white/40">{JSON.stringify(row.changes).slice(0, 180)}</p>
          </li>
        ))}
        {rows?.length === 0 && <li className="py-2 text-sm text-white/50">Aucune entrée.</li>}
      </ul>
    </Card>
  )
}
