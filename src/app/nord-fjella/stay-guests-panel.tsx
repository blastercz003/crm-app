'use client'

import { useActionState, useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { ModalHeading } from '@/components/ui/modal-heading'
import type {
  NordFjellaCityTaxStatus,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import {
  deleteNordFjellaStayGuestAction,
  saveNordFjellaStayGuestAction,
  type NordFjellaStayGuestActionState,
} from './actions'

const inputClassName =
  'clients-modal__input min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const selectClassName =
  'clients-modal__select h-11 min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const initialState: NordFjellaStayGuestActionState = {
  success: false,
  error: null,
}

function getTaxStatusLabel(status: NordFjellaCityTaxStatus) {
  if (status === 'liable') return 'Poplatek'
  if (status === 'exempt') return 'Osvobozen'
  return 'Bez poplatku'
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0))
}

export function StayGuestsPanel({
  reservation,
  initialGuests,
}: {
  reservation: NordFjellaReservationRow
  initialGuests: NordFjellaStayGuestRow[]
}) {
  const [guests, setGuests] = useState(initialGuests)
  const [editingGuest, setEditingGuest] = useState<NordFjellaStayGuestRow | null | undefined>()
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()
  const expectedCount = reservation.adult_count + reservation.child_count
  const isComplete = guests.length === expectedCount
  const isLegallyProtected =
    reservation.record_type === 'reservation' &&
    (reservation.reservation_status === 'completed' ||
      reservation.stay_end_date <= new Date().toISOString().slice(0, 10))

  useEffect(() => {
    setGuests(initialGuests)
  }, [initialGuests])

  function handleSaved(guest: NordFjellaStayGuestRow) {
    setGuests((current) => {
      const exists = current.some((item) => item.id === guest.id)
      const next = exists
        ? current.map((item) => (item.id === guest.id ? guest : item))
        : [...current, guest]
      return next.sort((left, right) => left.sort_order - right.sort_order)
    })
    setEditingGuest(undefined)
  }

  function handleDelete(guest: NordFjellaStayGuestRow) {
    if (!window.confirm(`Opravdu odstranit osobu ${guest.first_name} ${guest.last_name} z evidence?`)) {
      return
    }

    setDeleteError(null)
    startDeleteTransition(async () => {
      const result = await deleteNordFjellaStayGuestAction(guest.id, reservation.id)

      if (!result.success) {
        setDeleteError(result.error)
        return
      }

      setGuests((current) => current.filter((item) => item.id !== guest.id))
    })
  }

  return (
    <>
      <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="nord-fjella-modal-card-title text-sm font-semibold text-gray-900">
              Ubytované osoby
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              Česká evidence hostů · {guests.length}/{expectedCount} osob doplněno
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em] ${
                isComplete
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {isComplete ? 'Evidence kompletní' : 'Evidence neúplná'}
            </span>
            <button
              type="button"
              onClick={() => setEditingGuest(null)}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_18px_rgba(24,78,129,0.24)] transition hover:-translate-y-[1px]"
            >
              Přidat osobu
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-2">
          {guests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-200 px-3 py-4 text-center text-xs text-zinc-500">
              Zatím není doplněna žádná skutečně ubytovaná osoba.
            </div>
          ) : (
            guests.map((guest) => (
              <div
                key={guest.id}
                className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-zinc-200/75 bg-white/70 px-3 py-2 [html[data-theme='dark']_&]:border-slate-400/12 [html[data-theme='dark']_&]:bg-slate-950/20"
              >
                <div className="min-w-[180px] flex-1">
                  <div className="truncate text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                    {guest.first_name} {guest.last_name}
                    {guest.is_primary ? (
                      <span className="ml-2 text-[9px] font-semibold uppercase tracking-[0.06em] text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
                        hlavní host
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    {guest.guest_category === 'child' ? 'Dítě' : 'Dospělý'} · {getTaxStatusLabel(guest.city_tax_status)}
                    {guest.city_tax_status === 'liable' ? ` ${formatCurrency(guest.city_tax_amount)}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditingGuest(guest)}
                  className="inline-flex h-8 items-center justify-center rounded-xl border border-zinc-200 bg-white/80 px-2.5 text-[10px] font-medium uppercase text-zinc-700"
                >
                  Upravit
                </button>
                {isLegallyProtected ? (
                  <span
                    title="Záznam je součástí zákonné evidence a uchovává se 6 let po skončení pobytu."
                    className="inline-flex h-8 items-center justify-center rounded-xl border border-sky-200/80 bg-sky-50/70 px-2.5 text-[9px] font-semibold uppercase tracking-[0.04em] text-sky-800 [html[data-theme='dark']_&]:border-sky-300/15 [html[data-theme='dark']_&]:bg-sky-400/8 [html[data-theme='dark']_&]:text-sky-200"
                  >
                    Evidence 6 let
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleDelete(guest)}
                    disabled={isDeleting}
                    className="inline-flex h-8 items-center justify-center rounded-xl border border-red-200 bg-red-50/80 px-2.5 text-[10px] font-medium uppercase text-red-700 disabled:opacity-50"
                  >
                    Odebrat
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {deleteError ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {deleteError}
          </div>
        ) : null}
      </div>

      {editingGuest !== undefined ? (
        <StayGuestModal
          key={editingGuest?.id ?? 'new'}
          reservation={reservation}
          guest={editingGuest}
          onClose={() => setEditingGuest(undefined)}
          onSaved={handleSaved}
        />
      ) : null}
    </>
  )
}

function StayGuestModal({
  reservation,
  guest,
  onClose,
  onSaved,
}: {
  reservation: NordFjellaReservationRow
  guest: NordFjellaStayGuestRow | null
  onClose: () => void
  onSaved: (guest: NordFjellaStayGuestRow) => void
}) {
  const [state, formAction] = useActionState(saveNordFjellaStayGuestAction, initialState)
  const [taxStatus, setTaxStatus] = useState<NordFjellaCityTaxStatus>(
    guest?.city_tax_status ?? 'liable'
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success && state.stayGuest) {
      onSaved(state.stayGuest)
    }
  }, [onSaved, state.stayGuest, state.success])

  const content = (
    <div
      className="fixed inset-0 z-[140] overflow-y-auto overscroll-contain bg-zinc-950/48 p-4 backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center py-3">
        <div className="clients-modal__shell flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.9)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.3)]">
          <div className="clients-modal__header flex items-start justify-between gap-4 border-b border-gray-100/90 px-4 py-3 sm:px-5 sm:py-4">
            <div>
              <ModalHeading
                section="NORD FJELLA"
                title={guest ? 'Upravit ubytovanou osobu' : 'Přidat ubytovanou osobu'}
              />
              <p className="clients-modal__subtitle mt-1 text-sm text-gray-500">
                Evidence občana ČR pro pobyt {reservation.reservation_number}.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm text-gray-700"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction}>
            <div className="nord-fjella-modal-body max-h-[calc(100dvh-12rem)] overflow-y-auto px-4 py-4 sm:px-5">
              <input type="hidden" name="reservation_id" value={reservation.id} />
              <input type="hidden" name="stay_guest_id" value={guest?.id ?? ''} />
              <input type="hidden" name="citizenship_code" value="CZ" />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Jméno</label>
                  <input name="first_name" defaultValue={guest?.first_name ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Příjmení</label>
                  <input name="last_name" defaultValue={guest?.last_name ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Datum narození</label>
                  <input name="birth_date" type="date" defaultValue={guest?.birth_date ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Kategorie</label>
                  <select name="guest_category" defaultValue={guest?.guest_category ?? 'adult'} className={selectClassName}>
                    <option value="adult">Dospělý</option>
                    <option value="child">Dítě</option>
                  </select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-900">Ulice a číslo</label>
                  <input name="street" defaultValue={guest?.street ?? reservation.guest_street ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Obec</label>
                  <input name="city" defaultValue={guest?.city ?? reservation.guest_city ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">PSČ</label>
                  <input name="postal_code" defaultValue={guest?.postal_code ?? reservation.guest_postal_code ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Země</label>
                  <input name="country" defaultValue={guest?.country ?? 'Česká republika'} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Občanství</label>
                  <input value="Česká republika" readOnly className={`${inputClassName} bg-zinc-100`} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Druh dokladu</label>
                  <select name="identity_document_type" defaultValue={guest?.identity_document_type ?? 'id_card'} className={selectClassName}>
                    <option value="id_card">Občanský průkaz</option>
                    <option value="passport">Cestovní pas</option>
                    <option value="other">Jiný doklad</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Číslo dokladu</label>
                  <input name="identity_document_number" defaultValue={guest?.identity_document_number ?? ''} required className={inputClassName} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Místní poplatek</label>
                  <select
                    name="city_tax_status"
                    value={taxStatus}
                    onChange={(event) => setTaxStatus(event.target.value as NordFjellaCityTaxStatus)}
                    className={selectClassName}
                  >
                    <option value="liable">Podléhá poplatku</option>
                    <option value="exempt">Osvobozen</option>
                    <option value="not_applicable">Pobyt poplatku nepodléhá</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-900">Sazba / noc</label>
                  <input name="city_tax_rate" defaultValue={guest?.city_tax_rate ?? reservation.city_tax_rate ?? 30} required className={inputClassName} />
                </div>
                {taxStatus === 'exempt' ? (
                  <div className="space-y-2 md:col-span-2">
                    <label className="text-sm font-medium text-gray-900">Důvod osvobození</label>
                    <input
                      name="city_tax_exemption_reason"
                      defaultValue={guest?.city_tax_exemption_reason ?? ''}
                      required
                      placeholder="Např. osoba mladší 18 let"
                      className={inputClassName}
                    />
                  </div>
                ) : null}
                {taxStatus === 'liable' ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-900">Skutečně vybráno</label>
                      <input
                        name="city_tax_collected_amount"
                        defaultValue={guest?.city_tax_collected_amount ?? guest?.city_tax_amount ?? 0}
                        className={inputClassName}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-900">Datum vybrání</label>
                      <input
                        name="city_tax_collected_at"
                        type="date"
                        defaultValue={guest?.city_tax_collected_at ?? ''}
                        className={inputClassName}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-900">Způsob úhrady</label>
                      <select
                        name="city_tax_payment_method"
                        defaultValue={guest?.city_tax_payment_method ?? ''}
                        className={selectClassName}
                      >
                        <option value="">Nevybráno</option>
                        <option value="cash">Hotově</option>
                        <option value="bank_transfer">Bankovní převod</option>
                      </select>
                    </div>
                  </>
                ) : null}
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input name="is_primary" type="checkbox" defaultChecked={guest?.is_primary ?? false} />
                  Hlavní ubytovaný host
                </label>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium text-gray-900">Poznámka</label>
                  <textarea name="note" rows={2} defaultValue={guest?.note ?? ''} className={inputClassName} />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="clients-modal__actions flex justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-5">
              <button type="button" onClick={onClose} className="clients-modal__cancel rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700">
                ZRUŠIT
              </button>
              <button type="submit" className="clients-modal__submit rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#2b679a_100%)] px-4 py-2 text-sm font-medium text-white">
                ULOŽIT OSOBU
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}
