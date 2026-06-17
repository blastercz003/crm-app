'use client'

import { useActionState, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  activateJobCalendarModalAction,
  type JobCalendarActivationActionState,
} from './actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type JobCalendarButtonProps = {
  className?: string
  label?: string
  initiallyActivated?: boolean
  initialFeedPath?: string | null
}

function buildExternalFeedUrls(feedPath: string | undefined, origin: string | null) {
  if (!feedPath || !origin) {
    return {
      httpsUrl: null,
      webcalUrl: null,
      googleIcsUrl: null,
      googleUrl: null,
    }
  }

  const httpsUrl = new URL(feedPath, origin).toString()
  const googleIcsUrl = new URL(`${feedPath}/google.ics`, origin).toString()

  return {
    httpsUrl,
    webcalUrl: `webcal://${new URL(httpsUrl).host}${new URL(httpsUrl).pathname}`,
    googleIcsUrl,
    googleUrl: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(googleIcsUrl)}`,
  }
}

function CalendarLinkCard({
  title,
  description,
  href,
  hrefLabel,
  accentClassName,
  target,
  rel,
  variant,
}: {
  title: string
  description: string
  href: string | null
  hrefLabel: string
  accentClassName: string
  target?: string
  rel?: string
  variant: 'apple' | 'google'
}) {
  const buttonVariantClassName =
    variant === 'apple'
      ? 'meetings-calendar-modal__link-button--apple'
      : 'meetings-calendar-modal__link-button--google'

  return (
    <div className="meetings-calendar-modal__link-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="meetings-calendar-modal__link-title text-sm font-semibold tracking-tight text-zinc-950">
            {title}
          </h3>
          <p className="meetings-calendar-modal__link-description mt-1 text-sm leading-6 text-zinc-500">
            {description}
          </p>
        </div>

        <span
          className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${accentClassName}`}
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v4" />
            <path d="M16 3v4" />
            <path d="M3 9h18" />
            <rect x="4" y="5" width="16" height="16" rx="3" />
          </svg>
        </span>
      </div>

      {href ? (
        <a
          href={href}
          target={target}
          rel={rel}
          className={`meetings-calendar-modal__link-button ${buttonVariantClassName} mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]`}
        >
          {hrefLabel}
        </a>
      ) : (
        <div className="meetings-calendar-modal__link-disabled mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/70 px-4 text-sm font-medium uppercase text-zinc-400">
          Nejprve aktivuj kalendář
        </div>
      )}
    </div>
  )
}

function IphoneCalendarCard({
  href,
  copyValue,
  activated,
}: {
  href: string | null
  copyValue: string | null
  activated: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!copyValue || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    await navigator.clipboard.writeText(copyValue)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="meetings-calendar-modal__link-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="meetings-calendar-modal__link-title text-sm font-semibold tracking-tight text-zinc-950">
            iPhone / Apple Kalendář
          </h3>
          <p className="meetings-calendar-modal__link-description mt-1 text-sm leading-6 text-zinc-500">
            Na iPhonu zkusíme otevřít odběr přímo z PWA. Když to nepůjde,
            zkopíruj odkaz níže a vlož ho do Safari.
          </p>
        </div>

        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.24)]"
          aria-hidden="true"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 3v4" />
            <path d="M16 3v4" />
            <path d="M3 9h18" />
            <rect x="4" y="5" width="16" height="16" rx="3" />
          </svg>
        </span>
      </div>

      {activated && href ? (
        <a
          href={href}
          className="meetings-calendar-modal__link-button mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
        >
          OTEVŘÍT V KALENDÁŘI
        </a>
      ) : (
        <div className="meetings-calendar-modal__link-disabled mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/70 px-4 text-sm font-medium uppercase text-zinc-400">
          Nejprve aktivuj kalendář
        </div>
      )}

      <div className="meetings-calendar-modal__copy-value mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-3 py-3 text-sm text-zinc-700 break-all">
        {copyValue ?? 'Odkaz se nepodařilo připravit.'}
      </div>

      <button
        type="button"
        onClick={() => {
          void handleCopy()
        }}
        className="meetings-calendar-modal__copy-button mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px]"
      >
        {copied ? 'Odkaz zkopírován' : 'Zkopírovat odkaz'}
      </button>
    </div>
  )
}

