'use server'

import {
  loadVehicleLogbookReport,
  validateVehicleLogbookReportInput,
  type VehicleLogbookReportData,
  type VehicleLogbookReportInput,
} from '@/lib/vehicle-logbook/reports'
import { createClient } from '@/lib/supabase/server'

export type VehicleLogbookReportActionResult =
  | { success: true; report: VehicleLogbookReportData }
  | { success: false; error: string }

export type VehicleLogbookHistoryStartActionResult =
  | { success: true; from: string | null }
  | { success: false; error: string }

async function verifyAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      error: 'Pro zobrazení reportu se přihlas.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (profileError || profile?.role !== 'admin') {
    return {
      supabase,
      error: 'Nemáš oprávnění zobrazit reporty knih jízd.',
    }
  }

  return { supabase, error: null }
}

export async function getVehicleLogbookReportAction(
  input: VehicleLogbookReportInput
): Promise<VehicleLogbookReportActionResult> {
  const validationError = validateVehicleLogbookReportInput(input)
  if (validationError) return { success: false, error: validationError }

  const { supabase, error } = await verifyAdmin()
  if (error) return { success: false, error }

  try {
    return {
      success: true,
      report: await loadVehicleLogbookReport(supabase, input),
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Report se nepodařilo načíst.',
    }
  }
}

export async function getVehicleLogbookHistoryStartAction(
  vehicleId: string | null
): Promise<VehicleLogbookHistoryStartActionResult> {
  const { supabase, error } = await verifyAdmin()
  if (error) return { success: false, error }

  let entryQuery = supabase
    .from('vehicle_logbook_entries')
    .select('trip_date')
    .is('deleted_at', null)
    .order('trip_date', { ascending: true })
    .limit(1)

  let fuelQuery = supabase
    .from('vehicle_logbook_fuel_entries')
    .select('fueled_on')
    .is('deleted_at', null)
    .order('fueled_on', { ascending: true })
    .limit(1)

  if (vehicleId) {
    entryQuery = entryQuery.eq('vehicle_id', vehicleId)
    fuelQuery = fuelQuery.eq('vehicle_id', vehicleId)
  }

  const [entryResponse, fuelResponse] = await Promise.all([
    entryQuery.maybeSingle<{ trip_date: string }>(),
    fuelQuery.maybeSingle<{ fueled_on: string }>(),
  ])
  const queryError = entryResponse.error ?? fuelResponse.error

  if (queryError) {
    return {
      success: false,
      error: `Nepodařilo se určit začátek historie: ${queryError.message}`,
    }
  }

  const from =
    [entryResponse.data?.trip_date, fuelResponse.data?.fueled_on]
      .filter((date): date is string => Boolean(date))
      .sort()[0] ?? null

  return { success: true, from }
}
