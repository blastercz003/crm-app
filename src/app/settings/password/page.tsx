'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PushNotificationsPanel } from './push-notifications-panel'
import { buildPageTitle } from '@/lib/pageTitles'
import {
  readDashboardQuickCreateEnabled,
  readDashboardQuickNotesEnabled,
  readDashboardTodayJobsEnabled,
  writeDashboardQuickCreateEnabled,
  writeDashboardQuickNotesEnabled,
  writeDashboardTodayJobsEnabled,
} from '@/lib/dashboard/widget-preferences'

export default function ChangePasswordPage() {
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [quickCreateEnabled, setQuickCreateEnabled] = useState(true)
  const [quickNotesEnabled, setQuickNotesEnabled] = useState(true)
  const [todayJobsEnabled, setTodayJobsEnabled] = useState(true)

  useEffect(() => {
    document.title = buildPageTitle('Nastavení')
    setQuickCreateEnabled(readDashboardQuickCreateEnabled())
    setQuickNotesEnabled(readDashboardQuickNotesEnabled())
    setTodayJobsEnabled(readDashboardTodayJobsEnabled())
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
    <main className="relative min-h-screen overflow-x-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
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
                Nastavení
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-3">
          <section className="h-full rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              WIDGETY
            </div>
            <div className="mt-3 space-y-4">
              <p className="text-sm text-zinc-500">
                Zde můžeš zapnout nebo vypnout widgety na Dashboardu.
              </p>

              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Tlačítko Rychlých akcí "+"
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-zinc-600">
                      {quickCreateEnabled ? 'Aktivní' : 'Neaktivní'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quickCreateEnabled}
                      onClick={() => {
                        const nextValue = !quickCreateEnabled
                        setQuickCreateEnabled(nextValue)
                        writeDashboardQuickCreateEnabled(nextValue)
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 ${
                        quickCreateEnabled
                          ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
                          : 'border-zinc-300 bg-zinc-200/90'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                          quickCreateEnabled ? 'translate-x-[24px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Tlačítko Rychlé poznámky
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-zinc-600">
                      {quickNotesEnabled ? 'Aktivní' : 'Neaktivní'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={quickNotesEnabled}
                      onClick={() => {
                        const nextValue = !quickNotesEnabled
                        setQuickNotesEnabled(nextValue)
                        writeDashboardQuickNotesEnabled(nextValue)
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 ${
                        quickNotesEnabled
                          ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
                          : 'border-zinc-300 bg-zinc-200/90'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                          quickNotesEnabled ? 'translate-x-[24px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-900">
                      Tlačítko Dnešní zakázky
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-zinc-600">
                      {todayJobsEnabled ? 'Aktivní' : 'Neaktivní'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={todayJobsEnabled}
                      onClick={() => {
                        const nextValue = !todayJobsEnabled
                        setTodayJobsEnabled(nextValue)
                        writeDashboardTodayJobsEnabled(nextValue)
                      }}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 ${
                        todayJobsEnabled
                          ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
                          : 'border-zinc-300 bg-zinc-200/90'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                          todayJobsEnabled ? 'translate-x-[24px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="h-full">
            <PushNotificationsPanel />
          </div>

          <section className="h-full rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5">
            <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Změna hesla
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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
                  className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
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
                  className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  placeholder="Zadej heslo znovu"
                  autoComplete="new-password"
                  required
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-red-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.92)_100%)] px-4 py-2.5 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(239,68,68,0.1)]">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="rounded-2xl border border-emerald-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(236,253,245,0.92)_100%)] px-4 py-2.5 text-sm font-medium text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(16,185,129,0.1)]">
                  {success}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2.5 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 py-2.5 text-sm font-semibold tracking-[0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_26px_rgba(41,128,185,0.32)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)]"
                >
                  {loading ? 'UKLÁDÁM...' : 'ULOŽIT HESLO'}
                </button>

                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-2.5 text-sm font-semibold tracking-[0.01em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] hover:text-zinc-900"
                >
                  ZRUŠIT
                </Link>
              </div>
            </form>
          </section>
        </section>
      </div>
    </main>
  )
}
