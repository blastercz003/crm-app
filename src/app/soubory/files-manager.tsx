'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deleteAttachmentsAction,
  getAttachmentDownloadLinksAction,
  getAttachmentPreviewUrlAction,
  uploadFilesToJobAction,
  type JobAttachmentCategory,
} from './actions'
import { ModalHeading } from '@/components/ui/modal-heading'

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
  const [foldersQuery, setFoldersQuery] = useState('')
  const [selectedJobId, setSelectedJobId] = useState<string>('all')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(files[0]?.id ?? null)
  const [checkedIds, setCheckedIds] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(null)
  const [isMobilePreviewOpen, setIsMobilePreviewOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isUploadOpen, setIsUploadOpen] = useState(false)
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
      setErrorMessage(null)
      router.refresh()
    })
  }

  return (
    <>
      <section className="soubory-page__layout grid min-w-0 w-full items-start gap-3 overflow-x-hidden lg:items-stretch lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="soubory-page__sidebar min-w-0 w-full rounded-3xl border border-zinc-200 bg-[#f8fafc] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] lg:h-full">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">Složky</h2>
            <span className="text-xs text-gray-400">{sortedFolders.length}</span>
          </div>

          <button
            type="button"
            onClick={() => setSelectedJobId('all')}
            data-active={selectedJobId === 'all'}
            className={`soubory-page__folder-button soubory-page__folder-button--all mb-2 w-full rounded-xl border px-3 py-2 text-left text-sm transition duration-200 ease-out ${
              selectedJobId === 'all'
                ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34)]'
                : 'border-zinc-200 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.93)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),inset_0_-1px_0_rgba(148,163,184,0.08)] hover:border-zinc-300 hover:text-gray-900'
            }`}
          >
            VŠECHNY SLOŽKY
          </button>

          <input
            type="text"
            value={foldersQuery}
            onChange={(event) => setFoldersQuery(event.target.value)}
            placeholder="Hledat složku (min. 3 znaky)"
            className="soubory-page__folder-search mb-2 h-10 w-full rounded-xl border border-gray-200 bg-white/96 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
          />

          <div className="max-h-[65vh] space-y-1 overflow-y-auto pr-1">
            {visibleFolders.map((folder) => {
              const count = folderStats.get(folder.id)?.count ?? 0
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setSelectedJobId(folder.id)}
                  data-active={selectedJobId === folder.id}
                  className={`soubory-page__folder-button w-full rounded-xl border px-3 py-2 text-left transition duration-200 ease-out ${
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
        </aside>

        <section className="soubory-page__files-panel min-w-0 w-full rounded-3xl border border-zinc-200 bg-[#f8fafc] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] lg:h-full">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">
            Soubory
          </div>

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

          {errorMessage ? (
          <div className="soubory-page__error mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
          ) : null}

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
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={checkedIds.includes(file.id)}
                        onChange={() => toggleChecked(file.id)}
                        className="mt-1"
                      />

                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFileId(file.id)
                          void ensurePreview(file.id, file.mimeType)
                          setIsMobilePreviewOpen(true)
                        }}
                        className="soubory-page__file-link min-w-0 flex-1 text-left"
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
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="soubory-page__preview-panel hidden min-w-0 w-full rounded-3xl border border-zinc-200 bg-[#f8fafc] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] lg:block lg:h-full">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">Náhled</h2>
          {!selectedFile ? (
            <div className="text-sm text-gray-500">Vyber soubor ze seznamu.</div>
          ) : (
            <>
              <div className="soubory-page__preview-title mb-2 truncate text-sm font-semibold text-gray-900">{selectedFile.displayName}</div>
              <div className="soubory-page__preview-subtitle mb-3 text-xs text-gray-500">{selectedFile.jobNumber} · {selectedFile.companyName}</div>

              {previewUrl ? (
                selectedFile.mimeType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={selectedFile.displayName}
                    className="max-h-[52vh] w-full rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] object-contain shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]"
                  />
                ) : selectedFile.mimeType === 'application/pdf' ? (
                  <div className="space-y-3 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                    <object
                      data={previewUrl}
                      type="application/pdf"
                      className="h-[52vh] w-full rounded-lg border border-white/75 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                    >
                      <div className="p-3 text-sm text-gray-600">
                        PDF náhled se nepodařilo zobrazit.
                      </div>
                    </object>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-xs font-bold uppercase text-white transition hover:bg-[#236f9f]"
                    >
                      Otevřít PDF
                    </a>
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                    Náhled není pro tento typ dostupný.
                  </div>
                )
              ) : (
                <div className="soubory-page__preview-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                  Klikni na soubor pro načtení náhledu.
                </div>
              )}
            </>
          )}
        </aside>
      </section>

      {isUploadOpen ? (
        <UploadModal
          jobs={sortedFolders}
          onClose={() => setIsUploadOpen(false)}
          onUploaded={() => {
            setIsUploadOpen(false)
            router.refresh()
          }}
        />
      ) : null}

      {isMobilePreviewOpen ? (
        <MobilePreviewDrawer
          file={selectedFile}
          previewUrl={previewUrl}
          isPending={isPending}
          onClose={() => setIsMobilePreviewOpen(false)}
          onDownload={() => {
            if (!selectedFile) return
            runDownload([selectedFile.id], `${selectedFile.displayName}.zip`)
          }}
          onDelete={
            canDeleteFiles
              ? () => {
                  if (!selectedFile) return
                  setIsMobilePreviewOpen(false)
                  handleDelete([selectedFile.id])
                }
              : undefined
          }
          canDeleteFiles={canDeleteFiles}
        />
      ) : null}
    </>
  )
}

function MobilePreviewDrawer({
  file,
  previewUrl,
  isPending,
  onClose,
  onDownload,
  onDelete,
  canDeleteFiles,
}: {
  file: FileItem | null
  previewUrl: string | null
  isPending: boolean
  onClose: () => void
  onDownload: () => void
  onDelete?: () => void
  canDeleteFiles: boolean
}) {
  return (
    <div
        className="soubory-page__mobile-drawer fixed inset-0 z-50 bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="soubory-page__mobile-shell mx-auto flex h-full w-full max-w-3xl flex-col rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.34)]">
        <div className="soubory-page__mobile-header flex items-center justify-between gap-3 border-b border-white/70 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-gray-900">
              {file?.displayName ?? 'Náhled souboru'}
            </div>
            <div className="truncate text-xs text-gray-500">
              {file ? `${file.jobNumber} · ${file.companyName}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="soubory-page__mobile-close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)]"
            aria-label="Zavřít náhled"
          >
            ✕
          </button>
        </div>

        <div className="soubory-page__mobile-actions flex items-center gap-2 border-b border-white/70 px-4 py-3">
          <button
            type="button"
            disabled={!file || isPending}
            onClick={onDownload}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-xs font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
          >
            Stáhnout
          </button>
          {canDeleteFiles ? (
            <button
              type="button"
              disabled={!file || isPending}
              onClick={onDelete}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-xs font-bold uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] disabled:opacity-40"
            >
              Smazat
            </button>
          ) : null}
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 text-xs font-bold uppercase text-gray-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.09)]"
            >
              Otevřít
            </a>
          ) : null}
        </div>

        <div className="soubory-page__mobile-content min-h-0 flex-1 overflow-auto p-4">
          {!file ? (
            <div className="soubory-page__preview-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">Vyber soubor.</div>
          ) : previewUrl ? (
            file.mimeType?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt={file.displayName}
                className="h-full max-h-[72vh] w-full rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] object-contain shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]"
              />
            ) : file.mimeType === 'application/pdf' ? (
              <div className="space-y-3 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                <object
                  data={previewUrl}
                  type="application/pdf"
                  className="h-[72vh] w-full rounded-lg border border-white/75 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]"
                >
                  <div className="p-3 text-sm text-gray-600">
                    PDF náhled se nepodařilo zobrazit.
                  </div>
                </object>
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-xs font-bold uppercase text-white transition hover:bg-[#236f9f]"
                >
                  Otevřít PDF
                </a>
              </div>
            ) : (
              <div className="soubory-page__preview-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">Náhled není pro tento typ dostupný.</div>
            )
          ) : (
              <div className="soubory-page__preview-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] p-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">Načítám náhled...</div>
          )}
        </div>
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
