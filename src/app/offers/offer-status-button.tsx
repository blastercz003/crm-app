'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
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
  if (status === 'ordered') return 'bg-emerald-600 text-white'
  if (status === 'rejected') return 'bg-rose-600 text-white'
  if (status === 'in_progress') return 'bg-orange-500 text-white'
  if (status === 'sent_to_client') return 'border border-black bg-white text-black'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'submitted') return 'bg-[#2980B9]/10 text-[#236f9f]'
  if (status === 'changes_requested') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-600'
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
        className={`inline-flex h-8 ${badgeWidthClass} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition ${statusMetaClass} ${canEdit ? 'hover:opacity-95' : 'cursor-default'}`}
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
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                Změnit stav nabídky:
              </h2>
              <div className="mt-1.5 inline-flex items-center rounded-full border border-[#2980B9] bg-[#2980B9] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white">
                {offerNumber}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#2980B9] bg-[#2980B9] px-3 py-3 text-sm text-white">
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
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-3 text-sm text-gray-500">
                Pro aktuální stav není dostupná žádná změna.
              </div>
            ) : (
              targets.map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={isPending}
                  onClick={() => onChangeStatus(status)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-gray-900">{STATUS_LABELS[status]}</span>
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
    </div>
  )
}
