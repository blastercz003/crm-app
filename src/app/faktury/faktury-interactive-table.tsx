'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { EditJobButton } from '../jobs/edit-job-button'
import { GLASS_SECONDARY_BUTTON_CLASS } from '@/components/ui/glass-secondary-button'
import {
  downloadJobAttachmentAction,
  deleteJobAttachmentAction,
  deleteFinanceCostItemsAction,
  getJobAttachmentsAction,
  getFinanceCostItemsAction,
  saveFinanceCostItemsAction,
  uploadJobAttachmentsAction,
  updateFinanceInlineFieldAction,
  type JobAttachment,
  type JobAttachmentCategory,
  type FinanceCostItem,
  type FinanceCostItemInput,
} from './actions'
import type { FakturaRow, SalesOwner } from './page'

type InlineEditableFinanceField = 'info_note' | 'invoice_number' | 'sale_amount'

type FakturyInteractiveTableProps = {
  rows: FakturaRow[]
  clientSuggestions: ClientOption[]
}

type ClientOption = {
  id: string
  name: string
}

type CostPreset = {
  key: string
  label: string
  defaultUnitPrice: number
}

type CostRowDraft = {
  id: string
  label: string
  supplier: string
  presetKey: string | null
  unitPrice: string
  quantity: string
  isBase: boolean
}

type ParsedDecimalResult =
  | {
      success: true
      value: number
    }
  | {
      success: false
      value: null
    }