export function JobCalendarButton({
  className,
  label = 'ZAKÁZKY DO KALENDÁŘE',
  initiallyActivated = false,
  initialFeedPath = null,
}: JobCalendarButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const initialJobCalendarActivationState: JobCalendarActivationActionState = {
    success: initiallyActivated,
    error: null,
    feedPath: initialFeedPath ?? undefined,
  }
  const [state, formAction] = useActionState(
    activateJobCalendarModalAction,
    initialJobCalendarActivationState
  )
  const origin = typeof window !== 'undefined' ? window.location.origin : null

  useBodyScrollLock(isOpen)

  const feedUrls = buildExternalFeedUrls(state.feedPath, origin)

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.28)]'

  const modalContent = isOpen ? (
    <div
      className="meetings-calendar-modal meetings-modal__overlay fixed inset-0 z-[120] overflow-y-auto bg-zinc-950/38 p-4 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-calendar-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          setIsOpen(false)
        }
      }}
    >
      <div
        className="flex min-h-full items-start justify-center py-4 sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          className="meetings-calendar-modal__shell meetings-modal__shell relative flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.92)_0%,rgba(249,250,251,0.86)_42%,rgba(244,244,245,0.78)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] will-change-transform transform-gpu lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div
            aria-hidden="true"
            className="meetings-modal__shell-frame pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <div
            aria-hidden="true"
            className="meetings-modal__shell-sheen pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />
          <div
            aria-hidden="true"
            className="meetings-modal__shell-halo pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]"
          />

          <div className="meetings-calendar-modal__header meetings-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.74)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Kalendář pro zakázky technika
              </div>
              <h2
                id="job-calendar-modal-title"
                className="meetings-modal__title mt-1 text-lg font-semibold tracking-tight text-gray-900 sm:text-xl"
              >
                B-ENERGY ZAKÁZKY TECHNIKA
              </h2>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="meetings-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="meetings-calendar-modal__body meetings-modal__body min-h-0 flex flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-5">
            <div className="meetings-calendar-modal__intro-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
              <p className="meetings-calendar-modal__intro-text text-sm leading-6 text-zinc-600">
                Aktivací si přidáš osobní odběr zakázek do telefonu.
                <br />
                Všechny nové zakázky se budou propisovat automaticky,
                včetně změn, smazání i připomínek.
              </p>

              {state.success ? (
                <div className="meetings-calendar-modal__status mt-3 rounded-xl border border-emerald-500/20 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                  Kalendář je aktivní
                  {typeof state.insertedCount === 'number' ? (
                    <span className="font-normal text-emerald-700">
                      {' '}
                      a backfill doplnil {state.insertedCount} existujících
                      zakázek.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {state.error ? (
                <div className="meetings-calendar-modal__error mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <form action={formAction} className="flex flex-col gap-3">
              <button
                type="submit"
                className={`meetings-page__calendar-button ${resolvedClassName} h-11 w-full sm:w-auto sm:self-start`}
              >
                {state.success ? 'ZNOVU PROVÉST AKTIVACI' : 'AKTIVOVAT KALENDÁŘ'}
              </button>
            </form>

            <div className="grid gap-3 md:grid-cols-2">
              <IphoneCalendarCard
                activated={state.success}
                href={feedUrls.webcalUrl}
                copyValue={feedUrls.webcalUrl}
              />
              <CalendarLinkCard
                title="Google Calendar"
                description="Na Androidu nebo v Google Calendar se otevře přihlášení k odběru z odkazu."
                href={feedUrls.googleUrl}
                hrefLabel="PŘIDAT DO GOOGLE CALENDAR"
                accentClassName="border-emerald-500/20 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.22)]"
                target="_blank"
                rel="noreferrer noopener"
                variant="google"
              />
            </div>

            <div className="meetings-calendar-modal__steps rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
              <h3 className="meetings-calendar-modal__steps-title text-sm font-semibold tracking-tight text-zinc-950">
                Jak to funguje
              </h3>
              <ul className="meetings-calendar-modal__steps-text mt-2 space-y-2 text-sm leading-6 text-zinc-600">
                <li>• Jeden odkaz je vždy navázaný na konkrétního technika.</li>
                <li>• Do kalendáře se propisují jen jeho vlastní zakázky.</li>
                <li>• Změny a smazání se do telefonu promítnou automaticky.</li>
                <li>• Kalendář je read-only, úpravy z telefonu se zpět nepropíšou.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`jobs-page__calendar-button meetings-page__new-button meetings-page__calendar-button ${resolvedClassName} h-9 w-full sm:w-auto sm:self-start`}
      >
        {label}
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : null}
    </>
  )
}
