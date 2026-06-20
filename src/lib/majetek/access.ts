import { isAdminRole, type AppRole } from '@/lib/auth/access'

export type AssetAccessFlags = {
  majetek: boolean | null
}

export function canViewAssetsSection(
  role: AppRole,
  flags?: Partial<AssetAccessFlags> | null,
) {
  return isAdminRole(role) && Boolean(flags?.majetek)
}
