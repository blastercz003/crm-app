'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type UpsertBSafe24ContractActionState = {
  success: boolean
  error: string | null
  contractNumber?: string
  clientName?: string
}

export type BSafe24FileCategory = 'offer_pdf' | 'contract_pdf' | 'other'

export type BSafe24FileRow = {
  id: string
  contract_id: string
  file_type: BSafe24FileCategory
  file_name: string
  display_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  uploaded_by: string | null
  created_at: string
}

export type BSafe24UploadFilesActionState = {
  success: boolean
  error: string | null
  uploadedCount: number
}

export type BSafe24DeleteFileActionState = {
  success: boolean
  error: string | null
}

export type BSafe24DeleteContractActionState = {
  success: boolean
  error: string | null
}

export type BSafe24FileUrlActionState = {
  success: boolean
  error: string | null
  signedUrl: string | null
}

type CurrentProfile = {
  id: string
  role: string | null
  name?: string | null
  can_view_bsafe24?: boolean | null
}

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'

type ClientSnapshotRow = {
  id: string
  name: string | null
  address: string | null
}

type ClientContactSnapshotRow = {
  id: string
  client_id: string
  name: string | null
}

type BackupAddressInput = {
  address: string
  contactPerson?: string
  generatorPower?: string
}

const initialState: UpsertBSafe24ContractActionState = {
  success: false,
  error: null,
}

const BSAFE24_FILES_BUCKET = 'bsafe24-files'
const MAX_BSAFE24_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_BSAFE24_FILE_MIME_TYPES = new Set(['application/pdf'])

function normalizeProfileSalesOwner(name: string | null | undefined): SalesOwner | null {
  const normalized = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()

  if (normalized === 'JIRI') return 'JIŘÍ'
  if (normalized === 'MICHAL') return 'MICHAL'
  if (normalized === 'LIDA') return 'LÍDA'

  return null
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeUuid(value: FormDataEntryValue | null) {
  const normalized = typeof value === 'string' ? value.trim() : ''

  if (!normalized) return null

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null
}

function normalizeSalesOwner(value: string) {
  const normalized = value.trim().toUpperCase()

  if (normalized === 'JIŘÍ' || normalized === 'MICHAL' || normalized === 'LÍDA') {
    return normalized
  }

  throw new Error('Vybraný obchodník není platný.')
}

function normalizeFileCategory(value: string): BSafe24FileCategory {
  if (value === 'offer_pdf' || value === 'contract_pdf' || value === 'other') {
    return value
  }

  throw new Error('Vybraná kategorie souboru není platná.')
}

function buildBSafe24FileStoragePath(contractId: string, fileName: string) {
  const normalizedName = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  const safeName = normalizedName || 'soubor.pdf'
  return `contract/${contractId}/${Date.now()}-${safeName}`
}

function parseMonthlyFee(value: string) {
  const normalized = value.replace(/\s+/g, '').replace(',', '.')

  if (!normalized) {
    throw new Error('Paušál je povinný.')
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Paušál musí být číslo 0 nebo vyšší.')
  }

  return parsed
}

function parseDriveTimeHours(value: string) {
  const normalized = value.replace(/[^\d]/g, '').trim()

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('Dojezdový čas musí být celé číslo 0 nebo vyšší.')
  }

  return parsed
}

function parseBackupAddresses(raw: string) {
  if (!raw.trim()) {
    throw new Error('Chybí zálohované adresy.')
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Nepodařilo se zpracovat zálohované adresy.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Neplatný formát zálohovaných adres.')
  }

  const sanitized = parsed
    .map((item) => {
      const source = item as BackupAddressInput

      return {
        address: String(source?.address ?? '').trim(),
        contact_person: String(source?.contactPerson ?? '').trim() || null,
        generator_power: String(source?.generatorPower ?? '').trim() || null,
      }
    })
    .filter((item) => item.address.length > 0)

  if (sanitized.length === 0) {
    throw new Error('Zadej alespoň jednu zálohovanou adresu.')
  }

  return sanitized
}

