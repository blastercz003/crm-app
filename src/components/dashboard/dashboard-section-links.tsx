'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo } from 'react'
import { DashboardHandoverProtocolUploadLauncher } from '@/components/dashboard/dashboard-handover-protocol-upload-launcher'

type SectionLink = {
  key: string
  href: string
  label: string
  visible: boolean
  icon: React.ReactNode
  badgeCount?: number
  alertBadge?: boolean
}

function IconClients() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/clients-icon-v2.png"
        alt="Klienti"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconJobs() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/jobs-icon-v2.png"
        alt="Zakázky"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconPortal() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/jobs-icon-v2.png"
        alt="Portál zakázek"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconOffers() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/offers-icon-v2.png"
        alt="Nabídky"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconFinance() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/finance-icon-v2.png"
        alt="Finance"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconCommission() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/provize-icon.png"
        alt="Provize"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconFiles() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/files-icon-v2.png"
        alt="Soubory"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconConnectionPoints() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/connection-points-icon-v2.png"
        alt="Přípojné body"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconAssets() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/majetek-house-icon.png"
        alt="Majetek"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconVehicleLogbook() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/vehicle-logbook-icon.png"
        alt="Knihy jízd"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconStores() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/stores-icon-v2.png"
        alt="Prodejny"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

function IconWeatherAlerts() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-10 w-10"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path
        d="M8.2 21.1h14.1a5.1 5.1 0 0 0 .2-10.2 7.8 7.8 0 0 0-14.8 2.4A4 4 0 0 0 8.2 21.1Z"
        strokeWidth="1.7"
      />
      <path d="m15.9 18.3-2.2 5h3l-1.1 4.2 4.2-6h-3l1.5-3.2" strokeWidth="1.9" />
      <path d="M4.4 8.1h4.2M3.1 12h3.4" strokeWidth="1.5" />
    </svg>
  )
}

function IconPowerOutages() {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-10 w-10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 4.2 8.5 27.8M16 4.2l7.5 23.6" />
      <path d="M10.4 21.7h11.2M12.2 15.9h7.6M8.1 10.2h15.8" />
      <path d="m11.2 10.2-4 4.1M20.8 10.2l4 4.1" />
      <path d="M5.1 18.2h4.5M22.4 18.2h4.5" />
    </svg>
  )
}

function IconBSafe24() {
  return (
    <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="0">
      <text
        x="12"
        y="7.2"
        textAnchor="middle"
        fontSize="3.4"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="0.16em"
      >
        B-SAFE
      </text>
      <text
        x="12"
        y="20.2"
        textAnchor="middle"
        fontSize="12.8"
        fontWeight="800"
        fill="currentColor"
        letterSpacing="-0.04em"
      >
        24
      </text>
    </svg>
  )
}

function IconNordFjella() {
  return (
    <div className="relative h-11 w-11 overflow-hidden">
      <Image
        src="/nord-fjella-logo-dark.png"
        alt="Nord Fjella"
        fill
        sizes="44px"
        className="object-contain"
        priority={false}
      />
    </div>
  )
}

export function DashboardSectionLinks({
  canViewJobs,
  canViewJobsPortal,
  canViewOffers,
  canViewConnectionPoints,
  canViewStores,
  canViewBSafe24,
  canViewNordFjella,
  canViewProvize,
  canViewFiles,
  canViewWeatherAlerts,
  canViewPowerOutages,
  hasActiveWeatherAlert = false,
  canViewHandoverProtocolUpload = false,
  showClients = true,
  isAdmin,
  offersOrderedCount,
}: {
  canViewJobs: boolean
  canViewJobsPortal: boolean
  canViewOffers: boolean
  canViewConnectionPoints: boolean
  canViewStores: boolean
  canViewBSafe24: boolean
  canViewNordFjella: boolean
  canViewProvize: boolean
  canViewFiles: boolean
  canViewWeatherAlerts: boolean
  canViewPowerOutages: boolean
  hasActiveWeatherAlert?: boolean
  canViewHandoverProtocolUpload?: boolean
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
        icon: <IconConnectionPoints />,
      },
      {
        key: 'stores',
        href: '/prodejny',
        label: 'Prodejny',
        visible: canViewStores,
        icon: <IconStores />,
      },
      {
        key: 'weather-alerts',
        href: '/weather-alerts',
        label: 'POČASÍ ČHMÚ',
        visible: canViewWeatherAlerts,
        icon: <IconWeatherAlerts />,
        alertBadge: hasActiveWeatherAlert,
      },
      {
        key: 'power-outages',
        href: '/power-outages',
        label: 'ODSTÁVKY',
        visible: canViewPowerOutages,
        icon: <IconPowerOutages />,
      },
      {
        key: 'bsafe24',
        href: '/bsafe24',
        label: 'B-SAFE 24',
        visible: canViewBSafe24,
        icon: <IconBSafe24 />,
      },
      {
        key: 'nord-fjella',
        href: '/nord-fjella',
        label: 'Nord Fjella',
        visible: canViewNordFjella,
        icon: <IconNordFjella />,
      },
      {
        key: 'provize',
        href: '/provize',
        label: 'Provize',
        visible: canViewProvize,
        icon: <IconCommission />,
      },
      {
        key: 'assets',
        href: '/majetek',
        label: 'Majetek',
        visible: isAdmin,
        icon: <IconAssets />,
      },
      {
        key: 'vehicle-logbook',
        href: '/knihy-jizd',
        label: 'Knihy jízd',
        visible: isAdmin,
        icon: <IconVehicleLogbook />,
      },
      { key: 'finance', href: '/faktury', label: 'Finance', visible: isAdmin, icon: <IconFinance /> },
      { key: 'files', href: '/soubory', label: 'Soubory', visible: canViewFiles, icon: <IconFiles /> },
    ].filter((item) => item.visible),
    [
      canViewJobs,
      canViewJobsPortal,
      canViewOffers,
      canViewConnectionPoints,
      canViewStores,
      canViewBSafe24,
      canViewNordFjella,
      canViewProvize,
      canViewFiles,
      canViewWeatherAlerts,
      canViewPowerOutages,
      hasActiveWeatherAlert,
      showClients,
      isAdmin,
      offersOrderedCount,
    ]
  )

  return (
    <section className="px-1 py-1 sm:px-2">
      <div className="grid grid-cols-3 gap-3 lg:mx-auto lg:max-w-[1160px] lg:grid-cols-7 lg:gap-x-3 lg:gap-y-7">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="dashboard-section-link group relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-2.5 overflow-visible rounded-2xl px-2 py-3 text-center text-[#0b1d2c] transition lg:w-full"
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
              {item.alertBadge ? (
                <span
                  aria-label="Aktivní výstraha"
                  className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-amber-500 bg-yellow-400 px-1.5 text-[13px] font-black leading-none text-amber-950 shadow-[0_4px_12px_rgba(234,179,8,0.38)]"
                >
                  !
                </span>
              ) : null}
            </span>
            <span className="dashboard-section-link__label truncate text-[13px] font-semibold uppercase tracking-[0.01em] leading-tight lg:text-[15px]">
              {item.label}
            </span>
          </Link>
        ))}

        {canViewHandoverProtocolUpload ? (
          <DashboardHandoverProtocolUploadLauncher />
        ) : null}
      </div>
    </section>
  )
}
