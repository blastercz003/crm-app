'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { loginAction, type LoginActionState } from './actions'

export default function LoginPage() {
  const initialState: LoginActionState = { error: null }
  const [state, formAction, pending] = useActionState(loginAction, initialState)

  return (
    <main className="flex min-h-screen items-center justify-center bg-white p-6 text-zinc-900">
      <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
        
        {/* LOGO CENTER */}
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
              className="w-full rounded-2xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
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
              className="w-full rounded-2xl border border-zinc-300 px-4 py-3 outline-none focus:border-zinc-500"
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
            {pending ? 'Přihlašuji...' : 'Přihlásit se'}
          </button>
        </form>
      </div>
    </main>
  )
}
