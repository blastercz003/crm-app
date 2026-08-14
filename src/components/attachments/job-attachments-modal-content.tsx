'use client'

import type { ReactNode, RefObject } from 'react'
import { ModalHeading } from '@/components/ui/modal-heading'

export type JobAttachmentCategoryOption = {
  value: 'predavaci_protokol' | 'foto' | 'jine'
  label: string
}

export type JobAttachmentCategory = JobAttachmentCategoryOption['value']

export type JobAttachment = {
  id: string
  jobId: string
  fileName: string
  displayName: string
  storageBucket: string
  storagePath: string
  mimeType: string | null
  fileSizeBytes: number
  category: JobAttachmentCategory
  note: string | null
  uploadedBy: string | null
  createdAt: string
}

export type SecondaryAttachmentItem = {
  id: string
  fileName: string
  fileSizeBytes: number
  createdAt: string
}

export type JobAttachmentsModalContentProps = {
  section?: string
  title?: string
  jobBadgeLabel?: string
  showJobBadge?: boolean
  jobNumber: string
  attachmentsHeading?: string
  items: JobAttachment[]
  isLoading: boolean
  isPending: boolean
  errorMessage: string | null
  categoryValue: JobAttachmentCategory
  categoryOptions: JobAttachmentCategoryOption[]
  selectedFiles: File[]
  fileInputRef: RefObject<HTMLInputElement | null>
  topContent?: ReactNode
  headerContent?: ReactNode
  secondarySectionDescription?: ReactNode
  secondaryItems?: SecondaryAttachmentItem[]
  secondaryEmptyMessage?: string
  secondarySectionVisible?: boolean
  showCategorySelect?: boolean
  uploadButtonLabel?: string
  onCategoryChange: (value: JobAttachmentCategory) => void
  onFilesChange: (files: File[]) => void
  onClose: () => void
  onUpload: () => void
  onOpenAttachment: (attachmentId: string) => void
  onDownloadAttachment: (attachmentId: string) => void
  onDeleteAttachment: (attachmentId: string, displayName: string) => void
  onOpenSecondaryAttachment?: (attachmentId: string) => void
  onDownloadSecondaryAttachment?: (attachmentId: string) => void
  showDeleteAttachment?: boolean
}

