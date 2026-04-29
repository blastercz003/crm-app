import Link from 'next/link'
import {
  addOfferItem,
  approveOffer,
  deleteOffer,
  deleteOfferItem,
  moveOfferItem,
  rejectOffer,
  setOfferClientOutcome,
  setOfferPresetChoice,
  submitOfferForApproval,
  toggleOfferPresetItem,
  updateOfferDetails,
  updateOfferItem,
} from '@/app/offers/actions'
import {
  BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL,
  BSAFE24_BACKUP_LOCATION_COUNT_PRESETS,
  BSAFE24_BACKUP_LOCATION_GROUP_LABEL,
  BSAFE24_BACKUP_LOCATION_PRESETS,
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_DEPOT_PRESETS,
  OFFER_DEPOT_SELECTION_LIMIT,
  OFFER_ITEM_SECTION_NOTE_GROUP_LABEL,
  OFFER_SERVICE_PRESET_ALIASES,
  OFFER_SERVICE_GROUP_LABEL,
  OFFER_SERVICE_PRESETS,
} from '@/lib/offers/presets'
import {
  formatCurrency,
  formatNumber,
  getOfferItemNetTotal,
  getOfferTotals,
} from '@/lib/offers/calculations'
import type {
  OfferClient,
  OfferItemRow,
  OfferProfile,
  OfferRow,
  OfferServiceItemRow,
  OfferStatus,
  OfferType,
} from '@/lib/offers/types'
import { DepotToggleButton } from './depot-toggle-button'
import { DieselPriceBadge } from './diesel-price-badge'
import { GuardedOfferLink } from './guarded-offer-link'
import { OfferItemsEditor } from './offer-items-modal'
import { OfferServicesModal } from './offer-services-modal'
import { OfferUnsavedChangesGuard } from './offer-unsaved-changes-guard'
import { SubmitOfferApprovalButton } from './submit-offer-approval-button'

type OfferDetailPageProps = {
  params: Promise<{ id: string }>
}

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Rozpracovaná',
  submitted: 'Ke schválení',
  changes_requested: 'Vrácená k úpravě',
  approved: 'Schválená',
  ordered: 'Objednáno',
  rejected: 'Zamítnuto',
}

const STATUS_BADGE_WIDTH_CLASS = 'w-[150px]'

const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  classic: 'KLASICKÁ',
  bsafe24: 'B-SAFE 24',
}

function formatDate(value: string | null) {
  if (!value) return 'Bez data'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez data'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDateTimeInput(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function getStatusClass(status: OfferStatus) {
  if (status === 'ordered') return 'bg-green-600 text-white'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'submitted') return 'bg-[#2980B9]/10 text-[#236f9f]'
  if (status === 'changes_requested') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-600'
}

function inputClassName() {
  return 'h-9 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200'
}

function textareaClassName() {
  return 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200'
}

function offerItemLabelClassName() {
  return 'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500'
}

function canShowResubmitNotice(offer: OfferRow) {
  return (
    offer.status === 'submitted' &&
    offer.submitted_version !== null &&
    offer.current_version > offer.submitted_version
  )
}

const CLASSIC_DEFAULT_TERMS_NOTE =
  'Nedílnou součástí nabídky jsou všeobecné obchodní podmínky pronájmu (VOPP).\nPro rezervaci termínu relizace je třeba zaslat písemnou objednávku.\n\n* Spotřeba pohonných hmot se vyúčtuje na základě skutečné spotřeby.\n** Platbu za PHM a služby je nutno uhradit min. 3 dny před započetím realizace (peníze na účtu Blaster Services s.r.o.)'

const BSAFE24_DEFAULT_TERMS_NOTE =
  'Nedílnou součástí nabídky jsou všeobecné obchodní podmínky pronájmu (VOPP).\n\n* Spotřeba pohonných hmot se vyúčtuje na základě skutečné spotřeby.\n** Platbu za PHM a služby je nutno uhradit min. 3 dny před započetím realizace (peníze na účtu Blaster Services s.r.o.)'

const BSAFE24_SERVICE_ITEM_PRESETS = [
  {
    key: 'bsafe24-generator-reservation',
    description: 'REZERVACE DA (doplň výkon)',
    specification: 'DOJEZD DO X hodin OD ZAVOLÁNÍ',
    unitPrice: 0,
    unit: 'ks',
  },
]

