import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  addOfferItem,
  approveOffer,
  deleteOffer,
  deleteOfferItem,
  moveOfferItem,
  rejectOffer,
  setOfferClientOutcome,
  submitOfferForApproval,
  toggleOfferPresetItem,
  updateOfferDetails,
  updateOfferItem,
} from '@/app/offers/actions'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import {
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_DEPOT_PRESETS,
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
} from '@/lib/offers/types'
import { OfferUnsavedChangesGuard } from './offer-unsaved-changes-guard'

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

const DEFAULT_TERMS_NOTE =
  'Nedílnou součástní nabídky jsou všeobecné obchodní podmínky pronájmu.\n* Spotřeba pohonných hmot se vyúčtuje na základě skutečné spotřeby.\n** Platbu za PHM a služby je nutno uhradit min. 3 dny před započetím realizace (peníze na účtu Blaster Services s.r.o.)'

function isOfferWaitingForApproval(offer: OfferRow) {
  return (
    offer.status === 'submitted' &&
    offer.submitted_version !== null &&
    offer.current_version === offer.submitted_version
  )
}

function offerPresetButtonClassName(isActive: boolean) {
  return [
    'inline-flex min-h-10 w-[172px] items-center justify-center rounded-xl border px-3 text-center text-sm uppercase transition',
    isActive
      ? 'border-[#2980B9] bg-[#2980B9] font-semibold text-white shadow-sm hover:bg-[#236f9f]'
      : 'border-gray-200 bg-gray-100 font-normal text-gray-900 hover:border-gray-300 hover:bg-gray-200',
  ].join(' ')
}

