'use client'

export function PrintJobsButton({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title="Tisk / Uložit do PDF"
      aria-label="Tisk / Uložit do PDF"
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 9V4h12v5M6 18h12v2H6v-2zm-2-3h16a2 2 0 002-2v-3a2 2 0 00-2-2H4a2 2 0 00-2 2v3a2 2 0 002 2z"
        />
      </svg>
    </button>
  )
}
