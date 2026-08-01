'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { ModalHeading } from '@/components/ui/modal-heading'
import type { ProvizeSalesOwner } from '@/lib/provize/access'
import type {
  ProvizeHistoryBatch,
  ProvizeHistoryPayload,
} from '@/lib/provize/history'
import { getProvizeHistoryAction } from './history-actions'

type ProvizeHistoryModalLauncherProps = {
  buttonClassName: string
  isAdmin: boolean
  currentSalesOwner: ProvizeSalesOwner | null
  owners: ProvizeSalesOwner[]
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

function formatDateRange(startAt: string, endAt: string) {
  return `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`
}

function getBatchTitle(batch: ProvizeHistoryBatch, index: number) {
  return `Dávka ${index + 1}`
}

export function ProvizeHistoryModalLauncher({
  buttonClassName,
  isAdmin,
  currentSalesOwner,
  owners,
}: ProvizeHistoryModalLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)} className={buttonClassName}>
        HISTORIE VÝPLAT
      </button>

      {isOpen ? (
        <ProvizeHistoryModal
          isAdmin={isAdmin}
          currentSalesOwner={currentSalesOwner}
          owners={owners}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function ProvizeHistoryModal({
  isAdmin,
  currentSalesOwner,
  owners,
  onClose,
}: {
  isAdmin: boolean
  currentSalesOwner: ProvizeSalesOwner | null
  owners: ProvizeSalesOwner[]
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [payload, setPayload] = useState<ProvizeHistoryPayload | null>(null)
  const [selectedOwner, setSelectedOwner] = useState<ProvizeSalesOwner | null>(
    isAdmin ? null : currentSalesOwner
  )
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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

  useEffect(() => {
    if (isAdmin || !currentSalesOwner) return

    startTransition(async () => {
      const result = await getProvizeHistoryAction(currentSalesOwner)

      if (!result.success) {
        setErrorMessage(result.error)
        return
      }

      setErrorMessage(null)
      setPayload(result.payload)
      setSelectedOwner(result.payload.selectedOwner)
      setSelectedBatchId(result.payload.batches[0]?.id ?? null)
    })
  }, [currentSalesOwner, isAdmin])

  function loadOwnerHistory(owner: ProvizeSalesOwner) {
    setSelectedOwner(owner)
    setSelectedBatchId(null)

    startTransition(async () => {
      const result = await getProvizeHistoryAction(owner)

      if (!result.success) {
        setErrorMessage(result.error)
        setPayload(null)
        return
      }

      setErrorMessage(null)
      setPayload(result.payload)
      setSelectedBatchId(result.payload.batches[0]?.id ?? null)
    })
  }

  const batches = payload?.batches ?? []
  const selectedBatch =
    batches.find((batch) => batch.id === selectedBatchId) ?? batches[0] ?? null

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
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
        <div className="provize-history-modal flex max-h-[calc(100vh-1.5rem)] w-full max-w-[1320px] flex-col overflow-hidden rounded-[30px] border border-zinc-200 bg-white shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="provize-history-modal__header border-b border-white/70 px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <ModalHeading
                  section="PROVIZE"
                  title={
                    selectedOwner
                      ? `Potvrzené dávky${isAdmin ? ` pro ${selectedOwner}` : ''}`
                      : 'Vyber obchodníka'
                  }
                />
                <p className="mt-2 text-sm text-gray-600">
                  {isAdmin
                    ? 'Nejdřív zvol obchodníka, potom konkrétní dávku a nakonec uvidíš detail celé výplaty včetně zakázek a bonusů nebo odpočtů.'
                    : 'Tady najdeš přehled všech potvrzených výplat svých provizí, vždy po jednotlivých dávkách.'}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="provize-history-modal__close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {isAdmin && !selectedOwner ? (
              <div className="grid gap-4 md:grid-cols-2">
                {owners.map((owner) => (
                  <button
                    key={owner}
                    type="button"
                    onClick={() => loadOwnerHistory(owner)}
                    disabled={isPending}
                    className="provize-history-modal__owner-card rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 text-left text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#236f9f]">
                      Obchodník
                    </div>
                    <div className="mt-2 text-2xl font-semibold">{owner}</div>
                    <div className="mt-3 text-sm text-gray-600">
                      Otevřít historii potvrzených výplat po jednotlivých dávkách.
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
                <aside className="space-y-5">
                  <div className="provize-history-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                          Vybraný obchodník
                        </div>
                        <div className="mt-1 text-base font-semibold text-gray-900">
                          {selectedOwner ?? '—'}
                        </div>
                      </div>

                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedOwner(null)
                            setSelectedBatchId(null)
                            setPayload(null)
                            setErrorMessage(null)
                          }}
                          className="provize-history-modal__secondary-button inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-4 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                        >
                          ZMĚNIT
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="provize-history-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Výplatní dávky
                    </div>
                    <div className="mt-1 text-sm text-gray-600">
                      Kliknutím otevřeš detail konkrétní potvrzené dávky.
                    </div>

                    {errorMessage ? (
                      <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                        {errorMessage}
                      </div>
                    ) : null}

                    <div className="mt-4 space-y-3">
                      {isPending && batches.length === 0 ? (
                        <EmptyStateText text="Načítám historii výplat..." />
                      ) : batches.length === 0 ? (
                        <EmptyStateText text="Potvrzené výplatní dávky tu zatím nejsou." />
                      ) : (
                        batches.map((batch, index) => {
                          const isActive = batch.id === selectedBatch?.id

                          return (
                            <button
                              key={batch.id}
                              type="button"
                              onClick={() => setSelectedBatchId(batch.id)}
                              className={`provize-history-modal__batch-card block w-full rounded-[24px] border p-4 text-left transition duration-200 ${
                                isActive
                                  ? 'provize-history-modal__batch-card--active border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_18px_34px_rgba(24,78,129,0.24)]'
                                  : 'provize-history-modal__batch-card--idle border-white/75 bg-white/78 text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:-translate-y-[1px]'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] opacity-80">
                                    {getBatchTitle(batch, index)}
                                  </div>
                                  <div className="mt-2 text-sm font-semibold">
                                    {formatDateTime(batch.confirmedAt)}
                                  </div>
                                </div>
                                <span className="rounded-full border border-white/25 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
                                  {batch.itemCount} zakázek
                                </span>
                              </div>

                              <div className="mt-3 text-sm font-medium opacity-90">
                                {formatCurrency(batch.payoutTotal)}
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                </aside>

                <section className="space-y-5">
                  {selectedBatch ? (
                    <>
                      <div className="provize-history-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#236f9f]">
                              Detail dávky
                            </div>
                            <div className="mt-1 text-lg font-semibold text-gray-900">
                              {formatDateTime(selectedBatch.confirmedAt)}
                            </div>
                          </div>

                          <span className="provize-history-modal__count-badge inline-flex rounded-full border border-[#76a9d3]/70 bg-[linear-gradient(155deg,rgba(233,244,252,0.92)_0%,rgba(217,235,248,0.86)_100%)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#236f9f]">
                            {selectedBatch.salesOwner}
                          </span>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <a
                            href={`/provize/vyplaty/${selectedBatch.id}/pdf`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px]"
                          >
                            EXPORT PDF
                          </a>

                          <a
                            href={`/provize/vyplaty/${selectedBatch.id}/export`}
                            download
                            className="provize-history-modal__secondary-button inline-flex h-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                          >
                            EXPORT XLSX
                          </a>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-4">
                          <InfoCard label="Potvrzeno" value={formatDateTime(selectedBatch.confirmedAt)} />
                          <InfoCard label="Zakázek" value={String(selectedBatch.itemCount)} />
                          <InfoCard
                            label="Provize ze zakázek"
                            value={formatCurrency(selectedBatch.commissionSubtotal)}
                          />
                          <InfoCard
                            label="Celkem vyplaceno"
                            value={formatCurrency(selectedBatch.payoutTotal)}
                          />
                        </div>
                      </div>

                      <div className="rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_20px_44px_rgba(24,78,129,0.28)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/78">
                          Souhrn dávky
                        </div>
                        <div className="mt-4 space-y-3">
                          <SummaryRow
                            label="Provize ze zakázek"
                            value={formatCurrency(selectedBatch.commissionSubtotal)}
                          />
                          <SummaryRow
                            label="Bonusy a odpočty"
                            value={`${selectedBatch.adjustmentTotal >= 0 ? '+' : '-'}${formatCurrency(
                              Math.abs(selectedBatch.adjustmentTotal)
                            )}`}
                          />
                          <SummaryRow
                            label="Finální výplata"
                            value={formatCurrency(selectedBatch.payoutTotal)}
                            strong
                          />
                        </div>
                      </div>

                      <div className="provize-history-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                          Bonusy a odpočty
                        </div>
                        <div className="mt-1 text-sm text-gray-600">
                          Zafixované položky uložené u této konkrétní výplaty.
                        </div>

                        <div className="mt-4 space-y-3">
                          {selectedBatch.adjustments.length === 0 ? (
                            <EmptyStateText text="Tato dávka nemá žádné bonusy ani odpočty." />
                          ) : (
                            selectedBatch.adjustments.map((item) => (
                              <div
                                key={item.id}
                              className="provize-history-modal__subpanel flex items-center justify-between gap-3 rounded-[22px] border border-white/75 bg-white/78 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
                              >
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">
                                    {item.label}
                                  </div>
                                  <div className="mt-1 text-xs uppercase tracking-[0.12em] text-gray-500">
                                    {item.itemType === 'bonus' ? 'Bonus' : 'Odpočet'}
                                  </div>
                                </div>
                                <div className="text-sm font-semibold text-gray-900">
                                  {item.itemType === 'bonus' ? '+' : '-'}
                                  {formatCurrency(item.amount)}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="provize-history-modal__panel rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)]">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                              Zakázky v dávce
                            </div>
                            <div className="mt-1 text-sm text-gray-600">
                              Detail zakázek zafixovaný v okamžiku potvrzení výplaty.
                            </div>
                          </div>
                          <span className="inline-flex rounded-full border border-[#76a9d3]/70 bg-[linear-gradient(155deg,rgba(233,244,252,0.92)_0%,rgba(217,235,248,0.86)_100%)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#236f9f]">
                            {selectedBatch.itemCount} položek
                          </span>
                        </div>

                        <div className="mt-4 space-y-3">
                          {selectedBatch.items.map((item) => (
                            <article
                              key={item.id}
                              className="provize-history-modal__subpanel rounded-[24px] border border-white/75 bg-white/78 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]"
                            >
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-base font-semibold text-gray-900">
                                      {item.jobNumber}
                                    </span>
                                    <span className="provize-history-modal__count-badge inline-flex rounded-full border border-white/75 bg-[#eef5fb] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#236f9f]">
                                      {item.invoiceNumber}
                                    </span>
                                  </div>
                                  <div className="mt-1 text-sm text-gray-600">{item.companyName}</div>
                                  <div className="mt-2 text-xs text-gray-500">
                                    {formatDateRange(item.startAt, item.endAt)}
                                  </div>
                                  <div className="mt-1 text-xs text-gray-500">
                                    {item.siteAddress || 'Bez adresy'}
                                    {item.storeNumber ? ` • Prodejna ${item.storeNumber}` : ''}
                                  </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-4 lg:min-w-[620px]">
                                  <InfoCard label="Prodej" value={formatCurrency(item.saleAmount)} />
                                  <InfoCard label="Náklad" value={formatCurrency(item.costAmount)} />
                                  <InfoCard label="Zisk" value={formatCurrency(item.profitAmount)} />
                                  <InfoCard
                                    label="Provize"
                                    value={formatCurrency(item.commissionAmount)}
                                  />
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <EmptyStateText text="Vyber konkrétní výplatní dávku a zobrazí se její detail." />
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="provize-history-modal__info-card rounded-2xl border border-white/75 bg-white/78 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)]">
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
    <div className="provize-history-modal__empty rounded-2xl border border-dashed border-[#cfd8e3] bg-white/60 px-4 py-5 text-sm text-gray-500">
      {text}
    </div>
  )
}
