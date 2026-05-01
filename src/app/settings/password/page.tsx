'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PushNotificationsPanel } from './push-notifications-panel'

export default function ChangePasswordPage() {
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    if (password.length < 6) {
      setError('Nové heslo musí mít alespoň 6 znaků.')
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError('Hesla se neshodují.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.updateUser({
      password,
    })

    if (error) {
      setError('Heslo se nepodařilo změnit.')
      setLoading(false)
      return
    }

    setSuccess('Heslo bylo úspěšně změněno.')
    setPassword('')
    setConfirmPassword('')
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Nastavení účtu
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Nastavení
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Zde si můžeš nastavit nové heslo do appky a zapnout notifikace
                (iPhone).
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
          <div className="max-w-xl">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-zinc-700"
                >
                  Nové heslo
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
                  placeholder="Zadej nové heslo"
                  autoComplete="new-password"
                  required
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Doporučeno alespoň 6 znaků.
                </p>
              </div>

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-2 block text-sm font-medium text-zinc-700"
                >
                  Potvrzení nového hesla
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-300 px-4 py-3 outline-none transition focus:border-zinc-500"
                  placeholder="Zadej heslo znovu"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {success}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'UKLÁDÁM...' : 'ULOŽIT NOVÉ HESLO'}
                </button>

                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
                >
                  ZRUŠIT
                </Link>
              </div>
            </form>
          </div>
        </section>

        <PushNotificationsPanel />
      </div>
    </main>
  )
}
