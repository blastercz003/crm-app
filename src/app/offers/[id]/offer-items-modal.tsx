'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  saveOfferItemsAction,
  type OfferItemInput,
} from '@/app/offers/actions'
import {
  formatCurrency,
  getOfferItemNetTotal,
} from '@/lib/offers/calculations'
import type { OfferItemRow } from '@/lib/offers/types'

type DraftOfferItem = {
  id: string
  description: string
  specification: string
  unitPrice: string
  unit: string
  quantity: string
  discountPercent: string
}

type OfferItemPreset = {
  key: string
  description: string
  specification: string
  unitPrice: number
  unit: string
  discountPercent?: number
}

type OfferItemsModalProps = {
  offerId: string
  currency: string
  itemSection: string
  title: string
  items: OfferItemRow[]
  sectionNote?: string
  showDiscount?: boolean
  showQuantityAndTotal?: boolean
  presets?: OfferItemPreset[]
}

const OFFER_ITEM_PRESETS: OfferItemPreset[] = [
  {
    key: 'rental-da-250-kva',
    description: 'Pronájem DA 250 kVA',
    specification: '',
    unitPrice: 7990,
    unit: 'den',
  },
  {
    key: 'cabling-20m',
    description: 'Kabeláž 20m',
    specification: '',
    unitPrice: 1500,
    unit: 'den',
  },
  {
    key: 'transport-under-35t',
    description: 'Doprava do 3,5t',
    specification: '',
    unitPrice: 24,
    unit: 'km',
  },
  {
    key: 'install-deinstall',
    description: 'Instal. / deinstal.',
    specification: '',
    unitPrice: 890,
    unit: 'hod',
  },
  {
    key: 'operator',
    description: 'Odborná obsluha',
    specification: '',
    unitPrice: 690,
    unit: 'hod',
  },
  {
    key: 'fuel',
    description: 'PHM',
    specification: '',
    unitPrice: 40,
    unit: 'l',
  },
]

const OFFER_ITEM_MODAL_GRID_COLUMNS =
  'minmax(150px,1fr) minmax(180px,1.2fr) 110px 72px 90px 84px 120px 168px'

function createDraftId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `offer-item-${Math.random().toString(36).slice(2, 10)}`
}

function formatInputNumber(value: number) {
  if (Number.isInteger(value)) {
    return String(value)
  }

  return String(value).replace('.', ',')
}

function createEmptyDraftItem(): DraftOfferItem {
  return {
    id: createDraftId(),
    description: '',
    specification: '',
    unitPrice: '',
    unit: 'ks',
    quantity: '1',
    discountPercent: '',
  }
}

function createPresetDraftItem(preset: OfferItemPreset): DraftOfferItem {
  return {
    id: createDraftId(),
    description: preset.description,
    specification: preset.specification,
    unitPrice: formatInputNumber(preset.unitPrice),
    unit: preset.unit,
    quantity: '1',
    discountPercent:
      typeof preset.discountPercent === 'number' && preset.discountPercent > 0
        ? formatInputNumber(preset.discountPercent)
        : '',
  }
}

function buildDraftItems(items: OfferItemRow[]) {
  if (items.length === 0) {
    return []
  }

  return items.map((item) => ({
    id: item.id,
    description: item.description,
    specification: item.specification ?? '',
    unitPrice: formatInputNumber(item.unit_price_without_vat),
    unit: item.unit,
    quantity: formatInputNumber(item.quantity),
    discountPercent:
      Number(item.discount_percent) > 0 ? formatInputNumber(item.discount_percent) : '',
  }))
}

function parseDecimalInput(value: string) {
  const normalized = value.trim().replace(/\s+/g, '').replace(',', '.')

  if (!normalized) {
    return 0
  }

  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : Number.NaN
}

function getDraftLineTotal(item: DraftOfferItem) {
  const unitPrice = parseDecimalInput(item.unitPrice)
  const quantity = parseDecimalInput(item.quantity)
  const discountPercent = parseDecimalInput(item.discountPercent)

  if (
    !Number.isFinite(unitPrice) ||
    !Number.isFinite(quantity) ||
    !Number.isFinite(discountPercent)
  ) {
    return null
  }

  return unitPrice * quantity * (1 - Math.min(Math.max(discountPercent, 0), 100) / 100)
}

