'use client'

import { useEffect, useState } from 'react'

type AppErrorProps = {
  error: Error & { digest?: string }
  reset: () => void
}

function buildFallbackErrorCode(digest?: string) {
  const base = digest?.trim()
  if (base) {
    return `ERR-${base.slice(0, 8).toUpperCase()}`
  }

  const now = new Date()
  const datePart = `${String(now.getFullYear()).slice(-2)}${String(
    now.getMonth() + 1
  ).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const randomPart = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `ERR-${datePart}-${randomPart}`
}

export default function AppError({ error, reset }: AppErrorProps) {
  const [errorCode, setErrorCode] = useState(() =>
    buildFallbackErrorCode(error.digest)
  )
  const [isReporting, setIsReporting] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function report() {
      try {
        const reportPayload = {
          errorType: error.name || 'UnhandledClientError',
          message: error.message || 'Neznámá chyba',
          stack: error.stack || null,
          digest: error.digest || null,
          route: window.location.pathname,
          section: null,
          context: {
            href: window.location.href,
            userAgent: navigator.userAgent,
          },
        }

        const response = await fetch('/api/errors/report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(reportPayload),
        })

        if (!response.ok) return

        const data = (await response.json()) as {
          ok?: boolean
          errorCode?: string
        }

        if (!cancelled && data.ok && data.errorCode) {
          setErrorCode(data.errorCode)
        }
      } catch {
        // Keep the fallback code.
      } finally {
        if (!cancelled) {
          setIsReporting(false)
        }
      }
    }

    void report()

    return () => {
      cancelled = true
    }
  }, [error])

  return (
    <main className="min-h-screen bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] px-4 py-8 text-gray-900">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl items-center">
        <div className="w-full rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-8">
          <div className="space-y-4">
            <div className="inline-flex rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-red-700">
              Chyba aplikace
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                Stránku se nepodařilo načíst
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-gray-600 sm:text-base">
                V aplikaci nastala neočekávaná chyba. Pokud mi pošleš níže uvedený
                kód, dohledáme přesný stack trace a místo, kde to spadlo.
              </p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-zinc-200/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Kód chyby
                </div>
                <div className="mt-1 font-mono text-lg font-semibold text-gray-900">
                  {errorCode}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Typ chyby
                </div>
                <div className="mt-1 text-sm text-gray-900">
                  {error.name || 'UnhandledClientError'}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Detail
                </div>
                <div className="mt-1 text-sm leading-6 text-gray-700">
                  {error.message || 'Neznámá chyba'}
                </div>
              </div>

              {error.digest ? (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                    Next digest
                  </div>
                  <div className="mt-1 font-mono text-sm text-gray-700">
                    {error.digest}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
              >
                Zkusit znovu
              </button>

              <div className="inline-flex h-11 items-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)]">
                {isReporting ? 'Ukládám detaily chyby…' : 'Detaily chyby jsou uložené.'}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
