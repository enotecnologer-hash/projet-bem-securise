'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useAuth } from '@/lib/auth'

export function SessionBar() {
  const auth = useAuth()
  const pathname = usePathname()
  if (auth.kind !== 'ready' || pathname === '/login') return null
  const isAdmin = auth.role === 'owner' || auth.role === 'admin'
  const onAdmin = pathname.startsWith('/admin')
  return (
    <div className="fixed bottom-3 right-3 z-50 flex items-center gap-3 rounded-full border border-[#222] bg-[#111]/95 px-3 py-1.5 text-xs text-[#f5f5f5] shadow-lg backdrop-blur">
      <span className="max-w-[140px] truncate text-white/50">{auth.email}</span>
      {isAdmin && (
        <Link href={onAdmin ? '/dashboard' : '/admin'} className="font-semibold text-[#facc15]">
          {onAdmin ? 'Tableau de bord' : 'Administration'}
        </Link>
      )}
      <button type="button" onClick={() => void signOut()} className="text-white/70 hover:text-white">
        Déconnexion
      </button>
    </div>
  )
}
