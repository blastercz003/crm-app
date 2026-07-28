'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type {
  NordFjellaGuestRow,
  NordFjellaReservationFileRow,
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaStayGuestRow,
} from '@/lib/nord-fjella/types'
import {
  deleteNordFjellaReservationAction,
  updateNordFjellaReservationAction,
  type UpdateNordFjellaReservationActionState,
} from './actions'
import { updateNordFjellaReservationInitialState } from './action-states'
import { ReservationItemsEditor } from './reservation-items-editor'
import { ReservationFilesPanel } from './reservation-files-panel'
import { StayGuestsPanel } from './stay-guests-panel'
import { PricePreview } from './price-preview'

type ReservationDetailButtonProps = {
  guests: NordFjellaGuestRow[]
  reservation: NordFjellaReservationRow
  reservationItems: NordFjellaReservationItemRow[]
  reservationFiles: NordFjellaReservationFileRow[]
  stayGuests: NordFjellaStayGuestRow[]
  compact?: boolean
}

type GuestType = 'person' | 'company'
type RecordType = 'reservation' | 'owner_block' | 'technical_block'

const inputClassName =
  'clients-modal__input min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const selectClassName =
  'clients-modal__select h-11 min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

function ReservationDetailFooterActions({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus()

  return (
    <div className="contents sm:flex sm:w-full sm:flex-row sm:items-center sm:justify-end sm:gap-3">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="clients-modal__cancel inline-flex items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-2.5 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        ZRUŠIT
      </button>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="clients-modal__submit inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : null}
        {pending ? 'UKLÁDÁM...' : 'ULOŽIT ZMĚNY'}
      </button>
    </div>
  )
}

export function ReservationDetailButton({
  guests,
  reservation,
  reservationItems,
  reservationFiles,
  stayGuests,
  compact = false,
}: ReservationDetailButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] [html[data-theme='dark']_&]:border-slate-400/18 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_22px_rgba(0,0,0,0.22)] ${
          compact ? 'h-8 px-2.5 text-[10px]' : 'h-9 px-4 text-xs'
        }`}
      >
        Detail
      </button>

      {isOpen ? (
        <ReservationDetailModal
          guests={guests}
          reservation={reservation}
          reservationItems={reservationItems}
          reservationFiles={reservationFiles}
          stayGuests={stayGuests}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function ReservationDetailModal({
  guests,
  reservation,
  reservationItems,
  reservationFiles,
  stayGuests,
  onClose,
}: {
  guests: NordFjellaGuestRow[]
  reservation: NordFjellaReservationRow
  reservationItems: NordFjellaReservationItemRow[]
  reservationFiles: NordFjellaReservationFileRow[]
  stayGuests: NordFjellaStayGuestRow[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState<UpdateNordFjellaReservationActionState, FormData>(
    updateNordFjellaReservationAction,
    updateNordFjellaReservationInitialState
  )
  const [recordType, setRecordType] = useState<RecordType>(reservation.record_type)
  const [guestType, setGuestType] = useState<GuestType>(reservation.guest_type ?? 'person')
  const [guestQuery, setGuestQuery] = useState(
    reservation.guest_company_name ?? reservation.guest_full_name ?? ''
  )
  const [selectedGuestId, setSelectedGuestId] = useState(reservation.guest_id ?? '')
  const [guestFullName, setGuestFullName] = useState(reservation.guest_full_name ?? '')
  const [guestCompanyName, setGuestCompanyName] = useState(reservation.guest_company_name ?? '')
  const [guestContactName, setGuestContactName] = useState(reservation.guest_contact_name ?? '')
  const [guestEmail, setGuestEmail] = useState(reservation.guest_email ?? '')
  const [guestPhone, setGuestPhone] = useState(reservation.guest_phone ?? '')
  const [guestStreet, setGuestStreet] = useState(reservation.guest_street ?? '')
  const [guestCity, setGuestCity] = useState(reservation.guest_city ?? '')
  const [guestPostalCode, setGuestPostalCode] = useState(reservation.guest_postal_code ?? '')
  const [guestCountry, setGuestCountry] = useState(reservation.guest_country ?? 'Česká republika')
  const [guestBirthDate, setGuestBirthDate] = useState(reservation.guest_birth_date ?? '')
  const [guestIdentityDocumentNumber, setGuestIdentityDocumentNumber] = useState(
    reservation.guest_identity_document_number ?? ''
  )
  const [guestIco, setGuestIco] = useState(reservation.guest_ico ?? '')
  const [guestDic, setGuestDic] = useState(reservation.guest_dic ?? '')
  const [guestNote, setGuestNote] = useState('')
  const [adultCount, setAdultCount] = useState(String(reservation.adult_count))
  const [childCount, setChildCount] = useState(String(reservation.child_count))
  const [stayStartDate, setStayStartDate] = useState(reservation.stay_start_date)
  const [stayEndDate, setStayEndDate] = useState(reservation.stay_end_date)
  const [accommodationNightRate, setAccommodationNightRate] = useState(
    String(reservation.accommodation_night_rate)
  )
  const [accommodationVatRate, setAccommodationVatRate] = useState(
    String(reservation.accommodation_vat_rate)
  )
  const [cleaningFee, setCleaningFee] = useState(String(reservation.cleaning_fee))
  const [cleaningVatRate, setCleaningVatRate] = useState(
    String(reservation.cleaning_fee_vat_rate)
  )
  const [cityTaxPersonCount, setCityTaxPersonCount] = useState(String(reservation.city_tax_person_count))
  const [hasManualCityTaxPersonCount, setHasManualCityTaxPersonCount] = useState(false)
  const [isGuestMenuOpen, setIsGuestMenuOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeletePending, startDeleteTransition] = useTransition()
  const guestMenuRef = useRef<HTMLDivElement | null>(null)

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!guestMenuRef.current) return
      if (guestMenuRef.current.contains(event.target as Node)) return
      setIsGuestMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  const filteredGuests = useMemo(() => {
    const query = guestQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()

    if (!query) return guests.slice(0, 8)

    return guests
      .filter((guest) => {
        const haystack = [
          guest.full_name,
          guest.company_name,
          guest.contact_name,
          guest.email,
          guest.phone,
          guest.city,
          guest.ico,
          guest.dic,
        ]
          .filter(Boolean)
          .join(' ')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()

        return haystack.includes(query)
      })
      .slice(0, 8)
  }, [guestQuery, guests])

  function applyGuest(guest: NordFjellaGuestRow) {
    setSelectedGuestId(guest.id)
    setGuestType(guest.guest_type)
    setGuestQuery(guest.company_name ?? guest.full_name ?? '')
    setGuestFullName(guest.full_name ?? '')
    setGuestCompanyName(guest.company_name ?? '')
    setGuestContactName(guest.contact_name ?? '')
    setGuestEmail(guest.email)
    setGuestPhone(guest.phone)
    setGuestStreet(guest.street)
    setGuestCity(guest.city)
    setGuestPostalCode(guest.postal_code)
    setGuestCountry(guest.country)
    setGuestBirthDate(guest.birth_date ?? '')
    setGuestIdentityDocumentNumber(guest.identity_document_number ?? '')
    setGuestIco(guest.ico ?? '')
    setGuestDic(guest.dic ?? '')
    setGuestNote(guest.note ?? '')
    setIsGuestMenuOpen(false)
  }

  function clearGuestSelection() {
    setSelectedGuestId('')
  }

  function getSafeGuestCount(value: string) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.max(parsed, 0) : 0
  }

  function handleDeleteReservation() {
    setDeleteError(null)

    startDeleteTransition(async () => {
      const result = await deleteNordFjellaReservationAction(reservation.id)

      if (!result.success) {
        setDeleteError(result.error ?? 'Rezervaci se nepodařilo smazat.')
        return
      }

      setIsDeleteConfirmOpen(false)
      onClose()
    })
  }

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-[calc(100dvh-2rem)] items-start justify-center py-2 sm:min-h-full sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-auto sm:max-h-[calc(100dvh-2rem)]">
          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="clients-modal__title text-lg font-semibold tracking-tight sm:text-xl">
                Detail rezervace
              </h2>
              <p className="clients-modal__subtitle mt-1 text-sm">
                {reservation.reservation_number} • úprava detailů pronájmu nebo blokace.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-medium"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="reservation_id" value={reservation.id} />
            <div className="clients-modal__body nord-fjella-modal-body min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5">
                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">
                    Termín a stav
                  </div>
                  <div className="grid min-w-0 gap-4 md:grid-cols-3">
                    <div className="min-w-0 space-y-2">
                      <label className="text-sm font-medium text-gray-900">Typ záznamu</label>
                      <select
                        name="record_type"
                        value={recordType}
                        onChange={(event) => setRecordType(event.target.value as RecordType)}
                        className={selectClassName}
                      >
                        <option value="reservation">Pronájem</option>
                        <option value="owner_block">Vlastní pobyt</option>
                        <option value="technical_block">Technická blokace</option>
                      </select>
                    </div>

                    <div className="min-w-0 space-y-2">
                      <label className="text-sm font-medium text-gray-900">Datum příjezdu</label>
                      <input
                        name="stay_start_date"
                        type="date"
                        required
                        value={stayStartDate}
                        onChange={(event) => setStayStartDate(event.target.value)}
                        className={inputClassName}
                      />
                    </div>

                    <div className="min-w-0 space-y-2">
                      <label className="text-sm font-medium text-gray-900">Datum odjezdu</label>
                      <input
                        name="stay_end_date"
                        type="date"
                        required
                        value={stayEndDate}
                        onChange={(event) => setStayEndDate(event.target.value)}
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>

                {recordType === 'reservation' ? (
                  <>
                    <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">
                        Host a kontaktní údaje
                      </div>
                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium text-gray-900">Existující host</label>
                          <div ref={guestMenuRef} className="relative">
                            <input
                              type="text"
                              value={guestQuery}
                              onChange={(event) => {
                                clearGuestSelection()
                                setGuestQuery(event.target.value)
                                setIsGuestMenuOpen(true)
                              }}
                              onFocus={() => setIsGuestMenuOpen(true)}
                              placeholder="Hledat podle jména, firmy, e-mailu nebo telefonu"
                              className={inputClassName}
                            />
                            <input type="hidden" name="existing_guest_id" value={selectedGuestId} />
                            {isGuestMenuOpen && filteredGuests.length > 0 ? (
                              <div className="nord-fjella-guest-menu absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border bg-white shadow-[0_18px_40px_rgba(15,23,42,0.14)]">
                                <div className="max-h-64 overflow-y-auto p-2">
                                  {filteredGuests.map((guest) => (
                                    <button
                                      key={guest.id}
                                      type="button"
                                      onClick={() => applyGuest(guest)}
                                      className="nord-fjella-guest-menu-option flex w-full flex-col items-start rounded-xl px-3 py-2 text-left transition"
                                    >
                                      <span className="nord-fjella-guest-menu-option-primary text-sm font-semibold text-gray-900">
                                        {guest.company_name ?? guest.full_name ?? 'Bez názvu'}
                                      </span>
                                      <span className="nord-fjella-guest-menu-option-secondary mt-0.5 text-xs text-gray-500">
                                        {[guest.contact_name, guest.email, guest.phone].filter(Boolean).join(' • ')}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Typ hosta</label>
                          <select
                            name="guest_type"
                            value={guestType}
                            onChange={(event) => setGuestType(event.target.value as GuestType)}
                            className={selectClassName}
                          >
                            <option value="person">Soukromá osoba</option>
                            <option value="company">Firma</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Stav záznamu</label>
                          <select
                            name="reservation_status"
                            defaultValue={reservation.reservation_status ?? 'reserved'}
                            className={selectClassName}
                          >
                            <option value="reserved">Rezervace</option>
                            <option value="completed">Proběhlo</option>
                            <option value="cancelled">Storno</option>
                          </select>
                        </div>
                      </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      {guestType === 'person' ? (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Jméno a příjmení</label>
                          <input
                            name="guest_full_name"
                            value={guestFullName}
                            onChange={(event) => setGuestFullName(event.target.value)}
                            required
                            className={inputClassName}
                          />
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Název firmy</label>
                          <input
                            name="guest_company_name"
                            value={guestCompanyName}
                            onChange={(event) => setGuestCompanyName(event.target.value)}
                            required
                            className={inputClassName}
                          />
                        </div>
                      )}

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Kontaktní osoba</label>
                        <input
                          name="guest_contact_name"
                          value={guestContactName}
                          onChange={(event) => setGuestContactName(event.target.value)}
                          required={guestType === 'company'}
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">E-mail</label>
                        <input
                          name="guest_email"
                          type="email"
                          value={guestEmail}
                          onChange={(event) => setGuestEmail(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Telefon</label>
                        <input
                          name="guest_phone"
                          value={guestPhone}
                          onChange={(event) => setGuestPhone(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Ulice a číslo</label>
                        <input
                          name="guest_street"
                          value={guestStreet}
                          onChange={(event) => setGuestStreet(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>

                      <div className="grid gap-4 md:col-span-2 md:grid-cols-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Město</label>
                          <input
                            name="guest_city"
                            value={guestCity}
                            onChange={(event) => setGuestCity(event.target.value)}
                            required
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">PSČ</label>
                          <input
                            name="guest_postal_code"
                            value={guestPostalCode}
                            onChange={(event) => setGuestPostalCode(event.target.value)}
                            required
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Země</label>
                          <input
                            name="guest_country"
                            value={guestCountry}
                            onChange={(event) => setGuestCountry(event.target.value)}
                            required
                            className={inputClassName}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Datum narození</label>
                        <input
                          name="guest_birth_date"
                          type="date"
                          value={guestBirthDate}
                          onChange={(event) => setGuestBirthDate(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Číslo OP / pasu</label>
                        <input
                          name="guest_identity_document_number"
                          value={guestIdentityDocumentNumber}
                          onChange={(event) => setGuestIdentityDocumentNumber(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">IČO</label>
                        <input
                          name="guest_ico"
                          value={guestIco}
                          onChange={(event) => setGuestIco(event.target.value)}
                          required={guestType === 'company'}
                          className={inputClassName}
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">DIČ</label>
                        <input
                          name="guest_dic"
                          value={guestDic}
                          onChange={(event) => setGuestDic(event.target.value)}
                          required={guestType === 'company'}
                          className={inputClassName}
                        />
                      </div>
                    </div>
                    </div>

                    <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">
                        Cena, platby a vyúčtování
                      </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Počet dospělých</label>
                        <input
                          name="adult_count"
                          type="number"
                          min="0"
                          value={adultCount}
                          onChange={(event) => {
                            const nextAdultCount = event.target.value
                            setAdultCount(nextAdultCount)

                            if (!hasManualCityTaxPersonCount) {
                              setCityTaxPersonCount(
                                String(getSafeGuestCount(nextAdultCount) + getSafeGuestCount(childCount))
                              )
                            }
                          }}
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Počet dětí</label>
                        <input
                          name="child_count"
                          type="number"
                          min="0"
                          value={childCount}
                          onChange={(event) => {
                            const nextChildCount = event.target.value
                            setChildCount(nextChildCount)

                            if (!hasManualCityTaxPersonCount) {
                              setCityTaxPersonCount(
                                String(getSafeGuestCount(adultCount) + getSafeGuestCount(nextChildCount))
                              )
                            }
                          }}
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Cena za noc bez DPH</label>
                        <input
                          name="accommodation_night_rate"
                          value={accommodationNightRate}
                          onChange={(event) => setAccommodationNightRate(event.target.value)}
                          placeholder="Zadej cenu za 1 noc bez DPH"
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">DPH ubytování %</label>
                        <input
                          name="accommodation_vat_rate"
                          value={accommodationVatRate}
                          onChange={(event) => setAccommodationVatRate(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Místní poplatek / osoba / noc
                        </label>
                        <input
                          name="city_tax_rate"
                          defaultValue={reservation.city_tax_rate}
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Počet osob pro poplatek
                        </label>
                        <input
                          name="city_tax_person_count"
                          type="number"
                          min="0"
                          value={cityTaxPersonCount}
                          onChange={(event) => {
                            setHasManualCityTaxPersonCount(true)
                            setCityTaxPersonCount(event.target.value)
                          }}
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Úklid bez DPH</label>
                        <input
                          name="cleaning_fee"
                          value={cleaningFee}
                          onChange={(event) => setCleaningFee(event.target.value)}
                          placeholder="Zadej cenu úklidu bez DPH"
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">DPH úklidu %</label>
                        <input
                          name="cleaning_fee_vat_rate"
                          value={cleaningVatRate}
                          onChange={(event) => setCleaningVatRate(event.target.value)}
                          required
                          className={inputClassName}
                        />
                      </div>
                    </div>

                    <PricePreview
                      stayStartDate={stayStartDate}
                      stayEndDate={stayEndDate}
                      accommodationNightRate={accommodationNightRate}
                      accommodationVatRate={accommodationVatRate}
                      cleaningFee={cleaningFee}
                      cleaningVatRate={cleaningVatRate}
                    />

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Kauce mimo tržby</label>
                        <input
                          name="security_deposit_amount"
                          defaultValue={reservation.security_deposit_amount}
                          required
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Požadovaná záloha</label>
                        <input
                          name="requested_deposit_amount"
                          defaultValue={reservation.requested_deposit_amount ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Splatnost zálohy</label>
                        <input
                          name="deposit_due_date"
                          type="date"
                          defaultValue={reservation.deposit_due_date ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Platební stav</label>
                        <select
                          name="payment_status"
                          defaultValue={reservation.payment_status ?? 'unpaid'}
                          className={selectClassName}
                        >
                          <option value="unpaid">Nezaplaceno</option>
                          <option value="deposit_paid">Záloha uhrazena</option>
                          <option value="partially_paid">Částečně zaplaceno</option>
                          <option value="paid">Zaplaceno</option>
                          <option value="refund_or_overpayment">Vratka / přeplatek</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Uhrazená záloha</label>
                        <input
                          name="deposit_paid_amount"
                          defaultValue={reservation.deposit_paid_amount ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Datum úhrady zálohy</label>
                        <input
                          name="deposit_paid_at"
                          type="date"
                          defaultValue={reservation.deposit_paid_at ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Forma úhrady zálohy
                        </label>
                        <select
                          name="deposit_payment_method"
                          defaultValue={reservation.deposit_payment_method ?? ''}
                          className={selectClassName}
                        >
                          <option value="">Nevybráno</option>
                          <option value="bank_transfer">Bankovní převod</option>
                          <option value="cash">Hotově</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Vyúčtování</label>
                        <select
                          name="settlement_status"
                          defaultValue={reservation.settlement_status}
                          className={selectClassName}
                        >
                          <option value="draft">Nepřipraveno</option>
                          <option value="in_progress">Rozpracováno</option>
                          <option value="closed">Uzavřeno</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Uhrazený doplatek</label>
                        <input
                          name="balance_paid_amount"
                          defaultValue={reservation.balance_paid_amount ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Datum úhrady doplatku
                        </label>
                        <input
                          name="balance_paid_at"
                          type="date"
                          defaultValue={reservation.balance_paid_at ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Forma úhrady doplatku
                        </label>
                        <select
                          name="balance_payment_method"
                          defaultValue={reservation.balance_payment_method ?? ''}
                          className={selectClassName}
                        >
                          <option value="">Nevybráno</option>
                          <option value="bank_transfer">Bankovní převod</option>
                          <option value="cash">Hotově</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Splatnost doplatku</label>
                        <input
                          name="balance_due_date"
                          type="date"
                          defaultValue={reservation.balance_due_date ?? ''}
                          className={inputClassName}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Storno poplatek bez DPH</label>
                        <input
                          name="cancellation_fee_amount"
                          defaultValue={reservation.cancellation_fee_amount ?? ''}
                          placeholder="Zadej částku bez DPH"
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">DPH storno poplatku %</label>
                        <input
                          name="cancellation_fee_vat_rate"
                          defaultValue={reservation.cancellation_fee_vat_rate ?? 12}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">DUZP</label>
                        <input
                          name="taxable_supply_date"
                          type="date"
                          defaultValue={reservation.taxable_supply_date ?? reservation.stay_end_date}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Číslo externího dokladu</label>
                        <input
                          name="external_document_number"
                          defaultValue={reservation.external_document_number ?? ''}
                          placeholder="Volitelné"
                          className={inputClassName}
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Vrácená platba</label>
                        <input
                          name="payment_refund_amount"
                          defaultValue={reservation.payment_refund_amount ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Datum vrácení platby</label>
                        <input
                          name="payment_refund_at"
                          type="date"
                          defaultValue={reservation.payment_refund_at ?? ''}
                          className={inputClassName}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Forma vrácení</label>
                        <select
                          name="payment_refund_method"
                          defaultValue={reservation.payment_refund_method ?? ''}
                          className={selectClassName}
                        >
                          <option value="">Nevybráno</option>
                          <option value="bank_transfer">Bankovní převod</option>
                          <option value="cash">Hotově</option>
                        </select>
                      </div>
                    </div>
                    </div>

                    <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">Kauce</div>
                      <div className="grid gap-4 md:grid-cols-4">
                        <label className="nord-fjella-modal-subtle-card flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-gray-900">
                          <input
                            type="checkbox"
                            name="security_deposit_received"
                            defaultChecked={reservation.security_deposit_received}
                            className="h-4 w-4"
                          />
                          Kauce přijata
                        </label>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Datum přijetí</label>
                          <input
                            name="security_deposit_received_at"
                            type="date"
                            defaultValue={reservation.security_deposit_received_at ?? ''}
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Vrácená kauce</label>
                          <input
                            name="security_deposit_refund_amount"
                            defaultValue={reservation.security_deposit_refund_amount ?? ''}
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Datum vrácení</label>
                          <input
                            name="security_deposit_refunded_at"
                            type="date"
                            defaultValue={reservation.security_deposit_refunded_at ?? ''}
                            className={inputClassName}
                          />
                        </div>
                      </div>
                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">
                            Zadržená část kauce
                          </label>
                          <input
                            name="security_deposit_withheld_amount"
                            defaultValue={reservation.security_deposit_withheld_amount ?? ''}
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Datum zadržení</label>
                          <input
                            name="security_deposit_withheld_at"
                            type="date"
                            defaultValue={reservation.security_deposit_withheld_at ?? ''}
                            className={inputClassName}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-gray-900">Důvod zadržení</label>
                          <input
                            name="security_deposit_withheld_reason"
                            defaultValue={reservation.security_deposit_withheld_reason ?? ''}
                            className={inputClassName}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">
                        Poznámky
                      </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Interní poznámka</label>
                        <textarea
                          name="internal_note"
                          rows={4}
                          defaultValue={reservation.internal_note ?? ''}
                          className={`${inputClassName} min-h-[120px] py-3`}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">
                          Veřejná poznámka do PDF
                        </label>
                        <textarea
                          name="public_note"
                          rows={4}
                          defaultValue={reservation.public_note ?? ''}
                          className={`${inputClassName} min-h-[120px] py-3`}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-900">Poznámka k hostovi</label>
                      <textarea
                        name="guest_note"
                        rows={3}
                        value={guestNote}
                        onChange={(event) => setGuestNote(event.target.value)}
                        className={`${inputClassName} min-h-[100px] py-3`}
                      />
                    </div>
                    </div>

                    {recordType === 'reservation' ? (
                      <StayGuestsPanel reservation={reservation} initialGuests={stayGuests} />
                    ) : null}

                    <ReservationItemsEditor defaultItems={reservationItems} />
                    <ReservationFilesPanel
                      reservationId={reservation.id}
                      initialFiles={reservationFiles}
                    />
                  </>
                ) : (
                  <div className="nord-fjella-modal-subtle-card p-4">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-900">Vyúčtování</label>
                        <select
                          name="settlement_status"
                          defaultValue={reservation.settlement_status}
                          className={selectClassName}
                        >
                          <option value="draft">Nepřipraveno</option>
                          <option value="in_progress">Rozpracováno</option>
                          <option value="closed">Uzavřeno</option>
                        </select>
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <label className="text-sm font-medium text-gray-900">Interní poznámka</label>
                        <input
                          name="internal_note"
                          defaultValue={reservation.internal_note ?? ''}
                          className={inputClassName}
                          placeholder="Např. servis, rodinný pobyt, odstávka objektu"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {state.error ? (
                  <div className="nord-fjella-modal-error rounded-2xl px-4 py-3 text-sm">
                    {state.error}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="clients-modal__footer shrink-0 border-t border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid w-full grid-cols-[0.8fr_0.8fr_1.4fr] gap-2 sm:flex sm:items-center sm:justify-between sm:gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteError(null)
                    setIsDeleteConfirmOpen(true)
                  }}
                  className="inline-flex items-center justify-center rounded-2xl border border-red-300/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-2.5 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)] [html[data-theme='dark']_&]:border-red-400/20 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(62,19,27,0.82)_0%,rgba(50,14,24,0.88)_100%)] [html[data-theme='dark']_&]:text-red-200 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_22px_rgba(0,0,0,0.24)]"
                >
                  SMAZAT
                </button>

                <ReservationDetailFooterActions onCancel={onClose} />
              </div>
            </div>
          </form>

          {isDeleteConfirmOpen ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/36 p-4 backdrop-blur-[4px]">
              <div className="clients-modal__shell w-full max-w-md rounded-[28px] border border-red-200/80 bg-[linear-gradient(168deg,rgba(255,255,255,0.95)_0%,rgba(254,242,242,0.92)_56%,rgba(255,228,230,0.88)_100%)] p-5 shadow-[0_28px_64px_rgba(127,29,29,0.22)] [html[data-theme='dark']_&]:border-red-400/18 [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(15,23,42,0.98)_0%,rgba(20,20,32,0.96)_52%,rgba(38,18,24,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[0_28px_64px_rgba(0,0,0,0.42)]">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-600 [html[data-theme='dark']_&]:text-red-300">
                    Potvrzení smazání
                  </p>
                  <h3 className="text-xl font-semibold text-zinc-950 [html[data-theme='dark']_&]:text-slate-50">
                    Smazat rezervaci?
                  </h3>
                  <p className="text-sm leading-6 text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                    Trvale se smaže záznam {reservation.reservation_number}, jeho doplňkové položky i
                    nahrané doklady hosta. Záznam hosta v databázi zůstane zachovaný.
                  </p>
                </div>

                {deleteError ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 [html[data-theme='dark']_&]:border-red-400/20 [html[data-theme='dark']_&]:bg-red-500/10 [html[data-theme='dark']_&]:text-red-200">
                    {deleteError}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (isDeletePending) return
                      setIsDeleteConfirmOpen(false)
                      setDeleteError(null)
                    }}
                    disabled={isDeletePending}
                    className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(39,39,42,0.08)] [html[data-theme='dark']_&]:border-slate-400/18 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_22px_rgba(0,0,0,0.22)] disabled:opacity-60"
                  >
                    ZRUŠIT
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteReservation}
                    disabled={isDeletePending}
                    className="inline-flex items-center justify-center rounded-2xl border border-red-300/90 bg-[linear-gradient(155deg,rgba(239,68,68,0.92)_0%,rgba(220,38,38,0.92)_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_28px_rgba(185,28,28,0.24)] disabled:opacity-60"
                  >
                    {isDeletePending ? 'MAŽU REZERVACI...' : 'SMAZAT REZERVACI'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(modalContent, document.body)
}
