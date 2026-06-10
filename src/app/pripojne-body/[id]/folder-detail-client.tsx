'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  createConnectionPointFolderCommentAction,
  deleteConnectionPointFolderAction,
  deleteConnectionPointFolderCommentAction,
  renameConnectionPointFolderAction,
  uploadConnectionPointFolderPhotosAction,
  updateConnectionPointFolderCommentAction,
} from '../actions'

type FolderDetail = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

type FolderPhoto = {
  id: string
  uploadId: string
  displayName: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
  signedUrl: string | null
}

type FolderUploadGroup = {
  id: string
  createdAt: string
  photos: FolderPhoto[]
}

type FolderComment = {
  id: string
  body: string
  createdByName: string
  editedByName: string | null
  createdAt: string
  updatedAt: string
  editedAt: string | null
  isEdited: boolean
}

type FolderDetailClientProps = {
  folder: FolderDetail
  uploadGroups: FolderUploadGroup[]
  comments: FolderComment[]
  canEdit: boolean
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function useBodyScrollLock(isOpen: boolean) {
  useEffect(() => {
    if (!isOpen) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previous
    }
  }, [isOpen])
}

function SimpleModal({
  isOpen,
  title,
  onClose,
  children,
  className = '',
}: {
  isOpen: boolean
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  useBodyScrollLock(isOpen)

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className={`w-full max-w-2xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)] ${className}`}>
          <div className="soubory-page__modal-header flex items-start justify-between gap-4 border-b border-white/70 px-5 py-4">
            <h3 className="soubory-page__modal-title text-lg font-semibold tracking-tight text-gray-900">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="soubory-page__modal-close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  )
}

function UploadPhotosModal({
  isOpen,
  folderId,
  onClose,
  onUploaded,
}: {
  isOpen: boolean
  folderId: string
  onClose: () => void
  onUploaded: () => void
}) {
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useBodyScrollLock(isOpen)

  function submit() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('folder_id', folderId)
      for (const file of files) formData.append('files', file)

      const result = await uploadConnectionPointFolderPhotosAction(formData)
      if (!result.success) {
        setError(result.error ?? 'Fotky se nepodařilo nahrát.')
        return
      }

      setFiles([])
      setError(null)
      onUploaded()
    })
  }

  return (
    <SimpleModal isOpen={isOpen} title="Nahrát fotky" onClose={onClose} className="soubory-page__upload-modal max-w-xl">
      <div className="soubory-page__upload-modal__body px-5 py-4">
        <label className="soubory-page__upload-modal__label mb-2 block text-sm font-medium text-gray-700">Fotky</label>
        <input
          type="file"
          multiple
          accept="image/*,.heic,.heif"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          className="soubory-page__upload-modal__file block w-full text-sm text-gray-900 file:mr-3 file:rounded-xl file:border file:border-white/75 file:bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-800 file:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.09)]"
        />

        <p className="soubory-page__upload-modal__hint mt-2 text-xs text-gray-500">Povoleny jsou jen obrázky. Max. 5 MB na soubor.</p>

        {files.length > 0 ? (
          <div className="soubory-page__upload-modal__selection mt-3 rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-sm text-gray-700">
            Vybráno souborů: {files.length}
          </div>
        ) : null}

        {error ? <div className="soubory-page__upload-modal__error mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      </div>

      <div className="soubory-page__upload-modal__footer flex items-center justify-end gap-2 border-t border-white/70 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="soubory-page__upload-modal__cancel inline-flex h-11 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
        >
          Zrušit
        </button>
        <button
          type="button"
          disabled={isPending || files.length === 0}
          onClick={submit}
          className="soubory-page__upload-modal__submit inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
        >
          {isPending ? 'Nahrávám…' : 'Nahrát fotky'}
        </button>
      </div>
    </SimpleModal>
  )
}