async function requireAdminUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single<CurrentProfile>()

  if (profileError || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  if (profile.role !== 'admin') {
    throw new Error('Smlouvy B-SAFE 24 může upravovat pouze administrátor.')
  }

  return { supabase, user, profile }
}

async function requireBSafe24UserAccess() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, name, can_view_bsafe24')
    .eq('id', user.id)
    .single<CurrentProfile>()

  if (profileError || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const isAdmin = profile.role === 'admin'
  const allowedSalesOwner = normalizeProfileSalesOwner(profile.name)

  if (!isAdmin) {
    if (!profile.can_view_bsafe24) {
      throw new Error('Do sekce B-SAFE 24 nemáš přístup.')
    }

    if (!allowedSalesOwner) {
      throw new Error('Uživatel nemá přiřazeného obchodníka pro B-SAFE 24.')
    }
  }

  return { supabase, user, profile, isAdmin, allowedSalesOwner }
}

async function loadClientSnapshot(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  clientId: string
}) {
  const { supabase, clientId } = params

  const { data, error } = await supabase
    .from('clients')
    .select('id, name, address')
    .eq('id', clientId)
    .maybeSingle<ClientSnapshotRow>()

  if (error || !data) {
    throw new Error('Vybraný klient nebyl nalezen.')
  }

  const clientName = String(data.name ?? '').trim()

  if (!clientName) {
    throw new Error('Vybraný klient nemá název.')
  }

  return {
    id: data.id,
    clientName,
    clientAddress: String(data.address ?? '').trim(),
  }
}

async function loadClientContactSnapshot(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  clientId: string
  clientContactId: string | null
}) {
  const { supabase, clientId, clientContactId } = params

  if (!clientContactId) return null

  const { data, error } = await supabase
    .from('client_contacts')
    .select('id, client_id, name')
    .eq('id', clientContactId)
    .maybeSingle<ClientContactSnapshotRow>()

  if (error || !data || data.client_id !== clientId) {
    throw new Error('Vybraná kontaktní osoba nepatří k tomuto klientovi.')
  }

  return {
    id: data.id,
    name: String(data.name ?? '').trim(),
  }
}

async function ensureBSafe24ContractAccess(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  contractId: string
  isAdmin: boolean
  allowedSalesOwner: SalesOwner | null
  requireAdmin?: boolean
}) {
  const { supabase, contractId, isAdmin, allowedSalesOwner, requireAdmin = false } = params

  const { data, error } = await supabase
    .from('bsafe24_contracts')
    .select('id, sales_owner')
    .eq('id', contractId)
    .maybeSingle<{ id: string; sales_owner: SalesOwner }>()

  if (error || !data) {
    throw new Error('Smlouva B-SAFE 24 nebyla nalezena.')
  }

  if (requireAdmin) {
    if (!isAdmin) {
      throw new Error('Soubory B-SAFE 24 může upravovat pouze administrátor.')
    }
  }

  if (!isAdmin && allowedSalesOwner && data.sales_owner !== allowedSalesOwner) {
    throw new Error('K této smlouvě B-SAFE 24 nemáš přístup.')
  }

  return data
}

async function ensureActiveContractHasPdf(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  contractId: string
}) {
  const { supabase, contractId } = params

  const { data, error } = await supabase
    .from('bsafe24_files')
    .select('id')
    .eq('contract_id', contractId)
    .eq('file_type', 'contract_pdf')
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) {
    throw new Error('Nepodařilo se ověřit PDF soubor smlouvy.')
  }

  if (!data) {
    throw new Error(
      'Aktivní smlouva musí mít nahrané PDF smlouvy. Nejprve nahraj PDF v detailu smlouvy a potom ji přepni na aktivní.'
    )
  }
}

