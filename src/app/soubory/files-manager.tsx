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

export function FilesManager({ files, jobs, initialQuery }: FilesManagerProps) {
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
      <section className="grid min-w-0 w-full min-h-[calc(100vh-250px)] gap-3 overflow-x-hidden lg:grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="min-w-0 w-full rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">Složky</h2>
            <span className="text-xs text-gray-400">{sortedFolders.length}</span>
          </div>

          <button
            type="button"
            onClick={() => setSelectedJobId('all')}
            className={`mb-2 w-full rounded-xl px-3 py-2 text-left text-sm transition ${
              selectedJobId === 'all' ? 'bg-[#2980B9] text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
            }`}
          >
            VŠECHNY SLOŽKY
          </button>

          <input
            type="text"
            value={foldersQuery}
            onChange={(event) => setFoldersQuery(event.target.value)}
            placeholder="Hledat složku (min. 3 znaky)"
            className="mb-2 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />

          <div className="max-h-[65vh] space-y-1 overflow-y-auto pr-1">
            {visibleFolders.map((folder) => {
              const count = folderStats.get(folder.id)?.count ?? 0
              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setSelectedJobId(folder.id)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${
                    selectedJobId === folder.id
                      ? 'bg-[#2980B9] text-white'
                      : 'bg-gray-50 text-gray-800 hover:bg-gray-100'
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

        <section className="min-w-0 w-full rounded-3xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">
            Soubory
          </div>

          <div className="mb-3">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-[#2980B9] px-2 text-[11px] font-bold uppercase text-white transition hover:bg-[#236f9f]"
            >
              Nahrát soubor
            </button>
            <button
              type="button"
              disabled={checkedVisibleIds.length === 0 || isPending}
              onClick={() => runDownload(checkedVisibleIds, 'soubory-vyber.zip')}
              className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-[11px] font-bold uppercase text-gray-800 disabled:opacity-40"
            >
              Stáhnout vybrané
            </button>
            <button
              type="button"
              disabled={visibleFiles.length === 0 || isPending}
              onClick={() => runDownload(visibleFiles.map((file) => file.id), 'soubory-vse-filtrovane.zip')}
              className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-[11px] font-bold uppercase text-gray-800 disabled:opacity-40"
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
              className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-[11px] font-bold uppercase text-gray-800 disabled:opacity-40"
            >
              Stáhnout vše (složka)
            </button>
            <button
              type="button"
              disabled={checkedVisibleIds.length === 0 || isPending}
              onClick={() => handleDelete(checkedVisibleIds)}
              className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-red-200 bg-white px-2 text-[11px] font-bold uppercase text-red-700 disabled:opacity-40"
            >
              Smazat vybrané
            </button>
            </div>
          </div>

          {errorMessage ? (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</div>
          ) : null}

          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm text-gray-500">{visibleFiles.length} souborů</div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={visibleFiles.length > 0 && visibleFiles.every((file) => checkedIds.includes(file.id))}
                onChange={toggleCheckAllVisible}
              />
              Vybrat vše ve výpisu
            </label>
          </div>

          <div className="max-h-[65vh] overflow-y-auto rounded-2xl border border-gray-100">
            {visibleFiles.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">Žádné soubory pro aktuální filtr.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {visibleFiles.map((file) => (
                  <li
                    key={file.id}
                    className={`p-3 transition ${selectedFileId === file.id ? 'bg-[#2980B9]/5' : 'bg-white'}`}
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
                        className="min-w-0 flex-1 text-left"
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
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white px-2 text-[11px] font-semibold uppercase text-gray-700"
                      >
                        ZIP
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete([file.id])}
                        className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-red-200 bg-white px-2 text-[11px] font-semibold uppercase text-red-700"
                      >
                        Smazat
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="hidden min-w-0 w-full rounded-3xl border border-gray-200 bg-white p-3 shadow-sm lg:block">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.12em] text-gray-500">Náhled</h2>
          {!selectedFile ? (
            <div className="text-sm text-gray-500">Vyber soubor ze seznamu.</div>
          ) : (
            <>
              <div className="mb-2 truncate text-sm font-semibold text-gray-900">{selectedFile.displayName}</div>
              <div className="mb-3 text-xs text-gray-500">{selectedFile.jobNumber} · {selectedFile.companyName}</div>

              {previewUrl ? (
                selectedFile.mimeType?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={previewUrl} alt={selectedFile.displayName} className="max-h-[52vh] w-full rounded-xl border border-gray-200 object-contain" />
                ) : selectedFile.mimeType === 'application/pdf' ? (
                  <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
                    <object
                      data={previewUrl}
                      type="application/pdf"
                      className="h-[52vh] w-full rounded-lg border border-gray-100"
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
                  <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">Náhled není pro tento typ dostupný.</div>
                )
              ) : (
                <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">Klikni na soubor pro načtení náhledu.</div>
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
          onDelete={() => {
            if (!selectedFile) return
            setIsMobilePreviewOpen(false)
            handleDelete([selectedFile.id])
          }}
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
}: {
  file: FileItem | null
  previewUrl: string | null
  isPending: boolean
  onClose: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/55 p-3 backdrop-blur-sm lg:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col rounded-3xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700"
            aria-label="Zavřít náhled"
          >
            ✕
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3">
          <button
            type="button"
            disabled={!file || isPending}
            onClick={onDownload}
            className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-xs font-bold uppercase text-white transition hover:bg-[#236f9f] disabled:opacity-40"
          >
            Stáhnout
          </button>
          <button
            type="button"
            disabled={!file || isPending}
            onClick={onDelete}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200 bg-white px-3 text-xs font-bold uppercase text-red-700 disabled:opacity-40"
          >
            Smazat
          </button>
          {previewUrl ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-xs font-bold uppercase text-gray-800"
            >
              Otevřít
            </a>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {!file ? (
            <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">Vyber soubor.</div>
          ) : previewUrl ? (
            file.mimeType?.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={file.displayName} className="h-full max-h-[72vh] w-full rounded-xl border border-gray-200 object-contain" />
            ) : file.mimeType === 'application/pdf' ? (
              <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3">
                <object
                  data={previewUrl}
                  type="application/pdf"
                  className="h-[72vh] w-full rounded-lg border border-gray-100"
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
              <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">Náhled není pro tento typ dostupný.</div>
            )
          ) : (
            <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-500">Načítám náhled...</div>
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
      className="fixed inset-0 z-50 bg-zinc-950/50 p-3 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mx-auto mt-10 w-full max-w-xl rounded-3xl border border-gray-200 bg-white p-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-900">Nahrát soubor</h3>

        <div className="mt-3 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Zakázka (složka)</label>
            <select
              value={jobId}
              onChange={(event) => setJobId(event.target.value)}
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
              className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
              placeholder="Volitelná poznámka"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Soubory</label>
            <input
              type="file"
              multiple
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              className="block w-full text-sm text-gray-900 file:mr-3 file:rounded-xl file:border file:border-gray-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 hover:file:bg-gray-50"
              accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            />
          </div>

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 min-w-[120px] items-center justify-center rounded-2xl border border-red-200 bg-white px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 transition hover:bg-red-50"
            >
              Zrušit
            </button>
            <button
              type="button"
              disabled={!jobId || files.length === 0 || isPending}
              onClick={submitUpload}
              className="inline-flex h-11 min-w-[140px] items-center justify-center rounded-2xl bg-[#2980B9] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-[#236f9f] disabled:opacity-40"
            >
              Nahrát
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
