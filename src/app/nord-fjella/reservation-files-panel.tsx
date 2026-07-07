'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type {
  NordFjellaReservationFileDocumentType,
  NordFjellaReservationFileRow,
} from '@/lib/nord-fjella/types'
import {
  deleteNordFjellaReservationFileAction,
  downloadNordFjellaReservationFileAction,
  openNordFjellaReservationFileAction,
  uploadNordFjellaReservationFilesAction,
} from './actions'

type ReservationFilesPanelProps = {
  reservationId: string
  initialFiles: NordFjellaReservationFileRow[]
}

const DOCUMENT_TYPE_OPTIONS: Array<{
  value: NordFjellaReservationFileDocumentType
  label: string
}> = [
  { value: 'id_card', label: 'Občanský průkaz' },
  { value: 'drivers_license', label: 'Řidičský průkaz' },
  { value: 'passport', label: 'Pas' },
  { value: 'other', label: 'Jiný doklad' },
]

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 KB'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const formatted = value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)
  return `${formatted.replace('.', ',')} ${units[unitIndex]}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getDocumentTypeLabel(type: NordFjellaReservationFileDocumentType) {
  return DOCUMENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Doklad'
}

export function ReservationFilesPanel({
  reservationId,
  initialFiles,
}: ReservationFilesPanelProps) {
  const router = useRouter()
  const [files, setFiles] = useState(initialFiles)
  const [documentType, setDocumentType] = useState<NordFjellaReservationFileDocumentType>('id_card')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [isBusy, startTransition] = useTransition()

  useEffect(() => {
    setFiles(initialFiles)
  }, [initialFiles])

  const sortedFiles = useMemo(
    () =>
      [...files].sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      ),
    [files]
  )

  function handleUpload() {
    setMessage(null)

    startTransition(async () => {
      const result = await uploadNordFjellaReservationFilesAction(
        reservationId,
        documentType,
        selectedFiles
      )

      if (!result.success) {
        setMessage(result.error ?? 'Nepodařilo se nahrát soubory.')
        return
      }

      setFiles((current) => [...result.uploadedFiles, ...current])
      setSelectedFiles([])
      setMessage(
        result.uploadedFiles.length === 1
          ? 'Doklad byl úspěšně nahrán.'
          : `Doklady byly úspěšně nahrány (${result.uploadedFiles.length}).`
      )
      router.refresh()
    })
  }

  function handleOpen(fileId: string, download = false) {
    setMessage(null)

    startTransition(async () => {
      const result = download
        ? await downloadNordFjellaReservationFileAction(fileId)
        : await openNordFjellaReservationFileAction(fileId)

      if (!result.success || !result.signedUrl) {
        setMessage(
          result.error ??
            (download
              ? 'Nepodařilo se připravit stažení souboru.'
              : 'Nepodařilo se otevřít soubor.')
        )
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  function handleDelete(fileId: string, displayName: string) {
    if (!window.confirm(`Opravdu chceš smazat soubor "${displayName}"?`)) {
      return
    }

    setMessage(null)

    startTransition(async () => {
      const result = await deleteNordFjellaReservationFileAction(fileId)

      if (!result.success || !result.deletedFileId) {
        setMessage(result.error ?? 'Soubor se nepodařilo smazat.')
        return
      }

      setFiles((current) => current.filter((item) => item.id !== result.deletedFileId))
      setMessage('Soubor byl smazán.')
      router.refresh()
    })
  }

  return (
    <section className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Doklady hosta</h3>
          <p className="mt-1 text-sm text-gray-500">
            Nahraj OP, ŘP, pas nebo jiný doklad k této rezervaci.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
        <div className="grid self-end">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            Soubory
          </label>
          <input
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            disabled={isBusy}
            onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))}
            className="clients-modal__input block h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-2 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
          />
          <p className="mt-2 min-h-[20px] text-xs text-gray-500">
            Povolené formáty: PDF, JPG, PNG, WEBP, HEIC. Max. 10 MB / soubor.
          </p>
        </div>

        <div className="grid self-end">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
            Typ dokladu
          </label>
          <select
            value={documentType}
            disabled={isBusy}
            onChange={(event) =>
              setDocumentType(event.target.value as NordFjellaReservationFileDocumentType)
            }
            className="clients-modal__select h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
          >
            {DOCUMENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="mt-2 min-h-[20px]" aria-hidden />
        </div>

        <div className="grid self-end">
          <div className="mb-1 min-h-[16px]" aria-hidden />
          <button
            type="button"
            disabled={isBusy || selectedFiles.length === 0}
            onClick={handleUpload}
            className="offers-page__filter-submit inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Nahrávám...' : 'Nahrát soubor'}
          </button>
          <div className="mt-2 min-h-[20px]" aria-hidden />
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-2xl border border-[#9dc7e5]/70 bg-[#eef7ff]/85 px-4 py-3 text-sm text-[#215d8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(78,160,220,0.18)] [html[data-theme='dark']_&]:bg-[rgba(13,25,44,0.84)] [html[data-theme='dark']_&]:text-slate-200">
          {message}
        </div>
      ) : null}

      {sortedFiles.length === 0 ? (
        <div className="nord-fjella-modal-empty-state mt-4 rounded-2xl border border-dashed border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.8)_100%)] px-4 py-6 text-sm text-gray-500">
          Zatím tu nejsou nahrané žádné doklady.
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/80 bg-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] [html[data-theme='dark']_&]:border-slate-400/14 [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.76)]">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-zinc-50/80 text-left text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 [html[data-theme='dark']_&]:bg-slate-950/28 [html[data-theme='dark']_&]:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Soubor</th>
                  <th className="px-4 py-3">Typ dokladu</th>
                  <th className="px-4 py-3">Velikost</th>
                  <th className="px-4 py-3">Nahráno</th>
                  <th className="px-4 py-3 text-right">Akce</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiles.map((file) => (
                  <tr
                    key={file.id}
                    className="border-t border-zinc-100 text-sm text-gray-700 [html[data-theme='dark']_&]:border-slate-400/10"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{file.display_name}</div>
                      <div className="mt-1 text-xs text-gray-500">{file.mime_type}</div>
                    </td>
                    <td className="px-4 py-3">{getDocumentTypeLabel(file.document_type)}</td>
                    <td className="px-4 py-3">{formatFileSize(file.file_size_bytes)}</td>
                    <td className="px-4 py-3">{formatDateTime(file.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpen(file.id, false)}
                          className="nord-fjella-chip inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                        >
                          Otevřít
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleOpen(file.id, true)}
                          className="nord-fjella-chip inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                        >
                          Stáhnout
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDelete(file.id, file.display_name)}
                          className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.12)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-red-400/28 [html[data-theme='dark']_&]:bg-[rgba(127,29,29,0.34)] [html[data-theme='dark']_&]:text-red-200"
                        >
                          Smazat
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
