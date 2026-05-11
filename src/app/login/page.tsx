'use client'

import Image from 'next/image'
import { useActionState, useEffect } from 'react'
import { loginAction, type LoginActionState } from './actions'
import { buildPageTitle } from '@/lib/pageTitles'

export default function LoginPage() {
  const initialState: LoginActionState = { error: null }
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  useEffect(() => {
    document.title = buildPageTitle('Přihlášení')
  }, [])

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6 text-zinc-900">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-background.PNG')" }}
      />
      <div className="absolute inset-0 bg-white/44 backdrop-blur-[1.5px] sm:bg-white/40 sm:backdrop-blur-[1.2px]" />

      <div className="relative z-10 w-full max-w-md rounded-[32px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-8">
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
            <label className="block text-sm font-medium text-zinc-600">
              E-mail
            </label>
            <input
              type="email"
              name="email"
              className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-600">
              Heslo
            </label>
            <input
              type="password"
              name="password"
              className="w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              required
            />
          </div>

          {state.error && <p className="text-sm text-red-600">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-3 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.38),0_18px_34px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? 'PŘIHLAŠUJI...' : 'PŘIHLÁSIT SE'}
          </button>
        </form>
      </div>
    </main>
  )
}
