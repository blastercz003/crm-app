'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  analyzeStoresImportAction,
  importStoresFromWorkbookAction,
  type AnalyzeStoresImportResult,
} from './actions'

const CHAIN_OPTIONS = ['PENNY MARKET', 'LIDL', 'ALBERT', 'BILLA'] as const

type StoresImportModalProps = {
  isOpen: boolean
  onClose: () => void
}

const emptyAnalysis: AnalyzeStoresImportResult = {
  success: false,
  error: null,
  headers: [],
  totalRows: 0,
  validCount: 0,
  invalidCount: 0,
  invalidRows: [],
}

export function StoresImportModal({
  isOpen,
  onClose,
}: StoresImportModalProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedChain, setSelectedChain] = useState<(typeof CHAIN_OPTIONS)[number]>('PENNY MARKET')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [analysis, setAnalysis] = useState<AnalyzeStoresImportResult>(emptyAnalysis)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [replaceEntireChain, setReplaceEntireChain] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [isImporting, startImportTransition] = useTransition()

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending && !isImporting) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isImporting, isOpen, isPending, onClose])

  function handleFileChange(file: File | null) {
    setSelectedFile(file)
    setAnalysis(emptyAnalysis)
    setSuccessMessage(null)
  }

  function buildFormData() {
    if (!selectedFile) return null

    const formData = new FormData()
    formData.set('chain_name', selectedChain)
    formData.set('file', selectedFile)
    formData.set('replace_entire_chain', replaceEntireChain ? 'true' : 'false')
    return formData
  }

  function analyzeFile() {
    const formData = buildFormData()

    if (!formData) {
      setAnalysis({
        ...emptyAnalysis,
        success: false,
        error: 'Vyber soubor pro analýzu.',
      })
      return
    }

    setSuccessMessage(null)

    startTransition(async () => {
      const result = await analyzeStoresImportAction(formData)
      setAnalysis(result)
    })
  }

  function importRows() {
    const formData = buildFormData()

    if (!formData) {
      setAnalysis({
        ...emptyAnalysis,
        success: false,
        error: 'Vyber soubor pro import.',
      })
      return
    }

    const missingCount = analysis.missingCount ?? 0
    if (
      replaceEntireChain
      && missingCount > 0
      && !window.confirm(
        `Nový soubor neobsahuje ${missingCount} současných prodejen řetězce ${selectedChain}. Po synchronizaci budou odstraněny. Pokračovat?`,
      )
    ) {
      return
    }

    startImportTransition(async () => {
      const result = await importStoresFromWorkbookAction(formData)
      setAnalysis(result)

      if (!result.success) {
        return
      }

      setSuccessMessage([
        `Importováno záznamů: ${result.importedCount}.`,
        replaceEntireChain ? `Odstraněno neaktuálních: ${result.removedCount}.` : '',
        result.matchingStatus === 'completed'
          ? 'Párování odstávek bylo aktualizováno.'
          : result.matchingStatus === 'already_running'
            ? 'Přepočet již probíhá na pozadí.'
            : 'Přepočet převezme následující automatický běh.',
      ].filter(Boolean).join(' '))
      router.refresh()
    })
  }

  if (!isOpen || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending && !isImporting) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center">
        <div className="stores-page__modal flex max-h-[calc(100vh-2rem)] w-full max-w-[980px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <ModalHeading section="PRODEJNY" title="Import prodejen" />

              <button
                type="button"
                onClick={onClose}
                disabled={isPending || isImporting}
                className="stores-page__modal-close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-6">
            <div className="stores-page__field-panel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="stores-page__rules-box mb-4 flex flex-col gap-3 rounded-2xl border border-[#8dbfe0]/55 bg-[#2980B9]/8 p-4 text-sm text-[#1e5f8c] sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2a6f9f]/80">
                    Šablona a pravidla
                  </div>
                  <p>
                    Použij jeden `.xlsx` soubor pro jeden řetězec. Povinná pole jsou
                    `chain_name`, `store_number`, `city`, `phone_1`.
                  </p>
                </div>

                <a
                  href="/prodejny/import-template"
                  className="stores-page__import-button inline-flex h-10 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.24)] transition duration-200 hover:-translate-y-[1px] whitespace-nowrap"
                >
                  STÁHNOUT ŠABLONU
                </a>
              </div>

              <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto_auto] md:items-end">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Řetězec
                  </label>
                  <select
                    value={selectedChain}
                    onChange={(event) => {
                      setSelectedChain(event.target.value as (typeof CHAIN_OPTIONS)[number])
                      setAnalysis(emptyAnalysis)
                      setSuccessMessage(null)
                    }}
                    disabled={isPending || isImporting}
                    className="stores-page__field-input h-10 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                  >
                    {CHAIN_OPTIONS.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Soubor
                  </label>
                  <label className="stores-page__field-input relative flex h-10 w-full cursor-pointer items-center rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 py-2 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 hover:-translate-y-[1px]">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      disabled={isPending || isImporting}
                      onChange={(event) =>
                        handleFileChange(event.target.files?.[0] ?? null)
                      }
                      className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <span className="block w-full truncate">
                      {selectedFile?.name ?? 'Vyber soubor .xlsx'}
                    </span>
                  </label>
                </div>

                <button
                  type="button"
                  onClick={analyzeFile}
                  disabled={!selectedFile || isPending || isImporting}
                  className="stores-page__secondary-button inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-semibold uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'ANALYZUJI...' : 'ANALYZOVAT'}
                </button>

                <button
                  type="button"
                  onClick={importRows}
                  disabled={
                    !selectedFile ||
                    isPending ||
                    isImporting ||
                    !analysis.success ||
                    analysis.validCount === 0 ||
                    (replaceEntireChain && analysis.invalidCount > 0)
                  }
                  className="stores-page__primary-button inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isImporting
                    ? 'IMPORTUJI...'
                    : replaceEntireChain
                      ? 'SYNCHRONIZOVAT ŘETĚZEC'
                      : 'IMPORTOVAT VALIDNÍ'}
                </button>
              </div>

              <label className="stores-page__rules-box mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-[#8dbfe0]/55 bg-[#2980B9]/8 px-4 py-3 text-sm text-[#1e5f8c]">
                <input
                  type="checkbox"
                  checked={replaceEntireChain}
                  onChange={(event) => setReplaceEntireChain(event.target.checked)}
                  disabled={isPending || isImporting}
                  className="mt-0.5 h-4 w-4 rounded border-[#76a9d3] text-[#2980B9]"
                />
                <span>
                  <strong>Nahradit celý řetězec obsahem souboru.</strong>{' '}
                  Prodejny, které v bezchybném souboru chybí, budou po importu odstraněny.
                  Pokud soubor obsahuje chybný řádek, úplná synchronizace se bezpečně zablokuje.
                </span>
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {analysis.error ? (
              <div className="stores-page__error mb-4 rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
                {analysis.error}
              </div>
            ) : null}

            {successMessage ? (
              <div className="stores-page__success mb-4 rounded-2xl border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(236,253,245,0.82)_100%)] px-4 py-3 text-sm text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(5,150,105,0.14)]">
                {successMessage}
              </div>
            ) : null}

            {analysis.success ? (
              <div className="mb-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="Načteno řádků" value={analysis.totalRows} />
                  <SummaryCard label="Validních" value={analysis.validCount} tone="success" />
                  <SummaryCard label="Chybných" value={analysis.invalidCount} tone="danger" />
                  <SummaryCard label="Vybraný řetězec" value={selectedChain} />
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <SummaryCard label="Nyní v databázi" value={analysis.existingCount ?? 0} />
                  <SummaryCard label="Nových" value={analysis.newCount ?? 0} />
                  <SummaryCard label="Změněných adres" value={analysis.changedCount ?? 0} />
                  <SummaryCard
                    label={replaceEntireChain ? 'K odstranění' : 'Chybí v souboru'}
                    value={analysis.missingCount ?? 0}
                    tone={replaceEntireChain && (analysis.missingCount ?? 0) > 0 ? 'danger' : 'neutral'}
                  />
                </div>
              </div>
            ) : (
              <div className="stores-page__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-6 text-center text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                Vyber řetězec, nahraj soubor a spusť analýzu importu.
              </div>
            )}

            {analysis.success && analysis.invalidRows.length > 0 ? (
              <div className="stores-page__card rounded-[24px] border border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)]">
                <h3 className="text-base font-semibold text-gray-900">Chybné řádky</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Tyto řádky nebudou naimportovány. Validní řádky můžeš importovat i tak.
                </p>

                <div className="mt-4 space-y-3">
                  {analysis.invalidRows.map((row) => (
                    <div
                      key={row.rowNumber}
                      className="rounded-2xl border border-red-200/85 bg-red-50/70 px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-red-700">
                        Řádek {row.rowNumber}
                      </div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
                        {row.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                      <div className="mt-3 text-xs text-red-600">
                        {[
                          row.raw.chain_name && `chain_name: ${row.raw.chain_name}`,
                          row.raw.store_number && `store_number: ${row.raw.store_number}`,
                          row.raw.city && `city: ${row.raw.city}`,
                          row.raw.address && `address: ${row.raw.address}`,
                          row.raw.phone_1 && `phone_1: ${row.raw.phone_1}`,
                        ]
                          .filter(Boolean)
                          .join(' | ') || 'Řádek neobsahuje čitelná data.'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function SummaryCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'neutral' | 'success' | 'danger'
}) {
  const className =
    tone === 'success'
      ? 'border-emerald-500/80 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_22px_rgba(16,185,129,0.24)]'
      : tone === 'danger'
        ? 'border-red-500/80 bg-[linear-gradient(155deg,#e85b64_0%,#dc2626_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_22px_rgba(220,38,38,0.24)]'
        : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'

  const labelClassName = tone === 'neutral' ? 'text-zinc-500' : 'text-current/80'

  return (
    <div className={`rounded-2xl border px-4 py-3 ${className}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelClassName}`}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-current">
        {value}
      </div>
    </div>
  )
}
