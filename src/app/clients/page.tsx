import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EditClientButton } from './edit-client-button'
import { NewClientButton } from './new-client-button'

type ClientRow = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  note: string | null
  created_at: string
}

export const metadata: Metadata = {
  title: 'Klienti',
}

type ProfileRow = {
  role: string | null
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function buildSearchFilter(search: string) {
  const escaped = search.replaceAll(',', ' ').trim()
  return `name.ilike.%${escaped}%,ico.ilike.%${escaped}%,contact_person.ilike.%${escaped}%,contact_email.ilike.%${escaped}%`
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>
}) {
  const params = searchParams ? await searchParams : undefined
  const query = params?.q?.trim() ?? ''

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const isAdmin = (profile as ProfileRow | null)?.role === 'admin'

  let request = supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })

  if (!isAdmin) {
    request = request.eq('created_by', user.id)
  }

  if (query) {
    request = request.or(buildSearchFilter(query))
  }

  const { data: clients, error } = await request

  if (error) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  const typedClients = (clients ?? []) as ClientRow[]

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Databáze klientů
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/clients"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat firmu, IČO, osobu nebo e-mail"
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

              <NewClientButton />
            </div>
          </div>
        </section>

        {typedClients.length === 0 ? (
          <section className="rounded-3xl border border-dashed border-gray-300 bg-white p-8 text-center shadow-sm">
            <div className="mx-auto max-w-xl space-y-3">
              <h2 className="text-lg font-semibold text-gray-900">
                {query
                  ? 'Žádný klient neodpovídá hledání.'
                  : 'Zatím tu nejsou žádní klienti.'}
              </h2>
              <p className="text-sm leading-6 text-gray-500">
                {query
                  ? 'Zkus upravit hledaný výraz nebo vyhledat podle názvu firmy, IČO, kontaktní osoby nebo e-mailu.'
                  : 'Začni přidáním prvního klienta a vytvoř si vlastní databázi firem.'}
              </p>
              <div className="pt-2">
                <NewClientButton
                  label="Přidat klienta"
                  className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
                />
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-gray-600">
                  Celkem klientů:{' '}
                  <span className="font-semibold text-gray-900">
                    {typedClients.length}
                  </span>
                </p>

                <div className="flex flex-col gap-1 text-sm sm:items-end">
                  <p className="text-gray-500">
                    Řazení:{' '}
                    <span className="font-medium text-gray-900">
                      A → Z podle názvu firmy
                    </span>
                  </p>

                  {query ? (
                    <p className="text-gray-500">
                      Filtr:{' '}
                      <span className="font-medium text-gray-900">{query}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="hidden overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:block">
              <div className="max-h-[70vh] overflow-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="sticky top-0 z-10 bg-gray-50 shadow-sm">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-4">Firma</th>
                      <th className="px-5 py-4">IČO</th>
                      <th className="px-5 py-4">Kontaktní osoba</th>
                      <th className="px-5 py-4">Telefon</th>
                      <th className="px-5 py-4">E-mail</th>
                      <th className="px-5 py-4">Vytvořeno</th>
                      <th className="px-5 py-4 text-center">Akce</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-100">
                    {typedClients.map((client) => {
                      return (
                        <tr
                          key={client.id}
                          className="transition hover:bg-gray-50"
                        >
                          <td className="px-5 py-4">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-gray-900">
                                {client.name}
                              </div>
                              {client.address ? (
                                <div className="mt-1 truncate text-xs text-gray-500">
                                  {client.address}
                                </div>
                              ) : null}
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            {client.ico || '—'}
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            {client.contact_person || '—'}
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            {client.contact_phone || '—'}
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            <div className="max-w-[220px] truncate">
                              {client.contact_email || '—'}
                            </div>
                          </td>

                          <td className="px-5 py-4 text-sm text-gray-600">
                            {formatDate(client.created_at)}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-2">
                              <EditClientButton
                                client={client}
                                canDeleteClient={isAdmin}
                                className="inline-flex w-[74px] items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 transition hover:bg-gray-100"
                              />

                              <Link
                                href={`/clients/${client.id}`}
                                className="inline-flex w-[74px] items-center justify-center rounded-xl bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800"
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

            <section className="grid gap-3 lg:hidden">
              {typedClients.map((client) => {
                return (
                  <div
                    key={client.id}
                    className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-semibold text-gray-900">
                            {client.name}
                          </h2>

                          {client.ico ? (
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                              IČO: {client.ico}
                            </span>
                          ) : null}
                        </div>
                      </div>

                    </div>

                    <div className="mt-4 grid gap-2 text-sm text-gray-600">
                      <div>
                        <span className="font-medium text-gray-900">
                          Kontaktní osoba:
                        </span>{' '}
                        {client.contact_person || '—'}
                      </div>
                      <div>
                        <span className="font-medium text-gray-900">
                          Telefon:
                        </span>{' '}
                        {client.contact_phone || '—'}
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap justify-end gap-2">
                      <EditClientButton
                        client={client}
                        canDeleteClient={isAdmin}
                        className="inline-flex w-[74px] items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 transition hover:bg-gray-100"
                      />

                      <Link
                        href={`/clients/${client.id}`}
                        className="inline-flex w-[74px] items-center justify-center rounded-xl bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800"
                      >
                        DETAIL
                      </Link>
                    </div>
                  </div>
                )
              })}
            </section>
          </>
        )}
      </div>
    </main>
  )
}