function RenameFolderModal({
  isOpen,
  folderName,
  onClose,
  onRenamed,
  folderId,
}: {
  isOpen: boolean
  folderName: string
  onClose: () => void
  onRenamed: () => void
  folderId: string
}) {
  const [name, setName] = useState(folderName)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function submit() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('name', name)

      const result = await renameConnectionPointFolderAction(folderId, formData)
      if (!result.success) {
        setError(result.error ?? 'Složku se nepodařilo přejmenovat.')
        return
      }

      onRenamed()
    })
  }

  return (
    <SimpleModal isOpen={isOpen} title="Přejmenovat složku" onClose={onClose} className="soubory-page__rename-modal max-w-xl">
      <div className="soubory-page__rename-modal__body px-5 py-4">
        <label className="soubory-page__rename-modal__label mb-2 block text-sm font-medium text-gray-700">Nový název</label>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={255}
          className="soubory-page__rename-modal__input h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
        />
        {error ? <div className="soubory-page__rename-modal__error mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      </div>

      <div className="soubory-page__rename-modal__footer flex items-center justify-end gap-2 border-t border-white/70 px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="soubory-page__rename-modal__cancel inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
        >
          Zrušit
        </button>
        <button
          type="button"
          disabled={isPending || name.trim().length === 0}
          onClick={submit}
          className="soubory-page__rename-modal__submit inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
        >
          {isPending ? 'Ukládám…' : 'Přejmenovat'}
        </button>
      </div>
    </SimpleModal>
  )
}

