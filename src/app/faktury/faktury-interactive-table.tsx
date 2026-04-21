'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  deleteFinanceCostItemsAction,
  getFinanceCostItemsAction,
  saveFinanceCostItemsAction,
  updateFinanceInlineFieldAction,
  type FinanceCostItem,
  type FinanceCostItemInput,
} from './actions'
import type { FakturaRow, SalesOwner } from './page'

type InlineEditableFinanceField = 'info_note' | 'invoice_number' | 'sale_amount'

type FakturyInteractiveTableProps = {
  rows: FakturaRow[]
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

export function FakturyInteractiveTable({
  rows,
}: FakturyInteractiveTableProps) {
  return (
    <>
      <section className="hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:block">
        <div className="overflow-x-auto px-1 py-2">
          <table className="w-full table-fixed border-separate border-spacing-y-2">
            <thead>
              <tr className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                <th className="w-[60px] px-1.5 py-2 text-center">Zakázka</th>
                <th className="w-[72px] px-1.5 py-2 text-left">Obchodník</th>
                <th className="w-[150px] px-1.5 py-2 text-left">Firma</th>
                <th className="w-[96px] px-1.5 py-2 text-left">Osoba</th>
                <th className="w-[108px] px-1.5 py-2 text-left">Začátek</th>
                <th className="w-[108px] px-1.5 py-2 text-left">Konec</th>
                <th className="w-[148px] px-1.5 py-2 text-left">Adresa</th>
                <th className="w-[56px] px-1.5 py-2 text-center">Prodejna</th>
                <th className="w-[112px] px-1.5 py-2 text-center">Info</th>
                <th className="w-[88px] px-1.5 py-2 text-center">Faktura</th>
                <th className="w-[88px] px-1.5 py-2 text-center">Prodej</th>
                <th className="w-[88px] px-1.5 py-2 text-center">Náklad</th>
                <th className="w-[88px] px-1.5 py-2 text-center">Zisk</th>
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
      <td className="rounded-l-2xl border border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <CostAmountCell
          financeId={row.id}
          jobNumber={row.job_number}
          value={row.cost_amount}
        />
      </td>

      <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-1.5 py-2 align-middle text-right transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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
    <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-1.5 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
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
        <span className={`block w-full truncate px-2 leading-5 ${textAlignClass}`}>
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
        className={`${EDITABLE_CELL_BASE_CLASS} ${textAlignClass} ${
          compact ? 'text-sm' : ''
        }`}
        title={title}
      >
        <span className="flex h-full w-full items-center justify-center rounded-lg border border-[#2980B9]/30 bg-[#2980B9]/10 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2980B9] transition hover:border-[#2980B9]/40 hover:bg-[#2980B9]/15">
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
        className={`block w-full truncate px-2 leading-5 ${filledTextClassName} ${
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
        className={`${EDITABLE_CELL_BASE_CLASS} text-right ${
          compact ? 'text-sm' : ''
        } ${hasValue ? 'font-semibold text-black hover:bg-black/[0.025]' : ''}`}
        title={title}
      >
        {hasValue ? (
          <span className="block w-full truncate px-2 text-right font-semibold leading-5 text-black">
            {formatMoney(value)}
          </span>
        ) : (
          <span className="flex h-full w-full items-center justify-center rounded-lg border border-[#2980B9]/30 bg-[#2980B9]/10 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#2980B9] transition hover:border-[#2980B9]/40 hover:bg-[#2980B9]/15">
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

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/45 p-3 sm:p-4"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          handleRequestClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
          <div className="px-4 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Náklady zakázky
                </h2>
                <div className="mt-2 flex justify-start">
                  <span className="inline-flex items-center rounded-full bg-[#2980B9] px-2.5 py-1 text-xs font-semibold text-white">
                    ZAKÁZKA {jobNumber}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isPending}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-lg text-gray-500 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Zavřít modal"
              >
                ×
              </button>
            </div>
          </div>

          <div className="px-4 py-4 sm:px-6">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex items-center gap-2">
                    <select
                      value={addPresetKey}
                      onChange={(event) => setAddPresetKey(event.target.value)}
                      disabled={isLoading || isPending}
                      className="h-10 min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Přidat položku
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddCustomRow}
                    disabled={isLoading || isPending}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Přidat vlastní řádek
                  </button>
                </div>

                <div className="rounded-2xl bg-white px-4 py-2 text-right shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Celkový náklad
                  </div>
                  <div className="mt-1 text-lg font-semibold text-gray-900">
                    {formatMoney(totalCost)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            <div className="space-y-4">
              {errorMessage ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {errorMessage}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-3xl border border-gray-200">
                <table className="min-w-full table-fixed border-separate border-spacing-0 bg-white">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[24%]" />
                    <col className="w-[96px]" />
                    <col className="w-[96px]" />
                    <col className="w-[132px]" />
                    <col className="w-[220px]" />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      <th className="border-b border-gray-200 px-3 py-3">
                        Položka
                      </th>
                      <th className="border-b border-gray-200 px-3 py-3">
                        Dodavatel
                      </th>
                      <th className="border-b border-gray-200 px-3 py-3 text-right">
                        Jedn. cena
                      </th>
                      <th className="border-b border-gray-200 px-3 py-3 text-right">
                        Množství
                      </th>
                      <th className="border-b border-gray-200 px-3 py-3 text-right">
                        Cena
                      </th>
                      <th className="border-b border-gray-200 px-2 py-3 text-right">
                        Akce
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-10 text-center text-sm text-gray-500"
                        >
                          Načítám nákladové položky...
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
                          <tr key={row.id} className="border-t border-gray-100">
                            <td className="border-b border-gray-100 px-3 py-3 align-middle">
                              {row.isBase ? (
                                <div className="flex items-center justify-between gap-3">
                                  <span className="block min-w-0 truncate text-sm font-medium text-gray-900">
                                    {row.label}
                                  </span>
                                  <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-gray-500">
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
                                    className={`h-10 w-full rounded-xl border bg-white px-3 text-sm text-gray-900 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                      rowErrors.label
                                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                        : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
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

                            <td className="border-b border-gray-100 px-3 py-3 align-middle">
                              <input
                                type="text"
                                value={row.supplier}
                                disabled={isPending}
                                onChange={(event) =>
                                  handleRowChange(row.id, 'supplier', event.target.value)
                                }
                                placeholder="Dodavatel"
                                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                            </td>

                            <td className="border-b border-gray-100 px-3 py-3 align-middle">
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
                                  className={`ml-auto h-10 w-[88px] rounded-xl border bg-white px-3 text-right text-sm text-gray-900 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                    rowErrors.unitPrice
                                      ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                      : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
                                  }`}
                                />
                                {rowErrors.unitPrice ? (
                                  <p className="mt-1 text-xs text-red-600">
                                    {rowErrors.unitPrice}
                                  </p>
                                ) : null}
                              </div>
                            </td>

                            <td className="border-b border-gray-100 px-3 py-3 align-middle">
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
                                  className={`ml-auto h-10 w-[88px] rounded-xl border bg-white px-3 text-right text-sm text-gray-900 outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${
                                    rowErrors.quantity
                                      ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                                      : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
                                  }`}
                                />
                                {rowErrors.quantity ? (
                                  <p className="mt-1 text-xs text-red-600">
                                    {rowErrors.quantity}
                                  </p>
                                ) : null}
                              </div>
                            </td>

                            <td className="border-b border-gray-100 px-3 py-3 align-middle text-right">
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

                            <td className="border-b border-gray-100 px-2 py-3 align-middle text-right">
                              {row.isBase ? (
                                <div className="flex min-w-[212px] justify-end gap-1">
                                  <span className="inline-flex h-9 w-9 shrink-0" aria-hidden="true" />
                                  <span className="inline-flex h-9 w-9 shrink-0" aria-hidden="true" />
                                  <span className="inline-flex h-9 w-[72px] shrink-0" aria-hidden="true" />
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateRow(row.id)}
                                    disabled={isPending}
                                    className="inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-xl bg-gray-900 px-2 text-xs font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
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
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Posunout nahoru"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleMoveRow(row.id, 'down')}
                                    disabled={isPending || !canMoveDown}
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                                    title="Posunout dolů"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateRow(row.id)}
                                    disabled={isPending}
                                    className="inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-xl bg-gray-900 px-2 text-xs font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                                    title="Duplikovat řádek"
                                  >
                                    Kopie
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRow(row.id)}
                                    disabled={isPending}
                                    className="inline-flex h-9 w-[72px] shrink-0 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-2 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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

          <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <button
              type="button"
              onClick={handleDeleteCosts}
              disabled={isLoading || isPending}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Smazat náklady
            </button>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <a
                href={`/faktury/${financeId}/costs-export`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 transition hover:bg-gray-50"
              >
                Export nákladů
              </a>

              <button
                type="button"
                onClick={handleRequestClose}
                disabled={isPending}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-gray-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Zrušit
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={isLoading || isPending}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2980B9] px-5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'Ukládám…' : 'Uložit'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
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
