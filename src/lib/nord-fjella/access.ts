import type { AppRole } from '@/lib/auth/access'

export type NordFjellaAccessFlags = {
  can_view_nord_fjella: boolean | null
}

export function canViewNordFjellaSection(
  role: AppRole,
  flags?: Partial<NordFjellaAccessFlags> | null,
) {
  return role === 'admin' || Boolean(flags?.can_view_nord_fjella)
}