function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  onClose,
  onConfirm,
  destructive = false,
}: {
  isOpen: boolean
  title: string
  message: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
  destructive?: boolean
}) {
  useBodyScrollLock(isOpen)

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[130] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="soubory-page__confirm-modal w-full max-w-lg rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)]">
          <div className="soubory-page__confirm-modal__header flex items-start justify-between gap-4 border-b border-white/70 px-5 py-4">
            <h3 className="soubory-page__confirm-modal__title text-lg font-semibold tracking-tight text-gray-900">{title}</h3>
            <button
              type="button"
              onClick={onClose}
              className="soubory-page__confirm-modal__close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
            >
              ✕
            </button>
          </div>
          <div className="soubory-page__confirm-modal__body px-5 py-4 text-sm text-gray-600">{message}</div>
          <div className="soubory-page__confirm-modal__footer flex items-center justify-end gap-2 border-t border-white/70 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="soubory-page__confirm-modal__cancel inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`soubory-page__confirm-modal__confirm inline-flex h-11 items-center justify-center rounded-2xl border px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_12px_24px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] ${
                destructive
                  ? 'border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)]'
                  : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)]'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function LightboxModal({
  photo,
  onClose,
}: {
  photo: FolderPhoto | null
  onClose: () => void
}) {
  const isOpen = Boolean(photo)
  useBodyScrollLock(isOpen)

  if (!isOpen || typeof document === 'undefined' || !photo) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[135] bg-zinc-950/80 p-3 backdrop-blur-[8px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="flex h-full w-full max-w-6xl flex-col rounded-[28px] border border-white/25 bg-[linear-gradient(168deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0.04)_42%,rgba(255,255,255,0.02)_100%)] shadow-[0_34px_84px_rgba(0,0,0,0.46)]">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{photo.displayName}</div>
              <div className="truncate text-xs text-white/70">{formatDateTime(photo.createdAt)}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-sm font-medium text-white transition hover:bg-white/18"
            >
              ✕
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {photo.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo.signedUrl}
                alt={photo.displayName}
                className="max-h-[calc(100vh-140px)] max-w-full rounded-2xl object-contain shadow-[0_24px_50px_rgba(0,0,0,0.22)]"
              />
            ) : (
              <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white/80">
                Náhled se nepodařilo načíst.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function FolderDetailClient({ folder, uploadGroups, comments, canEdit }: FolderDetailClientProps) {
  const router = useRouter()
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [isRenameOpen, setIsRenameOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [commentBody, setCommentBody] = useState('')
  const [commentError, setCommentError] = useState<string | null>(null)
  const [selectedPhoto, setSelectedPhoto] = useState<FolderPhoto | null>(null)
  const [editingComment, setEditingComment] = useState<FolderComment | null>(null)
  const [deletingComment, setDeletingComment] = useState<FolderComment | null>(null)
  const [isPending, startTransition] = useTransition()
  const photoCount = uploadGroups.reduce((sum, group) => sum + group.photos.length, 0)
  const uploadCount = uploadGroups.length
  const commentCount = comments.length

  function refresh() {
    router.refresh()
  }

  function submitComment() {
    const body = commentBody.trim()
    if (!body) {
      setCommentError('Komentář nesmí být prázdný.')
      return
    }

    if (body.length > 5000) {
      setCommentError('Komentář může mít maximálně 5000 znaků.')
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('body', body)
      const result = await createConnectionPointFolderCommentAction(folder.id, formData)
      if (!result.success) {
        setCommentError(result.error ?? 'Komentář se nepodařilo uložit.')
        return
      }

      setCommentBody('')
      setCommentError(null)
      refresh()
    })
  }

  return (
    <>
      <main className="soubory-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
        <div
          aria-hidden
          className="soubory-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
        />
        <div
          aria-hidden
          className="soubory-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
        />
        <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
          <section className="soubory-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-900">
                  {folder.name}
                </h1>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span>Vytvořeno {formatDateTime(folder.createdAt)}</span>
                  <span>•</span>
                  <span>Upraveno {formatDateTime(folder.updatedAt)}</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <div className="soubory-page__hero-stat rounded-2xl border border-white/75 bg-white/88 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                    <span className="font-semibold text-gray-900">{photoCount}</span> fotek
                  </div>
                  <div className="soubory-page__hero-stat rounded-2xl border border-white/75 bg-white/88 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                    <span className="font-semibold text-gray-900">{commentCount}</span> komentářů
                  </div>
                  <div className="soubory-page__hero-stat rounded-2xl border border-white/75 bg-white/88 px-3 py-2 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                    <span className="font-semibold text-gray-900">{uploadCount}</span> uploadů
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2">
                <Link
                  href="/pripojne-body"
                  className="clients-page__back-button soubory-page__back-button inline-flex w-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 sm:w-auto"
                >
                  ZPĚT NA PŘEHLED
                </Link>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsRenameOpen(true)}
                        className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_26px_rgba(15,23,42,0.12)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#d6dee8] hover:bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(246,248,251,0.92)_100%)]"
                      >
                        Přejmenovat složku
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsDeleteOpen(true)}
                        className="inline-flex items-center justify-center rounded-2xl border border-red-400/85 bg-[linear-gradient(160deg,#ef4444_0%,#dc2626_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_12px_26px_rgba(185,28,28,0.26)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-red-500 hover:bg-[linear-gradient(160deg,#f05252_0%,#d91f1f_100%)]"
                      >
                        Smazat složku
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.22fr)_420px]">
            <div className="soubory-page__photos-panel min-w-0 rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <div className="soubory-page__photos-panel__header mb-4 flex items-start justify-between gap-3 border-b border-white/70 pb-4">
                <div>
                  <h2 className="soubory-page__photos-panel__title text-sm font-semibold uppercase tracking-[0.12em] text-gray-900">
                    Fotky
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(true)}
                  className="soubory-page__photos-panel__upload-button inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]"
                >
                  Nahrát fotky
                </button>
              </div>

              {uploadGroups.length === 0 ? (
                <div className="soubory-page__photos-panel__empty rounded-2xl border border-dashed border-white/70 bg-white/60 p-8 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.05)]">
                  Zatím tu nejsou žádné fotky.
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {uploadGroups.map((group, index) => (
                    <div
                      key={group.id}
                      className={`soubory-page__photos-panel__group rounded-3xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] ${
                        index === 0
                          ? 'border-[#9dc7e5] bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(239,246,253,0.92)_100%)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] opacity-92'
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-gray-900">
                            Upload {group.createdAt ? formatDateTime(group.createdAt) : '—'}
                          </div>
                          <div className="soubory-page__photos-panel__group-meta text-xs text-gray-500">{group.photos.length} fotek v boxu</div>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {group.photos.map((photo) => (
                          <button
                            key={photo.id}
                            type="button"
                            onClick={() => setSelectedPhoto(photo)}
                            className="soubory-page__photos-panel__photo-card group overflow-hidden rounded-2xl border border-white/75 bg-white/90 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(39,39,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                          >
                            <div className="aspect-square overflow-hidden bg-zinc-100">
                              {photo.signedUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={photo.signedUrl}
                                  alt={photo.displayName}
                                  className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                                />
                              ) : (
                                <div className="flex h-full items-center justify-center bg-[linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(241,245,249,0.9)_100%)] text-xs text-gray-500">
                                  Náhled není dostupný
                                </div>
                              )}
                            </div>
                            <div className="p-3">
                              <div className="truncate text-sm font-semibold text-gray-900">
                                {photo.displayName}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                {formatDateTime(photo.createdAt)} · {formatBytes(photo.fileSizeBytes)}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <aside className="soubory-page__comments-panel min-w-0 rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
              <div className="soubory-page__comments-panel__header mb-4 border-b border-white/70 pb-4">
                <h2 className="soubory-page__comments-panel__title text-sm font-semibold uppercase tracking-[0.12em] text-gray-900">
                  Komentáře
                </h2>
              </div>

              <div className="soubory-page__comments-panel__composer rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.92)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
                <textarea
                  value={commentBody}
                  onChange={(event) => {
                    setCommentBody(event.target.value)
                    setCommentError(null)
                  }}
                  maxLength={5000}
                  rows={6}
                  placeholder="Napiš komentář..."
                  className="soubory-page__comments-panel__textarea w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                />
                <div className="soubory-page__comments-panel__composer-footer mt-2 flex items-center justify-between text-xs text-gray-500">
                  <span>{commentBody.length}/5000</span>
                  <button
                    type="button"
                    onClick={submitComment}
                    disabled={isPending}
                    className="soubory-page__comments-panel__submit inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)] disabled:opacity-40"
                  >
                    {isPending ? 'Odesílám…' : 'Odeslat komentář'}
                  </button>
                </div>
                {commentError ? (
                  <div className="soubory-page__comments-panel__error mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {commentError}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 space-y-3">
                {comments.length === 0 ? (
                  <div className="soubory-page__comments-panel__empty rounded-2xl border border-dashed border-white/70 bg-white/60 p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.05)]">
                    Zatím tu nejsou žádné komentáře.
                  </div>
                ) : (
                  comments.map((comment, index) => (
                    <div
                      key={comment.id}
                      className={`soubory-page__comments-panel__card rounded-3xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] ${
                        index === 0
                          ? 'border-[#9dc7e5] bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(240,247,253,0.92)_100%)]'
                          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] opacity-85'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-900">{comment.createdByName}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {formatDateTime(comment.createdAt)}
                            {comment.isEdited && comment.editedAt ? ` · upraveno ${formatDateTime(comment.editedAt)}` : ''}
                          </div>
                        </div>
                        {canEdit ? (
                          <div className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingComment(comment)}
                              className="soubory-page__comments-panel__edit inline-flex h-8 items-center justify-center rounded-xl border border-white/75 bg-white/85 px-3 text-xs font-semibold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition hover:-translate-y-[1px]"
                            >
                              Upravit
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingComment(comment)}
                              className="soubory-page__comments-panel__delete inline-flex h-8 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-xs font-semibold uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(185,28,28,0.12)] transition hover:-translate-y-[1px]"
                            >
                              Smazat
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="soubory-page__comments-panel__body mt-3 whitespace-pre-wrap rounded-2xl border border-white/75 bg-white/80 p-3 text-sm leading-6 text-gray-800">
                        {comment.body}
                      </div>
                      {comment.isEdited && comment.editedByName ? (
                        <div className="mt-2 text-[11px] text-gray-400">
                          Upravil {comment.editedByName}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </aside>
          </section>
        </div>
      </main>

      {isUploadOpen ? (
        <UploadPhotosModal
          isOpen={isUploadOpen}
          folderId={folder.id}
          onClose={() => setIsUploadOpen(false)}
          onUploaded={() => {
            setIsUploadOpen(false)
            refresh()
          }}
        />
      ) : null}

      {isRenameOpen ? (
        <RenameFolderModal
          isOpen={isRenameOpen}
          folderName={folder.name}
          folderId={folder.id}
          onClose={() => setIsRenameOpen(false)}
          onRenamed={() => {
            setIsRenameOpen(false)
            refresh()
          }}
        />
      ) : null}

      {isDeleteOpen ? (
        <ConfirmModal
          isOpen={isDeleteOpen}
          title="Smazat složku"
          message="Opravdu chceš smazat tuto složku? Smaže se i její obsah včetně fotek a komentářů."
          confirmLabel="Smazat složku"
          destructive
          onClose={() => setIsDeleteOpen(false)}
          onConfirm={() => {
            startTransition(async () => {
              const result = await deleteConnectionPointFolderAction(folder.id)
              if (!result.success) {
                setIsDeleteOpen(false)
                return
              }
              router.push('/pripojne-body')
            })
          }}
        />
      ) : null}

      {deletingComment ? (
        <ConfirmModal
          isOpen={Boolean(deletingComment)}
          title="Smazat komentář"
          message="Opravdu chceš smazat tento komentář?"
          confirmLabel="Smazat komentář"
          destructive
          onClose={() => setDeletingComment(null)}
          onConfirm={() => {
            const comment = deletingComment
            if (!comment) return

            startTransition(async () => {
              const result = await deleteConnectionPointFolderCommentAction(comment.id)
              setDeletingComment(null)
              if (result.success) {
                refresh()
              }
            })
          }}
        />
      ) : null}

      {selectedPhoto ? <LightboxModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} /> : null}

      {editingComment ? (
        <CommentEditModal
          comment={editingComment}
          onClose={() => setEditingComment(null)}
          onSaved={() => {
            setEditingComment(null)
            refresh()
          }}
        />
      ) : null}
    </>
  )
}

function CommentEditModal({
  comment,
  onClose,
  onSaved,
}: {
  comment: FolderComment | null
  onClose: () => void
  onSaved: () => void
}) {
  const [body, setBody] = useState(comment?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useBodyScrollLock(Boolean(comment))

  if (!comment || typeof document === 'undefined') return null

  function submit() {
    if (!comment) return

    const trimmed = body.trim()
    if (!trimmed) {
      setError('Komentář nesmí být prázdný.')
      return
    }

    const currentComment = comment

    startTransition(async () => {
      const formData = new FormData()
      formData.set('body', trimmed)
      const result = await updateConnectionPointFolderCommentAction(currentComment.id, formData)
      if (!result.success) {
        setError(result.error ?? 'Komentář se nepodařilo upravit.')
        return
      }
      onSaved()
    })
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[132] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-2xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)]">
          <div className="flex items-start justify-between gap-4 border-b border-white/70 px-5 py-4">
            <h3 className="text-lg font-semibold tracking-tight text-gray-900">Upravit komentář</h3>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
            >
              ✕
            </button>
          </div>
          <div className="px-5 py-4">
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              maxLength={5000}
              rows={7}
              className="w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
            />
            {error ? <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-white/70 px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
            >
              Zrušit
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
            >
              {isPending ? 'Ukládám…' : 'Uložit'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
