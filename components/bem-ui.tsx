import type { ReactNode } from 'react'

export const inputCls =
  'w-full rounded-[10px] border border-[#1e1e1e] bg-[#0a0a0a] px-3 py-2.5 text-sm text-[#f5f5f5] outline-none placeholder:text-white/30 focus:border-[#facc15]/60'
export const btnCls =
  'rounded-[10px] bg-[#facc15] px-4 py-2.5 text-sm font-bold text-black transition hover:bg-[#fde047] disabled:cursor-not-allowed disabled:opacity-50'
export const ghostCls =
  'rounded-[10px] border border-[#2a2a2a] bg-transparent px-3 py-2 text-sm text-white/70 transition hover:text-white disabled:opacity-50'
export const dangerCls =
  'rounded-[10px] border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2 text-sm font-semibold text-[#ef4444] transition hover:bg-[#ef4444]/20 disabled:cursor-not-allowed disabled:opacity-40'

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#facc15] text-[13px] font-bold text-black">BEM</span>
      <span className="text-sm font-semibold">Business Error Monitor</span>
    </div>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[#0a0a0a] px-4 pb-24 pt-6 text-[#f5f5f5]">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[14px] border border-[#1e1e1e] bg-[#111] p-4 ${className}`}>{children}</section>
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <Shell>
      <Logo />
      <Card className="mt-6 text-sm text-white/70">{children}</Card>
    </Shell>
  )
}
