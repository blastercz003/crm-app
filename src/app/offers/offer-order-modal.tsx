'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  finalizeOfferOrderedStatusAction,
  getOfferOrderData,
  openOfferOrderFileAction,
  saveOfferOrderReferenceAction,
  uploadOfferOrderFileAction,
  type OfferOrderData,
} from '@/app/offers/actions'
import type { OfferStatus } from '@/lib/offers/types'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import { SuccessConfirmationModal } from '@/components/ui/success-confirmation-modal'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type OfferOrderFilePreviewTarget = {
  id: string
  fileName: string
  mimeType: string
}

function formatOfferOrderFileDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function isOfferOrderImage(mimeType: string) {
  return mimeType.toLowerCase().startsWith('image/')
}

function OfferOrderPdfPreview({ previewUrl }: { previewUrl: string }) {
  const [pages, setPages] = useState<Array<{ src: string; width: number; height: number }>>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderPdf() {
      setIsLoading(true)
      setError(null)
      setPages([])

      try {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString()

        const pdfDocument = await pdfjs.getDocument(previewUrl).promise
        if (cancelled) {
          await pdfDocument.destroy()
          return
        }

        const renderedPages: Array<{ src: string; width: number; height: number }> = []
        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber)
          if (cancelled) return

          const viewport = page.getViewport({ scale: 1.35 })
          const canvas = document.createElement('canvas')
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Canvas není dostupný.')

          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          await page.render({ canvas, canvasContext: context, viewport }).promise
          if (cancelled) return

          renderedPages.push({
            src: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
          })
        }

        await pdfDocument.destroy()
        if (!cancelled) {
          setPages(renderedPages)
          setIsLoading(false)
        }
      } catch {
        if (!cancelled) {
          setError('Náhled PDF se nepodařilo vykreslit.')
          setIsLoading(false)
        }
      }
    }

    void renderPdf()
    return () => {
      cancelled = true
    }
  }, [previewUrl])

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">Načítám náhled…</div>
  }

  if (error) {
    return <div className="flex h-full items-center justify-center px-5 text-center text-sm text-red-700 [html[data-theme='dark']_&]:text-red-200">{error}</div>
  }

  return (
    <div className="h-full overflow-y-auto p-2 sm:p-3">
      <div className="space-y-3">
        {pages.map((page, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${index + 1}-${page.src.length}`}
            src={page.src}
            alt={`PDF strana ${index + 1}`}
            className="w-full rounded-lg border border-zinc-200 bg-white shadow-sm [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)]"
          />
        ))}
      </div>
    </div>
  )
}

function OfferOrderFilePreviewModal({
  file,
  previewUrl,
  previewError,
  isLoading,
  onClose,
}: {
  file: OfferOrderFilePreviewTarget
  previewUrl: string | null
  previewError: string | null
  isLoading: boolean
  onClose: () => void
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
    <div
      className="fixed inset-0 z-[1000] overflow-hidden p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offer-order-file-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-zinc-950/55 backdrop-blur-[5px]" />
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="flex h-full max-h-[920px] w-full max-w-[1040px] flex-col overflow-hidden rounded-[26px] border border-zinc-200/90 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(243,247,251,0.94)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_36px_90px_rgba(15,23,42,0.34)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(13,20,34,0.99)_0%,rgba(8,14,25,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_36px_90px_rgba(2,6,23,0.62)]">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200/80 px-4 py-3 sm:px-5 sm:py-4 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
              <ModalHeading
                section="NABÍDKY"
                title={file.fileName}
                id="offer-order-file-preview-title"
                variant="compact"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Zavřít náhled"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white/85 text-lg text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(15,23,42,0.08)] transition hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.92)] [html[data-theme='dark']_&]:text-slate-200"
              >
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 bg-zinc-200/70 p-2 sm:p-3 [html[data-theme='dark']_&]:bg-[#050a13]">
              {previewError ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-5 text-center text-sm text-red-700 [html[data-theme='dark']_&]:border-red-900/40 [html[data-theme='dark']_&]:bg-red-950/25 [html[data-theme='dark']_&]:text-red-200">
                  {previewError}
                </div>
              ) : isLoading || !previewUrl ? (
                <div className="flex h-full items-center justify-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">Načítám náhled…</div>
              ) : file.mimeType.toLowerCase() === 'application/pdf' ? (
                <OfferOrderPdfPreview previewUrl={previewUrl} />
              ) : isOfferOrderImage(file.mimeType) ? (
                <div className="flex h-full items-center justify-center overflow-auto rounded-2xl bg-zinc-300/60 p-3 [html[data-theme='dark']_&]:bg-[#080e19]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl}
                    alt={file.fileName}
                    className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-[0_18px_50px_rgba(15,23,42,0.28)]"
                  />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-5 text-center text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                  Náhled není pro tento typ souboru dostupný.
                </div>
              )}
            </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

export function OfferOrderModal({
  isOpen,
  offerId,
  offerNumber,
  currentStatus,
  canFinalizeStatus,
  onClose,
  onStatusFinalized,
  onDataChanged,
  onError,
}: {
  isOpen: boolean
  offerId: string
  offerNumber: string
  currentStatus: OfferStatus
  canFinalizeStatus: boolean
  onClose: () => void
  onStatusFinalized: () => void
  onDataChanged?: (data: OfferOrderData) => void
  onError?: (message: string) => void
}) {
  const [orderData, setOrderData] = useState<OfferOrderData | null>(null)
  const [orderReference, setOrderReference] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploadPending, startUploadTransition] = useTransition()
  const [isFinalizePending, startFinalizeTransition] = useTransition()
  const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<OfferOrderFilePreviewTarget | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const { toast, isVisible, showToast } = useAnimatedActionToast()

  const hasFiles = (orderData?.files.length ?? 0) > 0
  const isReadOnly = currentStatus === 'realizace'

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return

    let isActive = true

    async function loadOrderData() {
      setIsLoading(true)
      setLoadError(null)

      try {
        const data = await getOfferOrderData(offerId)
        if (!isActive) return
        setOrderData(data)
        setOrderReference(data.orderReference ?? '')
      } catch (error) {
        if (!isActive) return
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Nepodařilo se načíst podklady k objednávce.'
        )
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadOrderData()

    return () => {
      isActive = false
    }
  }, [isOpen, offerId])

  async function refreshOrderData() {
    const data = await getOfferOrderData(offerId)
    setOrderData(data)
    setOrderReference(data.orderReference ?? '')
    onDataChanged?.(data)
    return data
  }

  function emitError(message: string) {
    if (onError) {
      onError(message)
      return
    }

    showToast({
      title: 'CHYBA',
      message,
      tone: 'error',
    })
  }

  function handleUpload() {
    if (!selectedFile) {
      setUploadError('Vyber soubor k nahrání.')
      return
    }

    setUploadError(null)
    startUploadTransition(async () => {
      const formData = new FormData()
      formData.set('file', selectedFile)
      formData.set('order_reference', orderReference)

      const result = await uploadOfferOrderFileAction(offerId, formData)
      if (!result.success) {
        setUploadError(result.error)
        return
      }

      try {
        await refreshOrderData()
        setSelectedFile(null)
        setIsSuccessModalOpen(true)
      } catch (error) {
        emitError(
          error instanceof Error
            ? error.message
            : 'Podklady k objednávce byly nahrány, ale nepodařilo se obnovit data.'
        )
      }
    })
  }

  function handleFinalizeStatus() {
    startFinalizeTransition(async () => {
      try {
        const saveReferenceResult = await saveOfferOrderReferenceAction(offerId, orderReference)
        if (!saveReferenceResult.success) {
          emitError(saveReferenceResult.error)
          return
        }

        await finalizeOfferOrderedStatusAction(offerId)
        onStatusFinalized()
      } catch (error) {
        emitError(
          error instanceof Error
            ? error.message
            : 'Stav nabídky se nepodařilo změnit na Objednáno.'
        )
      }
    })
  }

  function handleOpenFile(file: OfferOrderFilePreviewTarget) {
    setPreviewTarget(file)
    setPreviewUrl(null)
    setPreviewError(null)
    setIsPreviewLoading(true)

    void (async () => {
      const result = await openOfferOrderFileAction(file.id)
      if (!result.success) {
        setPreviewError(result.error)
        setIsPreviewLoading(false)
        return
      }

      setPreviewUrl(result.signedUrl)
      setIsPreviewLoading(false)
    })()
  }

  function closeFilePreview() {
    setPreviewTarget(null)
    setPreviewUrl(null)
    setPreviewError(null)
    setIsPreviewLoading(false)
  }

  if (!isOpen || typeof document === 'undefined') return null

  return createPortal(
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
      <div
        className="offers-page__order-modal__overlay fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isUploadPending && !isFinalizePending) {
            onClose()
          }
        }}
      >
        <div className="flex h-full items-center justify-center">
          <div className="offers-page__order-modal relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_45%,rgba(236,243,249,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
            <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
            <div aria-hidden className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
            <div aria-hidden className="pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />

            <div className="offers-page__order-modal__header relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
              <div className="flex flex-col items-start">
                <ModalHeading section="NABÍDKY" title="Objednávka k nabídce" />
                <div className="offers-page__order-modal__number mt-1.5 inline-flex items-center rounded-full border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]">
                  {offerNumber}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isUploadPending || isFinalizePending}
                className="offers-page__order-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>

            {isLoading ? (
              <div className="offers-page__order-modal__loading relative rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-4 py-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
                Načítám podklady k objednávce…
              </div>
            ) : loadError ? (
              <div className="offers-page__order-modal__error relative rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                {loadError}
              </div>
            ) : (
              <div className="relative space-y-4">
                <div className="grid gap-2">
                  <label
                    htmlFor={`order-reference-${offerId}`}
                    className="offers-page__order-modal__label text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Číslo objednávky
                  </label>
                  <input
                    id={`order-reference-${offerId}`}
                    type="text"
                    value={orderReference}
                    onChange={(event) => setOrderReference(event.target.value)}
                    disabled={isReadOnly || isUploadPending || isFinalizePending}
                    placeholder="Volitelné číslo objednávky"
                    className="offers-page__order-modal__input h-11 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef] disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>

                {!isReadOnly ? (
                  <div className="offers-page__order-modal__section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.08)]">
                    <div className="grid gap-3">
                      <input
                        type="file"
                        accept="application/pdf,image/*"
                        disabled={isUploadPending || isFinalizePending}
                        onChange={(event) => {
                          const nextFile = event.target.files?.[0] ?? null
                          setSelectedFile(nextFile)
                          setUploadError(null)
                        }}
                        className="offers-page__order-modal__file-input block w-full text-sm text-gray-700 file:mr-3 file:rounded-xl file:border-0 file:bg-[#2f77af] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#286897]"
                      />
                      <div className="offers-page__order-modal__hint text-xs text-gray-500">
                        Povolené soubory: PDF nebo obrázek. Maximální velikost 2 MB.
                      </div>
                      {uploadError ? (
                        <div className="offers-page__order-modal__upload-error text-sm font-medium text-red-700">
                          {uploadError}
                        </div>
                      ) : null}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleUpload}
                          disabled={!selectedFile || isUploadPending || isFinalizePending}
                          className="offers-page__order-modal__primary-action inline-flex h-10 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isUploadPending ? 'Nahrávám…' : 'NAHRÁT SOUBOR'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="offers-page__order-modal__section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.08)]">
                  <div className="offers-page__order-modal__label mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Nahrané soubory
                  </div>

                  {hasFiles ? (
                    <div className="offers-page__order-modal__files space-y-3">
                      {orderData?.files.map((file) => (
                        <div
                          key={file.id}
                          className="offers-page__order-modal__file-card flex flex-col gap-3 rounded-xl border border-[#d6dee8] bg-white/80 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="offers-page__order-modal__file-name truncate text-sm font-semibold text-gray-900">
                              {file.fileName}
                            </div>
                            <div className="offers-page__order-modal__file-date mt-1 text-xs text-gray-500">
                              {formatOfferOrderFileDate(file.createdAt)}
                            </div>
                          </div>
                          <div className="offers-page__order-modal__file-actions flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenFile(file)}
                              disabled={isUploadPending || isFinalizePending}
                              className="offers-page__order-modal__file-action inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              ZOBRAZIT
                            </button>
                            <a
                              href={`/offers/order-files/${file.id}/download`}
                              download
                              className="offers-page__order-modal__file-action inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                            >
                              STÁHNOUT
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="offers-page__order-modal__empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
                      Zatím nejsou nahrané žádné soubory.
                    </div>
                  )}
                </div>

                {canFinalizeStatus ? (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleFinalizeStatus}
                      disabled={!hasFiles || isUploadPending || isFinalizePending}
                      className="offers-page__order-modal__finalize-action inline-flex h-10 items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isFinalizePending ? 'Ukládám…' : 'ULOŽIT STAV NABÍDKY'}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      <SuccessConfirmationModal
        isOpen={isSuccessModalOpen}
        section="Nabídky"
        title="Hotovo"
        message="Objednávka byla úspěšně nahrána."
        confirmLabel={canFinalizeStatus ? 'ULOŽIT STAV NABÍDKY' : 'ZAVŘÍT'}
        secondaryLabel="NAHRÁT DALŠÍ SOUBOR"
        onConfirm={() => {
          setIsSuccessModalOpen(false)
          if (canFinalizeStatus) {
            handleFinalizeStatus()
            return
          }
          onClose()
        }}
        onSecondary={() => {
          setIsSuccessModalOpen(false)
        }}
      />
      {previewTarget ? (
        <OfferOrderFilePreviewModal
          file={previewTarget}
          previewUrl={previewUrl}
          previewError={previewError}
          isLoading={isPreviewLoading}
          onClose={closeFilePreview}
        />
      ) : null}
    </>,
    document.body
  )
}

export function OfferOrderDetailPanel({
  offerId,
  offerNumber,
  currentStatus,
  canEdit,
}: {
  offerId: string
  offerNumber: string
  currentStatus: OfferStatus
  canEdit: boolean
}) {
  const [orderData, setOrderData] = useState<OfferOrderData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [previewTarget, setPreviewTarget] = useState<OfferOrderFilePreviewTarget | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const readOnly = currentStatus === 'realizace'

  useEffect(() => {
    let isActive = true

    async function loadData() {
      setIsLoading(true)
      try {
        const data = await getOfferOrderData(offerId)
        if (!isActive) return
        setOrderData(data)
      } catch (error) {
        if (!isActive) return
        showToast({
          title: 'CHYBA',
          message:
            error instanceof Error
              ? error.message
              : 'Nepodařilo se načíst podklady k objednávce.',
          tone: 'error',
        })
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isActive = false
    }
  }, [offerId, showToast])

  function handleOpenFile(file: OfferOrderFilePreviewTarget) {
    setPreviewTarget(file)
    setPreviewUrl(null)
    setPreviewError(null)
    setIsPreviewLoading(true)

    void (async () => {
      const result = await openOfferOrderFileAction(file.id)
      if (!result.success) {
        setPreviewError(result.error)
        setIsPreviewLoading(false)
        return
      }

      setPreviewUrl(result.signedUrl)
      setIsPreviewLoading(false)
    })()
  }

  function closeFilePreview() {
    setPreviewTarget(null)
    setPreviewUrl(null)
    setPreviewError(null)
    setIsPreviewLoading(false)
  }

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
      <section className="offers-detail-page__final-panel offers-detail-page__order-files-panel min-w-0 rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="offers-detail-page__order-files-title text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
              Podklady k objednávce
            </div>
            <div className="offers-detail-page__order-files-reference mt-2 text-sm text-gray-600">
              {orderData?.orderReference ? (
                <>
                  <span className="font-semibold text-gray-900">Číslo objednávky:</span>{' '}
                  {orderData.orderReference}
                </>
              ) : (
                'Číslo objednávky není vyplněno.'
              )}
            </div>
          </div>

          {canEdit && !readOnly ? (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="offers-detail-page__order-files-open inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px]"
            >
              OTEVŘÍT PODKLADY
            </button>
          ) : null}
        </div>

        <div className="offers-detail-page__order-files-list mt-4 space-y-3 border-t border-gray-100 pt-3">
          {isLoading ? (
            <div className="offers-detail-page__order-files-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
              Načítám podklady k objednávce…
            </div>
          ) : (orderData?.files.length ?? 0) > 0 ? (
            orderData?.files.map((file) => (
              <div
                key={file.id}
                className="offers-detail-page__order-files-card flex flex-col gap-3 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="offers-detail-page__order-files-name truncate text-sm font-semibold text-gray-800">
                    {file.fileName}
                  </div>
                  <div className="offers-detail-page__order-files-date mt-1 text-[11px] text-gray-500">
                    {formatOfferOrderFileDate(file.createdAt)}
                  </div>
                </div>
                <div className="offers-detail-page__order-files-actions flex flex-wrap justify-end gap-2 sm:ml-auto sm:justify-end">
                  <button
                    type="button"
                    onClick={() => handleOpenFile(file)}
                    className="offers-detail-page__order-files-action inline-flex h-9 min-w-[124px] items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    ZOBRAZIT
                  </button>
                  <a
                    href={`/offers/order-files/${file.id}/download`}
                    download
                    className="offers-detail-page__order-files-action inline-flex h-9 min-w-[124px] items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    STÁHNOUT
                  </a>
                </div>
              </div>
            ))
          ) : (
            <div className="offers-detail-page__order-files-empty rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
              Zatím nejsou nahrané žádné podklady k objednávce.
            </div>
          )}
        </div>
      </section>

      <OfferOrderModal
        isOpen={isModalOpen}
        offerId={offerId}
        offerNumber={offerNumber}
        currentStatus={currentStatus}
        canFinalizeStatus={false}
        onClose={() => setIsModalOpen(false)}
        onStatusFinalized={() => setIsModalOpen(false)}
        onDataChanged={(data) => setOrderData(data)}
        onError={(message) =>
          showToast({
            title: 'CHYBA',
            message,
            tone: 'error',
          })
        }
      />
      {previewTarget ? (
        <OfferOrderFilePreviewModal
          file={previewTarget}
          previewUrl={previewUrl}
          previewError={previewError}
          isLoading={isPreviewLoading}
          onClose={closeFilePreview}
        />
      ) : null}
    </>
  )
}

export function OfferOrderTransitionButton({
  offerId,
  offerNumber,
  currentStatus,
}: {
  offerId: string
  offerNumber: string
  currentStatus: OfferStatus
}) {
  const [isOpen, setIsOpen] = useState(false)
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const router = useRouter()

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="offers-detail-page__approval-button offers-detail-page__approval-button--ordered inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] transition duration-200 hover:-translate-y-[1px]"
      >
        OBJEDNÁNO
      </button>

      <OfferOrderModal
        isOpen={isOpen}
        offerId={offerId}
        offerNumber={offerNumber}
        currentStatus={currentStatus}
        canFinalizeStatus
        onClose={() => setIsOpen(false)}
        onStatusFinalized={() => {
          setIsOpen(false)
          router.refresh()
        }}
        onError={(message) =>
          showToast({
            title: 'CHYBA',
            message,
            tone: 'error',
          })
        }
      />
    </>
  )
}
