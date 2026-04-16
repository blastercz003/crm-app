'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { updateFinanceInlineFieldAction } from './actions'
import type { FakturaRow, SalesOwner } from './page'

type InlineEditableFinanceField =
  | 'info_note'
  | 'invoice_number'
  | 'sale_amount'
  | 'cost_amount'

type FakturyInteractiveTableProps = {
  rows: FakturaRow[]
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const EDITABLE_CELL_BASE_CLASS =
  'block h-8 w-full rounded-lg px-2 py-1.5 text-[12px] transition'

export function FakturyInteractiveTable({
  rows,
}: FakturyInteractiveTableProps) {
  return (
    <>
      <section className="hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:block">
        <div className="overflow-x-hidden px-2 py-2">
          <table className="w-full table-fixed border-separate border-spacing-y-2">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                <th className="w-[64px] px-2 py-2 text-center">Zakázka</th>
                <th className="w-[82px] px-2 py-2 text-left">Obchodník</th>
                <th className="w-[170px] px-2 py-2 text-left">Firma</th>
                <th className="w-[118px] px-2 py-2 text-left">Osoba</th>
                <th className="w-[126px] px-2 py-2 text-left">Začátek</th>
                <th className="w-[126px] px-2 py-2 text-left">Konec</th>
                <th className="w-[180px] px-2 py-2 text-left">Adresa</th>
                <th className="w-[68px] px-2 py-2 text-center">Prodejna</th>
                <th className="w-[150px] px-2 py-2 text-center">Info</th>
                <th className="w-[92px] px-2 py-2 text-center">Faktura</th>
                <th className="w-[98px] px-2 py-2 text-center">Prodej</th>
                <th className="w-[98px] px-2 py-2 text-center">Náklad</th>
                <th className="w-[98px] px-2 py-2 text-center">Zisk</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <DesktopRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 lg:hidden">
        {rows.map((row) => (
          <MobileCard key={row.id} row={row} />
        ))}
      </section>
    </>
  )
}

function DesktopRow({ row }: { row: FakturaRow }) {
  const detailHref = `/jobs/${row.job_id}`

  return (
    <tr className="group">
      <td className="rounded-l-2xl border border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <Link
          href={detailHref}
          className="block h-8 rounded-lg px-1 py-1 text-center text-[12px] font-semibold text-gray-900 transition hover:bg-black/[0.025]"
          title={row.job_number}
        >
          <span className="block truncate leading-6 text-gray-900">
            {row.job_number}
          </span>
        </Link>
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <SalesOwnerText salesOwner={row.sales_owner} />
      </td>

      <ReadOnlyCell value={row.company_name} title={row.company_name} />
      <ReadOnlyCell value={row.contact_person} title={row.contact_person} />
      <ReadOnlyCell
        value={formatDateTime(row.start_at)}
        title={formatDateTime(row.start_at)}
      />
      <ReadOnlyCell
        value={formatDateTime(row.end_at)}
        title={formatDateTime(row.end_at)}
      />
      <ReadOnlyCell value={row.site_address} title={row.site_address} />
      <ReadOnlyCell
        value={row.store_number}
        title={row.store_number}
        align="center"
      />

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <FinanceEditableCell
          financeId={row.id}
          field="info_note"
          value={row.info_note}
          type="text"
          emptyLabel="-"
          align="left"
          formatter={(value) => (typeof value === 'string' ? value : '')}
          title={row.info_note ?? '-'}
          emptyVariant="plain"
        />
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <FinanceEditableCell
          financeId={row.id}
          field="invoice_number"
          value={row.invoice_number}
          type="text"
          emptyLabel="DOPLNIT"
          align="center"
          formatter={(value) => (typeof value === 'string' ? value : '')}
          title={row.invoice_number ?? 'Doplnit'}
          filledVariant="invoice"
          emptyVariant="action"
        />
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <FinanceEditableCell
          financeId={row.id}
          field="sale_amount"
          value={row.sale_amount}
          type="number"
          emptyLabel="DOPLNIT"
          align="right"
          formatter={(value) =>
            typeof value === 'number' ? formatMoney(value) : ''
          }
          title={
            typeof row.sale_amount === 'number'
              ? formatMoney(row.sale_amount)
              : 'Doplnit'
          }
          filledVariant="strong"
          emptyVariant="action"
        />
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <FinanceEditableCell
          financeId={row.id}
          field="cost_amount"
          value={row.cost_amount}
          type="number"
          emptyLabel="DOPLNIT"
          align="right"
          formatter={(value) =>
            typeof value === 'number' ? formatMoney(value) : ''
          }
          title={
            typeof row.cost_amount === 'number'
              ? formatMoney(row.cost_amount)
              : 'Doplnit'
          }
          filledVariant="strong"
          emptyVariant="action"
        />
      </td>

      <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <ProfitText saleAmount={row.sale_amount} costAmount={row.cost_amount} />
      </td>
    </tr>
  )
}

function MobileCard({ row }: { row: FakturaRow }) {
  const detailHref = `/jobs/${row.job_id}`

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={detailHref}
            className="text-sm font-semibold leading-tight text-gray-900 hover:underline"
          >
            {row.job_number}
          </Link>
          <p
            className="mt-0.5 truncate text-sm text-gray-700"
            title={row.company_name}
          >
            {row.company_name}
          </p>
        </div>

        <SalesOwnerText salesOwner={row.sales_owner} compact />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] leading-5 text-gray-600">
        <div className="min-w-0">
          <span className="font-medium text-gray-900">Osoba:</span>{' '}
          <span className="break-words">{row.contact_person || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Prodejna:</span>{' '}
          <span className="break-words">{row.store_number || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Začátek:</span>{' '}
          <span className="break-words">{formatDateTime(row.start_at)}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Konec:</span>{' '}
          <span className="break-words">{formatDateTime(row.end_at)}</span>
        </div>

        <div className="col-span-2 min-w-0">
          <span className="font-medium text-gray-900">Adresa:</span>{' '}
          <span className="break-words">{row.site_address || '—'}</span>
        </div>
      </div>

      <div className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-gray-50">
        <MobileFinanceRow label="Info">
          <FinanceEditableCell
            financeId={row.id}
            field="info_note"
            value={row.info_note}
            type="text"
            emptyLabel="-"
            align="right"
            formatter={(value) => (typeof value === 'string' ? value : '')}
            compact
            title={row.info_note ?? '-'}
            emptyVariant="plain"
          />
        </MobileFinanceRow>

        <MobileFinanceRow label="Faktura">
          <FinanceEditableCell
            financeId={row.id}
            field="invoice_number"
            value={row.invoice_number}
            type="text"
            emptyLabel="DOPLNIT"
            align="center"
            formatter={(value) => (typeof value === 'string' ? value : '')}
            compact
            title={row.invoice_number ?? 'Doplnit'}
            filledVariant="invoice"
            emptyVariant="action"
          />
        </MobileFinanceRow>

        <MobileFinanceRow label="Prodej">
          <FinanceEditableCell
            financeId={row.id}
            field="sale_amount"
            value={row.sale_amount}
            type="number"
            emptyLabel="DOPLNIT"
            align="right"
            formatter={(value) =>
              typeof value === 'number' ? formatMoney(value) : ''
            }
            compact
            title={
              typeof row.sale_amount === 'number'
                ? formatMoney(row.sale_amount)
                : 'Doplnit'
            }
            filledVariant="strong"
            emptyVariant="action"
          />
        </MobileFinanceRow>

        <MobileFinanceRow label="Náklad">
          <FinanceEditableCell
            financeId={row.id}
            field="cost_amount"
            value={row.cost_amount}
            type="number"
            emptyLabel="DOPLNIT"
            align="right"
            formatter={(value) =>
              typeof value === 'number' ? formatMoney(value) : ''
            }
            compact
            title={
              typeof row.cost_amount === 'number'
                ? formatMoney(row.cost_amount)
                : 'Doplnit'
            }
            filledVariant="strong"
            emptyVariant="action"
          />
        </MobileFinanceRow>

        <MobileFinanceRow label="Zisk">
          <ProfitText
            saleAmount={row.sale_amount}
            costAmount={row.cost_amount}
            compact
          />
        </MobileFinanceRow>
      </div>
    </div>
  )
}

function ReadOnlyCell({
  value,
  title,
  align = 'left',
}: {
  value: string | null
  title?: string | null
  align?: 'left' | 'center'
}) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left'

  return (
    <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
      <span
        className={`block h-8 truncate px-1 py-1 text-[12px] leading-6 text-gray-700 ${alignClass}`}
        title={title ?? value ?? '—'}
      >
        {value || '—'}
      </span>
    </td>
  )
}

