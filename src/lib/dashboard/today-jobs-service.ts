import 'server-only'

import { createClient } from '@/lib/supabase/server'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type ProfilePermissionRow = {
  role: string | null
  can_view_jobs: boolean | null
}

function getPragueTodayDateOnly() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '')
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '')
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '')
  const noonUtcCarrier = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))

  return `${noonUtcCarrier.getUTCFullYear()}-${String(noonUtcCarrier.getUTCMonth() + 1).padStart(2, '0')}-${String(noonUtcCarrier.getUTCDate()).padStart(2, '0')}`
}

async function requireJobsAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { supabase, user: null, error: 'Uživatel není přihlášen.' }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_jobs')
    .eq('id', user.id)
    .maybeSingle<ProfilePermissionRow>()

  if (profileError) return { supabase, user: null, error: 'Nepodařilo se načíst oprávnění.' }

  if (profile?.role !== 'admin' && !profile?.can_view_jobs) {
    return { supabase, user: null, error: 'Nemáš oprávnění k zakázkám.' }
  }

  return { supabase, user, error: null }
}

export async function getTodayJobsForDashboard() {
  try {
    const { supabase, user, error: accessError } = await requireJobsAccess()
    if (!user) return { success: false, error: accessError, items: [] }

    const todayDateOnly = getPragueTodayDateOnly()
    const { data, error } = await supabase
      .from('jobs')
      .select('id, job_number, company_name, site_address, start_at, end_at, technician_name, generator_name')
      .lte('start_at', `${todayDateOnly}T23:59:59`)
      .gte('end_at', `${todayDateOnly}T00:00:00`)
      .order('start_at', { ascending: true })
      .order('end_at', { ascending: true })

    if (error) {
      return { success: false, error: 'Nepodařilo se načíst dnešní zakázky.', items: [] }
    }

    return {
      success: true,
      error: null,
      items: (data ?? []).map((item) => ({
        id: item.id,
        jobNumber: item.job_number,
        companyName: item.company_name,
        siteAddress: item.site_address,
        startAt: item.start_at,
        endAt: item.end_at,
        technicianName: item.technician_name,
        generatorName: item.generator_name,
      })),
    }
  } catch {
    return { success: false, error: 'Nepodařilo se načíst dnešní zakázky.', items: [] }
  }
}