const BSAFE24_TRIP_ITEM_PRESETS = [
  { key: 'bsafe24-trip-generator-rental', description: 'Pronájem DA', specification: '', unitPrice: 0, unit: 'den' },
  { key: 'bsafe24-trip-cable-chbu-20m', description: 'Kabeláž CHBU 20m', specification: '', unitPrice: 1500, unit: 'den' },
  { key: 'bsafe24-trip-cable-viacom-twin', description: 'Kabeláž viaCOM TWIN', specification: '', unitPrice: 500, unit: 'den' },
  { key: 'bsafe24-trip-transport-under-35t', description: 'Doprava do 3,5t', specification: '', unitPrice: 24, unit: 'km' },
  { key: 'bsafe24-trip-install-deinstall', description: 'Instalace / Deinstalace', specification: '', unitPrice: 890, unit: 'hod' },
  { key: 'bsafe24-trip-operator', description: 'Odborná obsluha', specification: '', unitPrice: 690, unit: 'hod' },
  { key: 'bsafe24-trip-fuel-energy', description: 'Spotřebované PHM / Výroba EE *', specification: '', unitPrice: 40, unit: 'litr' },
]

const CLASSIC_GENERATOR_ITEM_PRESETS = [
  { key: 'classic-da-40-kva', description: 'Nájem DA 40kVA', specification: '', unitPrice: 3490, unit: 'den' },
  { key: 'classic-da-80-kva', description: 'Nájem DA 80kVA', specification: '', unitPrice: 3990, unit: 'den' },
  { key: 'classic-da-110-kva', description: 'Nájem DA 110kVA', specification: '', unitPrice: 4990, unit: 'den' },
  { key: 'classic-da-150-kva', description: 'Nájem DA 150kVA', specification: '', unitPrice: 5990, unit: 'den' },
  { key: 'classic-da-250-kva', description: 'Nájem DA 250kVA', specification: '', unitPrice: 7990, unit: 'den' },
  { key: 'classic-da-500-kva', description: 'Nájem DA 500kVA', specification: '', unitPrice: 15990, unit: 'den' },
  { key: 'classic-da-750-kva', description: 'Nájem DA 750kVA', specification: '', unitPrice: 23990, unit: 'den' },
  { key: 'classic-da-1000-kva', description: 'Nájem DA 1000kVA', specification: '', unitPrice: 32990, unit: 'den' },
]

const CLASSIC_ACCESSORY_ITEM_PRESETS = [
  { key: 'classic-accessory-chbu-cable-20m', description: 'Připojovací kabel CHBU 20m', specification: '', unitPrice: 1500, unit: 'den', discountPercent: 50 },
  { key: 'classic-accessory-chbu-cable-40m', description: 'Připojovací kabel CHBU 40m', specification: '', unitPrice: 3000, unit: 'den', discountPercent: 50 },
  { key: 'classic-accessory-viacom-twin', description: 'Kabeláž viaCOM TWIN', specification: '', unitPrice: 500, unit: 'den' },
  { key: 'classic-accessory-cable-230v-20m', description: 'Kabel 230V 20m', specification: '', unitPrice: 50, unit: 'den' },
  { key: 'classic-accessory-cable-32a-20m', description: 'Kabel 32A 20m', specification: '', unitPrice: 300, unit: 'den' },
  { key: 'classic-accessory-cable-63a-20m', description: 'Kabel 63A 20m', specification: '', unitPrice: 450, unit: 'den' },
  { key: 'classic-accessory-cable-125a-20m', description: 'Kabel 125A 20m', specification: '', unitPrice: 600, unit: 'den' },
  { key: 'classic-accessory-distribution-32a', description: 'Rozvaděč 32A', specification: '', unitPrice: 800, unit: 'den' },
  { key: 'classic-accessory-distribution-63a', description: 'Rozvaděč 63A', specification: '', unitPrice: 1000, unit: 'den' },
  { key: 'classic-accessory-distribution-125a', description: 'Rozvaděč 125A', specification: '', unitPrice: 1250, unit: 'den' },
  { key: 'classic-accessory-connection-box-pro', description: 'Propojovací krabice PRO', specification: '', unitPrice: 500, unit: 'den' },
  { key: 'classic-accessory-cable-bridge-07m', description: 'Kabelový přejezd 0.7m', specification: '', unitPrice: 190, unit: 'den' },
  { key: 'classic-accessory-fuel-tank-200l', description: 'Externí tankovací nádrž 200l', specification: '', unitPrice: 500, unit: 'den' },
  { key: 'classic-accessory-fuel-tank-1000l', description: 'Externí tankovací nádrž 1000l', specification: '', unitPrice: 1000, unit: 'den' },
]

