'use server'

import { unstable_rethrow } from 'next/navigation'
import { getActivityRuntimeContext } from '@/lib/activities/access'
import type { ActivityListItem, ActivityRow } from '@/lib/activities/types'
import type { ActivitySystemHistoryActionResult } from '@/lib/activities/workspace-types'
import { getServiceRoleClient } from '@/lib/supabase/service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 200

function completePowerOutageCandidateId(row: Pick<ActivityRow, 'metadata'>) {
  const value = row.metadata?.completePowerOutageCandidateId
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}

function completePowerOutageCompanyName(row: Pick<ActivityRow, 'metadata'>) {
  const value = row.metadata?.completePowerOutageCompanyName
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value ?? DEFAULT_LIMIT)))
}

export async function getSystemHistoryAction(input: {
  userId?: string | null
  limit?: number
} = {}): Promise<ActivitySystemHistoryActionResult> {
  try {
    const { supabase, profile, isAdmin } = await getActivityRuntimeContext()
    const requestedUserId = String(input.userId ?? '').trim()
    if (requestedUserId && !UUID_PATTERN.test(requestedUserId)) {
      throw new Error('Vybraný uživatel není platný.')
    }

    let request = supabase
      .from('activities')
      .select('*', { count: 'exact' })
      .eq('origin', 'automatic')
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .limit(normalizeLimit(input.limit))

    if (!isAdmin) request = request.eq('user_id', profile.id)

    const { data, error, count } = await request

    if (error) throw new Error(`Poslední události se nepodařilo načíst: ${error.message}`)

    const rows = (data ?? []) as ActivityRow[]
    const clientIds = [...new Set(rows.map((row) => row.client_id).filter(Boolean))] as string[]
    const outageCandidateIds = [...new Set(rows.map(completePowerOutageCandidateId).filter(Boolean))] as string[]
    const userIds = [...new Set(rows.map((row) => row.user_id))]
    const serviceClient = isAdmin ? getServiceRoleClient() : null
    if (isAdmin && !serviceClient) {
      throw new Error('Chybí serverové připojení pro načtení autorů událostí.')
    }

    const [clientsResponse, outageCompaniesResponse, usersResponse] = await Promise.all([
      clientIds.length
        ? supabase.from('clients').select('id, name').in('id', clientIds)
        : Promise.resolve({ data: [], error: null }),
      outageCandidateIds.length
        ? supabase.from('complete_power_outage_companies').select('id, company_name').in('id', outageCandidateIds)
        : Promise.resolve({ data: [], error: null }),
      isAdmin && userIds.length
        ? serviceClient!.from('profiles').select('id, name').in('id', userIds)
        : Promise.resolve({
            data: [{ id: profile.id, name: profile.name }],
            error: null,
          }),
    ])

    if (clientsResponse.error) {
      throw new Error(`Klienty posledních událostí se nepodařilo načíst: ${clientsResponse.error.message}`)
    }
    if (outageCompaniesResponse.error) {
      throw new Error(`Firmy z Monitoringu odstávek se nepodařilo načíst: ${outageCompaniesResponse.error.message}`)
    }
    if (usersResponse.error) {
      throw new Error(`Autory posledních událostí se nepodařilo načíst: ${usersResponse.error.message}`)
    }

    const clientNames = new Map(
      ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((client) => [
        client.id,
        client.name,
      ]),
    )
    const userNames = new Map(
      ((usersResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((user) => [
        user.id,
        user.name?.trim() || 'Uživatel',
      ]),
    )
    const outageCompanyNames = new Map(
      ((outageCompaniesResponse.data ?? []) as Array<{ id: string; company_name: string | null }>).map((company) => [
        company.id,
        company.company_name?.trim() || 'Firma z Monitoringu odstávek',
      ]),
    )
    const items: ActivityListItem[] = rows.map((row) => {
      const outageCandidateId = completePowerOutageCandidateId(row)
      return {
        ...row,
        user_name: userNames.get(row.user_id) ?? 'Uživatel',
        client_name: row.client_id
          ? clientNames.get(row.client_id) ?? null
          : outageCandidateId
            ? outageCompanyNames.get(outageCandidateId) ?? completePowerOutageCompanyName(row)
            : null,
      }
    })

    return { success: true, error: null, items, total: count ?? 0 }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Poslední události se nepodařilo načíst.',
      items: [],
      total: 0,
    }
  }
}
