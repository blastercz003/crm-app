'use client'

import Image from 'next/image'
import { useActionState, useEffect } from 'react'
import { loginAction, type LoginActionState } from './actions'
import { buildPageTitle } from '@/lib/pageTitles'
import { applyThemeColor, applyThemeMode } from '@/lib/theme/theme-preference'

export default function LoginPage() {
  const initialState: LoginActionState = { error: null }
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  useEffect(() => {
    document.title = buildPageTitle('Přihlášení')
    applyThemeMode('dark')
    applyThemeColor('dark')
  }, [])

  return (
    <main className="login-page relative flex min-h-screen items-center justify-center overflow-hidden p-6 text-[#e5edf7]">
      <div
        className="login-page__background absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-background.PNG')" }}
      />
      <div className="login-page__overlay absolute inset-0 bg-[linear-gradient(180deg,rgba(3,7,18,0.24)_0%,rgba(11,18,32,0.58)_100%)]" />

      <div className="login-page__card relative z-10 w-full max-w-md rounded-[32px] border border-slate-500/18 bg-[linear-gradient(155deg,rgba(15,23,42,0.94)_0%,rgba(12,20,34,0.9)_48%,rgba(8,13,23,0.92)_100%)] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_24px_54px_rgba(0,0,0,0.34)] backdrop-blur-[10px] sm:p-8">
        <div className="mb-7 flex justify-center sm:mb-8">
          <Image
            src="/logo.png"
            alt="B-ENERGY"
            width={120}
            height={34}
            priority
            className="h-5 w-auto sm:h-6"
          />
        </div>

        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <label className="login-page__label block text-sm font-medium text-[#cbd5e1]">
              E-mail
            </label>
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
              autoCapitalize="off"
              className="login-page__input w-full rounded-2xl border border-slate-500/18 bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] px-4 py-3 text-sm text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_18px_rgba(0,0,0,0.18)] outline-none transition duration-200 ease-out placeholder:text-slate-500 focus:border-[#5ca7db] focus:ring-0"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="login-page__label block text-sm font-medium text-[#cbd5e1]">
              Heslo
            </label>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              className="login-page__input w-full rounded-2xl border border-slate-500/18 bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] px-4 py-3 text-sm text-[#f8fbff] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_8px_18px_rgba(0,0,0,0.18)] outline-none transition duration-200 ease-out placeholder:text-slate-500 focus:border-[#5ca7db] focus:ring-0"
              required
            />
          </div>

          {state.error && <p className="login-page__error text-sm text-[#fca5a5]">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="login-page__submit w-full rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-3 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_18px_34px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'PŘIHLAŠUJI...' : 'PŘIHLÁSIT SE'}
          </button>
        </form>
      </div>
    </main>
  )
}
