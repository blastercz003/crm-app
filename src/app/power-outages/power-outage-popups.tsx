'use client'

import {
  Check,
  Ban,
  CircleAlert,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  History,
  Link2,
  MapPin,
  LoaderCircle,
  RotateCcw,
  SearchCheck,
  ShieldCheck,
  X,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { useModalMotionClose } from '@/components/ui/modal-motion'
import type { PowerOutageDetail, PowerOutageListItem } from '@/lib/power-outages/types'

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME_FORMATTER.format(date)
}

function sourceName(source: PowerOutageListItem['source']) {
  return source === 'cez' ? 'ČEZ Distribuce' : 'EG.D'
}

function statusLabel(status: PowerOutageListItem['sourceStatus']) {
  return ({ scheduled: 'Plánovaná', active: 'Probíhá', completed: 'Ukončena', cancelled: 'Zrušena' })[status]
}

function matchLabel(status: PowerOutageListItem['matchStatus'] | 'dismissed') {
  return ({ confirmed: 'Potvrzeno', needs_review: 'K ověření', dismissed: 'Zamítnuto' })[status]
}

function reasonLabel(reason: string) {
  return ({
    new_outage: 'Nová odstávka',
    migration_snapshot: 'Výchozí záznam',
    schedule_changed: 'Změna termínu',
    status_changed: 'Změna stavu',
    cancelled: 'Odstávka zrušena',
    missing_from_source: 'Zmizela ze zdroje',
    content_changed: 'Změna zdrojových dat',
    city_match: 'Shoda města',
    street_match: 'Shoda ulice',
    municipality_exact: 'Přesná shoda města',
    street_exact: 'Přesná shoda ulice',
    address_numbers_exact: 'Přesná shoda čísla domu',
    address_numbers_partial: 'Částečná shoda čísla domu',
    store_address_numbers_missing: 'U prodejny chybí číslo domu',
    source_address_numbers_missing: 'U distributora chybí číslo domu',
    auto_confirmed: 'Automaticky potvrzeno',
    manual_confirmation_required: 'Vyžaduje ruční ověření',
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ')
}

function outageAddressLabel(address: PowerOutageDetail['addresses'][number] | undefined) {
  if (!address) return 'Distributor neuvedl konkrétní adresu.'
  return address.rawAddress
    || [address.street, address.houseNumber, address.orientationNumber, address.municipality]
      .filter(Boolean)
      .join(' ')
    || 'Distributor neuvedl konkrétní adresu.'
}

function matchMethodLabel(detail: PowerOutageDetail) {
  if (detail.matchMethod === 'manual') return 'Ruční přiřazení'
  if (detail.matchReasons.includes('address_numbers_exact')) return 'Město + ulice + číslo domu'
  if (detail.matchReasons.includes('address_numbers_partial')) return 'Město + ulice + částečná shoda čísla'
  return 'Město + ulice, číslo vyžaduje ověření'
}

export function PowerOutageDetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3">
      <span className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</span>
      <span className={`mt-1 block break-words text-[11px] font-semibold leading-5 text-[var(--text-primary)] ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function PowerOutagePopupShell({
  titleId,
  icon,
  eyebrow,
  title,
  onClose,
  children,
  compact = false,
}: {
  titleId: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  onClose: () => void
  children: React.ReactNode
  compact?: boolean
}) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestClose = useModalMotionClose(onClose)
  useBodyScrollLock(true)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !shellRef.current) return
      const focusable = [...shellRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestClose])

  return (
    <div data-modal-motion-root className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/42 p-2.5 backdrop-blur-[4px] sm:p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
      <section ref={shellRef} data-modal-motion-surface role="dialog" aria-modal="true" aria-labelledby={titleId} className={`weather-alerts-popup weather-alerts__surface activities-manual-preview activities-manual-preview--mobile flex max-h-[calc(100dvh-20px)] min-h-0 w-full flex-col overflow-hidden rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_28px_70px_rgba(15,23,42,0.34)] sm:max-h-[calc(100dvh-48px)] ${compact ? 'max-w-[620px]' : 'max-w-[760px]'}`}>
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-[var(--accent)]">{icon}</span>
          <div className="min-w-0 flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{eyebrow}</span>
            <h2 id={titleId} className="mt-1 text-lg font-semibold leading-6 text-[var(--text-primary)] sm:text-xl">{title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít" className="power-outages-popup__close flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:text-[var(--text-primary)]"><X aria-hidden size={18} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

function LoadingDetail() {
  return (
    <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" />
      <strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám kompletní detail…</strong>
    </div>
  )
}

function MatchResolutionPopup({
  detail,
  onClose,
  onChanged,
}: {
  detail: PowerOutageDetail
  onClose: () => void
  onChanged: (status: PowerOutageListItem['matchStatus']) => void
}) {
  const [note, setNote] = useState('')
  const [pendingStatus, setPendingStatus] = useState<PowerOutageListItem['matchStatus'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const matchedAddress = detail.addresses.find((address) => address.id === detail.outageAddressId)
    ?? detail.addresses[0]

  const updateStatus = async (status: PowerOutageListItem['matchStatus']) => {
    if (pendingStatus) return
    setPendingStatus(status)
    setError(null)
    try {
      const response = await fetch(`/api/power-outages/matches/${detail.matchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note: note.trim() || null }),
      })
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || 'Stav shody se nepodařilo uložit.')
      }
      onChanged(status)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Stav shody se nepodařilo uložit.')
      setPendingStatus(null)
    }
  }

  const actionButton = (
    status: PowerOutageListItem['matchStatus'],
    label: string,
    icon: React.ReactNode,
    tone: 'primary' | 'danger' | 'neutral',
  ) => (
    <button
      type="button"
      disabled={Boolean(pendingStatus)}
      onClick={() => void updateStatus(status)}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border px-4 text-[10px] font-bold uppercase tracking-[0.05em] transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-60 ${tone === 'primary'
        ? 'border-emerald-500/40 bg-emerald-500 text-white shadow-[0_10px_24px_rgba(16,185,129,0.2)]'
        : tone === 'danger'
          ? 'border-red-400/35 bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300'
          : 'border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-primary)]'
      }`}
    >
      {pendingStatus === status ? <LoaderCircle aria-hidden size={15} className="animate-spin" /> : icon}
      {label}
    </button>
  )

  return (
    <PowerOutagePopupShell
      titleId={`power-outage-resolution-${detail.matchId}`}
      eyebrow="ODSTÁVKY · OVĚŘENÍ SHODY"
      title={`${detail.store.chainName} · ${detail.store.storeNumber}`}
      icon={<ShieldCheck aria-hidden size={21} />}
      onClose={onClose}
      compact
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
        <p className="text-xs leading-5 text-[var(--text-secondary)]">
          Porovnejte adresu prodejny s adresou uvedenou distributorem. Potvrzené shody mohou vytvářet upozornění.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Prodejna v aplikaci</span>
            <strong className="mt-1.5 block text-xs text-[var(--text-primary)]">{detail.store.address}, {detail.store.city}</strong>
          </div>
          <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Adresa distributora</span>
            <strong className="mt-1.5 block text-xs text-[var(--text-primary)]">
              {matchedAddress?.rawAddress || [matchedAddress?.street, matchedAddress?.municipality].filter(Boolean).join(', ') || 'Neuvedeno'}
            </strong>
          </div>
        </div>
        <label className="mt-4 block">
          <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Poznámka k ověření (volitelná)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 1_000))}
            disabled={Boolean(pendingStatus)}
            rows={3}
            placeholder="Např. ověřeno podle oznámení distributora…"
            className="mt-2 w-full resize-none rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)] disabled:opacity-60"
          />
        </label>
        {error ? <p className="mt-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 [html[data-theme=dark]_&]:text-red-300">{error}</p> : null}
      </div>
      <footer className="grid shrink-0 gap-2 border-t border-[var(--surface-border)] p-4 sm:grid-cols-2 sm:p-5">
        {detail.matchStatus === 'needs_review' ? <>
          {actionButton('confirmed', 'POTVRDIT SHODU', <Check aria-hidden size={15} />, 'primary')}
          {actionButton('dismissed', 'NENÍ TO TATO PRODEJNA', <Ban aria-hidden size={15} />, 'danger')}
        </> : null}
        {detail.matchStatus === 'confirmed'
          ? actionButton('needs_review', 'VRÁTIT K OVĚŘENÍ', <RotateCcw aria-hidden size={15} />, 'neutral')
          : null}
        {detail.matchStatus === 'dismissed'
          ? actionButton('needs_review', 'ZNOVU POSOUDIT', <RotateCcw aria-hidden size={15} />, 'neutral')
          : null}
        <button type="button" disabled={Boolean(pendingStatus)} onClick={onClose} className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50">ZRUŠIT</button>
      </footer>
    </PowerOutagePopupShell>
  )
}

function DetailPopup({ item, detail, loading, error, onClose, onStatusChanged }: { item: PowerOutageListItem; detail: PowerOutageDetail | null; loading: boolean; error: string | null; onClose: () => void; onStatusChanged: (status: PowerOutageListItem['matchStatus']) => void }) {
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const matchedAddress = detail?.addresses.find((address) => address.id === detail.outageAddressId)
    ?? detail?.addresses[0]
  const otherAddresses = detail?.addresses.filter((address) => address.id !== matchedAddress?.id) ?? []

  return (
    <PowerOutagePopupShell titleId={`power-outage-detail-${item.matchId}`} eyebrow="ODSTÁVKY · KOMPLETNÍ DETAIL" title={`${item.store.chainName} · ${item.store.storeNumber}`} icon={<Zap aria-hidden size={21} />} onClose={onClose}>
      {loading ? <LoadingDetail /> : error || !detail ? (
        <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center">
          <CircleAlert aria-hidden size={28} className="text-red-500" />
          <strong className="mt-3 text-sm text-[var(--text-primary)]">Detail se nepodařilo načíst</strong>
          <p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Zdrojová data nejsou dostupná.'}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex h-6 items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 text-[8px] font-bold uppercase text-[var(--accent)]">{sourceName(detail.source)}</span>
            <span className="inline-flex h-6 items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 text-[8px] font-bold uppercase text-[var(--text-secondary)]">{statusLabel(detail.sourceStatus)}</span>
            <span className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[8px] font-bold uppercase ${detail.matchStatus === 'confirmed'
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
              : detail.matchStatus === 'dismissed'
                ? 'border-slate-400/40 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300'
                : 'border-amber-400/40 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
            }`}>{matchLabel(detail.matchStatus)}</span>
          </div>

          <section className="mt-4 rounded-[20px] border border-sky-400/25 bg-sky-500/6 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><MapPin aria-hidden size={16} /></span>
              <span className="min-w-0">
                <strong className="block text-sm text-[var(--text-primary)]">{detail.store.city}</strong>
                <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{detail.store.address}</span>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-sky-400/20 pt-3">
              <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Termín od</small><strong className="mt-1 block text-[11px] tabular-nums text-[var(--text-primary)] sm:text-xs">{formatDateTime(detail.startsAt)}</strong></span>
              <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Termín do</small><strong className="mt-1 block text-[11px] tabular-nums text-[var(--text-primary)] sm:text-xs">{formatDateTime(detail.endsAt)}</strong></span>
            </div>
          </section>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {detail.announcementUrl ? <a href={detail.announcementUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/12 px-4 text-[9px] font-bold uppercase tracking-[0.04em] text-[var(--accent)] transition hover:-translate-y-px hover:bg-sky-500/18"><FileText aria-hidden size={14} /> Oznámení ČEZ (PDF)</a> : null}
            {detail.sourceUrl ? <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 text-[9px] font-bold uppercase tracking-[0.04em] text-[var(--accent)] transition hover:-translate-y-px"><ExternalLink aria-hidden size={14} /> {detail.source === 'cez' ? 'Vyhledat u ČEZ' : 'Otevřít mapu EG.D'}</a> : null}
            <button type="button" onClick={() => setResolutionOpen(true)} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 text-[9px] font-bold uppercase tracking-[0.04em] text-[var(--accent)] transition hover:-translate-y-px sm:col-span-2">
              {detail.matchStatus === 'needs_review' ? <ShieldCheck aria-hidden size={14} /> : <RotateCcw aria-hidden size={14} />}
              {detail.matchStatus === 'needs_review' ? 'Ověřit shodu' : detail.matchStatus === 'confirmed' ? 'Upravit ověření' : 'Znovu posoudit'}
            </button>
          </div>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><SearchCheck aria-hidden size={14} /> Výsledek párování</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Adresa prodejny</span>
                <strong className="mt-1.5 block text-xs leading-5 text-[var(--text-primary)]">{detail.store.city} · {detail.store.address}</strong>
              </div>
              <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/6 p-3.5">
                <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Odpovídající adresa distributora</span>
                <strong className="mt-1.5 block text-xs leading-5 text-[var(--text-primary)]">{outageAddressLabel(matchedAddress)}</strong>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <PowerOutageDetailRow label="Výsledek" value={matchLabel(detail.matchStatus)} />
              <PowerOutageDetailRow label="Metoda" value={matchMethodLabel(detail)} />
              <PowerOutageDetailRow label="Jistota shody" value={`${Math.round(detail.confidence * 100)} %`} />
            </div>
            {detail.matchReasons.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{detail.matchReasons.map((reason) => <span key={reason} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">{reasonLabel(reason)}</span>)}</div> : null}
          </section>

          {otherAddresses.length > 0 ? <details className="mt-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Další dotčené adresy ({otherAddresses.length})</summary>
            <div className="mt-3 flex flex-wrap gap-1.5">{otherAddresses.map((address) => <span key={address.id} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">{outageAddressLabel(address)}</span>)}</div>
          </details> : null}

          <details className="mt-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]"><Database aria-hidden size={14} /> Zdrojová data</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PowerOutageDetailRow label="Název zdroje" value={detail.title} />
              <PowerOutageDetailRow label="Poprvé zachyceno" value={formatDateTime(detail.firstSeenAt)} />
              <PowerOutageDetailRow label="Naposledy potvrzeno" value={formatDateTime(detail.lastSeenAt)} />
              {detail.sourceUpdatedAt ? <PowerOutageDetailRow label="Aktualizováno distributorem" value={formatDateTime(detail.sourceUpdatedAt)} /> : null}
            </div>
            {detail.description ? <p className="mt-2 whitespace-pre-line rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-3.5 text-xs leading-5 text-[var(--text-primary)]">{detail.description}</p> : null}
          </details>

          <details className="mt-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Historie změn ({detail.versions.length + detail.matchAudit.length + detail.informedHistory.length})</summary>
            <div className="mt-3 space-y-2">
              {detail.versions.map((version) => <div key={version.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3.5 py-3"><span className="min-w-0"><strong className="block text-[11px] text-[var(--text-primary)]">Verze {version.versionNumber}</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">{version.changeReasons.length ? version.changeReasons.map(reasonLabel).join(' · ') : 'Aktualizace zdrojového záznamu'}</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(version.createdAt)}</time></div>)}
              {detail.matchAudit.map((audit) => <div key={audit.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3.5 py-3"><span className="min-w-0"><strong className="block text-[11px] text-[var(--text-primary)]">Párování: {matchLabel(audit.previousStatus)} → {matchLabel(audit.nextStatus)}</strong>{audit.note ? <small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">{audit.note}</small> : null}</span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(audit.createdAt)}</time></div>)}
              {detail.informedHistory.map((audit) => <div key={audit.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3.5 py-3"><span className="min-w-0"><strong className="block text-[11px] text-[var(--text-primary)]">Informování: {audit.informed ? 'zákazník informován' : 'označení zrušeno'}</strong>{audit.note ? <small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">{audit.note}</small> : null}</span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(audit.createdAt)}</time></div>)}
              {detail.versions.length === 0 && detail.matchAudit.length === 0 && detail.informedHistory.length === 0 ? <p className="text-xs text-[var(--text-secondary)]">Pro tuto odstávku zatím nebyla zaznamenána změna.</p> : null}
            </div>
          </details>

          <details className="mt-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]"><Link2 aria-hidden size={14} /> Technické údaje</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <PowerOutageDetailRow label="Archivace" value={formatDateTime(detail.archiveAt)} />
              <PowerOutageDetailRow label="Revize prodejen" value={String(detail.storeRevision)} />
              <PowerOutageDetailRow label="Poprvé spárováno" value={formatDateTime(detail.firstMatchedAt)} />
              <PowerOutageDetailRow label="Naposledy ověřeno" value={formatDateTime(detail.lastVerifiedAt)} />
              <PowerOutageDetailRow label="ID shody" value={detail.matchId} mono />
              <PowerOutageDetailRow label="ID odstávky" value={detail.outageId} mono />
              <PowerOutageDetailRow label="ID distributora" value={detail.externalId} mono />
              <PowerOutageDetailRow label="ID prodejny" value={detail.storeId ?? 'Neuvedeno'} mono />
            </div>
          </details>
        </div>
      )}
      {resolutionOpen && detail ? <MatchResolutionPopup detail={detail} onClose={() => setResolutionOpen(false)} onChanged={onStatusChanged} /> : null}
    </PowerOutagePopupShell>
  )
}

function buildAnnouncement(item: PowerOutageListItem) {
  return `Oznámení o plánované odstávce elektřiny

Dobrý den,

dovolujeme si Vás informovat o plánované odstávce elektrické energie, která se týká níže uvedené prodejny.

Řetězec: ${item.store.chainName}
Číslo prodejny: ${item.store.storeNumber}
Adresa: ${item.store.address}, ${item.store.city}
Distributor: ${sourceName(item.source)}
Termín: ${formatDateTime(item.startsAt)} – ${formatDateTime(item.endsAt)}

V uvedeném termínu prosím počítejte s přerušením dodávky elektrické energie.

Děkujeme za součinnost.`
}

function AnnouncementPopup({ item, onClose }: { item: PowerOutageListItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const text = buildAnnouncement(item)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      setCopyError('Text se nepodařilo zkopírovat. Označte jej prosím ručně.')
    }
  }

  return (
    <PowerOutagePopupShell titleId={`power-outage-announcement-${item.matchId}`} eyebrow="ODSTÁVKY" title="Oznámení o odstávce" icon={<FileText aria-hidden size={21} />} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <PowerOutageDetailRow label="Řetězec" value={item.store.chainName} />
          <PowerOutageDetailRow label="Číslo prodejny" value={item.store.storeNumber} />
          <PowerOutageDetailRow label="Distributor" value={sourceName(item.source)} />
          <PowerOutageDetailRow label="Adresa" value={`${item.store.address}, ${item.store.city}`} />
          <PowerOutageDetailRow label="Termín od" value={formatDateTime(item.startsAt)} />
          <PowerOutageDetailRow label="Termín do" value={formatDateTime(item.endsAt)} />
        </div>
        <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4 sm:p-5">
          <pre className="whitespace-pre-wrap font-sans text-xs leading-6 text-[var(--text-primary)] sm:text-sm">{text}</pre>
        </div>
        {copyError ? <p className="mt-2 text-xs font-medium text-red-600 [html[data-theme=dark]_&]:text-red-300">{copyError}</p> : null}
      </div>
      <footer className="shrink-0 border-t border-[var(--surface-border)] p-4 sm:p-5">
        <button type="button" onClick={copy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-xs font-bold uppercase text-white shadow-[0_10px_24px_var(--shadow-medium)] transition hover:-translate-y-px sm:w-auto">
          {copied ? <Check aria-hidden size={16} /> : <Clipboard aria-hidden size={16} />}
          {copied ? 'TEXT ZKOPÍROVÁN' : 'KOPÍROVAT TEXT'}
        </button>
      </footer>
    </PowerOutagePopupShell>
  )
}

export function PowerOutagePopupLayer({
  mode,
  item,
  detail,
  detailLoading,
  detailError,
  onClose,
  onStatusChanged,
}: {
  mode: 'detail' | 'announcement' | null
  item: PowerOutageListItem | null
  detail: PowerOutageDetail | null
  detailLoading: boolean
  detailError: string | null
  onClose: () => void
  onStatusChanged: (status: PowerOutageListItem['matchStatus']) => void
}) {
  if (!mode || !item || typeof document === 'undefined') return null
  return createPortal(
    mode === 'detail'
      ? <DetailPopup item={item} detail={detail} loading={detailLoading} error={detailError} onClose={onClose} onStatusChanged={onStatusChanged} />
      : <AnnouncementPopup item={item} onClose={onClose} />,
    document.body,
  )
}
