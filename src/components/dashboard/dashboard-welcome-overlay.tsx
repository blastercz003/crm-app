'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markDashboardOverlaySeen } from '@/app/dashboard/actions'

type OverlaySummaryItem = {
  label: string
  value: string
  tone?: 'default' | 'highlight' | 'success' | 'warning'
}

type DashboardWelcomeOverlayProps = {
  shouldShow: boolean
  profileName: string
  newTasksCount: number
  completedDelegatedTasksCount: number
  todayMeetingsCount: number
  overdueTasksCount: number
  headline?: string
  description?: string
  summaryItems?: OverlaySummaryItem[]
  onClosed?: () => void
}

function pluralize(
  count: number,
  one: string,
  few: string,
  many: string
) {
  if (count === 1) return one
  if (count >= 2 && count <= 4) return few
  return many
}

export function DashboardWelcomeOverlay({
  shouldShow,
  profileName,
  newTasksCount,
  completedDelegatedTasksCount,
  todayMeetingsCount,
  overdueTasksCount,
  headline,
  description,
  summaryItems,
  onClosed,
}: DashboardWelcomeOverlayProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(shouldShow)
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    setIsOpen(shouldShow)
  }, [shouldShow])

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  if (!isOpen) return null

  const hasUpdates =
    newTasksCount > 0 || completedDelegatedTasksCount > 0

  const title = headline ?? (hasUpdates ? 'Máme pro Tebe novinky' : 'Vítej zpět')

  const subtitle =
    description ??
    (hasUpdates
      ? 'Na Dashboardu se objevilo něco nového, co stojí za pozornost.'
      : 'Tady je rychlý přehled dne, ať víš, co je právě důležité.')

  async function closeOverlay(targetHref?: string) {
    setErrorMessage(null)

    try {
      await markDashboardOverlaySeen()
      setIsOpen(false)
      onClosed?.()
      router.refresh()

      if (targetHref) {
        router.push(targetHref)
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Nepodařilo se uložit stav overlaye.'
      )
    }
  }

  function handleAction(targetHref?: string) {
    startTransition(() => {
      void closeOverlay(targetHref)
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/45 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-[620px] overflow-hidden rounded-[30px] border border-zinc-200 bg-white shadow-2xl">
        <button
          type="button"
          onClick={() => handleAction()}
          disabled={isPending}
          aria-label="Zavřít"
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          ×
        </button>

        <div className="border-b border-zinc-200 px-6 pb-5 pt-6 md:px-8 md:pb-6 md:pt-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Dashboard overview
          </div>
          <h2 className="mt-2 pr-12 text-2xl font-semibold tracking-tight text-zinc-950 md:text-[30px]">
            {title}
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            {profileName ? `${profileName}, ` : ''}
            {subtitle}
          </p>
        </div>

        <div className="px-6 py-6 md:px-8">
          <div className="grid gap-3">
            {summaryItems?.length ? (
              summaryItems.map((item) => {
                const toneClasses =
                  item.tone === 'highlight'
                    ? {
                        card: 'border-[#2980B9]/20 bg-[#2980B9]/5',
                        label: 'text-[#2980B9]',
                      }
                    : item.tone === 'warning'
                      ? {
                          card: 'border-amber-200 bg-amber-50',
                          label: 'text-amber-700',
                        }
                      : item.tone === 'success'
                        ? {
                            card: 'border-emerald-200 bg-emerald-50',
                            label: 'text-emerald-700',
                          }
                      : {
                          card: 'border-zinc-200 bg-zinc-50',
                          label: 'text-zinc-500',
                        }

                return (
                  <div
                    key={`${item.label}-${item.value}`}
                    className={`rounded-2xl border px-4 py-3 ${toneClasses.card}`}
                  >
                    <div
                      className={`text-xs font-semibold uppercase tracking-[0.14em] ${toneClasses.label}`}
                    >
                      {item.label}
                    </div>
                    <div className="mt-1 text-sm text-zinc-800">{item.value}</div>
                  </div>
                )
              })
            ) : (
              <>
                {newTasksCount > 0 && (
                  <div className="rounded-2xl border border-[#2980B9]/20 bg-[#2980B9]/5 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#2980B9]">
                      Nové úkoly
                    </div>
                    <div className="mt-1 text-sm text-zinc-800">
                      Byly Ti přiřazeny{' '}
                      <span className="font-semibold text-zinc-950">
                        {newTasksCount} nové{' '}
                        {pluralize(newTasksCount, 'úkol', 'úkoly', 'úkolů')}
                      </span>
                      .
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Dnešek
                  </div>
                  <div className="mt-1 text-sm text-zinc-800">
                    Dnes máš{' '}
                    <span className="font-semibold text-zinc-950">
                      {todayMeetingsCount}{' '}
                      {pluralize(
                        todayMeetingsCount,
                        'schůzku',
                        'schůzky',
                        'schůzek'
                      )}
                    </span>
                    .
                  </div>
                </div>

                <div
                  className={[
                    'rounded-2xl border px-4 py-3',
                    overdueTasksCount > 0
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-zinc-200 bg-zinc-50',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'text-xs font-semibold uppercase tracking-[0.14em]',
                      overdueTasksCount > 0 ? 'text-amber-700' : 'text-zinc-500',
                    ].join(' ')}
                  >
                    Priorita
                  </div>
                  <div className="mt-1 text-sm text-zinc-800">
                    {overdueTasksCount > 0 ? (
                      <>
                        Máš{' '}
                        <span className="font-semibold text-zinc-950">
                          {overdueTasksCount}{' '}
                          {pluralize(
                            overdueTasksCount,
                            'úkol po termínu',
                            'úkoly po termínu',
                            'úkolů po termínu'
                          )}
                        </span>
                        .
                      </>
                    ) : (
                      <>Nemáš žádné úkoly po termínu.</>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            {(newTasksCount > 0 || completedDelegatedTasksCount > 0 || overdueTasksCount > 0) && (
              <button
                onClick={() => handleAction('/tasks')}
                disabled={isPending}
                className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white"
              >
                OTEVŘÍT ÚKOLY
              </button>
            )}

            <button
              onClick={() => handleAction()}
              disabled={isPending}
              className="inline-flex min-h-[46px] items-center rounded-2xl border border-[#2980B9] bg-[#2980B9] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#2471A3] disabled:cursor-not-allowed disabled:opacity-60"
            >
              POKRAČOVAT NA DASHBOARD
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
