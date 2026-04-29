'use client'

import { useEffect, useState } from 'react'

type DieselPriceState =
  | {
      status: 'loading'
    }
  | {
      status: 'available'
      priceText: string
      source: string
      fetchedAt: string
    }
  | {
      status: 'unavailable'
    }

function formatFetchedAt(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) return ''

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

export function DieselPriceBadge() {
  const [state, setState] = useState<DieselPriceState>({ status: 'loading' })

  useEffect(() => {
    let isMounted = true

    async function loadPrice() {
      try {
        const response = await fetch('/api/fuel-price/diesel', {
          cache: 'no-store',
        })
        const payload = (await response.json()) as {
          success?: boolean
          priceText?: string
          source?: string
          fetchedAt?: string
        }

        if (!isMounted) return

        if (
          response.ok &&
          payload.success &&
          payload.priceText &&
          payload.source &&
          payload.fetchedAt
        ) {
          setState({
            status: 'available',
            priceText: payload.priceText,
            source: payload.source,
            fetchedAt: payload.fetchedAt,
          })
          return
        }

        setState({ status: 'unavailable' })
      } catch {
        if (isMounted) {
          setState({ status: 'unavailable' })
        }
      }
    }

    loadPrice()

    return () => {
      isMounted = false
    }
  }, [])

  const text =
    state.status === 'available'
      ? `Nafta aktuálně: ${state.priceText}`
      : state.status === 'loading'
        ? 'Nafta aktuálně: ...'
        : 'Nafta aktuálně: nedostupné'
  const title =
    state.status === 'available'
      ? `Zdroj: ${state.source}, aktualizováno ${formatFetchedAt(state.fetchedAt)}`
      : undefined

  return (
    <span
      title={title}
      className="inline-flex h-8 min-w-0 max-w-[calc(100%-140px)] shrink items-center justify-center whitespace-nowrap rounded-xl border border-black bg-white px-2 text-[10px] font-bold text-black transition sm:max-w-full sm:px-3 sm:text-sm"
    >
      {text}
    </span>
  )
}
