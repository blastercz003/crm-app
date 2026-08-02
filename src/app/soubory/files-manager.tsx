'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useRouter } from 'next/navigation'
import {
  deleteAttachmentsAction,
  getAttachmentDownloadLinksAction,
  getAttachmentPreviewUrlAction,
  uploadFilesToJobAction,
  type JobAttachmentCategory,
} from './actions'
import { ModalHeading } from '@/components/ui/modal-heading'
import { SlidingSingleRowTabSwitch } from '@/components/ui/sliding-two-tab-switch'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type FileItem = {
  id: string
  jobId: string
  jobNumber: string
  companyName: string
  displayName: string
  fileName: string
  mimeType: string | null
  fileSizeBytes: number
  category: JobAttachmentCategory
  note: string | null
  createdAt: string
}

type JobFolder = {
  id: string
  jobNumber: string
  companyName: string
}

type FilesManagerProps = {
  files: FileItem[]
  jobs: JobFolder[]
  initialQuery: string
  canDeleteFiles: boolean
}

type FilesSection = 'folders' | 'files'
type PreviewViewMode = 'page' | 'width'

const FILES_SECTION_OPTIONS = [
  { value: 'folders', label: 'SLOŽKY' },
  { value: 'files', label: 'SOUBORY' },
] as const

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function getJobSortValue(jobNumber: string) {
  const digits = String(jobNumber ?? '').match(/\d+/g)?.join('') ?? ''
  return Number(digits || 0)
}

function matchesQuery(file: FileItem, query: string) {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    file.jobNumber.toLowerCase().includes(q) ||
    file.companyName.toLowerCase().includes(q) ||
    (file.note ?? '').toLowerCase().includes(q)
  )
}

async function downloadZipFromLinks(
  links: Array<{ id: string; name: string; url: string }>,
  zipName: string
) {
  const JSZipModule = await import('jszip')
  const JSZip = JSZipModule.default
  const zip = new JSZip()

  for (const link of links) {
    const response = await fetch(link.url)
    if (!response.ok) continue
    const blob = await response.blob()
    zip.file(link.name, blob)
  }

  const content = await zip.generateAsync({ type: 'blob' })
  const objectUrl = URL.createObjectURL(content)

  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = zipName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(objectUrl)
}

