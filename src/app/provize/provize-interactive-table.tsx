'use client'

import { useRef, useState, useTransition } from 'react'
import { JobPpRequiredToggle } from '@/components/jobs/job-pp-required-toggle'
import {
  updateProvizeApprovalAction,
  updateProvizeProfitAction,
} from './actions'
import type { ProvizeRow } from './page'

type ProvizeInteractiveTableProps = {
  rows: ProvizeRow[]
  isAdmin: boolean
}

export function ProvizeInteractiveTable({
  rows,
  isAdmin,
}: ProvizeInteractiveTableProps) {
  return (
    <>
      <section className="jobs-page__table-shell provize-page__table-shell hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
        <div className="h-px border-b border-white/70" />

        <table className="jobs-page__table w-full min-w-[1180px] table-fixed px-1">
          <ProvizeTableColgroup />
          <thead className="shadow-[0_1px_0_0_#e5e7eb]">
            <tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
              <th className="px-2 py-2.5 text-left">Zakázka</th>
              <th className="px-2 py-2.5 text-left">Obchodník</th>
              <th className="px-2 py-2.5 text-left">Firma</th>
              <th className="px-2 py-2.5 text-left">Začátek</th>
              <th className="px-2 py-2.5 text-left">Konec</th>
              <th className="px-2 py-2.5 text-left">Adresa</th>
              <th className="px-2 py-2.5 text-center">Prodejna</th>
              <th className="px-2 py-2.5 text-center">Faktura</th>
              <th className="px-2 py-2.5 text-center">Prodej</th>
              <th className="px-2 py-2.5 text-center">Zisk</th>
              <th className="px-2 py-2.5 text-center">Provize</th>
              <th className="px-2 py-2.5 text-center">K vyplacení</th>
              <th className="px-2 py-2.5 text-center">Vyplaceno</th>
            </tr>
          </thead>
        </table>

        <div className="max-h-[86vh] overflow-auto">
          <table className="jobs-page__table w-full min-w-[1180px] table-fixed border-separate border-spacing-y-1.5 px-1">
            <ProvizeTableColgroup />
            <tbody className="jobs-page__table-body">
              {rows.map((row) => (
                <DesktopRow key={row.id} row={row} isAdmin={isAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <MobileCard key={row.id} row={row} isAdmin={isAdmin} />
        ))}
      </section>
    </>
  )
}

function ProvizeTableColgroup() {
  return (
    <colgroup>
      <col className="w-[78px]" />
      <col className="w-[96px]" />
      <col />
      <col className="w-[118px]" />
      <col className="w-[118px]" />
      <col className="w-[158px]" />
      <col className="w-[76px]" />
      <col className="w-[112px]" />
      <col className="w-[116px]" />
      <col className="w-[116px]" />
      <col className="w-[116px]" />
      <col className="w-[118px]" />
      <col className="w-[108px]" />
    </colgroup>
  )
}

function DesktopRow({ row, isAdmin }: { row: ProvizeRow; isAdmin: boolean }) {
  return (
    <tr className="jobs-page__table-row group [background:linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] transition duration-200 hover:-translate-y-[1px]">
      <td
        title={row.jobNumber}
        className="rounded-l-2xl border-y border-l border-[#cfd8e3] px-2 py-2 text-[12px] font-semibold text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
      >
        {row.jobNumber}
      </td>
      <td
        title={row.salesOwner}
        className="border-y border-[#cfd8e3] px-2 py-2 text-[12px] text-gray-700"
      >
        <span className="block truncate whitespace-nowrap">{row.salesOwner}</span>
      </td>
      <td
        title={row.companyName}
        className="border-y border-[#cfd8e3] px-2 py-2 text-[12px] text-gray-900"
      >
        <span className="block truncate whitespace-nowrap">{row.companyName}</span>
      </td>
      <td
        title={row.startLabel}
        className="border-y border-[#cfd8e3] px-2 py-2 text-[12px] text-gray-700"
      >
        <span className="block truncate whitespace-nowrap">{row.startLabel}</span>
      </td>
      <td
        title={row.endLabel}
        className="border-y border-[#cfd8e3] px-2 py-2 text-[12px] text-gray-700"
      >
        <span className="block truncate whitespace-nowrap">{row.endLabel}</span>
      </td>
      <td
        title={row.siteAddress || '—'}
        className="border-y border-[#cfd8e3] px-2 py-2 text-[12px] text-gray-700"
      >
        <span className="block truncate whitespace-nowrap">{row.siteAddress || '—'}</span>
      </td>
      <td
        title={row.storeNumber || '—'}
        className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px] text-gray-700"
      >
        <span className="block truncate whitespace-nowrap">{row.storeNumber || '—'}</span>
      </td>
      <td
        title={row.invoiceNumber}
        className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px] text-gray-900"
      >
        <span className="block truncate whitespace-nowrap">{row.invoiceNumber}</span>
      </td>
      <td
        title={row.saleAmountLabel}
        className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px] font-medium text-gray-900"
      >
        <span className="block truncate whitespace-nowrap">{row.saleAmountLabel}</span>
      </td>
      <td className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px] font-medium text-gray-900">
        <ProfitEditableCell
          key={`${row.id}:${row.profitAmount}`}
          row={row}
          isAdmin={isAdmin}
          compact={false}
        />
      </td>
      <td
        title={row.commissionAmountLabel}
        className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px] font-semibold text-[#236f9f]"
      >
        <span className="block truncate whitespace-nowrap">{row.commissionAmountLabel}</span>
      </td>
      <td className="border-y border-[#cfd8e3] px-2 py-2 text-center text-[12px]">
        <ApprovalToggle
          key={`${row.id}:${row.approvedForPayout}`}
          row={row}
          isAdmin={isAdmin}
          compact={false}
        />
      </td>
      <td className="rounded-r-2xl border-y border-r border-[#cfd8e3] px-2 py-2 text-center text-[12px]">
        <PaidBadge isPaid={row.isPaid} />
      </td>
    </tr>
  )
}

