'use client'

import { FormEvent, useState } from 'react'

const EVENT_TYPES = [
  ['erreur_js', 'Erreur JavaScript'],
  ['erreur_api', 'Erreur API'],
  ['page_lente', 'Page lente'],
  ['fichier_casse', 'Fichier cassé'],
  ['formulaire_abandonne', 'Formulaire abandonné'],
] as const

export default function Page() {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaved(true)
  }

  return (
    <main className="bem-shell">
      <header className="bem-header">
        <div className="brand">
          <span className="brand-mark">BEM</span>
          <span className="brand-name">Business Error Monitor</span>
        </div>
        <span className="status"><i /> Démo locale</span>
      </header>

      <section className="page-heading">
        <p className="eyebrow">Configuration</p>
        <h1>Règles de perte</h1>
        <p className="lede">
          Définissez la valeur estimée de chaque problème. Ces montants seront
          recalculés côté serveur, jamais acceptés depuis le navigateur.
        </p>
      </section>

      <div className="demo-banner" role="status">
        <strong>Données de démonstration</strong>
        <span>Supabase n&apos;est pas connecté dans cet environnement. Aucune écriture ne sera effectuée.</span>
      </div>

      <form className="rules-card" onSubmit={handleSubmit}>
        <div className="card-heading">
          <div>
            <h2>Valeur par événement</h2>
            <p>Montant indicatif en dirhams marocains (DH).</p>
          </div>
          <span className="read-only">Lecture seule</span>
        </div>

        <div className="rules-list">
          {EVENT_TYPES.map(([type, label]) => (
            <label className="rule-row" key={type}>
              <span>
                <strong>{label}</strong>
                <small>{type}</small>
              </span>
              <span className="amount-field">
                <input
                  inputMode="decimal"
                  min="0"
                  placeholder="Non configurée"
                  type="number"
                  value={values[type] ?? ''}
                  onChange={(event) => {
                    setSaved(false)
                    setValues((current) => ({ ...current, [type]: event.target.value }))
                  }}
                  aria-label={`Valeur en DH pour ${label}`}
                />
                <span>DH</span>
              </span>
            </label>
          ))}
        </div>

        <div className="card-footer">
          <p>Un champ vide signifie que l&apos;événement ne compte pas dans la perte estimée.</p>
          <button type="submit" disabled>{saved ? 'Enregistré' : 'Enregistrer les règles'}</button>
        </div>
      </form>

      <section className="security-note">
        <span className="lock" aria-hidden="true">✓</span>
        <div>
          <h2>Calcul sécurisé</h2>
          <p>
            L&apos;Edge Function vérifie le domaine, le consentement CNDP et récupère
            la règle depuis <code>loss_rules</code>. Le champ <code>perte_dh</code> envoyé
            par le navigateur est ignoré.
          </p>
        </div>
      </section>

      <style jsx>{`
        :global(*) { box-sizing: border-box; }
        :global(body) { margin: 0; background: #0a0a0a; color: #f5f5f5; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        :global(button), :global(input) { font: inherit; }
        .bem-shell { min-height: 100vh; max-width: 920px; margin: 0 auto; padding: 24px clamp(18px, 4vw, 48px) 64px; }
        .bem-header, .brand, .status, .card-heading, .rule-row, .amount-field, .card-footer, .security-note { display: flex; align-items: center; }
        .bem-header { justify-content: space-between; gap: 16px; }
        .brand { gap: 12px; }
        .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: #facc15; color: #0a0a0a; font-size: 13px; font-weight: 900; }
        .brand-name { color: #a3a3a3; font-size: 14px; }
        .status { gap: 7px; color: #22c55e; font-size: 12px; font-weight: 700; }
        .status i { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 4px #22c55e1a; }
        .page-heading { max-width: 680px; padding: 82px 0 32px; }
        .eyebrow { margin: 0 0 12px; color: #facc15; font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
        h1, h2, p { margin-top: 0; }
        h1 { margin-bottom: 14px; font-size: clamp(32px, 6vw, 52px); letter-spacing: -.045em; line-height: 1; }
        .lede { margin-bottom: 0; color: #a3a3a3; font-size: 16px; line-height: 1.65; }
        .demo-banner { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; padding: 14px 16px; border: 1px solid #66520a; border-radius: 14px; background: #211b06; color: #facc15; font-size: 13px; line-height: 1.5; }
        .demo-banner span { color: #d4b84c; }
        .rules-card, .security-note { border: 1px solid #1e1e1e; border-radius: 14px; background: #111; }
        .rules-card { overflow: hidden; }
        .card-heading { justify-content: space-between; gap: 20px; padding: 24px; border-bottom: 1px solid #1e1e1e; }
        .card-heading h2, .security-note h2 { margin-bottom: 5px; font-size: 17px; }
        .card-heading p, .security-note p { margin-bottom: 0; color: #737373; font-size: 13px; line-height: 1.5; }
        .read-only { padding: 6px 9px; border-radius: 7px; background: #1e1e1e; color: #a3a3a3; font-size: 11px; white-space: nowrap; }
        .rules-list { padding: 4px 24px; }
        .rule-row { justify-content: space-between; gap: 20px; padding: 18px 0; border-bottom: 1px solid #1e1e1e; }
        .rule-row:last-child { border-bottom: 0; }
        .rule-row strong { display: block; margin-bottom: 5px; font-size: 14px; }
        .rule-row small { color: #737373; font-family: ui-monospace, monospace; font-size: 11px; }
        .amount-field { width: 150px; border: 1px solid #2b2b2b; border-radius: 9px; background: #0a0a0a; }
        .amount-field:focus-within { border-color: #facc15; box-shadow: 0 0 0 3px #facc1522; }
        .amount-field input { width: 100%; min-width: 0; padding: 10px 8px 10px 12px; border: 0; outline: 0; background: transparent; color: #f5f5f5; }
        .amount-field input::placeholder { color: #525252; font-size: 12px; }
        .amount-field span { padding-right: 11px; color: #737373; font-size: 12px; }
        .card-footer { justify-content: space-between; gap: 20px; padding: 18px 24px; background: #0d0d0d; }
        .card-footer p { max-width: 430px; margin: 0; color: #737373; font-size: 12px; line-height: 1.5; }
        button { padding: 11px 15px; border: 0; border-radius: 9px; background: #facc15; color: #0a0a0a; font-size: 13px; font-weight: 800; cursor: not-allowed; opacity: .5; white-space: nowrap; }
        .security-note { gap: 14px; margin-top: 18px; padding: 18px; }
        .lock { display: grid; flex: 0 0 30px; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #22c55e1a; color: #22c55e; font-weight: 800; }
        code { color: #d4d4d4; font-size: 11px; }
        @media (max-width: 560px) { .brand-name { display: none; } .page-heading { padding-top: 64px; } .card-heading, .card-footer { align-items: flex-start; flex-direction: column; } .card-footer { gap: 14px; } button { width: 100%; } .rule-row { align-items: flex-start; flex-direction: column; gap: 12px; } .amount-field { width: 100%; } }
      `}</style>
    </main>
  )
}
