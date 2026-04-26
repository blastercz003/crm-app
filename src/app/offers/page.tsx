import Link from 'next/link'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import type { OfferClient, OfferProfile, OfferRow, OfferStatus, OfferType } from '@/lib/offers/types'
import { formatCurrency } from '@/lib/offers/calculations'
import { NewOfferButton } from './new-offer-button'
import { OfferNoteInput } from './offer-note-input'
import { duplicateOffer } from './actions'

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
  quantity: number
  unit_price_without_vat: number
  discount_percent: number
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

function getOfferTypeClass(type: OfferType) {
  return 'border-black bg-white text-black'
}

const STATUS_OPTIONS: Array<{ value: '' | OfferStatus; label: string }> = [
  { value: '', label: 'Všechny' },
  { value: 'draft', label: 'Rozpracované' },
  { value: 'submitted', label: 'Ke schválení' },
  { value: 'changes_requested', label: 'Vrácené' },
  { value: 'approved', label: 'Schválené' },
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

function getStatusClass(status: OfferStatus) {
  if (status === 'ordered') return 'bg-green-600 text-white'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'submitted') return 'bg-[#2980B9]/10 text-[#236f9f]'
  if (status === 'changes_requested') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-600'
}

function buildSearchFilter(search: string) {
  const escaped = search.replaceAll(',', ' ').trim()
  return `title.ilike.%${escaped}%,offer_number.ilike.%${escaped}%`
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

function getStatusLabel(status: string) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Všechny'
}

function getSortLabel(sort: OfferSort) {
  return SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Dle poslední úpravy'
}

function getOfferHref(params: { q: string; status: string; authorId: string; sort: OfferSort }) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  if (params.authorId) query.set('author', params.authorId)
  if (params.sort !== 'updated_desc') query.set('sort', params.sort)
  const search = query.toString()
  return search ? `/offers?${search}` : '/offers'
}