function FinanceEditableCell({
  financeId,
  field,
  value,
  type,
  emptyLabel,
  align,
  formatter,
  compact = false,
  title,
  filledVariant = 'default',
  emptyVariant = 'action',
}: {
  financeId: string
  field: InlineEditableFinanceField
  value: string | number | null
  type: 'text' | 'number'
  emptyLabel: string
  align: 'left' | 'center' | 'right'
  formatter: (value: string | number | null) => string
  compact?: boolean
  title?: string
  filledVariant?: 'default' | 'invoice' | 'strong'
  emptyVariant?: 'plain' | 'action'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(toDraftValue(value, type))
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraftValue(toDraftValue(value, type))
  }, [type, value])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  function cancelEditing() {
    setDraftValue(toDraftValue(value, type))
    setIsEditing(false)
  }

  function saveValue() {
    const originalValue = toDraftValue(value, type)
    const normalizedDraft = draftValue.trim()

    if (normalizedDraft === originalValue.trim()) {
      setIsEditing(false)
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', field)
      formData.set('value', normalizedDraft)

      const result = await updateFinanceInlineFieldAction(
        financeId,
        { success: false, error: null },
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

  const textAlignClass =
    align === 'right'
      ? 'text-right'
      : align === 'center'
        ? 'text-center'
        : 'text-left'

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        inputMode={type === 'number' ? 'numeric' : undefined}
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
        className={`h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[12px] font-semibold text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200 ${textAlignClass}`}
      />
    )
  }

  const hasValue =
    typeof value === 'number'
      ? true
      : typeof value === 'string'
        ? value.trim().length > 0
        : false

  if (!hasValue && emptyVariant === 'plain') {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className={`${EDITABLE_CELL_BASE_CLASS} ${textAlignClass} ${
          compact ? 'text-sm' : ''
        } text-gray-400 hover:bg-black/[0.025]`}
        title={title}
      >
        <span className={`block w-full truncate leading-5 ${textAlignClass}`}>
          {emptyLabel}
        </span>
      </button>
    )
  }

  if (!hasValue && emptyVariant === 'action') {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className={`${EDITABLE_CELL_BASE_CLASS} ${compact ? 'text-sm' : ''}`}
        title={title}
      >
        <span className="inline-flex h-full w-full items-center justify-center rounded-lg border border-[#2980B9]/30 bg-[#2980B9]/10 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2980B9] transition hover:border-[#2980B9]/40 hover:bg-[#2980B9]/15">
          {emptyLabel}
        </span>
      </button>
    )
  }

  const filledClassName =
    filledVariant === 'invoice'
      ? 'font-semibold text-[#2980B9] hover:bg-[#2980B9]/[0.06]'
      : filledVariant === 'strong'
        ? 'font-semibold text-black hover:bg-black/[0.025]'
        : 'font-medium text-gray-900 hover:bg-black/[0.025]'

  const filledTextClassName =
    filledVariant === 'invoice'
      ? 'font-semibold text-[#2980B9]'
      : filledVariant === 'strong'
        ? 'font-semibold text-black'
        : 'font-medium text-gray-900'

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={`${EDITABLE_CELL_BASE_CLASS} ${textAlignClass} ${
        compact ? 'text-sm' : ''
      } ${filledClassName}`}
      title={title}
    >
      <span
        className={`block w-full truncate leading-5 ${filledTextClassName} ${
          align === 'right'
            ? 'text-right'
            : align === 'center'
              ? 'text-center'
              : 'text-left'
        }`}
      >
        {formatter(value)}
      </span>
    </button>
  )
}

