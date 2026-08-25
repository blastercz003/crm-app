'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  activateDispatcherCalendarAction,
  activatePortalJobCalendarAction,
  disconnectDispatcherGoogleCalendarAction,
  disconnectPortalJobGoogleCalendarAction,
  type DispatcherCalendarActivationState,
  type DispatcherGoogleDisconnectState,
} from './dispatcher-calendar-actions'
import type { DispatcherCalendarScope } from '@/lib/jobs/dispatcher-calendar-scope'

type DispatcherCalendarButtonProps = {
  className?: string
  initiallyActivated: boolean
  initialFeedPath: string | null
  initialGoogleConnected: boolean
  initialGoogleConfigured: boolean
  initialMessage?: string | null
  initialError?: string | null
  calendarScope?: DispatcherCalendarScope
}

function buildFeedUrls(feedPath: string | undefined, origin: string | null) {
  if (!feedPath || !origin) return { webcalUrl: null, httpsUrl: null }
  const httpsUrl = new URL(feedPath, origin).toString()
  const url = new URL(httpsUrl)
  return { httpsUrl, webcalUrl: `webcal://${url.host}${url.pathname}` }
}

function CalendarCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="meetings-calendar-modal__link-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <h3 className="meetings-calendar-modal__link-title text-sm font-semibold text-zinc-950">
        {title}
      </h3>
      <p className="meetings-calendar-modal__link-description mt-1 text-sm leading-6 text-zinc-500">
        {description}
      </p>
      {children}
    </section>
  )
}

