import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { cleanTitlePart } from '@/lib/pageTitles'
import { deleteClientRecord, updateClientRecord } from '../../actions'

type ClientRow = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('clients')
    .select('name')
    .eq('id', id)
    .maybeSingle<Pick<ClientRow, 'name'>>()

  const clientName = cleanTitlePart(data?.name)

  return {
    title: clientName ? `Upravit klienta - ${clientName}` : 'Upravit klienta',
  }
}

type ProfileRow = {
  role: string | null
}

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !client) {
    notFound()
  }

  const typedClient = client as ClientRow
  const canManageClient = isAdmin || typedClient.created_by === user.id

  if (!canManageClient) {
    notFound()
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Upravit klienta
              </h1>
              <p className="text-sm text-gray-500">
                Uprav údaje klienta nebo záznam smaž.
              </p>
            </div>

            <Link
              href={`/clients/${typedClient.id}`}
              className="inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
              style={{ backgroundColor: '#2980B9' }}
            >
              ZPĚT NA DETAIL
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-6">
            <form action={updateClientRecord} className="space-y-6">
              <input type="hidden" name="id" value={typedClient.id} />

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium text-gray-900"
                  >
                    Název firmy *
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    defaultValue={typedClient.name}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="ico"
                    className="text-sm font-medium text-gray-900"
                  >
                    IČO
                  </label>
                  <input
                    id="ico"
                    name="ico"
                    type="text"
                    defaultValue={typedClient.ico ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_person"
                    className="text-sm font-medium text-gray-900"
                  >
                    Kontaktní osoba
                  </label>
                  <input
                    id="contact_person"
                    name="contact_person"
                    type="text"
                    defaultValue={typedClient.contact_person ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_phone"
                    className="text-sm font-medium text-gray-900"
                  >
                    Telefon
                  </label>
                  <input
                    id="contact_phone"
                    name="contact_phone"
                    type="text"
                    defaultValue={typedClient.contact_phone ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_email"
                    className="text-sm font-medium text-gray-900"
                  >
                    E-mail
                  </label>
                  <input
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    defaultValue={typedClient.contact_email ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="address"
                    className="text-sm font-medium text-gray-900"
                  >
                    Adresa
                  </label>
                  <input
                    id="address"
                    name="address"
                    type="text"
                    defaultValue={typedClient.address ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="note"
                    className="text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id="note"
                    name="note"
                    rows={5}
                    defaultValue={typedClient.note ?? ''}
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:justify-end">
                <Link
                  href={`/clients/${typedClient.id}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  ZRUŠIT
                </Link>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
                >
                  ULOŽIT ZMĚNY
                </button>
              </div>
            </form>

            {isAdmin ? (
              <div className="border-t border-gray-100 pt-6">
                <div className="flex flex-col gap-4 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-red-800">
                      Smazání klienta
                    </h2>
                    <p className="text-sm text-red-700">
                      Tato akce klienta odstraní ze seznamu.
                    </p>
                  </div>

                  <form action={deleteClientRecord}>
                    <input type="hidden" name="id" value={typedClient.id} />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center rounded-2xl border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
                    >
                      SMAZAT KLIENTA
                    </button>
                  </form>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  )
}