const CLASSIC_SERVICE_ITEM_PRESETS = [
  { key: 'classic-transport-under-35t', description: 'Doprava do 3,5t', specification: '', unitPrice: 24, unit: 'km' },
  { key: 'classic-install-deinstall', description: 'Instalace / Deinstalace', specification: '', unitPrice: 890, unit: 'hod' },
  { key: 'classic-operator', description: 'Odborná obsluha', specification: '', unitPrice: 690, unit: 'hod' },
  { key: 'classic-fuel-energy', description: 'Spotřebované PHM / Výroba EE *', specification: '', unitPrice: 40, unit: 'litr' },
  { key: 'classic-fuel-management', description: 'Palivové hospodářství', specification: '', unitPrice: 0, unit: 'úkon' },
  { key: 'classic-standby-24-7', description: 'POHOTOVOST 24/7', specification: '', unitPrice: 7500, unit: 'ks' },
]

function isOfferWaitingForApproval(offer: OfferRow) {
  return (
    offer.status === 'submitted' &&
    offer.submitted_version !== null &&
    offer.current_version === offer.submitted_version
  )
}

function offerPresetButtonClassName(isActive: boolean, isDisabled = false) {
  return [
    'inline-flex h-8 w-full items-center justify-center rounded-xl border px-1.5 text-center text-[10px] uppercase tracking-[0.02em] transition sm:w-[150px] sm:px-2 sm:text-[11px] sm:tracking-[0.04em]',
    isActive
      ? 'border-[#2980B9] bg-[#2980B9] font-semibold text-white shadow-sm hover:bg-[#236f9f]'
      : isDisabled
        ? 'cursor-not-allowed border-gray-200 bg-gray-100 font-normal text-gray-400 opacity-60'
      : 'border-gray-200 bg-gray-100 font-normal text-gray-900 hover:border-gray-300 hover:bg-gray-200',
  ].join(' ')
}

function compactOfferPresetButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-10 w-full items-center justify-center rounded-xl border px-2 text-center text-sm uppercase transition',
    isActive
      ? 'border-[#2980B9] bg-[#2980B9] font-semibold text-white shadow-sm hover:bg-[#236f9f]'
      : 'border-gray-200 bg-gray-100 font-normal text-gray-900 hover:border-gray-300 hover:bg-gray-200',
  ].join(' ')
}

function locationCountButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-10 w-full items-center justify-center rounded-xl border px-1 text-center text-xs uppercase transition',
    isActive
      ? 'border-[#2980B9] bg-[#2980B9] font-semibold text-white shadow-sm hover:bg-[#236f9f]'
      : 'border-gray-200 bg-gray-100 font-normal text-gray-900 hover:border-gray-300 hover:bg-gray-200',
  ].join(' ')
}

export type OfferDetailLayoutProps = {
  offer: OfferRow
  client: OfferClient
  items: OfferItemRow[]
  serviceItems: OfferServiceItemRow[]
  profiles: OfferProfile[]
  profile: OfferProfile
  isAdmin: boolean
  saved?: boolean
}

