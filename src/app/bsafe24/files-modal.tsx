'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  deleteBSafe24FileAction,
  downloadBSafe24FileAction,
  openBSafe24FileAction,
  uploadBSafe24FilesAction,
  type BSafe24FileCategory,
  type BSafe24FileRow,
} from './actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type BSafe24FilesModalLauncherProps = {
  contractId: string
  contractNumber: string
  initialFiles: BSafe24FileRow[]
  isAdmin: boolean
  className?: string
  label?: string
}

const FILE_CATEGORY_OPTIONS: Array<{
  value: BSafe24FileCategory
  label: string
}> = [
  { value: 'offer_pdf', label: 'Nabídka PDF' },
  { value: 'contract_pdf', label: 'Smlouva PDF' },
  { value: 'other', label: 'Jiný PDF soubor' },
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

  const formatted =
    value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)

  return `${formatted.replace('.', ',')} ${units[unitIndex]}`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getCategoryLabel(category: BSafe24FileCategory) {
  const match = FILE_CATEGORY_OPTIONS.find((item) => item.value === category)
  return match?.label ?? 'Soubor'
}

export function BSafe24FilesModalLauncher({
  contractId,
  contractNumber,
  initialFiles,
  isAdmin,
  className,
  label,
}: BSafe24FilesModalLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          className ??
          'inline-flex items-center justify-center rounded-xl border border-white/70 bg-white/92 px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-[#1b5f95] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px] hover:text-[#154d78] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme=\'dark\']_&]:text-slate-100 [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.22)]'
        }
      >
        {label ?? 'SOUBORY'}
      </button>

      {isOpen ? (
        <BSafe24FilesModal
          contractId={contractId}
          contractNumber={contractNumber}
          initialFiles={initialFiles}
          isAdmin={isAdmin}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function BSafe24FilesModal({
  contractId,
  contractNumber,
  initialFiles,
  isAdmin,
  onClose,
}: {
  contractId: string
  contractNumber: string
  initialFiles: BSafe24FileRow[]
  isAdmin: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [files, setFiles] = useState<BSafe24FileRow[]>(initialFiles)
  const [category, setCategory] = useState<BSafe24FileCategory>('other')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [isBusy, startTransition] = useTransition()

  useBodyScrollLock(true)

  useEffect(() => {
    setFiles(initialFiles)
  }, [initialFiles])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const sortedFiles = useMemo(
    () =>
      [...files].sort((a, b) => {
        const categoryOrder =
          FILE_CATEGORY_OPTIONS.findIndex((item) => item.value === a.file_type) -
          FILE_CATEGORY_OPTIONS.findIndex((item) => item.value === b.file_type)

        if (categoryOrder !== 0) {
          return categoryOrder
        }

        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }),
    [files]
  )

  function handleUpload() {
    setMessage(null)

    startTransition(async () => {
      const result = await uploadBSafe24FilesAction(contractId, category, selectedFiles)

      if (!result.success) {
        setMessage(result.error ?? 'Nepodařilo se nahrát soubory.')
        return
      }

      setSelectedFiles([])
      setMessage(
        result.uploadedCount === 1
          ? 'Soubor byl úspěšně nahrán.'
          : `Soubory byly úspěšně nahrány (${result.uploadedCount}).`
      )
      router.refresh()
    })
  }

  function handleOpen(fileId: string, download = false) {
    setMessage(null)

    startTransition(async () => {
      const result = download
        ? await downloadBSafe24FileAction(fileId)
        : await openBSafe24FileAction(fileId)

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

  function handleDelete(fileId: string) {
    if (!window.confirm('Opravdu chceš tento PDF soubor smazat?')) {
      return
    }

    setMessage(null)

    startTransition(async () => {
      const result = await deleteBSafe24FileAction(fileId)

      if (!result.success) {
        setMessage(result.error ?? 'Soubor se nepodařilo smazat.')
        return
      }

      setMessage('Soubor byl smazán.')
      router.refresh()
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(17,27,46,0.98)_0%,rgba(12,20,34,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[0_36px_84px_rgba(0,0,0,0.34)] sm:max-h-[calc(100vh-3rem)]">
          <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                Soubory B-SAFE 24
              </h2>
              <p className="mt-2 text-sm text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                Smlouva {contractNumber}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(165deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
              aria-label="Zavřít"
            >
              ×
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
            {isAdmin ? (
              <section className="rounded-[26px] border border-white/78 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(243,247,251,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                      PDF soubory
                    </label>
                    <input
                      type="file"
                      accept=".pdf,application/pdf"
                      multiple
                      disabled={isBusy}
                      onChange={(event) =>
                        setSelectedFiles(Array.from(event.target.files ?? []))
                      }
                      className="block h-12 w-full rounded-2xl border border-white/70 bg-white/92 px-4 py-3 text-sm text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition placeholder:text-zinc-400 focus:border-[#5b9bd5] focus:ring-2 focus:ring-[#5b9bd5]/20 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:placeholder:text-slate-500"
                    />
                    <p className="mt-3 text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      Max. velikost jednoho PDF souboru je 10 MB.
                    </p>
                  </div>

                  <div className="grid gap-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                        Kategorie
                      </label>
                      <select
                        value={category}
                        disabled={isBusy}
                        onChange={(event) =>
                          setCategory(event.target.value as BSafe24FileCategory)
                        }
                        className="h-12 w-full rounded-2xl border border-white/70 bg-white/92 px-4 text-sm text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#5b9bd5] focus:ring-2 focus:ring-[#5b9bd5]/20 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme='dark']_&]:text-slate-100"
                      >
                        {FILE_CATEGORY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      disabled={isBusy || selectedFiles.length === 0}
                      onClick={handleUpload}
                      className="inline-flex h-12 w-full items-center justify-center rounded-2xl border border-zinc-400/65 bg-[linear-gradient(155deg,#8b8b91_0%,#6f6f74_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(63,63,70,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,#4f92cb_0%,#2b679a_100%)]"
                    >
                      {isBusy ? 'NAHRÁVÁNÍ...' : 'NAHRÁT SOUBORY'}
                    </button>
                  </div>
                </div>
              </section>
            ) : null}

            {message ? (
              <div className="mt-4 rounded-2xl border border-[#9dc7e5]/70 bg-[#eef7ff]/85 px-4 py-3 text-sm text-[#215d8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(78,160,220,0.18)] [html[data-theme='dark']_&]:bg-[rgba(13,25,44,0.84)] [html[data-theme='dark']_&]:text-slate-200">
                {message}
              </div>
            ) : null}

            <section className="mt-4 rounded-[26px] border border-white/78 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(243,247,251,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="hidden grid-cols-[minmax(0,1.25fr)_170px_110px_150px_220px] gap-4 border-b border-zinc-200/80 px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.12)] [html[data-theme='dark']_&]:text-slate-400 md:grid">
                <div>Název</div>
                <div>Kategorie</div>
                <div>Velikost</div>
                <div>Nahráno</div>
                <div className="text-right">Akce</div>
              </div>

              {sortedFiles.length === 0 ? (
                <div className="px-5 py-8 text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  U této smlouvy zatím nejsou nahrané žádné PDF soubory.
                </div>
              ) : (
                <div className="divide-y divide-zinc-200/80 [html[data-theme='dark']_&]:divide-[rgba(148,163,184,0.12)]">
                  {sortedFiles.map((file) => (
                    <div key={file.id}>
                      <div className="hidden grid-cols-[minmax(0,1.25fr)_170px_110px_150px_220px] items-center gap-4 px-5 py-4 md:grid">
                        <div className="min-w-0 text-sm font-medium text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                          <div className="truncate">{file.display_name}</div>
                        </div>
                        <div className="text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          {getCategoryLabel(file.file_type)}
                        </div>
                        <div className="text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          {formatFileSize(file.file_size_bytes)}
                        </div>
                        <div className="text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          {formatDateTime(file.created_at)}
                        </div>
                        <div className="flex justify-end gap-2">
                          <ActionButton
                            label="OTEVŘÍT"
                            onClick={() => handleOpen(file.id)}
                            variant="primary"
                            disabled={isBusy}
                          />
                          <ActionButton
                            label="STÁHNOUT"
                            onClick={() => handleOpen(file.id, true)}
                            variant="secondary"
                            disabled={isBusy}
                          />
                          {isAdmin ? (
                            <ActionButton
                              label="SMAZAT"
                              onClick={() => handleDelete(file.id)}
                              variant="danger"
                              disabled={isBusy}
                            />
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-4 px-5 py-4 md:hidden">
                        <div>
                          <div className="text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                            {file.display_name}
                          </div>
                          <div className="mt-2 text-xs uppercase tracking-[0.12em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                            {getCategoryLabel(file.file_type)}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-sm">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                              Velikost
                            </div>
                            <div className="mt-1 text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                              {formatFileSize(file.file_size_bytes)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                              Nahráno
                            </div>
                            <div className="mt-1 text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                              {formatDateTime(file.created_at)}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <ActionButton
                            label="OTEVŘÍT"
                            onClick={() => handleOpen(file.id)}
                            variant="primary"
                            disabled={isBusy}
                            className="w-full"
                          />
                          <ActionButton
                            label="STÁHNOUT"
                            onClick={() => handleOpen(file.id, true)}
                            variant="secondary"
                            disabled={isBusy}
                            className="w-full"
                          />
                          {isAdmin ? (
                            <ActionButton
                              label="SMAZAT"
                              onClick={() => handleDelete(file.id)}
                              variant="danger"
                              disabled={isBusy}
                              className="col-span-2 w-full"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ActionButton({
  label,
  onClick,
  variant,
  disabled,
  className,
}: {
  label: string
  onClick: () => void
  variant: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  className?: string
}) {
  const variantClassName =
    variant === 'primary'
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_18px_rgba(24,78,129,0.24)]'
      : variant === 'danger'
        ? 'border-red-200/90 bg-white/92 text-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(239,68,68,0.08)] [html[data-theme=\'dark\']_&]:border-[rgba(248,113,113,0.28)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme=\'dark\']_&]:text-red-300'
        : 'border-white/70 bg-white/92 text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme=\'dark\']_&]:text-slate-200'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] transition duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 ${variantClassName} ${className ?? ''}`}
    >
      {label}
    </button>
  )
}
