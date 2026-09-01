'use client'

import { Check, CircleAlert, LoaderCircle, MapPinCheck, PencilLine, SearchCheck, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { StoreAddressAnalysisItem, StoreAddressNearbyCandidate } from '@/lib/power-outages/types'
import { PowerOutagePopupShell } from './power-outage-popups'

type AnalysisPayload = { ok: boolean; configured?: boolean; canAnalyze?: boolean; items?: StoreAddressAnalysisItem[]; error?: string }
type EditorState = { registryId: string; city: string; address: string; candidateData: Record<string, unknown>; confirming: boolean }

const STATUS_LABELS: Record<StoreAddressAnalysisItem['analysisStatus'], string> = {
  pending: 'ČEKÁ NA ANALÝZU',
  verified: 'ADRESA OVĚŘENA',
  normalization: 'NÁVRH NORMALIZACE',
  needs_review: 'RUČNĚ OVĚŘIT',
  insufficient: 'NEDOSTATEČNÁ ADRESA',
  not_found: 'NEDOHLEDÁNO',
  error: 'CHYBA',
}

function statusClass(status: StoreAddressAnalysisItem['analysisStatus']) {
  if (status === 'verified') return 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
  if (status === 'normalization') return 'border-sky-500/35 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'
  if (status === 'needs_review') return 'border-amber-500/40 bg-amber-500/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
  if (status === 'insufficient') return 'border-violet-500/40 bg-violet-500/10 text-violet-700 [html[data-theme=dark]_&]:text-violet-300'
  if (status === 'error') return 'border-red-500/35 bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300'
  return 'border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)]'
}
function confidenceLabel(value: number | null) { return value == null ? '—' : `${Math.round(value * 100)} %` }
function distanceLabel(value: number) { return value < 1_000 ? `${value} m` : `${(value / 1_000).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} km` }

export function StoreAddressAnalysisPopup({ onClose }: { onClose: () => void }) {
  const [payload, setPayload] = useState<AnalysisPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [chain, setChain] = useState('all')
  const [status, setStatus] = useState<StoreAddressAnalysisItem['analysisStatus'] | 'all'>('all')
  const [editor, setEditor] = useState<EditorState | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/power-outages/stores/address-analysis', { cache: 'no-store' })
      const next = await response.json().catch(() => null) as AnalysisPayload | null
      if (!response.ok || !next?.ok) throw new Error(next?.error || 'Přehled adres se nepodařilo načíst.')
      setPayload(next)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Přehled adres se nepodařilo načíst.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const runAnalysis = async () => {
    if (running) return
    setRunning(true); setError(null); setSuccess(null)
    try {
      const response = await fetch('/api/power-outages/stores/address-analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 10 }) })
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Analýza adres selhala.')
      await load()
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Analýza adres selhala.') }
    finally { setRunning(false) }
  }

  const items = useMemo(() => payload?.items ?? [], [payload?.items])
  const chains = useMemo(() => [...new Set(items.map((item) => item.chainName))].sort((a, b) => a.localeCompare(b, 'cs')), [items])
  const filtered = useMemo(() => items.filter((item) => (chain === 'all' || item.chainName === chain) && (status === 'all' || item.analysisStatus === status)), [items, chain, status])
  const analyzedCount = items.filter((item) => item.analysisStatus !== 'pending').length
  const actionableCount = items.filter((item) => ['normalization', 'needs_review', 'insufficient'].includes(item.analysisStatus)).length
  const pendingCount = items.filter((item) => item.analysisStatus === 'pending').length

  const openEditor = (item: StoreAddressAnalysisItem) => setEditor({ registryId: item.registryId, city: item.currentCity, address: item.currentAddress, candidateData: { source: 'manual' }, confirming: false })
  const selectPrimary = (item: StoreAddressAnalysisItem) => setEditor({ registryId: item.registryId, city: item.suggestedCity ?? item.currentCity, address: item.suggestedAddress ?? item.currentAddress, candidateData: { source: 'mapy-geocode', longitude: item.longitude, latitude: item.latitude }, confirming: false })
  const selectNearby = (item: StoreAddressAnalysisItem, candidate: StoreAddressNearbyCandidate) => setEditor({ registryId: item.registryId, city: candidate.city, address: candidate.address, candidateData: { source: 'mapy-nearby-poi', ...candidate }, confirming: false })

  const saveCorrection = async (item: StoreAddressAnalysisItem) => {
    if (!editor || saving) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      const response = await fetch(`/api/power-outages/stores/address-analysis/${item.registryId}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedFingerprint: item.addressFingerprint, city: editor.city, address: editor.address, suggestionId: item.suggestionId, candidateData: editor.candidateData }),
      })
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Opravu adresy se nepodařilo uložit.')
      setEditor(null)
      setSuccess(`${item.chainName} · prodejna ${item.storeNumber}: adresa byla opravena a zařazena do nové kontroly.`)
      await load()
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : 'Opravu adresy se nepodařilo uložit.') }
    finally { setSaving(false) }
  }

  return (
    <PowerOutagePopupShell titleId="store-address-analysis-title" icon={<MapPinCheck aria-hidden size={20} />} eyebrow="Databáze prodejen" title="Diagnostika problematických adres" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <div className="rounded-2xl border border-sky-500/25 bg-sky-500/8 px-3.5 py-3 text-[10px] leading-5 text-[var(--text-secondary)]">
          Mapy.com hledají kanonickou adresu a stejné prodejny řetězce v okolí. <strong className="text-[var(--text-primary)]">Bez ručního potvrzení se v sekci Prodejny nic nezmění.</strong>
        </div>
        {loading ? <div className="flex min-h-[280px] flex-col items-center justify-center text-center"><LoaderCircle aria-hidden size={28} className="animate-spin text-[var(--accent)]" /><strong className="mt-3 text-xs text-[var(--text-primary)]">Načítám problematické adresy…</strong></div>
        : error && !payload ? <div className="flex min-h-[280px] flex-col items-center justify-center text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><p className="mt-3 max-w-md text-xs leading-5 text-red-600 [html[data-theme=dark]_&]:text-red-300">{error}</p><button type="button" onClick={() => { setLoading(true); void load() }} className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-[10px] font-bold text-white">ZKUSIT ZNOVU</button></div>
        : <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[['Problematické', items.length], ['Analyzováno', analyzedCount], ['K rozhodnutí', actionableCount]].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><span className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{label}</span><strong className="mt-1 block text-lg tabular-nums text-[var(--text-primary)]">{value}</strong></div>)}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select value={chain} onChange={(event) => setChain(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none"><option value="all">Všechny řetězce</option>{chains.map((value) => <option key={value} value={value}>{value}</option>)}</select>
            <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="min-w-0 flex-1 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-[10px] font-semibold text-[var(--text-primary)] outline-none"><option value="all">Všechny výsledky</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {payload?.canAnalyze ? <button type="button" onClick={() => void runAnalysis()} disabled={running || !payload.configured || pendingCount === 0} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sky-500/35 bg-sky-500/10 px-4 text-[9px] font-bold tracking-[0.06em] text-sky-700 disabled:opacity-45 [html[data-theme=dark]_&]:text-sky-300">{running ? <LoaderCircle aria-hidden size={14} className="animate-spin" /> : <SearchCheck aria-hidden size={14} />}{running ? 'ANALYZUJI…' : 'ANALYZOVAT DALŠÍ'}</button> : null}
          </div>
          {!payload?.configured ? <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-[10px] text-amber-700">Na serveru není dostupný MAPY_API_KEY.</p> : null}
          {error ? <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-[10px] text-red-600">{error}</p> : null}
          {success ? <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-[10px] text-emerald-700">{success}</p> : null}
          <div className="mt-4 space-y-2.5">
            {filtered.map((item) => {
              const editing = editor?.registryId === item.registryId
              const hasPrimary = Boolean(item.suggestedCity && item.suggestedAddress)
              return <article key={item.registryId} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block text-xs text-[var(--text-primary)]">{item.chainName} · prodejna {item.storeNumber}</strong><span className="mt-1 block text-[10px] leading-4 text-[var(--text-secondary)]">{item.currentCity} · {item.currentAddress}</span></div><span className={`shrink-0 rounded-lg border px-2 py-1 text-[7px] font-bold tracking-[0.06em] ${statusClass(item.analysisStatus)}`}>{STATUS_LABELS[item.analysisStatus]}</span></div>
                {hasPrimary ? <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-stretch"><button type="button" disabled={!payload?.canAnalyze} onClick={() => selectPrimary(item)} className="rounded-xl border border-sky-500/25 bg-sky-500/8 px-3 py-2.5 text-left disabled:cursor-default"><span className="block text-[7px] font-bold uppercase tracking-[0.08em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300">Návrh adresy Mapy.com</span><strong className="mt-1 block text-[10px] leading-4 text-[var(--text-primary)]">{item.suggestedCity} · {item.suggestedAddress}</strong>{item.suggestedLabel ? <small className="mt-0.5 block text-[8px] leading-4 text-[var(--text-secondary)]">{item.suggestedLabel}</small> : null}</button><span className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 py-2 text-center"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Jistota</small><strong className="mt-0.5 block text-xs tabular-nums text-[var(--text-primary)]">{confidenceLabel(item.confidence)}</strong></span></div> : null}
                {item.nearbyCandidates.length > 0 ? <div className="mt-2"><span className="text-[7px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Prodejny stejného řetězce v okolí</span><div className="mt-1.5 grid gap-1.5">{item.nearbyCandidates.map((candidate) => <button key={candidate.id} type="button" disabled={!payload?.canAnalyze} onClick={() => selectNearby(item, candidate)} className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/8 px-3 py-2 text-left"><span className="min-w-0"><strong className="block truncate text-[9px] text-[var(--text-primary)]">{candidate.poiName} · {candidate.city}, {candidate.address}</strong>{candidate.label ? <small className="block truncate text-[8px] text-[var(--text-secondary)]">{candidate.label}</small> : null}</span><span className="shrink-0 text-[8px] font-bold text-violet-700 [html[data-theme=dark]_&]:text-violet-300">{distanceLabel(candidate.distanceMeters)}</span></button>)}</div></div> : null}
                {item.errorMessage ? <p className="mt-2 text-[9px] leading-4 text-red-600">{item.errorMessage}</p> : null}
                {payload?.canAnalyze && !editing ? <button type="button" onClick={() => openEditor(item)} className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[8px] font-bold text-sky-700 [html[data-theme=dark]_&]:text-sky-300"><PencilLine aria-hidden size={12} />PROVĚŘIT A UPRAVIT</button> : null}
                {editing && editor ? <div className="mt-3 rounded-xl border border-sky-500/30 bg-[var(--surface-strong)] p-3">
                  {!editor.confirming ? <><div className="grid gap-2 sm:grid-cols-2"><label className="text-[8px] font-bold uppercase text-[var(--text-secondary)]">Město<input value={editor.city} onChange={(event) => setEditor({ ...editor, city: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-medium normal-case text-[var(--text-primary)] outline-none" /></label><label className="text-[8px] font-bold uppercase text-[var(--text-secondary)]">Ulice a číslo<input value={editor.address} onChange={(event) => setEditor({ ...editor, address: event.target.value })} className="mt-1 block w-full rounded-lg border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] font-medium normal-case text-[var(--text-primary)] outline-none" /></label></div><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditor(null)} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-[8px] font-bold text-[var(--text-secondary)]"><X size={12} />ZRUŠIT</button><button type="button" disabled={!editor.city.trim() || !editor.address.trim() || (editor.city.trim() === item.currentCity && editor.address.trim() === item.currentAddress)} onClick={() => setEditor({ ...editor, confirming: true })} className="rounded-lg bg-sky-500 px-3 py-2 text-[8px] font-bold text-white disabled:opacity-40">ZKONTROLOVAT ZMĚNU</button></div></>
                  : <><span className="text-[8px] font-bold uppercase text-[var(--text-secondary)]">Před uložením zkontrolujte změnu</span><div className="mt-2 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-[var(--surface-border)] p-2"><small className="text-[7px] font-bold uppercase text-[var(--text-secondary)]">Původně</small><p className="mt-1 text-[9px] text-[var(--text-primary)]">{item.currentCity} · {item.currentAddress}</p></div><div className="rounded-lg border border-emerald-500/30 bg-emerald-500/8 p-2"><small className="text-[7px] font-bold uppercase text-emerald-700">Nově</small><p className="mt-1 text-[9px] text-[var(--text-primary)]">{editor.city.trim()} · {editor.address.trim()}</p></div></div><p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">Potvrzení změní pouze tuto prodejnu, zapíše audit a zařadí adresu do nové kontroly.</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setEditor({ ...editor, confirming: false })} className="rounded-lg px-3 py-2 text-[8px] font-bold text-[var(--text-secondary)]">ZPĚT</button><button type="button" disabled={saving} onClick={() => void saveCorrection(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[8px] font-bold text-white disabled:opacity-50">{saving ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}POTVRDIT OPRAVU</button></div></>}
                </div> : null}
              </article>
            })}
            {filtered.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-6 text-center text-xs text-[var(--text-secondary)]">Pro zvolený filtr nejsou žádné adresy.</p> : null}
          </div>
        </>}
      </div>
    </PowerOutagePopupShell>
  )
}
