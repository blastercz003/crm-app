'use client'

import Link from 'next/link'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  GLOBAL_SEARCH_DEBOUNCE_MS,
  GLOBAL_SEARCH_FEATURE_ENABLED,
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/global-search/config'
import { GLOBAL_SEARCH_SECTIONS } from '@/lib/global-search/sections'
import type { GlobalSearchResponse, GlobalSearchSectionResult } from '@/lib/global-search/types'

type SearchState = {
  enabled: boolean
  query: string
  setQuery: (value: string) => void
  isLoading: boolean
  error: string | null
  response: GlobalSearchResponse | null
  isActive: boolean
  focusInput: () => void
  registerInput: (el: HTMLInputElement | null) => void
}

const SearchContext = createContext<SearchState | null>(null)

function useSearchContext() {
  const context = useContext(SearchContext)

  if (!context) {
    throw new Error('Dashboard global search context is not available.')
  }

  return context
}

export function DashboardGlobalSearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<GlobalSearchResponse | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const registerInput = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el
  }, [])

  const focusInput = useCallback(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!GLOBAL_SEARCH_FEATURE_ENABLED) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey

      if (modifierPressed && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    if (!GLOBAL_SEARCH_FEATURE_ENABLED) {
      return
    }

    const trimmed = query.trim()

    if (trimmed.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
      setIsLoading(false)
      setError(null)
      setResponse(null)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setIsLoading(true)
      setError(null)

      try {
        const url = `/api/global-search?q=${encodeURIComponent(trimmed)}`
        const result = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store',
        })

        if (!result.ok) {
          throw new Error('Nepodařilo se načíst výsledky hledání.')
        }

        const payload = (await result.json()) as GlobalSearchResponse
        setResponse(payload)
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return
        }

        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Nepodařilo se načíst výsledky hledání.'
        )
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }, GLOBAL_SEARCH_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [query])

  const state = useMemo<SearchState>(
    () => ({
      enabled: GLOBAL_SEARCH_FEATURE_ENABLED,
      query,
      setQuery,
      isLoading,
      error,
      response,
      isActive: query.trim().length >= GLOBAL_SEARCH_MIN_QUERY_LENGTH,
      focusInput,
      registerInput,
    }),
    [error, focusInput, isLoading, query, registerInput, response]
  )

  return <SearchContext.Provider value={state}>{children}</SearchContext.Provider>
}

export function DashboardGlobalSearchInput({ className }: { className: string }) {
  const { enabled, query, setQuery, registerInput } = useSearchContext()

  if (!enabled) {
    return (
      <input
        type="text"
        aria-label="HLEDAT"
        placeholder="HLEDAT"
        autoComplete="off"
        disabled
        className={className}
      />
    )
  }

  return (
    <input
      ref={registerInput}
      id="dashboard-global-search"
      type="text"
      aria-label="HLEDAT"
      placeholder="HLEDAT"
      autoComplete="off"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      className={className}
    />
  )
}

