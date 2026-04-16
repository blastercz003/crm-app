'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type UpdateFinanceInlineFieldActionState = {
  success: boolean
  error: string | null
}

type ProfileRoleRow = {
  role: string | null
}

const FINANCE_EDITABLE_FIELDS = [
  'info_note',
  'invoice_number',
  'sale_amount',
  'cost_amount',
] as const

type FinanceEditableField = (typeof FINANCE_EDITABLE_FIELDS)[number]

type NormalizeDecimalResult =
  | {
      success: true
      value: number | null
      error: null
    }
  | {
      success: false
      value: null
      error: string
    }

function isFinanceEditableField(value: string): value is FinanceEditableField {
  return FINANCE_EDITABLE_FIELDS.includes(value as FinanceEditableField)
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeDecimal(value: FormDataEntryValue | null): NormalizeDecimalResult {
  const text = String(value ?? '').trim()

  if (!text) {
    return {
      success: true,
      value: null,
      error: null,
    }
  }

  const normalized = text.replace(/\s+/g, '').replace(',', '.')

  if (!/^-?\d+$/.test(normalized)) {
    return {
      success: false,
      value: null,
      error: 'Zadej celé číslo ve správném formátu.',
    }
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return {
      success: false,
      value: null,
      error: 'Zadej platnou číselnou hodnotu.',
    }
  }

  return {
    success: true,
    value: parsed,
    error: null,
  }
}

async function requireAuthenticatedUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Nejsi přihlášený.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function requireFinanceAdminAccess() {
  const { supabase, user, error } = await requireAuthenticatedUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro práci s fakturací.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

function revalidateFinancePaths(jobId?: string | null) {
  revalidatePath('/faktury')

  if (jobId) {
    revalidatePath(`/jobs/${jobId}`)
  }

  revalidatePath('/jobs')
}

export async function updateFinanceInlineFieldAction(
  financeId: string,
  _prevState: UpdateFinanceInlineFieldActionState,
  formData: FormData
): Promise<UpdateFinanceInlineFieldActionState> {
  const { supabase, user, error: accessError } =
    await requireFinanceAdminAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedFinanceId = String(financeId ?? '').trim()

  if (!normalizedFinanceId) {
    return {
      success: false,
      error: 'Chybí ID finančního záznamu.',
    }
  }

  const field = String(formData.get('field') ?? '').trim()
  const value = formData.get('value')

  if (!isFinanceEditableField(field)) {
    return {
      success: false,
      error: 'Neplatné pole pro editaci.',
    }
  }

  const { data: financeRow, error: financeRowError } = await supabase
    .from('job_finances')
    .select('id, job_id')
    .eq('id', normalizedFinanceId)
    .single()

  if (financeRowError || !financeRow) {
    return {
      success: false,
      error: 'Nepodařilo se načíst finanční záznam.',
    }
  }

  if (field === 'info_note' || field === 'invoice_number') {
    const normalizedText = normalizeText(value)

    const { error } = await supabase
      .from('job_finances')
      .update({
        [field]: normalizedText,
      })
      .eq('id', normalizedFinanceId)

    if (error) {
      return {
        success: false,
        error:
          field === 'info_note'
            ? 'Info se nepodařilo uložit.'
            : 'Číslo faktury se nepodařilo uložit.',
      }
    }

    revalidateFinancePaths(String(financeRow.job_id))

    return {
      success: true,
      error: null,
    }
  }

  const parsedNumber = normalizeDecimal(value)

  if (!parsedNumber.success) {
    return {
      success: false,
      error: parsedNumber.error,
    }
  }

  const { error } = await supabase
    .from('job_finances')
    .update({
      [field]: parsedNumber.value,
    })
    .eq('id', normalizedFinanceId)

  if (error) {
    return {
      success: false,
      error:
        field === 'sale_amount'
          ? 'Prodej se nepodařilo uložit.'
          : 'Náklad se nepodařilo uložit.',
    }
  }

  revalidateFinancePaths(String(financeRow.job_id))

  return {
    success: true,
    error: null,
  }
}