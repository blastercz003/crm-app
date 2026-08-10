'use client'

import Image from 'next/image'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getAvailableQuickPanelSections,
  normalizeQuickPanelSections,
  QUICK_PANEL_PREFERENCES_CHANGED_EVENT,
  type QuickPanelProfileAccess,
  type QuickPanelSectionId,
} from '@/lib/quick-panel/sections'

type QuickPanelProfileRow = QuickPanelProfileAccess & {
  quick_panel_enabled: boolean | null
  quick_panel_sections: string[] | null
}

export function QuickPanelSettings() {
  const supabase = useMemo(() => createClient(), [])
  const [profile, setProfile] = useState<QuickPanelProfileRow | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) {
        if (!cancelled) {
          setError('Pro načtení nastavení je potřeba být přihlášený.')
          setIsLoading(false)
        }
        return
      }

      const { data, error: loadError } = await supabase
        .from('profiles')
        .select('role, name, can_view_jobs, can_view_offers, can_view_tech_jobs, can_view_connection_points, can_view_stores, can_view_bsafe24, can_view_nord_fjella, can_view_provize, can_view_job_attachments, majetek, quick_panel_enabled, quick_panel_sections')
        .eq('id', user.id)
        .single<QuickPanelProfileRow>()

      if (cancelled) return

      if (loadError || !data) {
        setError('Nastavení rychlého panelu se nepodařilo načíst.')
      } else {
        setProfile({
          ...data,
          quick_panel_enabled: Boolean(data.quick_panel_enabled),
          quick_panel_sections: normalizeQuickPanelSections(data.quick_panel_sections),
        })
      }

      setIsLoading(false)
    }

    void loadPreferences()

    return () => {
      cancelled = true
    }
  }, [supabase])

  const availableSections = useMemo(
    () => (profile ? getAvailableQuickPanelSections(profile) : []),
    [profile],
  )
  const selectedSections = normalizeQuickPanelSections(profile?.quick_panel_sections)
  const isEnabled = Boolean(profile?.quick_panel_enabled)

  async function save(nextEnabled: boolean, nextSections: QuickPanelSectionId[]) {
    if (!profile || isSaving) return

    const previousProfile = profile
    const normalizedSections = normalizeQuickPanelSections(nextSections)
    setProfile({
      ...profile,
      quick_panel_enabled: nextEnabled,
      quick_panel_sections: normalizedSections,
    })
    setError('')
    setIsSaving(true)

    const { error: saveError } = await supabase
      .from('profiles')
      .update({
        quick_panel_enabled: nextEnabled,
        quick_panel_sections: normalizedSections,
      })
      .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')

    if (saveError) {
      setProfile(previousProfile)
      setError('Nastavení rychlého panelu se nepodařilo uložit.')
    } else {
      window.dispatchEvent(new Event(QUICK_PANEL_PREFERENCES_CHANGED_EVENT))
    }

    setIsSaving(false)
  }

  function toggleSection(sectionId: QuickPanelSectionId) {
    if (isSaving) return

    const isSelected = selectedSections.includes(sectionId)
    const nextSections = isSelected
      ? selectedSections.filter((item) => item !== sectionId)
      : [...selectedSections, sectionId]

    if (!isSelected && selectedSections.length >= 4) {
      setError('Do rychlého panelu lze připnout maximálně 4 sekce.')
      return
    }

    void save(isEnabled, nextSections)
  }

  return (
    <section className="password-page__panel flex h-full max-h-[34rem] flex-col overflow-hidden rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5 xl:h-[34rem]">
      <div className="password-page__eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        Rychlá navigace
      </div>

      {isLoading ? (
        <p className="password-page__text mt-3 text-sm text-zinc-500">Načítám nastavení panelu…</p>
      ) : !profile ? (
        <p className="password-page__message password-page__message--error mt-3 rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-sm font-medium text-red-700">
          {error || 'Nastavení není dostupné.'}
        </p>
      ) : (
        <div className="mt-3 flex-1 space-y-4 overflow-y-auto pr-1">
          <p className="password-page__text text-sm text-zinc-500">
            Na desktopu si můžeš připnout až čtyři sekce, mezi kterými se chceš rychle přepínat.
          </p>

          <div className="password-page__widget-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="password-page__widget-title text-sm font-semibold text-zinc-900">
                  Zobrazit rychlý panel
                </div>
                <p className="password-page__widget-subtitle mt-1 text-xs text-zinc-500">
                  Plovoucí navigace na pravém okraji pracovních stránek.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="password-page__toggle-state text-xs font-semibold text-zinc-600">
                  {isEnabled ? 'Aktivní' : 'Neaktivní'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Rychlý panel ${isEnabled ? 'vypnout' : 'zapnout'}`}
                  onClick={() => void save(!isEnabled, selectedSections)}
                  disabled={isSaving}
                  className={`password-page__toggle relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
                    isEnabled
                      ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
                      : 'border-zinc-300 bg-zinc-200/90'
                  }`}
                >
                  <span
                    className={`password-page__toggle-thumb inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                      isEnabled ? 'translate-x-[24px]' : 'translate-x-[2px]'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <div className="password-page__widget-title text-sm font-semibold text-zinc-900">
                Připnuté sekce
              </div>
              <span className="password-page__toggle-state text-xs font-semibold text-zinc-600">
                {selectedSections.length}/4
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableSections.map((section) => {
                const isSelected = selectedSections.includes(section.id)
                const isLimitReached = !isSelected && selectedSections.length >= 4

                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={isSaving || isLimitReached}
                    onClick={() => toggleSection(section.id)}
                    className={`password-page__quick-panel-option flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border px-2 py-3 text-center transition duration-200 disabled:cursor-not-allowed disabled:opacity-45 ${
                      isSelected
                        ? 'border-[#5f9dca] bg-[linear-gradient(160deg,rgba(95,164,211,0.18)_0%,rgba(63,132,187,0.14)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_8px_18px_rgba(41,128,185,0.12)]'
                        : 'border-white/75 bg-white/72 hover:-translate-y-[1px] hover:border-[#9dc7e5] hover:bg-white'
                    }`}
                  >
                    <span className="relative flex h-8 w-8 items-center justify-center">
                      <Image src={section.iconSrc} alt="" fill sizes="32px" className="object-contain" />
                    </span>
                    <span className="password-page__quick-panel-option-label text-xs font-semibold leading-tight text-zinc-700">
                      {section.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {error ? (
            <p className="password-page__message password-page__message--error rounded-2xl border border-red-200/80 bg-red-50/80 px-3 py-2.5 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}
