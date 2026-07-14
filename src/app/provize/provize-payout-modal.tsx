'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import type { ProvizeSalesOwner } from '@/lib/provize/access'
import {
  confirmProvizePayoutDraftAction,
  deleteProvizePayoutDraftAction,
  openProvizePayoutDraftAction,
  saveProvizePayoutDraftAction,
  toggleProvizePayoutDraftItemAction,
  type ProvizePayoutDraftAdjustment,
  type ProvizePayoutDraftData,
  type ProvizePayoutDraftRecord,
} from './payout-actions'

type ProvizePayoutModalLauncherProps = {
  buttonClassName: string
  owners: ProvizeSalesOwner[]
}

type DraftAdjustmentFormRow = {
  id: string
  itemType: 'bonus' | 'deduction'
  label: string
  amount: string
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function toAdjustmentFormRow(
  item: ProvizePayoutDraftAdjustment,
  index: number
): DraftAdjustmentFormRow {
  return {
    id: item.id || `draft-adjustment-${index + 1}`,
    itemType: item.itemType,
    label: item.label,
    amount: String(Math.round(item.amount)),
  }
}

function toDraftItemInputs(items: ProvizePayoutDraftRecord[]) {
  return items.map((item) => ({
    provizeRecordId: item.provizeRecordId,
    profitAmount: Math.round(item.profitAmount),
  }))
}

function toDraftAdjustmentInputs(adjustments: DraftAdjustmentFormRow[]) {
  return adjustments.map((item) => ({
    id: item.id,
    itemType: item.itemType,
    label: item.label,
    amount: Number(item.amount.replace(/\s+/g, '').replace(',', '.')) || 0,
  }))
}

export function ProvizePayoutModalLauncher({
  buttonClassName,
  owners,
}: ProvizePayoutModalLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={buttonClassName}>
        VYPLATIT PROVIZE
      </button>

      {isOpen ? <ProvizePayoutModal owners={owners} onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

function ProvizePayoutModal({
  owners,
  onClose,
}: {
  owners: ProvizeSalesOwner[]
  onClose: () => void
}) {
  const router = useRouter()
  const [selectedOwner, setSelectedOwner] = useState<ProvizeSalesOwner | null>(null)
  const [draft, setDraft] = useState<ProvizePayoutDraftData | null>(null)
  const [adjustmentRows, setAdjustmentRows] = useState<DraftAdjustmentFormRow[]>([])
  const [previewReadyBatchId, setPreviewReadyBatchId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { toast, isVisible, showToast } = useAnimatedActionToast()

  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPending, onClose])

  const previewItems = useMemo(() => {
    if (!draft) return []

    return draft.items
  }, [draft])

  const previewAdjustments = useMemo(() => {
    return adjustmentRows
      .map((item) => ({
        ...item,
        amountNumber: Math.round(Number(item.amount.replace(/\s+/g, '').replace(',', '.')) || 0),
      }))
      .filter((item) => item.label.trim() && item.amountNumber > 0)
  }, [adjustmentRows])

  const commissionSubtotal = previewItems.reduce((sum, item) => sum + item.commissionAmount, 0)
  const adjustmentTotal = previewAdjustments.reduce((sum, item) => {
    return sum + (item.itemType === 'bonus' ? item.amountNumber : -item.amountNumber)
  }, 0)
  const payoutTotal = commissionSubtotal + adjustmentTotal

  function hydrateDraft(nextDraft: ProvizePayoutDraftData) {
    setSelectedOwner(nextDraft.salesOwner)
    setDraft(nextDraft)
    setAdjustmentRows(
      nextDraft.adjustments.length > 0
        ? nextDraft.adjustments.map(toAdjustmentFormRow)
        : []
    )
  }

  function resetDraftState() {
    setSelectedOwner(null)
    setDraft(null)
    setAdjustmentRows([])
    setPreviewReadyBatchId(null)
  }

  function openOwnerDraft(owner: ProvizeSalesOwner) {
    startTransition(async () => {
      const result = await openProvizePayoutDraftAction(owner)

      if (!result.success) {
        alert(result.error)
        return
      }

      setPreviewReadyBatchId(null)
      hydrateDraft(result.draft)
    })
  }

  async function persistDraft() {
    if (!draft) return null

    const result = await saveProvizePayoutDraftAction(
      draft.batchId,
      toDraftItemInputs(previewItems),
      toDraftAdjustmentInputs(previewAdjustments)
    )

    if (!result.success) {
      alert(result.error)
      return null
    }

    hydrateDraft(result.draft)
    router.refresh()
    return result.draft
  }

  function handleGeneratePreview() {
    if (!draft) return

    startTransition(async () => {
      const savedDraft = await persistDraft()
      if (!savedDraft) return

      setPreviewReadyBatchId(savedDraft.batchId)
      showToast({
        title: 'Náhled uložen',
        message: `Draft dávka pro ${savedDraft.salesOwner} je připravená pro PDF náhled.`,
        tone: 'success',
      })
    })
  }

  function handleToggleCandidate(provizeRecordId: string, include: boolean) {
    if (!draft) return

    startTransition(async () => {
      const savedDraft = await persistDraft()
      if (!savedDraft) return

      const result = await toggleProvizePayoutDraftItemAction(
        savedDraft.batchId,
        provizeRecordId,
        include
      )

      if (!result.success) {
        alert(result.error)
        return
      }

      setPreviewReadyBatchId(null)
      hydrateDraft(result.draft)
      router.refresh()
    })
  }

  function handleConfirm() {
    if (!draft) return

    startTransition(async () => {
      const result = await confirmProvizePayoutDraftAction(
        draft.batchId,
        toDraftItemInputs(previewItems),
        toDraftAdjustmentInputs(previewAdjustments)
      )

      if (!result.success) {
        alert(result.error)
        return
      }

      setPreviewReadyBatchId(null)
      router.refresh()
      showToast({
        title: 'Provize potvrzeny',
        message: `Výplatní dávka pro ${result.salesOwner} byla potvrzená.`,
        tone: 'success',
      })
      onClose()
    })
  }

  function handleDeleteDraft() {
    if (!draft || isPending) return

    const confirmed = window.confirm(
      `Opravdu chceš smazat draft dávku pro ${draft.salesOwner}? Tato akce vrátí všechny její zakázky zpět mezi kandidáty a smaže i bonusy a odpočty.`
    )

    if (!confirmed) {
      return
    }

    startTransition(async () => {
      const result = await deleteProvizePayoutDraftAction(draft.batchId)

      if (!result.success) {
        alert(result.error)
        return
      }

      resetDraftState()
      router.refresh()
      showToast({
        title: 'Draft smazán',
        message: `Draft dávka pro ${result.salesOwner} byla smazaná.`,
        tone: 'success',
      })
    })
  }

  const previewPdfHref =
    draft && previewReadyBatchId === draft.batchId
      ? `/provize/drafty/${draft.batchId}/pdf`
      : null

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[140] bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4"
        aria-modal="true"
        role="dialog"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isPending) {
            onClose()
          }
        }}
      >
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-center">
          <div className="provize-payout-modal flex max-h-[calc(100vh-1.5rem)] w-full max-w-[1260px] flex-col overflow-hidden rounded-[30px] border border-zinc-200 bg-white shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
            <div className="provize-payout-modal__header border-b border-white/70 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#236f9f]">
                    Výplatní dávka provizí
                  </div>
                  <h2 className="mt-1 text-xl font-semibold text-gray-900">
                    {draft
                      ? `Draft pro ${draft.salesOwner}`
                      : 'Vyber obchodníka pro výplatu provizí'}
                  </h2>
                  <p className="mt-2 text-sm text-gray-600">
                    {draft
                      ? `Dávka je uložená jako draft. Náhled i potvrzení vychází ze zafixovaných hodnot v této dávce.`
                      : 'Nejdřív zvol obchodníka. Pokud už existuje draft, otevře se. Jinak se založí nová dávka se všemi zakázkami K vyplacení = ON a dosud nevyplacenými.'}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  disabled={isPending}
                  className="provize-payout-modal__close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Zavřít"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
              {!draft ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {owners.map((owner) => (
                    <button
                      key={owner}
                      type="button"
                      onClick={() => openOwnerDraft(owner)}
                      disabled={isPending}
                      className={`provize-payout-modal__owner-card rounded-[28px] border border-white/75 p-6 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] transition duration-200 ${
                        selectedOwner === owner
                          ? 'provize-payout-modal__owner-card--active bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white'
                          : 'provize-payout-modal__owner-card--idle bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] text-gray-900 hover:-translate-y-[1px]'
                      }`}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">
                        Obchodník
                      </div>
                      <div className="mt-2 text-2xl font-semibold">{owner}</div>
                      <div className="mt-3 text-sm opacity-80">
                        Otevřít existující draft nebo založit novou výplatní dávku.
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
                  <section className="space-y-5">
                    <div className="provize-payout-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                            Aktivní dávka
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            {draft.existingDraft ? 'Otevřen existující draft.' : 'Založen nový draft.'}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={handleDeleteDraft}
                            disabled={isPending}
                            className="provize-payout-modal__danger-button inline-flex h-10 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 text-sm font-medium uppercase text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            SMAZAT DRAFT
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              resetDraftState()
                            }}
                            className="provize-payout-modal__secondary-button inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-4 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                          >
                            ZMĚNIT OBCHODNÍKA
                          </button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        <InfoCard label="Obchodník" value={draft.salesOwner} />
                        <InfoCard label="Vytvořeno" value={formatDateTime(draft.createdAt)} />
                        <InfoCard label="Aktualizováno" value={formatDateTime(draft.updatedAt)} />
                      </div>
                    </div>

                    <div className="provize-payout-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                            Zakázky v dávce
                          </div>
                          <div className="mt-1 text-sm text-gray-600">
                            Přehled zakázek, které budou součástí této výplatní dávky.
                          </div>
                        </div>
                        <span className="provize-payout-modal__count-badge inline-flex rounded-full border border-[#76a9d3]/70 bg-[linear-gradient(155deg,rgba(233,244,252,0.92)_0%,rgba(217,235,248,0.86)_100%)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#236f9f]">
                          {previewItems.length} položek
                        </span>
                      </div>

                      <div className="mt-4 space-y-3">
                        {previewItems.length === 0 ? (
                          <EmptyStateText text="V dávce zatím nejsou žádné zakázky." />
                        ) : (
                          previewItems.map((item) => (
                            <article
                              key={item.provizeRecordId}
                              className="provize-payout-modal__subpanel rounded-[20px] border border-white/75 bg-white/78 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
                            >
                              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-[88px_96px_108px_108px_112px_92px] xl:items-center">
                                  <div className="provize-payout-modal__mini-card rounded-xl border border-white/75 bg-[#f8fbfe] px-2.5 py-2">
                                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                                      Zakázka
                                    </div>
                                    <div className="mt-0.5 truncate text-[13px] font-semibold text-gray-900">
                                      {item.jobNumber}
                                    </div>
                                  </div>

                                  <div className="provize-payout-modal__mini-card provize-payout-modal__mini-card--accent rounded-xl border border-white/75 bg-[#eef5fb] px-2.5 py-2">
                                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#236f9f]">
                                      Faktura
                                    </div>
                                    <div className="mt-0.5 truncate text-[13px] font-semibold text-[#236f9f]">
                                      {item.invoiceNumber}
                                    </div>
                                  </div>

                                  <div className="provize-payout-modal__mini-card rounded-xl border border-white/75 bg-[#f8fbfe] px-2.5 py-2">
                                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                                      Prodej
                                    </div>
                                    <div className="mt-0.5 truncate text-[13px] font-medium text-gray-900">
                                      {formatCurrency(item.saleAmount)}
                                    </div>
                                  </div>

                                  <div className="provize-payout-modal__mini-card rounded-xl border border-white/75 bg-[#f8fbfe] px-2.5 py-2">
                                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                                      Zisk
                                    </div>
                                    <div className="mt-0.5 truncate text-[13px] font-medium text-gray-900">
                                      {formatCurrency(item.profitAmount)}
                                    </div>
                                  </div>

                                  <div className="provize-payout-modal__mini-card provize-payout-modal__mini-card--accent rounded-xl border border-white/75 bg-[#eef5fb] px-2.5 py-2">
                                    <div className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#236f9f]">
                                      Provize
                                    </div>
                                    <div className="mt-0.5 truncate text-[13px] font-semibold text-[#236f9f]">
                                      {formatCurrency(item.commissionAmount)}
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleCandidate(item.provizeRecordId, false)
                                      }
                                      disabled={isPending}
                                      className="provize-payout-modal__remove-button inline-flex h-8 w-full items-center justify-center rounded-xl border border-[#d9e3ed] bg-white px-2 text-[10px] font-medium uppercase tracking-[0.05em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Odebrat
                                    </button>
                                  </div>
                                </div>
                            </article>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="provize-payout-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        Kandidáti mimo dávku
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        Zakázky vrácené z draftu nebo nově připravené K vyplacení.
                      </div>

                      <div className="mt-4 space-y-3">
                        {draft.candidates.length === 0 ? (
                          <EmptyStateText text="Žádní další kandidáti momentálně nejsou k dispozici." />
                        ) : (
                          draft.candidates.map((item) => (
                            <article
                              key={item.provizeRecordId}
                              className="provize-payout-modal__subpanel flex flex-col gap-3 rounded-[22px] border border-white/75 bg-white/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] md:flex-row md:items-center md:justify-between"
                            >
                              <div className="min-w-0">
                                <div className="text-sm font-semibold text-gray-900">
                                  {item.jobNumber} • {item.companyName}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {item.invoiceNumber} • Zisk {formatCurrency(item.profitAmount)} •
                                  Provize {formatCurrency(item.commissionAmount)}
                                </div>
                              </div>

                                <button
                                  type="button"
                                  onClick={() => handleToggleCandidate(item.provizeRecordId, true)}
                                  disabled={isPending}
                                  className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  PŘIDAT DO DÁVKY
                                </button>
                            </article>
                          ))
                        )}
                      </div>
                    </div>
                  </section>

                  <aside className="space-y-5">
                    <div className="provize-payout-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                        Bonusy a odpočty
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        Můžeš přidat libovolný počet vlastních položek.
                      </div>

                      <div className="mt-4 space-y-3">
                        {adjustmentRows.length === 0 ? (
                          <EmptyStateText text="Zatím bez bonusů a odpočtů." />
                        ) : null}

                        {adjustmentRows.map((item) => (
                          <div
                            key={item.id}
                            className="provize-payout-modal__subpanel rounded-[22px] border border-white/75 bg-white/78 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
                          >
                            <div className="grid gap-3">
                              <select
                                value={item.itemType}
                                onChange={(event) =>
                                  setAdjustmentRows((current) =>
                                    current.map((row) =>
                                      row.id === item.id
                                        ? {
                                            ...row,
                                            itemType: event.target.value as
                                              | 'bonus'
                                              | 'deduction',
                                          }
                                        : row
                                    )
                                  )
                                }
                                className="provize-payout-modal__field h-10 rounded-xl border border-white/75 bg-[#f8fbfe] px-3 text-sm text-gray-900"
                              >
                                <option value="bonus">Bonus (+)</option>
                                <option value="deduction">Odpočet (-)</option>
                              </select>

                              <input
                                type="text"
                                value={item.label}
                                onChange={(event) =>
                                  setAdjustmentRows((current) =>
                                    current.map((row) =>
                                      row.id === item.id
                                        ? { ...row, label: event.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="Název položky"
                                className="provize-payout-modal__field h-10 rounded-xl border border-white/75 bg-[#f8fbfe] px-3 text-sm text-gray-900"
                              />

                              <input
                                type="text"
                                inputMode="numeric"
                                value={item.amount}
                                onChange={(event) =>
                                  setAdjustmentRows((current) =>
                                    current.map((row) =>
                                      row.id === item.id
                                        ? { ...row, amount: event.target.value }
                                        : row
                                    )
                                  )
                                }
                                placeholder="0"
                                className="provize-payout-modal__field h-10 rounded-xl border border-white/75 bg-[#f8fbfe] px-3 text-sm text-gray-900"
                              />
                            </div>

                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() =>
                                  setAdjustmentRows((current) =>
                                    current.filter((row) => row.id !== item.id)
                                  )
                                }
                                className="provize-payout-modal__remove-button inline-flex h-9 items-center justify-center rounded-xl border border-[#d9e3ed] bg-white px-3 text-xs font-medium uppercase text-gray-700"
                              >
                                ODEBRAT
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setAdjustmentRows((current) => [
                            ...current,
                            {
                              id: `new-${crypto.randomUUID()}`,
                              itemType: 'bonus',
                              label: '',
                              amount: '',
                            },
                          ])
                        }
                        className="provize-payout-modal__secondary-accent-button mt-4 inline-flex h-10 w-full items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,rgba(233,244,252,0.96)_0%,rgba(217,235,248,0.92)_100%)] px-4 text-sm font-medium uppercase text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.12)] transition duration-200 hover:-translate-y-[1px]"
                      >
                        PŘIDAT POLOŽKU
                      </button>
                    </div>

                    <div className="provize-payout-modal__summary-panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_20px_44px_rgba(24,78,129,0.28)]">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/78">
                        Souhrn dávky
                      </div>
                      <div className="mt-4 space-y-3">
                        <SummaryRow label="Provize ze zakázek" value={formatCurrency(commissionSubtotal)} />
                        <SummaryRow
                          label="Bonusy a odpočty"
                          value={`${adjustmentTotal >= 0 ? '+' : '-'}${formatCurrency(
                            Math.abs(adjustmentTotal)
                          )}`}
                        />
                        <SummaryRow
                          label="K finální výplatě"
                          value={formatCurrency(payoutTotal)}
                          strong
                        />
                      </div>

                      <div className="mt-5 space-y-3">
                        <button
                          type="button"
                          onClick={handleGeneratePreview}
                          disabled={isPending}
                          className="provize-payout-modal__summary-ghost-button inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/30 bg-white/12 px-4 text-sm font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          GENEROVAT NÁHLED
                        </button>

                        {previewPdfHref ? (
                          <a
                            href={previewPdfHref}
                            target="_blank"
                            rel="noreferrer"
                            className="provize-payout-modal__summary-preview-button inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/30 bg-white/12 px-4 text-sm font-semibold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] transition duration-200 hover:-translate-y-[1px]"
                          >
                            NÁHLED PDF
                          </a>
                        ) : null}

                        <button
                          type="button"
                          onClick={handleConfirm}
                          disabled={isPending || previewItems.length === 0}
                          className="provize-payout-modal__summary-confirm-button inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/40 bg-white px-4 text-sm font-semibold uppercase text-[#225f8a] shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_12px_24px_rgba(12,49,81,0.18)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          POTVRDIT PROVIZE
                        </button>
                      </div>
                    </div>
                  </aside>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>,
    document.body
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="provize-payout-modal__info-card rounded-2xl border border-white/75 bg-white/78 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-gray-900">{value}</div>
    </div>
  )
}

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-sm ${strong ? 'font-semibold text-white' : 'text-white/78'}`}>
        {label}
      </span>
      <span className={`text-sm ${strong ? 'font-semibold text-white' : 'font-medium text-white'}`}>
        {value}
      </span>
    </div>
  )
}

function EmptyStateText({ text }: { text: string }) {
  return (
    <div className="provize-payout-modal__empty rounded-2xl border border-dashed border-[#cfd8e3] bg-white/60 px-4 py-5 text-sm text-gray-500">
      {text}
    </div>
  )
}
