'use client'

import { useEffect, useMemo, useState } from 'react'

type OfferInfoCardsProps = {
  showSaved: boolean
  showSubmitted: boolean
  showStaleSubmitted: boolean
  rejectionComment: string | null
}

type InfoCard = {
  key: string
  tone: 'success' | 'warning' | 'note'
  title: string
  message: string
}

export function OfferInfoCards({
  showSaved,
  showSubmitted,
  showStaleSubmitted,
  rejectionComment,
}: OfferInfoCardsProps) {
  const [savedState, setSavedState] = useState<'hidden' | 'visible' | 'fading-out'>(
    showSaved ? 'visible' : 'hidden',
  )
  const [submittedState, setSubmittedState] = useState<'hidden' | 'visible' | 'fading-out'>(
    showSubmitted ? 'visible' : 'hidden',
  )

  useEffect(() => {
    const syncId = window.setTimeout(() => {
      setSavedState(showSaved ? 'visible' : 'hidden')
    }, 0)

    return () => window.clearTimeout(syncId)
  }, [showSaved])

  useEffect(() => {
    const syncId = window.setTimeout(() => {
      setSubmittedState(showSubmitted ? 'visible' : 'hidden')
      if (showSubmitted) {
        const url = new URL(window.location.href)
        url.searchParams.delete('submitted')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
      }
    }, 0)

    return () => window.clearTimeout(syncId)
  }, [showSubmitted])

  useEffect(() => {
    if (savedState !== 'visible') return
    const timeoutId = window.setTimeout(() => {
      setSavedState('fading-out')
    }, 10_000)

    return () => window.clearTimeout(timeoutId)
  }, [savedState])

  useEffect(() => {
    if (savedState !== 'fading-out') return
    const timeoutId = window.setTimeout(() => {
      setSavedState('hidden')
    }, 240)

    return () => window.clearTimeout(timeoutId)
  }, [savedState])

  useEffect(() => {
    if (submittedState !== 'visible') return
    const timeoutId = window.setTimeout(() => {
      setSubmittedState('fading-out')
    }, 10_000)

    return () => window.clearTimeout(timeoutId)
  }, [submittedState])

  useEffect(() => {
    if (submittedState !== 'fading-out') return
    const timeoutId = window.setTimeout(() => {
      setSubmittedState('hidden')
    }, 240)

    return () => window.clearTimeout(timeoutId)
  }, [submittedState])

  const cards = useMemo<InfoCard[]>(() => {
    const entries: InfoCard[] = []

    if (showStaleSubmitted) {
      entries.push({
        key: 'stale-submitted',
        tone: 'warning',
        title: 'ZMĚNA PO ODESLÁNÍ!',
        message:
          'Nabídka byla upravena po odeslání ke schválení. Odešli ji ke schválení znovu.',
      })
    } else if (savedState !== 'hidden') {
      entries.push({
        key: 'saved',
        tone: 'success',
        title: 'NABÍDKA ULOŽENA',
        message: 'Změny byly úspěšně uloženy.',
      })
    }

    if (submittedState !== 'hidden') {
      entries.push({
        key: 'approval-submitted',
        tone: 'warning',
        title: 'ŽÁDOST O SCHVÁLENÍ ODESLÁNA',
        message: 'Nabídka byla předána ke schválení v aktuální verzi.',
      })
    }

    if (rejectionComment) {
      entries.push({
        key: 'changes-requested-comment',
        tone: 'note',
        title: 'KOMENTÁŘ KE VRÁCENÍ',
        message: rejectionComment,
      })
    }

    return entries
  }, [savedState, submittedState, showStaleSubmitted, rejectionComment])

  if (cards.length === 0) return null

  return (
    <div className="hidden space-y-3 lg:block">
      {cards.map((entry) => (
        <article
          key={entry.key}
          className={`${
            (entry.key === 'saved' && savedState === 'fading-out') ||
            (entry.key === 'approval-submitted' && submittedState === 'fading-out')
              ? 'offer-status-card-fade-out'
              : 'offer-status-card-fade-in'
          }`}
        >
          <div
            className={`overflow-hidden rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_20px_rgba(15,23,42,0.08)] ${
              entry.tone === 'success'
                ? 'offer-status-card-glow--success border-emerald-300/85 bg-[linear-gradient(160deg,rgba(236,253,245,0.96)_0%,rgba(209,250,229,0.9)_100%)]'
                : entry.tone === 'warning'
                  ? 'offer-status-card-glow--warning border-[#7bb0d7]/85 bg-[linear-gradient(160deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
                  : 'offer-status-card-glow--note border-amber-300/85 bg-[linear-gradient(160deg,rgba(255,251,235,0.96)_0%,rgba(254,243,199,0.9)_100%)]'
            }`}
          >
            <div className="px-3 py-3 text-center">
              <div
                className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${
                  entry.tone === 'success'
                    ? 'text-emerald-800'
                    : entry.tone === 'warning'
                      ? 'text-white'
                      : 'text-amber-800'
                }`}
              >
                {entry.title}
              </div>
              <p
                className={`mt-1 whitespace-pre-wrap text-sm leading-5 ${
                  entry.tone === 'warning' ? 'text-white' : 'text-gray-800'
                }`}
              >
                {entry.message}
              </p>
            </div>
          </div>
        </article>
      ))}
    </div>
  )
}