function prepareItemsForSave(
  items: DraftOfferItem[],
  itemSection: string
):
  | {
      success: true
      items: OfferItemInput[]
    }
  | {
      success: false
      error: string
    } {
  const preparedItems: OfferItemInput[] = []

  for (const item of items) {
    const description = item.description.trim()
    const specification = item.specification.trim()
    const unitPrice = parseDecimalInput(item.unitPrice)
    const quantity = parseDecimalInput(item.quantity)
    const discountPercent = parseDecimalInput(item.discountPercent)
    const isBlankRow =
      !description &&
      !specification &&
      !item.unitPrice.trim() &&
      !item.quantity.trim() &&
      !item.discountPercent.trim()

    if (isBlankRow) {
      continue
    }

    if (!description) {
      return {
        success: false,
        error: 'Každý aktivní řádek musí mít vyplněnou položku.',
      }
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return {
        success: false,
        error: `Jednotková cena u položky "${description}" není platná.`,
      }
    }

    if (!Number.isFinite(quantity) || quantity < 0) {
      return {
        success: false,
        error: `Množství u položky "${description}" není platné.`,
      }
    }

    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
      return {
        success: false,
        error: `Sleva u položky "${description}" musí být v rozmezí 0 až 100 %.`,
      }
    }

    preparedItems.push({
      description,
      specification: specification || null,
      unitPrice,
      unit: item.unit.trim() || 'ks',
      quantity,
      discountPercent,
      itemSection,
    })
  }

  return {
    success: true,
    items: preparedItems,
  }
}

function getDraftItemsTotal(items: DraftOfferItem[]) {
  return items.reduce((sum, item) => {
    const lineTotal = getDraftLineTotal(item)
    return sum + (typeof lineTotal === 'number' ? lineTotal : 0)
  }, 0)
}

