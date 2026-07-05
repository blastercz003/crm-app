'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  downloadOfferOrderFileAction,
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

function formatOfferOrderFileDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
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

  function handleOpenFile(fileId: string) {
    startUploadTransition(async () => {
      const result = await openOfferOrderFileAction(fileId)
      if (!result.success) {
        emitError(result.error)
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  function handleDownloadFile(fileId: string) {
    startUploadTransition(async () => {
      const result = await downloadOfferOrderFileAction(fileId)
      if (!result.success) {
        emitError(result.error)
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
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

            <div className="relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
              <div className="flex flex-col items-start">
                <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                  Objednávka k nabídce
                </h2>
                <div className="mt-1.5 inline-flex items-center rounded-full border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]">
                  {offerNumber}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isUploadPending || isFinalizePending}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>

            {isLoading ? (
              <div className="relative rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-4 py-4 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
                Načítám podklady k objednávce…
              </div>
            ) : loadError ? (
              <div className="relative rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                {loadError}
              </div>
            ) : (
              <div className="relative space-y-4">
                <div className="grid gap-2">
                  <label
                    htmlFor={`order-reference-${offerId}`}
                    className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
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
                    className="h-11 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef] disabled:cursor-not-allowed disabled:opacity-70"
                  />
                </div>

                {!isReadOnly ? (
                  <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.08)]">
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
                        className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-xl file:border-0 file:bg-[#2f77af] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-[#286897]"
                      />
                      <div className="text-xs text-gray-500">
                        Povolené soubory: PDF nebo obrázek. Maximální velikost 2 MB.
                      </div>
                      {uploadError ? (
                        <div className="text-sm font-medium text-red-700">{uploadError}</div>
                      ) : null}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleUpload}
                          disabled={!selectedFile || isUploadPending || isFinalizePending}
                          className="inline-flex h-10 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isUploadPending ? 'Nahrávám…' : 'NAHRÁT SOUBOR'}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.08)]">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Nahrané soubory
                  </div>

                  {hasFiles ? (
                    <div className="space-y-3">
                      {orderData?.files.map((file) => (
                        <div
                          key={file.id}
                          className="flex flex-col gap-3 rounded-xl border border-[#d6dee8] bg-white/80 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.84)] sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-900">
                              {file.fileName}
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                              {formatOfferOrderFileDate(file.createdAt)}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleOpenFile(file.id)}
                              disabled={isUploadPending || isFinalizePending}
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              ZOBRAZIT
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownloadFile(file.id)}
                              disabled={isUploadPending || isFinalizePending}
                              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              STÁHNOUT
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
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
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
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

  function handleOpenFile(fileId: string) {
    void (async () => {
      const result = await openOfferOrderFileAction(fileId)
      if (!result.success) {
        showToast({ title: 'CHYBA', message: result.error, tone: 'error' })
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })()
  }

  function handleDownloadFile(fileId: string) {
    void (async () => {
      const result = await downloadOfferOrderFileAction(fileId)
      if (!result.success) {
        showToast({ title: 'CHYBA', message: result.error, tone: 'error' })
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })()
  }

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
      <section className="offers-detail-page__final-panel min-w-0 rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
              Podklady k objednávce
            </div>
            <div className="mt-2 text-sm text-gray-600">
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
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px]"
            >
              OTEVŘÍT PODKLADY
            </button>
          ) : null}
        </div>

        <div className="mt-4 space-y-3 border-t border-gray-100 pt-3">
          {isLoading ? (
            <div className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
              Načítám podklady k objednávce…
            </div>
          ) : (orderData?.files.length ?? 0) > 0 ? (
            orderData?.files.map((file) => (
              <div
                key={file.id}
                className="flex flex-col gap-3 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-800">{file.fileName}</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {formatOfferOrderFileDate(file.createdAt)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenFile(file.id)}
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    ZOBRAZIT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(file.id)}
                    className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                  >
                    STÁHNOUT
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
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