export default async function OffersPage({ searchParams }: OffersPageProps) {
  const params = searchParams ? await searchParams : undefined
  const q = params?.q?.trim() ?? ''
  const status = isOfferStatus(params?.status) ? params.status : ''
  const requestedAuthorId = params?.author?.trim() ?? ''
  const sort = isOfferSort(params?.sort) ? params.sort : 'updated_desc'

  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()
  const authorId = isAdmin
    ? requestedAuthorId === 'all'
      ? ''
      : requestedAuthorId || profile.id
    : ''
  const authorSelectValue = isAdmin
    ? requestedAuthorId === 'all'
      ? 'all'
      : authorId
    : ''

  let offersQuery = supabase.from('offers').select('*')

  if (!isAdmin) {
    offersQuery = offersQuery.eq('created_by', profile.id)
  } else if (authorId) {
    offersQuery = offersQuery.eq('created_by', authorId)
  }

  if (q) {
    offersQuery = offersQuery.or(buildSearchFilter(q))
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
    profilesResponse,
    itemsResponse,
  ] = await Promise.all([
    offersQuery,
    clientsQuery,
    supabase
      .from('profiles')
      .select('id, name, role, can_view_offers, offer_prepared_by_name, offer_prepared_by_phone, offer_prepared_by_email'),
    supabase
      .from('offer_items')
      .select('offer_id, quantity, unit_price_without_vat, discount_percent'),
  ])

  if (offersResponse.error) {
    throw new Error(`Nepodařilo se načíst nabídky: ${offersResponse.error.message}`)
  }

  if (clientsResponse.error) {
    throw new Error(`Nepodařilo se načíst klienty: ${clientsResponse.error.message}`)
  }

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst uživatele: ${profilesResponse.error.message}`)
  }

  if (itemsResponse.error) {
    throw new Error(`Nepodařilo se načíst položky nabídek: ${itemsResponse.error.message}`)
  }

  const offers = (offersResponse.data ?? []) as OfferRow[]
  const clients = (clientsResponse.data ?? []) as OfferClient[]
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
    draft: offers.filter((offer) => offer.status === 'draft').length,
    submitted: offers.filter((offer) => offer.status === 'submitted').length,
    approved: offers.filter((offer) => offer.status === 'approved').length,
    total: offers.length,
  }

  const sortedOffers =
    sort === 'price_desc'
      ? [...offers].sort((a, b) => {
          const aTotal = getOfferTotalWithoutVat(itemsByOfferId.get(a.id) ?? [])
          const bTotal = getOfferTotalWithoutVat(itemsByOfferId.get(b.id) ?? [])
          return bTotal - aTotal
        })
      : offers

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />
                <button
                  type="submit"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <NewOfferButton clients={visibleClientOptions} />
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="p-4 md:p-5">
            <div className="flex items-start justify-between gap-8">
              <form action="/offers" method="get" className="w-[796px] flex-none space-y-3">
                <input type="hidden" name="q" value={q} />

                <div className="flex w-[796px] items-end gap-2">
                  <div className="w-[240px] shrink-0">
                    <label
                      htmlFor="status"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      STAV NABÍDKY
                    </label>
                    <select
                      id="status"
                      name="status"
                      defaultValue={status}
                      className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                    >
                      {STATUS_OPTIONS.map((option) => (
                        <option key={option.value || 'all'} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {isAdmin ? (
                    <div className="w-[240px] shrink-0">
                      <label
                        htmlFor="author"
                        className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                      >
                        UŽIVATEL
                      </label>
                      <select
                        id="author"
                        name="author"
                        defaultValue={authorSelectValue}
                        className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
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

                  <div className="w-[300px] shrink-0">
                    <label
                      htmlFor="sort"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      ŘAZENÍ
                    </label>
                    <select
                      id="sort"
                      name="sort"
                      defaultValue={sort}
                      className="h-9 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-200"
                    >
                      {SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="w-[796px] border-t border-gray-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                        Stav:{' '}
                        <span className="ml-1 font-medium text-gray-900">
                          {getStatusLabel(status)}
                        </span>
                      </span>
                      {isAdmin ? (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                          Uživatel:{' '}
                          <span className="ml-1 font-medium text-gray-900">
                            {selectedAuthor?.name ?? 'Všichni uživatelé'}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                          Pohled:{' '}
                          <span className="ml-1 font-medium text-gray-900">
                            Moje nabídky
                          </span>
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                        Řazení:{' '}
                        <span className="ml-1 font-medium text-gray-900">
                          {getSortLabel(sort)}
                        </span>
                      </span>
                      {q ? (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1">
                          Hledání:{' '}
                          <span className="ml-1 font-medium text-gray-900">
                            {q}
                          </span>
                        </span>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="submit"
                        className="inline-flex h-9 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium uppercase text-white transition hover:bg-gray-800"
                      >
                        POUŽÍT FILTRY
                      </button>
                      <Link
                        href="/offers"
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50"
                      >
                        RESET
                      </Link>
                    </div>
                  </div>
                </div>
              </form>

              <div className="relative right-8 ml-auto mr-0 grid max-w-full flex-none grid-cols-4 justify-end gap-3">
                <div
                  className="flex-none rounded-2xl border border-[#2980B9] bg-[#2980B9] px-2.5 py-3 text-white shadow-sm"
                  style={{ width: 119 }}
                >
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-white">
                    CELKEM
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.total}</div>
                </div>
                <div
                  className="flex-none rounded-2xl border border-zinc-200 bg-white px-2.5 py-3 text-zinc-950 shadow-sm"
                  style={{ width: 119 }}
                >
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em]">
                    ROZPRACOVANÉ
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.draft}</div>
                </div>
                <div
                  className="flex-none rounded-2xl border border-zinc-800 bg-zinc-800 px-2.5 py-3 text-white shadow-sm"
                  style={{ width: 119 }}
                >
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-white">
                    SCHVÁLIT
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.submitted}</div>
                </div>
                <div
                  className="flex-none rounded-2xl border border-green-100 bg-green-100 px-2.5 py-3 text-green-800 shadow-sm"
                  style={{ width: 119 }}
                >
                  <div className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-current/80">
                    SCHVÁLENO
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.approved}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {sortedOffers.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900">
              Zatím tu nejsou žádné nabídky.
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              Začni vytvořením první nabídky přes tlačítko Nová nabídka.
            </p>
          </section>
        ) : (
          <section className="hidden rounded-3xl border border-gray-200 bg-white p-2 shadow-sm lg:block">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[1320px] table-fixed border-separate border-spacing-y-2">
                <colgroup>
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '16%' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    <th className="px-2 py-2">Nabídka</th>
                    <th className="px-2 py-2">Typ</th>
                    <th className="px-2 py-2">Klient</th>
                    <th className="px-2 py-2">Autor</th>
                    <th className="px-2 py-2">Platnost</th>
                    <th className="px-2 py-2">Poznámka</th>
                    <th className="px-2 py-2 text-right">Cena bez DPH</th>
                    <th className="px-2 py-2 text-center">Stav</th>
                    <th className="px-2 py-2 text-center">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOffers.map((offer) => {
                    const client = clientById.get(offer.client_id)
                    const author = profileById.get(offer.created_by)
                    const total = getOfferTotalWithoutVat(itemsByOfferId.get(offer.id) ?? [])

                    return (
                      <tr key={offer.id} className="group">
                        <td className="rounded-l-2xl border border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="text-sm font-semibold text-gray-900">
                            {offer.offer_number}
                          </div>
                          <div className="mt-1 truncate text-[12px] text-gray-500">
                            {offer.title}
                          </div>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <span className={`inline-flex h-8 w-full items-center justify-center rounded-xl border px-2 text-sm font-bold uppercase transition ${getOfferTypeClass(offer.offer_type)}`}>
                            {OFFER_TYPE_LABELS[offer.offer_type]}
                          </span>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-[12px] text-gray-700 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="truncate">{client?.name ?? 'Neznámý klient'}</div>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-[12px] text-gray-700 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="truncate">{author?.name ?? 'Neznámý uživatel'}</div>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-[12px] text-gray-700 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          {formatDate(offer.valid_until)}
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <OfferNoteInput offerId={offer.id} initialValue={offer.internal_note ?? ''} />
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 text-right align-middle text-[12px] font-semibold text-gray-900 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          {formatCurrency(total, offer.currency)}
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <span className={`inline-flex h-8 ${STATUS_BADGE_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition ${getStatusClass(offer.status)}`}>
                            {STATUS_LABELS[offer.status]}
                          </span>
                        </td>
                        <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/offers/${offer.id}/pdf?standalone=1&print=1`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center justify-center rounded-xl bg-[#2980B9] px-3 text-[11px] font-bold uppercase text-white transition hover:bg-[#236f9f]"
                            >
                              PDF
                            </Link>
                            <form action={duplicateOffer}>
                              <input type="hidden" name="offer_id" value={offer.id} />
                              <button
                                type="submit"
                                className="inline-flex h-8 items-center justify-center rounded-xl border border-gray-200 bg-white px-3 text-[11px] font-bold uppercase text-gray-700 transition hover:bg-gray-50"
                              >
                                KOPIE
                              </button>
                            </form>
                            <Link
                              href={`/offers/${offer.id}`}
                              className="inline-flex h-8 items-center justify-center rounded-xl bg-black px-3 text-[11px] font-bold uppercase text-white transition hover:bg-gray-800"
                            >
                              DETAIL
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