export async function createBSafe24ContractAction(
  _prevState: UpsertBSafe24ContractActionState,
  formData: FormData
): Promise<UpsertBSafe24ContractActionState> {
  try {
    const { supabase, user } = await requireAdminUser()

    const contractNumber = getString(formData, 'contract_number')
    const clientId = normalizeUuid(formData.get('client_id'))
    const clientContactId = normalizeUuid(formData.get('client_contact_id'))
    const fallbackContactPerson = getString(formData, 'contact_person')
    const salesOwner = normalizeSalesOwner(getString(formData, 'sales_owner'))
    const monthlyFee = parseMonthlyFee(getString(formData, 'monthly_fee'))
    const driveTimeHours = parseDriveTimeHours(getString(formData, 'drive_time_hours'))
    const isActive = getString(formData, 'is_active') !== 'false'
    const internalNote = getString(formData, 'internal_note')
    const backupAddresses = parseBackupAddresses(
      getString(formData, 'backup_addresses_json')
    )

    if (!contractNumber) {
      throw new Error('Číslo smlouvy je povinné.')
    }

    if (!clientId) {
      throw new Error('Vyber klienta ze seznamu.')
    }

    if (isActive) {
      throw new Error(
        'Novou smlouvu můžeš uložit jako aktivní až po nahrání PDF smlouvy. Nejprve ji založ jako neaktivní.'
      )
    }

    const client = await loadClientSnapshot({ supabase, clientId })
    const selectedContact = await loadClientContactSnapshot({
      supabase,
      clientId,
      clientContactId,
    })
    const contactPerson =
      fallbackContactPerson || selectedContact?.name || null

    const { data, error } = await supabase
      .from('bsafe24_contracts')
      .insert({
        contract_number: contractNumber,
        client_id: clientId,
        client_contact_id: selectedContact?.id ?? null,
        client_name: client.clientName,
        contact_person: contactPerson,
        client_address: client.clientAddress,
        sales_owner: salesOwner,
        monthly_fee: monthlyFee,
        drive_time_hours: driveTimeHours,
        is_active: isActive,
        internal_note: internalNote || null,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (error || !data) {
      if (error?.message?.includes('bsafe24_contracts_contract_number_unique')) {
        throw new Error(`Smlouva ${contractNumber} už existuje.`)
      }

      if (error?.message?.includes('bsafe24_contracts_client_unique')) {
        throw new Error('Vybraný klient už má B-SAFE 24 smlouvu.')
      }

      throw new Error('Nepodařilo se vytvořit smlouvu B-SAFE 24.')
    }

    const { error: addressesError } = await supabase
      .from('bsafe24_backup_addresses')
      .insert(
        backupAddresses.map((address, index) => ({
          contract_id: data.id,
          sort_order: index,
          address: address.address,
          contact_person: address.contact_person,
          generator_power: address.generator_power,
        }))
      )

    if (addressesError) {
      throw new Error('Smlouva byla vytvořena, ale nepodařilo se uložit zálohované adresy.')
    }

    revalidatePath('/bsafe24')

    return {
      success: true,
      error: null,
      contractNumber,
      clientName: client.clientName,
    }
  } catch (error) {
    return {
      ...initialState,
      error: error instanceof Error ? error.message : 'Nepodařilo se vytvořit smlouvu.',
    }
  }
}

export async function updateBSafe24ContractAction(
  _prevState: UpsertBSafe24ContractActionState,
  formData: FormData
): Promise<UpsertBSafe24ContractActionState> {
  try {
    const { supabase, user } = await requireAdminUser()

    const contractId = normalizeUuid(formData.get('contract_id'))
    const contractNumber = getString(formData, 'contract_number')
    const clientId = normalizeUuid(formData.get('client_id'))
    const clientContactId = normalizeUuid(formData.get('client_contact_id'))
    const fallbackContactPerson = getString(formData, 'contact_person')
    const salesOwner = normalizeSalesOwner(getString(formData, 'sales_owner'))
    const monthlyFee = parseMonthlyFee(getString(formData, 'monthly_fee'))
    const driveTimeHours = parseDriveTimeHours(getString(formData, 'drive_time_hours'))
    const isActive = getString(formData, 'is_active') !== 'false'
    const internalNote = getString(formData, 'internal_note')
    const backupAddresses = parseBackupAddresses(
      getString(formData, 'backup_addresses_json')
    )

    if (!contractId) {
      throw new Error('Chybí ID smlouvy.')
    }

    if (!contractNumber) {
      throw new Error('Číslo smlouvy je povinné.')
    }

    if (!clientId) {
      throw new Error('Vyber klienta ze seznamu.')
    }

    const { data: existingContract, error: existingError } = await supabase
      .from('bsafe24_contracts')
      .select('id')
      .eq('id', contractId)
      .maybeSingle<{ id: string }>()

    if (existingError || !existingContract) {
      throw new Error('Upravovaná smlouva nebyla nalezena.')
    }

    if (isActive) {
      await ensureActiveContractHasPdf({ supabase, contractId })
    }

    const client = await loadClientSnapshot({ supabase, clientId })
    const selectedContact = await loadClientContactSnapshot({
      supabase,
      clientId,
      clientContactId,
    })
    const contactPerson =
      fallbackContactPerson || selectedContact?.name || null

    const { error } = await supabase
      .from('bsafe24_contracts')
      .update({
        contract_number: contractNumber,
        client_id: clientId,
        client_contact_id: selectedContact?.id ?? null,
        client_name: client.clientName,
        contact_person: contactPerson,
        client_address: client.clientAddress,
        sales_owner: salesOwner,
        monthly_fee: monthlyFee,
        drive_time_hours: driveTimeHours,
        is_active: isActive,
        internal_note: internalNote || null,
        updated_by: user.id,
      })
      .eq('id', contractId)

    if (error) {
      if (error.message?.includes('bsafe24_contracts_contract_number_unique')) {
        throw new Error(`Smlouva ${contractNumber} už existuje.`)
      }

      if (error.message?.includes('bsafe24_contracts_client_unique')) {
        throw new Error('Vybraný klient už má B-SAFE 24 smlouvu.')
      }

      throw new Error('Nepodařilo se uložit změny smlouvy.')
    }

    const { error: deleteAddressesError } = await supabase
      .from('bsafe24_backup_addresses')
      .delete()
      .eq('contract_id', contractId)

    if (deleteAddressesError) {
      throw new Error('Nepodařilo se upravit zálohované adresy smlouvy.')
    }

    const { error: addressesError } = await supabase
      .from('bsafe24_backup_addresses')
      .insert(
        backupAddresses.map((address, index) => ({
          contract_id: contractId,
          sort_order: index,
          address: address.address,
          contact_person: address.contact_person,
          generator_power: address.generator_power,
        }))
      )

    if (addressesError) {
      throw new Error('Nepodařilo se znovu uložit zálohované adresy smlouvy.')
    }

    revalidatePath('/bsafe24')

    return {
      success: true,
      error: null,
      contractNumber,
      clientName: client.clientName,
    }
  } catch (error) {
    return {
      ...initialState,
      error: error instanceof Error ? error.message : 'Nepodařilo se upravit smlouvu.',
    }
  }
}

export async function uploadBSafe24FilesAction(
  contractId: string,
  categoryValue: string,
  files: File[]
): Promise<BSafe24UploadFilesActionState> {
  try {
    const { supabase, user, isAdmin, allowedSalesOwner } =
      await requireBSafe24UserAccess()
    const normalizedContractId = String(contractId ?? '').trim()
    const category = normalizeFileCategory(String(categoryValue ?? '').trim())
    const cleanFiles = files.filter((file) => file instanceof File)

    if (!normalizedContractId) {
      return { success: false, error: 'Chybí ID smlouvy.', uploadedCount: 0 }
    }

    await ensureBSafe24ContractAccess({
      supabase,
      contractId: normalizedContractId,
      isAdmin,
      allowedSalesOwner,
    })

    if (cleanFiles.length === 0) {
      return { success: false, error: 'Vyber alespoň jeden PDF soubor.', uploadedCount: 0 }
    }

    for (const file of cleanFiles) {
      if (file.size > MAX_BSAFE24_FILE_SIZE_BYTES) {
        return {
          success: false,
          error: `Soubor "${file.name}" překračuje limit 10 MB.`,
          uploadedCount: 0,
        }
      }

      const mimeType = String(file.type ?? '').trim().toLowerCase()
      if (!mimeType || !ALLOWED_BSAFE24_FILE_MIME_TYPES.has(mimeType)) {
        return {
          success: false,
          error: `Soubor "${file.name}" musí být PDF.`,
          uploadedCount: 0,
        }
      }
    }

    const createdRows: Array<{ id: string; storagePath: string }> = []

    for (const file of cleanFiles) {
      const storagePath = buildBSafe24FileStoragePath(normalizedContractId, file.name)
      const contentType = String(file.type ?? '').trim() || 'application/pdf'

      const { error: uploadError } = await supabase.storage
        .from(BSAFE24_FILES_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        for (const createdRow of createdRows) {
          await supabase.storage.from(BSAFE24_FILES_BUCKET).remove([createdRow.storagePath])
          await supabase.from('bsafe24_files').delete().eq('id', createdRow.id)
        }

        return {
          success: false,
          error: `Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`,
          uploadedCount: 0,
        }
      }

      const { data: insertedRow, error: insertError } = await supabase
        .from('bsafe24_files')
        .insert({
          contract_id: normalizedContractId,
          file_type: category,
          file_name: file.name,
          display_name: file.name,
          storage_bucket: BSAFE24_FILES_BUCKET,
          storage_path: storagePath,
          mime_type: contentType,
          file_size_bytes: file.size,
          uploaded_by: user.id,
        })
        .select('id')
        .single<{ id: string }>()

      if (insertError || !insertedRow) {
        await supabase.storage.from(BSAFE24_FILES_BUCKET).remove([storagePath])

        for (const createdRow of createdRows) {
          await supabase.storage.from(BSAFE24_FILES_BUCKET).remove([createdRow.storagePath])
          await supabase.from('bsafe24_files').delete().eq('id', createdRow.id)
        }

        if (
          insertError?.message?.includes('bsafe24_files_singleton_type_idx') ||
          insertError?.message?.includes('duplicate key value')
        ) {
          return {
            success: false,
            error:
              category === 'offer_pdf'
                ? 'Nabídka PDF už je u této smlouvy nahraná. Nejprve ji smaž nebo nahraď.'
                : category === 'contract_pdf'
                  ? 'Smlouva PDF už je u této smlouvy nahraná. Nejprve ji smaž nebo nahraď.'
                  : 'Soubor se nepodařilo uložit kvůli duplicitě.',
            uploadedCount: 0,
          }
        }

        return {
          success: false,
          error: `Metadata souboru "${file.name}" se nepodařilo uložit (${insertError?.message ?? 'neznámá chyba'}).`,
          uploadedCount: 0,
        }
      }

      createdRows.push({
        id: insertedRow.id,
        storagePath,
      })
    }

    revalidatePath('/bsafe24')

    return {
      success: true,
      error: null,
      uploadedCount: createdRows.length,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se nahrát soubory.',
      uploadedCount: 0,
    }
  }
}

export async function deleteBSafe24FileAction(
  fileId: string
): Promise<BSafe24DeleteFileActionState> {
  try {
    const { supabase } = await requireAdminUser()
    const normalizedFileId = String(fileId ?? '').trim()

    if (!normalizedFileId) {
      return { success: false, error: 'Chybí ID souboru.' }
    }

    const { data: row, error: rowError } = await supabase
      .from('bsafe24_files')
      .select('id, storage_bucket, storage_path')
      .eq('id', normalizedFileId)
      .single<{ id: string; storage_bucket: string; storage_path: string }>()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.' }
    }

    const { error: storageError } = await supabase.storage
      .from(String(row.storage_bucket))
      .remove([String(row.storage_path)])

    if (storageError) {
      return { success: false, error: 'Soubor ve storage se nepodařilo smazat.' }
    }

    const { error: deleteError } = await supabase
      .from('bsafe24_files')
      .delete()
      .eq('id', normalizedFileId)

    if (deleteError) {
      return { success: false, error: 'Metadata souboru se nepodařilo smazat.' }
    }

    revalidatePath('/bsafe24')

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se smazat soubor.',
    }
  }
}

