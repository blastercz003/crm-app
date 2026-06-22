'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { CarFront, Plug } from 'lucide-react'

type SectionLink = {
  key: string
  href: string
  label: string
  visible: boolean
  icon: React.ReactNode
  badgeCount?: number
}

function IconClients() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" />
      <circle cx="9.5" cy="7" r="3.2" />
      <path d="M22 19v-1a4 4 0 0 0-3-3.85" />
      <path d="M16 3.2a3.2 3.2 0 0 1 0 6.2" />
    </svg>
  )
}

function IconJobs() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="6" width="18" height="14" rx="2.4" />
      <path d="M9 6V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V6" />
      <path d="M3 11h18" />
    </svg>
  )
}

function IconPortal() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="8" height="8" rx="1.8" />
      <rect x="13" y="3" width="8" height="8" rx="1.8" />
      <rect x="3" y="13" width="8" height="8" rx="1.8" />
      <path d="M13 17h8" />
      <path d="M17 13v8" />
    </svg>
  )
}

function IconOffers() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M8 3h7l4 4v13a1 1 0 0 1-1 1H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
      <path d="M15 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </svg>
  )
}

function IconFinance() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2.4" />
      <path d="M3 10h18" />
      <circle cx="8" cy="14.5" r="1.2" />
      <path d="M12 14.5h6" />
    </svg>
  )
}

function IconFiles() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5Z" />
    </svg>
  )
}

function IconAssets() {
  return <CarFront className="h-6 w-6" strokeWidth={1.85} />
}

export function DashboardSectionLinks({
  canViewJobs,
  canViewJobsPortal,
  canViewOffers,
  canViewConnectionPoints,
  canViewFiles,
  showClients = true,
  isAdmin,
  offersOrderedCount,
}: {
  canViewJobs: boolean
  canViewJobsPortal: boolean
  canViewOffers: boolean
  canViewConnectionPoints: boolean
  canViewFiles: boolean
  showClients?: boolean
  isAdmin: boolean
  offersOrderedCount: number
}) {
  const items = useMemo<SectionLink[]>(
    () => [
      {
        key: 'clients',
        href: '/clients',
        label: 'Klienti',
        visible: showClients,
        icon: <IconClients />,
      },
      { key: 'jobs', href: '/jobs', label: 'Zakázky', visible: canViewJobs, icon: <IconJobs /> },
      { key: 'jobs-portal', href: '/jobs-portal', label: 'Portál zakázek', visible: canViewJobsPortal, icon: <IconPortal /> },
      {
        key: 'offers',
        href: '/offers',
        label: 'Nabídky',
        visible: canViewOffers,
        icon: <IconOffers />,
        badgeCount: isAdmin ? offersOrderedCount : 0,
      },
      {
        key: 'connection-points',
        href: '/pripojne-body',
        label: 'Přípojné body',
        visible: canViewConnectionPoints,
        icon: <Plug className="h-6 w-6" strokeWidth={1.9} />,
      },
      {
        key: 'assets',
        href: '/majetek',
        label: 'Majetek',
        visible: isAdmin,
        icon: <IconAssets />,
      },
      { key: 'finance', href: '/faktury', label: 'Finance', visible: isAdmin, icon: <IconFinance /> },
      { key: 'files', href: '/soubory', label: 'Soubory', visible: canViewFiles, icon: <IconFiles /> },
    ].filter((item) => item.visible),
    [
      canViewJobs,
      canViewJobsPortal,
      canViewOffers,
      canViewConnectionPoints,
      canViewFiles,
      showClients,
      isAdmin,
      offersOrderedCount,
    ]
  )

  return (
    <section className="px-1 py-1 sm:px-2">
      <div className="grid grid-cols-3 gap-3 lg:flex lg:justify-center lg:gap-7">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="dashboard-section-link group relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-2.5 overflow-visible rounded-2xl px-2 py-3 text-center text-[#0b1d2c] transition lg:w-[170px]"
          >
            <span
              className="dashboard-section-link__icon relative inline-flex h-[74px] w-[74px] items-center justify-center rounded-[18px] border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.35),0_10px_22px_rgba(9,48,82,0.28)] backdrop-blur-xl transition-all duration-200 ease-out lg:h-[82px] lg:w-[82px] lg:group-hover:-translate-y-[2px]"
            >
              {item.icon}
              {item.badgeCount && item.badgeCount > 0 ? (
                <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-red-600 bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
                  {item.badgeCount > 99 ? '99+' : item.badgeCount}
                </span>
              ) : null}
            </span>
            <span className="dashboard-section-link__label truncate text-[13px] font-semibold uppercase tracking-[0.01em] leading-tight lg:text-[15px]">
              {item.label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
