'use client'

import { useState, useTransition } from 'react'
import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { setOfferClientOutcome } from '@/app/offers/actions'
import { ModalHeading } from '@/components/ui/modal-heading'

type RejectOfferWithReasonButtonProps = {
  offerId: string
  className?: string
}

export function RejectOfferWithReasonButton({
  offerId,
  className,
}: RejectOfferWithReasonButtonProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    if (!isOpen) {
      document.body.style.overflow = ''
      return
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  function closeModal() {
    if (isPending) return
    setIsOpen(false)
    setReason('')
    setError(null)
  }

  function submitRejected() {
    const text = reason.trim()
    if (!text) {
      setError('Důvod zamítnutí je povinný.')
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        await setOfferClientOutcome(offerId, 'rejected', text)
        setIsOpen(false)
        setReason('')
        setError(null)
        router.refresh()
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'Stav nabídky se nepodařilo změnit.'
        )
      } finally {
        document.body.style.overflow = ''
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          className ??
          'offers-detail-page__approval-button offers-detail-page__approval-button--reject inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(220,38,38,0.24)] transition duration-200 hover:-translate-y-[1px]'
        }
      >
        ZAMÍTNUTO
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[110] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  closeModal()
                }
              }}
            >
              <div className="flex h-full items-center justify-center">
                <div className="relative w-full max-w-lg overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_45%,rgba(236,243,249,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
                  <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
                  <div aria-hidden className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
                  <div aria-hidden className="pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />

                  <div className="relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
                    <ModalHeading section="NABÍDKY" title="Proč to nevyšlo?" />
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isPending}
                      className="offers-detail-page__reject-modal-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Zavřít"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="relative">
                    <textarea
                      rows={4}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Doplň důvod zamítnutí..."
                      className="w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 py-2 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
                    />
                    {error ? (
                      <div className="mt-2 text-sm font-medium text-red-700">{error}</div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={isPending}
                      className="offers-detail-page__reject-modal-cancel inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      ZRUŠIT
                    </button>
                    <button
                      type="button"
                      onClick={submitRejected}
                      disabled={isPending}
                      className="offers-detail-page__reject-modal-confirm inline-flex h-10 items-center justify-center rounded-xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(220,38,38,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isPending ? 'Ukládám…' : 'ZAMÍTNUTO'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}
