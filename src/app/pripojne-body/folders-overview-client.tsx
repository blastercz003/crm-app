'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useModalMotionClose } from '@/components/ui/modal-motion'
import { createConnectionPointFolderAction } from './actions'

type FolderOverviewItem = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  photoCount: number
  commentCount: number
}

type FoldersOverviewClientProps = {
  folders: FolderOverviewItem[]
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function CreateFolderModal({
  isOpen,
  onClose: closeImmediately,
  onCreated,
}: {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const onClose = useModalMotionClose(closeImmediately)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canSubmit = useMemo(() => name.trim().length > 0 && !isPending, [isPending, name])

  if (!isOpen || typeof document === 'undefined') return null

  function submit() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('name', name)

      const result = await createConnectionPointFolderAction(formData)
      if (!result.success) {
        setError(result.error ?? 'Složku se nepodařilo vytvořit.')
        return
      }

      setName('')
      setError(null)
      onCreated()
    })
  }

  return createPortal(
    <div
      data-modal-motion-root
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-3 backdrop-blur-[8px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
        <div data-modal-motion-surface className="soubory-page__create-folder-modal w-full max-w-xl rounded-3xl border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_34px_84px_rgba(24,24,27,0.30)] max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:p-6">
          <div className="soubory-page__create-folder-modal__header flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div>
              <ModalHeading section="Přípojné body" title="Nová složka" />
              <p className="soubory-page__create-folder-modal__hint mt-1 text-sm text-gray-500">
                Zadej název nové složky, ve formátu: Firma Město, Ulice.
              </p>
            </div>
          <button
            type="button"
            onClick={onClose}
            className="soubory-page__create-folder-modal__close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
            aria-label="Zavřít"
          >
            ✕
          </button>
        </div>

        <div className="soubory-page__create-folder-modal__body mt-4">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="soubory-page__create-folder-modal__input h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
            placeholder="např. Penny Poděbrady, Alšova"
            maxLength={255}
            autoFocus
          />
        </div>

        {error ? (
          <div className="soubory-page__create-folder-modal__error mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="soubory-page__create-folder-modal__footer mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="soubory-page__create-folder-modal__cancel inline-flex h-11 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
          >
            Zrušit
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="soubory-page__create-folder-modal__submit inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-40"
          >
            {isPending ? 'Vytvářím…' : 'Vytvořit'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function FoldersOverviewClient({ folders }: FoldersOverviewClientProps) {
  const router = useRouter()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  return (
    <>
      <section className="soubory-page__folders-panel rounded-3xl border border-[color:var(--surface-border)] bg-[var(--surface)] p-4 text-[color:var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
        <div className="mb-4 flex flex-col gap-3 border-b border-[color:var(--surface-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="soubory-page__folders-panel__title text-sm font-semibold uppercase tracking-[0.12em] text-[color:var(--text-primary)]">
              Složky
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="soubory-page__folders-panel__create-button inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]"
          >
            NOVÁ SLOŽKA
          </button>
        </div>

        {folders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[color:var(--surface-border)] bg-[color:var(--surface-muted)] p-8 text-sm text-[color:var(--text-secondary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            Zatím tu nejsou žádné složky.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {folders.map((folder) => (
              <Link
                key={folder.id}
                href={`/pripojne-body/${folder.id}`}
                className="soubory-page__folders-panel__card group overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[var(--surface-strong)] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_18px_rgba(39,39,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:border-[#9dc7e5] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_14px_26px_rgba(39,39,42,0.12)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="soubory-page__folders-panel__folder-name block w-full truncate text-base font-semibold text-[color:var(--text-primary)]">
                      {folder.name}
                    </div>
                    <div className="soubory-page__folders-panel__updated mt-1 text-xs text-[color:var(--text-secondary)]">
                      Upraveno {formatDateTime(folder.updatedAt)}
                    </div>
                  </div>

                  <div className="soubory-page__folders-panel__open-button inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-3 py-2 text-xs font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.28)] transition duration-200 ease-out group-hover:-translate-y-[1px] group-hover:border-[#1f5f8e] group-hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]">
                    OTEVŘÍT
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3 text-sm text-[color:var(--text-secondary)]">
                  <div className="soubory-page__folders-panel__meta-badge rounded-xl border border-[color:var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                    <span className="font-semibold text-[color:var(--text-primary)]">{folder.photoCount}</span>{' '}
                    fotek
                  </div>
                  <div className="soubory-page__folders-panel__meta-badge rounded-xl border border-[color:var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                    <span className="font-semibold text-[color:var(--text-primary)]">{folder.commentCount}</span>{' '}
                    komentářů
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <CreateFolderModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => {
          setIsCreateOpen(false)
          router.refresh()
        }}
      />
    </>
  )
}
