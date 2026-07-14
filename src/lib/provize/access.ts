import type { AppRole } from '@/lib/auth/access'

export const PROVIZE_SALES_OWNERS = ['MICHAL', 'LÍDA'] as const

export type ProvizeSalesOwner = (typeof PROVIZE_SALES_OWNERS)[number]

export type ProvizeAccessFlags = {
  can_view_provize: boolean | null
  name: string | null
}

export function isProvizeSalesOwner(value: string | null | undefined): value is ProvizeSalesOwner {
  return PROVIZE_SALES_OWNERS.includes(String(value ?? '').trim().toUpperCase() as ProvizeSalesOwner)
}

export function resolveProvizeSalesOwnerName(name: string | null | undefined) {
  const normalized = String(name ?? '').trim().toUpperCase()
  return isProvizeSalesOwner(normalized) ? normalized : null
}

export function canViewProvizeSection(
  role: AppRole,
  flags?: Partial<ProvizeAccessFlags> | null,
) {
  return role === 'admin' || Boolean(flags?.can_view_provize)
}