export async function deleteBSafe24ContractAction(
  contractId: string
): Promise<BSafe24DeleteContractActionState> {
  try {
    const { supabase } = await requireAdminUser()
    const normalizedContractId = String(contractId ?? '').trim()

    if (!normalizedContractId) {
      return { success: false, error: 'Chybí ID smlouvy.' }
    }

    const { data: contract, error: contractError } = await supabase
      .from('bsafe24_contracts')
      .select('id')
      .eq('id', normalizedContractId)
      .maybeSingle<{ id: string }>()

    if (contractError || !contract) {
      return { success: false, error: 'Smlouva nebyla nalezena.' }
    }

    const { data: files, error: filesError } = await supabase
      .from('bsafe24_files')
      .select('id, storage_bucket, storage_path')
      .eq('contract_id', normalizedContractId)

    if (filesError) {
      return { success: false, error: 'Nepodařilo se načíst soubory smlouvy.' }
    }

    const filesByBucket = new Map<string, string[]>()

    for (const file of files ?? []) {
      const bucket = String(file.storage_bucket ?? '').trim()
      const path = String(file.storage_path ?? '').trim()

      if (!bucket || !path) continue

      const items = filesByBucket.get(bucket) ?? []
      items.push(path)
      filesByBucket.set(bucket, items)
    }

    for (const [bucket, paths] of filesByBucket) {
      if (paths.length === 0) continue

      const { error: storageError } = await supabase.storage.from(bucket).remove(paths)

      if (storageError) {
        return {
          success: false,
          error: 'Nepodařilo se smazat soubory smlouvy ve storage.',
        }
      }
    }

    const { error: deleteError } = await supabase
      .from('bsafe24_contracts')
      .delete()
      .eq('id', normalizedContractId)

    if (deleteError) {
      return { success: false, error: 'Smlouvu se nepodařilo smazat.' }
    }

    revalidatePath('/bsafe24')

    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se smazat smlouvu.',
    }
  }
}