type RowValidationErrors = {
  label?: string
  unitPrice?: string
  quantity?: string
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const EDITABLE_CELL_BASE_CLASS =
  'block h-8 w-full rounded-lg px-0 py-1.5 text-[12px] transition'
const EDITABLE_CELL_COMPACT_CLASS = 'h-7 py-1'
const EMPTY_ACTION_BADGE_CLASS =
  'flex h-full w-full items-center justify-center rounded-lg border border-[#76a9d3]/65 bg-[linear-gradient(155deg,rgba(79,146,203,0.14)_0%,rgba(58,126,184,0.1)_100%)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2f78b1] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition duration-200 hover:border-[#76a9d3]/85 hover:bg-[linear-gradient(155deg,rgba(79,146,203,0.2)_0%,rgba(58,126,184,0.14)_100%)]'
const EMPTY_ACTION_BADGE_COMPACT_CLASS = 'text-[9px] tracking-[0.1em]'

const BASE_COST_PRESETS: CostPreset[] = [
  { key: 'doprava', label: 'Doprava', defaultUnitPrice: 19 },
  { key: 'prace-technika', label: 'Práce technika', defaultUnitPrice: 400 },
  { key: 'najem-da', label: 'Nájem DA', defaultUnitPrice: 3500 },
  { key: 'najem-kabelu', label: 'Nájem kabelu', defaultUnitPrice: 350 },
  { key: 'phm', label: 'PHM', defaultUnitPrice: 35 },
]

const OPTIONAL_COST_PRESETS: CostPreset[] = [
  { key: 'pohotovost', label: 'Pohotovost', defaultUnitPrice: 1000 },
  { key: 'nadlimitni-mth', label: 'Nadlimitní MTH', defaultUnitPrice: 400 },
  { key: 'ubytovani', label: 'Ubytování', defaultUnitPrice: 2000 },
  { key: 'tankovaci-auto', label: 'Tankovací auto', defaultUnitPrice: 1000 },
  { key: 'tankovaci-nadrz', label: 'Tankovací nádrž', defaultUnitPrice: 200 },
]

const DEFAULT_OPTIONAL_PRESET_KEY = OPTIONAL_COST_PRESETS[0]?.key ?? ''
const ATTACHMENT_CATEGORY_OPTIONS: Array<{
  value: JobAttachmentCategory
  label: string
}> = [
  { value: 'predavaci_protokol', label: 'Předávací protokol' },
  { value: 'foto', label: 'Foto' },
  { value: 'jine', label: 'Jiné' },
]

export function FakturyInteractiveTable({
  rows,
  clientSuggestions,
}: FakturyInteractiveTableProps) {
  return (
    <>
      <section className="jobs-page__table-shell faktury-page__table-shell hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
        <div className="overflow-x-auto px-1 py-2">
          <table className="jobs-page__table w-full table-fixed border-separate border-spacing-y-2">
            <colgroup>
              <col className="w-[60px]" />
              <col className="w-[72px]" />
              <col />
              <col className="w-[72px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[160px]" />
              <col className="w-[56px]" />
              <col className="w-[112px]" />
              <col className="w-[32px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
              <col className="w-[120px]" />
            </colgroup>
            <thead className="bg-transparent shadow-[0_1px_0_0_#e5e7eb]">
              <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                <th className="w-[60px] px-1.5 py-2 text-center">Zakázka</th>
                <th className="w-[72px] px-1.5 py-2 pr-3 text-left">Obchodník</th>
                <th className="px-1.5 py-2 pl-3 text-left">Firma</th>
                <th className="w-[72px] px-1.5 py-2 text-left">Osoba</th>
                <th className="w-[120px] px-1.5 py-2 text-left">Začátek</th>
                <th className="w-[120px] px-1.5 py-2 text-left">Konec</th>
                <th className="w-[160px] px-1.5 py-2 text-left">Adresa</th>
                <th className="w-[56px] px-1.5 py-2 text-center">Prodejna</th>
                <th className="w-[112px] px-1.5 py-2 text-center">Info</th>
                <th className="w-[32px] px-0 py-2 pr-[10px] text-center">DATA</th>
                <th className="w-[120px] px-1.5 py-2 pl-4 text-center">Faktura</th>
                <th className="w-[120px] px-1.5 py-2 pl-4 text-center">Prodej</th>
                <th className="w-[120px] px-1.5 py-2 pl-4 text-center">Náklad</th>
                <th className="w-[120px] px-1.5 py-2 pl-4 text-center">Zisk</th>
              </tr>
            </thead>

            <tbody className="jobs-page__table-body">
              {rows.map((row) => (
                <DesktopRow
                  key={row.id}
                  row={row}
                  clientSuggestions={clientSuggestions}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="faktury-page__mobile-shell grid gap-3 lg:hidden">
        {rows.map((row) => (
          <MobileCard
            key={row.id}
            row={row}
            clientSuggestions={clientSuggestions}
          />
        ))}
      </section>
    </>
  )
}

function DesktopRow({
  row,
  clientSuggestions,
}: {
  row: FakturaRow
  clientSuggestions: ClientOption[]
}) {
  const isFinanceCompleted =
    Boolean(row.invoice_number?.trim()) &&
    typeof row.sale_amount === 'number' &&
    typeof row.cost_amount === 'number'

  return (
    <tr
      className={`jobs-page__table-row group transition duration-200 hover:-translate-y-[1px] ${
        isFinanceCompleted
          ? '[background:linear-gradient(160deg,rgba(227,240,250,0.98)_0%,rgba(211,229,244,0.94)_52%,rgba(195,219,238,0.9)_100%)]'
          : '[background:linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)]'
      }`}
    >
      <td className="rounded-l-2xl border border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <EditJobButton
          job={row}
          clientSuggestions={clientSuggestions}
          className="jobs-page__job-number-button block h-8 rounded-lg px-1 py-1 text-center text-[12px] font-semibold text-gray-900 transition hover:bg-black/[0.025]"
        >
          <span className="block truncate leading-6 text-gray-900">
            {row.job_number}
          </span>
        </EditJobButton>
      </td>

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 pr-3 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <SalesOwnerText salesOwner={row.sales_owner} />
      </td>

      <ReadOnlyCell
        value={row.company_name}
        title={row.company_name}
        cellClassName="pl-3"
      />
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

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
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

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1 py-2 pr-[10px] text-center align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <JobAttachmentsCell
          jobId={row.job_id}
          jobNumber={row.job_number}
          hasAttachments={row.has_attachments}
        />
      </td>

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 pl-4 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
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

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 pl-4 align-middle text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
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

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 pl-4 align-middle text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <CostAmountCell
          financeId={row.id}
          jobNumber={row.job_number}
          value={row.cost_amount}
        />
      </td>

      <td className="rounded-r-2xl border border-l-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 pl-4 align-middle text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <ProfitText saleAmount={row.sale_amount} costAmount={row.cost_amount} />
      </td>
    </tr>
  )
}

function MobileCard({
  row,
  clientSuggestions,
}: {
  row: FakturaRow
  clientSuggestions: ClientOption[]
}) {
  const [isFinanceOpen, setIsFinanceOpen] = useState(false)
  const isFinanceCompleted =
    Boolean(row.invoice_number?.trim()) &&
    typeof row.sale_amount === 'number' &&
    typeof row.cost_amount === 'number'

  return (
    <div
      className={`jobs-page__mobile-card faktury-page__mobile-card overflow-hidden rounded-2xl border p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.1)] ${
        isFinanceCompleted
          ? 'border-[#95c4e6]/95 bg-[linear-gradient(155deg,rgba(227,240,250,0.98)_0%,rgba(211,229,244,0.94)_52%,rgba(195,219,238,0.9)_100%)]'
          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <EditJobButton
              job={row}
              clientSuggestions={clientSuggestions}
              className="jobs-page__job-number-button min-w-0 text-sm font-semibold leading-tight text-gray-900 hover:underline"
            >
              <span className="block truncate">{row.job_number}</span>
            </EditJobButton>
            <div className="shrink-0">
              <JobAttachmentsCell
                jobId={row.job_id}
                jobNumber={row.job_number}
                hasAttachments={row.has_attachments}
                compact
              />
            </div>
          </div>
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

        <div className="col-span-2 min-w-0">
          <span className="font-medium text-gray-900">Info:</span>{' '}
          <span className="break-words">{row.info_note || '—'}</span>
        </div>
      </div>

      {isFinanceOpen ? (
        <div className="faktury-page__costs-modal__mobile-finance-shell mt-3 rounded-2xl border bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
          <MobileFinanceRow label="Faktura">
            <FinanceEditableCell
              financeId={row.id}
              field="invoice_number"
              value={row.invoice_number}
              type="text"
              emptyLabel="DOPLNIT"
              align="right"
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
            <CostAmountCell
              financeId={row.id}
              jobNumber={row.job_number}
              value={row.cost_amount}
              compact
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
      ) : null}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={() => setIsFinanceOpen((current) => !current)}
          aria-expanded={isFinanceOpen}
          aria-label={isFinanceOpen ? 'Skrýt fakturační data' : 'Zobrazit fakturační data'}
          className={`inline-flex h-8 min-w-[44px] items-center justify-center px-3 text-[18px] font-semibold leading-none tracking-[-0.08em] text-zinc-600 ${GLASS_SECONDARY_BUTTON_CLASS}`}
        >
          ⋯
        </button>
      </div>
    </div>
  )
}

function ReadOnlyCell({
  value,
  title,
  align = 'left',
  cellClassName = '',
}: {
  value: string | null
  title?: string | null
  align?: 'left' | 'center'
  cellClassName?: string
}) {
  const alignClass = align === 'center' ? 'text-center' : 'text-left'

  return (
    <td
      className={`border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-1.5 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] ${cellClassName}`}
    >
      <span
        className={`jobs-page__table-cell-value block h-8 truncate px-1 py-1 text-[12px] leading-6 text-gray-700 ${alignClass}`}
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
        className={`faktury-page__table-inline-edit-input h-8 w-full rounded-lg px-2 text-[12px] font-semibold outline-none transition ${textAlignClass}`}
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
        className={`${EDITABLE_CELL_BASE_CLASS} ${
          compact ? EDITABLE_CELL_COMPACT_CLASS : ''
        } ${textAlignClass} ${
          compact ? 'text-sm' : ''
        } text-gray-400 hover:bg-black/[0.025]`}
        title={title}
      >
        <span
          className={`block w-full truncate px-2 ${
            compact ? 'leading-[1.125rem]' : 'leading-5'
          } ${textAlignClass}`}
        >
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
        className={`${EDITABLE_CELL_BASE_CLASS} ${
          compact ? EDITABLE_CELL_COMPACT_CLASS : ''
        } ${textAlignClass} ${
          compact ? 'text-sm' : ''
        }`}
        title={title}
      >
        <span
          className={`jobs-page__info-button--empty ${EMPTY_ACTION_BADGE_CLASS} ${
            compact ? EMPTY_ACTION_BADGE_COMPACT_CLASS : ''
          }`}
        >
          {emptyLabel}
        </span>
      </button>
    )
  }

  const filledClassName =
    filledVariant === 'invoice'
      ? 'font-semibold text-[#2f78b1] hover:bg-[#4f92cb]/[0.08]'
      : filledVariant === 'strong'
        ? 'font-semibold text-gray-700 hover:bg-black/[0.025]'
        : 'font-medium text-gray-900 hover:bg-black/[0.025]'

  const filledTextClassName =
    filledVariant === 'invoice'
      ? 'font-semibold text-[#2f78b1]'
      : filledVariant === 'strong'
        ? 'font-semibold text-gray-700'
        : 'font-medium text-gray-900'

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={`${EDITABLE_CELL_BASE_CLASS} ${
        compact ? EDITABLE_CELL_COMPACT_CLASS : ''
      } ${textAlignClass} ${
        compact ? 'text-sm' : ''
      } ${filledClassName}`}
      title={title}
    >
      <span
        className={`jobs-page__table-cell-value block w-full truncate px-2 ${
          compact ? 'leading-[1.125rem]' : 'leading-5'
        } ${filledTextClassName} ${
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

function JobAttachmentsCell({
  jobId,
  jobNumber,
  hasAttachments,
  compact = false,
}: {
  jobId: string
  jobNumber: string
  hasAttachments: boolean
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [hasAnyAttachments, setHasAnyAttachments] = useState(hasAttachments)

  useEffect(() => {
    setHasAnyAttachments(hasAttachments)
  }, [hasAttachments])

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={
          compact
            ? 'inline-flex h-8 min-w-[34px] items-center justify-center rounded-lg text-sm transition hover:bg-black/[0.025]'
            : 'mx-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-center transition hover:bg-black/[0.025]'
        }
        title="Přílohy"
        aria-label={`Přílohy zakázky ${jobNumber}`}
      >
        <span
          className={`inline-flex h-full w-full items-center justify-center rounded-lg transition ${
            hasAnyAttachments
              ? 'jobs-page__info-button--filled border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)]'
              : 'jobs-page__info-button--empty border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] hover:border-[#cfd8e3]'
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21.44 11.05 12 20.5a6 6 0 0 1-8.49-8.49l9.2-9.2a4 4 0 1 1 5.66 5.66l-9.2 9.2a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </span>
      </button>

      {isOpen ? (
        <JobAttachmentsModal
          jobId={jobId}
          jobNumber={jobNumber}
          onAttachmentPresenceChange={(hasItems) => setHasAnyAttachments(hasItems)}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function CostAmountCell({
  financeId,
  jobNumber,
  value,
  compact = false,
}: {
  financeId: string
  jobNumber: string
  value: number | null
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const hasValue = typeof value === 'number'
  const title = hasValue ? formatMoney(value) : 'Doplnit náklady'

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`${EDITABLE_CELL_BASE_CLASS} ${
          compact ? EDITABLE_CELL_COMPACT_CLASS : ''
        } text-right ${
          compact ? 'text-sm' : ''
        } ${hasValue ? 'font-semibold text-gray-700 hover:bg-black/[0.025]' : ''}`}
        title={title}
      >
        {hasValue ? (
          <span
            className={`jobs-page__table-cell-value block w-full truncate px-2 text-right font-semibold ${
              compact ? 'leading-[1.125rem]' : 'leading-5'
            } text-gray-700`}
          >
            {formatMoney(value)}
          </span>
        ) : (
          <span
            className={`jobs-page__info-button--empty ${EMPTY_ACTION_BADGE_CLASS} ${
              compact ? EMPTY_ACTION_BADGE_COMPACT_CLASS : ''
            }`}
          >
            DOPLNIT
          </span>
        )}
      </button>

      {isOpen ? (
        <CostItemsModal
          financeId={financeId}
          jobNumber={jobNumber}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function JobAttachmentsModal({
  jobId,
  jobNumber,
  onAttachmentPresenceChange,
  onClose,
}: {
  jobId: string
  jobNumber: string
  onAttachmentPresenceChange: (hasItems: boolean) => void
  onClose: () => void
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<JobAttachment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [categoryValue, setCategoryValue] =
    useState<JobAttachmentCategory>('predavaci_protokol')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])

  const handleRequestClose = useCallback(() => {
    const hasUnsavedChanges = selectedFiles.length > 0

    if (!hasUnsavedChanges) {
      onClose()
      return
    }

    const confirmed = window.confirm(
      'Máš rozpracované změny v přílohách. Opravdu chceš modal zavřít?'
    )

    if (confirmed) {
      onClose()
    }
  }, [onClose, selectedFiles])

  useEffect(() => {
    let active = true

    async function loadAttachments() {
      setIsLoading(true)
      setErrorMessage(null)
      const result = await getJobAttachmentsAction(jobId)

      if (!active) return

      if (!result.success) {
        setErrorMessage(result.error ?? 'Přílohy se nepodařilo načíst.')
        setItems([])
        onAttachmentPresenceChange(false)
        setIsLoading(false)
        return
      }

      setItems(result.items)
      onAttachmentPresenceChange(result.items.length > 0)
      setIsLoading(false)
    }

    void loadAttachments()

    return () => {
      active = false
    }
  }, [jobId, onAttachmentPresenceChange])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isPending) {
        handleRequestClose()
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isPending, handleRequestClose])

  function handleUpload() {
    if (selectedFiles.length === 0) {
      setErrorMessage('Vyber alespoň jeden soubor.')
      return
    }

    setErrorMessage(null)

    startTransition(async () => {
      try {
        const formData = new FormData()
        formData.set('category', categoryValue)
        for (const file of selectedFiles) {
          formData.append('files', file)
        }

        const result = await uploadJobAttachmentsAction(
          jobId,
          formData
        )

        if (!result.success) {
          setErrorMessage(result.error ?? 'Soubor se nepodařilo nahrát.')
          return
        }

        const refreshed = await getJobAttachmentsAction(jobId)
        if (refreshed.success) {
          setItems(refreshed.items)
          onAttachmentPresenceChange(refreshed.items.length > 0)
        }

        setSelectedFiles([])
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        router.refresh()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Neznámá chyba.'
        setErrorMessage(`Soubor se nepodařilo nahrát (${errorMessage}).`)
      }
    })
  }

  function handleOpenAttachment(attachmentId: string) {
    router.push(`/faktury/prilohy/${attachmentId}`)
  }

  function handleDownloadAttachment(attachmentId: string) {
    setErrorMessage(null)

    startTransition(async () => {
      const result = await downloadJobAttachmentAction(attachmentId)
      if (!result.success || !result.signedUrl) {
        setErrorMessage(result.error ?? 'Přílohu se nepodařilo stáhnout.')
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  function handleDeleteAttachment(attachmentId: string, displayName: string) {
    const confirmed = window.confirm(
      `Opravdu chceš smazat přílohu "${displayName}"?`
    )
    if (!confirmed) return

    setErrorMessage(null)

    startTransition(async () => {
      const result = await deleteJobAttachmentAction(attachmentId)
      if (!result.success) {
        setErrorMessage(result.error ?? 'Přílohu se nepodařilo smazat.')
        return
      }

      setItems((current) => {
        const nextItems = current.filter((item) => item.id !== attachmentId)
        onAttachmentPresenceChange(nextItems.length > 0)
        return nextItems
      })
      router.refresh()
    })
  }

  const visibleItems = items

  const modalContent = (
    <div
      className="jobs-page__info-modal__overlay fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          handleRequestClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center">
        <div className="jobs-page__info-modal__attachments-shell flex max-h-[calc(100vh-2rem)] w-full max-w-[960px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Přílohy zakázky
                </h2>
                <div className="mt-2 flex justify-start">
                  <span className="inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.26)]">
                    ZAKÁZKA {jobNumber}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isPending}
                className="jobs-page__info-modal__attachments-close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít modal"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-6">
            <div className="jobs-page__info-modal__upload rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-2">
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
                      onChange={(event) =>
                        setSelectedFiles(Array.from(event.target.files ?? []))
                      }
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

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Kategorie
                  </label>
                  <select
                    value={categoryValue}
                    onChange={(event) =>
                      setCategoryValue(event.target.value as JobAttachmentCategory)
                    }
                    disabled={isPending}
                    className="jobs-page__info-modal__category-select h-10 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                  >
                    {ATTACHMENT_CATEGORY_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

              </div>

              <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-gray-500">
                  Max. velikost jednoho souboru je 5 MB.
                </p>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={isPending || selectedFiles.length === 0}
                    className="jobs-page__info-modal__upload-button inline-flex h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 md:min-w-[176px] md:w-auto"
                >
                  <span>
                    Nahrát
                    <span className="hidden md:inline"> soubory</span>
                  </span>
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
              {!isLoading && visibleItems.length === 0 ? (
                  <div className="jobs-page__info-modal__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-6 text-center text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  Zatím nejsou nahrané žádné přílohy.
                </div>
              ) : null}

              {visibleItems.map((item) => (
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
                      title={formatAttachmentCategory(item.category)}
                    >
                      {formatAttachmentCategory(item.category)}
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

                  <div className="mt-4 grid min-w-0 w-full grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenAttachment(item.id)}
                      disabled={isPending}
                      className="jobs-page__info-modal__attachment-open inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 py-1.5 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      OTEVŘÍT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadAttachment(item.id)}
                      disabled={isPending}
                      className="jobs-page__info-modal__attachment-download inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 py-1.5 text-[11px] font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      STÁHNOUT
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAttachment(item.id, item.displayName)}
                      disabled={isPending}
                      className="jobs-page__info-modal__attachment-delete inline-flex h-9 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 py-1.5 text-[11px] font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                    >
                      SMAZAT
                    </button>
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
                  {!isLoading && visibleItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-sm text-gray-500">
                        Zatím nejsou nahrané žádné přílohy.
                      </td>
                    </tr>
                  ) : null}

                  {visibleItems.map((item) => (
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
                        {formatAttachmentCategory(item.category)}
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
                            onClick={() => handleOpenAttachment(item.id)}
                            disabled={isPending}
                            className="jobs-page__info-modal__attachment-open shrink-0 rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1.5 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                          >
                            OTEVŘÍT
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadAttachment(item.id)}
                            disabled={isPending}
                            className="jobs-page__info-modal__attachment-download shrink-0 rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                          >
                            STÁHNOUT
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleDeleteAttachment(item.id, item.displayName)
                            }
                            disabled={isPending}
                            className="jobs-page__info-modal__attachment-delete shrink-0 rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:opacity-60"
                          >
                            SMAZAT
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function CostItemsModal({
  financeId,
  jobNumber,
  onClose,
}: {
  financeId: string
  jobNumber: string
  onClose: () => void
}) {
  const router = useRouter()
  const [rows, setRows] = useState<CostRowDraft[]>(() => createBaseDraftRows())
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [addPresetKey, setAddPresetKey] = useState(DEFAULT_OPTIONAL_PRESET_KEY)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [hasLoadedData, setHasLoadedData] = useState(false)
  const rowInputBaseClass =
    'faktury-page__costs-modal__row-input rounded-xl text-sm outline-none transition'

  function shouldCloseWithoutSaving() {
    if (!hasUnsavedChanges(rows, savedSnapshot)) {
      return true
    }

    return window.confirm(
      'Máš rozpracované změny nákladů bez uložení. Opravdu chceš modal zavřít?'
    )
  }

  function handleRequestClose() {
    if (shouldCloseWithoutSaving()) {
      onClose()
    }
  }

  useEffect(() => {
    let active = true

    async function loadCostItems() {
      setIsLoading(true)
      setErrorMessage(null)

      const result = await getFinanceCostItemsAction(financeId)

      if (!active) {
        return
      }

      if (!result.success) {
        const fallbackRows =
          getDraftRowsFromStorage(financeId) ?? createBaseDraftRows()

        setRows(fallbackRows)
        setSavedSnapshot(serializeDraftRows(fallbackRows))
        setHasLoadedData(true)
        setErrorMessage(result.error ?? 'Náklady se nepodařilo načíst.')
        setIsLoading(false)
        return
      }

      const nextRows =
        getDraftRowsFromStorage(financeId) ??
        (result.items.length > 0
          ? buildDraftRowsFromItems(result.items)
          : createBaseDraftRows())

      setRows(nextRows)
      setSavedSnapshot(serializeDraftRows(nextRows))
      setHasLoadedData(true)
      setIsLoading(false)
    }

    void loadCostItems()

    return () => {
      active = false
    }
  }, [financeId])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isPending) {
        const canClose =
          !hasUnsavedChanges(rows, savedSnapshot) ||
          window.confirm(
            'Máš rozpracované změny nákladů bez uložení. Opravdu chceš modal zavřít?'
          )

        if (canClose) {
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isPending, onClose, rows, savedSnapshot])

  useEffect(() => {
    if (!hasLoadedData) {
      return
    }

    persistDraftRows(financeId, rows)
  }, [financeId, hasLoadedData, rows])

  function handleRowChange(
    rowId: string,
    field: 'label' | 'supplier' | 'unitPrice' | 'quantity',
    nextValue: string
  ) {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: nextValue,
            }
          : row
      )
    )
  }

  function handleAddPresetRow() {
    const preset = OPTIONAL_COST_PRESETS.find((item) => item.key === addPresetKey)

    if (!preset) {
      return
    }

    setRows((currentRows) => [...currentRows, createPresetDraftRow(preset)])
  }

  function handleAddCustomRow() {
    setRows((currentRows) => [...currentRows, createCustomDraftRow()])
  }

  function handleRemoveRow(rowId: string) {
    setRows((currentRows) =>
      currentRows.filter((row) => row.isBase || row.id !== rowId)
    )
  }

  function handleDuplicateRow(rowId: string) {
    setRows((currentRows) => {
      const rowIndex = currentRows.findIndex((row) => row.id === rowId)

      if (rowIndex === -1) {
        return currentRows
      }

      const duplicatedRow: CostRowDraft = {
        ...currentRows[rowIndex],
        id: createDraftId(),
        isBase: false,
      }

      const nextRows = [...currentRows]
      nextRows.splice(rowIndex + 1, 0, duplicatedRow)
      return nextRows
    })
  }

  function handleMoveRow(rowId: string, direction: 'up' | 'down') {
    setRows((currentRows) => {
      const rowIndex = currentRows.findIndex((row) => row.id === rowId)

      if (rowIndex === -1 || currentRows[rowIndex]?.isBase) {
        return currentRows
      }

      const targetIndex =
        direction === 'up'
          ? findPreviousMovableIndex(currentRows, rowIndex)
          : findNextMovableIndex(currentRows, rowIndex)

      if (targetIndex === -1) {
        return currentRows
      }

      const nextRows = [...currentRows]
      const [movedRow] = nextRows.splice(rowIndex, 1)
      nextRows.splice(targetIndex, 0, movedRow)
      return nextRows
    })
  }

  function handleSave() {
    const prepared = prepareRowsForSave(rows)

    if (!prepared.success) {
      setErrorMessage(prepared.error)
      return
    }

    setErrorMessage(null)

    startTransition(async () => {
      const result = await saveFinanceCostItemsAction(financeId, prepared.items)

      if (!result.success) {
        setErrorMessage(result.error ?? 'Náklady se nepodařilo uložit.')
        return
      }

      clearDraftRowsStorage(financeId)
      setSavedSnapshot(serializeDraftRows(rows))
      router.refresh()
      onClose()
    })
  }

  function handleDeleteCosts() {
    const confirmed = window.confirm(
      'Opravdu chceš smazat všechny náklady této zakázky?'
    )

    if (!confirmed) {
      return
    }

    setErrorMessage(null)

    startTransition(async () => {
      const result = await deleteFinanceCostItemsAction(financeId)

      if (!result.success) {
        setErrorMessage(result.error ?? 'Náklady se nepodařilo smazat.')
        return
      }

      clearDraftRowsStorage(financeId)
      router.refresh()
      onClose()
    })
  }

  const totalCost = getDraftRowsTotal(rows)
  const validationErrors = getDraftRowErrors(rows)

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          handleRequestClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <div className="jobs-page__modal-shell faktury-page__costs-modal flex max-h-[calc(100vh-2rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="px-4 py-4 sm:px-6">
            <div className="faktury-page__costs-modal__header flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Náklady zakázky
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.26)]">
                    ZAKÁZKA {jobNumber}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(241,245,249,0.88)_100%)] px-3 py-1 text-xs font-semibold text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_16px_rgba(15,23,42,0.08)] sm:hidden">
                    {formatMoney(totalCost)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isPending}
                className="faktury-page__costs-modal__close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít modal"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-4 py-3 sm:px-6 sm:py-4">
            <div className="faktury-page__costs-modal__panel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:px-4 sm:py-3">
              <div className="flex flex-col gap-2 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-center gap-2">
                    <select
                      value={addPresetKey}
                      onChange={(event) => setAddPresetKey(event.target.value)}
                      disabled={isLoading || isPending}
                      className="h-9 min-w-0 rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-xs text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:h-10 sm:text-sm"
                    >
                      {OPTIONAL_COST_PRESETS.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.label}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={handleAddPresetRow}
                      disabled={isLoading || isPending}
                      className="jobs-page__modal-cancel inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm"
                    >
                      Přidat položku
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddCustomRow}
                    disabled={isLoading || isPending}
                    className="jobs-page__modal-cancel faktury-page__costs-modal__add-custom-button inline-flex h-9 items-center justify-center rounded-xl border border-dashed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-4 sm:text-sm"
                  >
                    Přidat vlastní řádek
                  </button>
                </div>

                <div className="faktury-page__costs-modal__summary hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 py-2 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] sm:block sm:px-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Celkový náklad
                  </div>
                  <div className="mt-0.5 text-base font-semibold text-gray-900 sm:mt-1 sm:text-lg">
                    {formatMoney(totalCost)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-4">
              {errorMessage ? (
                <div className="faktury-page__costs-modal__error rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
                  {errorMessage}
                </div>
              ) : null}

              <div className="space-y-3 md:hidden">
                {isLoading ? (
                  <div className="faktury-page__costs-modal__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-10 text-center text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    Načítám nákladové položky...
                  </div>
                ) : rows.length === 0 ? (
                  <div className="faktury-page__costs-modal__empty-state rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-10 text-center text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    Zatím nejsou zadané žádné nákladové položky.
                  </div>
                ) : (
                  rows.map((row) => {
                    const lineTotal = getDraftRowLineTotal(row)
                    const hasValidTotal = typeof lineTotal === 'number'
                    const rowErrors = validationErrors.get(row.id) ?? {}
                    const canMoveUp = canMoveRow(rows, row.id, 'up')
                    const canMoveDown = canMoveRow(rows, row.id, 'down')

                    return (
                      <div
                        key={row.id}
                        className="faktury-page__costs-modal__mobile-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                      >
                        <div className="space-y-2.5">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                Položka
                              </div>
                              {row.isBase ? (
                                <div className="flex h-10 items-center justify-between gap-2 rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3">
                                  <span className="block min-w-0 truncate text-sm font-medium text-gray-900">
                                    {row.label}
                                  </span>
                                  <span className="faktury-page__costs-modal__base-pill shrink-0 rounded-full border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                                    Základ
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <input
                                    type="text"
                                    value={row.label}
                                    disabled={isPending}
                                    onChange={(event) =>
                                      handleRowChange(row.id, 'label', event.target.value)
                                    }
                                    placeholder="Název položky"
                                    className={`h-10 w-full px-3 disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} ${
                                      rowErrors.label
                                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                        : ''
                                    }`}
                                  />
                                  {rowErrors.label ? (
                                    <p className="mt-1 text-xs text-red-600">{rowErrors.label}</p>
                                  ) : null}
                                </div>
                              )}
                            </div>

                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                Dodavatel
                              </div>
                              <input
                                type="text"
                                value={row.supplier}
                                disabled={isPending}
                                onChange={(event) =>
                                  handleRowChange(row.id, 'supplier', event.target.value)
                                }
                                placeholder="Dodavatel"
                                className={`h-10 w-full px-3 disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass}`}
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                Jedn. cena
                              </div>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.unitPrice}
                                disabled={isPending}
                                onChange={(event) =>
                                  handleRowChange(row.id, 'unitPrice', event.target.value)
                                }
                                placeholder="0"
                                className={`h-10 w-full px-3 text-right disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} ${
                                  rowErrors.unitPrice
                                    ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                    : ''
                                }`}
                              />
                              {rowErrors.unitPrice ? (
                                <p className="mt-1 text-xs text-red-600">{rowErrors.unitPrice}</p>
                              ) : null}
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                Množství
                              </div>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={row.quantity}
                                disabled={isPending}
                                onChange={(event) =>
                                  handleRowChange(row.id, 'quantity', event.target.value)
                                }
                                placeholder="0"
                                className={`h-10 w-full px-3 text-right disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} ${
                                  rowErrors.quantity
                                    ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                    : ''
                                }`}
                              />
                              {rowErrors.quantity ? (
                                <p className="mt-1 text-xs text-red-600">{rowErrors.quantity}</p>
                              ) : null}
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                                Cena
                              </div>
                              <div className="flex h-10 items-center justify-end rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-3">
                                <span
                                  className={`text-sm font-semibold ${
                                    hasValidTotal ? 'text-gray-900' : 'text-red-600'
                                  }`}
                                >
                                  {hasValidTotal ? formatMoney(lineTotal) : 'Neplatný výpočet'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {row.isBase ? (
                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => handleDuplicateRow(row.id)}
                                disabled={isPending}
                                className="jobs-page__modal-cancel inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Kopie
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleMoveRow(row.id, 'up')}
                                disabled={isPending || !canMoveUp}
                                className="faktury-page__costs-modal__row-neutral-button inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
                                title="Posunout nahoru"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => handleMoveRow(row.id, 'down')}
                                disabled={isPending || !canMoveDown}
                                className="faktury-page__costs-modal__row-neutral-button inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
                                title="Posunout dolů"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDuplicateRow(row.id)}
                                disabled={isPending}
                                className="jobs-page__modal-cancel faktury-page__costs-modal__copy-button inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Duplikovat řádek"
                              >
                                Kopie
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveRow(row.id)}
                                disabled={isPending}
                                className="faktury-page__costs-modal__delete-button inline-flex h-9 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-xs font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                                title="Smazat řádek"
                              >
                                SMAZAT
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="faktury-page__costs-modal__table-shell hidden overflow-x-auto rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] md:block">
                <table className="min-w-full table-fixed border-separate border-spacing-0 bg-transparent">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[24%]" />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                    <col className="w-[132px]" />
                    <col className="w-[220px]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr className="faktury-page__costs-modal__table-head bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(255,255,255,0.94)_100%)] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      <th className="border-b border-white/70 px-3 py-3">
                        Položka
                      </th>
                      <th className="border-b border-white/70 px-3 py-3">
                        Dodavatel
                      </th>
                      <th className="border-b border-white/70 px-3 py-3 text-right">
                        Jedn. cena
                      </th>
                      <th className="border-b border-white/70 px-3 py-3 text-right">
                        Množství
                      </th>
                      <th className="border-b border-white/70 px-3 py-3 text-right">
                        Cena
                      </th>
                      <th className="border-b border-white/70 px-2 py-3 text-right">
                        Akce
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="border-b border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-4 py-10 text-center text-sm text-gray-500"
                        >
                          Načítám nákladové položky...
                        </td>
                      </tr>
                    ) : rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="border-b border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] px-4 py-10 text-center text-sm text-gray-500"
                        >
                          Zatím nejsou zadané žádné nákladové položky.
                        </td>
                      </tr>
                    ) : (
                      rows.map((row) => {
                        const lineTotal = getDraftRowLineTotal(row)
                        const hasValidTotal = typeof lineTotal === 'number'
                        const rowErrors = validationErrors.get(row.id) ?? {}
                        const canMoveUp = canMoveRow(rows, row.id, 'up')
                        const canMoveDown = canMoveRow(rows, row.id, 'down')

                        return (
                          <tr key={row.id} className="faktury-page__costs-modal__table-row border-t border-white/70">
                            <td className="border-b border-white/70 px-3 py-3 align-middle">
                              {row.isBase ? (
                                <div className="flex items-center justify-between gap-3">
                                  <span className="block min-w-0 truncate text-sm font-medium text-gray-900">
                                    {row.label}
                                  </span>
                                  <span className="faktury-page__costs-modal__base-pill shrink-0 rounded-full border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
                                    Základ
                                  </span>
                                </div>
                              ) : (
                                <div>
                                  <input
                                    type="text"
                                    value={row.label}
                                    disabled={isPending}
                                    onChange={(event) =>
                                      handleRowChange(row.id, 'label', event.target.value)
                                    }
                                    placeholder="Název položky"
                                    className={`h-10 w-full px-3 disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} ${
                                      rowErrors.label
                                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                        : ''
                                    }`}
                                  />
                                  {rowErrors.label ? (
                                    <p className="mt-1 text-xs text-red-600">
                                      {rowErrors.label}
                                    </p>
                                  ) : null}
                                </div>
                              )}
                            </td>

                            <td className="border-b border-white/70 px-3 py-3 align-middle">
                              <input
                                type="text"
                                value={row.supplier}
                                disabled={isPending}
                                onChange={(event) =>
                                  handleRowChange(row.id, 'supplier', event.target.value)
                                }
                                placeholder="Dodavatel"
                                className={`h-10 w-full px-3 disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass}`}
                              />
                            </td>

                            <td className="border-b border-white/70 px-3 py-3 align-middle">
                              <div>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.unitPrice}
                                  disabled={isPending}
                                  onChange={(event) =>
                                    handleRowChange(row.id, 'unitPrice', event.target.value)
                                  }
                                  placeholder="0"
                                  className={`ml-auto h-10 px-3 text-right disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} w-[88px] ${
                                    rowErrors.unitPrice
                                      ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                      : ''
                                  }`}
                                />
                                {rowErrors.unitPrice ? (
                                  <p className="mt-1 text-xs text-red-600">
                                    {rowErrors.unitPrice}
                                  </p>
                                ) : null}
                              </div>
                            </td>

                            <td className="border-b border-white/70 px-3 py-3 align-middle">
                              <div>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={row.quantity}
                                  disabled={isPending}
                                  onChange={(event) =>
                                    handleRowChange(row.id, 'quantity', event.target.value)
                                  }
                                  placeholder="0"
                                  className={`ml-auto h-10 px-3 text-right disabled:cursor-not-allowed disabled:opacity-60 ${rowInputBaseClass} w-[88px] ${
                                    rowErrors.quantity
                                      ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                      : ''
                                  }`}
                                />
                                {rowErrors.quantity ? (
                                  <p className="mt-1 text-xs text-red-600">
                                    {rowErrors.quantity}
                                  </p>
                                ) : null}
                              </div>
                            </td>

                            <td className="border-b border-white/70 px-3 py-3 align-middle text-right">
                              <span
                                className={`ml-auto block w-[108px] text-right text-sm font-semibold ${
                                  hasValidTotal ? 'text-gray-900' : 'text-red-600'
                                }`}
                              >
                                {hasValidTotal
                                  ? formatMoney(lineTotal)
                                  : 'Neplatný výpočet'}
                              </span>
                            </td>

                            <td className="border-b border-white/70 px-2 py-3 align-middle text-right">
                              {row.isBase ? (
                                <div className="flex min-w-[212px] justify-end gap-1">
                                  <span className="inline-flex h-9 w-9 shrink-0" aria-hidden="true" />
                                  <span className="inline-flex h-9 w-9 shrink-0" aria-hidden="true" />
                                  <span className="inline-flex h-9 w-[72px] shrink-0" aria-hidden="true" />
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateRow(row.id)}
                                    disabled={isPending}
                                    className="jobs-page__modal-cancel inline-flex h-10 w-[72px] shrink-0 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-2 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                      Kopie
                                    </button>
                                  </div>
                              ) : (
                                <div className="flex min-w-[212px] justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleMoveRow(row.id, 'up')}
                                    disabled={isPending || !canMoveUp}
                                    className="faktury-page__costs-modal__row-neutral-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Posunout nahoru"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveRow(row.id, 'down')}
                                    disabled={isPending || !canMoveDown}
                                    className="faktury-page__costs-modal__row-neutral-button inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Posunout dolů"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateRow(row.id)}
                                    disabled={isPending}
                                    className="jobs-page__modal-cancel inline-flex h-10 w-[72px] shrink-0 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-2 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Duplikovat řádek"
                                  >
                                    Kopie
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRow(row.id)}
                                    disabled={isPending}
                                    className="faktury-page__costs-modal__delete-button inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 text-xs font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Smazat řádek"
                                  >
                                    SMAZAT
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="jobs-page__modal-footer faktury-page__costs-modal__footer border-t border-white/70 px-4 py-3 sm:px-6 sm:py-4">
            <div className="grid grid-cols-2 gap-2 sm:hidden">
              <button
                type="button"
                onClick={handleDeleteCosts}
                disabled={isLoading || isPending}
                className="faktury-page__costs-modal__delete-button inline-flex h-9 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Smazat náklady
              </button>

              <a
                href={`/faktury/${financeId}/costs-export`}
                target="_blank"
                rel="noreferrer"
                className="faktury-page__costs-modal__export-button inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 text-[11px] font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
              >
                Export nákladů
              </a>

                <button
                  type="button"
                  onClick={handleRequestClose}
                  disabled={isPending}
                  className="jobs-page__modal-cancel faktury-page__costs-modal__cancel-button inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Zrušit
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isLoading || isPending}
                  className="jobs-page__modal-submit faktury-page__costs-modal__save-button inline-flex h-10 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'Ukládám…' : 'Uložit'}
                </button>
            </div>

            <div className="hidden sm:flex sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleDeleteCosts}
                disabled={isLoading || isPending}
                className="faktury-page__costs-modal__delete-button inline-flex h-11 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Smazat náklady
              </button>

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                <a
                  href={`/faktury/${financeId}/costs-export`}
                  target="_blank"
                  rel="noreferrer"
                  className="faktury-page__costs-modal__export-button inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]"
                >
                  Export nákladů
                </a>

                <button
                  type="button"
                  onClick={handleRequestClose}
                  disabled={isPending}
                  className="jobs-page__modal-cancel faktury-page__costs-modal__cancel-button inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Zrušit
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isLoading || isPending}
                  className="jobs-page__modal-submit faktury-page__costs-modal__save-button inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'Ukládám…' : 'Uložit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function formatAttachmentCategory(category: JobAttachmentCategory) {
  if (category === 'predavaci_protokol') {
    return 'Předávací protokol'
  }
  if (category === 'foto') {
    return 'Foto'
  }
  return 'Jiné'
}

function formatFileSize(value: number) {
  const size = Number.isFinite(value) ? value : 0
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`
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
        className={`flex w-full items-center justify-end gap-1 px-2 ${
          compact ? 'h-7 py-1' : 'h-8 py-1.5'
        } ${
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
      className={`jobs-page__table-cell-value block w-full truncate px-2 text-right font-semibold ${
        compact ? 'h-7 py-1 leading-[1.125rem]' : 'h-8 py-1.5 leading-5'
      } ${
        compact ? 'text-sm' : 'text-[12px]'
      } ${profit < 0 ? 'text-red-600' : 'text-gray-700'}`}
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
      className={`jobs-page__table-cell-value inline-flex h-8 items-center justify-start rounded-lg px-2 py-1 text-left font-medium text-gray-700 ${
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
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function createDraftId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `cost-row-${Math.random().toString(36).slice(2, 10)}`
}

function formatNumberInput(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return String(value).replace('.', ',')
}

function createPresetDraftRow(preset: CostPreset, isBase = false): CostRowDraft {
  return {
    id: createDraftId(),
    label: preset.label,
    supplier: '',
    presetKey: preset.key,
    unitPrice: formatNumberInput(preset.defaultUnitPrice),
    quantity: '0',
    isBase,
  }
}

function createCustomDraftRow(): CostRowDraft {
  return {
    id: createDraftId(),
    label: '',
    supplier: '',
    presetKey: null,
    unitPrice: '',
    quantity: '',
    isBase: false,
  }
}

function createBaseDraftRows() {
  return BASE_COST_PRESETS.map((preset) => createPresetDraftRow(preset, true))
}

function buildDraftRowsFromItems(items: FinanceCostItem[]) {
  const remainingItems = [...items]

  const baseRows = BASE_COST_PRESETS.map((preset) => {
    const existingIndex = remainingItems.findIndex(
      (item) => item.presetKey === preset.key
    )

    if (existingIndex === -1) {
      return createPresetDraftRow(preset, true)
    }

    const [item] = remainingItems.splice(existingIndex, 1)

    return {
      id: item.id,
      label: preset.label,
      supplier: item.supplier ?? '',
      presetKey: preset.key,
      unitPrice: formatNumberInput(item.unitPrice),
      quantity: formatNumberInput(item.quantity),
      isBase: true,
    }
  })

  const extraRows = remainingItems.map((item) => ({
    id: item.id,
    label: item.label,
    supplier: item.supplier ?? '',
    presetKey: item.presetKey,
    unitPrice: formatNumberInput(item.unitPrice),
    quantity: formatNumberInput(item.quantity),
    isBase: false,
  }))

  return [...baseRows, ...extraRows]
}

function getDraftStorageKey(financeId: string) {
  return `faktury-cost-draft:${financeId}`
}

function persistDraftRows(financeId: string, rows: CostRowDraft[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    getDraftStorageKey(financeId),
    JSON.stringify(normalizeDraftRows(rows))
  )
}

function getDraftRowsFromStorage(financeId: string) {
  if (typeof window === 'undefined') {
    return null
  }

  const rawValue = window.localStorage.getItem(getDraftStorageKey(financeId))

  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue)

    if (!Array.isArray(parsed)) {
      return null
    }

    return parsed.map((row) => ({
      id: typeof row.id === 'string' ? row.id : createDraftId(),
      label: typeof row.label === 'string' ? row.label : '',
      supplier: typeof row.supplier === 'string' ? row.supplier : '',
      presetKey: typeof row.presetKey === 'string' ? row.presetKey : null,
      unitPrice: typeof row.unitPrice === 'string' ? row.unitPrice : '',
      quantity: typeof row.quantity === 'string' ? row.quantity : '',
      isBase: Boolean(row.isBase),
    })) as CostRowDraft[]
  } catch {
    return null
  }
}

function clearDraftRowsStorage(financeId: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(getDraftStorageKey(financeId))
}

function normalizeDraftRows(rows: CostRowDraft[]) {
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    supplier: row.supplier,
    presetKey: row.presetKey,
    unitPrice: row.unitPrice,
    quantity: row.quantity,
    isBase: row.isBase,
  }))
}

