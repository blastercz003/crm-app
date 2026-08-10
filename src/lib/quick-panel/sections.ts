import {
  canViewConnectionPointsSection,
  canViewTechJobsSection,
  isAdminRole,
  type AppRole,
} from '@/lib/auth/access'
import { canViewFilesSection } from '@/lib/files/access'
import { canViewAssetsSection } from '@/lib/majetek/access'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import { canViewProvizeSection } from '@/lib/provize/access'

export const QUICK_PANEL_SECTION_IDS = [
  'clients',
  'jobs',
  'offers',
  'tech_jobs',
  'connection_points',
  'stores',
  'bsafe24',
  'nord_fjella',
  'provize',
  'assets',
  'vehicle_logbook',
  'finances',
  'files',
  'tasks',
  'meetings',
  'calendar',
] as const

export const QUICK_PANEL_PREFERENCES_CHANGED_EVENT = 'quick-panel-preferences-changed'

export type QuickPanelSectionId = (typeof QUICK_PANEL_SECTION_IDS)[number]

export type QuickPanelProfileAccess = {
  role: AppRole
  name?: string | null
  can_view_jobs?: boolean | null
  can_view_offers?: boolean | null
  can_view_tech_jobs?: boolean | null
  can_view_connection_points?: boolean | null
  can_view_stores?: boolean | null
  can_view_bsafe24?: boolean | null
  can_view_nord_fjella?: boolean | null
  can_view_provize?: boolean | null
  can_view_job_attachments?: boolean | null
  majetek?: boolean | null
}

export type QuickPanelSection = {
  id: QuickPanelSectionId
  label: string
  href: string
  iconSrc: string
  canAccess: (profile: QuickPanelProfileAccess) => boolean
}

function isBSafe24SalesOwner(name: string | null | undefined) {
  const normalizedName = String(name ?? '').trim().toUpperCase()
  return normalizedName === 'MICHAL' || normalizedName === 'LÍDA'
}

export const QUICK_PANEL_SECTIONS: readonly QuickPanelSection[] = [
  {
    id: 'clients',
    label: 'Klienti',
    href: '/clients',
    iconSrc: '/clients-icon-v2.png',
    canAccess: () => true,
  },
  {
    id: 'jobs',
    label: 'Zakázky',
    href: '/jobs',
    iconSrc: '/jobs-icon-v2.png',
    canAccess: (profile) => isAdminRole(profile.role) || Boolean(profile.can_view_jobs),
  },
  {
    id: 'offers',
    label: 'Nabídky',
    href: '/offers',
    iconSrc: '/offers-icon-v2.png',
    canAccess: (profile) => isAdminRole(profile.role) || Boolean(profile.can_view_offers),
  },
  {
    id: 'tech_jobs',
    label: 'Zakázky techniků',
    href: '/zakazky-techniku',
    iconSrc: '/jobs-icon-v2.png',
    canAccess: (profile) => canViewTechJobsSection(profile.role, profile),
  },
  {
    id: 'connection_points',
    label: 'Přípojné body',
    href: '/pripojne-body',
    iconSrc: '/connection-points-icon-v2.png',
    canAccess: (profile) => canViewConnectionPointsSection(profile.role, profile),
  },
  {
    id: 'stores',
    label: 'Prodejny',
    href: '/prodejny',
    iconSrc: '/stores-icon-v2.png',
    canAccess: (profile) => isAdminRole(profile.role) || Boolean(profile.can_view_stores),
  },
  {
    id: 'bsafe24',
    label: 'B-SAFE 24',
    href: '/bsafe24',
    iconSrc: '/bsafe24-logo-light.png',
    canAccess: (profile) =>
      isAdminRole(profile.role) ||
      (Boolean(profile.can_view_bsafe24) && isBSafe24SalesOwner(profile.name)),
  },
  {
    id: 'nord_fjella',
    label: 'Nord Fjella',
    href: '/nord-fjella',
    iconSrc: '/nord-fjella-logo-light.png',
    canAccess: (profile) => canViewNordFjellaSection(profile.role, profile),
  },
  {
    id: 'provize',
    label: 'Provize',
    href: '/provize',
    iconSrc: '/provize-icon.png',
    canAccess: (profile) => canViewProvizeSection(profile.role, profile),
  },
  {
    id: 'assets',
    label: 'Majetek',
    href: '/majetek',
    iconSrc: '/majetek-icon.png',
    canAccess: (profile) => canViewAssetsSection(profile.role, profile),
  },
  {
    id: 'vehicle_logbook',
    label: 'Knihy jízd',
    href: '/knihy-jizd',
    iconSrc: '/vehicle-logbook-icon.png',
    canAccess: (profile) => isAdminRole(profile.role),
  },
  {
    id: 'finances',
    label: 'Finance',
    href: '/faktury',
    iconSrc: '/finance-icon-v2.png',
    canAccess: (profile) => isAdminRole(profile.role),
  },
  {
    id: 'files',
    label: 'Soubory',
    href: '/soubory',
    iconSrc: '/files-icon-v2.png',
    canAccess: (profile) => canViewFilesSection(profile.role, profile),
  },
  {
    id: 'tasks',
    label: 'Úkoly',
    href: '/tasks',
    iconSrc: '/received-invoices-icon.png',
    canAccess: () => true,
  },
  {
    id: 'meetings',
    label: 'Schůzky',
    href: '/meetings',
    iconSrc: '/received-invoices-icon.png',
    canAccess: () => true,
  },
  {
    id: 'calendar',
    label: 'Kalendář',
    href: '/calendar',
    iconSrc: '/received-invoices-icon.png',
    canAccess: () => true,
  },
]

export function isQuickPanelSectionId(value: string): value is QuickPanelSectionId {
  return QUICK_PANEL_SECTION_IDS.includes(value as QuickPanelSectionId)
}

export function getAvailableQuickPanelSections(profile: QuickPanelProfileAccess) {
  return QUICK_PANEL_SECTIONS.filter((section) => section.canAccess(profile))
}

export function normalizeQuickPanelSections(value: unknown) {
  if (!Array.isArray(value)) return []

  const seen = new Set<QuickPanelSectionId>()

  return value.reduce<QuickPanelSectionId[]>((sections, item) => {
    if (typeof item !== 'string' || !isQuickPanelSectionId(item) || seen.has(item)) {
      return sections
    }

    seen.add(item)
    sections.push(item)
    return sections
  }, []).slice(0, 4)
}
