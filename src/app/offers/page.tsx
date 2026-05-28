import Link from 'next/link'
import type { Metadata } from 'next'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import type { OfferClient, OfferProfile, OfferRow, OfferStatus, OfferType } from '@/lib/offers/types'
import { formatCurrency } from '@/lib/offers/calculations'
import { NewOfferButton } from './new-offer-button'
import { CopyOfferButton } from './copy-offer-button'
import { OfferNoteInput } from './offer-note-input'
import { OfferStatusButton } from './offer-status-button'
import { OfferStatusCommentsHover } from './offer-status-comments-hover'
import { OfferFilterSubmitButton } from './offer-filter-submit-button'
import { OfferFilterResetLink } from './offer-filter-reset-link'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'

export const metadata: Metadata = {
  title: 'Nabídky',
}

type OffersPageProps = {
  searchParams?: Promise<{
    q?: string
    status?: string
    author?: string
    sort?: string
  }>
}

type OfferItemForTotal = {
  offer_id: string
  item_section: string
  quantity: number
  unit_price_without_vat: number
  discount_percent: number
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type OfferStatsRow = {
  status: OfferStatus
}

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

const STATUS_OPTIONS: Array<{ value: '' | OfferStatus; label: string }> = [
  { value: '', label: 'Všechny' },
  { value: 'draft', label: 'Rozpracované' },
  { value: 'submitted', label: 'Ke schválení' },
  { value: 'changes_requested', label: 'Vrácené' },
  { value: 'approved', label: 'Schválené' },
  { value: 'sent_to_client', label: 'Odeslané klientovi' },
  { value: 'in_progress', label: 'V řešení' },
  { value: 'realizace', label: 'Realizace' },
  { value: 'ordered', label: 'Objednané' },
  { value: 'rejected', label: 'Zamítnuté' },
]

type OfferSort = 'updated_desc' | 'offer_number_desc' | 'valid_until_asc' | 'price_desc'

const SORT_OPTIONS: Array<{ value: OfferSort; label: string }> = [
  { value: 'updated_desc', label: 'Dle poslední úpravy' },
  { value: 'offer_number_desc', label: 'Dle čísla nabídky' },
  { value: 'valid_until_asc', label: 'Dle platnosti' },
  { value: 'price_desc', label: 'Dle ceny bez DPH' },
]

function isOfferStatus(value: string | undefined): value is OfferStatus {
  return (
    value === 'draft' ||
    value === 'submitted' ||
    value === 'changes_requested' ||
    value === 'approved' ||
    value === 'sent_to_client' ||
    value === 'in_progress' ||
    value === 'realizace' ||
    value === 'ordered' ||
    value === 'rejected'
  )
}

function isOfferSort(value: string | undefined): value is OfferSort {
  return (
    value === 'updated_desc' ||
    value === 'offer_number_desc' ||
    value === 'valid_until_asc' ||
    value === 'price_desc'
  )
}

function formatDate(value: string | null) {
  if (!value) return 'Bez data'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function buildSearchFilter(search: string) {
  const escaped = search.replaceAll(',', ' ').trim()
  return `title.ilike.%${escaped}%,offer_number.ilike.%${escaped}%`
}

function buildSearchFilterWithClients(search: string, clientIds: string[]) {
  const baseFilter = buildSearchFilter(search)
  if (clientIds.length === 0) {
    return baseFilter
  }

  return `${baseFilter},client_id.in.(${clientIds.join(',')})`
}

function getOfferTotalWithoutVat(items: OfferItemForTotal[]) {
  return items.reduce((sum, item) => {
    const quantity = Number(item.quantity) || 0
    const unitPrice = Number(item.unit_price_without_vat) || 0
    const discount = Math.min(Math.max(Number(item.discount_percent) || 0, 0), 100)
    const net = quantity * unitPrice * (1 - discount / 100)
    return sum + net
  }, 0)
}

function getOfferUnitPriceWithoutVat(items: OfferItemForTotal[]) {
  return items.reduce((sum, item) => {
    const unitPrice = Number(item.unit_price_without_vat) || 0
    const discount = Math.min(Math.max(Number(item.discount_percent) || 0, 0), 100)
    return sum + unitPrice * (1 - discount / 100)
  }, 0)
}

function getOfferListPriceWithoutVat(offer: OfferRow, items: OfferItemForTotal[]) {
  if (offer.offer_type !== 'bsafe24') {
    return getOfferTotalWithoutVat(items)
  }

  const serviceItems = items.filter(
    (item) => item.item_section === 'bsafe_service' || item.item_section === 'main'
  )

  return getOfferUnitPriceWithoutVat(serviceItems)
}

function getStatusLabel(status: string) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Všechny'
}

function getSortLabel(sort: OfferSort) {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Dle čísla nabídky'
}

function getOfferHref(params: { q: string; status: string; authorId: string; sort: OfferSort }) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  if (params.authorId) query.set('author', params.authorId)
  if (params.sort !== 'offer_number_desc') query.set('sort', params.sort)
  const search = query.toString()
  return search ? `/offers?${search}` : '/offers'
}

function InfoChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1 text-[11px] text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] sm:py-1.5 sm:text-xs">
      {label}
    </span>
  )
}

export default async function OffersPage({ searchParams }: OffersPageProps) {
  const params = searchParams ? await searchParams : undefined
  const q = params?.q?.trim() ?? ''
  const requestedAuthorId = params?.author?.trim() ?? ''
  const sort = isOfferSort(params?.sort) ? params.sort : 'offer_number_desc'

  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()
  const statusOptions = isAdmin
    ? STATUS_OPTIONS
    : STATUS_OPTIONS.filter((option) => option.value !== 'submitted')
  const status =
    isOfferStatus(params?.status) &&
    (isAdmin || params?.status !== 'submitted')
      ? params.status
      : ''
  const authorId = isAdmin
    ? requestedAuthorId === 'all' || requestedAuthorId.length === 0
      ? ''
      : requestedAuthorId
    : ''
  const authorSelectValue = isAdmin
    ? requestedAuthorId === 'all' || requestedAuthorId.length === 0
      ? 'all'
      : authorId
    : ''
  const hasActiveFilters =
    q.length > 0 ||
    status.length > 0 ||
    sort !== 'offer_number_desc' ||
    (isAdmin && requestedAuthorId.length > 0 && requestedAuthorId !== profile.id)

  let offersQuery = supabase.from('offers').select('*')
  let statsOffersQuery = supabase.from('offers').select('status')

  if (!isAdmin) {
    offersQuery = offersQuery.eq('created_by', profile.id)
    statsOffersQuery = statsOffersQuery.eq('created_by', profile.id)
  } else if (authorId) {
    offersQuery = offersQuery.eq('created_by', authorId)
  }

  if (q) {
    let matchingClientIds: string[] = []

    let clientSearchQuery = supabase
      .from('clients')
      .select('id')
      .ilike('name', `%${q.replaceAll(',', ' ').trim()}%`)

    if (!isAdmin) {
      clientSearchQuery = clientSearchQuery.eq('created_by', profile.id)
    }

    const { data: matchedClients, error: matchedClientsError } = await clientSearchQuery

    if (matchedClientsError) {
      throw new Error(`Nepodařilo se vyhledat firmy pro nabídky: ${matchedClientsError.message}`)
    }

    matchingClientIds = (matchedClients ?? []).map((client) => client.id)
    offersQuery = offersQuery.or(buildSearchFilterWithClients(q, matchingClientIds))
  }

  if (status) {
    offersQuery = offersQuery.eq('status', status)
  }

  if (sort === 'offer_number_desc') {
    offersQuery = offersQuery.order('offer_number', { ascending: false })
  } else if (sort === 'valid_until_asc') {
    offersQuery = offersQuery.order('valid_until', { ascending: true, nullsFirst: false })
  } else {
    offersQuery = offersQuery.order('updated_at', { ascending: false })
  }

  let clientsQuery = supabase
    .from('clients')
    .select('id, name, ico, contact_person, contact_email, address, created_by')
    .order('name', { ascending: true })

  if (!isAdmin) {
    clientsQuery = clientsQuery.eq('created_by', profile.id)
  }

  const [
    offersResponse,
    clientsResponse,
    contactsResponse,
    profilesResponse,
    itemsResponse,
    statsOffersResponse,
  ] = await Promise.all([
    offersQuery,
    clientsQuery,
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, name, role, can_view_offers, offer_prepared_by_name, offer_prepared_by_phone, offer_prepared_by_email'),
    supabase
      .from('offer_items')
      .select('offer_id, item_section, quantity, unit_price_without_vat, discount_percent'),
    statsOffersQuery,
  ])

  if (offersResponse.error) {
    throw new Error(`Nepodařilo se načíst nabídky: ${offersResponse.error.message}`)
  }

  if (clientsResponse.error) {
    throw new Error(`Nepodařilo se načíst klienty: ${clientsResponse.error.message}`)
  }

  if (contactsResponse.error) {
    throw new Error(`Nepodařilo se načíst kontaktní osoby klientů: ${contactsResponse.error.message}`)
  }

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst uživatele: ${profilesResponse.error.message}`)
  }

  if (itemsResponse.error) {
    throw new Error(`Nepodařilo se načíst položky nabídek: ${itemsResponse.error.message}`)
  }

  if (statsOffersResponse.error) {
    throw new Error(`Nepodařilo se načíst statistiky nabídek: ${statsOffersResponse.error.message}`)
  }

  const offers = (offersResponse.data ?? []) as OfferRow[]
  const statsOffers = (statsOffersResponse.data ?? []) as OfferStatsRow[]
  const clients = (clientsResponse.data ?? []) as OfferClient[]
  const contacts = (contactsResponse.data ?? []) as ClientContactOption[]
  const profiles = (profilesResponse.data ?? []) as OfferProfile[]
  const items = (itemsResponse.data ?? []) as OfferItemForTotal[]
  const clientById = new Map(clients.map((client) => [client.id, client]))
  const profileById = new Map(profiles.map((item) => [item.id, item]))
  const authorOptions = profiles
    .filter((item) => item.role === 'admin' || item.can_view_offers)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'cs'))
  const selectedAuthor = authorId ? profileById.get(authorId) : null
  const itemsByOfferId = new Map<string, OfferItemForTotal[]>()

  items.forEach((item) => {
    const current = itemsByOfferId.get(item.offer_id) ?? []
    current.push(item)
    itemsByOfferId.set(item.offer_id, current)
  })

  const visibleClientOptions = clients.map((client) => ({
    id: client.id,
    name: client.name,
  }))

  const statusCounts = {
    draft: statsOffers.filter((offer) => offer.status === 'draft').length,
    submitted: statsOffers.filter((offer) => offer.status === 'submitted').length,
    approved: statsOffers.filter((offer) => offer.status === 'approved').length,
    total: statsOffers.length,
  }

  const sortedOffers =
    sort === 'price_desc'
      ? [...offers].sort((a, b) => {
          const aTotal = getOfferListPriceWithoutVat(a, itemsByOfferId.get(a.id) ?? [])
          const bTotal = getOfferListPriceWithoutVat(b, itemsByOfferId.get(b.id) ?? [])
          return bTotal - aTotal
        })
      : offers

  return (
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Nabídky" route="/offers" />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Moje nabídky
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form action="/offers" method="get" className="flex w-full gap-3 sm:w-auto">
                <input type="hidden" name="status" value={status} />
                <input type="hidden" name="author" value={authorSelectValue} />
                <input type="hidden" name="sort" value={sort} />
                <input
                  type="text"
                  name="q"
                  defaultValue={q}
                  placeholder="Hledat číslo nebo název nabídky"
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_20px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_14px_26px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <NewOfferButton clients={visibleClientOptions} contacts={contacts} />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="p-4 md:p-5">
            <div className="flex flex-col items-stretch gap-5 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
              <details className="group w-full lg:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 py-2 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                  <span className="inline-flex items-center gap-2">
                    FILTRY
                    {hasActiveFilters ? (
                      <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                        FILTR AKTIVNÍ
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
                </summary>

                <form
                  action="/offers"
                  method="get"
                  className="mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                >
                  <input type="hidden" name="q" value={q} />

                  <div className="grid w-full gap-2 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label
                        htmlFor="status-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        STAV NABÍDKY
                      </label>
                      <select
                        id="status-mobile"
                        name="status"
                        defaultValue={status}
                        className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      >
                        {statusOptions.map((option) => (
                          <option key={option.value || 'all'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isAdmin ? (
                      <div className="min-w-0">
                        <label
                          htmlFor="author-mobile"
                          className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                        >
                          UŽIVATEL
                        </label>
                        <select
                          id="author-mobile"
                          name="author"
                          defaultValue={authorSelectValue}
                          className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                        >
                          <option value="all">Všichni uživatelé</option>
                          {authorOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name ?? 'Neznámý uživatel'}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}

                    <div className="min-w-0 sm:col-span-2">
                      <label
                        htmlFor="sort-mobile"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        ŘAZENÍ
                      </label>
                      <select
                        id="sort-mobile"
                        name="sort"
                        defaultValue={sort}
                        className="h-10 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="w-full border-t border-gray-100 pt-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-xs text-gray-600">
                      <InfoChip label={`Stav: ${getStatusLabel(status)}`} />
                      {isAdmin ? (
                        <InfoChip label={`Uživatel: ${selectedAuthor?.name ?? 'Všichni uživatelé'}`} />
                      ) : (
                        <InfoChip label="Pohled: Moje nabídky" />
                      )}
                      <InfoChip label={`Řazení: ${getSortLabel(sort)}`} />
                      {q ? <InfoChip label={`Hledání: ${q}`} /> : null}
                    </div>

                    <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-gray-100 pt-3">
                      <OfferFilterSubmitButton className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                        POUŽÍT FILTRY
                      </OfferFilterSubmitButton>
                      <OfferFilterResetLink
                        href="/offers"
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                      >
                        RESET
                      </OfferFilterResetLink>
                    </div>
                  </div>
                </form>
              </details>

              <form action="/offers" method="get" className="hidden w-full flex-none space-y-3 lg:block lg:w-[796px]">
                <input type="hidden" name="q" value={q} />

                <div className="grid w-full gap-2 sm:grid-cols-2 lg:flex lg:w-[796px] lg:items-end">
                  <div className="min-w-0 lg:w-[240px] lg:shrink-0">
                    <label
                      htmlFor="status"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      STAV NABÍDKY
                    </label>
                    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                      <select
                        id="status"
                        name="status"
                        defaultValue={status}
                        className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                      >
                        {statusOptions.map((option) => (
                          <option key={option.value || 'all'} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="min-w-0 lg:w-[240px] lg:shrink-0">
                      <label
                        htmlFor="author"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        UŽIVATEL
                      </label>
                      <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                        <select
                          id="author"
                          name="author"
                          defaultValue={authorSelectValue}
                          className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                        >
                          <option value="all">Všichni uživatelé</option>
                          {authorOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name ?? 'Neznámý uživatel'}
                            </option>
                          ))}
                        </select>
                        <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                      </div>
                    </div>
                  ) : null}

                  <div className="min-w-0 sm:col-span-2 lg:col-span-1 lg:w-[300px] lg:shrink-0">
                    <label
                      htmlFor="sort"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      ŘAZENÍ
                    </label>
                    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] sm:overflow-visible sm:border-0 sm:bg-transparent sm:shadow-none sm:focus-within:border-0 sm:focus-within:ring-0">
                      <select
                        id="sort"
                        name="sort"
                        defaultValue={sort}
                        className="block h-10 min-w-0 w-full max-w-full appearance-none border-0 bg-transparent px-4 pr-9 text-sm text-gray-900 outline-none sm:rounded-2xl sm:border sm:border-white/75 sm:bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] sm:shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] sm:transition sm:focus:border-[#9dc7e5] sm:focus:ring-2 sm:focus:ring-[#b9d8ef]"
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">⌄</span>
                    </div>
                  </div>
                </div>

                <div className="w-full border-t border-gray-100 pt-3 lg:w-[796px]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 text-xs text-gray-600 sm:gap-y-1.5">
                      <InfoChip label={`Stav: ${getStatusLabel(status)}`} />
                      {isAdmin ? (
                        <InfoChip label={`Uživatel: ${selectedAuthor?.name ?? 'Všichni uživatelé'}`} />
                      ) : (
                        <InfoChip label="Pohled: Moje nabídky" />
                      )}
                      <InfoChip label={`Řazení: ${getSortLabel(sort)}`} />
                      {q ? <InfoChip label={`Hledání: ${q}`} /> : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 pt-3 sm:border-t-0 sm:pt-0">
                      <OfferFilterSubmitButton className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">
                        POUŽÍT FILTRY
                      </OfferFilterSubmitButton>
                      <OfferFilterResetLink
                        href="/offers"
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                      >
                        RESET
                      </OfferFilterResetLink>
                    </div>
                  </div>
                </div>
              </form>

              <div className="hidden w-full grid-cols-2 gap-3 sm:grid sm:grid-cols-4 lg:relative lg:right-8 lg:ml-auto lg:mr-0 lg:w-auto lg:max-w-full lg:flex-none lg:justify-end">
                <div className="w-full rounded-2xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-2.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_24px_rgba(41,128,185,0.25)] lg:w-[119px] lg:flex-none">
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-white">
                    CELKEM
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.total}</div>
                </div>
                <div className="w-full rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-3 text-zinc-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] lg:w-[119px] lg:flex-none">
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em]">
                    ROZPRACOVANÉ
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.draft}</div>
                </div>
                <div className="w-full rounded-2xl border border-zinc-900 bg-zinc-900 px-2.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] lg:w-[119px] lg:flex-none">
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-white">
                    SCHVÁLIT
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.submitted}</div>
                </div>
                <div className="w-full rounded-2xl border border-emerald-500/80 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-2.5 py-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_22px_rgba(16,185,129,0.24)] lg:w-[119px] lg:flex-none">
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-white">
                    SCHVÁLENO
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.approved}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {sortedOffers.length === 0 ? (
          <section className="rounded-[26px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <h2 className="text-lg font-semibold text-gray-900">
              Zatím tu nejsou žádné nabídky.
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Začni vytvořením první nabídky přes tlačítko Nová nabídka.
            </p>
          </section>
        ) : (
          <>
            <section className="grid gap-3 lg:hidden">
              {sortedOffers.map((offer) => {
                const client = clientById.get(offer.client_id)
                const total = getOfferListPriceWithoutVat(offer, itemsByOfferId.get(offer.id) ?? [])

                return (
                  <article
                    key={offer.id}
                    className="overflow-hidden rounded-3xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(242,247,252,0.9)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_24px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_16px_30px_rgba(15,23,42,0.14)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 w-0 flex-1">
                        <div className="truncate text-base font-semibold text-gray-900">
                          {offer.offer_number}
                        </div>
                        <div className="mt-1 block truncate text-sm text-gray-500">
                          {offer.title}
                        </div>
                        <div className="mt-1 block truncate text-sm text-gray-800">
                          {client?.name ?? 'Neznámý klient'}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <OfferStatusButton
                          offerId={offer.id}
                          offerNumber={offer.offer_number}
                          currentStatus={offer.status}
                          isAdmin={isAdmin}
                          isOwner={offer.created_by === profile.id}
                          badgeWidthClass="w-[140px]"
                        />
                        <span className={`inline-flex h-8 w-[140px] items-center justify-center rounded-xl border px-3 text-[11px] font-bold uppercase ${getOfferTypeClass(offer.offer_type)}`}>
                          {OFFER_TYPE_LABELS[offer.offer_type]}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 text-sm font-semibold text-gray-900">
                      {formatCurrency(total, offer.currency)}
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <Link
                        href={`/offers/${offer.id}/pdf?standalone=1&print=1`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_26px_rgba(41,128,185,0.32)]"
                      >
                        PDF
                      </Link>
                      <CopyOfferButton
                        offerId={offer.id}
                        offerNumber={offer.offer_number}
                        clients={visibleClientOptions}
                        contacts={contacts}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                      />
                      <Link
                        href={`/offers/${offer.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                      >
                        DETAIL
                      </Link>
                    </div>
                  </article>
                )
              })}
            </section>

            <section className="hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
              <div className="max-h-[70vh] overflow-auto">
                <div
                  className="sticky top-0 z-20 grid min-w-[1320px] bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(245,249,253,0.95)_100%)] pb-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 shadow-[0_1px_0_0_#e5e7eb]"
                  style={{
                    gridTemplateColumns:
                      '11% 9% 14% 4% 8% 17% 11% 10% 16%',
                  }}
                >
                  <div className="px-2 py-2">Nabídka</div>
                  <div className="px-2 py-2">Typ</div>
                  <div className="px-2 py-2">Klient</div>
                  <div className="px-2 py-2">Autor</div>
                  <div className="px-2 py-2">Platnost</div>
                  <div className="px-2 py-2">Poznámka (interní)</div>
                  <div className="px-2 py-2 text-right">Cena bez DPH</div>
                  <div className="px-2 py-2 text-center">Stav</div>
                  <div className="px-2 py-2 text-center">Akce</div>
                </div>

                <div className="grid min-w-[1320px] gap-2 pt-2">
                  {sortedOffers.map((offer) => {
                    const client = clientById.get(offer.client_id)
                    const author = profileById.get(offer.created_by)
                    const total = getOfferListPriceWithoutVat(offer, itemsByOfferId.get(offer.id) ?? [])

                    return (
                      <div
                        key={offer.id}
                        className="group grid items-center rounded-2xl border border-[#cfd8e3] bg-[linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 hover:-translate-y-[1px] hover:border-[#78abcf] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),inset_0_0_0_1px_rgba(143,183,216,0.55)]"
                        style={{
                          gridTemplateColumns:
                            '11% 9% 14% 4% 8% 17% 11% 10% 16%',
                        }}
                      >
                        <div className="min-w-0 px-2 py-2">
                          <div className="text-sm font-semibold text-gray-900">
                            {offer.offer_number}
                          </div>
                          <div className="mt-1 truncate text-[12px] text-gray-500">
                            {offer.title}
                          </div>
                        </div>
                        <div className="min-w-0 px-2 py-2">
                          <span className={`inline-flex h-8 w-full items-center justify-center rounded-xl border px-2 text-sm font-bold uppercase transition ${getOfferTypeClass(offer.offer_type)}`}>
                            {OFFER_TYPE_LABELS[offer.offer_type]}
                          </span>
                        </div>
                        <div className="min-w-0 px-2 py-2 text-[12px] text-gray-700">
                          <div className="truncate">{client?.name ?? 'Neznámý klient'}</div>
                        </div>
                        <div className="min-w-0 px-2 py-2 text-[12px] text-gray-700">
                          <div className="truncate">{author?.name ?? 'Neznámý uživatel'}</div>
                        </div>
                        <div className="min-w-0 px-2 py-2 text-[12px] text-gray-700">
                          {formatDate(offer.valid_until)}
                        </div>
                        <div className="min-w-0 px-2 py-2">
                          <OfferNoteInput offerId={offer.id} initialValue={offer.internal_note ?? ''} />
                        </div>
                        <div className="min-w-0 px-2 py-2 text-right text-[12px] font-semibold text-gray-900">
                          {formatCurrency(total, offer.currency)}
                        </div>
                        <div className="min-w-0 px-2 py-2">
                          <OfferStatusCommentsHover
                            offerId={offer.id}
                            offerNumber={offer.offer_number}
                            currentStatus={offer.status}
                            isAdmin={isAdmin}
                            isOwner={offer.created_by === profile.id}
                          />
                        </div>
                        <div className="min-w-0 px-2 py-2">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/offers/${offer.id}/pdf?standalone=1&print=1`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(41,128,185,0.3)]"
                            >
                              PDF
                            </Link>
                            <CopyOfferButton
                              offerId={offer.id}
                              offerNumber={offer.offer_number}
                              clients={visibleClientOptions}
                              contacts={contacts}
                              className="inline-flex h-8 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_16px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_20px_rgba(15,23,42,0.12)]"
                            />
                            <Link
                              href={`/offers/${offer.id}`}
                              className="inline-flex h-8 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                            >
                              DETAIL
                            </Link>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
