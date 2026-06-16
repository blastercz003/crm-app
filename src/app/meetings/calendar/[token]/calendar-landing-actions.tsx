'use client'

import { useState } from 'react'

function buildCalendarUrls(token: string, origin: string | null) {
  if (!origin) {
    return {
      feedUrl: null,
      webcalUrl: null,
      googleUrl: null,
    }
  }

  const feedUrl = new URL(`/api/calendars/${token}`, origin).toString()
  const webcalUrl = new URL(feedUrl)

  webcalUrl.protocol = 'webcal:'

  return {
    feedUrl,
    webcalUrl: webcalUrl.toString(),
    googleUrl: `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(
      feedUrl
    )}`,
  }
}

function ActionCard({
  title,
  description,
  buttonLabel,
  href,
  target,
  rel,
  buttonClassName,
  accentClassName,
}: {
  title: string
  description: string
  buttonLabel: string
  href: string | null
  target?: string
  rel?: string
  buttonClassName: string
  accentClassName: string
}) {
  return (
    <div className="rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.10)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-zinc-950">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">{description}</p>
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
          className={`${buttonClassName} mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl px-4 text-sm font-medium uppercase tracking-[0.05em] transition duration-200 hover:-translate-y-[1px]`}
        >
          {buttonLabel}
        </a>
      ) : (
        <div className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/70 px-4 text-sm font-medium uppercase text-zinc-400">
          Nelze pokračovat
        </div>
      )}
    </div>
  )
}

export function MeetingCalendarLandingActions({ token }: { token: string }) {
  const [origin] = useState<string | null>(() =>
    typeof window !== 'undefined' ? window.location.origin : null
  )
  const [copied, setCopied] = useState(false)
  const isStandalone =
    typeof window !== 'undefined' &&
    (window.matchMedia('(display-mode: standalone)').matches ||
      // @ts-expect-error - iOS Safari standalone flag
      window.navigator.standalone === true)

  const urls = buildCalendarUrls(token, origin)

  async function handleCopy() {
    if (!urls.feedUrl || typeof navigator === 'undefined' || !navigator.clipboard) {
      return
    }

    await navigator.clipboard.writeText(urls.feedUrl)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.10)] lg:col-span-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          iPhone / Apple Kalendář
        </div>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          Pokud jsi stránku otevřel v aplikaci nebo v in-app prohlížeči, otevři
          ji nejprve v Safari. Teprve pak se kalendářový odkaz nejspolehlivěji
          předá do nativní aplikace Kalendář.
        </p>

        {isStandalone ? (
          <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Tohle je otevřené jako aplikace. Pro iPhone doporučujeme přepnout do
            Safari a pak použít tlačítko níže.
          </div>
        ) : null}
      </div>

      <ActionCard
        title="Přidat do iPhone"
        description="Otevře kalendářový feed přes webcal. Na iPhonu je to nejbližší cesta k přidání odběru do Kalendáře."
        buttonLabel="OTEVŘÍT V KALENDÁŘI"
        href={urls.webcalUrl}
        buttonClassName="border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]"
        accentClassName="border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.24)]"
      />

      <ActionCard
        title="Otevřít https odkaz"
        description="Když webcal na iPhonu zlobí, zkus otevřít samotný kalendářový feed a pokračovat přes Safari."
        buttonLabel="OTEVŘÍT ODKAZ"
        href={urls.feedUrl}
        buttonClassName="border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)]"
        accentClassName="border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]"
      />

      <ActionCard
        title="Google Calendar"
        description="Na Androidu nebo v Google Calendar zůstává klasické přihlášení k odběru odkazu."
        buttonLabel="PŘIDAT DO GOOGLE CALENDAR"
        href={urls.googleUrl}
        target="_blank"
        rel="noreferrer noopener"
        buttonClassName="border border-emerald-500/20 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.22)]"
        accentClassName="border-emerald-500/20 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.22)]"
      />

      <button
        type="button"
        onClick={() => {
          void handleCopy()
        }}
        className="lg:col-span-2 inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm font-medium uppercase tracking-[0.05em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px]"
      >
        {copied ? 'Odkaz zkopírován' : 'Zkopírovat odkaz na feed'}
      </button>
    </div>
  )
}