function MobileCard({ row, isAdmin }: { row: ProvizeRow; isAdmin: boolean }) {
  return (
    <article className="rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[14px] font-semibold text-gray-900">{row.jobNumber}</div>
          <div className="mt-1 text-[13px] text-gray-500">{row.companyName}</div>
        </div>
        <span className="inline-flex rounded-full border border-[#76a9d3]/70 bg-[linear-gradient(155deg,rgba(233,244,252,0.92)_0%,rgba(217,235,248,0.86)_100%)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#236f9f]">
          {row.salesOwner}
        </span>
      </div>

      <dl className="mt-4 grid gap-2 text-[12px]">
        <div className="grid grid-cols-2 gap-2">
          <MobileDataRow label="Faktura" value={row.invoiceNumber} />
          <MobileDataRow label="Prodej" value={row.saleAmountLabel} />
          <div className="rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[12px] text-gray-500">Zisk</dt>
              <dd>
                <ProfitEditableCell
                  key={`${row.id}:${row.profitAmount}:mobile`}
                  row={row}
                  isAdmin={isAdmin}
                  compact
                />
              </dd>
            </div>
          </div>
          <MobileDataRow label="Provize" value={row.commissionAmountLabel} emphasized accent />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[10px] text-gray-500">K vyplacení</dt>
              <ApprovalToggle
                key={`${row.id}:${row.approvedForPayout}:mobile`}
                row={row}
                isAdmin={isAdmin}
                compact
              />
            </div>
          </div>
          <div className="rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[10px] text-gray-500">Vyplaceno</dt>
              <dd>
                <PaidBadge isPaid={row.isPaid} />
              </dd>
            </div>
          </div>
        </div>
      </dl>
    </article>
  )
}