function formatFileSize(fileSizeBytes: number) {
  if (fileSizeBytes < 1024) {
    return `${fileSizeBytes} B`
  }

  if (fileSizeBytes < 1024 * 1024) {
    return `${(fileSizeBytes / 1024).toFixed(1)} KB`
  }

  return `${(fileSizeBytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatAttachmentCategory(
  category: JobAttachmentCategory,
  categoryOptions: JobAttachmentCategoryOption[]
) {
  return categoryOptions.find((item) => item.value === category)?.label ?? category
}

export function JobAttachmentsModalContent({
  section = 'ZAKÁZKY',
  title = 'Přílohy zakázky',
  jobBadgeLabel,
  showJobBadge = true,
  jobNumber,
  items,
  isLoading,
  isPending,
  errorMessage,
  categoryValue,
  categoryOptions,
  selectedFiles,
  fileInputRef,
  topContent,
  headerContent,
  secondarySectionDescription,
  secondaryItems = [],
  secondaryEmptyMessage = 'Zatím nejsou nahrané žádné podklady k objednávce.',
  secondarySectionVisible = false,
  showCategorySelect = true,
  uploadButtonLabel = 'Nahrát soubory',
  onCategoryChange,
  onFilesChange,
  onClose,
  onUpload,
  onOpenAttachment,
  onDownloadAttachment,
  onDeleteAttachment,
  onOpenSecondaryAttachment,
  onDownloadSecondaryAttachment,
  showDeleteAttachment = true,
}: JobAttachmentsModalContentProps) {
  return (
    <div
      className="jobs-page__info-modal__overlay fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center">
        <div className="jobs-page__info-modal__attachments-shell flex max-h-[calc(100vh-2rem)] w-full max-w-[960px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <ModalHeading section={section} title={title} />
                {showJobBadge ? (
                  <div className="mt-2 flex justify-start">
                    <span className="inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.26)]">
                      {jobBadgeLabel ?? `ZAKÁZKA ${jobNumber}`}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="flex items-start gap-3">
                {headerContent ? <div className="pt-0.5">{headerContent}</div> : null}

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="jobs-page__info-modal__attachments-close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Zavřít modal"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-6">
            {topContent ? <div className="mb-3">{topContent}</div> : null}

            <div className="jobs-page__info-modal__upload rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className={`grid gap-3 ${showCategorySelect ? 'md:grid-cols-3' : 'md:grid-cols-1'}`}>
                <div className={showCategorySelect ? 'md:col-span-2' : ''}>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Soubory
                  </label>
                  <label className="jobs-page__info-modal__file-picker relative flex h-10 w-full cursor-pointer items-center rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 py-2 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 hover:-translate-y-[1px]">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                      disabled={isPending}
                      onChange={(event) => onFilesChange(Array.from(event.target.files ?? []))}
                      className="absolute h-px w-px overflow-hidden opacity-0 pointer-events-none"
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <span className="block w-full truncate">
                      {selectedFiles.length > 0
                        ? selectedFiles.length === 1
                          ? selectedFiles[0]?.name
                          : `Vybráno souborů: ${selectedFiles.length}`
                        : 'Vyber soubor pro nahrání'}
                    </span>
                  </label>
                </div>

                {showCategorySelect ? (
                  <div className="relative">
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Kategorie
                    </label>
                    <select
                      value={categoryValue}
                      onChange={(event) => onCategoryChange(event.target.value as JobAttachmentCategory)}
                      disabled={isPending}
                      className="jobs-page__info-modal__category-select h-10 w-full appearance-none rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 pr-10 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                    >
                      {categoryOptions.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <span
                      className="jobs-page__info-modal__category-chevron pointer-events-none absolute bottom-0 right-3 flex h-10 items-center text-sm text-gray-500"
                      aria-hidden="true"
                    >
                      ▾
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-gray-500">Max. velikost jednoho souboru je 5 MB.</p>
                <button
                  type="button"
                  onClick={onUpload}
                  disabled={isPending || selectedFiles.length === 0}
                  className={`jobs-page__info-modal__upload-button inline-flex h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 md:min-w-[176px] md:w-auto ${
                    isPending ? 'jobs-page__info-modal__upload-button--uploading' : ''
                  }`}
                  aria-live="polite"
                >
                  <span>{isPending ? 'Nahrávání' : uploadButtonLabel}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {errorMessage ? (
              <div className="jobs-page__info-modal__error mb-3 rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
                {errorMessage}
              </div>
            ) : null}

            <div className="grid gap-3 md:hidden">
              {!isLoading && items.length === 0 ? (
                <div className="jobs-page__info-modal__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-6 text-center text-sm text-gray-500">
                  Zatím nejsou nahrané žádné přílohy.
                </div>
              ) : null}

              {items.map((item) => (
                <div
                  key={item.id}
                  className="jobs-page__info-modal__attachment-card min-w-0 max-w-full overflow-hidden rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p
                        className="block w-full truncate text-sm font-semibold text-gray-900"
                        title={item.displayName}
                      >
                        {item.displayName}
                      </p>
                    </div>
                    <span
                      className="max-w-[42%] truncate rounded-full border border-[#76a9d3]/65 bg-[linear-gradient(155deg,rgba(79,146,203,0.14)_0%,rgba(58,126,184,0.1)_100%)] px-2.5 py-1 text-[11px] font-semibold text-[#2f78b1]"
                      title={formatAttachmentCategory(item.category, categoryOptions)}
                    >
                      {formatAttachmentCategory(item.category, categoryOptions)}
                    </span>
                  </div>

                  <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[12px] leading-5 text-gray-600">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline gap-1">
                        <span className="shrink-0 font-medium text-gray-900">Velikost:</span>
                        <span className="min-w-0 truncate whitespace-nowrap">
                          {formatFileSize(item.fileSizeBytes)}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-baseline justify-end gap-1 text-right">
                        <span className="shrink-0 font-medium text-gray-900">Nahráno:</span>
                        <span className="min-w-0 truncate whitespace-nowrap">
                          {formatDateTime(item.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`mt-4 grid min-w-0 w-full gap-2 ${
                      showDeleteAttachment ? 'grid-cols-3' : 'grid-cols-2'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenAttachment(item.id)}
                      disabled={isPending}
                      className="jobs-page__info-modal__attachment-open inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      OTEVŘÍT
                    </button>
                    <button
                      type="button"
                      onClick={() => onDownloadAttachment(item.id)}
                      disabled={isPending}
                      className="jobs-page__info-modal__attachment-download inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 py-1.5 text-[11px] font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      STÁHNOUT
                    </button>
                    {showDeleteAttachment ? (
                      <button
                        type="button"
                        onClick={() => onDeleteAttachment(item.id, item.displayName)}
                        disabled={isPending}
                        className="jobs-page__info-modal__attachment-delete inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 py-1.5 text-[11px] font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                      >
                        SMAZAT
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="jobs-page__info-modal__attachment-card hidden overflow-x-auto rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] md:block">
              <table className="w-full table-fixed bg-transparent">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    <th className="px-3 py-3">Název</th>
                    <th className="w-[120px] px-3 py-3">Kategorie</th>
                    <th className="w-[100px] px-3 py-3 text-right">Velikost</th>
                    <th className="w-[160px] px-3 py-3">Nahráno</th>
                    <th className="w-[380px] px-3 py-3 text-right">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {!isLoading && items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">
                        Zatím nejsou nahrané žádné přílohy.
                      </td>
                    </tr>
                  ) : null}

                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-white/70">
                      <td className="max-w-0 px-3 py-2">
                        <span
                          className="block w-full truncate text-sm text-gray-900"
                          title={item.displayName}
                        >
                          {item.displayName}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {formatAttachmentCategory(item.category, categoryOptions)}
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-700">
                        {formatFileSize(item.fileSizeBytes)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        <span
                          className="block max-w-[160px] truncate whitespace-nowrap"
                          title={formatDateTime(item.createdAt)}
                        >
                          {formatDateTime(item.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => onOpenAttachment(item.id)}
                            disabled={isPending}
                            className="jobs-page__info-modal__attachment-open shrink-0 rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1.5 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                          >
                            OTEVŘÍT
                          </button>
                          <button
                            type="button"
                            onClick={() => onDownloadAttachment(item.id)}
                            disabled={isPending}
                            className="jobs-page__info-modal__attachment-download shrink-0 rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                            >
                              STÁHNOUT
                          </button>
                          {showDeleteAttachment ? (
                            <button
                              type="button"
                              onClick={() => onDeleteAttachment(item.id, item.displayName)}
                              disabled={isPending}
                              className="jobs-page__info-modal__attachment-delete shrink-0 rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                            >
                              SMAZAT
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {secondarySectionVisible ? (
              <div className="mt-6">
                {secondarySectionDescription ? (
                  <div className="mb-3 text-sm text-gray-600">{secondarySectionDescription}</div>
                ) : null}

                <div className="grid gap-3 md:hidden">
                  {!isLoading && secondaryItems.length === 0 ? (
                    <div className="jobs-page__info-modal__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-6 text-center text-sm text-gray-500">
                      {secondaryEmptyMessage}
                    </div>
                  ) : null}

                  {secondaryItems.map((item) => (
                    <div
                      key={item.id}
                      className="jobs-page__info-modal__attachment-card min-w-0 max-w-full overflow-hidden rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                    >
                      <div className="min-w-0">
                        <p
                          className="block w-full truncate text-sm font-semibold text-gray-900"
                          title={item.fileName}
                        >
                          {item.fileName}
                        </p>
                      </div>

                      <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-[12px] leading-5 text-gray-600">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-baseline gap-1">
                            <span className="shrink-0 font-medium text-gray-900">Velikost:</span>
                            <span className="min-w-0 truncate whitespace-nowrap">
                              {formatFileSize(item.fileSizeBytes)}
                            </span>
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-baseline justify-end gap-1 text-right">
                            <span className="shrink-0 font-medium text-gray-900">Nahráno:</span>
                            <span className="min-w-0 truncate whitespace-nowrap">
                              {formatDateTime(item.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid min-w-0 w-full grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenSecondaryAttachment?.(item.id)}
                          disabled={isPending}
                          className="jobs-page__info-modal__attachment-open inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                        >
                          OTEVŘÍT
                        </button>
                        <button
                          type="button"
                          onClick={() => onDownloadSecondaryAttachment?.(item.id)}
                          disabled={isPending}
                          className="jobs-page__info-modal__attachment-download inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 py-1.5 text-[11px] font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                        >
                          STÁHNOUT
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="jobs-page__info-modal__attachment-card mt-3 hidden overflow-x-auto rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] md:block">
                  <table className="w-full table-fixed bg-transparent">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        <th className="px-3 py-3">Název</th>
                        <th className="w-[100px] px-3 py-3 text-right">Velikost</th>
                        <th className="w-[160px] px-3 py-3">Nahráno</th>
                        <th className="w-[220px] px-3 py-3 text-right">Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!isLoading && secondaryItems.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-500">
                            {secondaryEmptyMessage}
                          </td>
                        </tr>
                      ) : null}

                      {secondaryItems.map((item) => (
                        <tr key={item.id} className="border-t border-white/70">
                          <td className="max-w-0 px-3 py-2">
                            <span
                              className="block w-full truncate text-sm text-gray-900"
                              title={item.fileName}
                            >
                              {item.fileName}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-sm text-gray-700">
                            {formatFileSize(item.fileSizeBytes)}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-700">
                            <span
                              className="block max-w-[160px] truncate whitespace-nowrap"
                              title={formatDateTime(item.createdAt)}
                            >
                              {formatDateTime(item.createdAt)}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => onOpenSecondaryAttachment?.(item.id)}
                                disabled={isPending}
                                className="jobs-page__info-modal__attachment-open shrink-0 rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1.5 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                              >
                                OTEVŘÍT
                              </button>
                              <button
                                type="button"
                                onClick={() => onDownloadSecondaryAttachment?.(item.id)}
                                disabled={isPending}
                                className="jobs-page__info-modal__attachment-download shrink-0 rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                              >
                                STÁHNOUT
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
