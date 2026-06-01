'use client'

import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { addOfferProgressNote } from '@/app/offers/actions'
import { OfferStatusButton } from '@/app/offers/offer-status-button'
import type { OfferStatus } from '@/lib/offers/types'
import {
  getOfferCommentsForDashboard,
  type OfferCommentDetail,
} from './dashboard-my-offers-actions'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'

type DashboardOfferPreview = {
  id: string
  offerNumber: string
  title: string
  clientName: string
  status: OfferStatus
  createdByUserId: string
  createdByName: string | null
  updatedAt: string
  lastCommentAt: string | null
  lastCommentAuthorId: string | null
  lastCommentAuthorName: string | null
  lastCommentText: string | null
}

type FilterKey =
  | 'in_progress'
  | 'draft'
  | 'submitted'
  | 'approved'
  | 'sent_to_client'
  | 'all'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'in_progress', label: 'V ŘEŠENÍ' },
  { key: 'draft', label: 'ROZPRACOVANÉ' },
  { key: 'submitted', label: 'KE SCHVÁLENÍ' },
  { key: 'approved', label: 'SCHVÁLENÉ' },
  { key: 'sent_to_client', label: 'ODESLANÉ' },
  { key: 'all', label: 'VŠE' },
]

function formatDateTime(value: string | null) {
  if (!value) return 'Bez aktivity'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function getFilteredOffers(
  offers: DashboardOfferPreview[],
  filter: FilterKey,
  options?: { isAdmin: boolean; currentUserId: string }
) {
  const isAdmin = options?.isAdmin ?? false
  const currentUserId = options?.currentUserId ?? ''

  switch (filter) {
    case 'in_progress':
      if (!isAdmin) {
        return offers.filter((offer) => offer.status === 'in_progress')
      }

      return offers.filter((offer) => {
        if (offer.status !== 'in_progress') return false

        const isOwnOffer = offer.createdByUserId === currentUserId
        if (isOwnOffer) return true

        const hasForeignComment =
          Boolean(offer.lastCommentText) &&
          Boolean(offer.lastCommentAuthorId) &&
          offer.lastCommentAuthorId !== currentUserId

        return hasForeignComment
      })
    case 'draft':
      return offers.filter((offer) => offer.status === 'draft')
    case 'submitted':
      return offers.filter((offer) => offer.status === 'submitted')
    case 'approved':
      return offers.filter((offer) => offer.status === 'approved')
    case 'sent_to_client':
      return offers.filter((offer) => offer.status === 'sent_to_client')
    case 'all':
      return offers
  }
}

function byLatestActivityDesc(a: DashboardOfferPreview, b: DashboardOfferPreview) {
  const aTime = new Date(a.lastCommentAt ?? a.updatedAt).getTime()
  const bTime = new Date(b.lastCommentAt ?? b.updatedAt).getTime()
  return bTime - aTime
}

export function DashboardMyOffersModule({
  offers,
  currentUserId,
  isAdmin,
}: {
  offers: DashboardOfferPreview[]
  currentUserId: string
  isAdmin: boolean
}) {
  const [filter, setFilter] = useState<FilterKey>(() =>
    isAdmin ? 'submitted' : 'in_progress'
  )
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [commentOffer, setCommentOffer] = useState<DashboardOfferPreview | null>(null)
  const [detailOffer, setDetailOffer] = useState<DashboardOfferPreview | null>(null)
  const [detailComments, setDetailComments] = useState<OfferCommentDetail[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const [dismissedNewByOfferId, setDismissedNewByOfferId] = useState<Set<string>>(
    () => new Set()
  )
  const [isPending, startTransition] = useTransition()
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const filterDropdownRef = useRef<HTMLDivElement | null>(null)
  const availableFilters = useMemo(
    () => (isAdmin ? FILTERS : FILTERS.filter((item) => item.key !== 'submitted')),
    [isAdmin]
  )

  const sorted = useMemo(() => [...offers].sort(byLatestActivityDesc), [offers])
  const filtered = useMemo(
    () =>
      getFilteredOffers(
        sorted,
        availableFilters.some((item) => item.key === filter) ? filter : 'in_progress',
        { isAdmin, currentUserId }
      ).slice(0, 10),
    [sorted, filter, availableFilters, isAdmin, currentUserId]
  )
  const activeFilterLabel =
    availableFilters.find((item) => item.key === filter)?.label ?? 'V ŘEŠENÍ'

  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (!filterDropdownRef.current) return
      if (!filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false)
      }
    }

    if (isFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isFilterOpen])

  function hasForeignNewComment(offer: DashboardOfferPreview) {
    if (!offer.lastCommentAuthorId) return false
    if (offer.lastCommentAuthorId === currentUserId) return false
    if (dismissedNewByOfferId.has(offer.id)) return false
    return true
  }

  function openCommentModal(offer: DashboardOfferPreview) {
    setCommentOffer(offer)
    setCommentText('')
    setDismissedNewByOfferId((prev) => new Set(prev).add(offer.id))
  }

  function openDetailModal(offer: DashboardOfferPreview) {
    setDetailOffer(offer)
    void loadDetailComments(offer.id)
  }

  async function loadDetailComments(offerId: string) {
    setDetailComments([])
    setDetailError(null)
    setDetailLoading(true)

    const result = await getOfferCommentsForDashboard(offerId)
    if (!result.success) {
      setDetailError(result.error)
      setDetailComments([])
      setDetailLoading(false)
      return
    }

    setDetailComments(result.comments)
    setDetailLoading(false)
  }

  function submitComment() {
    if (!commentOffer) return
    const text = commentText.trim()
    if (!text) {
      showToast({
        title: 'CHYBA',
        message: 'Komentář je povinný.',
        tone: 'error',
      })
      return
    }

    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.set('progress_note', text)
        await addOfferProgressNote(commentOffer.id, formData)
        showToast({
          title: 'KOMENTÁŘ ULOŽEN',
          message: `Komentář k nabídce ${commentOffer.offerNumber} byl přidán.`,
          tone: 'success',
        })
        if (detailOffer?.id === commentOffer.id) {
          void loadDetailComments(commentOffer.id)
        }
        setCommentOffer(null)
        setCommentText('')
      } catch (error) {
        showToast({
          title: 'CHYBA',
          message:
            error instanceof Error
              ? error.message
              : 'Komentář se nepodařilo uložit.',
          tone: 'error',
        })
      }
    })
  }

  return (
    <section
      className={`relative rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6 ${
        isFilterOpen ? 'z-40 overflow-visible' : 'z-0'
      }`}
    >
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}

      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Nabídky
          </div>
          <Link
            href="/offers"
            className="group mt-2 inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 transition duration-200 ease-out hover:-translate-y-[1px] hover:text-[#2f6f9f]"
          >
            <span>Moje nabídky</span>
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_12px_rgba(0,0,0,0.26)] transition duration-200 ease-out group-hover:-translate-y-[1px] group-hover:border-[#1f5f8e] group-hover:bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] group-hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.36),0_9px_16px_rgba(9,48,82,0.30)]"
            >
              <span className="-translate-y-[1px] text-[18px] leading-none">›</span>
            </span>
          </Link>
        </div>
      </div>

      <div className="mb-4">
        <div className="relative" ref={filterDropdownRef}>
          <button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="flex h-11 w-full items-center justify-between rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-left text-base text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:h-9 sm:text-sm"
            aria-haspopup="listbox"
            aria-expanded={isFilterOpen}
          >
            <span className="font-medium">{activeFilterLabel}</span>
            <span className="text-xs text-zinc-500">{isFilterOpen ? '▲' : '▼'}</span>
          </button>

          {isFilterOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-[260px] overflow-y-auto rounded-xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(243,247,252,0.9)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_18px_38px_rgba(15,23,42,0.14)]">
              {availableFilters.map((item) => {
                const active = item.key === filter
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setFilter(item.key)
                      setIsFilterOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${
                      active
                        ? 'bg-[#2980B9] font-semibold text-white'
                        : 'text-zinc-700 hover:bg-white/75'
                    }`}
                  >
                    <span>{item.label}</span>
                    {active ? <span className="text-xs">✓</span> : null}
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          Pro tento filtr teď nemáš žádné nabídky.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((offer) => (
            <article
              key={offer.id}
              className="relative min-w-0 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px]"
            >
              <Link
                href={`/offers/${offer.id}`}
                className="absolute inset-0 z-10 rounded-2xl"
                aria-label={`Otevřít nabídku ${offer.offerNumber}`}
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-zinc-900">
                    {offer.offerNumber}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-zinc-600" title={offer.clientName}>
                    {offer.clientName}
                  </div>
                  <div className="mt-0.5 truncate text-sm text-zinc-600" title={offer.title}>
                    {offer.title}
                  </div>
                </div>
                <div className="relative z-20 shrink-0">
                  <OfferStatusButton
                    offerId={offer.id}
                    offerNumber={offer.offerNumber}
                    currentStatus={offer.status}
                    isAdmin={isAdmin}
                    isOwner
                    badgeWidthClass="w-[132px] sm:w-[150px]"
                  />
                </div>
              </div>

              {offer.lastCommentText ? (
                <div className="relative z-10 mt-2 rounded-xl border border-[#ffd2b3]/85 bg-[linear-gradient(155deg,rgba(255,247,237,0.95)_0%,rgba(255,237,213,0.9)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_8px_18px_rgba(194,97,39,0.12)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-orange-700">
                        Poslední komentář
                      </div>
                      {hasForeignNewComment(offer) ? (
                        <span className="inline-flex items-center rounded-full border border-orange-300/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.95)_0%,rgba(255,237,213,0.9)_100%)] px-1.5 py-[1px] text-[8px] font-bold uppercase leading-none tracking-[0.04em] text-orange-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.78)]">
                          Nový
                        </span>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-[10px] tracking-[0.04em] text-orange-700">
                      {formatDateTime(offer.lastCommentAt ?? offer.updatedAt)}
                    </div>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[12px] text-zinc-700">
                    {offer.lastCommentText}
                  </div>
                </div>
              ) : null}

              <div className="relative z-10 mt-3 flex items-end justify-between gap-2">
                <div className="min-h-8">
                  {isAdmin ? (
                    <span className="inline-flex h-8 items-center rounded-xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(241,245,249,0.88)_100%)] px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_16px_rgba(15,23,42,0.08)]">
                      {offer.createdByName ?? 'Neznámý uživatel'}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {offer.status === 'in_progress' ? (
                    <button
                      type="button"
                      onClick={() => openCommentModal(offer)}
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-[#ffd2b3]/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(255,247,237,0.9)_100%)] px-3 text-[11px] font-bold uppercase text-orange-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(194,97,39,0.12)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(194,97,39,0.16)]"
                    >
                      PŘIDAT KOMENTÁŘ
                    </button>
                  ) : null}

                  {offer.status === 'in_progress' ? (
                    <button
                      type="button"
                      onClick={() => openDetailModal(offer)}
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-[#ffd2b3]/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(255,247,237,0.9)_100%)] px-3 text-[11px] font-bold uppercase text-orange-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(194,97,39,0.12)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(194,97,39,0.16)]"
                    >
                      KOMENTÁŘE
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {commentOffer && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[90] bg-zinc-900/10 backdrop-blur-[2px]"
                onClick={() => setCommentOffer(null)}
              />

              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="w-full max-w-[420px] rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.94)_0%,rgba(249,250,251,0.88)_42%,rgba(244,244,245,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.30)]">
                  <CommentModalContent
                    offer={commentOffer}
                    value={commentText}
                    onChange={setCommentText}
                    onClose={() => setCommentOffer(null)}
                    onSubmit={submitComment}
                    isPending={isPending}
                  />
                </div>
              </div>
            </>,
            document.body
          )
        : null}

      {detailOffer && typeof document !== 'undefined'
        ? createPortal(
            <>
              <div
                className="fixed inset-0 z-[90] bg-zinc-900/10 backdrop-blur-[2px]"
                onClick={() => setDetailOffer(null)}
              />

              <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="w-full max-w-[680px] rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.94)_0%,rgba(249,250,251,0.88)_42%,rgba(244,244,245,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.30)]">
                  <CommentsDetailModalContent
                    offer={detailOffer}
                    comments={detailComments}
                    isLoading={detailLoading}
                    error={detailError}
                    onClose={() => setDetailOffer(null)}
                  />
                </div>
              </div>
            </>,
            document.body
          )
        : null}
    </section>
  )
}

function CommentModalContent({
  offer,
  value,
  onChange,
  onClose,
  onSubmit,
  isPending,
}: {
  offer: DashboardOfferPreview
  value: string
  onChange: (value: string) => void
  onClose: () => void
  onSubmit: () => void
  isPending: boolean
}) {
  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            NOVÝ KOMENTÁŘ
          </div>
          <div className="mt-1 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.24)]">
            {offer.offerNumber}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
        >
          ✕
        </button>
      </div>

      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Komentář k průběhu..."
        className="w-full rounded-xl border border-gray-200 bg-white/96 px-3 py-2 text-sm text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] transition placeholder:text-zinc-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
      />

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
        >
          Zavřít
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-[#ffb98c] bg-[linear-gradient(155deg,#ff9a4d_0%,#ff861f_58%,#f97316_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(249,115,22,0.26)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_26px_rgba(249,115,22,0.32)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Ukládám...' : 'Přidat komentář'}
        </button>
      </div>
    </div>
  )
}

function CommentsDetailModalContent({
  offer,
  comments,
  isLoading,
  error,
  onClose,
}: {
  offer: DashboardOfferPreview
  comments: OfferCommentDetail[]
  isLoading: boolean
  error: string | null
  onClose: () => void
}) {
  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            KOMENTÁŘE NABÍDKY
          </div>
          <div className="mt-1 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.24)]">
            {offer.offerNumber}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
          aria-label="Zavřít detail komentářů"
        >
          ✕
        </button>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-dashed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          Načítám komentáře...
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(254,242,242,0.84)_100%)] px-4 py-8 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_30px_rgba(185,28,28,0.14)]">
          {error}
        </div>
      ) : comments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          Tato nabídka zatím nemá žádné komentáře.
        </div>
      ) : (
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
                  {comment.authorName ?? 'Neznámý uživatel'}
                </div>
                <div className="shrink-0 text-[11px] text-zinc-500">
                  {formatDateTime(comment.createdAt)}
                </div>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-zinc-800">
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
          className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
        >
          Zavřít
        </button>
      </div>
    </div>
  )
}
