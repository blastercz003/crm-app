'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PushNotificationsPanel } from './push-notifications-panel'
import { buildPageTitle } from '@/lib/pageTitles'

export default function ChangePasswordPage() {
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    document.title = buildPageTitle('Nastavení')
  }, [])

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
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto max-w-3xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Nastavení účtu
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Nastavení
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Zde si můžeš nastavit nové heslo do appky
                <br />a zapnout notifikace (iPhone / Android).
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-[18px] border border-[#66aee4] bg-[linear-gradient(135deg,#5ea8df_0%,#2f76b7_100%)] px-6 py-3 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_18px_30px_rgba(46,123,183,0.22),inset_0_1px_0_rgba(255,255,255,0.34)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-105"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6">
          <div className="max-w-xl">
            <div className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Změna hesla
            </div>

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
                  className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
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
                  className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  placeholder="Zadej heslo znovu"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.92)_100%)] px-4 py-3 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(239,68,68,0.1)]">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="rounded-2xl border border-emerald-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(236,253,245,0.92)_100%)] px-4 py-3 text-sm font-medium text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(16,185,129,0.1)]">
                  {success}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-[18px] border border-[#66aee4] bg-[linear-gradient(135deg,#5ea8df_0%,#2f76b7_100%)] px-6 py-3 text-sm font-semibold tracking-[0.01em] text-white shadow-[0_18px_30px_rgba(46,123,183,0.22),inset_0_1px_0_rgba(255,255,255,0.34)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:brightness-100"
                >
                  {loading ? 'UKLÁDÁM...' : 'ULOŽIT NOVÉ HESLO'}
                </button>

                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-[18px] border border-white/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(248,250,252,0.86)_100%)] px-6 py-3 text-sm font-semibold tracking-[0.01em] text-zinc-700 shadow-[0_12px_26px_rgba(15,23,42,0.1),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:text-zinc-900"
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