export function FilesManager({ files, jobs, initialQuery, canDeleteFiles }: FilesManagerProps) {
  const router = useRouter()
  const [query] = useState(initialQuery)
  const [activeSection, setActiveSection] = useState<FilesSection>('files')
  const [foldersQuery, setFoldersQuery] = useState('')
  const [selectedJobId, setSelectedJobId] = useState<string>('all')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const previousBlobPreviewUrlRef = useRef<string | null>(null)

  const filesById = useMemo(() => {
    return new Map(files.map((file) => [file.id, file]))
  }, [files])

  const folderStats = useMemo(() => {
    const map = new Map<string, { count: number; latestCreatedAt: string }>()

    for (const file of files) {
      const current = map.get(file.jobId)
      if (!current) {
        map.set(file.jobId, { count: 1, latestCreatedAt: file.createdAt })
        continue
      }

      map.set(file.jobId, {
        count: current.count + 1,
        latestCreatedAt:
          new Date(file.createdAt).getTime() > new Date(current.latestCreatedAt).getTime()
            ? file.createdAt
            : current.latestCreatedAt,
      })
    }

    return map
  }, [files])

  const sortedFolders = useMemo(() => {
    return [...jobs].sort((a, b) => {
      const jobDiff = getJobSortValue(b.jobNumber) - getJobSortValue(a.jobNumber)
      if (jobDiff !== 0) return jobDiff

      const aLatest = folderStats.get(a.id)?.latestCreatedAt ?? ''
      const bLatest = folderStats.get(b.id)?.latestCreatedAt ?? ''

      return new Date(bLatest).getTime() - new Date(aLatest).getTime()
    })
  }, [jobs, folderStats])

  const visibleFolders = useMemo(() => {
    const normalized = foldersQuery.trim().toLowerCase()
    if (normalized.length < 3) return sortedFolders

    return sortedFolders.filter((folder) => {
      return (
        folder.jobNumber.toLowerCase().includes(normalized) ||
        folder.companyName.toLowerCase().includes(normalized)
      )
    })
  }, [sortedFolders, foldersQuery])

  const visibleFiles = useMemo(() => {
    return files
      .filter((file) => (selectedJobId === 'all' ? true : file.jobId === selectedJobId))
      .filter((file) => matchesQuery(file, query))
      .sort((a, b) => {
        const jobDiff = getJobSortValue(b.jobNumber) - getJobSortValue(a.jobNumber)
        if (jobDiff !== 0) return jobDiff
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
  }, [files, selectedJobId, query])

  const selectedFile = selectedFileId ? filesById.get(selectedFileId) ?? null : null
  const selectedFolder =
    selectedJobId === 'all'
      ? null
      : sortedFolders.find((folder) => folder.id === selectedJobId) ?? null

  const checkedVisibleIds = checkedIds.filter((id) => visibleFiles.some((file) => file.id === id))

  useEffect(() => {
    return () => {
      if (previousBlobPreviewUrlRef.current) {
        URL.revokeObjectURL(previousBlobPreviewUrlRef.current)
      }
    }
  }, [])

  async function ensurePreview(fileId: string, mimeType: string | null) {
    if (previewTargetId === fileId && previewUrl) return

    const result = await getAttachmentPreviewUrlAction(fileId)
    if (!result.success || !result.signedUrl) {
      setErrorMessage(result.error ?? 'Náhled se nepodařilo načíst.')
      return
    }

    let nextPreviewUrl = result.signedUrl

    if (mimeType === 'application/pdf') {
      try {
        const response = await fetch(result.signedUrl)
        if (!response.ok) {
          setErrorMessage('PDF náhled se nepodařilo načíst.')
          return
        }

        const pdfBlob = await response.blob()
        nextPreviewUrl = URL.createObjectURL(pdfBlob)

        if (previousBlobPreviewUrlRef.current) {
          URL.revokeObjectURL(previousBlobPreviewUrlRef.current)
        }
        previousBlobPreviewUrlRef.current = nextPreviewUrl
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Neznámá chyba při načítání PDF.'
        setErrorMessage(`PDF náhled se nepodařilo načíst (${message}).`)
        return
      }
    }

    setPreviewTargetId(fileId)
    setPreviewUrl(nextPreviewUrl)
    setErrorMessage(null)
  }

  function toggleChecked(fileId: string) {
    setCheckedIds((current) =>
      current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]
    )
  }

  function selectFolder(jobId: string) {
    setSelectedJobId(jobId)
    setSelectedFileId(null)
    setPreviewTargetId(null)
    setPreviewUrl(null)
    setErrorMessage(null)
    setActiveSection('files')
  }

  function openFilePreview(file: FileItem) {
    setSelectedFileId(file.id)
    setIsPreviewOpen(true)
    void ensurePreview(file.id, file.mimeType)
  }

  function toggleCheckAllVisible() {
    const visibleIds = visibleFiles.map((file) => file.id)
    const allSelected = visibleIds.every((id) => checkedIds.includes(id))

    if (allSelected) {
      setCheckedIds((current) => current.filter((id) => !visibleIds.includes(id)))
      return
    }

    setCheckedIds((current) => Array.from(new Set([...current, ...visibleIds])))
  }

  function runDownload(ids: string[], zipName: string) {
    startTransition(async () => {
      const result = await getAttachmentDownloadLinksAction(ids)
      if (!result.success) {
        setErrorMessage(result.error ?? 'Stažení selhalo.')
        return
      }

      try {
        await downloadZipFromLinks(result.items, zipName)
        setErrorMessage(null)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Neznámá chyba.'
        setErrorMessage(`Stažení selhalo (${message}).`)
      }
    })
  }

  function runDirectDownload(id: string) {
    startTransition(async () => {
      const result = await getAttachmentDownloadLinksAction([id])
      if (!result.success || result.items.length === 0) {
        setErrorMessage(result.error ?? 'Stažení selhalo.')
        return
      }

      const item = result.items[0]
      const anchor = document.createElement('a')
      anchor.href = item.url
      anchor.download = item.name
      anchor.target = '_blank'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setErrorMessage(null)
    })
  }

  function handleDelete(ids: string[]) {
    if (ids.length === 0) return
    const confirmed = window.confirm(`Opravdu chceš smazat ${ids.length} souborů?`)
    if (!confirmed) return

    startTransition(async () => {
      const result = await deleteAttachmentsAction(ids)
      if (!result.success) {
        setErrorMessage(result.error ?? 'Mazání selhalo.')
        return
      }

      setCheckedIds([])
      setPreviewUrl(null)
      setPreviewTargetId(null)
      setSelectedFileId(null)
      setIsPreviewOpen(false)
      setErrorMessage(null)
      setActiveSection('files')
      router.refresh()
    })
  }

  return (
    <>
      <section className="soubory-page__files-panel min-w-0 w-full overflow-hidden rounded-3xl border border-zinc-200 bg-[#f8fafc] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
        <div className="border-b border-zinc-200/80 p-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
          <SlidingSingleRowTabSwitch
            value={activeSection}
            options={FILES_SECTION_OPTIONS}
            onValueChange={setActiveSection}
            ariaLabel="Část správce souborů"
            className="w-full rounded-[20px] border border-zinc-200/80 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]"
          />
        </div>

        {errorMessage ? (
          <div className="soubory-page__error mx-4 mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-5">
            {errorMessage}
          </div>
        ) : null}

        <section
          hidden={activeSection !== 'folders'}
          aria-hidden={activeSection !== 'folders'}
          className="soubory-page__sidebar min-w-0 w-full border-0 bg-transparent p-4 shadow-none sm:p-5"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">
                Složky zakázek
              </h2>
              <div className="mt-1 text-xs text-gray-400">
                {sortedFolders.length} složek
              </div>
            </div>

            <input
              type="text"
              value={foldersQuery}
              onChange={(event) => setFoldersQuery(event.target.value)}
              placeholder="Hledat složku (min. 3 znaky)"
              className="soubory-page__folder-search h-10 w-full rounded-xl border border-gray-200 bg-white/96 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:max-w-sm"
            />
          </div>

          <div className="grid max-h-[65vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleFolders.map((folder) => {
              const count = folderStats.get(folder.id)?.count ?? 0
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => selectFolder(folder.id)}
                  data-active={selectedJobId === folder.id}
                  className={`soubory-page__folder-button min-w-0 w-full rounded-xl border px-3 py-3 text-left transition duration-200 ease-out ${
                    selectedJobId === folder.id
                      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34)]'
                      : 'border-zinc-200 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.93)_100%)] text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(148,163,184,0.08)] hover:border-zinc-300 hover:text-gray-900'
                  }`}
                >
                  <div className="truncate text-sm font-semibold">{folder.jobNumber}</div>
                  <div className="truncate text-xs opacity-80">{folder.companyName}</div>
                  <div className="mt-1 text-[11px] opacity-70">{count} souborů</div>
                </button>
              )
            })}
          </div>
        </section>

        <section
          hidden={activeSection !== 'files'}
          aria-hidden={activeSection !== 'files'}
          className="min-w-0 w-full p-4 sm:p-5"
        >
          {selectedFolder ? (
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">
                {selectedFolder.jobNumber}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="truncate text-sm text-gray-500">{selectedFolder.companyName}</div>
                <button
                  type="button"
                  onClick={() => selectFolder('all')}
                  aria-label="Zrušit výběr složky"
                  title="Zrušit výběr složky"
                  className="soubory-page__secondary-button inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white/80 text-xs text-zinc-600 shadow-sm transition hover:-translate-y-[1px]"
                >
                  ✕
                </button>
              </div>
            </div>
          ) : null}

          <div className="mb-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="soubory-page__primary-button inline-flex h-9 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px]"
            >
              Nahrát soubor
            </button>
            <button
              type="button"
              disabled={checkedVisibleIds.length === 0 || isPending}
              onClick={() => runDownload(checkedVisibleIds, 'soubory-vyber.zip')}
              className="soubory-page__secondary-button inline-flex h-9 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-2 text-[11px] font-bold uppercase text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] disabled:opacity-40"
            >
              Stáhnout vybrané
            </button>
            <button
              type="button"
              disabled={visibleFiles.length === 0 || isPending}
              onClick={() => runDownload(visibleFiles.map((file) => file.id), 'soubory-vse-filtrovane.zip')}
              className="soubory-page__secondary-button inline-flex h-9 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-2 text-[11px] font-bold uppercase text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] disabled:opacity-40"
            >
              Stáhnout vše (filtr)
            </button>
            <button
              type="button"
              disabled={selectedJobId === 'all' || isPending}
              onClick={() => {
                const ids = files.filter((file) => file.jobId === selectedJobId).map((file) => file.id)
                runDownload(ids, `soubory-${selectedJobId}.zip`)
              }}
              className="soubory-page__secondary-button inline-flex h-9 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-2 text-[11px] font-bold uppercase text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] disabled:opacity-40"
            >
              Stáhnout vše (složka)
            </button>
            {canDeleteFiles ? (
              <button
                type="button"
                disabled={checkedVisibleIds.length === 0 || isPending}
                onClick={() => handleDelete(checkedVisibleIds)}
                className="soubory-page__danger-button inline-flex h-9 w-full items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 text-[11px] font-bold uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] disabled:opacity-40"
              >
                Smazat vybrané
              </button>
            ) : null}
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between">
            <div className="soubory-page__file-count text-sm text-gray-500">{visibleFiles.length} souborů</div>
            <label className="soubory-page__select-all inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={visibleFiles.length > 0 && visibleFiles.every((file) => checkedIds.includes(file.id))}
                onChange={toggleCheckAllVisible}
              />
              Vybrat vše ve výpisu
            </label>
          </div>

          <div className="soubory-page__file-list-shell max-h-[65vh] overflow-y-auto rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.78)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
            {visibleFiles.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">Žádné soubory pro aktuální filtr.</div>
            ) : (
              <ul className="soubory-page__file-list divide-y divide-gray-100">
                {visibleFiles.map((file) => (
                  <li
                    key={file.id}
                    data-selected={selectedFileId === file.id}
                    className={`soubory-page__file-row p-3 transition ${selectedFileId === file.id ? 'bg-[#2980B9]/5' : 'bg-white/92'}`}
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(file.id)}
                        onChange={() => toggleChecked(file.id)}
                        className="mt-1"
                      />

                      <button
                        type="button"
                        onClick={() => openFilePreview(file)}
                        className="soubory-page__file-link min-w-[min(100%,240px)] flex-1 text-left"
                      >
                        <div className="truncate text-sm font-semibold text-gray-900">{file.displayName}</div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {file.jobNumber} · {file.companyName}
                        </div>
                        <div className="mt-1 text-xs text-gray-500">
                          {formatDateTime(file.createdAt)} · {formatBytes(file.fileSizeBytes)}
                        </div>
                        {file.note ? <div className="mt-1 truncate text-xs text-gray-600">Pozn.: {file.note}</div> : null}
                      </button>

                      <div className="ml-auto flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => runDownload([file.id], `${file.displayName}.zip`)}
                          className="soubory-page__zip-button inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-2 text-[11px] font-semibold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.09)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_18px_rgba(15,23,42,0.12)]"
                        >
                          ZIP
                        </button>

                        <button
                          type="button"
                          onClick={() => runDirectDownload(file.id)}
                          className="soubory-page__download-button inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[11px] font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(24,78,129,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_12px_20px_rgba(24,78,129,0.3)]"
                        >
                          STÁHNOUT
                        </button>

                        {canDeleteFiles ? (
                          <button
                            type="button"
                            onClick={() => handleDelete([file.id])}
                            className="soubory-page__delete-button inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 text-[11px] font-semibold uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(185,28,28,0.12)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_18px_rgba(185,28,28,0.18)]"
                          >
                            Smazat
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </section>

      {isUploadOpen ? (
        <UploadModal
          jobs={sortedFolders}
          onClose={() => setIsUploadOpen(false)}
          onUploaded={() => {
            setIsUploadOpen(false)
            setActiveSection('files')
            router.refresh()
          }}
        />
      ) : null}

      {isPreviewOpen && selectedFile ? (
        <FilePreviewModal
          file={selectedFile}
          previewUrl={previewUrl}
          previewError={errorMessage}
          isPending={isPending}
          canDeleteFiles={canDeleteFiles}
          onClose={() => setIsPreviewOpen(false)}
          onDownload={() => runDirectDownload(selectedFile.id)}
          onDownloadZip={() =>
            runDownload([selectedFile.id], `${selectedFile.displayName}.zip`)
          }
          onDelete={() => handleDelete([selectedFile.id])}
        />
      ) : null}
    </>
  )
}

function FilePreviewModal({
  file,
  previewUrl,
  previewError,
  isPending,
  canDeleteFiles,
  onClose,
  onDownload,
  onDownloadZip,
  onDelete,
}: {
  file: FileItem
  previewUrl: string | null
  previewError: string | null
  isPending: boolean
  canDeleteFiles: boolean
  onClose: () => void
  onDownload: () => void
  onDownloadZip: () => void
  onDelete: () => void
}) {
  useBodyScrollLock(true)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <>
      <div
        aria-hidden="true"
        className="soubory-preview-modal__overlay fixed inset-0 z-[110] bg-zinc-950/55 backdrop-blur-[5px]"
      />
      <div
        className="soubory-preview-modal fixed inset-0 z-[111] overflow-hidden p-2 sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="soubory-preview-modal-title"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div className="flex h-full items-center justify-center">
          <div className="soubory-preview-modal__shell flex h-full max-h-[920px] w-full max-w-[1180px] flex-col overflow-hidden rounded-[26px] border border-zinc-200/90 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(243,247,251,0.94)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_36px_90px_rgba(15,23,42,0.34)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(13,20,34,0.99)_0%,rgba(8,14,25,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_36px_90px_rgba(2,6,23,0.62)]">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200/80 px-4 py-3 sm:px-5 sm:py-4 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
              <div className="min-w-0">
                <ModalHeading
                  section="SOUBORY"
                  title={file.displayName}
                  id="soubory-preview-modal-title"
                  variant="compact"
                />
                <div className="mt-1 truncate text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  {file.jobNumber} · {file.companyName} · {formatDateTime(file.createdAt)} ·{' '}
                  {formatBytes(file.fileSizeBytes)}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Zavřít náhled"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white/85 text-lg text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(15,23,42,0.08)] transition hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.92)] [html[data-theme='dark']_&]:text-slate-200 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(2,6,23,0.32)]"
              >
                ✕
              </button>
            </header>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200/80 px-4 py-2.5 sm:px-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
              <div className="min-w-0 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                {file.note ? `Poznámka: ${file.note}` : 'Náhled dokumentu'}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={onDownloadZip}
                  className="soubory-page__secondary-button inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 px-3 text-[11px] font-bold uppercase text-zinc-700 shadow-sm transition hover:-translate-y-[1px] disabled:opacity-40"
                >
                  ZIP
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={onDownload}
                  className="soubory-page__download-button inline-flex h-9 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(24,78,129,0.24)] transition hover:-translate-y-[1px] disabled:opacity-40"
                >
                  STÁHNOUT
                </button>
                {canDeleteFiles ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={onDelete}
                    className="soubory-page__delete-button inline-flex h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50/90 px-3 text-[11px] font-bold uppercase text-red-700 shadow-sm transition hover:-translate-y-[1px] disabled:opacity-40"
                  >
                    SMAZAT
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 bg-zinc-200/70 p-2 sm:p-3 [html[data-theme='dark']_&]:bg-[#050a13]">
              {previewError ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-5 text-center text-sm text-red-700 [html[data-theme='dark']_&]:border-red-900/40 [html[data-theme='dark']_&]:bg-red-950/25 [html[data-theme='dark']_&]:text-red-200">
                  {previewError}
                </div>
              ) : !previewUrl ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Načítám náhled…
                </div>
              ) : file.mimeType === 'application/pdf' ? (
                <PdfDocumentPreview previewUrl={previewUrl} />
              ) : file.mimeType?.startsWith('image/') ? (
                <div className="flex h-full items-center justify-center overflow-auto rounded-2xl bg-zinc-300/60 p-3 [html[data-theme='dark']_&]:bg-[#080e19]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={file.displayName}
                    className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-[0_18px_50px_rgba(15,23,42,0.28)]"
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Náhled není pro tento typ souboru dostupný.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}

function PdfDocumentPreview({ previewUrl }: { previewUrl: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [viewMode, setViewMode] = useState<PreviewViewMode>('page')
  const [zoomPercent, setZoomPercent] = useState(100)
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 })
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(([entry]) => {
      setContainerSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      })
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadedDocument: PDFDocumentProxy | null = null

    setPdfDocument(null)
    setPageNumber(1)
    setViewMode('page')
    setZoomPercent(100)
    setIsLoading(true)
    setError(null)

    async function loadPdf() {
      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()

        loadedDocument = await pdfjs.getDocument(previewUrl).promise
        if (cancelled) {
          await loadedDocument.destroy()
          return
        }

        setPdfDocument(loadedDocument)
      } catch {
        if (!cancelled) {
          setError('PDF náhled se nepodařilo načíst.')
          setIsLoading(false)
        }
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      if (loadedDocument) void loadedDocument.destroy()
    }
  }, [previewUrl])

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current || containerSize.width === 0 || containerSize.height === 0) {
      return
    }

    const currentDocument = pdfDocument
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null

    async function renderPage() {
      try {
        setIsLoading(true)
        setError(null)

        const page = await currentDocument.getPage(pageNumber)
        if (cancelled || !canvasRef.current) return

        const baseViewport = page.getViewport({ scale: 1 })
        const availableWidth = Math.max(120, containerSize.width - 32)
        const availableHeight = Math.max(120, containerSize.height - 32)
        const fittedScale =
          viewMode === 'page'
            ? Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)
            : availableWidth / baseViewport.width
        const cssScale = Math.max(0.1, fittedScale * (zoomPercent / 100))
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
        const cssViewport = page.getViewport({ scale: cssScale })
        const renderViewport = page.getViewport({ scale: cssScale * pixelRatio })
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas není dostupný.')

        canvas.width = Math.floor(renderViewport.width)
        canvas.height = Math.floor(renderViewport.height)
        canvas.style.width = `${Math.floor(cssViewport.width)}px`
        canvas.style.height = `${Math.floor(cssViewport.height)}px`
        setCanvasSize({
          width: Math.floor(cssViewport.width),
          height: Math.floor(cssViewport.height),
        })

        renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport })
        await renderTask.promise
        if (!cancelled) setIsLoading(false)
      } catch (renderError) {
        if (cancelled || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) {
          return
        }
        setError('Stránku PDF se nepodařilo vykreslit.')
        setIsLoading(false)
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [containerSize, pageNumber, pdfDocument, viewMode, zoomPercent])

  const pageCount = pdfDocument?.numPages ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-300/80 bg-zinc-300/70 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[#080e19]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-300 bg-white/80 px-2.5 py-2 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(12,20,34,0.96)]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setViewMode('page')
              setZoomPercent(100)
            }}
            data-active={viewMode === 'page'}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-[10px] font-bold uppercase text-zinc-600 data-[active=true]:border-[#78abd0] data-[active=true]:bg-[#e7f2fa] data-[active=true]:text-[#236f9f] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&][data-active=true]:bg-[rgba(35,92,135,0.55)] [html[data-theme='dark']_&][data-active=true]:text-white"
          >
            CELÁ STRÁNKA
          </button>
          <button
            type="button"
            onClick={() => {
              setViewMode('width')
              setZoomPercent(100)
            }}
            data-active={viewMode === 'width'}
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2.5 text-[10px] font-bold uppercase text-zinc-600 data-[active=true]:border-[#78abd0] data-[active=true]:bg-[#e7f2fa] data-[active=true]:text-[#236f9f] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&][data-active=true]:bg-[rgba(35,92,135,0.55)] [html[data-theme='dark']_&][data-active=true]:text-white"
          >
            NA ŠÍŘKU
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoomPercent((value) => Math.max(50, value - 10))}
            className="h-8 w-8 rounded-lg border border-zinc-200 bg-white text-base text-zinc-700 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-200"
            aria-label="Oddálit PDF"
          >
            −
          </button>
          <div className="min-w-12 text-center text-[11px] font-semibold text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
            {zoomPercent} %
          </div>
          <button
            type="button"
            onClick={() => setZoomPercent((value) => Math.min(200, value + 10))}
            className="h-8 w-8 rounded-lg border border-zinc-200 bg-white text-base text-zinc-700 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-200"
            aria-label="Přiblížit PDF"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
            className="h-8 w-8 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 disabled:opacity-35 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-200"
            aria-label="Předchozí strana"
          >
            ‹
          </button>
          <div className="min-w-14 text-center text-[11px] font-semibold text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
            {pageCount ? `${pageNumber} / ${pageCount}` : '— / —'}
          </div>
          <button
            type="button"
            disabled={pageCount === 0 || pageNumber >= pageCount}
            onClick={() => setPageNumber((value) => Math.min(pageCount, value + 1))}
            className="h-8 w-8 rounded-lg border border-zinc-200 bg-white text-sm text-zinc-700 disabled:opacity-35 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.9)] [html[data-theme='dark']_&]:text-slate-200"
            aria-label="Další strana"
          >
            ›
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative min-h-0 flex-1 overflow-auto">
        <div
          className="flex items-center justify-center p-4"
          style={{
            width: Math.max(containerSize.width, canvasSize.width + 32),
            height: Math.max(containerSize.height, canvasSize.height + 32),
          }}
        >
          <canvas
            ref={canvasRef}
            className="bg-white shadow-[0_20px_60px_rgba(15,23,42,0.34)]"
          />
        </div>

        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-200/45 text-sm text-zinc-600 backdrop-blur-[1px] [html[data-theme='dark']_&]:bg-[#080e19]/55 [html[data-theme='dark']_&]:text-slate-300">
            Načítám stránku…
          </div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-200/90 px-5 text-center text-sm text-red-700 [html[data-theme='dark']_&]:bg-[#080e19]/95 [html[data-theme='dark']_&]:text-red-200">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function UploadModal({
  jobs,
  onClose,
  onUploaded,
}: {
  jobs: JobFolder[]
  onClose: () => void
  onUploaded: () => void
}) {
  const [jobId, setJobId] = useState('')
  const [category, setCategory] = useState<JobAttachmentCategory>('predavaci_protokol')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submitUpload() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('job_id', jobId)
      formData.set('category', category)
      formData.set('note', note)
      for (const file of files) formData.append('files', file)

      const result = await uploadFilesToJobAction(formData)
      if (!result.success) {
        setError(result.error ?? 'Nahrávání selhalo.')
        return
      }

      onUploaded()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/30 p-3 backdrop-blur-[8px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="soubory-page__upload-shell mx-auto mt-10 w-full max-w-xl rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.94)_0%,rgba(249,250,251,0.88)_42%,rgba(244,244,245,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.30)]">
        <ModalHeading section="SOUBORY" title="Nahrát soubor" />

        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Zakázka (složka)</label>
            <select
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              className="soubory-page__upload-select h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white/96 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
            >
              <option value="">Vyber zakázku</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.jobNumber} · {job.companyName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Kategorie</label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as JobAttachmentCategory)}
              className="soubory-page__upload-select h-10 w-full appearance-none rounded-xl border border-gray-200 bg-white/96 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
            >
              <option value="predavaci_protokol">Předávací protokol</option>
              <option value="foto">Foto</option>
              <option value="jine">Jiné</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Poznámka</label>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="soubory-page__upload-input h-10 w-full rounded-xl border border-gray-200 bg-white/96 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              placeholder="Volitelná poznámka"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Soubory</label>
            <input
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="soubory-page__upload-file block w-full text-sm text-gray-900 file:mr-3 file:rounded-xl file:border file:border-white/75 file:bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 file:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.09)]"
              accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            />
          </div>

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="soubory-page__cancel inline-flex h-11 min-w-[120px] items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
            >
              Zrušit
            </button>
            <button
              type="button"
              disabled={!jobId || files.length === 0 || isPending}
              onClick={submitUpload}
              className="soubory-page__submit inline-flex h-11 min-w-[140px] items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
            >
              Nahrát
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
