'use client'

import { createPortal } from 'react-dom'

type SuccessConfirmationModalProps = {
  isOpen: boolean
  title?: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
}

export function SuccessConfirmationModal({
  isOpen,
  title = 'Hotovo',
  message,
  confirmLabel = 'OK',
  onConfirm,
}: SuccessConfirmationModalProps) {
  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="fixed inset-0 z-[130] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]">
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center">
        <div
          className="relative w-full max-w-md overflow-hidden rounded-[28px] border p-5"
          style={{
            background:
              'linear-gradient(168deg, var(--surface-strong) 0%, var(--surface) 45%, var(--surface-muted) 100%)',
            color: 'var(--text-primary)',
            borderColor: 'var(--surface-border)',
            boxShadow: 'inset 0 1px 0 var(--surface-border), 0 30px 72px rgba(24,24,27,0.28)',
          }}
        >
          <div className="relative flex flex-col items-center text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/25 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.22)]">
              <svg
                viewBox="0 0 24 24"
                className="h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>

            <h3 className="mt-4 text-lg font-semibold tracking-tight">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
              {message}
            </p>

            <button
              type="button"
              onClick={onConfirm}
              className="mt-5 inline-flex h-10 min-w-[116px] items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