export function DispatcherCalendarButton({
  className = '',
  initiallyActivated,
  initialFeedPath,
  initialGoogleConnected,
  initialGoogleConfigured,
  initialMessage = null,
  initialError = null,
  calendarScope = 'all_jobs',
}: DispatcherCalendarButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const initialActivationState: DispatcherCalendarActivationState = {
    success: initiallyActivated,
    error: null,
    feedPath: initialFeedPath ?? undefined,
  }
  const [activationState, activationAction] = useActionState(
    calendarScope === 'sales_owner'
      ? activatePortalJobCalendarAction
      : activateDispatcherCalendarAction,
    initialActivationState
  )
  const [disconnectState, disconnectAction] = useActionState(
    calendarScope === 'sales_owner'
      ? disconnectPortalJobGoogleCalendarAction
      : disconnectDispatcherGoogleCalendarAction,
    { success: false, error: null } satisfies DispatcherGoogleDisconnectState
  )

  useBodyScrollLock(isOpen)

  const isGoogleConnected = initialGoogleConnected && !disconnectState.success

  useEffect(() => {
    if (!initialMessage && !initialError) return

    const frame = window.requestAnimationFrame(() => {
      if (triggerRef.current?.getClientRects().length) setIsOpen(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [initialError, initialMessage])

  const origin = typeof window === 'undefined' ? null : window.location.origin
  const feedUrls = buildFeedUrls(activationState.feedPath, origin)
  const googleConnectPath =
    calendarScope === 'sales_owner'
      ? '/api/dispatcher-job-google-calendar/connect?scope=sales_owner'
      : '/api/dispatcher-job-google-calendar/connect'
  const googleConnectUrl = origin
    ? new URL(googleConnectPath, origin).toString()
    : googleConnectPath

  async function copyFeedUrl() {
    if (!feedUrls.webcalUrl || !navigator.clipboard) return
    await navigator.clipboard.writeText(feedUrls.webcalUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const modal = isOpen ? (
    <div
      className="meetings-calendar-modal meetings-modal__overlay fixed inset-0 z-[120] overflow-y-auto bg-zinc-950/38 p-4 backdrop-blur-[5px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispatcher-calendar-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setIsOpen(false)
      }}
    >
      <div className="flex min-h-full items-start justify-center py-4 sm:items-center">
        <div className="meetings-calendar-modal__shell meetings-modal__shell relative flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.92)_0%,rgba(249,250,251,0.86)_42%,rgba(244,244,245,0.78)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)]">
          <div
            aria-hidden="true"
            className="meetings-modal__shell-frame pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />

          <header className="meetings-calendar-modal__header meetings-modal__header flex items-start justify-between gap-4 border-b border-gray-100/90 px-4 py-4 sm:px-5">
            <ModalHeading
              section="ZAKÁZKY"
              title={
                calendarScope === 'sales_owner'
                  ? 'B-ENERGY MOJE ZAKÁZKY'
                  : 'B-ENERGY VŠECHNY ZAKÁZKY'
              }
              id="dispatcher-calendar-modal-title"
            />
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="meetings-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-white/90 text-sm text-gray-700 shadow-sm"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </header>

          <div className="meetings-calendar-modal__body meetings-modal__body max-h-[calc(100dvh-8rem)] space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
            <section className="meetings-calendar-modal__intro-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
              <p className="meetings-calendar-modal__intro-text text-sm leading-6 text-zinc-600">
                {calendarScope === 'sales_owner'
                  ? 'Do osobního kalendáře se synchronizují všechny vaše přidělené zakázky včetně marných výjezdů. Kalendář je pouze pro čtení a změny se provádějí v aplikaci.'
                  : 'Do osobního kalendáře se synchronizují všechny zakázky kromě marných výjezdů. Kalendář je pouze pro čtení a změny se provádějí v aplikaci.'}
              </p>

              {initialMessage ? (
                <div className="meetings-calendar-modal__status mt-3 rounded-xl border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {initialMessage}
                </div>
              ) : null}
              {initialError || activationState.error || disconnectState.error ? (
                <div className="meetings-calendar-modal__error mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {initialError ?? activationState.error ?? disconnectState.error}
                </div>
              ) : null}
              {activationState.success ? (
                <div className="meetings-calendar-modal__status mt-3 rounded-xl border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Apple kalendářový feed je aktivní
                  {typeof activationState.insertedCount === 'number'
                    ? ` · doplněno ${activationState.insertedCount} zakázek`
                    : ''}
                </div>
              ) : null}
            </section>

            <form action={activationAction}>
              <button
                type="submit"
                className="meetings-page__calendar-button inline-flex h-11 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-md"
              >
                {activationState.success ? 'ZNOVU PROVÉST AKTIVACI' : 'AKTIVOVAT KALENDÁŘ'}
              </button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              <CalendarCard
                title="iPhone / Apple Kalendář"
                description="Otevři osobní odběr nebo zkopíruj jeho zabezpečený odkaz."
              >
                {activationState.success && feedUrls.webcalUrl ? (
                  <>
                    <a
                      href={feedUrls.webcalUrl}
                      className="meetings-calendar-modal__link-button meetings-calendar-modal__link-button--apple mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[#347fb8] px-4 text-sm font-medium uppercase text-white"
                    >
                      OTEVŘÍT V KALENDÁŘI
                    </a>
                    <div className="meetings-calendar-modal__copy-value mt-3 rounded-xl border border-dashed border-zinc-300 bg-white/70 px-3 py-3 text-xs text-zinc-700 break-all">
                      {feedUrls.webcalUrl}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyFeedUrl()}
                      className="meetings-calendar-modal__copy-button mt-3 inline-flex h-10 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[#347fb8] px-4 text-sm font-medium uppercase text-white"
                    >
                      {copied ? 'ODKAZ ZKOPÍROVÁN' : 'ZKOPÍROVAT ODKAZ'}
                    </button>
                  </>
                ) : (
                  <div className="meetings-calendar-modal__link-disabled mt-4 rounded-xl border border-dashed border-zinc-300 bg-white/70 px-3 py-3 text-center text-sm text-zinc-400">
                    Nejprve aktivuj kalendář
                  </div>
                )}
              </CalendarCard>

              <CalendarCard
                title="Google Calendar"
                description={
                  calendarScope === 'sales_owner'
                    ? 'V Google účtu se vytvoří samostatný kalendář vašich zakázek.'
                    : 'V Google účtu se vytvoří samostatný kalendář všech zakázek.'
                }
              >
                {isGoogleConnected ? (
                  <div className="meetings-calendar-modal__status mt-4 rounded-xl border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    Google kalendář je připojen
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={!initialGoogleConfigured}
                  onClick={() => window.location.assign(googleConnectUrl)}
                  className="meetings-calendar-modal__link-button meetings-calendar-modal__link-button--google mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[#347fb8] px-4 text-sm font-medium uppercase text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {initialGoogleConfigured
                    ? isGoogleConnected
                      ? 'ZNOVU PROVÉST AKTIVACI'
                      : 'PŘIPOJIT GOOGLE ÚČET'
                    : 'GOOGLE NENÍ NASTAVEN'}
                </button>
                {isGoogleConnected ? (
                  <form action={disconnectAction} className="mt-3">
                    <button
                      type="submit"
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium uppercase text-rose-700"
                    >
                      ODPOJIT GOOGLE KALENDÁŘ
                    </button>
                  </form>
                ) : null}
              </CalendarCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className={`jobs-page__calendar-button inline-flex h-9 items-center justify-center whitespace-nowrap rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition hover:-translate-y-[1px] ${className}`}
      >
        ZAK DO KALENDÁŘE
      </button>
      {isOpen && typeof document !== 'undefined'
        ? createPortal(modal, document.body)
        : null}
    </>
  )
}
