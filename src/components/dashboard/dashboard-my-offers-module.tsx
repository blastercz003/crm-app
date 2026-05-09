'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { addOfferProgressNote } from '@/app/offers/actions'
import { OfferStatusButton } from '@/app/offers/offer-status-button'
import type { OfferStatus } from '@/lib/offers/types'
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

function getFilteredOffers(offers: DashboardOfferPreview[], filter: FilterKey) {
  switch (filter) {
    case 'in_progress':
      return offers.filter((offer) => offer.status === 'in_progress')
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
  const [filter, setFilter] = useState<FilterKey>('in_progress')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [commentOffer, setCommentOffer] = useState<DashboardOfferPreview | null>(null)
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
    () => getFilteredOffers(sorted, availableFilters.some((item) => item.key === filter) ? filter : 'in_progress').slice(0, 5),
    [sorted, filter, availableFilters]
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
    <section className="relative rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}

      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Nabídky
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Moje nabídky
          </h2>
        </div>

        <Link
          href="/offers"
          className="inline-flex min-h-[46px] shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-zinc-900 px-3 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
          style={{ width: 172, minWidth: 172, maxWidth: 172 }}
        >
          VŠECHNY NABÍDKY
        </Link>
      </div>

      <div className="mb-4">
        <div className="relative" ref={filterDropdownRef}>
          <button
            type="button"
            onClick={() => setIsFilterOpen((prev) => !prev)}
            className="flex h-11 w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-3 text-left text-base text-zinc-900 outline-none transition hover:bg-zinc-50 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200 sm:h-9 sm:text-sm"
            aria-haspopup="listbox"
            aria-expanded={isFilterOpen}
          >
            <span className="font-medium">{activeFilterLabel}</span>
            <span className="text-xs text-zinc-500">{isFilterOpen ? '▲' : '▼'}</span>
          </button>

          {isFilterOpen ? (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-[260px] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
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
                        : 'text-zinc-700 hover:bg-zinc-50'
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
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          Pro tento filtr teď nemáš žádné nabídky.
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((offer) => (
            <article
              key={offer.id}
              className="min-w-0 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm"
            >
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
                <div className="shrink-0">
                  <OfferStatusButton
                    offerId={offer.id}
                    offerNumber={offer.offerNumber}
                    currentStatus={offer.status}
                    isAdmin={isAdmin}
                    isOwner
                  />
                </div>
              </div>

              {offer.lastCommentText ? (
                <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-orange-700">
                      Poslední komentář
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

              <div className="mt-3 flex flex-wrap justify-end gap-2">
                {hasForeignNewComment(offer) ? (
                  <span className="inline-flex items-center rounded-xl border border-amber-300 bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] text-amber-800">
                    NOVÝ KOMENTÁŘ
                  </span>
                ) : null}

                {offer.status === 'in_progress' ? (
                  <button
                    type="button"
                    onClick={() => openCommentModal(offer)}
                    className="inline-flex h-8 items-center justify-center rounded-xl border border-orange-300 bg-orange-100 px-3 text-[11px] font-bold uppercase text-orange-800 transition hover:bg-orange-200"
                  >
                    PŘIDAT KOMENTÁŘ
                  </button>
                ) : null}

                <Link
                  href={`/offers/${offer.id}`}
                  className="inline-flex h-8 items-center justify-center rounded-xl bg-black px-3 text-[11px] font-bold uppercase text-white transition hover:bg-gray-800"
                >
                  DETAIL
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {commentOffer ? (
        <>
          <div
            className="fixed inset-0 z-[80] bg-zinc-900/10 backdrop-blur-[2px]"
            onClick={() => setCommentOffer(null)}
          />

          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 xl:hidden"
          >
            <div className="w-full max-w-[420px] rounded-3xl border border-zinc-200 bg-white p-4 shadow-2xl">
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

          <div className="absolute left-[calc(100%+16px)] top-0 z-[90] hidden w-[360px] rounded-3xl border border-zinc-200 bg-white p-4 shadow-2xl xl:block">
            <CommentModalContent
              offer={commentOffer}
              value={commentText}
              onChange={setCommentText}
              onClose={() => setCommentOffer(null)}
              onSubmit={submitComment}
              isPending={isPending}
            />
          </div>
        </>
      ) : null}
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
          <div className="mt-1 truncate text-sm font-semibold text-zinc-900">
            {offer.offerNumber}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          ✕
        </button>
      </div>

      <textarea
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Komentář k průběhu..."
        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:ring-2 focus:ring-zinc-200"
      />

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[11px] font-bold uppercase text-zinc-700 transition hover:bg-zinc-50"
        >
          Zavřít
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={isPending}
          className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-[11px] font-bold uppercase text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Ukládám...' : 'Přidat komentář'}
        </button>
      </div>
    </div>
  )
}