function SectionResults({ section, query }: { section: GlobalSearchSectionResult; query: string }) {
  const showAllHref = GLOBAL_SEARCH_SECTIONS.find((item) => item.key === section.key)?.buildShowAllHref(query)

  const getOfferStatusBadgeClass = (statusLabel: string | null | undefined) => {
    if (statusLabel === 'Objednáno') return 'bg-green-600 text-white border-transparent'
    if (statusLabel === 'Zamítnuto') return 'bg-red-100 text-red-700 border-red-200'
    if (statusLabel === 'Odeslaná') {
      return 'border-[#cfd8e3]/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,246,251,0.9)_48%,rgba(234,241,248,0.84)_100%)] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_16px_rgba(15,23,42,0.10)]'
    }
    if (statusLabel === 'Schválená') return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    if (statusLabel === 'Ke schválení') return 'bg-[#2980B9]/10 text-[#236f9f] border-[#2980B9]/30'
    if (statusLabel === 'K úpravě') return 'bg-amber-100 text-amber-700 border-amber-200'
    return 'bg-zinc-100 text-zinc-600 border-zinc-200'
  }

  const getMeetingStatusBadgeClass = (statusLabel: string | null | undefined) => {
    if (statusLabel === 'Plánované') return 'border-transparent bg-[#2980B9] text-white'
    if (statusLabel === 'Proběhlé') return 'border-transparent bg-emerald-600 text-white'
    if (statusLabel === 'Po termínu') return 'border-transparent bg-zinc-800 text-white'
    return 'bg-zinc-100 text-zinc-600 border-zinc-200'
  }

  const getJobStatusBadgeClass = (statusLabel: string | null | undefined) => {
    if (statusLabel === 'NOVÁ') return 'border border-blue-300 bg-blue-100 text-blue-800'
    if (statusLabel === 'V ŘEŠENÍ') return 'border border-amber-300 bg-amber-100 text-amber-800'
    if (statusLabel === 'REALIZACE') return 'border border-emerald-300 bg-emerald-100 text-emerald-800'
    if (statusLabel === 'UKONČENÁ') return 'border border-slate-300 bg-slate-100 text-slate-700'
    if (statusLabel === 'STORNO') return 'border border-red-300 bg-red-100 text-red-800'
    return 'bg-zinc-100 text-zinc-600 border-zinc-200'
  }

  return (
    <section className="relative flex h-[375px] w-full flex-col overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">{section.label}</h2>
        {showAllHref ? (
          <Link
            href={showAllHref}
            className="inline-flex h-[46px] w-[172px] min-w-[172px] max-w-[172px] items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-3 py-3 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
          >
            ZOBRAZIT VŠE
          </Link>
        ) : null}
      </div>

      {section.items.length === 0 ? (
        <div className="mt-3 flex flex-1 items-start">
          <p className="text-sm text-zinc-500">Nic nenalezeno.</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
          {section.items.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={() => {
                const body = JSON.stringify({
                  query,
                  sectionKey: section.key,
                  itemId: item.id,
                  itemHref: item.href,
                })

                if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                  const blob = new Blob([body], { type: 'application/json' })
                  navigator.sendBeacon('/api/global-search/click', blob)
                  return
                }

                void fetch('/api/global-search/click', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body,
                  keepalive: true,
                })
              }}
              className={[
                'group rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 hover:border-[#76a9d3]/85 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96)]',
                section.key === 'clients' ||
                section.key === 'tasks' ||
                section.key === 'meetings' ||
                section.key === 'offers' ||
                section.key === 'jobs' ||
                section.key === 'jobs_portal' ||
                section.key === 'faktury'
                  ? 'flex min-h-[88px] items-center justify-between py-3'
                  : 'py-3',
              ].join(' ')}
            >
              {section.key === 'clients' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                      {item.statusLabel ? (
                        <span
                          className={[
                            'shrink-0 inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-700',
                          ].join(' ')}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">{item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : section.key === 'tasks' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                      {item.statusLabel ? (
                        <span className="shrink-0 inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-700">
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">{item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : section.key === 'meetings' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                      {item.statusLabel ? (
                        <span
                          className={[
                            'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                            getMeetingStatusBadgeClass(item.statusLabel),
                          ].join(' ')}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">🗓 {item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : section.key === 'offers' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                      {item.statusLabel ? (
                        <span
                          className={[
                            'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                            getOfferStatusBadgeClass(item.statusLabel),
                          ].join(' ')}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">{item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : section.key === 'jobs' || section.key === 'jobs_portal' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                      {item.statusLabel ? (
                        <span
                          className={[
                            'shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
                            getJobStatusBadgeClass(item.statusLabel),
                          ].join(' ')}
                        >
                          {item.statusLabel}
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">{item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : section.key === 'faktury' ? (
                <>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-base font-semibold text-zinc-900">
                        {item.title}
                      </div>
                    </div>
                    {item.subtitle ? (
                      <div className="mt-1 truncate text-sm text-zinc-600">{item.subtitle}</div>
                    ) : null}
                    {item.meta ? (
                      <div className="mt-0.5 truncate text-sm text-zinc-600">{item.meta}</div>
                    ) : null}
                  </div>
                  <span className="ml-4 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#2980B9] bg-[#2980B9] text-base font-semibold text-white transition group-hover:border-[#236f9f] group-hover:bg-[#236f9f]">
                    →
                  </span>
                </>
              ) : (
                <>
                  <div className="text-sm font-semibold text-zinc-900">{item.title}</div>
                  {item.subtitle ? <div className="mt-0.5 text-sm text-zinc-600">{item.subtitle}</div> : null}
                  {item.meta ? <div className="mt-1 text-xs text-zinc-500">{item.meta}</div> : null}
                </>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

export function DashboardGlobalSearchBody({ children }: { children: ReactNode }) {
  const { enabled, isActive, isLoading, error, response, query } = useSearchContext()
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null)
  const [bridgeTop, setBridgeTop] = useState(88)
  const bridgeRef = useRef<HTMLDivElement | null>(null)
  const activeButtonRef = useRef<HTMLButtonElement | null>(null)
  const sections = response?.sections ?? []
  const requestedActiveSection = activeSectionKey
    ? sections.find((section) => section.key === activeSectionKey)
    : null
  const activeSection =
    requestedActiveSection ?? sections.find((section) => section.totalCount > 0) ?? sections[0] ?? null

  useLayoutEffect(() => {
    const updateBridgeTop = () => {
      if (!bridgeRef.current || !activeButtonRef.current) return
      const bridgeRect = bridgeRef.current.getBoundingClientRect()
      const buttonRect = activeButtonRef.current.getBoundingClientRect()
      setBridgeTop(buttonRect.top + buttonRect.height / 2 - bridgeRect.top)
    }

    updateBridgeTop()
    window.addEventListener('resize', updateBridgeTop)
    return () => window.removeEventListener('resize', updateBridgeTop)
  }, [activeSection?.key, sections.length])

  if (!enabled || !isActive) {
    return <>{children}</>
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Hledání
        </div>
        <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950">
          Výsledky pro: {query.trim()}
        </h1>
      </section>

      {isLoading ? (
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          Vyhledávám...
        </section>
      ) : null}

      {error ? (
        <section className="rounded-3xl border border-red-200/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(254,242,242,0.84)_100%)] p-5 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_14px_30px_rgba(185,28,28,0.14)]">
          {error}
        </section>
      ) : null}

      {!isLoading && !error ? (
        <div className="relative flex items-start gap-0">
          <aside className="z-10 h-[375px] w-[320px] shrink-0 overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="flex h-full flex-col justify-center gap-1 overflow-y-auto">
              {sections.map((section) => {
                const isActiveSection = activeSection?.key === section.key
                return (
                  <button
                    key={section.key}
                    type="button"
                    ref={isActiveSection ? activeButtonRef : null}
                    onClick={() => setActiveSectionKey(section.key)}
                    className={[
                      'relative flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition',
                      isActiveSection
                        ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34)]'
                        : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] hover:-translate-y-[1px] hover:border-[#76a9d3]/85 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96)]',
                    ].join(' ')}
                  >
                    <span className="text-sm font-medium">{section.label}</span>
                    <span
                      className={[
                        'inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold',
                        isActiveSection ? 'bg-white/20 text-white' : 'border border-white/75 bg-white/85 text-zinc-700',
                      ].join(' ')}
                    >
                      {section.totalCount}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <div
            ref={bridgeRef}
            className="relative z-20 -mx-1 block h-[375px] w-[32px] shrink-0 overflow-hidden"
          >
            <div className="absolute inset-y-6 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-zinc-300" />
            <div
              aria-hidden="true"
              className="absolute left-0 right-0 h-10 -translate-y-1/2"
              style={{ top: bridgeTop }}
            >
              <div className="absolute left-[2px] right-[2px] top-1/2 h-[4px] -translate-y-1/2 rounded-full bg-[#2980B9]" />
              <div className="absolute left-[1px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full bg-[#2980B9]" />
              <div className="absolute right-[1px] top-1/2 h-[8px] w-[8px] -translate-y-1/2 rounded-full bg-[#2980B9]" />
            </div>
          </div>

          {activeSection ? (
            <div
              key={activeSection.key}
              className="z-0 min-w-0 flex-1 transition-opacity duration-200 ease-out"
            >
              <SectionResults section={activeSection} query={query.trim()} />
            </div>
          ) : (
            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              Nic nenalezeno.
            </section>
          )}
        </div>
      ) : null}
    </div>
  )
}
