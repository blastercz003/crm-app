'use client'

import { useEffect, useMemo, useState } from 'react'

type StoresAccessProfile = {
  id: string
  name: string
  role: string | null
  can_view_stores: boolean
}

type StoresAccessPanelProps = {
  isAdmin: boolean
}

export function StoresAccessPanel({ isAdmin }: StoresAccessPanelProps) {
  const [profiles, setProfiles] = useState<StoresAccessProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingUserId, setSavingUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function loadProfiles() {
      setIsLoading(true)
      setError('')

      try {
        const response = await fetch('/settings/password/stores-access', {
          cache: 'no-store',
        })

        const payload = (await response.json().catch(() => null)) as
          | { error?: string; profiles?: StoresAccessProfile[] }
          | null

        if (!response.ok) {
          throw new Error(payload?.error || 'Nepodařilo se načíst přístupy.')
        }

        if (!cancelled) {
          setProfiles(payload?.profiles ?? [])
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(
            fetchError instanceof Error
              ? fetchError.message
              : 'Nepodařilo se načíst přístupy.'
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadProfiles()

    return () => {
      cancelled = true
    }
  }, [isAdmin])

  const enabledCount = useMemo(
    () => profiles.filter((profile) => profile.can_view_stores).length,
    [profiles]
  )

  async function toggleAccess(profile: StoresAccessProfile) {
    const nextValue = !profile.can_view_stores

    setSavingUserId(profile.id)
    setError('')
    setProfiles((currentProfiles) =>
      currentProfiles.map((item) =>
        item.id === profile.id
          ? { ...item, can_view_stores: nextValue }
          : item
      )
    )

    try {
      const response = await fetch('/settings/password/stores-access', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: profile.id,
          canViewStores: nextValue,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error || 'Nepodařilo se uložit přístup.')
      }
    } catch (saveError) {
      setProfiles((currentProfiles) =>
        currentProfiles.map((item) =>
          item.id === profile.id
            ? { ...item, can_view_stores: profile.can_view_stores }
            : item
        )
      )
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Nepodařilo se uložit přístup.'
      )
    } finally {
      setSavingUserId(null)
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <section className="password-page__panel h-full rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5">
      <div className="password-page__eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        Prodejny
      </div>

      <div className="mt-3 space-y-4">
        <p className="text-sm text-zinc-500">
          Admin zde nastavuje, kdo uvidí ikonu `Prodejny` na Dashboardu a kdo smí
          otevřít sekci s kontakty na prodejny.
        </p>

        <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
          <div className="text-sm text-zinc-600">
            Aktivní přístup:{' '}
            <span className="font-semibold text-zinc-900">{enabledCount}</span>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-6 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
            Načítám uživatele...
          </div>
        ) : (
          <div className="space-y-3">
            {profiles.map((profile) => {
              const isSaving = savingUserId === profile.id

              return (
                <div
                  key={profile.id}
                  className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {profile.name}
                      </div>
                      <div className="mt-1 text-xs uppercase tracking-[0.12em] text-zinc-400">
                        {profile.role || 'Bez role'}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-zinc-600">
                        {profile.can_view_stores ? 'Aktivní' : 'Neaktivní'}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={profile.can_view_stores}
                        disabled={isSaving}
                        onClick={() => void toggleAccess(profile)}
                        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                          profile.can_view_stores
                            ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
                            : 'border-zinc-300 bg-zinc-200/90'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                            profile.can_view_stores
                              ? 'translate-x-[24px]'
                              : 'translate-x-[2px]'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
