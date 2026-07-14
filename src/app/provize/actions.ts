'use server'

import { revalidatePath } from 'next/cache'
import { reportActionError } from '@/lib/errors/reportActionError'
import { createClient } from '@/lib/supabase/server'

type ProfileRoleRow = {
  role: string | null
}

type UpdateProvizeProfitActionState = {
  success: boolean
  error: string | null
  profitAmount: number | null
}

type UpdateProvizeApprovalActionState = {
  success: boolean
  error: string | null
  approvedForPayout: boolean
}

type ProvizeAccessRow = {
  id: string
  manual_profit_amount: number | null
  approved_for_payout: boolean
  confirmed_batch_id: string | null
}

async function requireProvizeAdminAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Neautorizovaný přístup.',
    }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<ProfileRoleRow>()

  if (error) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění.',
    }
  }

  if (profile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Tuto změnu může provést pouze admin.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function getProvizeAccessRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recordId: string
) {
  const { data, error } = await supabase
    .from('provize_records')
    .select('id, manual_profit_amount, approved_for_payout, confirmed_batch_id')
    .eq('id', recordId)
    .single<ProvizeAccessRow>()

  if (error || !data) {
    return {
      success: false as const,
      error: 'Nepodařilo se načíst provizní záznam.',
      record: null,
    }
  }

  return {
    success: true as const,
    error: null,
    record: data,
  }
}

function normalizeManualProfit(
  value: FormDataEntryValue | null
): { success: true; value: number | null } | { success: false; error: string } {
  const text = String(value ?? '').trim()

  if (!text) {
    return { success: true, value: null }
  }

  const normalized = text.replace(/\s+/g, '').replace(',', '.')

  if (!/^-?\d+(?:\.0+)?$/.test(normalized)) {
    return { success: false, error: 'Zisk musí být zadaný jako celé číslo.' }
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return { success: false, error: 'Zisk není platné číslo.' }
  }

  return { success: true, value: Math.round(parsed) }
}

function revalidateProvizePaths() {
  revalidatePath('/provize')
  revalidatePath('/dashboard')
}

function getActionErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return 'Neznámá chyba.'
}

export async function updateProvizeProfitAction(
  recordId: string,
  _prevState: UpdateProvizeProfitActionState,
  formData: FormData
): Promise<UpdateProvizeProfitActionState> {
  let currentUserId: string | null = null

  try {
    const { supabase, user, error } = await requireProvizeAdminAccess()
    currentUserId = user?.id ?? null

    if (!user) {
      return {
        success: false,
        error: error ?? 'Neautorizovaný přístup.',
        profitAmount: null,
      }
    }

    const normalizedRecordId = String(recordId ?? '').trim()

    if (!normalizedRecordId) {
      return {
        success: false,
        error: 'Chybí ID provizního záznamu.',
        profitAmount: null,
      }
    }

    const access = await getProvizeAccessRow(supabase, normalizedRecordId)

    if (!access.success || !access.record) {
      return {
        success: false,
        error: access.error,
        profitAmount: null,
      }
    }

    if (access.record.confirmed_batch_id) {
      return {
        success: false,
        error: 'Vyplacený záznam už nelze upravovat.',
        profitAmount: access.record.manual_profit_amount,
      }
    }

    const normalizedProfit = normalizeManualProfit(formData.get('value'))

    if (!normalizedProfit.success) {
      return {
        success: false,
        error: normalizedProfit.error,
        profitAmount: access.record.manual_profit_amount,
      }
    }

    const { error: updateError } = await supabase
      .from('provize_records')
      .update({ manual_profit_amount: normalizedProfit.value })
      .eq('id', normalizedRecordId)

    if (updateError) {
      return {
        success: false,
        error: 'Nepodařilo se uložit upravený zisk.',
        profitAmount: access.record.manual_profit_amount,
      }
    }

    revalidateProvizePaths()

    return {
      success: true,
      error: null,
      profitAmount: normalizedProfit.value,
    }
  } catch (error) {
    const { errorCode } = await reportActionError({
      error,
      action: 'updateProvizeProfitAction',
      section: 'provize',
      userId: currentUserId,
      context: {
        recordId: String(recordId ?? ''),
      },
    })

    return {
      success: false,
      error: `Nepodařilo se uložit upravený zisk. ${getActionErrorMessage(error)} (${errorCode})`,
      profitAmount: null,
    }
  }
}

export async function updateProvizeApprovalAction(
  recordId: string,
  approvedForPayout: boolean
): Promise<UpdateProvizeApprovalActionState> {
  let currentUserId: string | null = null

  try {
    const { supabase, user, error } = await requireProvizeAdminAccess()
    currentUserId = user?.id ?? null

    if (!user) {
      return {
        success: false,
        error: error ?? 'Neautorizovaný přístup.',
        approvedForPayout: !approvedForPayout,
      }
    }

    const normalizedRecordId = String(recordId ?? '').trim()

    if (!normalizedRecordId) {
      return {
        success: false,
        error: 'Chybí ID provizního záznamu.',
        approvedForPayout: !approvedForPayout,
      }
    }

    const access = await getProvizeAccessRow(supabase, normalizedRecordId)

    if (!access.success || !access.record) {
      return {
        success: false,
        error: access.error,
        approvedForPayout: !approvedForPayout,
      }
    }

    if (access.record.confirmed_batch_id) {
      return {
        success: false,
        error: 'Vyplacený záznam už nelze znovu přepínat.',
        approvedForPayout: access.record.approved_for_payout,
      }
    }

    const { error: updateError } = await supabase
      .from('provize_records')
      .update({
        approved_for_payout: approvedForPayout,
        approved_for_payout_at: approvedForPayout ? new Date().toISOString() : null,
      })
      .eq('id', normalizedRecordId)

    if (updateError) {
      return {
        success: false,
        error: 'Nepodařilo se uložit stav K vyplacení.',
        approvedForPayout: access.record.approved_for_payout,
      }
    }

    revalidateProvizePaths()

    return {
      success: true,
      error: null,
      approvedForPayout,
    }
  } catch (error) {
    const { errorCode } = await reportActionError({
      error,
      action: 'updateProvizeApprovalAction',
      section: 'provize',
      userId: currentUserId,
      context: {
        recordId: String(recordId ?? ''),
        approvedForPayout,
      },
    })

    return {
      success: false,
      error: `Nepodařilo se uložit stav K vyplacení. ${getActionErrorMessage(error)} (${errorCode})`,
      approvedForPayout: !approvedForPayout,
    }
  }
}
