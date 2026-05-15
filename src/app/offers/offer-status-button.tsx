'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { setOfferStatusFromList } from '@/app/offers/actions'
import type { OfferStatus } from '@/lib/offers/types'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'

const STATUS_BADGE_WIDTH_CLASS = 'w-[150px]'

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Rozpracovaná',
  submitted: 'Ke schválení',
  changes_requested: 'K úpravě',
  approved: 'Schválená',
  sent_to_client: 'Odeslaná',
  in_progress: 'V řešení',
  ordered: 'Objednáno',
  rejected: 'Zamítnuto',
}

function getStatusClass(status: OfferStatus) {
  if (status === 'ordered') {
    return 'border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]'
  }
  if (status === 'rejected') {
    return 'border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_16px_rgba(220,38,38,0.24)]'
  }
  if (status === 'in_progress') {
    return 'border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(249,115,22,0.24)]'
  }
  if (status === 'sent_to_client') {
    return 'border border-[#cfd8e3]/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,246,251,0.9)_48%,rgba(234,241,248,0.84)_100%)] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_20px_rgba(15,23,42,0.12)]'
  }
  if (status === 'approved') {
    return 'border border-emerald-300/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.95)_0%,rgba(209,250,229,0.88)_100%)] text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_16px_rgba(16,185,129,0.14)]'
  }
  if (status === 'submitted') {
    return 'border border-[#8dbfe0] bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(41,128,185,0.14)]'
  }
  if (status === 'changes_requested') {
    return 'border border-amber-300/90 bg-[linear-gradient(155deg,rgba(255,251,235,0.96)_0%,rgba(254,243,199,0.9)_100%)] text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(217,119,6,0.14)]'
  }
  return 'border border-zinc-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]'
}

function getAllowedTargets(currentStatus: OfferStatus, isAdmin: boolean) {
  const baseMap: Record<OfferStatus, OfferStatus[]> = {
    draft: ['submitted'],
    submitted: ['draft'],
    changes_requested: ['draft', 'submitted', 'in_progress'],
    approved: ['sent_to_client', 'draft'],
    sent_to_client: ['in_progress', 'ordered', 'rejected', 'draft'],
    in_progress: ['sent_to_client', 'ordered', 'rejected', 'draft'],
    ordered: ['in_progress', 'sent_to_client', 'draft', 'rejected'],
    rejected: ['in_progress', 'sent_to_client', 'draft', 'ordered'],
  }

  const options = (baseMap[currentStatus] ?? []).filter((status) => status !== 'changes_requested')
  if (isAdmin) return options
  return options.filter((status) => status !== 'approved')
}

function buildStatusChangedToast(from: OfferStatus, to: OfferStatus) {
  return {
    title: 'STAV NABÍDKY ZMĚNĚN',
    message: `Nabídka byla přepnuta ze stavu „${STATUS_LABELS[from]}“ na „${STATUS_LABELS[to]}“.`,
    tone: 'success' as const,
  }
}

export function OfferStatusButton({
  offerId,
  offerNumber,
  currentStatus,
  isAdmin,
  isOwner,
  badgeWidthClass = STATUS_BADGE_WIDTH_CLASS,
}: {
  offerId: string
  offerNumber: string
  currentStatus: OfferStatus
  isAdmin: boolean
  isOwner: boolean
  badgeWidthClass?: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const canEdit = isAdmin || isOwner
  const statusMetaClass = getStatusClass(currentStatus)
  const targets = useMemo(
    () => getAllowedTargets(currentStatus, isAdmin),
    [currentStatus, isAdmin]
  )

  function changeStatus(nextStatus: OfferStatus) {
    if (!canEdit) return
    startTransition(async () => {
      try {
        await setOfferStatusFromList(offerId, nextStatus)
        showToast(buildStatusChangedToast(currentStatus, nextStatus))
        setIsOpen(false)
      } catch (error) {
        showToast({
          title: 'CHYBA',
          message:
            error instanceof Error
              ? error.message
              : 'Stav nabídky se nepodařilo změnit.',
          tone: 'error',
        })
      }
    })
  }

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
      <button
        type="button"
        onClick={() => (canEdit ? setIsOpen(true) : undefined)}
        className={`inline-flex h-8 ${badgeWidthClass} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition duration-200 ${statusMetaClass} ${canEdit ? 'hover:-translate-y-[1px]' : 'cursor-default'}`}
      >
        <span className="truncate">{STATUS_LABELS[currentStatus]}</span>
      </button>

      {isOpen ? (
        <StatusModal
          offerNumber={offerNumber}
          currentStatus={currentStatus}
          targets={targets}
          isPending={isPending}
          onClose={() => setIsOpen(false)}
          onChangeStatus={changeStatus}
        />
      ) : null}
    </>
  )
}

function StatusModal({
  offerNumber,
  currentStatus,
  targets,
  isPending,
  onClose,
  onChangeStatus,
}: {
  offerNumber: string
  currentStatus: OfferStatus
  targets: OfferStatus[]
  isPending: boolean
  onClose: () => void
  onChangeStatus: (status: OfferStatus) => void
}) {
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  if (!isMounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_45%,rgba(236,243,249,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />
          <div className="relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                Změnit stav nabídky:
              </h2>
              <div className="mt-1.5 inline-flex items-center rounded-full border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]">
                {offerNumber}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="relative flex items-center justify-between gap-3 rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(41,128,185,0.24)]">
            <span className="font-semibold text-white">Aktuální stav:</span>
            <span
              className={`inline-flex h-8 ${STATUS_BADGE_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${getStatusClass(currentStatus)}`}
            >
              {STATUS_LABELS[currentStatus]}
            </span>
          </div>

          <div className="mt-3 text-sm font-medium text-gray-700">
            Vyber nový stav nabídky:
          </div>

          <div className="mt-3 space-y-2">
            {targets.length === 0 ? (
              <div className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.08)]">
                Pro aktuální stav není dostupná žádná změna.
              </div>
            ) : (
              targets.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={isPending}
                  onClick={() => onChangeStatus(status)}
                  className="flex w-full items-center justify-end rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:border-[#c8dced] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_24px_rgba(15,23,42,0.12)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className={`inline-flex h-8 ${STATUS_BADGE_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${getStatusClass(status)}`}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