function ProfitText({
  saleAmount,
  costAmount,
  compact = false,
}: {
  saleAmount: number | null
  costAmount: number | null
  compact?: boolean
}) {
  const hasSale = typeof saleAmount === 'number'
  const hasCost = typeof costAmount === 'number'
  const hasBoth = hasSale && hasCost

  if (!hasBoth) {
    return (
      <span
        className={`flex h-8 w-full items-center justify-end gap-1 px-2 py-1.5 ${
          compact ? 'text-sm' : 'text-[12px]'
        }`}
        title="Zisk se dopočítá po doplnění prodeje a nákladu."
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2980B9] [animation-delay:0ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2980B9] [animation-delay:180ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#2980B9] [animation-delay:360ms]" />
      </span>
    )
  }

  const profit = (saleAmount ?? 0) - (costAmount ?? 0)

  return (
    <span
      className={`block h-8 w-full truncate px-2 py-1.5 text-right font-semibold leading-5 ${
        compact ? 'text-sm' : 'text-[12px]'
      } ${profit < 0 ? 'text-red-600' : 'text-black'}`}
      title={formatMoney(profit)}
    >
      {formatMoney(profit)}
    </span>
  )
}

function SalesOwnerText({
  salesOwner,
  compact = false,
}: {
  salesOwner: SalesOwner
  compact?: boolean
}) {
  return (
    <span
      className={`inline-flex h-8 items-center justify-start rounded-lg px-2 py-1 text-left font-medium text-gray-700 ${
        compact ? 'text-[11px]' : 'text-[12px]'
      }`}
      title={salesOwner}
    >
      {salesOwner}
    </span>
  )
}

function MobileFinanceRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function toDraftValue(value: string | number | null, type: 'text' | 'number') {
  if (type === 'text') {
    return typeof value === 'string' ? value : ''
  }

  if (typeof value === 'number') {
    return String(Math.round(value))
  }

  return ''
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(value))
}