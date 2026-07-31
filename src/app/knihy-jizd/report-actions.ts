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

export async function getVehicleLogbookReportAction(
  input: VehicleLogbookReportInput
): Promise<VehicleLogbookReportActionResult> {
  const validationError = validateVehicleLogbookReportInput(input)
  if (validationError) return { success: false, error: validationError }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Pro zobrazení reportu se přihlas.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (profileError || profile?.role !== 'admin') {
    return {
      success: false,
      error: 'Nemáš oprávnění zobrazit reporty knih jízd.',
    }
  }

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
