'use client'

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase'

export type Role = 'owner' | 'admin' | 'viewer'

export type ReadyAuth = {
  kind: 'ready'
  supabase: SupabaseClient
  userId: string
  email: string
  role: Role | null
  organizationId: string | null
}

export type AuthState =
  | { kind: 'loading' | 'setup' | 'anon' | 'mfa' | 'enroll' }
  | ReadyAuth

// Un utilisateur n'est "ready" qu'avec une session ET un second facteur validé (AAL2).
// La base applique la même règle (policies restrictives), ce contrôle ne sert qu'à l'interface.
export async function resolveAuth(supabase: SupabaseClient): Promise<AuthState> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) return { kind: 'anon' }

  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !aal) return { kind: 'anon' }
  if (aal.currentLevel !== 'aal2') return { kind: aal.nextLevel === 'aal2' ? 'mfa' : 'enroll' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', session.user.id)
    .maybeSingle()

  return {
    kind: 'ready',
    supabase,
    userId: session.user.id,
    email: session.user.email ?? '',
    role: (profile?.role as Role | undefined) ?? null,
    organizationId: profile?.organization_id ?? null,
  }
}

export function useAuth(): AuthState {
  const [state, setState] = useState<AuthState>({ kind: 'loading' })

  useEffect(() => {
    const supabase = getSupabase()
    if (!supabase) {
      setState({ kind: 'setup' })
      return
    }
    let active = true
    const refresh = () => {
      void resolveAuth(supabase).then((next) => {
        if (active) setState(next)
      })
    }
    refresh()
    // Pas d'appel Supabase directement dans ce callback (risque de blocage): on le reporte.
    const { data } = supabase.auth.onAuthStateChange(() => {
      setTimeout(refresh, 0)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  return state
}

export async function signOut() {
  const supabase = getSupabase()
  if (supabase) await supabase.auth.signOut()
  window.location.assign('/login')
}
