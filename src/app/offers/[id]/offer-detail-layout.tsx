import Link from 'next/link'
import {
  addOfferItem,
  approveOffer,
  addOfferProgressNote,
  deleteOfferItem,
  markOfferInProgress,
  moveOfferItem,
  rejectOffer,
  sendOfferToClient,
  setOfferClientOutcome,
  setOfferPresetChoice,
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
  OfferClientContact,
  OfferItemRow,
  OfferProgressNoteRow,
  OfferProfile,
  OfferRow,
  OfferServiceItemRow,
  OfferStatus,
  OfferType,
} from '@/lib/offers/types'
import { DepotToggleButton } from './depot-toggle-button'
import { DieselPriceBadge } from './diesel-price-badge'
import { GuardedOfferLink } from './guarded-offer-link'
import { ApproveOfferButton } from './approve-offer-button'
import { OfferItemsEditor } from './offer-items-modal'
import { OfferServicesModal } from './offer-services-modal'
import { OfferUnsavedChangesGuard } from './offer-unsaved-changes-guard'
import { SendOfferToClientButton } from './send-offer-to-client-button'
import { SubmitOfferApprovalButton } from './submit-offer-approval-button'
import { SaveOfferButton } from './save-offer-button'

type OfferDetailPageProps = {
  params: Promise<{ id: string }>
}

const STATUS_LABELS: Record<OfferStatus, string> = {
  draft: 'Rozpracovaná',
  submitted: 'Ke schválení',
  changes_requested: 'K úpravě',
  approved: 'Schválená',
  sent_to_client: 'Odeslaná',
  in_progress: 'V řešení',
  ordered: 'Objednáno',
  rejected: 'Zamítnuto',
}

const STATUS_BADGE_WIDTH_CLASS = 'w-[150px]'

const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  classic: 'KLASICKÁ',
  bsafe24: 'B-SAFE 24',
}

function getOfferTypeClass(type: OfferType) {
  if (type === 'bsafe24') {
    return 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(24,78,129,0.24)]'
  }

  return 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]'
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'

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
    timeZone: PRAGUE_TIME_ZONE,
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
  if (status === 'ordered') {
    return 'border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]'
  }
  if (status === 'rejected') {
    return 'border border-rose-500/85 bg-[linear-gradient(155deg,#e6527f_0%,#dc3f71_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_16px_rgba(225,29,72,0.22)]'
  }
  if (status === 'in_progress') {
    return 'border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(249,115,22,0.24)]'
  }
  if (status === 'sent_to_client') {
    return 'border border-zinc-900 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(247,247,248,0.9)_100%)] text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_16px_rgba(24,24,27,0.08)]'
  }
  if (status === 'approved') {
    return 'border border-emerald-300/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.95)_0%,rgba(209,250,229,0.88)_100%)] text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_16px_rgba(16,185,129,0.14)]'
  }
  if (status === 'submitted') {
    return 'border border-[#8dbfe0] bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(41,128,185,0.14)]'
  }
  if (status === 'changes_requested') {
    return 'border border-amber-300/90 bg-[linear-gradient(155deg,rgba(255,251,235,0.96)_0%,rgba(254,243,199,0.9)_100%)] text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(217,119,6,0.14)]'
  }
  return 'border border-zinc-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]'
}

function inputClassName() {
  return 'h-9 w-full rounded-xl border border-[#c7d1de] bg-[linear-gradient(165deg,rgba(242,247,252,0.97)_0%,rgba(234,241,249,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_2px_6px_rgba(148,163,184,0.18),inset_0_1px_0_rgba(255,255,255,0.62)] transition focus:border-[#8fc0e3] focus:ring-2 focus:ring-[#b9d8ef]'
}