async function getBSafe24FileUrl(
  fileId: string,
  download: boolean
): Promise<BSafe24FileUrlActionState> {
  try {
    const { supabase, isAdmin, allowedSalesOwner } = await requireBSafe24UserAccess()

    const normalizedFileId = String(fileId ?? '').trim()
    if (!normalizedFileId) {
      return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
    }

    const { data: row, error: rowError } = await supabase
      .from('bsafe24_files')
      .select('display_name, storage_bucket, storage_path, contract_id')
      .eq('id', normalizedFileId)
      .single<{
        display_name: string
        storage_bucket: string
        storage_path: string
        contract_id: string
      }>()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
    }

    await ensureBSafe24ContractAccess({
      supabase,
      contractId: row.contract_id,
      isAdmin,
      allowedSalesOwner,
    })

    const { data, error } = await supabase.storage
      .from(String(row.storage_bucket))
      .createSignedUrl(String(row.storage_path), 60, download
        ? {
            download: String(row.display_name ?? '').trim() || undefined,
          }
        : undefined)

    if (error || !data?.signedUrl) {
      return {
        success: false,
        error: download
          ? 'Nepodařilo se vytvořit odkaz pro stažení souboru.'
          : 'Nepodařilo se vytvořit odkaz pro otevření souboru.',
        signedUrl: null,
      }
    }

    return {
      success: true,
      error: null,
      signedUrl: data.signedUrl,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se připravit soubor.',
      signedUrl: null,
    }
  }
}

export async function openBSafe24FileAction(
  fileId: string
): Promise<BSafe24FileUrlActionState> {
  return getBSafe24FileUrl(fileId, false)
}

export async function downloadBSafe24FileAction(
  fileId: string
): Promise<BSafe24FileUrlActionState> {
  return getBSafe24FileUrl(fileId, true)
}