function serializeDraftRows(rows: CostRowDraft[]) {
  return JSON.stringify(normalizeDraftRows(rows))
}

function hasUnsavedChanges(rows: CostRowDraft[], savedSnapshot: string) {
  return serializeDraftRows(rows) !== savedSnapshot
}

function findPreviousMovableIndex(rows: CostRowDraft[], currentIndex: number) {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (!rows[index]?.isBase) {
      return index
    }
  }

  return -1
}

function findNextMovableIndex(rows: CostRowDraft[], currentIndex: number) {
  for (let index = currentIndex + 1; index < rows.length; index += 1) {
    if (!rows[index]?.isBase) {
      return index
    }
  }

  return -1
}

function canMoveRow(
  rows: CostRowDraft[],
  rowId: string,
  direction: 'up' | 'down'
) {
  const rowIndex = rows.findIndex((row) => row.id === rowId)

  if (rowIndex === -1 || rows[rowIndex]?.isBase) {
    return false
  }

  return direction === 'up'
    ? findPreviousMovableIndex(rows, rowIndex) !== -1
    : findNextMovableIndex(rows, rowIndex) !== -1
}

function parseDecimalInput(value: string): ParsedDecimalResult {
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.')

  if (!normalized) {
    return {
      success: true,
      value: 0,
    }
  }

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return {
      success: false,
      value: null,
    }
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return {
      success: false,
      value: null,
    }
  }

  return {
    success: true,
    value: parsed,
  }
}