export function OfferDetailLayout({
  offer,
  client,
  items,
  serviceItems,
  profiles,
  profile,
  isAdmin,
  saved = false,
}: OfferDetailLayoutProps) {
  const selectedServices = new Set(
    serviceItems
      .filter((item) => item.specification === OFFER_SERVICE_GROUP_LABEL)
      .map((item) => OFFER_SERVICE_PRESET_ALIASES[item.service_name] ?? item.service_name)
  )

  const selectedDepots = new Set(
    serviceItems
      .filter((item) => item.specification === OFFER_DEPOT_GROUP_LABEL)
      .map((item) => item.service_name)
  )
  const selectedBackupLocation =
    serviceItems.find((item) => item.specification === BSAFE24_BACKUP_LOCATION_GROUP_LABEL)
      ?.service_name ?? 'NE'
  const selectedBackupLocationCount =
    serviceItems.find((item) => item.specification === BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL)
      ?.service_name ?? '1'
  const sectionNoteBySection = new Map(
    serviceItems
      .filter((item) => item.specification === OFFER_ITEM_SECTION_NOTE_GROUP_LABEL)
      .map((item) => [item.service_name, item.operation ?? ''])
  )
  const profileById = new Map(profiles.map((item) => [item.id, item]))
  const author = profileById.get(offer.created_by)
  const lastEditor = offer.last_edited_by ? profileById.get(offer.last_edited_by) : null
  const totals = getOfferTotals(items)
  const staleSubmitted = canShowResubmitNotice(offer)
  const waitingForApproval = isOfferWaitingForApproval(offer)
  const classicGeneratorItems = items.filter(
    (item) => item.item_section === 'classic_generators' || item.item_section === 'main'
  )
  const classicAccessoryItems = items.filter((item) => item.item_section === 'classic_accessories')
  const classicServiceItems = items.filter((item) => item.item_section === 'classic_services')
  const bsafeServiceItems = items.filter(
    (item) => item.item_section === 'bsafe_service' || item.item_section === 'main'
  )
  const bsafeRealizationItems = items.filter((item) => item.item_section === 'bsafe_realization')
  const bsafePlannedTripItems = items.filter((item) => item.item_section === 'bsafe_planned_trip')

  const renderOfferItemsSection = (
    title: string,
    sectionItems: OfferItemRow[],
    itemSection: string,
    showDiscount = false
  ) => (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">
            {title}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Položky přidávej přímo v řádku, součet se zobrazí u uložených položek.
          </p>
        </div>
      </div>

      <form
        action={addOfferItem.bind(null, offer.id)}
        className="grid min-w-0 gap-3 rounded-2xl border border-dashed border-[#2980B9]/40 bg-[#2980B9]/5 p-4"
      >
        <input type="hidden" name="item_section" value={itemSection} />
        <div
          className="grid max-w-full gap-2 overflow-hidden"
          style={{
            gridTemplateColumns:
              'minmax(130px,1.05fr) minmax(160px,1.2fr) 104px 72px 84px 78px 116px 112px',
            alignItems: 'end',
          }}
        >
          <div className="min-w-0">
            <label htmlFor={`new-description-${itemSection}`} className={offerItemLabelClassName()}>
              Položka
            </label>
            <input id={`new-description-${itemSection}`} name="description" required className={inputClassName()} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`new-specification-${itemSection}`} className={offerItemLabelClassName()}>
              Specifikace / popis
            </label>
            <input id={`new-specification-${itemSection}`} name="specification" className={inputClassName()} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`new-price-${itemSection}`} className={offerItemLabelClassName()}>
              Jedn. cena
            </label>
            <input id={`new-price-${itemSection}`} name="unit_price_without_vat" className={inputClassName()} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`new-unit-${itemSection}`} className={offerItemLabelClassName()}>
              Jedn.
            </label>
            <input id={`new-unit-${itemSection}`} name="unit" defaultValue="ks" className={inputClassName()} />
          </div>
          <div className="min-w-0">
            <label htmlFor={`new-quantity-${itemSection}`} className={offerItemLabelClassName()}>
              Množství
            </label>
            <input id={`new-quantity-${itemSection}`} name="quantity" defaultValue="1" className={inputClassName()} />
          </div>
          {showDiscount ? (
            <div className="min-w-0">
              <label htmlFor={`new-discount-${itemSection}`} className={offerItemLabelClassName()}>
                Sleva %
              </label>
              <input id={`new-discount-${itemSection}`} name="discount_percent" defaultValue="0" className={inputClassName()} />
            </div>
          ) : (
            <>
              <input name="discount_percent" type="hidden" value="0" />
              <div className="hidden xl:block" aria-hidden="true" />
            </>
          )}
          <div className="min-w-0">
            <div className={offerItemLabelClassName()}>
              Cena bez DPH
            </div>
            <div className="flex h-9 items-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-400">
              -
            </div>
          </div>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-xs font-medium text-white transition hover:bg-[#236f9f]"
          >
            PŘIDAT
          </button>
        </div>
      </form>

      {sectionItems.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
          Tato kalkulace zatím nemá žádné položky.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {sectionItems.map((item, index) => (
            <form
              key={item.id}
              action={updateOfferItem.bind(null, item.id)}
              className="grid min-w-0 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)]"
            >
              <input type="hidden" name="offer_id" value={offer.id} />
              {!showDiscount ? (
                <input type="hidden" name="discount_percent" value="0" />
              ) : null}
              <div
                className="grid max-w-full gap-2 overflow-hidden"
                style={{
                  gridTemplateColumns:
                    'minmax(130px,1.05fr) minmax(160px,1.2fr) 104px 72px 84px 78px 116px 40px 40px 68px 68px',
                  alignItems: 'center',
                }}
              >
                <div className="min-w-0">
                  <input id={`description-${item.id}`} name="description" defaultValue={item.description} required className={inputClassName()} />
                </div>
                <div className="min-w-0">
                  <input id={`specification-${item.id}`} name="specification" defaultValue={item.specification ?? ''} className={inputClassName()} />
                </div>
                <div className="min-w-0">
                  <input id={`price-${item.id}`} name="unit_price_without_vat" defaultValue={formatNumber(item.unit_price_without_vat)} className={inputClassName()} />
                </div>
                <div className="min-w-0">
                  <input id={`unit-${item.id}`} name="unit" defaultValue={item.unit} className={inputClassName()} />
                </div>
                <div className="min-w-0">
                  <input id={`quantity-${item.id}`} name="quantity" defaultValue={formatNumber(item.quantity)} className={inputClassName()} />
                </div>
                {showDiscount ? (
                  <div className="min-w-0">
                    <input id={`discount-${item.id}`} name="discount_percent" defaultValue={formatNumber(item.discount_percent)} className={inputClassName()} />
                  </div>
                ) : (
                  <div className="hidden xl:block" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div className="flex h-9 min-w-0 items-center truncate rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-900">
                    {formatCurrency(getOfferItemNetTotal(item), offer.currency)}
                  </div>
                </div>
                <button
                  formAction={moveOfferItem.bind(null, item.id, 'up')}
                  disabled={index === 0}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 md:col-span-1"
                  title="Posunout nahoru"
                >
                  ↑
                </button>
                <button
                  formAction={moveOfferItem.bind(null, item.id, 'down')}
                  disabled={index === sectionItems.length - 1}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 md:col-span-1"
                  title="Posunout dolů"
                >
                  ↓
                </button>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-xl bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 md:col-span-2 xl:col-span-1"
                >
                  ULOŽIT
                </button>
                <button
                  formAction={deleteOfferItem.bind(null, item.id)}
                  className="inline-flex h-9 items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-700 transition hover:bg-red-100 md:col-span-2 xl:col-span-1"
                >
                  SMAZAT
                </button>
              </div>
            </form>
          ))}
        </div>
      )}
    </section>
  )


  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="min-w-0 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                  {offer.offer_number}
                </h1>
                <span className={`inline-flex h-8 ${STATUS_BADGE_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition ${getStatusClass(offer.status)}`}>
                  {STATUS_LABELS[offer.status]}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-900">{offer.title}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-900">
                <span>Klient: {client.name}</span>
                <span>Autor: {author?.name ?? 'Neznámý uživatel'}</span>
                <span>Verze: {offer.current_version}</span>
                {lastEditor ? <span>Poslední úprava: {lastEditor.name}</span> : null}
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              <GuardedOfferLink
                href="/offers"
                message="Nejprve si prosím ulož práci tlačítkem ULOŽIT NABÍDKU."
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ZPĚT NA NABÍDKY
              </GuardedOfferLink>
            </div>
          </div>
        </section>

        <OfferUnsavedChangesGuard
          formId="offer-details-form"
          message="Nejprve si prosím ulož práci tlačítkem ULOŽIT NABÍDKU."
        />

        {saved ? (
          <section className="rounded-[30px] border border-emerald-200 bg-emerald-50 px-5 py-4 text-center text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800 shadow-sm">
            Nabídka byla uložena.
          </section>
        ) : null}

        {staleSubmitted ? (
          <section className="rounded-[30px] border border-[#2980B9] bg-[#2980B9] px-5 py-4 text-center text-sm font-medium uppercase tracking-[0.08em] text-white shadow-sm">
            Nabídka byla upravena po odeslání ke schválení.{' '}
            <span className="font-bold">
              Odešli ji znovu, aby admin schvaloval aktuální verzi.
            </span>
          </section>
        ) : null}

        {offer.rejection_comment ? (
          <section className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Komentář ke vrácení
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
              {offer.rejection_comment}
            </p>
          </section>
        ) : null}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-stretch">
          <section className="flex min-w-0 flex-col rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                ZÁKLAD NABÍDKY
              </h2>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <DieselPriceBadge />
                <span className="inline-flex h-8 w-[150px] max-w-full items-center justify-center rounded-xl border border-black bg-white px-3 text-sm font-bold uppercase text-black transition">
                  {OFFER_TYPE_LABELS[offer.offer_type]}
                </span>
              </div>
            </div>

            <form
              id="offer-details-form"
              action={updateOfferDetails.bind(null, offer.id)}
              className="flex flex-1 flex-col gap-4"
            >
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Nabídka a termín
                </div>
                <div
                  className={
                    offer.offer_type === 'bsafe24'
                      ? 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3'
                      : 'grid gap-3 xl:grid-cols-[minmax(260px,1fr)_220px_220px]'
                  }
                >
                  <div>
                    <label htmlFor="title" className="mb-2 block text-sm font-medium text-gray-700">
                      Název nabídky
                    </label>
                    <input id="title" name="title" defaultValue={offer.title} required className={inputClassName()} />
                  </div>

                  {offer.offer_type === 'bsafe24' ? (
                    <div>
                      <label htmlFor="project_name" className="mb-2 block text-sm font-medium text-gray-700">
                        <span className="sm:hidden">Aktivace od</span>
                        <span className="hidden sm:inline">Aktivace produktu od</span>
                      </label>
                      <input id="project_name" name="project_name" defaultValue={offer.project_name ?? ''} className={inputClassName()} />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label htmlFor="realization_starts_at" className="mb-2 block text-sm font-medium text-gray-700">
                          Termín realizace od
                        </label>
                        <input id="realization_starts_at" name="realization_starts_at" type="datetime-local" defaultValue={formatDateTimeInput(offer.realization_starts_at)} className={inputClassName()} />
                      </div>
                      <div>
                        <label htmlFor="realization_ends_at" className="mb-2 block text-sm font-medium text-gray-700">
                          Termín realizace do
                        </label>
                        <input id="realization_ends_at" name="realization_ends_at" type="datetime-local" defaultValue={formatDateTimeInput(offer.realization_ends_at)} className={inputClassName()} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Realizace a kontakt
                </div>
                <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
              <div>
                <label htmlFor="realization_address" className="mb-2 block text-sm font-medium text-gray-700">
                  Adresa realizace
                </label>
                <input id="realization_address" name="realization_address" defaultValue={offer.realization_address ?? ''} className={inputClassName()} />
              </div>

              <div>
                <label htmlFor="contact_person" className="mb-2 block text-sm font-medium text-gray-700">
                  Kontaktní osoba
                </label>
                <input id="contact_person" name="contact_person" defaultValue={offer.contact_person ?? client.contact_person ?? ''} className={inputClassName()} />
              </div>
                </div>
              </div>

              {offer.offer_type === 'bsafe24' ? null : (
                <input type="hidden" name="project_name" value={offer.project_name ?? ''} />
              )}
              <input type="hidden" name="valid_until" value={offer.valid_until ?? ''} />
              <input type="hidden" name="intro_note" value={offer.intro_note ?? ''} />

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Zpracovatel
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="md:col-span-1">
                    <label htmlFor="prepared_by_name" className="mb-2 block text-sm font-medium text-gray-700">
                      Nabídku zpracoval
                    </label>
                    <input id="prepared_by_name" name="prepared_by_name" defaultValue={offer.prepared_by_name ?? author?.name ?? ''} className={inputClassName()} />
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 md:col-span-2 md:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="prepared_by_phone" className="mb-2 block text-sm font-medium text-gray-700">
                        Mobil
                      </label>
                      <input id="prepared_by_phone" name="prepared_by_phone" defaultValue={offer.prepared_by_phone ?? ''} className={inputClassName()} />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="prepared_by_email" className="mb-2 block text-sm font-medium text-gray-700">
                        E-mail
                      </label>
                      <input id="prepared_by_email" name="prepared_by_email" defaultValue={offer.prepared_by_email ?? ''} className={inputClassName()} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Poznámka (interní)
                </div>
                <textarea
                  id="internal_note"
                  name="internal_note"
                  rows={3}
                  defaultValue={offer.internal_note ?? ''}
                  className={textareaClassName()}
                />
              </div>

            </form>
          </section>

          <aside className="flex min-w-0 h-full flex-col gap-5">
            <section className="min-w-0 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
                Schvalování
              </div>
              <div className="mt-4 space-y-3">
                <form action={submitOfferForApproval.bind(null, offer.id)}>
                  <SubmitOfferApprovalButton
                    waitingForApproval={waitingForApproval}
                    staleSubmitted={staleSubmitted}
                  />
                </form>

                {isAdmin ? (
                  <>
                    <form action={approveOffer.bind(null, offer.id)}>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white transition hover:bg-emerald-700"
                      >
                        SCHVÁLIT NABÍDKU
                      </button>
                    </form>

                    <form action={rejectOffer.bind(null, offer.id)} className="space-y-2">
                      <textarea
                        name="rejection_comment"
                        rows={3}
                        placeholder="Komentář k vrácení..."
                        className={textareaClassName()}
                      />
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 transition hover:bg-amber-100"
                      >
                        VRÁTIT K ÚPRAVĚ
                      </button>
                    </form>
                  </>
                ) : null}

                {offer.status === 'approved' ? (
                  <div className="grid gap-2 border-t border-gray-100 pt-3">
                    <form action={setOfferClientOutcome.bind(null, offer.id, 'ordered')}>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-green-600 px-4 text-sm font-medium text-white transition hover:bg-green-700"
                      >
                        OBJEDNÁNO
                      </button>
                    </form>
                    <form action={setOfferClientOutcome.bind(null, offer.id, 'rejected')}>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-700 transition hover:bg-red-100"
                      >
                        ZAMÍTNUTO
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="min-w-0 rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
                ČASY EDITACE
              </div>
              <div className="mt-2 space-y-1.5 text-sm text-gray-600">
                <div>Vytvořeno: {formatDateTime(offer.created_at)}</div>
                <div>Odesláno: {formatDateTime(offer.submitted_at)}</div>
                <div>Schváleno: {formatDateTime(offer.approved_at)}</div>
              </div>
            </section>

            <div className="mt-auto grid gap-3">
              <Link
                href={`/offers/${offer.id}/pdf?standalone=1&print=1`}
                target="_blank"
                rel="noreferrer"
                data-offer-unsaved-guard="true"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-black px-4 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                GENEROVAT PDF
              </Link>
              <button
                type="submit"
                form="offer-details-form"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[#2980B9] px-4 text-sm font-medium text-white transition hover:bg-[#236f9f]"
              >
                ULOŽIT NABÍDKU
              </button>
              <form action={deleteOffer.bind(null, offer.id)}>
                <button
                  type="submit"
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  SMAZAT NABÍDKU
                </button>
              </form>
            </div>

          </aside>
        </div>

        {offer.offer_type === 'bsafe24' ? (
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  SOUČASNÁ ZÁLOHA LOKALIT
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Vyber, jestli má klient současnou zálohu lokalit
                </p>
              </div>

              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: '220px minmax(0, 1fr)',
                  alignItems: 'end',
                }}
              >
                <div className="grid grid-cols-2 gap-2">
                  {BSAFE24_BACKUP_LOCATION_PRESETS.map((value) => {
                    const isActive = selectedBackupLocation === value

                    return (
                      <form key={value} action={setOfferPresetChoice.bind(null, offer.id)}>
                        <input type="hidden" name="group" value={BSAFE24_BACKUP_LOCATION_GROUP_LABEL} />
                        <input type="hidden" name="value" value={value} />
                        <button type="submit" className={compactOfferPresetButtonClassName(isActive)}>
                          {value}
                        </button>
                      </form>
                    )
                  })}
                </div>

                {selectedBackupLocation === 'ANO' ? (
                  <div className="min-w-0">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Počet lokalit
                    </div>
                    <div
                      className="grid gap-1.5"
                      style={{ gridTemplateColumns: 'repeat(10, minmax(0, 1fr))' }}
                    >
                      {BSAFE24_BACKUP_LOCATION_COUNT_PRESETS.map((value) => {
                        const isActive = selectedBackupLocationCount === value

                        return (
                          <form key={value} action={setOfferPresetChoice.bind(null, offer.id)}>
                            <input type="hidden" name="group" value={BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL} />
                            <input type="hidden" name="value" value={value} />
                            <button type="submit" className={locationCountButtonClassName(isActive)}>
                              {value}
                            </button>
                          </form>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  DEPO
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Výjezdová depa pro realizaci
                </p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">
                  Pevně nastaveno
                </div>
                <div className="mt-1 text-sm font-semibold uppercase text-gray-900">
                  5 VÝJEZDOVÝCH DEP V ČR
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <OfferServicesModal
              offerId={offer.id}
              services={OFFER_SERVICE_PRESETS}
              selectedServices={[...selectedServices]}
            />

            <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  DEPO
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Vyber depo pro realizaci
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                {OFFER_DEPOT_PRESETS.map((depot) => {
                  const isActive = selectedDepots.has(depot)
                  const isDisabled = !isActive && selectedDepots.size >= OFFER_DEPOT_SELECTION_LIMIT

                  return (
                    <form key={depot} action={toggleOfferPresetItem.bind(null, offer.id)}>
                      <input type="hidden" name="group" value={OFFER_DEPOT_GROUP_LABEL} />
                      <input type="hidden" name="value" value={depot} />
                      <DepotToggleButton
                        label={depot}
                        disabled={isDisabled}
                        className={offerPresetButtonClassName(isActive, isDisabled)}
                      />
                    </form>
                  )
                })}
              </div>
            </section>
          </div>
        )}

        {offer.offer_type === 'bsafe24' ? (
          <>
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="bsafe_service"
              title="KALKULACE SLUŽBY B-SAFE 24"
              items={bsafeServiceItems}
              sectionNote={sectionNoteBySection.get('bsafe_service') ?? ''}
              presets={BSAFE24_SERVICE_ITEM_PRESETS}
            />
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="bsafe_realization"
              title="POHOTOVOSTNÍ VÝJEZD"
              items={bsafeRealizationItems}
              sectionNote={sectionNoteBySection.get('bsafe_realization') ?? ''}
              showDiscount={false}
              showQuantityAndTotal={false}
              presets={BSAFE24_TRIP_ITEM_PRESETS}
            />
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="bsafe_planned_trip"
              title="PLÁNOVANÝ VÝJEZD"
              items={bsafePlannedTripItems}
              sectionNote={sectionNoteBySection.get('bsafe_planned_trip') ?? ''}
              showDiscount={false}
              showQuantityAndTotal={false}
              presets={BSAFE24_TRIP_ITEM_PRESETS}
            />
          </>
        ) : (
          <>
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="classic_generators"
              title="ELEKTROCENTRÁLY"
              items={classicGeneratorItems}
              sectionNote={sectionNoteBySection.get('classic_generators') ?? sectionNoteBySection.get('main') ?? ''}
              presets={CLASSIC_GENERATOR_ITEM_PRESETS}
            />
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="classic_accessories"
              title="PŘÍSLUŠENSTVÍ"
              items={classicAccessoryItems}
              sectionNote={sectionNoteBySection.get('classic_accessories') ?? ''}
              presets={CLASSIC_ACCESSORY_ITEM_PRESETS}
            />
            <OfferItemsEditor
              offerId={offer.id}
              currency={offer.currency}
              itemSection="classic_services"
              title="SLUŽBY"
              items={classicServiceItems}
              sectionNote={sectionNoteBySection.get('classic_services') ?? ''}
              presets={CLASSIC_SERVICE_ITEM_PRESETS}
            />
          </>
        )}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="flex min-w-0 flex-1 flex-col rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
              OBCHODNÍ PODMÍNKY
            </div>
            <textarea
              id="terms_note"
              name="terms_note"
              form="offer-details-form"
              rows={3}
              defaultValue={
                offer.terms_note ??
                (offer.offer_type === 'bsafe24'
                  ? BSAFE24_DEFAULT_TERMS_NOTE
                  : CLASSIC_DEFAULT_TERMS_NOTE)
              }
              className={`${textareaClassName()} mt-4 flex-1 resize-none`}
            />
          </section>

          {offer.offer_type === 'bsafe24' ? (
            <div aria-hidden="true" />
          ) : (
            <section className="w-full rounded-3xl border border-gray-200 bg-white p-3 shadow-sm sm:p-5 xl:w-[360px]">
              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900 sm:tracking-[0.18em]">
                SOUHRN CENOVÉ NABÍDKY
              </div>
              <div className="mt-3 space-y-1.5 text-sm sm:mt-4 sm:space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)_150px] items-baseline gap-3 px-0">
                  <span className="text-gray-500">Bez DPH</span>
                  <span className="text-right font-semibold tabular-nums text-gray-900">
                    {formatCurrency(totals.subtotalWithoutVat, offer.currency)}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_150px] items-baseline gap-3 px-0">
                  <span className="text-gray-500">DPH</span>
                  <span className="text-right font-semibold tabular-nums text-gray-900">
                    {formatCurrency(totals.vatTotal, offer.currency)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_150px] items-baseline gap-3 rounded-2xl bg-gray-50 px-0 py-2 text-base sm:mt-0 sm:border-t sm:border-gray-100 sm:bg-transparent sm:pt-3">
                  <span className="font-semibold text-gray-900">Celkem</span>
                  <span className="text-right font-semibold tabular-nums text-gray-900">
                    {formatCurrency(totals.totalWithVat, offer.currency)}
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
