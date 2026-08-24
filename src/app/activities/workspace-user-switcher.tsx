'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LoaderCircle, UserRound } from 'lucide-react'
import type { ActivityWorkspaceUser } from '@/lib/activities/workspace-types'

export function WorkspaceUserSwitcher({
  users,
  selectedUserId,
}: {
  users: ActivityWorkspaceUser[]
  selectedUserId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(selectedUserId)

  useEffect(() => {
    setValue(selectedUserId)
  }, [selectedUserId])

  function changeUser(nextUserId: string) {
    setValue(nextUserId)
    const query = new URLSearchParams(window.location.search)
    query.set('user', nextUserId)
    query.delete('page')
    query.delete('offerStatus')

    startTransition(() => {
      router.replace(`/activities?${query.toString()}`, { scroll: false })
    })
  }

  return (
    <label className="activities-workspace__user-switcher relative inline-flex min-w-0 items-center">
      <span className="sr-only">Zobrazit pracovní přehled uživatele</span>
      <UserRound aria-hidden size={14} className="pointer-events-none absolute left-3 z-10 text-[var(--accent)]" />
      <select
        aria-label="Zobrazit pracovní přehled uživatele"
        value={value}
        disabled={isPending}
        onChange={(event) => changeUser(event.target.value)}
        className="h-9 min-w-[170px] appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] py-0 pl-9 pr-9 text-xs font-semibold text-[var(--text-primary)] outline-none transition focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/60 disabled:cursor-wait disabled:opacity-70 sm:min-w-[190px] xl:min-w-[96px] 2xl:min-w-[190px]"
      >
        {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
      </select>
      {isPending
        ? <LoaderCircle aria-hidden size={14} className="pointer-events-none absolute right-3 animate-spin text-[var(--accent)]" />
        : <ChevronDown aria-hidden size={14} className="pointer-events-none absolute right-3 text-[var(--text-secondary)]" />}
    </label>
  )
}
