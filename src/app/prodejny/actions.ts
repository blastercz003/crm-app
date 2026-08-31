'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  parseStoresImportWorkbook,
  STORE_IMPORT_ALLOWED_CHAINS,
  type StoreImportAllowedChain,
} from '@/lib/stores/import'
import {
  reconcilePowerOutageStoreMatches,
  StoreMatchSyncAlreadyRunningError,
} from '@/lib/power-outages/store-match-sync'

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

type ExistingStoreImportRow = {
  id: string
  chain_name: string
  store_number: string
  city: string
  address: string
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
  existingCount?: number
  newCount?: number
  changedCount?: number
  missingCount?: number
}

export type ImportStoresResult = AnalyzeStoresImportResult & {
  importedCount: number
  removedCount: number
  matchingStatus: 'completed' | 'already_running' | 'failed'
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

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function refreshPowerOutageMatches() {
  try {
    await reconcilePowerOutageStoreMatches({ triggerKind: 'store_change' })
    return 'completed' as const
  } catch (error) {
    if (error instanceof StoreMatchSyncAlreadyRunningError) {
      return 'already_running' as const
    }
    return 'failed' as const
  }
}

async function loadExistingChainStores(
  supabase: Awaited<ReturnType<typeof createClient>>,
  chainName: StoreImportAllowedChain,
) {
  const { data, error } = await supabase
    .from('stores')
    .select('id,chain_name,store_number,city,address,phone_2,phone_3')
    .eq('chain_name', chainName)
  if (error) {
    throw new Error(`Nepodařilo se načíst aktuální prodejny řetězce: ${error.message}`)
  }
  return (data ?? []) as ExistingStoreImportRow[]
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
    const existingStores = await loadExistingChainStores(access.supabase, expectedChainName)
    const existingByNumber = new Map(existingStores.map((store) => [store.store_number, store]))
    const importedNumbers = new Set(parsed.validRows.map((row) => row.store_number))

    return {
      success: true,
      error: null,
      headers: parsed.headers,
      totalRows: parsed.totalRows,
      validCount: parsed.validRows.length,
      invalidCount: parsed.invalidRows.length,
      invalidRows: parsed.invalidRows,
      existingCount: existingStores.length,
      newCount: parsed.validRows.filter((row) => !existingByNumber.has(row.store_number)).length,
      changedCount: parsed.validRows.filter((row) => {
        const existing = existingByNumber.get(row.store_number)
        return Boolean(existing && (
          existing.city.trim() !== row.city.trim()
          || existing.address.trim() !== row.address.trim()
        ))
      }).length,
      missingCount: existingStores.filter((store) => !importedNumbers.has(store.store_number)).length,
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
        removedCount: 0,
        matchingStatus: 'failed',
      }
    }

    const expectedChainName = getExpectedChainName(formData)
    const replaceEntireChain = formData.get('replace_entire_chain') === 'true'
    const fileBuffer = await readImportFile(formData)
    const parsed = await parseStoresImportWorkbook(fileBuffer, expectedChainName)
    if (replaceEntireChain && parsed.invalidRows.length > 0) {
      throw new Error(
        'Úplnou synchronizaci řetězce nelze provést, dokud soubor obsahuje neplatné řádky. Oprav je, nebo vypni nahrazení celého řetězce.',
      )
    }

    const existingStores = await loadExistingChainStores(access.supabase, expectedChainName)
    const existingStoresByNumber = new Map(
      existingStores.map((store) => [store.store_number, store]),
    )

    const payload = parsed.validRows.map<StoreUpsertPayload>((row) => {
      const existingStore = existingStoresByNumber.get(row.store_number)

      return {
        chain_name: row.chain_name,
        store_number: row.store_number,
        city: row.city,
        address: row.address,
        phone_1: row.phone_1,
        phone_2: row.phone_2 ?? existingStore?.phone_2 ?? null,
        phone_3: row.phone_3 ?? existingStore?.phone_3 ?? null,
      }
    })

    if (payload.length > 0) {
      const { error } = await access.supabase.from('stores').upsert(payload, {
        onConflict: 'chain_name,store_number',
      })

      if (error) {
        throw new Error(`Nepodařilo se uložit prodejny: ${error.message}`)
      }
    }

    let removedCount = 0
    if (replaceEntireChain) {
      const importedNumbers = new Set(payload.map((store) => store.store_number))
      const obsoleteIds = existingStores
        .filter((store) => !importedNumbers.has(store.store_number))
        .map((store) => store.id)
      for (const ids of chunks(obsoleteIds, 100)) {
        const { error } = await access.supabase
          .from('stores')
          .delete()
          .in('id', ids)
        if (error) {
          throw new Error(`Nepodařilo se odstranit neaktuální prodejny: ${error.message}`)
        }
        removedCount += ids.length
      }
    }

    // Přepočet pracuje pouze s daty uloženými v Supabase a nezvyšuje počet
    // požadavků na veřejná rozhraní ČEZ ani EG.D.
    const matchingStatus = await refreshPowerOutageMatches()

    revalidatePath('/prodejny')
    revalidatePath('/dashboard')
    revalidatePath('/power-outages')

    return {
      success: true,
      error: null,
      headers: parsed.headers,
      totalRows: parsed.totalRows,
      validCount: parsed.validRows.length,
      invalidCount: parsed.invalidRows.length,
      invalidRows: parsed.invalidRows,
      importedCount: payload.length,
      removedCount,
      matchingStatus,
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
      removedCount: 0,
      matchingStatus: 'failed',
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

    await refreshPowerOutageMatches()

    revalidatePath('/prodejny')
    revalidatePath('/power-outages')

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
