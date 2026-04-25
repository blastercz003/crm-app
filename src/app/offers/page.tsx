import Link from 'next/link'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import type { OfferClient, OfferProfile, OfferRow, OfferStatus } from '@/lib/offers/types'
import { formatCurrency } from '@/lib/offers/calculations'
import { NewOfferButton } from './new-offer-button'
import { OfferNoteInput } from './offer-note-input'

type OffersPageProps = {
  searchParams?: Promise<{
    q?: string
    status?: string
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

const STATUS_OPTIONS: Array<{ value: '' | OfferStatus; label: string }> = [
  { value: '', label: 'Všechny' },
  { value: 'draft', label: 'Rozpracované' },
  { value: 'submitted', label: 'Ke schválení' },
  { value: 'changes_requested', label: 'Vrácené' },
  { value: 'approved', label: 'Schválené' },
  { value: 'ordered', label: 'Objednané' },
  { value: 'rejected', label: 'Zamítnuté' },
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

function getOfferHref(params: { q: string; status: string }) {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.status) query.set('status', params.status)
  const search = query.toString()
  return search ? `/offers?${search}` : '/offers'
}

export default async function OffersPage({ searchParams }: OffersPageProps) {
  const params = searchParams ? await searchParams : undefined
  const q = params?.q?.trim() ?? ''
  const status = isOfferStatus(params?.status) ? params.status : ''

  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let offersQuery = supabase.from('offers').select('*')

  if (!isAdmin) {
    offersQuery = offersQuery.eq('created_by', profile.id)
  }

  if (q) {
    offersQuery = offersQuery.or(buildSearchFilter(q))
  }

  if (status) {
    offersQuery = offersQuery.eq('status', status)
  }

  offersQuery = offersQuery.order('updated_at', { ascending: false })

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
    supabase.from('profiles').select('id, name, role, can_view_offers'),
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
    ordered: offers.filter((offer) => offer.status === 'ordered').length,
    rejected: offers.filter((offer) => offer.status === 'rejected').length,
    total: offers.length,
  }

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

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="p-4 md:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_640px] xl:items-start">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  Stav nabídky
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STATUS_OPTIONS.map((option) => (
                    <Link
                      key={option.value || 'all'}
                      href={getOfferHref({ q, status: option.value })}
                      className={[
                        'inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition',
                        status === option.value
                          ? 'bg-zinc-900 text-white shadow-sm'
                          : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900',
                      ].join(' ')}
                    >
                      {option.label}
                    </Link>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
                    {isAdmin ? 'Admin pohled' : 'Moje nabídky'}
                  </span>
                  {q ? (
                    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
                      Hledání: {q}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <div className="rounded-2xl border border-[#2980B9] bg-[#2980B9] px-4 py-3 text-white shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                    Celkem
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.total}</div>
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-950 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                    Rozprac.
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.draft}</div>
                </div>
                <div className="rounded-2xl border border-zinc-800 bg-zinc-800 px-4 py-3 text-white shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                    Schválit
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.submitted}</div>
                </div>
                <div className="rounded-2xl border border-green-100 bg-green-100 px-4 py-3 text-green-800 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-current/80">
                    Schvál.
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.approved}</div>
                </div>
                <div className="rounded-2xl border border-green-600 bg-green-600 px-4 py-3 text-white shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
                    Objed.
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.ordered}</div>
                </div>
                <div className="rounded-2xl border border-red-100 bg-red-100 px-4 py-3 text-red-700 shadow-sm">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-current/80">
                    Zamít.
                  </div>
                  <div className="mt-1 text-lg font-semibold leading-none">{statusCounts.rejected}</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {offers.length === 0 ? (
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
                <thead className="sticky top-0 z-10 bg-white">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    <th className="w-[180px] px-2 py-2">Nabídka</th>
                    <th className="w-[180px] px-2 py-2">Klient</th>
                    <th className="w-[135px] px-2 py-2">Autor</th>
                    <th className="w-[145px] px-2 py-2">Stav</th>
                    <th className="w-[120px] px-2 py-2">Platnost</th>
                    <th className="w-[270px] px-2 py-2">Poznámka</th>
                    <th className="w-[150px] px-2 py-2 text-right">Cena bez DPH</th>
                    <th className="w-[100px] px-2 py-2 text-right">Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => {
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
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-[12px] text-gray-700 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="truncate">{client?.name ?? 'Neznámý klient'}</div>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-[12px] text-gray-700 transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="truncate">{author?.name ?? 'Neznámý uživatel'}</div>
                        </td>
                        <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <span className={`inline-flex h-8 max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition ${getStatusClass(offer.status)}`}>
                            {STATUS_LABELS[offer.status]}
                          </span>
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
                        <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
                          <div className="flex justify-end">
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
