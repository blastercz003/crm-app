'use client'

import {
  Check,
  CircleAlert,
  Clipboard,
  Database,
  ExternalLink,
  FileText,
  History,
  Link2,
  MapPin,
  SearchCheck,
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
  } as Record<string, string>)[reason] ?? reason.replaceAll('_', ' ')
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
}: {
  titleId: string
  icon: React.ReactNode
  eyebrow: string
  title: string
  onClose: () => void
  children: React.ReactNode
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
      <section ref={shellRef} data-modal-motion-surface role="dialog" aria-modal="true" aria-labelledby={titleId} className="weather-alerts-popup weather-alerts__surface activities-manual-preview activities-manual-preview--mobile flex max-h-[calc(100dvh-20px)] min-h-0 w-full max-w-[760px] flex-col overflow-hidden rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_28px_70px_rgba(15,23,42,0.34)] sm:max-h-[calc(100dvh-48px)]">
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-400/30 bg-sky-500/10 text-[var(--accent)]">{icon}</span>
          <div className="min-w-0 flex-1">
            <span className="block text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{eyebrow}</span>
            <h2 id={titleId} className="mt-1 text-lg font-semibold leading-6 text-[var(--text-primary)] sm:text-xl">{title}</h2>
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:text-[var(--text-primary)]"><X aria-hidden size={18} /></button>
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

function DetailPopup({ item, detail, loading, error, onClose }: { item: PowerOutageListItem; detail: PowerOutageDetail | null; loading: boolean; error: string | null; onClose: () => void }) {
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
            <span className="inline-flex h-6 items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 text-[8px] font-bold uppercase text-amber-700 [html[data-theme=dark]_&]:text-amber-300">{matchLabel(detail.matchStatus)}</span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <PowerOutageDetailRow label="Řetězec" value={detail.store.chainName} />
            <PowerOutageDetailRow label="Číslo prodejny" value={detail.store.storeNumber} />
            <PowerOutageDetailRow label="Distributor" value={sourceName(detail.source)} />
            <PowerOutageDetailRow label="Termín od" value={formatDateTime(detail.startsAt)} />
            <PowerOutageDetailRow label="Termín do" value={formatDateTime(detail.endsAt)} />
            <PowerOutageDetailRow label="Archivace" value={formatDateTime(detail.archiveAt)} />
          </div>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><MapPin aria-hidden size={14} /> Prodejna a zdrojová oblast</h3>
            <div className="mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
              <strong className="text-sm text-[var(--text-primary)]">{detail.store.address}, {detail.store.city}</strong>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{[detail.municipality, detail.district, detail.region].filter(Boolean).join(' · ') || 'Distributor neuvedl další územní údaje.'}</p>
              {detail.addresses.length > 0 ? <div className="mt-3 flex flex-wrap gap-1.5">{detail.addresses.slice(0, 30).map((address) => <span key={address.id} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">{address.rawAddress || [address.street, address.houseNumber, address.municipality].filter(Boolean).join(' ')}</span>)}</div> : null}
            </div>
          </section>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Database aria-hidden size={14} /> Zdrojová data</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <PowerOutageDetailRow label="Název zdroje" value={detail.title} />
              <PowerOutageDetailRow label="Aktualizováno distributorem" value={formatDateTime(detail.sourceUpdatedAt)} />
              <PowerOutageDetailRow label="Poprvé zachyceno" value={formatDateTime(detail.firstSeenAt)} />
              <PowerOutageDetailRow label="Naposledy potvrzeno" value={formatDateTime(detail.lastSeenAt)} />
            </div>
            {detail.description ? <p className="mt-2 whitespace-pre-line rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5 text-xs leading-5 text-[var(--text-primary)]">{detail.description}</p> : null}
            <div className="mt-2 flex flex-wrap gap-2">
              {detail.sourceUrl ? <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[9px] font-bold uppercase text-[var(--accent)] transition hover:-translate-y-px"><ExternalLink aria-hidden size={13} /> Zdroj distributora</a> : null}
              {detail.announcementUrl ? <a href={detail.announcementUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[9px] font-bold uppercase text-[var(--accent)] transition hover:-translate-y-px"><FileText aria-hidden size={13} /> Zdrojové oznámení</a> : null}
            </div>
          </section>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><SearchCheck aria-hidden size={14} /> Výsledek párování</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <PowerOutageDetailRow label="Výsledek" value={matchLabel(detail.matchStatus)} />
              <PowerOutageDetailRow label="Metoda" value={detail.matchMethod === 'city_street' ? 'Shoda města a ulice' : 'Ruční přiřazení'} />
              <PowerOutageDetailRow label="Jistota shody" value={`${Math.round(detail.confidence * 100)} %`} />
              <PowerOutageDetailRow label="Poprvé spárováno" value={formatDateTime(detail.firstMatchedAt)} />
              <PowerOutageDetailRow label="Naposledy ověřeno" value={formatDateTime(detail.lastVerifiedAt)} />
              <PowerOutageDetailRow label="Revize prodejen" value={String(detail.storeRevision)} />
            </div>
            {detail.matchReasons.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{detail.matchReasons.map((reason) => <span key={reason} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[9px] text-[var(--text-secondary)]">{reasonLabel(reason)}</span>)}</div> : null}
          </section>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Historie změn</h3>
            <div className="mt-2 space-y-2">
              {detail.versions.map((version) => <div key={version.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><span className="min-w-0"><strong className="block text-[11px] text-[var(--text-primary)]">Verze {version.versionNumber}</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">{version.changeReasons.length ? version.changeReasons.map(reasonLabel).join(' · ') : 'Aktualizace zdrojového záznamu'}</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(version.createdAt)}</time></div>)}
              {detail.matchAudit.map((audit) => <div key={audit.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><span className="min-w-0"><strong className="block text-[11px] text-[var(--text-primary)]">Párování: {matchLabel(audit.previousStatus)} → {matchLabel(audit.nextStatus)}</strong>{audit.note ? <small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">{audit.note}</small> : null}</span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(audit.createdAt)}</time></div>)}
              {detail.versions.length === 0 && detail.matchAudit.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Pro tuto odstávku zatím nebyla zaznamenána změna.</p> : null}
            </div>
          </section>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Link2 aria-hidden size={14} /> Technická ID</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <PowerOutageDetailRow label="ID shody" value={detail.matchId} mono />
              <PowerOutageDetailRow label="ID odstávky" value={detail.outageId} mono />
              <PowerOutageDetailRow label="ID distributora" value={detail.externalId} mono />
              <PowerOutageDetailRow label="ID prodejny" value={detail.storeId ?? 'Neuvedeno'} mono />
            </div>
          </section>
        </div>
      )}
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
}: {
  mode: 'detail' | 'announcement' | null
  item: PowerOutageListItem | null
  detail: PowerOutageDetail | null
  detailLoading: boolean
  detailError: string | null
  onClose: () => void
}) {
  if (!mode || !item || typeof document === 'undefined') return null
  return createPortal(
    mode === 'detail'
      ? <DetailPopup item={item} detail={detail} loading={detailLoading} error={detailError} onClose={onClose} />
      : <AnnouncementPopup item={item} onClose={onClose} />,
    document.body,
  )
}
