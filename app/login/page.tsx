'use client'

import { FormEvent, Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'
import { resolveAuth, signOut } from '@/lib/auth'
import { Card, Logo, Shell, btnCls, ghostCls, inputCls } from '@/components/bem-ui'

type Step = 'checking' | 'setup' | 'email' | 'code' | 'mfa' | 'enroll'

function LoginFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const requested = params.get('next') ?? '/dashboard'
  // Redirection interne uniquement (évite les redirections ouvertes).
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/dashboard'

  const [step, setStep] = useState<Step>('checking')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function prepareEnroll(supabase: SupabaseClient) {
    // Supprime les tentatives d'activation inachevées avant d'en créer une nouvelle.
    const { data: factors } = await supabase.auth.mfa.listFactors()
    for (const factor of factors?.all ?? []) {
      if (factor.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: factor.id })
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `BEM ${Date.now()}` })
    if (error || !data) {
      setInfo("Impossible de préparer l'authentification à deux facteurs.")
      setStep('email')
      return
    }
    setFactorId(data.id)
    setQr(data.totp.qr_code)
    setSecret(data.totp.secret)
    setStep('enroll')
  }

  async function prepareVerify(supabase: SupabaseClient) {
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const factor = factors?.totp?.[0]
    if (!factor) {
      await prepareEnroll(supabase)
      return
    }
    setFactorId(factor.id)
    setStep('mfa')
  }

  async function route() {
    const supabase = getSupabase()
    if (!supabase) {
      setStep('setup')
      return
    }
    const state = await resolveAuth(supabase)
    if (state.kind === 'ready') {
      router.replace(next)
      return
    }
    setCode('')
    if (state.kind === 'mfa') await prepareVerify(supabase)
    else if (state.kind === 'enroll') await prepareEnroll(supabase)
    else setStep('email')
  }

  useEffect(() => {
    void route()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    const supabase = getSupabase()
    if (!supabase) return
    setBusy(true)
    setInfo('')
    // Pas de création de compte ici (shouldCreateUser: false): les comptes sont créés par l'administrateur.
    // Message identique que le compte existe ou non, pour ne pas révéler quels emails sont inscrits.
    await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: false } })
    setBusy(false)
    setInfo('Si ce compte existe, un code à 6 chiffres vient d’être envoyé.')
    setStep('code')
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    const supabase = getSupabase()
    if (!supabase) return
    setBusy(true)
    setInfo('')
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    if (error) {
      setBusy(false)
      setInfo('Code invalide ou expiré.')
      setCode('')
      return
    }
    await route()
    setBusy(false)
  }

  async function submitMfa(event: FormEvent) {
    event.preventDefault()
    const supabase = getSupabase()
    if (!supabase) return
    setBusy(true)
    setInfo('')
    const challenge = await supabase.auth.mfa.challenge({ factorId })
    if (challenge.error || !challenge.data) {
      setBusy(false)
      setInfo('Erreur, réessayez.')
      return
    }
    const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() })
    setBusy(false)
    if (verify.error) {
      setInfo('Code incorrect.')
      setCode('')
      return
    }
    router.replace(next)
  }

  const codeField = (
    <input
      className={`${inputCls} text-center text-lg tracking-[0.4em]`}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      placeholder="000000"
      value={code}
      onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
      aria-label="Code à 6 chiffres"
      required
    />
  )

  return (
    <Shell>
      <Logo />
      <Card className="mx-auto mt-10 max-w-sm">
        {step === 'checking' && <p className="text-sm text-white/60">Chargement…</p>}
        {step === 'setup' && (
          <p className="text-sm text-white/70">
            Supabase n&apos;est pas configuré. Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </p>
        )}
        {step === 'email' && (
          <form onSubmit={submitEmail} className="space-y-3">
            <h1 className="text-lg font-bold">Connexion</h1>
            <p className="text-sm text-white/60">Entrez votre email, nous vous envoyons un code à 6 chiffres.</p>
            <input className={inputCls} type="email" autoComplete="email" placeholder="vous@entreprise.ma" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button className={`${btnCls} w-full`} disabled={busy}>Recevoir le code</button>
          </form>
        )}
        {step === 'code' && (
          <form onSubmit={submitCode} className="space-y-3">
            <h1 className="text-lg font-bold">Code reçu par email</h1>
            <p className="text-sm text-white/60">Saisissez le code envoyé à {email}.</p>
            {codeField}
            <button className={`${btnCls} w-full`} disabled={busy || code.length < 6}>Continuer</button>
            <button type="button" className={`${ghostCls} w-full`} onClick={() => { setCode(''); setInfo(''); setStep('email') }}>Changer d&apos;email</button>
          </form>
        )}
        {step === 'mfa' && (
          <form onSubmit={submitMfa} className="space-y-3">
            <h1 className="text-lg font-bold">Vérification en deux étapes</h1>
            <p className="text-sm text-white/60">Ouvrez votre application d&apos;authentification et saisissez le code à 6 chiffres.</p>
            {codeField}
            <button className={`${btnCls} w-full`} disabled={busy || code.length < 6}>Valider</button>
            <button type="button" className={`${ghostCls} w-full`} onClick={() => void signOut()}>Se déconnecter</button>
          </form>
        )}
        {step === 'enroll' && (
          <form onSubmit={submitMfa} className="space-y-3">
            <h1 className="text-lg font-bold">Activer la double authentification</h1>
            <p className="text-sm text-white/60">
              Obligatoire pour accéder aux données. Scannez ce QR code avec Google Authenticator, Authy ou une application équivalente, puis saisissez le code affiché.
            </p>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code à scanner avec l'application d'authentification" width={176} height={176} className="mx-auto rounded-lg bg-white p-2" />
            )}
            <p className="break-all text-center text-xs text-white/40">Saisie manuelle: <span className="select-all font-mono text-white/70">{secret}</span></p>
            {codeField}
            <button className={`${btnCls} w-full`} disabled={busy || code.length < 6}>Activer et continuer</button>
            <button type="button" className={`${ghostCls} w-full`} onClick={() => void signOut()}>Se déconnecter</button>
          </form>
        )}
        {info && <p role="status" className="mt-3 text-sm text-[#facc15]">{info}</p>}
      </Card>
    </Shell>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginFlow />
    </Suspense>
  )
}