function ProfitEditableCell({
  row,
  isAdmin,
  compact,
}: {
  row: ProvizeRow
  isAdmin: boolean
  compact: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(String(Math.round(row.profitAmount)))
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const isLocked = row.isPaid || !isAdmin

  function cancelEditing() {
    setDraftValue(String(Math.round(row.profitAmount)))
    setIsEditing(false)
  }

  function saveValue() {
    const normalizedDraft = draftValue.trim()
    const originalValue = String(Math.round(row.profitAmount))

    if (normalizedDraft === originalValue) {
      setIsEditing(false)
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('value', normalizedDraft)

      const result = await updateProvizeProfitAction(
        row.id,
        { success: false, error: null, profitAmount: row.profitAmount },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Změnu se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setIsEditing(false)
    })
  }

  if (isEditing && isAdmin && !row.isPaid) {
    return (
      <input
        autoFocus
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={draftValue}
        disabled={isPending}
        onChange={(event) => setDraftValue(event.target.value)}
        onBlur={saveValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            saveValue()
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            cancelEditing()
          }
        }}
        className={`h-9 w-full rounded-xl border border-[#9dc7e5] bg-white/95 px-2.5 text-[12px] font-semibold text-gray-900 outline-none ring-2 ring-[#b9d8ef] ${compact ? 'text-right' : 'text-center'}`}
      />
    )
  }

  const buttonClass = compact
    ? 'flex w-full items-center justify-between gap-3 rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'
    : 'inline-flex h-9 min-w-[96px] max-w-full items-center justify-center overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'

  if (!isAdmin) {
    return (
      <span className={`${compact ? 'flex w-full items-center justify-between gap-3' : 'inline-flex items-center justify-center'} text-[12px] font-normal text-gray-900`}>
        <span className="block truncate whitespace-nowrap">{row.profitAmountLabel}</span>
      </span>
    )
  }

  if (compact) {
    if (isEditing && !row.isPaid) {
      return (
        <input
          autoFocus
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={draftValue}
          disabled={isPending}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={saveValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          className="h-8 w-[92px] rounded-xl border border-[#9dc7e5] bg-white/95 px-2.5 text-right text-[12px] font-medium text-gray-900 outline-none ring-2 ring-[#b9d8ef]"
        />
      )
    }

    if (isLocked) {
      return (
        <span className="inline-flex items-center justify-end text-[12px] font-normal text-gray-900">
          <span className="block truncate whitespace-nowrap">{row.profitAmountLabel}</span>
        </span>
      )
    }

    return (
      <button
        type="button"
        disabled={isPending}
        onClick={() => setIsEditing(true)}
        className="inline-flex items-center justify-end text-[12px] font-normal text-gray-900 transition duration-200 disabled:cursor-not-allowed disabled:opacity-60"
        title="Upravit zisk pro provize"
      >
        <span className="block truncate whitespace-nowrap">{row.profitAmountLabel}</span>
      </button>
    )
  }

  if (isLocked) {
    return (
      <span className={`${buttonClass} ${compact ? '' : 'text-center'} text-[12px] font-semibold text-gray-900`}>
        <span className="block truncate whitespace-nowrap">{row.profitAmountLabel}</span>
        {compact && row.isPaid ? <span className="text-[11px] uppercase tracking-[0.08em] text-gray-500">Uzamčeno</span> : null}
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => setIsEditing(true)}
      className={`${buttonClass} text-[12px] font-semibold text-gray-900 transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60`}
      title="Upravit zisk pro provize"
    >
      <span className="block truncate whitespace-nowrap">{row.profitAmountLabel}</span>
      {compact ? <span className="text-[11px] uppercase tracking-[0.08em] text-[#236f9f]">Upravit</span> : null}
    </button>
  )
}

function ApprovalToggle({
  row,
  isAdmin,
  compact,
}: {
  row: ProvizeRow
  isAdmin: boolean
  compact: boolean
}) {
  const [value, setValue] = useState(row.approvedForPayout)
  const [isPending, startTransition] = useTransition()

  const disabled = !isAdmin || row.isPaid || isPending

  function handleChange(nextValue: boolean) {
    if (disabled) return

    const previousValue = value
    setValue(nextValue)

    startTransition(async () => {
      const result = await updateProvizeApprovalAction(row.id, nextValue)

      if (!result.success) {
        alert(result.error ?? 'Stav se nepodařilo uložit.')
        setValue(previousValue)
        return
      }

      setValue(result.approvedForPayout)
    })
  }

  if (!isAdmin) {
    return (
      <span
        className={`inline-flex min-w-[68px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
          value
            ? 'border-emerald-300/90 bg-emerald-50 text-emerald-700'
            : 'border-zinc-300 bg-white/80 text-zinc-500'
        }`}
      >
        {value ? 'ANO' : 'NE'}
      </span>
    )
  }

  return (
    <div className={compact ? 'flex items-center justify-between gap-3' : 'flex items-center justify-center'}>
      <JobPpRequiredToggle
        value={value}
        onChange={handleChange}
        disabled={disabled}
        compact={compact}
        className="!h-[26px] !w-[48px] !min-w-[48px] rounded-full"
        thumbClassName="!h-[18px] !w-[18px]"
        thumbCheckedClassName="left-[26px]"
        thumbUncheckedClassName="left-[2px]"
        onLabel=""
        offLabel=""
      />
    </div>
  )
}

function PaidBadge({ isPaid }: { isPaid: boolean }) {
  return (
    <span
      className={`inline-flex min-w-[68px] items-center justify-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] ${
        isPaid
          ? 'border-emerald-300/90 bg-emerald-50 text-emerald-700'
          : 'border-red-300/90 bg-red-50 text-red-700'
      }`}
    >
      {isPaid ? 'ANO' : 'NE'}
    </span>
  )
}

function MobileDataRow({
  label,
  value,
  emphasized = false,
  accent = false,
}: {
  label: string
  value: string
  emphasized?: boolean
  accent?: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-white/75 bg-white/70 px-3 py-2">
      <dt
        className={`${
          accent
            ? 'font-semibold text-[#236f9f]'
            : emphasized
              ? 'font-semibold text-gray-900'
              : 'text-gray-500'
        }`}
      >
        {label}
      </dt>
      <dd
        className={`text-right ${
          accent
            ? 'font-semibold text-[#236f9f]'
            : emphasized
              ? 'font-semibold text-gray-900'
              : 'font-medium text-gray-900'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
