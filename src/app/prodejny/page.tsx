import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { StoresSearchBar } from './search-bar'
import { StoresImportLauncher } from './stores-import-launcher'
import { StoreEditButton } from './store-edit-button'

export const metadata: Metadata = {
  title: 'Prodejny',
}

type StoresPageProps = {
  searchParams?: Promise<{
    q?: string
  }>
}

type ProfilePermissionRow = {
  role: string | null
  can_view_stores: boolean | null
}

type StoreRow = {
  id: string
  chain_name: string
  store_number: string
  city: string
  address: string
  phone_1: string
  phone_2: string | null
  phone_3: string | null
  updated_at: string
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getSearchTokens(search: string) {
  return normalizeSearchValue(search)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function buildPhoneHref(phone: string) {
  const normalized = phone.replace(/[^\d+]/g, '')
  return `tel:${normalized}`
}

function PhoneLink({ phone }: { phone: string }) {
  return (
    <a
      href={buildPhoneHref(phone)}
      className="stores-page__phone-link inline-flex w-fit rounded-lg text-sm text-[#1f5f8f] underline decoration-[#8dbfe0] decoration-2 underline-offset-2 transition duration-200 hover:text-[#17496d]"
    >
      {phone}
    </a>
  )
}

function PhoneStack({
  phone1,
  phone2,
  phone3,
}: {
  phone1: string
  phone2: string | null
  phone3: string | null
}) {
  const phones = [phone1, phone2, phone3].filter(Boolean) as string[]

  return (
    <div className="flex flex-col gap-1">
      {phones.map((phone, index) => (
        <PhoneLink key={`${phone}-${index}`} phone={phone} />
      ))}
    </div>
  )
}

function StoreCard({ store, isAdmin }: { store: StoreRow; isAdmin: boolean }) {
  return (
    <article className="stores-page__card rounded-[24px] border border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="stores-page__chain-badge inline-flex rounded-full border border-[#8dbfe0]/70 bg-[#2980B9]/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1f5f8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
            {store.chain_name}
          </span>
          <span className="stores-page__store-badge inline-flex rounded-full border border-zinc-200/90 bg-zinc-100/85 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            Prodejna {store.store_number}
          </span>
        </div>

        {isAdmin ? <StoreEditButton store={store} /> : null}
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Město / adresa
          </div>
          <div className="mt-1 text-sm leading-6 text-zinc-800">
            <div className="font-medium text-zinc-900">{store.city}</div>
            <div>{store.address}</div>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            Telefony
          </div>
          <div className="mt-1">
            <PhoneStack
              phone1={store.phone_1}
              phone2={store.phone_2}
              phone3={store.phone_3}
            />
          </div>
        </div>

        <div className="pt-1 text-xs text-zinc-400">
          Aktualizováno: {formatDateTime(store.updated_at)}
        </div>
      </div>
    </article>
  )
}

export default async function StoresPage({ searchParams }: StoresPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const query = resolvedSearchParams?.q?.trim() ?? ''
  const hasSearch = query.length >= 3
  const searchTokens = hasSearch ? getSearchTokens(query) : []

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_stores')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'

  if (!isAdmin && !typedProfile?.can_view_stores) {
    redirect('/dashboard')
  }

  let stores: StoreRow[] = []

  if (hasSearch && searchTokens.length > 0) {
    let request = supabase
      .from('stores')
      .select('id, chain_name, store_number, city, address, phone_1, phone_2, phone_3, updated_at')
      .order('chain_name', { ascending: true })
      .order('store_number', { ascending: true })
      .limit(200)

    for (const token of searchTokens) {
      const escapedToken = token.replaceAll('%', '\\%').replaceAll('_', '\\_')
      request = request.ilike('search_text', `%${escapedToken}%`)
    }

    const { data, error } = await request

    if (error) {
      throw new Error('Nepodařilo se načíst prodejny.')
    }

    stores = (data ?? []) as StoreRow[]
  }

  return (
    <main className="stores-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)]">
      <PresenceSectionTracker section="Prodejny" route="/prodejny" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)] [html[data-theme='dark']_&]:opacity-100"
      />
      <div
        aria-hidden
        className="stores-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(78,160,220,0.12)]"
      />
      <div
        aria-hidden
        className="stores-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(12,87,140,0.10)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="stores-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Prodejny
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
                <div className="order-1 sm:order-2">
                  <Link
                    href="/dashboard"
                    className="clients-page__back-button inline-flex w-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-gray-800 sm:w-auto"
                  >
                    ZPĚT NA DASHBOARD
                  </Link>
                </div>

                {isAdmin ? (
                  <div className="order-2 w-full sm:order-3 sm:w-auto">
                    <StoresImportLauncher />
                  </div>
                ) : null}

                <div className="order-3 sm:order-1">
                  <StoresSearchBar initialQuery={query} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {!hasSearch ? (
          <section className="stores-page__empty-state rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                Vyhledávání prodejen
              </h2>
              <p className="text-xs leading-5 text-gray-500 sm:text-sm sm:leading-6">
                Zadej alespoň 3 znaky a výsledky se zobrazí automaticky.
                <br />
                Hledat můžeš podle řetězce, čísla prodejny, adresy i telefonu.
              </p>
            </div>
          </section>
        ) : stores.length === 0 ? (
          <section className="stores-page__empty-state rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                Žádná prodejna neodpovídá hledání.
              </h2>
              <p className="text-sm leading-6 text-gray-500">
                Zkus upravit hledaný výraz nebo vyhledat podle jiné části adresy,
                čísla prodejny nebo telefonu.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="stores-page__summary rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Nalezeno záznamů:{' '}
                  <span className="font-semibold text-gray-900">{stores.length}</span>
                </p>

                <div className="flex flex-col gap-1 text-sm sm:items-end">
                  <p className="text-gray-500">
                    Hledání:{' '}
                    <span className="font-medium text-gray-900">{query}</span>
                  </p>
                </div>
              </div>
            </section>

            <section className="stores-page__table-shell hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
              <div className="max-h-[72vh] overflow-auto">
                <table className="min-w-full">
                  <thead className="stores-page__table-head sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(245,246,248,0.92)_100%)] shadow-sm">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-4">Řetězec</th>
                      <th className="px-5 py-4">Číslo prodejny</th>
                      <th className="px-5 py-4">Město</th>
                      <th className="px-5 py-4">Adresa</th>
                      <th className="px-5 py-4">Telefon 1</th>
                      <th className="px-5 py-4">Telefon 2</th>
                      <th className="px-5 py-4">Telefon 3</th>
                      <th className="px-5 py-4">Aktualizováno</th>
                      {isAdmin ? <th className="px-5 py-4 text-right">Akce</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((store) => (
                      <tr
                        key={store.id}
                        className="stores-page__table-row transition duration-200 ease-out hover:bg-white/75"
                      >
                        <td className="px-5 py-4 text-sm font-semibold text-gray-900">
                          {store.chain_name}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {store.store_number}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">{store.city}</td>
                        <td className="px-5 py-4 text-sm text-gray-700">{store.address}</td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          <PhoneLink phone={store.phone_1} />
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {store.phone_2 ? <PhoneLink phone={store.phone_2} /> : '—'}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-700">
                          {store.phone_3 ? <PhoneLink phone={store.phone_3} /> : '—'}
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-500">
                          {formatDateTime(store.updated_at)}
                        </td>
                        {isAdmin ? (
                          <td className="px-5 py-4 text-right">
                            <StoreEditButton store={store} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:hidden">
              {stores.map((store) => (
                <StoreCard key={store.id} store={store} isAdmin={isAdmin} />
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
