'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  parseStoresImportWorkbook,
  STORE_IMPORT_ALLOWED_CHAINS,
  type StoreImportAllowedChain,
} from '@/lib/stores/import'

type StoresAccessRow = {
  role: string | null
  can_view_stores: boolean | null
}

type StoreUpsertPayload = {
  chain_name: string
  store_number: string
  city: string
  address: string
  phone_1: string
  phone_2: string | null
  phone_3: string | null
}

export type AnalyzeStoresImportResult = {
  success: boolean
  error: string | null
  headers: string[]
  totalRows: number
  validCount: number
  invalidCount: number
  invalidRows: Array<{
    rowNumber: number
    reasons: string[]
    raw: Record<string, string>
  }>
}

export type ImportStoresResult = AnalyzeStoresImportResult & {
  importedCount: number
}

export type UpdateStoreFormState = {
  success: boolean
  error: string | null
}

async function requireStoresAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      supabase,
      user: null,
      error: 'Nejsi přihlášený.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_stores')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění.',
    }
  }

  const typedProfile = profile as StoresAccessRow
  if (typedProfile.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Import prodejen může provádět jen admin.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

function normalizeChainName(value: string) {
  return String(value ?? '').trim().toUpperCase()
}

function isAllowedChain(value: string): value is StoreImportAllowedChain {
  return STORE_IMPORT_ALLOWED_CHAINS.includes(value as StoreImportAllowedChain)
}

async function readImportFile(formData: FormData) {
  const file = formData.get('file')

  if (!(file instanceof File)) {
    throw new Error('Nebyl vybrán žádný soubor.')
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    throw new Error('Import podporuje pouze soubory .xlsx.')
  }

  return await file.arrayBuffer()
}

function getExpectedChainName(formData: FormData) {
  const expectedChainName = normalizeChainName(formData.get('chain_name')?.toString() ?? '')

  if (!isAllowedChain(expectedChainName)) {
    throw new Error(
      `Vybraný řetězec není platný. Povolené hodnoty jsou ${STORE_IMPORT_ALLOWED_CHAINS.join(', ')}.`
    )
  }

  return expectedChainName
}

function readRequiredTextField(formData: FormData, fieldName: string, label: string) {
  const value = formData.get(fieldName)?.toString().trim() ?? ''

  if (!value) {
    throw new Error(`${label} je povinné.`)
  }

  return value
}

function readOptionalTextField(formData: FormData, fieldName: string) {
  const value = formData.get(fieldName)?.toString().trim() ?? ''
  return value || null
}

export async function analyzeStoresImportAction(
  formData: FormData
): Promise<AnalyzeStoresImportResult> {
  try {
    const access = await requireStoresAdmin()

    if (!access.user) {
      return {
        success: false,
        error: access.error,
        headers: [],
        totalRows: 0,
        validCount: 0,
        invalidCount: 0,
        invalidRows: [],
      }
    }

    const expectedChainName = getExpectedChainName(formData)
    const fileBuffer = await readImportFile(formData)
    const parsed = await parseStoresImportWorkbook(fileBuffer, expectedChainName)

    return {
      success: true,
      error: null,
      headers: parsed.headers,
      totalRows: parsed.totalRows,
      validCount: parsed.validRows.length,
      invalidCount: parsed.invalidRows.length,
      invalidRows: parsed.invalidRows,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Importní soubor se nepodařilo analyzovat.',
      headers: [],
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      invalidRows: [],
    }
  }
}

export async function importStoresFromWorkbookAction(
  formData: FormData
): Promise<ImportStoresResult> {
  try {
    const access = await requireStoresAdmin()

    if (!access.user) {
      return {
        success: false,
        error: access.error,
        headers: [],
        totalRows: 0,
        validCount: 0,
        invalidCount: 0,
        invalidRows: [],
        importedCount: 0,
      }
    }

    const expectedChainName = getExpectedChainName(formData)
    const fileBuffer = await readImportFile(formData)
    const parsed = await parseStoresImportWorkbook(fileBuffer, expectedChainName)

    const payload = parsed.validRows.map<StoreUpsertPayload>((row) => ({
      chain_name: row.chain_name,
      store_number: row.store_number,
      city: row.city,
      address: row.address,
      phone_1: row.phone_1,
      phone_2: row.phone_2,
      phone_3: row.phone_3,
    }))

    if (payload.length > 0) {
      const { error } = await access.supabase.from('stores').upsert(payload, {
        onConflict: 'chain_name,store_number',
      })

      if (error) {
        throw new Error(`Nepodařilo se uložit prodejny: ${error.message}`)
      }
    }

    revalidatePath('/prodejny')
    revalidatePath('/dashboard')

    return {
      success: true,
      error: null,
      headers: parsed.headers,
      totalRows: parsed.totalRows,
      validCount: parsed.validRows.length,
      invalidCount: parsed.invalidRows.length,
      invalidRows: parsed.invalidRows,
      importedCount: payload.length,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Import prodejen selhal.',
      headers: [],
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      invalidRows: [],
      importedCount: 0,
    }
  }
}

export async function updateStoreAction(
  _previousState: UpdateStoreFormState,
  formData: FormData
): Promise<UpdateStoreFormState> {
  try {
    const access = await requireStoresAdmin()

    if (!access.user) {
      return {
        success: false,
        error: access.error,
      }
    }

    const storeId = formData.get('store_id')?.toString().trim() ?? ''

    if (!storeId) {
      throw new Error('Chybí identifikátor prodejny.')
    }

    const city = readRequiredTextField(formData, 'city', 'Město')
    const address = readRequiredTextField(formData, 'address', 'Adresa')
    const phone1 = readRequiredTextField(formData, 'phone_1', 'Telefon 1')
    const phone2 = readOptionalTextField(formData, 'phone_2')
    const phone3 = readOptionalTextField(formData, 'phone_3')

    const { error } = await access.supabase
      .from('stores')
      .update({
        city,
        address,
        phone_1: phone1,
        phone_2: phone2,
        phone_3: phone3,
      })
      .eq('id', storeId)

    if (error) {
      throw new Error(`Nepodařilo se uložit změny prodejny: ${error.message}`)
    }

    revalidatePath('/prodejny')

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Uložení prodejny selhalo.',
    }
  }
}