function getDraftRowLineTotal(row: CostRowDraft) {
  const unitPrice = parseDecimalInput(row.unitPrice)
  const quantity = parseDecimalInput(row.quantity)

  if (!unitPrice.success || !quantity.success) {
    return null
  }

  return Math.round(unitPrice.value * quantity.value)
}

function getDraftRowsTotal(rows: CostRowDraft[]) {
  return rows.reduce((sum, row) => {
    const lineTotal = getDraftRowLineTotal(row)
    return sum + (typeof lineTotal === 'number' ? lineTotal : 0)
  }, 0)
}

function getDraftRowErrors(rows: CostRowDraft[]) {
  const errors = new Map<string, RowValidationErrors>()

  rows.forEach((row) => {
    const rowErrors: RowValidationErrors = {}
    const label = row.label.trim()
    const unitPrice = parseDecimalInput(row.unitPrice)
    const quantity = parseDecimalInput(row.quantity)
    const isBlankCustomRow =
      !row.isBase &&
      !label &&
      !row.supplier.trim() &&
      !row.unitPrice.trim() &&
      !row.quantity.trim() &&
      !row.presetKey

    if (isBlankCustomRow) {
      return
    }

    if (!label) {
      rowErrors.label = 'Doplň název položky.'
    }

    if (!unitPrice.success) {
      rowErrors.unitPrice = 'Zadej platné číslo.'
    }

    if (!quantity.success) {
      rowErrors.quantity = 'Zadej platné číslo.'
    }

    if (rowErrors.label || rowErrors.unitPrice || rowErrors.quantity) {
      errors.set(row.id, rowErrors)
    }
  })

  return errors
}

