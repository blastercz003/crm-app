'use server'

import { getActivityRuntimeContext } from '@/lib/activities/access'
import type { ActivityWorkspaceJobDetailResult } from '@/lib/activities/workspace-types'
import { getJobPpNotRequiredSet } from '@/lib/jobs/pp-requirements'

type JobAccessProfile = {
  name: string | null
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: 'MICHAL' | 'LÍDA' | null
}

function normalizeSalesOwner(name: string | null) {
  const normalized = name?.trim().toLocaleUpperCase('cs-CZ')
  return normalized === 'JIŘÍ' || normalized === 'MICHAL' || normalized === 'LÍDA' ? normalized : null
}

export async function getWorkspaceJobDetailAction(jobId: string): Promise<ActivityWorkspaceJobDetailResult> {
  try {
    const normalizedJobId = jobId.trim()
    if (!normalizedJobId) return { success: false, error: 'Chybí ID zakázky.', job: null }

    const { supabase, profile, isAdmin } = await getActivityRuntimeContext()
    const { data: accessProfile, error: profileError } = await supabase
      .from('profiles')
      .select('name, role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
      .eq('id', profile.id)
      .single<JobAccessProfile>()

    const hasScopedPortalAccess = Boolean(
      accessProfile?.can_view_jobs_portal && accessProfile.jobs_sales_scope,
    )
    if (
      profileError
      || !accessProfile
      || (!isAdmin && !accessProfile.can_view_jobs && !hasScopedPortalAccess)
    ) {
      return { success: false, error: 'Nemáte oprávnění zobrazit tuto zakázku.', job: null }
    }

    let request = supabase
      .from('jobs')
      .select('id, job_number, client_id, offer_id, client_contact_id, company_name, contact_person, sales_owner, start_at, end_at, site_address, store_number, client_order_number, technician_name, generator_name, info_note, marny_vyjezd, pohotovost, job_status, invoice_status, evidence_status, created_at, updated_at')
      .eq('id', normalizedJobId)

    if (!isAdmin) {
      const scope = accessProfile.jobs_sales_scope ?? normalizeSalesOwner(accessProfile.name)
      if (!scope) return { success: false, error: 'Nepodařilo se určit vaše zakázky.', job: null }
      request = request.eq('sales_owner', scope)
    }

    const { data: row, error } = await request.maybeSingle()
    if (error || !row) return { success: false, error: 'Zakázka nebyla nalezena.', job: null }

    const ppNotRequired = await getJobPpNotRequiredSet(supabase, [row.id])
    return {
      success: true,
      error: null,
      job: {
        id: row.id,
        jobNumber: row.job_number,
        companyName: row.company_name,
        salesOwner: row.sales_owner,
        startAt: row.start_at,
        endAt: row.end_at,
        technicianName: row.technician_name,
        generatorName: row.generator_name,
        siteAddress: row.site_address,
        jobStatus: row.job_status,
        marnyVyjezd: Boolean(row.marny_vyjezd),
        pohotovost: Boolean(row.pohotovost),
        hasInfo: Boolean(row.info_note?.trim()),
        clientId: row.client_id,
        offerId: row.offer_id,
        clientContactId: row.client_contact_id,
        contactPerson: row.contact_person,
        storeNumber: row.store_number,
        clientOrderNumber: row.client_order_number,
        infoNote: row.info_note,
        ppRequired: !ppNotRequired.has(row.id),
        invoiceStatus: row.invoice_status,
        evidenceStatus: row.evidence_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Detail zakázky se nepodařilo načíst.', job: null }
  }
}
