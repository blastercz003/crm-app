'use client'

import { memo, useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  deleteReceivedInvoiceAction,
  getReceivedInvoiceDownloadUrlAction,
  getReceivedInvoicePreviewUrlAction,
  getReceivedInvoicesAction,
  setReceivedInvoiceDueDateAction,
  toggleReceivedInvoiceStatusAction,
  uploadMultipleReceivedInvoicesAction,
  uploadSingleReceivedInvoiceAction,
} from '@/app/dashboard/received-invoices-actions'
import type { ReceivedInvoiceFilter, ReceivedInvoiceRow } from '@/lib/received-invoices/types'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import Image from 'next/image'

type ModeKey = 'upload' | 'view'
type MobileViewPanel = 'list' | 'preview'

const FILTERS: Array<{ key: ReceivedInvoiceFilter; label: string }> = [
  { key: 'all', label: 'Vše' },
  { key: 'unpaid', label: 'Nezaplaceno' },
  { key: 'paid', label: 'Zaplaceno' },
]

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatDate(value: string | null) {
  if (!value) return 'Bez splatnosti'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeZone: 'Europe/Prague',
  }).format(new Date(`${value}T00:00:00`))
}

function isImageMimeType(mimeType: string) {
  return String(mimeType ?? '').toLowerCase().startsWith('image/')
}

const InvoicePreviewPane = memo(function InvoicePreviewPane({
  previewUrl,
  mimeType,
  fileName,
}: {
  previewUrl: string | null
  mimeType: string
  fileName: string
}) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/75 bg-white/85">
      {previewUrl ? (
        isImageMimeType(mimeType) ? (
          <Image
            src={previewUrl}
            alt={fileName}
            width={1400}
            height={1800}
            className="h-full w-full object-contain"
          />
        ) : (
          <iframe
            src={previewUrl}
            title={fileName}
            className="h-full w-full"
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-zinc-500">
          Náhled není dostupný.
        </div>
      )}
    </div>
  )
})

