'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth, type ReadyAuth, type Role } from '@/lib/auth'
import { Notice } from '@/components/bem-ui'

// Protège une page: session + MFA obligatoires, rôle vérifié. Le vrai contrôle reste la RLS en base.
export function AuthGate({ roles, children }: { roles?: Role[]; children: (auth: ReadyAuth) => ReactNode }) {
  const auth = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (auth.kind === 'anon' || auth.kind === 'mfa' || auth.kind === 'enroll') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`)
    }
  }, [auth.kind, pathname, router])

  if (auth.kind === 'setup') {
    return <Notice>Supabase n&apos;est pas configuré. Renseignez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY.</Notice>
  }
  if (auth.kind !== 'ready') return <Notice>Chargement…</Notice>
  if (roles && (!auth.role || !roles.includes(auth.role))) {
    return <Notice>Accès refusé. Ce compte n&apos;a pas les droits nécessaires pour cette page.</Notice>
  }
  return <>{children(auth)}</>
}