function textareaClassName() {
  return 'w-full rounded-xl border border-[#c7d1de] bg-[linear-gradient(165deg,rgba(242,247,252,0.97)_0%,rgba(234,241,249,0.94)_100%)] px-3 py-2 text-sm text-gray-900 outline-none shadow-[inset_0_2px_6px_rgba(148,163,184,0.18),inset_0_1px_0_rgba(255,255,255,0.62)] transition focus:border-[#8fc0e3] focus:ring-2 focus:ring-[#b9d8ef]'
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
  { key: 'bsafe24-trip-generator-rental', description: 'Pronájem DA', specification: '', unitPrice: 0, plannedUnitPrice: 0, unit: 'den' },
  { key: 'bsafe24-trip-cable-chbu-20m', description: 'Kabeláž CHBU 20m', specification: '', unitPrice: 1500, plannedUnitPrice: 750, unit: 'den' },
  { key: 'bsafe24-trip-cable-viacom-twin', description: 'Kabeláž viaCOM TWIN', specification: '', unitPrice: 500, plannedUnitPrice: 250, unit: 'den' },
  { key: 'bsafe24-trip-transport-under-35t', description: 'Doprava do 3,5t', specification: '', unitPrice: 24, plannedUnitPrice: 24, unit: 'km' },
  { key: 'bsafe24-trip-install-deinstall', description: 'Instalace / Deinstalace', specification: '', unitPrice: 890, plannedUnitPrice: 790, unit: 'hod' },
  { key: 'bsafe24-trip-operator', description: 'Odborná obsluha', specification: '', unitPrice: 690, plannedUnitPrice: 590, unit: 'hod' },
  { key: 'bsafe24-trip-fuel-energy', description: 'Spotřebované PHM / Výroba EE *', specification: '', unitPrice: 40, plannedUnitPrice: 40, unit: 'litr' },
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

function isOfferApprovedCurrentVersion(offer: OfferRow) {
  return (
    offer.approved_version !== null &&
    offer.current_version === offer.approved_version &&
    (offer.status === 'approved' ||
      offer.status === 'sent_to_client' ||
      offer.status === 'in_progress' ||
      offer.status === 'ordered' ||
      offer.status === 'rejected')
  )
}

function offerPresetButtonClassName(isActive: boolean, isDisabled = false) {
  return [
    'inline-flex h-8 w-full items-center justify-center rounded-xl border px-1.5 text-center text-[10px] uppercase tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 sm:w-[150px] sm:px-2 sm:text-[11px] sm:tracking-[0.04em]',
    isActive
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] font-semibold text-white hover:-translate-y-[1px]'
      : isDisabled
        ? 'cursor-not-allowed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-400 opacity-60'
      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-900 hover:-translate-y-[1px]',
  ].join(' ')
}

function compactOfferPresetButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-10 w-full items-center justify-center rounded-xl border px-2 text-center text-sm uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200',
    isActive
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] font-semibold text-white hover:-translate-y-[1px]'
      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-900 hover:-translate-y-[1px]',
  ].join(' ')
}

function locationCountButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-10 w-full items-center justify-center rounded-xl border px-1 text-center text-xs uppercase shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200',
    isActive
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] font-semibold text-white hover:-translate-y-[1px]'
      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-900 hover:-translate-y-[1px]',
  ].join(' ')
}

export type OfferDetailLayoutProps = {
  offer: OfferRow
  client: OfferClient
  contacts: OfferClientContact[]
  items: OfferItemRow[]
  serviceItems: OfferServiceItemRow[]
  progressNotes: OfferProgressNoteRow[]
  profiles: OfferProfile[]
  profile: OfferProfile
  isAdmin: boolean
  saved?: boolean
}