export function ReceivedInvoicesModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [rows, setRows] = useState<ReceivedInvoiceRow[]>([])
  const [filter, setFilter] = useState<ReceivedInvoiceFilter>('unpaid')
  const [mode, setMode] = useState<ModeKey>('view')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [singleDueDate, setSingleDueDate] = useState('')
  const [singleFile, setSingleFile] = useState<File | null>(null)
  const [multipleFiles, setMultipleFiles] = useState<File[]>([])
  const [dueDateDraft, setDueDateDraft] = useState('')
  const [mobileViewPanel, setMobileViewPanel] = useState<MobileViewPanel>('list')

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return

    startTransition(async () => {
      setError(null)
      const result = await getReceivedInvoicesAction(filter)
      if (!result.success) {
        setRows([])
        setSelectedId(null)
        setPreviewUrl(null)
        setError(result.error ?? 'Nepodařilo se načíst faktury.')
        return
      }

      const nextRows = result.rows
      setRows(nextRows)

      let computedNextSelected: string | null = null
      setSelectedId((previousSelected) => {
        computedNextSelected =
          previousSelected && nextRows.some((row) => row.id === previousSelected)
            ? previousSelected
            : (nextRows[0]?.id ?? null)
        return computedNextSelected
      })
      const nextSelectedInvoice =
        nextRows.find((row) => row.id === computedNextSelected) ?? null
      setDueDateDraft(nextSelectedInvoice?.due_date ?? '')
      setMobileViewPanel(computedNextSelected ? 'preview' : 'list')
      if (!computedNextSelected) {
        setPreviewUrl(null)
      }
    })
  }, [filter, isOpen])

  const selectedInvoice = useMemo(() => {
    return rows.find((row) => row.id === selectedId) ?? null
  }, [rows, selectedId])
  const selectedInvoiceId = selectedInvoice?.id ?? null

  useEffect(() => {
    if (!selectedInvoiceId) return

    startTransition(async () => {
      const result = await getReceivedInvoicePreviewUrlAction(selectedInvoiceId)
      if (!result.success) {
        setPreviewUrl(null)
        setError(result.error ?? 'Nepodařilo se načíst náhled.')
        return
      }

      setPreviewUrl(result.signedUrl)
    })
  }, [selectedInvoiceId])

  function refreshData() {
    startTransition(async () => {
      const result = await getReceivedInvoicesAction(filter)
      if (!result.success) {
        setError(result.error ?? 'Nepodařilo se načíst faktury.')
        return
      }

      setRows(result.rows)

      if (!selectedId && result.rows.length > 0) {
        const next = result.rows[0]
        setSelectedId(next.id)
        setDueDateDraft(next.due_date ?? '')
      } else if (
        selectedId &&
        result.rows.length > 0 &&
        !result.rows.some((row) => row.id === selectedId)
      ) {
        const next = result.rows[0]
        setSelectedId(next.id)
        setDueDateDraft(next.due_date ?? '')
      } else if (result.rows.length === 0) {
        setSelectedId(null)
        setPreviewUrl(null)
        setDueDateDraft('')
      }
    })
  }

  function updateRowLocally(nextRow: ReceivedInvoiceRow) {
    const activeFilter = filter

    setRows((current) => {
      const replaced = current.map((row) => (row.id === nextRow.id ? nextRow : row))
      const withInserted = replaced.some((row) => row.id === nextRow.id)
        ? replaced
        : [nextRow, ...replaced]

      if (activeFilter === 'unpaid') {
        return withInserted.filter((row) => row.status === 'unpaid')
      }
      if (activeFilter === 'paid') {
        return withInserted.filter((row) => row.status === 'paid')
      }
      return withInserted
    })

    if (
      selectedId === nextRow.id &&
      ((activeFilter === 'unpaid' && nextRow.status !== 'unpaid') ||
        (activeFilter === 'paid' && nextRow.status !== 'paid'))
    ) {
      setSelectedId((current) => (current === nextRow.id ? null : current))
      setPreviewUrl(null)
    }
  }

  function handleSingleUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!singleFile) {
      setError('Vyber soubor pro nahrání.')
      return
    }

    if (!singleDueDate) {
      setError('U jednoho souboru je datum splatnosti povinné.')
      return
    }

    const formData = new FormData()
    formData.set('file', singleFile)
    formData.set('due_date', singleDueDate)

    startTransition(async () => {
      setError(null)
      const result = await uploadSingleReceivedInvoiceAction(formData)
      if (!result.success) {
        setError(result.error ?? 'Nahrání souboru selhalo.')
        return
      }

      setSingleFile(null)
      setSingleDueDate('')
      setMode('view')
      refreshData()
    })
  }

  function handleMultiUploadSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (multipleFiles.length === 0) {
      setError('Vyber alespoň jeden soubor.')
      return
    }

    const formData = new FormData()
    for (const file of multipleFiles) {
      formData.append('files', file)
    }

    startTransition(async () => {
      setError(null)
      const result = await uploadMultipleReceivedInvoicesAction(formData)
      if (!result.success) {
        setError(result.error ?? 'Nahrání souborů selhalo.')
        return
      }

      setMultipleFiles([])
      setMode('view')
      refreshData()
    })
  }

  function handleDelete() {
    if (!selectedInvoice) return
    const confirmed = window.confirm(`Opravdu smazat soubor "${selectedInvoice.file_name}"?`)
    if (!confirmed) return

    startTransition(async () => {
      setError(null)
      const result = await deleteReceivedInvoiceAction(selectedInvoice.id)
      if (!result.success) {
        setError(result.error ?? 'Smazání faktury selhalo.')
        return
      }

      refreshData()
    })
  }

  function handleToggleStatus(nextStatus: 'unpaid' | 'paid') {
    if (!selectedInvoice) return

    startTransition(async () => {
      setError(null)
      const result = await toggleReceivedInvoiceStatusAction(selectedInvoice.id, nextStatus)
      if (!result.success) {
        setError(result.error ?? 'Změna stavu selhala.')
        return
      }

      if (result.row) {
        updateRowLocally(result.row)
      } else {
        refreshData()
      }
    })
  }

  function handleSaveDueDate() {
    if (!selectedInvoice) return

    startTransition(async () => {
      setError(null)
      const result = await setReceivedInvoiceDueDateAction(
        selectedInvoice.id,
        dueDateDraft.trim() ? dueDateDraft.trim() : null
      )
      if (!result.success) {
        setError(result.error ?? 'Uložení splatnosti selhalo.')
        return
      }

      if (result.row) {
        updateRowLocally(result.row)
      } else {
        refreshData()
      }
    })
  }

  function handleDownload() {
    if (!selectedInvoice) return

    startTransition(async () => {
      const result = await getReceivedInvoiceDownloadUrlAction(selectedInvoice.id)
      if (!result.success || !result.signedUrl) {
        setError(result.error ?? 'Nepodařilo se získat odkaz ke stažení.')
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="fixed inset-0 z-[100] bg-zinc-950/38 backdrop-blur-[3.5px] supports-[backdrop-filter]:backdrop-blur-[3.5px]"
      />
      <div
        className="fixed inset-0 z-[101] overflow-y-auto p-4 sm:p-4"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          className="flex min-h-full items-start justify-center py-4 sm:items-center sm:py-4"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
        <div
          className="relative flex w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-zinc-200/86 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_55%,rgba(236,243,249,0.74)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            height:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/70 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Přijaté faktury
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
            <aside className="min-h-0 border-b border-white/70 p-4 lg:border-b-0 lg:border-r lg:border-white/70">
              <div className="mb-3 grid grid-cols-2 gap-2">
                  <button
                  type="button"
                  onClick={() => {
                    setMode('upload')
                  }}
                  className={`inline-flex h-9 items-center justify-center rounded-xl border text-xs font-semibold uppercase transition ${
                    mode === 'upload'
                      ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)]'
                      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                  }`}
                >
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('view')
                    setMobileViewPanel(selectedInvoice ? 'preview' : 'list')
                  }}
                  className={`inline-flex h-9 items-center justify-center rounded-xl border text-xs font-semibold uppercase transition ${
                    mode === 'view'
                      ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)]'
                      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                  }`}
                >
                  View
                </button>
              </div>

              {mode === 'upload' ? (
                <div className="space-y-4 lg:mx-auto lg:w-full lg:max-w-[760px]">
                  <form onSubmit={handleSingleUploadSubmit} className="space-y-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
                    <div className="text-xs font-semibold uppercase text-zinc-500">Jeden soubor</div>
                    <label
                      htmlFor="received-invoice-single-file"
                      className="group relative flex min-h-[64px] cursor-pointer items-center justify-center rounded-xl border border-[#8dbfe0]/65 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(237,246,252,0.9)_100%)] px-3 py-3 text-sm text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(41,128,185,0.12)] transition duration-200 hover:-translate-y-[1px] hover:border-[#6fa9d1] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_12px_22px_rgba(41,128,185,0.18)]"
                    >
                      <input
                        id="received-invoice-single-file"
                        type="file"
                        accept=".pdf,image/*,application/pdf"
                        onChange={(event) => setSingleFile(event.target.files?.[0] ?? null)}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#236f9f]">
                        Klikni pro výběr souboru
                      </div>
                    </label>
                    {singleFile ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                        Vybráno: <span className="font-medium">{singleFile.name}</span>
                      </div>
                    ) : null}
                    <input
                      type="date"
                      value={singleDueDate}
                      onChange={(event) => setSingleDueDate(event.target.value)}
                      className="h-10 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    />
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:opacity-60"
                    >
                      Nahrát se splatností
                    </button>
                  </form>

                  <form onSubmit={handleMultiUploadSubmit} className="space-y-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
                    <div className="text-xs font-semibold uppercase text-zinc-500">Více souborů</div>
                    <label
                      htmlFor="received-invoice-multi-file"
                      className="group relative flex min-h-[64px] cursor-pointer items-center justify-center rounded-xl border border-[#8dbfe0]/65 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(237,246,252,0.9)_100%)] px-3 py-3 text-sm text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(41,128,185,0.12)] transition duration-200 hover:-translate-y-[1px] hover:border-[#6fa9d1] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_12px_22px_rgba(41,128,185,0.18)]"
                    >
                      <input
                        id="received-invoice-multi-file"
                        type="file"
                        accept=".pdf,image/*,application/pdf"
                        multiple
                        onChange={(event) => setMultipleFiles(Array.from(event.target.files ?? []))}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#236f9f]">
                        Klikni pro výběr více souborů
                      </div>
                    </label>
                    {multipleFiles.length > 0 ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-700">
                        Vybráno: <span className="font-medium">{multipleFiles.length}</span>{' '}
                        {multipleFiles.length === 1 ? 'soubor' : multipleFiles.length < 5 ? 'soubory' : 'souborů'}
                      </div>
                    ) : null}
                    <div className="text-center text-xs text-zinc-500">Hromadný upload je bez data splatnosti.</div>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:opacity-60"
                    >
                      Nahrát více souborů
                    </button>
                  </form>
                </div>
              ) : (
                <div className="min-h-0">
                  <div className="mb-2 grid grid-cols-2 gap-2 lg:hidden">
                    <button
                      type="button"
                      onClick={() => setMobileViewPanel('list')}
                      className={`inline-flex h-8 items-center justify-center rounded-lg border text-xs font-medium uppercase ${
                        mobileViewPanel === 'list'
                          ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'
                      }`}
                    >
                      Seznam
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileViewPanel('preview')}
                      className={`inline-flex h-8 items-center justify-center rounded-lg border text-xs font-medium uppercase ${
                        mobileViewPanel === 'preview'
                          ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'
                      }`}
                    >
                      Náhled
                    </button>
                  </div>

                  <div className="mb-3 flex flex-wrap gap-2">
                    {FILTERS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setFilter(item.key)}
                        className={`inline-flex h-8 items-center justify-center rounded-full border px-3 text-xs font-medium ${
                          filter === item.key
                            ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]'
                            : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div
                    className={`max-h-[42vh] overflow-y-auto lg:max-h-[56vh] ${
                      mobileViewPanel === 'preview' ? 'hidden lg:block' : ''
                    }`}
                  >
                    <div className="grid gap-2">
                      {rows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => {
                            setSelectedId(row.id)
                            setDueDateDraft(row.due_date ?? '')
                            setMobileViewPanel('preview')
                          }}
                          className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                            selectedId === row.id
                              ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,rgba(234,243,251,0.98)_0%,rgba(220,236,248,0.92)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_20px_rgba(41,128,185,0.14)]'
                              : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                          }`}
                        >
                          <div className="truncate text-sm font-medium text-zinc-900">{row.file_name}</div>
                          <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                            <span>{formatFileSize(row.file_size)}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] ${
                                row.status === 'paid'
                                  ? 'border border-emerald-300/90 bg-[linear-gradient(155deg,rgba(220,252,231,0.95)_0%,rgba(187,247,208,0.9)_100%)] text-emerald-700'
                                  : 'border border-red-300/90 bg-[linear-gradient(155deg,rgba(254,226,226,0.95)_0%,rgba(254,202,202,0.9)_100%)] text-red-700'
                              }`}
                            >
                              {row.status === 'paid' ? 'UHRAZENÁ' : 'NEUHRAZENÁ'}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </aside>

            <section
              className={`min-h-0 p-4 ${mobileViewPanel === 'list' ? 'hidden lg:block' : ''}`}
            >
              {selectedInvoice ? (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                      {selectedInvoice.file_name}
                    </div>
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={isPending}
                      className="inline-flex h-9 items-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_14px_24px_rgba(41,128,185,0.3)] disabled:opacity-60"
                    >
                      STÁHNOUT
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={isPending}
                      className="inline-flex h-9 items-center rounded-xl border border-red-300/90 bg-[linear-gradient(155deg,rgba(254,242,242,0.96)_0%,rgba(254,226,226,0.9)_100%)] px-3 text-xs font-semibold uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(153,27,27,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      SMAZAT
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
                    <button
                      type="button"
                      onClick={() => handleToggleStatus('unpaid')}
                      disabled={isPending}
                      className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium ${
                        selectedInvoice.status === 'unpaid'
                          ? 'border-red-300/90 bg-[linear-gradient(155deg,rgba(254,226,226,0.95)_0%,rgba(254,202,202,0.9)_100%)] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px]'
                      }`}
                    >
                      NEUHRAZENÁ
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStatus('paid')}
                      disabled={isPending}
                      className={`inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium ${
                        selectedInvoice.status === 'paid'
                          ? 'border-emerald-300/90 bg-[linear-gradient(155deg,rgba(220,252,231,0.95)_0%,rgba(187,247,208,0.9)_100%)] text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.74)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px]'
                      }`}
                    >
                      UHRAZENÁ
                    </button>

                    <input
                      type="date"
                      value={dueDateDraft}
                      onChange={(event) => setDueDateDraft(event.target.value)}
                      className="ml-auto h-8 rounded-lg border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-2 text-xs text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    />
                    <button
                      type="button"
                      onClick={handleSaveDueDate}
                      disabled={isPending}
                      className="inline-flex h-8 items-center rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-semibold uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      ULOŽIT SPLATNOST
                    </button>
                  </div>

                  <div className="text-xs text-zinc-500">
                    Splatnost: <span className="font-medium text-zinc-700">{formatDate(selectedInvoice.due_date)}</span>
                  </div>

                  <InvoicePreviewPane
                    previewUrl={previewUrl}
                    mimeType={selectedInvoice.mime_type}
                    fileName={selectedInvoice.file_name}
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white/70 text-sm text-zinc-500">
                  Žádné soubory pro aktuální filtr.
                </div>
              )}
            </section>
          </div>

          {error ? (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : null}
        </div>
        </div>
      </div>
    </>,
    document.body
  )
}