export function OfferItemsEditor({
  offerId,
  currency,
  itemSection,
  title,
  items,
  sectionNote = '',
  showDiscount = true,
  showQuantityAndTotal = true,
  presets = OFFER_ITEM_PRESETS,
}: OfferItemsModalProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [rows, setRows] = useState<DraftOfferItem[]>(() => buildDraftItems(items))
  const [draftSectionNote, setDraftSectionNote] = useState(sectionNote)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [selectedPresetKey, setSelectedPresetKey] = useState(presets[0]?.key ?? '')
  const [isPending, startTransition] = useTransition()
  const total = useMemo(() => getDraftItemsTotal(rows), [rows])
  const savedTotal = useMemo(
    () => items.reduce((sum, item) => sum + getOfferItemNetTotal(item), 0),
    [items]
  )
  const detailColumnClasses = showQuantityAndTotal
    ? {
        item: 'w-[23%]',
        specification: 'w-[28%]',
        price: 'w-[13%]',
        unit: 'w-[8%]',
        quantity: 'w-[10%]',
        discount: 'w-[8%]',
        total: showDiscount ? 'w-[10%]' : 'w-[18%]',
      }
    : {
        item: 'w-[31%]',
        specification: 'w-[36%]',
        price: 'w-[22%]',
        unit: 'w-[11%]',
      }
  const modalGridColumns = showQuantityAndTotal
    ? OFFER_ITEM_MODAL_GRID_COLUMNS
    : 'minmax(170px,1fr) minmax(220px,1.35fr) 130px 80px 168px'
  const useCompactClassicMobileCards = showQuantityAndTotal && itemSection !== 'bsafe_service'

  useEffect(() => {
    if (presets.length === 0) {
      setSelectedPresetKey('')
      return
    }

    if (!presets.some((preset) => preset.key === selectedPresetKey)) {
      setSelectedPresetKey(presets[0].key)
    }
  }, [presets, selectedPresetKey])

  function resetRows() {
    setRows(buildDraftItems(items))
    setDraftSectionNote(sectionNote)
    setErrorMessage(null)
  }

  function updateRow(rowId: string, field: keyof DraftOfferItem, value: string) {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.id === rowId
          ? {
              ...row,
              [field]: value,
            }
          : row
      )
    )
  }

  function addRow() {
    setRows((currentRows) => [...currentRows, createEmptyDraftItem()])
  }

  function addPresetRow() {
    const preset = presets.find((item) => item.key === selectedPresetKey) ?? presets[0]

    if (!preset) {
      return
    }

    setRows((currentRows) => [...currentRows, createPresetDraftItem(preset)])
  }

  function duplicateRow(rowId: string) {
    setRows((currentRows) => {
      const rowIndex = currentRows.findIndex((row) => row.id === rowId)

      if (rowIndex === -1) {
        return currentRows
      }

      const nextRows = [...currentRows]
      nextRows.splice(rowIndex + 1, 0, {
        ...currentRows[rowIndex],
        id: createDraftId(),
      })
      return nextRows
    })
  }

  function removeRow(rowId: string) {
    setRows((currentRows) => {
      return currentRows.filter((row) => row.id !== rowId)
    })
  }

  function moveRow(rowId: string, direction: 'up' | 'down') {
    setRows((currentRows) => {
      const rowIndex = currentRows.findIndex((row) => row.id === rowId)

      if (rowIndex === -1) {
        return currentRows
      }

      const targetIndex = direction === 'up' ? rowIndex - 1 : rowIndex + 1

      if (targetIndex < 0 || targetIndex >= currentRows.length) {
        return currentRows
      }

      const nextRows = [...currentRows]
      const [movedRow] = nextRows.splice(rowIndex, 1)
      nextRows.splice(targetIndex, 0, movedRow)
      return nextRows
    })
  }

  function handleOpen() {
    resetRows()
    setIsOpen(true)
  }

  function handleSave() {
    const prepared = prepareItemsForSave(
      showDiscount
        ? rows
        : rows.map((row) => ({
            ...row,
            discountPercent: '',
          })),
      itemSection
    )

    if (!prepared.success) {
      setErrorMessage(prepared.error)
      return
    }

    setErrorMessage(null)

    startTransition(async () => {
      const result = await saveOfferItemsAction(offerId, itemSection, prepared.items, draftSectionNote)

      if (!result.success) {
        setErrorMessage(result.error ?? 'Položky nabídky se nepodařilo uložit.')
        return
      }

      router.refresh()
      setIsOpen(false)
    })
  }

  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">
              {title}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Položky vložíš a upravíš kliknutím na tlačítko vpravo.
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            {showQuantityAndTotal ? (
              <div className="rounded-2xl bg-gray-50 px-4 py-2 text-right">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Cena bez DPH
                </div>
                <div className="mt-1 text-base font-semibold text-gray-900">
                  {formatCurrency(savedTotal, currency)}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={handleOpen}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
            >
              Upravit položky
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200">
            <div className="border-b border-gray-100 bg-white p-4 text-sm text-gray-500">
              Tato kalkulace zatím nemá žádné položky.
            </div>
            <div className="min-h-[44px] bg-gray-50 px-4 py-2 text-xs leading-5 text-gray-900">
              <span className="font-semibold">Poznámka:</span>{' '}
              <span className="whitespace-pre-wrap">{sectionNote}</span>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <div className="grid gap-3 md:hidden">
              {items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  {useCompactClassicMobileCards ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold leading-5 text-gray-900">
                            {item.description}
                          </div>
                          {item.specification ? (
                            <div className="mt-1 whitespace-pre-wrap text-xs leading-4 text-gray-500">
                              {item.specification}
                            </div>
                          ) : null}
                        </div>
                        <div className="shrink-0 rounded-xl bg-gray-50 px-3 py-2 text-right">
                          <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                            Cena bez DPH
                          </div>
                          <div className="mt-0.5 whitespace-nowrap text-sm font-semibold text-gray-900">
                            {formatCurrency(getOfferItemNetTotal(item), currency)}
                          </div>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-4 gap-1 text-[10px]">
                        <div className="min-w-0 rounded-xl bg-gray-50 px-1.5 py-1.5">
                          <dt className="truncate font-semibold uppercase tracking-[0.04em] text-gray-500">
                            Cena
                          </dt>
                          <dd className="mt-0.5 truncate font-semibold text-gray-900">
                            {formatCurrency(Number(item.unit_price_without_vat), currency)}
                          </dd>
                        </div>
                        <div className="min-w-0 rounded-xl bg-gray-50 px-1.5 py-1.5">
                          <dt className="truncate font-semibold uppercase tracking-[0.04em] text-gray-500">
                            Jedn.
                          </dt>
                          <dd className="mt-0.5 truncate font-semibold text-gray-900">{item.unit}</dd>
                        </div>
                        <div className="min-w-0 rounded-xl bg-gray-50 px-1.5 py-1.5">
                          <dt className="truncate font-semibold uppercase tracking-[0.04em] text-gray-500">
                            Množ.
                          </dt>
                          <dd className="mt-0.5 truncate font-semibold text-gray-900">
                            {Number(item.quantity).toLocaleString('cs-CZ')}
                          </dd>
                        </div>
                        {showDiscount ? (
                          <div className="min-w-0 rounded-xl bg-gray-50 px-1.5 py-1.5">
                            <dt className="truncate font-semibold uppercase tracking-[0.04em] text-gray-500">
                              Sleva
                            </dt>
                            <dd className="mt-0.5 truncate font-semibold text-gray-900">
                              {Number(item.discount_percent) > 0
                                ? `${Number(item.discount_percent).toLocaleString('cs-CZ')} %`
                                : '-'}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </>
                  ) : showQuantityAndTotal ? (
                    <>
                      <div className="text-sm font-semibold leading-5 text-gray-900">
                        {item.description}
                      </div>
                      {item.specification ? (
                        <div className="mt-1 whitespace-pre-wrap text-sm leading-5 text-gray-600">
                          {item.specification}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="grid grid-cols-[minmax(0,1fr)_92px_58px] items-center gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5 text-gray-900" title={item.description}>
                          {item.description}
                        </div>
                        {item.specification ? (
                          <div className="mt-0.5 truncate text-xs leading-4 text-gray-500" title={item.specification}>
                            {item.specification}
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-xl bg-gray-50 px-2 py-1.5">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                          Jedn. cena
                        </div>
                        <div className="mt-0.5 whitespace-nowrap text-xs font-semibold text-gray-900">
                          {formatCurrency(Number(item.unit_price_without_vat), currency)}
                        </div>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-2 py-1.5">
                        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                          Jedn.
                        </div>
                        <div className="mt-0.5 truncate text-xs font-semibold text-gray-900">
                          {item.unit}
                        </div>
                      </div>
                    </div>
                  )}
                  {showQuantityAndTotal && !useCompactClassicMobileCards ? (
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          Jedn. cena
                        </dt>
                        <dd className="mt-1 font-semibold text-gray-900">
                          {formatCurrency(Number(item.unit_price_without_vat), currency)}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          Jedn.
                        </dt>
                        <dd className="mt-1 font-semibold text-gray-900">{item.unit}</dd>
                      </div>
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          Množství
                        </dt>
                        <dd className="mt-1 font-semibold text-gray-900">
                          {Number(item.quantity).toLocaleString('cs-CZ')}
                        </dd>
                      </div>
                      {showDiscount ? (
                      <div className="rounded-xl bg-gray-50 px-3 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          Sleva
                        </dt>
                        <dd className="mt-1 font-semibold text-gray-900">
                          {Number(item.discount_percent) > 0
                            ? `${Number(item.discount_percent).toLocaleString('cs-CZ')} %`
                            : '-'}
                        </dd>
                      </div>
                      ) : null}
                      <div className="col-span-2 rounded-xl bg-gray-50 px-3 py-2">
                        <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                          Cena bez DPH
                        </dt>
                        <dd className="mt-1 text-base font-semibold text-gray-900">
                          {formatCurrency(getOfferItemNetTotal(item), currency)}
                        </dd>
                      </div>
                    </dl>
                  ) : null}
                </article>
              ))}
              <div className="min-h-[44px] rounded-2xl bg-gray-50 px-4 py-2 text-xs leading-5 text-gray-900">
                <span className="font-semibold">Poznámka:</span>{' '}
                <span className="whitespace-pre-wrap">{sectionNote}</span>
              </div>
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-gray-200 md:block">
              <table className="w-full table-fixed border-collapse text-sm">
                <colgroup>
                  <col className={detailColumnClasses.item} />
                  <col className={detailColumnClasses.specification} />
                  <col className={detailColumnClasses.price} />
                  <col className={detailColumnClasses.unit} />
                  {showQuantityAndTotal ? <col className={detailColumnClasses.quantity} /> : null}
                  {showQuantityAndTotal && showDiscount ? (
                    <col className={detailColumnClasses.discount} />
                  ) : null}
                  {showQuantityAndTotal ? <col className={detailColumnClasses.total} /> : null}
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                    <th className="px-4 py-3">Položka</th>
                    <th className="px-4 py-3">Specifikace / popis</th>
                    <th className="px-4 py-3 text-right">Jedn. cena</th>
                    <th className="px-4 py-3 text-center">Jedn.</th>
                    {showQuantityAndTotal ? <th className="px-4 py-3 text-right">Množství</th> : null}
                    {showQuantityAndTotal && showDiscount ? (
                      <th className="px-4 py-3 text-right">Sleva</th>
                    ) : null}
                    {showQuantityAndTotal ? (
                      <th className="px-4 py-3 text-right">Cena bez DPH</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-gray-100">
                      <td className="break-words px-4 py-3 font-medium text-gray-900">{item.description}</td>
                      <td className="break-words px-4 py-3 text-gray-600">{item.specification ?? ''}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {formatCurrency(Number(item.unit_price_without_vat), currency)}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">{item.unit}</td>
                      {showQuantityAndTotal ? (
                        <td className="px-4 py-3 text-right text-gray-600">
                          {Number(item.quantity).toLocaleString('cs-CZ')}
                        </td>
                      ) : null}
                      {showQuantityAndTotal && showDiscount ? (
                        <td className="px-4 py-3 text-right text-gray-600">
                          {Number(item.discount_percent) > 0 ? `${Number(item.discount_percent).toLocaleString('cs-CZ')} %` : '-'}
                        </td>
                      ) : null}
                      {showQuantityAndTotal ? (
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {formatCurrency(getOfferItemNetTotal(item), currency)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="min-h-[44px] bg-gray-50 px-4 py-2 text-xs leading-5 text-gray-900">
                <span className="font-semibold">Poznámka:</span>{' '}
                <span className="whitespace-pre-wrap">{sectionNote}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
          aria-modal="true"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) {
              setIsOpen(false)
            }
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-center">
            <div className="flex h-[calc(100vh-2rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl sm:h-[calc(100vh-3rem)]">
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold uppercase text-gray-900">
                      Položky nabídky
                    </h2>
                    {showQuantityAndTotal ? (
                      <div className="mt-2 inline-flex items-center rounded-full bg-[#2980B9] px-2.5 py-1 text-xs font-semibold text-white">
                        {formatCurrency(total, currency)} bez DPH
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    disabled={isPending}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-lg text-gray-500 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    aria-label="Zavřít modal"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="px-4 pb-4 sm:px-6">
                <div className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="grid gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:items-center">
                    <select
                      value={selectedPresetKey}
                      onChange={(event) => setSelectedPresetKey(event.target.value)}
                      disabled={isPending}
                      className="h-10 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:opacity-60 sm:col-span-2 md:w-auto md:min-w-[260px]"
                    >
                      {presets.map((preset) => (
                        <option key={preset.key} value={preset.key}>
                          {preset.description} / {formatCurrency(preset.unitPrice, currency)} / {preset.unit}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={addPresetRow}
                      disabled={isPending}
                      className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Přidat položku
                    </button>
                    <button
                      type="button"
                      onClick={addRow}
                      disabled={isPending}
                      className="inline-flex h-10 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Vlastní řádek
                    </button>
                  </div>
                  <div className="text-xs font-medium text-gray-600 md:text-sm">
                    Úpravy se uloží najednou tlačítkem dole.
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                {errorMessage ? (
                  <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="space-y-3">
                  <div
                    className="hidden gap-2 px-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500 md:grid"
                    style={{ gridTemplateColumns: modalGridColumns }}
                  >
                    <div>Položka</div>
                    <div>Specifikace / popis</div>
                    <div className="text-right">Jedn. cena</div>
                    <div>Jedn.</div>
                    {showQuantityAndTotal ? <div className="text-right">Množství</div> : null}
                    {showQuantityAndTotal && showDiscount ? (
                      <div className="text-right">Sleva %</div>
                    ) : null}
                    {showQuantityAndTotal ? <div className="text-right">Cena bez DPH</div> : null}
                    <div />
                  </div>

                  {rows.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                      Přidej položku z nabídky nebo vytvoř vlastní řádek.
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:hidden">
                    {rows.map((row, index) => {
                      const lineTotal = getDraftLineTotal(row)

                      return (
                        <div key={`mobile-${row.id}`} className="rounded-2xl border border-gray-200 bg-white p-3">
                          <div className="grid gap-2">
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                Položka
                              </span>
                              <input
                                value={row.description}
                                onChange={(event) => updateRow(row.id, 'description', event.target.value)}
                                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                                placeholder="Položka"
                              />
                            </label>
                            <label className="block">
                              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                Specifikace / popis
                              </span>
                              <input
                                value={row.specification}
                                onChange={(event) => updateRow(row.id, 'specification', event.target.value)}
                                className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                                placeholder="Specifikace / popis"
                              />
                            </label>

                            <div className={useCompactClassicMobileCards ? 'grid grid-cols-4 gap-1' : 'grid grid-cols-2 gap-2'}>
                              <label className="block">
                                <span className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                  {useCompactClassicMobileCards ? 'Cena' : 'Jedn. cena'}
                                </span>
                                <input
                                  value={row.unitPrice}
                                  onChange={(event) => updateRow(row.id, 'unitPrice', event.target.value)}
                                  className={[
                                    'w-full rounded-xl border border-gray-200 bg-white text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200',
                                    useCompactClassicMobileCards ? 'h-9 px-1.5 text-xs' : 'h-10 px-3',
                                  ].join(' ')}
                                  placeholder="0"
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                  Jedn.
                                </span>
                                <input
                                  value={row.unit}
                                  onChange={(event) => updateRow(row.id, 'unit', event.target.value)}
                                  className={[
                                    'w-full rounded-xl border border-gray-200 bg-white text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200',
                                    useCompactClassicMobileCards ? 'h-9 px-1.5 text-xs' : 'h-10 px-3',
                                  ].join(' ')}
                                  placeholder="ks"
                                />
                              </label>
                              {showQuantityAndTotal ? (
                                <label className="block">
                                  <span className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                    {useCompactClassicMobileCards ? 'Množ.' : 'Množství'}
                                  </span>
                                  <input
                                    value={row.quantity}
                                    onChange={(event) => updateRow(row.id, 'quantity', event.target.value)}
                                    className={[
                                      'w-full rounded-xl border border-gray-200 bg-white text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200',
                                      useCompactClassicMobileCards ? 'h-9 px-1.5 text-xs' : 'h-10 px-3',
                                    ].join(' ')}
                                    placeholder="1"
                                  />
                                </label>
                              ) : null}
                              {showQuantityAndTotal && showDiscount ? (
                                <label className="block">
                                  <span className="mb-1 block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                                    Sleva %
                                  </span>
                                  <input
                                    value={row.discountPercent}
                                    onChange={(event) => updateRow(row.id, 'discountPercent', event.target.value)}
                                    className={[
                                      'w-full rounded-xl border border-gray-200 bg-white text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200',
                                      useCompactClassicMobileCards ? 'h-9 px-1.5 text-xs' : 'h-10 px-3',
                                    ].join(' ')}
                                    placeholder="-"
                                  />
                                </label>
                              ) : null}
                              {showQuantityAndTotal ? (
                                <div className={`${useCompactClassicMobileCards ? 'col-span-4' : 'col-span-2'} rounded-xl bg-gray-50 px-3 py-2`}>
                                  <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                    Cena bez DPH
                                  </div>
                                  <div className="mt-1 text-right text-base font-semibold text-gray-900">
                                    {typeof lineTotal === 'number' ? formatCurrency(lineTotal, currency) : '-'}
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="grid grid-cols-4 gap-1 pt-1">
                              <button
                                type="button"
                                onClick={() => moveRow(row.id, 'up')}
                                disabled={index === 0 || isPending}
                                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                                title="Nahoru"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveRow(row.id, 'down')}
                                disabled={index === rows.length - 1 || isPending}
                                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                                title="Dolů"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => duplicateRow(row.id)}
                                disabled={isPending}
                                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Duplikovat"
                              >
                                2×
                              </button>
                              <button
                                type="button"
                                onClick={() => removeRow(row.id)}
                                disabled={isPending}
                                className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                                title="Smazat"
                              >
                                ×
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {rows.map((row, index) => {
                    const lineTotal = getDraftLineTotal(row)

                    return (
                      <div
                        key={row.id}
                        className="hidden gap-2 rounded-2xl border border-gray-200 bg-white p-3 md:grid"
                        style={{ gridTemplateColumns: modalGridColumns }}
                      >
                        <input
                          value={row.description}
                          onChange={(event) => updateRow(row.id, 'description', event.target.value)}
                          className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                          placeholder="Položka"
                        />
                        <input
                          value={row.specification}
                          onChange={(event) => updateRow(row.id, 'specification', event.target.value)}
                          className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                          placeholder="Specifikace / popis"
                        />
                        <input
                          value={row.unitPrice}
                          onChange={(event) => updateRow(row.id, 'unitPrice', event.target.value)}
                          className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                          placeholder="0"
                        />
                        <input
                          value={row.unit}
                          onChange={(event) => updateRow(row.id, 'unit', event.target.value)}
                          className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                          placeholder="ks"
                        />
                        {showQuantityAndTotal ? (
                          <input
                            value={row.quantity}
                            onChange={(event) => updateRow(row.id, 'quantity', event.target.value)}
                            className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                            placeholder="1"
                          />
                        ) : null}
                        {showQuantityAndTotal && showDiscount ? (
                          <input
                            value={row.discountPercent}
                            onChange={(event) => updateRow(row.id, 'discountPercent', event.target.value)}
                            className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-right text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                            placeholder="-"
                          />
                        ) : (
                          showQuantityAndTotal ? <div /> : null
                        )}
                        {showQuantityAndTotal ? (
                          <div className="flex h-10 items-center justify-end rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-900">
                            {typeof lineTotal === 'number' ? formatCurrency(lineTotal, currency) : '-'}
                          </div>
                        ) : null}
                        <div className="grid grid-cols-4 gap-1">
                          <button
                            type="button"
                            onClick={() => moveRow(row.id, 'up')}
                            disabled={index === 0 || isPending}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                            title="Nahoru"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(row.id, 'down')}
                            disabled={index === rows.length - 1 || isPending}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35"
                            title="Dolů"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateRow(row.id)}
                            disabled={isPending}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                            title="Duplikovat"
                          >
                            2×
                          </button>
                          <button
                            type="button"
                            onClick={() => removeRow(row.id)}
                            disabled={isPending}
                            className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                            title="Smazat"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                  <label
                    htmlFor={`section-note-${itemSection}`}
                    className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id={`section-note-${itemSection}`}
                    value={draftSectionNote}
                    onChange={(event) => setDraftSectionNote(event.target.value)}
                    rows={2}
                    className="min-h-[52px] w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Poznámka k této sekci"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  disabled={isPending}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 bg-white px-5 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Zavřít
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isPending}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-[#2980B9] px-5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'Ukládám...' : 'Uložit položky'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
