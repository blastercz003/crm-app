'use client'

import { useMemo, useState } from 'react'
import type { NordFjellaReservationItemRow, NordFjellaReservationItemType, NordFjellaVatMode } from '@/lib/nord-fjella/types'

type DraftReservationItem = {
  id: string
  itemType: NordFjellaReservationItemType
  label: string
  quantity: string
  unit: string
  unitPrice: string
  vatMode: NordFjellaVatMode
  note: string
}

type ReservationItemsEditorProps = {
  defaultItems?: NordFjellaReservationItemRow[]
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const selectClassName =
  'clients-modal__select h-11 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

function toDraftItem(item?: NordFjellaReservationItemRow): DraftReservationItem {
  if (!item) {
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random()}`,
      itemType: 'manual_service',
      label: '',
      quantity: '1',
      unit: 'ks',
      unitPrice: '0',
      vatMode: 'vat_12',
      note: '',
    }
  }

  return {
    id: item.id,
    itemType: item.item_type,
    label: item.label,
    quantity: String(item.quantity),
    unit: item.unit,
    unitPrice: String(item.unit_price),
    vatMode: item.vat_mode,
    note: item.note ?? '',
  }
}

function getPresetLabel(itemType: NordFjellaReservationItemType) {
  switch (itemType) {
    case 'manual_service':
      return 'Doplňková služba'
    case 'discount':
      return 'Sleva'
    case 'cancellation_fee':
      return 'Storno poplatek'
    case 'accommodation':
      return 'Ubytování'
    case 'cleaning':
      return 'Úklid'
    case 'city_tax':
      return 'Místní poplatek'
    default:
      return ''
  }
}

const EXTRA_ITEM_TYPE_OPTIONS: Array<{ value: NordFjellaReservationItemType; label: string }> = [
  { value: 'manual_service', label: 'Doplňková služba' },
  { value: 'discount', label: 'Sleva' },
]

const LEGACY_ITEM_TYPE_OPTIONS: Partial<
  Record<NordFjellaReservationItemType, { value: NordFjellaReservationItemType; label: string }>
> = {
  accommodation: { value: 'accommodation', label: 'Ubytování (legacy)' },
  cleaning: { value: 'cleaning', label: 'Úklid (legacy)' },
  city_tax: { value: 'city_tax', label: 'Místní poplatek (legacy)' },
  cancellation_fee: { value: 'cancellation_fee', label: 'Storno poplatek (legacy)' },
}

function getPresetUnit(itemType: NordFjellaReservationItemType) {
  switch (itemType) {
    case 'accommodation':
      return 'noc'
    case 'city_tax':
      return 'os./noc'
    default:
      return 'ks'
  }
}

function normalizeDecimal(value: string) {
  const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function getItemTypeOptions(currentType: NordFjellaReservationItemType) {
  const currentOption = LEGACY_ITEM_TYPE_OPTIONS[currentType]

  return currentOption ? [currentOption, ...EXTRA_ITEM_TYPE_OPTIONS] : EXTRA_ITEM_TYPE_OPTIONS
}

export function ReservationItemsEditor({ defaultItems = [] }: ReservationItemsEditorProps) {
  const [items, setItems] = useState<DraftReservationItem[]>(() =>
    defaultItems.length > 0 ? defaultItems.map((item) => toDraftItem(item)) : []
  )

  const serializedItems = useMemo(
    () =>
      JSON.stringify(
        items.map((item, index) => ({
          sortOrder: index,
          itemType: item.itemType,
          label: item.label,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          vatMode: item.vatMode,
          note: item.note,
        }))
      ),
    [items]
  )

  const summaryTotal = useMemo(
    () =>
      items.reduce((sum, item) => {
        const quantity = normalizeDecimal(item.quantity)
        const unitPrice = normalizeDecimal(item.unitPrice)
        return sum + quantity * unitPrice
      }, 0),
    [items]
  )

  function addItem() {
    setItems((current) => [...current, toDraftItem()])
  }

  function removeItem(id: string) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  function updateItem(id: string, patch: Partial<DraftReservationItem>) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item

        const next = { ...item, ...patch }

        if (patch.itemType && !item.label.trim()) {
          next.label = getPresetLabel(patch.itemType)
        }

        if (patch.itemType && (!item.unit.trim() || item.unit === getPresetUnit(item.itemType))) {
          next.unit = getPresetUnit(patch.itemType)
        }

        if (patch.itemType === 'discount' && (!patch.unitPrice || patch.unitPrice === item.unitPrice)) {
          next.unitPrice = '-0'
        }

        return next
      })
    )
  }

  return (
    <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
      <input type="hidden" name="reservation_items_payload" value={serializedItems} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="nord-fjella-modal-card-title text-sm font-semibold text-gray-900">Doplňkové položky vyúčtování</div>
          <div className="mt-1 text-sm text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
            Ruční služby, slevy, storno a další položky mimo základní cenu pobytu.
          </div>
        </div>

        <button
          type="button"
          onClick={addItem}
          className="offers-page__filter-submit inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
        >
          Přidat položku
        </button>
      </div>

      {items.length === 0 ? (
        <div className="nord-fjella-modal-empty-state mt-4 rounded-2xl border border-dashed border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.8)_100%)] px-4 py-5 text-sm text-gray-500">
          Zatím bez doplňkových položek.
        </div>
      ) : (
        <div className="mt-4 grid gap-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="nord-fjella-modal-subtle-card rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
            >
              <div className="grid gap-4 md:grid-cols-12">
                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-medium text-gray-900">Typ položky</label>
                  <select
                    value={item.itemType}
                    onChange={(event) =>
                      updateItem(item.id, {
                        itemType: event.target.value as NordFjellaReservationItemType,
                      })
                    }
                    className={selectClassName}
                  >
                    {getItemTypeOptions(item.itemType).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2 md:col-span-5">
                  <label className="text-sm font-medium text-gray-900">Název položky</label>
                  <input
                    value={item.label}
                    onChange={(event) => updateItem(item.id, { label: event.target.value })}
                    className={inputClassName}
                    placeholder="Např. Sauna, pozdní checkout, sleva za delší pobyt"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-900">Množství</label>
                  <input
                    value={item.quantity}
                    onChange={(event) => updateItem(item.id, { quantity: event.target.value })}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-900">Jednotka</label>
                  <input
                    value={item.unit}
                    onChange={(event) => updateItem(item.id, { unit: event.target.value })}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-medium text-gray-900">Cena za jednotku</label>
                  <input
                    value={item.unitPrice}
                    onChange={(event) => updateItem(item.id, { unitPrice: event.target.value })}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2 md:col-span-3">
                  <label className="text-sm font-medium text-gray-900">DPH režim</label>
                  <select
                    value={item.vatMode}
                    onChange={(event) =>
                      updateItem(item.id, {
                        vatMode: event.target.value as NordFjellaVatMode,
                      })
                    }
                    className={selectClassName}
                  >
                    <option value="vat_12">DPH 12 %</option>
                    <option value="vat_21">DPH 21 %</option>
                    <option value="vat_exempt">Osvobozeno od DPH</option>
                  </select>
                </div>

                <div className="space-y-2 md:col-span-4">
                  <label className="text-sm font-medium text-gray-900">Poznámka</label>
                  <input
                    value={item.note}
                    onChange={(event) => updateItem(item.id, { note: event.target.value })}
                    className={inputClassName}
                    placeholder="Volitelně"
                  />
                </div>

                <div className="flex items-end justify-between gap-3 md:col-span-2">
                  <div className="nord-fjella-modal-subtle-card-text text-sm font-semibold text-gray-900">
                    {(normalizeDecimal(item.quantity) * normalizeDecimal(item.unitPrice)).toLocaleString('cs-CZ', {
                      style: 'currency',
                      currency: 'CZK',
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-medium text-red-700 transition duration-200 hover:-translate-y-[1px]"
                  >
                    Smazat
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 text-right text-sm font-semibold text-gray-900 [html[data-theme='dark']_&]:text-white">
        Součet doplňkových položek:{' '}
        {summaryTotal.toLocaleString('cs-CZ', {
          style: 'currency',
          currency: 'CZK',
          maximumFractionDigits: 2,
        })}
      </div>
    </div>
  )
}
