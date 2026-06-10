export type AppRole = 'admin' | 'TECHNIK' | 'member' | string | null

export type TechnicalAccessFlags = {
  can_view_tech_jobs: boolean | null
  can_view_connection_points: boolean | null
  can_view_handover_protocol_upload: boolean | null
  can_view_all_technician_handover_uploads: boolean | null
}

export function isAdminRole(role: AppRole) {
  return role === 'admin'
}

export function isTechnikRole(role: AppRole) {
  return role === 'TECHNIK'
}

export function canViewTechJobsSection(
  role: AppRole,
  flags?: Partial<TechnicalAccessFlags> | null,
) {
  return isAdminRole(role) || isTechnikRole(role) || Boolean(flags?.can_view_tech_jobs)
}

export function canViewConnectionPointsSection(
  role: AppRole,
  flags?: Partial<TechnicalAccessFlags> | null,
) {
  return isAdminRole(role) || isTechnikRole(role) || Boolean(flags?.can_view_connection_points)
}

export function canViewHandoverProtocolUploadSection(
  role: AppRole,
  flags?: Partial<TechnicalAccessFlags> | null,
) {
  return isTechnikRole(role) || Boolean(flags?.can_view_handover_protocol_upload)
}