export default async function OfferDetailPage({ params }: OfferDetailPageProps) {
  const { id } = await params
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let offerQuery = supabase.from('offers').select('*').eq('id', id)

  if (!isAdmin) {
    offerQuery = offerQuery.eq('created_by', profile.id)
  }

  const offerResponse = await offerQuery.single<OfferRow>()

  if (offerResponse.error || !offerResponse.data) {
    notFound()
  }

  const offer = offerResponse.data

  const [clientResponse, itemsResponse, serviceItemsResponse, profilesResponse] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, ico, contact_person, contact_email, address, created_by')
      .eq('id', offer.client_id)
      .single<OfferClient>(),
    supabase
      .from('offer_items')
      .select('*')
      .eq('offer_id', offer.id)
      .order('position', { ascending: true }),
    supabase
      .from('offer_service_items')
      .select('*')
      .eq('offer_id', offer.id)
      .order('position', { ascending: true }),
    supabase.from('profiles').select('id, name, role, can_view_offers'),
  ])

  if (clientResponse.error || !clientResponse.data) {
    throw new Error('Nepodařilo se načíst klienta nabídky.')
  }

  if (itemsResponse.error) {
    throw new Error('Nepodařilo se načíst položky nabídky.')
  }

  if (serviceItemsResponse.error) {
    throw new Error('Nepodařilo se načíst rozsah služby.')
  }

  if (profilesResponse.error) {
    throw new Error('Nepodařilo se načíst uživatele.')
  }

  const client = clientResponse.data
  const items = (itemsResponse.data ?? []) as OfferItemRow[]
  const serviceItems = (serviceItemsResponse.data ?? []) as OfferServiceItemRow[]
  const profiles = (profilesResponse.data ?? []) as OfferProfile[]
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
  const profileById = new Map(profiles.map((item) => [item.id, item]))
  const author = profileById.get(offer.created_by)
  const lastEditor = offer.last_edited_by ? profileById.get(offer.last_edited_by) : null
  const totals = getOfferTotals(items)
  const staleSubmitted = canShowResubmitNotice(offer)
  const waitingForApproval = isOfferWaitingForApproval(offer)

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
                <span className={`inline-flex h-8 max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition ${getStatusClass(offer.status)}`}>
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
              <Link
                href="/offers"
                data-offer-unsaved-guard="true"
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ZPĚT NA NABÍDKY
              </Link>
            </div>
          </div>
        </section>

        <OfferUnsavedChangesGuard
          formId="offer-details-form"
          message="Nejprve si prosím ulož práci tlačítkem ULOŽIT NABÍDKU."
        />

        {staleSubmitted ? (
          <section className="rounded-3xl border border-[#2980B9] bg-[#2980B9] px-5 py-4 text-sm font-medium text-white shadow-sm">
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
            <div className="mb-5">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                ZÁKLAD NABÍDKY
              </h2>
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
                <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_220px_220px]">
              <div>
                <label htmlFor="title" className="mb-2 block text-sm font-medium text-gray-700">
                  Název nabídky
                </label>
                <input id="title" name="title" defaultValue={offer.title} required className={inputClassName()} />
              </div>

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
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Realizace a kontakt
                </div>
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_280px]">
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

              <input type="hidden" name="project_name" value={offer.project_name ?? ''} />
              <input type="hidden" name="valid_until" value={offer.valid_until ?? ''} />
              <input type="hidden" name="intro_note" value={offer.intro_note ?? ''} />
              <input type="hidden" name="internal_note" value={offer.internal_note ?? ''} />

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-900">
                  Zpracovatel
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label htmlFor="prepared_by_name" className="mb-2 block text-sm font-medium text-gray-700">
                    Nabídku zpracoval
                  </label>
                  <input id="prepared_by_name" name="prepared_by_name" defaultValue={offer.prepared_by_name ?? author?.name ?? ''} className={inputClassName()} />
                </div>
                <div>
                  <label htmlFor="prepared_by_phone" className="mb-2 block text-sm font-medium text-gray-700">
                    Mobil
                  </label>
                  <input id="prepared_by_phone" name="prepared_by_phone" defaultValue={offer.prepared_by_phone ?? ''} className={inputClassName()} />
                </div>
                <div>
                  <label htmlFor="prepared_by_email" className="mb-2 block text-sm font-medium text-gray-700">
                    E-mail
                  </label>
                  <input id="prepared_by_email" name="prepared_by_email" defaultValue={offer.prepared_by_email ?? ''} className={inputClassName()} />
                </div>
                </div>
              </div>

              <div>
                <label htmlFor="terms_note" className="mb-2 block text-sm font-medium text-gray-700">
                  Obchodní podmínky / poznámky
                </label>
                <textarea
                  id="terms_note"
                  name="terms_note"
                  rows={3}
                  defaultValue={offer.terms_note ?? DEFAULT_TERMS_NOTE}
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
                  <button
                    type="submit"
                    disabled={waitingForApproval}
                    className={[
                      'inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-70',
                      waitingForApproval
                        ? 'border border-zinc-200 bg-zinc-100 text-zinc-500'
                        : 'bg-[#2980B9] text-white hover:bg-[#236f9f]',
                    ].join(' ')}
                  >
                    {waitingForApproval
                      ? 'ODESLÁNO KE SCHVÁLENÍ'
                      : staleSubmitted
                        ? 'ODESLAT ZNOVU KE SCHVÁLENÍ'
                        : 'ODESLAT KE SCHVÁLENÍ'}
                  </button>
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

            <section className="min-w-0 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
                ČASY EDITACE
              </div>
              <div className="mt-3 space-y-2 text-sm text-gray-600">
                <div>Vytvořeno: {formatDateTime(offer.created_at)}</div>
                <div>Odesláno: {formatDateTime(offer.submitted_at)}</div>
                <div>Schváleno: {formatDateTime(offer.approved_at)}</div>
              </div>
            </section>

            <div className="mt-auto grid gap-3">
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

        <div className="grid min-w-0 gap-5 lg:grid-cols-2">
          <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                SLUŽBY
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Vyber služby pro klienta
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {OFFER_SERVICE_PRESETS.map((service) => {
                const isActive = selectedServices.has(service)

                return (
                  <form key={service} action={toggleOfferPresetItem.bind(null, offer.id)}>
                    <input type="hidden" name="group" value={OFFER_SERVICE_GROUP_LABEL} />
                    <input type="hidden" name="value" value={service} />
                    <button type="submit" className={offerPresetButtonClassName(isActive)}>
                      {service}
                    </button>
                  </form>
                )
              })}
            </div>
          </section>

          <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-5">
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                DEPO
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Vyber depo pro realizaci
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {OFFER_DEPOT_PRESETS.map((depot) => {
                const isActive = selectedDepots.has(depot)

                return (
                  <form key={depot} action={toggleOfferPresetItem.bind(null, offer.id)}>
                    <input type="hidden" name="group" value={OFFER_DEPOT_GROUP_LABEL} />
                    <input type="hidden" name="value" value={depot} />
                    <button type="submit" className={offerPresetButtonClassName(isActive)}>
                      {depot}
                    </button>
                  </form>
                )
              })}
            </div>
          </section>
        </div>

        <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                POLOŽKY NABÍDKY
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
            <div className="grid max-w-full gap-2 overflow-hidden md:grid-cols-2 xl:grid-cols-[minmax(140px,1.15fr)_minmax(180px,1.35fr)_112px_72px_88px_126px_44px_44px_70px_70px] xl:items-end">
              <div className="min-w-0">
                <label htmlFor="new-description" className={offerItemLabelClassName()}>
                  Položka
                </label>
                <input id="new-description" name="description" required className={inputClassName()} />
              </div>
              <div className="min-w-0">
                <label htmlFor="new-specification" className={offerItemLabelClassName()}>
                  Specifikace / popis
                </label>
                <input id="new-specification" name="specification" className={inputClassName()} />
              </div>
              <div className="min-w-0">
                <label htmlFor="new-price" className={offerItemLabelClassName()}>
                  Jedn. cena
                </label>
                <input id="new-price" name="unit_price_without_vat" className={inputClassName()} />
              </div>
              <div className="min-w-0">
                <label htmlFor="new-unit" className={offerItemLabelClassName()}>
                  Jedn.
                </label>
                <input id="new-unit" name="unit" defaultValue="ks" className={inputClassName()} />
              </div>
              <div className="min-w-0">
                <label htmlFor="new-quantity" className={offerItemLabelClassName()}>
                  Množství
                </label>
                <input id="new-quantity" name="quantity" defaultValue="1" className={inputClassName()} />
              </div>
              <div className="min-w-0">
                <div className={offerItemLabelClassName()}>
                  Cena bez DPH
                </div>
                <input name="discount_percent" type="hidden" value="0" />
                <div className="flex h-9 items-center rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-400">
                  -
                </div>
              </div>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-xs font-medium text-white transition hover:bg-[#236f9f] md:col-span-2 xl:col-span-4"
              >
                PŘIDAT
              </button>
            </div>
          </form>

          {items.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
              Nabídka zatím nemá žádné položky.
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {items.map((item, index) => (
                <form
                  key={item.id}
                  action={updateOfferItem.bind(null, item.id)}
                  className="grid min-w-0 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.02)]"
                >
                  <input type="hidden" name="offer_id" value={offer.id} />
                  <input type="hidden" name="discount_percent" value={formatNumber(item.discount_percent)} />
                  <div className="grid max-w-full gap-2 overflow-hidden md:grid-cols-2 xl:grid-cols-[minmax(140px,1.15fr)_minmax(180px,1.35fr)_112px_72px_88px_126px_44px_44px_70px_70px] xl:items-center">
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
                      disabled={index === items.length - 1}
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

        <section className="ml-auto w-full max-w-[360px] rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-900">
            Souhrn
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">Bez DPH</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(totals.subtotalWithoutVat, offer.currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-gray-500">DPH</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(totals.vatTotal, offer.currency)}
              </span>
            </div>
            <div className="flex justify-between gap-4 border-t border-gray-100 pt-3 text-base">
              <span className="font-semibold text-gray-900">Celkem</span>
              <span className="font-semibold text-gray-900">
                {formatCurrency(totals.totalWithVat, offer.currency)}
              </span>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
