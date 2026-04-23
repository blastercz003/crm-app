'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'

type Profile = {
  name: string | null
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
} | null

type NavItem = {
  href: string
  label: string
  icon: React.ReactNode
  exact?: boolean
}

function NavIcon({ d, d2, d3 }: { d: string; d2?: string; d3?: string }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
      {d2 && <path d={d2} />}
      {d3 && <path d={d3} />}
    </svg>
  )
}

const ICONS = {
  dashboard: (
    <NavIcon
      d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"
      d2="M9 22V12h6v10"
    />
  ),
  clients: (
    <NavIcon
      d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
      d2="M9 7a4 4 0 100 8 4 4 0 000-8z"
    />
  ),
  jobs: (
    <NavIcon
      d="M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"
      d2="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"
    />
  ),
  portal: (
    <NavIcon
      d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"
      d2="M15 3h6v6"
      d3="M10 14L21 3"
    />
  ),
  tasks: (
    <NavIcon
      d="M9 11l3 3L22 4"
      d2="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
    />
  ),
  meetings: (
    <NavIcon
      d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"
    />
  ),
  calendar: (
    <NavIcon
      d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 14.414V21a1 1 0 01-.553.894l-4-2A1 1 0 018 19v-4.586L3.293 6.707A1 1 0 013 6V4z"
    />
  ),
  finance: (
    <NavIcon
      d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
      d2="M14 2v6h6M16 13H8M16 17H8M10 9H8"
    />
  ),
  settings: (
    <NavIcon
      d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"
    />
  ),
  signout: (
    <NavIcon d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
  ),
}

export function SidebarClient({ profile }: { profile: Profile }) {
  const pathname = usePathname()
  const isAdmin = profile?.role === 'admin'
  const canViewJobs = profile?.can_view_jobs
  const canViewJobsPortal = profile?.can_view_jobs_portal

  const navItems: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: ICONS.dashboard, exact: true },
    { href: '/clients', label: 'Klienti', icon: ICONS.clients },
    ...(canViewJobs ? [{ href: '/jobs', label: 'Zakázky', icon: ICONS.jobs }] : []),
    ...(canViewJobsPortal ? [{ href: '/jobs-portal', label: 'Portál zakázek', icon: ICONS.portal }] : []),
    { href: '/tasks', label: 'Úkoly', icon: ICONS.tasks },
    { href: '/meetings', label: 'Schůzky', icon: ICONS.meetings },
    { href: '/calendar', label: 'Kalendář', icon: ICONS.calendar },
    ...(isAdmin ? [{ href: '/faktury', label: 'Finance', icon: ICONS.finance }] : []),
  ]

  function isActive(item: NavItem) {
    if (item.exact) return pathname === item.href
    return pathname.startsWith(item.href)
  }

  const initials = (profile?.name ?? 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <aside className="sidebar-glass fixed left-0 top-0 h-screen w-[228px] flex flex-col z-40 select-none">
      {/* Logo */}
      <div className="flex items-center px-5 pt-6 pb-4">
        <Image
          src="/logo2.png"
          alt="B-ENERGY"
          width={130}
          height={36}
          priority
          className="h-7 w-auto"
        />
      </div>

      {/* Divider */}
      <div className="mx-5 h-px bg-gradient-to-r from-transparent via-slate-200/80 to-transparent mb-3" />

      {/* Nav */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto py-1">
        {navItems.map((item) => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
                active
                  ? 'nav-item-active text-[#2980B9]'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/55',
              ].join(' ')}
            >
              <span
                className={[
                  'shrink-0 transition-colors duration-150',
                  active ? 'text-[#2980B9]' : 'text-slate-400 group-hover:text-slate-600',
                ].join(' ')}
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Bottom section */}
      <div className="px-3 pb-2 space-y-0.5">
        <div className="mx-2 h-px bg-gradient-to-r from-transparent via-slate-200/80 to-transparent mb-2" />

        <Link
          href="/settings/password"
          className={[
            'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150',
            pathname.startsWith('/settings')
              ? 'nav-item-active text-[#2980B9]'
              : 'text-slate-500 hover:text-slate-800 hover:bg-white/55',
          ].join(' ')}
        >
          <span
            className={[
              'shrink-0 transition-colors duration-150',
              pathname.startsWith('/settings')
                ? 'text-[#2980B9]'
                : 'text-slate-400 group-hover:text-slate-600',
            ].join(' ')}
          >
            {ICONS.settings}
          </span>
          <span>Nastavení</span>
        </Link>
      </div>

      {/* User card */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 bg-white/45 border border-white/60 shadow-sm">
          <div className="h-8 w-8 rounded-full bg-[#2980B9]/15 border border-[#2980B9]/20 flex items-center justify-center text-[#2980B9] text-xs font-bold shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-800 truncate leading-tight">
              {profile?.name ?? 'Uživatel'}
            </div>
            <div className="text-[10px] text-slate-400 capitalize leading-tight mt-0.5">
              {profile?.role ?? 'user'}
            </div>
          </div>
          <form action="/auth/signout" method="post" className="shrink-0">
            <button
              type="submit"
              title="Odhlásit se"
              className="text-slate-300 hover:text-slate-600 transition-colors duration-150 p-0.5"
            >
              {ICONS.signout}
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