export function OfferDetailLayout({
  offer,
  client,
  contacts,
  items,
  serviceItems,
  progressNotes,
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
  const canManageInProgressNotes = isAdmin || offer.created_by === profile.id
  const showApprovalBox =
    offer.status !== 'sent_to_client' &&
    offer.status !== 'in_progress' &&
    offer.status !== 'ordered' &&
    offer.status !== 'rejected'
  const canShowInProgressEntryBox = offer.status === 'sent_to_client'
  const canShowInProgressDetailBox = offer.status === 'in_progress'
  const isFinalClientOutcome =
    offer.status === 'ordered' || offer.status === 'rejected'
  const totals = getOfferTotals(items)
  const staleSubmitted = canShowResubmitNotice(offer)
  const waitingForApproval = isOfferWaitingForApproval(offer)
  const approvedCurrentVersion = isOfferApprovedCurrentVersion(offer)
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
  const plannedTripPriceByDescription = new Map(
    bsafePlannedTripItems.map((item) => [item.description, item.unit_price_without_vat])
  )
  const bsafeTripItems = bsafeRealizationItems.map((item) => (
    item.planned_unit_price_without_vat == null
      ? {
          ...item,
          planned_unit_price_without_vat: plannedTripPriceByDescription.get(item.description) ?? null,
        }
      : item
  ))


  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="min-w-0 rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-nowrap items-center justify-between gap-2 sm:justify-start">
                <h1 className="min-w-0 truncate text-2xl font-semibold leading-none tracking-tight text-gray-900 sm:text-3xl">
                  {offer.offer_number}
                </h1>
                <span className={`inline-flex h-8 w-[132px] shrink-0 items-center justify-center rounded-xl px-3 text-[10px] font-bold uppercase transition sm:${STATUS_BADGE_WIDTH_CLASS} sm:text-[11px] ${getStatusClass(offer.status)}`}>
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
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
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
          <section className="rounded-[26px] border border-emerald-300/80 bg-[linear-gradient(155deg,rgba(236,253,245,0.96)_0%,rgba(209,250,229,0.9)_100%)] px-5 py-4 text-center text-sm font-semibold uppercase tracking-[0.08em] text-emerald-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_14px_28px_rgba(16,185,129,0.16)]">
            Nabídka byla uložena.
          </section>
        ) : null}

        {staleSubmitted ? (
          <section className="rounded-[26px] border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-5 py-4 text-center text-sm font-medium uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_16px_30px_rgba(41,128,185,0.24)]">
            Nabídka byla upravena po odeslání ke schválení.{' '}
            <span className="font-bold">
              Odešli ji znovu, aby admin schvaloval aktuální verzi.
            </span>
          </section>
        ) : null}

        {offer.rejection_comment ? (
          <section className="rounded-[26px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(243,247,251,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_16px_32px_rgba(15,23,42,0.12)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              Komentář ke vrácení
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
              {offer.rejection_comment}
            </p>
          </section>
        ) : null}

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-stretch">
          <section className="flex min-w-0 flex-col rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="mb-5 flex flex-nowrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                ZÁKLAD NABÍDKY
              </h2>
              <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                <div className="hidden sm:block">
                  <DieselPriceBadge />
                </div>
                <span className={`inline-flex h-8 w-[132px] shrink-0 items-center justify-center rounded-xl border px-3 text-xs font-bold uppercase transition sm:w-[150px] sm:text-sm ${getOfferTypeClass(offer.offer_type)}`}>
                  {OFFER_TYPE_LABELS[offer.offer_type]}
                </span>
              </div>
            </div>

            <form
              id="offer-details-form"
              action={updateOfferDetails.bind(null, offer.id)}
              className="flex flex-1 flex-col gap-4"
            >
              <div className="overflow-hidden rounded-2xl border border-[#d7e1ec] bg-[linear-gradient(165deg,rgba(248,251,255,0.94)_0%,rgba(238,244,251,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(148,163,184,0.12)] sm:overflow-visible">
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
                  <div className="min-w-0">
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
                      <div className="min-w-0">
                        <label htmlFor="realization_starts_at" className="mb-2 block text-sm font-medium text-gray-700">
                          Termín realizace od
                        </label>
                        <input id="realization_starts_at" name="realization_starts_at" type="datetime-local" defaultValue={formatDateTimeInput(offer.realization_starts_at)} className={`${inputClassName()} block min-w-0 max-w-full appearance-none`} />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="realization_ends_at" className="mb-2 block text-sm font-medium text-gray-700">
                          Termín realizace do
                        </label>
                        <input id="realization_ends_at" name="realization_ends_at" type="datetime-local" defaultValue={formatDateTimeInput(offer.realization_ends_at)} className={`${inputClassName()} block min-w-0 max-w-full appearance-none`} />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-[#d7e1ec] bg-[linear-gradient(165deg,rgba(248,251,255,0.94)_0%,rgba(238,244,251,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(148,163,184,0.12)]">
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
                {contacts.length > 0 ? (
                  <>
                    <select
                      id="client_contact_id"
                      name="client_contact_id"
                      defaultValue={offer.client_contact_id ?? ''}
                      className={inputClassName()}
                    >
                      <option value="">Bez konkrétní osoby</option>
                      {contacts.map((contact) => (
                        <option key={contact.id} value={contact.id}>
                          {contact.name}
                          {contact.is_primary ? ' (hlavní)' : ''}
                        </option>
                      ))}
                    </select>
                    <input type="hidden" name="contact_person" value="" />
                  </>
                ) : (
                  <input id="contact_person" name="contact_person" defaultValue={offer.contact_person ?? client.contact_person ?? ''} className={inputClassName()} />
                )}
              </div>
                </div>
              </div>

              {offer.offer_type === 'bsafe24' ? null : (
                <input type="hidden" name="project_name" value={offer.project_name ?? ''} />
              )}
              <input type="hidden" name="valid_until" value={offer.valid_until ?? ''} />
              <input type="hidden" name="intro_note" value={offer.intro_note ?? ''} />

              <div className="rounded-2xl border border-[#d7e1ec] bg-[linear-gradient(165deg,rgba(248,251,255,0.94)_0%,rgba(238,244,251,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(148,163,184,0.12)]">
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

              <div className="rounded-2xl border border-[#d7e1ec] bg-[linear-gradient(165deg,rgba(248,251,255,0.94)_0%,rgba(238,244,251,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(148,163,184,0.12)]">
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
            {showApprovalBox ? (
              <section className="min-w-0 rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
                  Schvalování
                </div>
                <div className="mt-4 space-y-3">
                  {offer.status === 'approved' || offer.status === 'sent_to_client' ? (
                    <form action={sendOfferToClient.bind(null, offer.id)}>
                      <SendOfferToClientButton isSent={offer.status === 'sent_to_client'} />
                    </form>
                  ) : (
                    <SubmitOfferApprovalButton
                      offerId={offer.id}
                      formId="offer-details-form"
                      waitingForApproval={waitingForApproval}
                      staleSubmitted={staleSubmitted}
                    />
                  )}

                  {isAdmin ? (
                    <>
                      <form action={approveOffer.bind(null, offer.id)}>
                        <ApproveOfferButton
                          isApprovedCurrentVersion={approvedCurrentVersion}
                        />
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
                          className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-amber-300/90 bg-[linear-gradient(155deg,rgba(255,251,235,0.96)_0%,rgba(254,243,199,0.9)_100%)] px-4 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_20px_rgba(217,119,6,0.14)] transition duration-200 hover:-translate-y-[1px]"
                        >
                          VRÁTIT K ÚPRAVĚ
                        </button>
                      </form>
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            {canShowInProgressEntryBox ? (
              <section className="min-w-0 rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
                <div className="space-y-3">
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-10 w-full cursor-not-allowed items-center justify-center rounded-xl border border-zinc-900 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(247,247,248,0.9)_100%)] px-4 text-sm font-medium text-black opacity-85 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_16px_rgba(24,24,27,0.08)]"
                  >
                    ODESLÁNO KLIENTOVI
                  </button>
                  <form action={markOfferInProgress.bind(null, offer.id)}>
                    <button
                      type="submit"
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(249,115,22,0.24)] transition duration-200 hover:-translate-y-[1px]"
                    >
                      <span>
                        PŘEPNOUT NA <span className="font-bold">V ŘEŠENÍ</span>
                      </span>
                    </button>
                  </form>
                </div>
              </section>
            ) : null}

            {canShowInProgressDetailBox ? (
              <section
                className={`min-w-0 rounded-3xl border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_42px_rgba(15,23,42,0.12)] ${
                  offer.status === 'in_progress'
                    ? 'border-orange-300/80 bg-[linear-gradient(155deg,rgba(255,216,179,0.92)_0%,rgba(255,201,138,0.85)_100%)]'
                    : 'border-white/70 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(242,247,252,0.9)_100%)]'
                }`}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
                  V ŘEŠENÍ
                </div>

                <div className="mt-4 space-y-3">
                  {canManageInProgressNotes ? (
                    <form action={addOfferProgressNote.bind(null, offer.id)} className="space-y-2">
                      <textarea
                        name="progress_note"
                        rows={3}
                        placeholder="Komentář k průběhu..."
                        className="w-full rounded-xl border border-orange-300/80 bg-[linear-gradient(155deg,rgba(255,244,230,0.95)_0%,rgba(255,232,201,0.88)_100%)] px-3 py-2 text-sm text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_8px_16px_rgba(249,115,22,0.12)] outline-none transition placeholder:text-black/70 focus:border-orange-400 focus:ring-2 focus:ring-orange-300"
                      />
                      <button
                        type="submit"
                        disabled={offer.status !== 'in_progress'}
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(249,115,22,0.24)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        PŘIDAT KOMENTÁŘ
                      </button>
                    </form>
                  ) : null}

                  <div className="space-y-2 border-t border-orange-300 pt-3">
                    {progressNotes.length > 0 ? (
                      <div className="max-h-[228px] space-y-2 overflow-y-auto pr-1">
                        {progressNotes.map((note) => {
                          const noteAuthor = profileById.get(note.author_user_id)
                          return (
                            <div
                              key={note.id}
                              className="rounded-xl border border-orange-300/80 bg-[linear-gradient(155deg,rgba(255,244,230,0.95)_0%,rgba(255,232,201,0.88)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_8px_16px_rgba(249,115,22,0.12)]"
                            >
                              <div className="text-xs font-semibold uppercase tracking-[0.08em] text-black/70">
                                {(noteAuthor?.name ?? 'Uživatel')} · {formatDateTime(note.created_at)}
                              </div>
                              <div className="mt-1 whitespace-pre-wrap text-sm text-black">
                                {note.note}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-orange-300/80 bg-[linear-gradient(155deg,rgba(255,244,230,0.95)_0%,rgba(255,232,201,0.88)_100%)] px-3 py-3 text-sm text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_8px_16px_rgba(249,115,22,0.12)]">
                        Zatím nejsou zapsány žádné průběžné komentáře.
                      </div>
                    )}
                  </div>

                  <div className="grid gap-2 border-t border-orange-300 pt-3">
                    <form action={setOfferClientOutcome.bind(null, offer.id, 'ordered')}>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] transition duration-200 hover:-translate-y-[1px]"
                      >
                        OBJEDNÁNO
                      </button>
                    </form>
                    <form action={setOfferClientOutcome.bind(null, offer.id, 'rejected')}>
                      <button
                        type="submit"
                        className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-rose-300/90 bg-[linear-gradient(155deg,rgba(255,241,242,0.96)_0%,rgba(255,228,230,0.9)_100%)] px-4 text-sm font-medium text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_20px_rgba(225,29,72,0.14)] transition duration-200 hover:-translate-y-[1px]"
                      >
                        ZAMÍTNUTO
                      </button>
                    </form>
                  </div>
                </div>
              </section>
            ) : null}

            {isFinalClientOutcome ? (
              <section className="min-w-0 rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
                {offer.status === 'ordered' ? (
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-10 w-full cursor-default items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)]"
                  >
                    OBJEDNÁNO
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="inline-flex min-h-10 w-full cursor-default items-center justify-center rounded-xl border border-rose-300/90 bg-[linear-gradient(155deg,rgba(255,241,242,0.96)_0%,rgba(255,228,230,0.9)_100%)] px-4 text-sm font-medium text-rose-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_20px_rgba(225,29,72,0.14)]"
                  >
                    ZAMÍTNUTO
                  </button>
                )}

                {progressNotes.length > 0 ? (
                  <div className="mt-3 border-t border-gray-100 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                      Historie komentářů
                    </div>
                    <div className="max-h-[180px] space-y-2 overflow-y-auto pr-1">
                      {progressNotes.map((note) => {
                        const noteAuthor = profileById.get(note.author_user_id)
                        return (
                          <div
                            key={note.id}
                            className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]"
                          >
                            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
                              {(noteAuthor?.name ?? 'Uživatel')} · {formatDateTime(note.created_at)}
                            </div>
                            <div className="mt-1 whitespace-pre-wrap text-sm text-gray-800">
                              {note.note}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="mt-auto grid gap-3">
              <Link
                href={`/offers/${offer.id}/pdf?standalone=1&print=1`}
                target="_blank"
                rel="noreferrer"
                data-offer-unsaved-guard="true"
                className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
              >
                GENEROVAT PDF
              </Link>
              <SaveOfferButton formId="offer-details-form" />
            </div>

          </aside>
        </div>

        {offer.offer_type === 'bsafe24' ? (
          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <section className="min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  SOUČASNÁ ZÁLOHA LOKALIT
                </h2>
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
                      style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
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

            <section className="min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <div className="mb-5">
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  DEPO
                </h2>
              </div>

              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
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

            <section className="min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
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
              title="CENÍK VÝJEZDŮ B-SAFE 24"
              items={bsafeTripItems}
              sectionNote={sectionNoteBySection.get('bsafe_realization') ?? ''}
              showDiscount={false}
              showQuantityAndTotal={false}
              showPlannedPrice
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
          <section className="flex min-w-0 flex-1 flex-col rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
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
            <section className="w-full rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 xl:w-[360px]">
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
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_150px] items-baseline gap-3 px-0 py-2 text-base sm:mt-0 sm:pt-3">
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
