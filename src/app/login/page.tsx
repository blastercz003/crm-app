'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { loginAction, type LoginActionState } from './actions'

export default function LoginPage() {
  const initialState: LoginActionState = { error: null }
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6 text-zinc-900">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/login-background.PNG')" }}
      />
      <div className="absolute inset-0 bg-white/48 backdrop-blur-[1.5px]" />

      <div className="relative z-10 w-full max-w-md rounded-[32px] border border-zinc-200/90 bg-white/94 p-8 shadow-[0_24px_60px_rgba(15,23,42,0.18)] backdrop-blur-md">
        <div className="mb-8 flex justify-center">
          <Image
            src="/logo.png"
            alt="B-ENERGY"
            width={120}
            height={34}
            priority
            className="h-5 w-auto"
          />
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm text-zinc-600">
              E-mail
            </label>
            <input
              type="email"
              name="email"
              className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 outline-none transition focus:border-[#2980B9] focus:ring-2 focus:ring-[#2980B9]/10"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-zinc-600">
              Heslo
            </label>
            <input
              type="password"
              name="password"
              className="w-full rounded-2xl border border-zinc-300 bg-white px-4 py-3 outline-none transition focus:border-[#2980B9] focus:ring-2 focus:ring-[#2980B9]/10"
              required
            />
          </div>

          {state.error && (
            <p className="text-sm text-red-600">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-zinc-900 px-4 py-3 text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {pending ? 'PŘIHLAŠUJI...' : 'PŘIHLÁSIT SE'}
          </button>
        </form>
      </div>
    </main>
  )
}
