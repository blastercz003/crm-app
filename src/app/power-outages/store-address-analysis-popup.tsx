'use client'

import { CircleAlert, LoaderCircle, MapPinCheck, SearchCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StoreAddressAnalysisItem } from '@/lib/power-outages/types'
import { PowerOutagePopupShell } from './power-outage-popups'

type AnalysisPayload = {
  ok: boolean
  configured?: boolean
  canAnalyze?: boolean
  items?: StoreAddressAnalysisItem[]
  error?: string
}

const STATUS_LABELS: Record<StoreAddressAnalysisItem['analysisStatus'], string> = {
  pending: 'ČEKÁ NA ANALÝZU',
  suggested: 'NÁVRH OPRAVY',
  needs_review: 'RUČNĚ OVĚŘIT',
  not_found: 'NEDOHLEDÁNO',
  error: 'CHYBA',
}

function statusClass(status: StoreAddressAnalysisItem['analysisStatus']) {
  if (status === 'suggested') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
  if (status === 'needs_review') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
  if (status === 'error') return 'border-red-500/35 bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300'
  return 'border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)]'
}

function confidenceLabel(value: number | null) {
  return value == null ? '—' : `${Math.round(value * 100)} %`
}

export function StoreAddressAnalysisPopup({ onClose }: { onClose: () => void }) {
  const [payload, setPayload] = useState<AnalysisPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chain, setChain] = useState('all')
  const [status, setStatus] = useState<StoreAddressAnalysisItem['analysisStatus'] | 'all'>('all')

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/power-outages/stores/address-analysis', { cache: 'no-store' })
      const next = await response.json().catch(() => null) as AnalysisPayload | null
      if (!response.ok || !next?.ok) throw new Error(next?.error || 'Přehled adres se nepodařilo načíst.')
      setPayload(next)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Přehled adres se nepodařilo načíst.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runAnalysis = async () => {
    if (running) return
    setRunning(true)
    setError(null)
    try {
      const response = await fetch('/api/power-outages/stores/address-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      })
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Analýza adres selhala.')
      await load()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Analýza adres selhala.')
    } finally {
      setRunning(false)
    }
  }

  const items = useMemo(() => payload?.items ?? [], [payload?.items])
  const chains = useMemo(
    () => [...new Set(items.map((item) => item.chainName))].sort((left, right) => left.localeCompare(right, 'cs')),
    [items],
  )
  const filtered = useMemo(() => items.filter((item) => (
    (chain === 'all' || item.chainName === chain)
    && (status === 'all' || item.analysisStatus === status)
  )), [items, chain, status])
  const analyzedCount = items.filter((item) => item.analysisStatus !== 'pending').length
  const suggestedCount = items.filter((item) => item.analysisStatus === 'suggested').length
  const pendingCount = items.filter((item) => item.analysisStatus === 'pending').length

  return (
    <PowerOutagePopupShell
      titleId="store-address-analysis-title"
      icon={<MapPinCheck aria-hidden size={20} />}
      eyebrow="Databáze prodejen"
      title="Diagnostika problematických adres"
      onClose={onClose}
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-3.5 py-3 text-[10px] leading-5 text-[var(--text-secondary)]">
          <strong className="text-[var(--text-primary)]">Bezpečný režim pouze pro čtení.</strong>{' '}
          Mapy.com hledají možnou kanonickou podobu adresy. Výsledky samy nemění data v sekci Prodejny ani párování odstávek.
        </div>

        {loading ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
            <LoaderCircle aria-hidden size={28} className="animate-spin text-[var(--accent)]" />
            <strong className="mt-3 text-xs text-[var(--text-primary)]">Načítám problematické adresy…</strong>
          </div>
        ) : error && !payload ? (
          <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
            <CircleAlert aria-hidden size={28} className="text-red-500" />
            <p className="mt-3 max-w-md text-xs leading-5 text-red-600 [html[data-theme=dark]_&]:text-red-300">{error}</p>
            <button type="button" onClick={() => { setLoading(true); void load() }} className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-[10px] font-bold text-white">ZKUSIT ZNOVU</button>
          </div>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Problematické</span><strong className="mt-1 block text-lg tabular-nums text-[var(--text-primary)]">{items.length}</strong></div>
              <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Analyzováno</span><strong className="mt-1 block text-lg tabular-nums text-[var(--text-primary)]">{analyzedCount}</strong></div>
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-3"><span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Návrh opravy</span><strong className="mt-1 block text-lg tabular-nums text-[var(--text-primary)]">{suggestedCount}</strong></div>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <select value={chain} onChange={(event) => setChain(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none">
                <option value="all">Všechny řetězce</option>
                {chains.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-w-0 flex-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none">
                <option value="all">Všechny výsledky</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              {payload?.canAnalyze ? (
                <button type="button" onClick={() => void runAnalysis()} disabled={running || !payload.configured || pendingCount === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 text-[9px] font-bold tracking-[0.06em] text-sky-700 transition hover:bg-sky-500/15 disabled:cursor-not-allowed disabled:opacity-45 [html[data-theme=dark]_&]:text-sky-300">
                  {running ? <LoaderCircle aria-hidden size={14} className="animate-spin" /> : <SearchCheck aria-hidden size={14} />}
                  {running ? 'ANALYZUJI…' : 'ANALYZOVAT DALŠÍ'}
                </button>
              ) : null}
            </div>

            {!payload?.configured ? <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Na serveru není dostupný MAPY_API_KEY. Lokální a produkční prostředí se nastavují samostatně.</p> : null}
            {error ? <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[10px] text-red-600 [html[data-theme=dark]_&]:text-red-300">{error}</p> : null}

            <div className="mt-4 space-y-2.5">
              {filtered.map((item) => (
                <article key={item.registryId} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <strong className="block text-xs text-[var(--text-primary)]">{item.chainName} · prodejna {item.storeNumber}</strong>
                      <span className="mt-1 block text-[10px] leading-4 text-[var(--text-secondary)]">{item.currentCity} · {item.currentAddress}</span>
                    </div>
                    <span className={`shrink-0 rounded-lg border px-2 py-1 text-[7px] font-bold tracking-[0.06em] ${statusClass(item.analysisStatus)}`}>{STATUS_LABELS[item.analysisStatus]}</span>
                  </div>
                  {item.suggestedAddress || item.suggestedCity ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2.5">
                        <span className="block text-[7px] font-bold uppercase tracking-[0.08em] text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Návrh Mapy.com</span>
                        <strong className="mt-1 block text-[10px] leading-4 text-[var(--text-primary)]">{item.suggestedCity ?? 'Město neuvedeno'} · {item.suggestedAddress ?? 'Adresa neuvedena'}</strong>
                        {item.suggestedLabel ? <small className="mt-0.5 block text-[8px] leading-4 text-[var(--text-secondary)]">{item.suggestedLabel}</small> : null}
                      </div>
                      <span className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 py-2 text-center"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Jistota</small><strong className="mt-0.5 block text-xs tabular-nums text-[var(--text-primary)]">{confidenceLabel(item.confidence)}</strong></span>
                    </div>
                  ) : null}
                  {item.errorMessage ? <p className="mt-2 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{item.errorMessage}</p> : null}
                </article>
              ))}
              {filtered.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-6 text-center text-xs text-[var(--text-secondary)]">Pro zvolený filtr nejsou žádné adresy.</p> : null}
            </div>
          </>
        )}
      </div>
    </PowerOutagePopupShell>
  )
}
