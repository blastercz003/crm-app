'use client'

import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { OfferStatusButton } from '@/app/offers/offer-status-button'
import { getOfferCommentsForDashboard, type OfferCommentDetail } from '@/components/dashboard/dashboard-my-offers-actions'
import type { OfferStatus } from '@/lib/offers/types'

const HOVER_OPEN_DELAY_MS = 2000

function formatDateTime(value: string | null) {
  if (!value) return 'Bez aktivity'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

export function OfferStatusCommentsHover({
  offerId,
  offerNumber,
  currentStatus,
  isAdmin,
  isOwner,
}: {
  offerId: string
  offerNumber: string
  currentStatus: OfferStatus
  isAdmin: boolean
  isOwner: boolean
}) {
  const [isDesktop, setIsDesktop] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState<OfferCommentDetail[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadingRef = useRef(false)
  const suppressHoverUntilLeaveRef = useRef(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)')
    const sync = () => setIsDesktop(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    function releaseSuppressOnPointerUp() {
      suppressHoverUntilLeaveRef.current = false
    }

    window.addEventListener('mouseup', releaseSuppressOnPointerUp)
    window.addEventListener('pointerup', releaseSuppressOnPointerUp)

    return () => {
      window.removeEventListener('mouseup', releaseSuppressOnPointerUp)
      window.removeEventListener('pointerup', releaseSuppressOnPointerUp)
    }
  }, [])

  async function openCommentsModal() {
    if (loadingRef.current) return
    loadingRef.current = true
    setIsLoading(true)
    setError(null)
    setComments([])
    setIsModalOpen(true)

    const result = await getOfferCommentsForDashboard(offerId)
    if (!result.success) {
      setError(result.error)
      setComments([])
      setIsLoading(false)
      loadingRef.current = false
      return
    }

    setComments(result.comments)
    setIsLoading(false)
    loadingRef.current = false
  }

  function scheduleHoverOpen() {
    if (
      !isDesktop ||
      currentStatus !== 'in_progress' ||
      isModalOpen ||
      suppressHoverUntilLeaveRef.current
    ) {
      return
    }
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void openCommentsModal()
    }, HOVER_OPEN_DELAY_MS)
  }

  function cancelHoverOpen() {
    suppressHoverUntilLeaveRef.current = false
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  return (
    <>
      <div
        onMouseEnter={scheduleHoverOpen}
        onMouseLeave={cancelHoverOpen}
        onMouseUpCapture={() => {
          suppressHoverUntilLeaveRef.current = false
        }}
        onMouseDownCapture={() => {
          suppressHoverUntilLeaveRef.current = true
          if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
          }
        }}
      >
        <OfferStatusButton
          offerId={offerId}
          offerNumber={offerNumber}
          currentStatus={currentStatus}
          isAdmin={isAdmin}
          isOwner={isOwner}
        />
      </div>

      {isModalOpen && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                className="dashboard-offers-module__modal-overlay fixed inset-0 z-[90] bg-zinc-900/10 backdrop-blur-[2px]"
                onClick={() => setIsModalOpen(false)}
              />

              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="dashboard-offers-module__modal w-full max-w-[680px] rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.94)_0%,rgba(249,250,251,0.88)_42%,rgba(244,244,245,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.30)]">
                  <CommentsDetailModalContent
                    offerNumber={offerNumber}
                    comments={comments}
                    isLoading={isLoading}
                    error={error}
                    onClose={() => setIsModalOpen(false)}
                  />
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </>
  )
}

function CommentsDetailModalContent({
  offerNumber,
  comments,
  isLoading,
  error,
  onClose,
}: {
  offerNumber: string
  comments: OfferCommentDetail[]
  isLoading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="dashboard-offers-module__modal-eyebrow text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            KOMENTÁŘE NABÍDKY
          </div>
          <div className="dashboard-offers-module__offer-pill mt-1 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.24)]">
            {offerNumber}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="dashboard-offers-module__modal-close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
          aria-label="Zavřít detail komentářů"
        >
          X
        </button>
      </div>

      {isLoading ? (
        <div className="dashboard-offers-module__modal-empty rounded-2xl border border-dashed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          Nacitam komentare...
        </div>
      ) : error ? (
        <div className="dashboard-offers-module__modal-error rounded-2xl border border-red-200/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(254,242,242,0.84)_100%)] px-4 py-8 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_30px_rgba(185,28,28,0.14)]">
          {error}
        </div>
      ) : comments.length === 0 ? (
        <div className="dashboard-offers-module__modal-empty rounded-2xl border border-dashed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          Tato nabidka zatim nema zadne komentare.
        </div>
      ) : (
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="dashboard-offers-module__comment-item rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="dashboard-offers-module__comment-author text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  {comment.authorName ?? 'Neznamy uzivatel'}
                </div>
                <div className="dashboard-offers-module__comment-meta shrink-0 text-[11px] text-zinc-500">
                  {formatDateTime(comment.createdAt)}
                </div>
              </div>
              <div className="dashboard-offers-module__comment-body mt-1 whitespace-pre-wrap text-sm text-zinc-800">
                {comment.note}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="dashboard-offers-module__modal-button dashboard-offers-module__modal-button--close inline-flex h-10 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
        >
          ZAVŘÍT
        </button>
      </div>
    </div>
  )
}
