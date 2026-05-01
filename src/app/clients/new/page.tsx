import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClientRecord } from '../actions'

export const metadata: Metadata = {
  title: 'Nový klient',
}

export default async function NewClientPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                Nový klient
              </h1>
              <p className="text-sm text-gray-500">
                Přidej novou firmu do databáze klientů.
              </p>
            </div>

            <Link
              href="/clients"
              className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Zpět na klienty
            </Link>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <form action={createClientRecord} className="space-y-6">
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
                  placeholder="Např. ABC Stavby s.r.o."
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
                  placeholder="Např. 12345678"
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
                  placeholder="Např. Jan Novák"
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
                  placeholder="Např. +420 777 123 456"
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
                  placeholder="Např. novak@firma.cz"
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
                  placeholder="Např. Ulice 123, 110 00 Praha"
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
                  placeholder="Doplňující informace o klientovi, preferencích nebo spolupráci."
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:justify-end">
              <Link
                href="/clients"
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Zrušit
              </Link>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                Uložit klienta
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
