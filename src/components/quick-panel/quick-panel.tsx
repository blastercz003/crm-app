'use client'

import Image from 'next/image'
import Link from 'next/link'
import { House, LayoutGrid, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  getAvailableQuickPanelSections,
  normalizeQuickPanelSections,
  QUICK_PANEL_PREFERENCES_CHANGED_EVENT,
  type QuickPanelProfileAccess,
  type QuickPanelSection,
} from '@/lib/quick-panel/sections'
import styles from './quick-panel.module.css'

type QuickPanelProfileRow = QuickPanelProfileAccess & {
  quick_panel_enabled: boolean | null
  quick_panel_sections: string[] | null
}

function isExcludedRoute(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/dashboard' ||
    pathname === '/login' ||
    pathname === '/settings/password' ||
    pathname === '/snake' ||
    pathname.startsWith('/snake/') ||
    /^\/jobs\/[^/]+\/pp$/.test(pathname)
  )
}

function hasOpenModal() {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
}

export function QuickPanel() {
  const pathname = usePathname()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [profile, setProfile] = useState<QuickPanelProfileRow | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const isOpen = openPath === pathname

  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function loadProfile() {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) return

      const { data } = await supabase
        .from('profiles')
        .select('role, name, can_view_jobs, can_view_offers, can_view_tech_jobs, can_view_connection_points, can_view_stores, can_view_bsafe24, can_view_nord_fjella, can_view_provize, can_view_job_attachments, majetek, quick_panel_enabled, quick_panel_sections')
        .eq('id', user.id)
        .maybeSingle<QuickPanelProfileRow>()

      if (!cancelled && data) {
        setProfile({
          ...data,
          quick_panel_enabled: Boolean(data.quick_panel_enabled),
          quick_panel_sections: normalizeQuickPanelSections(data.quick_panel_sections),
        })
      }
    }

    void loadProfile()
    window.addEventListener(QUICK_PANEL_PREFERENCES_CHANGED_EVENT, loadProfile)

    return () => {
      cancelled = true
      window.removeEventListener(QUICK_PANEL_PREFERENCES_CHANGED_EVENT, loadProfile)
    }
  }, [])

  useEffect(() => {
    function syncModalState() {
      const nextModalState = hasOpenModal()
      setIsModalOpen(nextModalState)
      if (nextModalState) setOpenPath(null)
    }

    syncModalState()

    const observer = new MutationObserver(syncModalState)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-modal', 'role'] })

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenPath(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenPath(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const sections = useMemo(() => {
    if (!profile || !profile.quick_panel_enabled) return []

    const availableById = new Map(
      getAvailableQuickPanelSections(profile).map((section) => [section.id, section]),
    )

    return normalizeQuickPanelSections(profile.quick_panel_sections)
      .map((sectionId) => availableById.get(sectionId))
      .filter((section): section is QuickPanelSection => Boolean(section))
  }, [profile])

  if (isExcludedRoute(pathname) || isModalOpen || sections.length === 0) return null

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${isOpen ? styles.rootOpen : ''}`}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-label="Otevřít rychlou navigaci"
        aria-expanded={isOpen}
        onClick={() => setOpenPath(pathname)}
      >
        <LayoutGrid className={styles.triggerIcon} strokeWidth={2.1} />
      </button>

      <aside className={styles.panel} aria-label="Rychlá navigace">
        {sections.map((section, index) => (
          <Link
            key={section.id}
            href={section.href}
            className={styles.sectionButton}
            style={{ transitionDelay: isOpen ? `${70 + index * 45}ms` : '0ms' }}
            onClick={() => setOpenPath(null)}
          >
            <span className={styles.sectionIcon}>
              <Image
                src={section.iconSrc}
                alt=""
                fill
                sizes="31px"
                className={`object-contain ${styles.sectionImage}`}
              />
            </span>
            <span className={styles.sectionLabel}>{section.label}</span>
          </Link>
        ))}
        <div className={styles.separator} />
        <Link
          href="/dashboard"
          className={`${styles.closeButton} ${styles.dashboardButton}`}
          aria-label="Přejít na Dashboard"
          onClick={() => setOpenPath(null)}
        >
          <House size={18} strokeWidth={2.2} />
        </Link>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="Zavřít rychlou navigaci"
          onClick={() => setOpenPath(null)}
        >
          <X size={18} strokeWidth={2.2} />
        </button>
      </aside>
    </div>
  )
}