function prepareRowsForSave(
  rows: CostRowDraft[]
):
  | {
      success: true
      items: FinanceCostItemInput[]
    }
  | {
      success: false
      error: string
    } {
  const items: FinanceCostItemInput[] = []

  for (const row of rows) {
    const label = row.label.trim()
    const unitPrice = parseDecimalInput(row.unitPrice)
    const quantity = parseDecimalInput(row.quantity)
    const isBlankCustomRow =
      !row.isBase &&
      !label &&
      !row.supplier.trim() &&
      !row.unitPrice.trim() &&
      !row.quantity.trim() &&
      !row.presetKey

    if (isBlankCustomRow) {
      continue
    }

    if (!label) {
      return {
        success: false,
        error: 'Každý aktivní nákladový řádek musí mít vyplněný název položky.',
      }
    }

    if (!unitPrice.success) {
      return {
        success: false,
        error: `Jednotková cena u položky "${label}" není ve správném formátu.`,
      }
    }

    if (!quantity.success) {
      return {
        success: false,
        error: `Množství u položky "${label}" není ve správném formátu.`,
      }
    }

    items.push({
      label,
      supplier: row.supplier.trim() || null,
      presetKey: row.presetKey,
      sortOrder: items.length,
      unitPrice: unitPrice.value,
      quantity: quantity.value,
    })
  }

  if (items.length === 0) {
    return {
      success: false,
      error: 'Doplň alespoň základní nákladové řádky.',
    }
  }

  return {
    success: true,
    items,
  }
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
