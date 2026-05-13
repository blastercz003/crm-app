import { createClient } from '@/lib/supabase/server'
import type {
  ReceivedInvoiceFilter,
  ReceivedInvoiceRow,
  ReceivedInvoiceStatus,
} from './types'

type ProfileRoleRow = {
  role: string | null
}

export const RECEIVED_INVOICES_BUCKET = 'received-invoices'
export const RECEIVED_INVOICE_MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024

const ALLOWED_MIME_TYPE_PATTERNS = ['application/pdf', 'image/'] as const

function isAllowedMimeType(mimeType: string) {
  const normalized = String(mimeType ?? '').trim().toLowerCase()
  if (!normalized) return false

  return ALLOWED_MIME_TYPE_PATTERNS.some((allowed) =>
    allowed.endsWith('/') ? normalized.startsWith(allowed) : normalized === allowed
  )
}

function sanitizeFileName(value: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  const safe = normalized.replace(/[^a-zA-Z0-9._\-() ,'!*$&@=;:+?]/g, '_')
  return safe.length > 0 ? safe : 'soubor'
}

function splitFileNameParts(fileName: string) {
  const safe = sanitizeFileName(fileName)
  const dotIndex = safe.lastIndexOf('.')

  if (dotIndex <= 0 || dotIndex === safe.length - 1) {
    return { baseName: safe, extension: '' }
  }

  return {
    baseName: safe.slice(0, dotIndex),
    extension: safe.slice(dotIndex),
  }
}

function buildStoragePath(fileName: string) {
  const safe = sanitizeFileName(fileName)
  const date = new Date()
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${year}/${month}/${crypto.randomUUID()}-${safe}`
}

function getPragueTodayDateOnly() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isReceivedInvoiceStatus(value: string | undefined): value is ReceivedInvoiceStatus {
  return value === 'unpaid' || value === 'paid'
}

function isReceivedInvoiceFilter(value: string | undefined): value is ReceivedInvoiceFilter {
  return value === 'all' || value === 'unpaid' || value === 'paid'
}

export async function requireAdminSupabaseContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Nejsi přihlášený.')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error) {
    throw new Error('Nepodařilo se ověřit oprávnění.')
  }

  const typedProfile = profile as ProfileRoleRow | null
  if (typedProfile?.role !== 'admin') {
    throw new Error('Nemáš oprávnění pro správu přijatých faktur.')
  }

  return { supabase, user }
}

async function resolveUniqueReceivedInvoiceFileNameWithClient(
  inputFileName: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { baseName, extension } = splitFileNameParts(inputFileName)

  const firstCandidate = `${baseName}${extension}`
  const { data: firstMatch, error: firstMatchError } = await supabase
    .from('received_invoices')
    .select('id')
    .eq('file_name', firstCandidate)
    .limit(1)

  if (firstMatchError) {
    throw new Error('Nepodařilo se ověřit název souboru.')
  }

  if (!firstMatch || firstMatch.length === 0) {
    return firstCandidate
  }

  let index = 2
  while (index <= 10_000) {
    const candidate = `${baseName} (${index})${extension}`
    const { data, error } = await supabase
      .from('received_invoices')
      .select('id')
      .eq('file_name', candidate)
      .limit(1)

    if (error) {
      throw new Error('Nepodařilo se ověřit název souboru.')
    }

    if (!data || data.length === 0) {
      return candidate
    }

    index += 1
  }

  throw new Error('Nepodařilo se najít volný název souboru.')
}

export async function validateReceivedInvoiceFile(file: File) {
  if (!(file instanceof File)) {
    throw new Error('Nebyl vybrán platný soubor.')
  }

  if (file.size <= 0) {
    throw new Error(`Soubor "${file.name}" je prázdný.`)
  }

  if (file.size > RECEIVED_INVOICE_MAX_FILE_SIZE_BYTES) {
    throw new Error(`Soubor "${file.name}" překračuje limit 3 MB.`)
  }

  if (!isAllowedMimeType(file.type)) {
    throw new Error(`Soubor "${file.name}" má nepodporovaný typ.`)
  }
}

export async function uploadReceivedInvoiceFile(params: {
  file: File
  dueDate: string | null
}) {
  const { supabase, user } = await requireAdminSupabaseContext()
  const { file, dueDate } = params

  await validateReceivedInvoiceFile(file)

  const fileName = await resolveUniqueReceivedInvoiceFileNameWithClient(file.name, supabase)
  const storagePath = buildStoragePath(fileName)
  const contentType = String(file.type ?? '').trim().toLowerCase()

  const { error: uploadError } = await supabase.storage
    .from(RECEIVED_INVOICES_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: contentType || 'application/octet-stream',
    })

  if (uploadError) {
    throw new Error(`Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`)
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from('received_invoices')
    .insert({
      file_path: storagePath,
      file_name: fileName,
      file_size: file.size,
      mime_type: contentType || 'application/octet-stream',
      status: 'unpaid',
      due_date: dueDate,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (insertError || !insertedRow) {
    await supabase.storage.from(RECEIVED_INVOICES_BUCKET).remove([storagePath])
    throw new Error(`Soubor "${file.name}" se nepodařilo uložit do evidence.`)
  }

  return insertedRow as ReceivedInvoiceRow
}

export async function getReceivedInvoices(params?: {
  filter?: string
  limit?: number
}) {
  const { supabase } = await requireAdminSupabaseContext()
  const limit = Math.min(Math.max(params?.limit ?? 200, 1), 1000)
  const filter = isReceivedInvoiceFilter(params?.filter) ? params?.filter : 'unpaid'

  let query = supabase
    .from('received_invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filter !== 'all') {
    query = query.eq('status', filter)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Nepodařilo se načíst přijaté faktury: ${error.message}`)
  }

  return (data ?? []) as ReceivedInvoiceRow[]
}

export async function getReceivedInvoiceBadgeCount() {
  const { supabase } = await requireAdminSupabaseContext()
  const today = getPragueTodayDateOnly()

  const { count, error } = await supabase
    .from('received_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'unpaid')
    .not('due_date', 'is', null)
    .lte('due_date', today)

  if (error) {
    throw new Error(`Nepodařilo se načíst počet faktur: ${error.message}`)
  }

  return count ?? 0
}

export async function getReceivedInvoiceSignedUrl(params: {
  invoiceId: string
  download?: boolean
}) {
  const { supabase } = await requireAdminSupabaseContext()
  const invoiceId = String(params.invoiceId ?? '').trim()

  if (!invoiceId) {
    throw new Error('Chybí ID faktury.')
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from('received_invoices')
    .select('id, file_path, file_name')
    .eq('id', invoiceId)
    .single()

  if (invoiceError || !invoice) {
    throw new Error('Faktura nebyla nalezena.')
  }

  const typedInvoice = invoice as { id: string; file_path: string; file_name: string }

  const { data: signed, error: signedError } = await supabase.storage
    .from(RECEIVED_INVOICES_BUCKET)
    .createSignedUrl(String(typedInvoice.file_path), 60 * 10, {
      download: params.download ? String(typedInvoice.file_name) : undefined,
    })

  if (signedError || !signed?.signedUrl) {
    throw new Error('Nepodařilo se získat odkaz na soubor.')
  }

  return signed.signedUrl
}

export async function setReceivedInvoiceStatus(params: {
  invoiceId: string
  status: string
}) {
  const { supabase } = await requireAdminSupabaseContext()
  const invoiceId = String(params.invoiceId ?? '').trim()

  if (!invoiceId) {
    throw new Error('Chybí ID faktury.')
  }

  if (!isReceivedInvoiceStatus(params.status)) {
    throw new Error('Neplatný stav faktury.')
  }

  const { data, error } = await supabase
    .from('received_invoices')
    .update({ status: params.status })
    .eq('id', invoiceId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error('Nepodařilo se změnit stav faktury.')
  }

  return data as ReceivedInvoiceRow
}

export async function setReceivedInvoiceDueDate(params: {
  invoiceId: string
  dueDate: string | null
}) {
  const { supabase } = await requireAdminSupabaseContext()
  const invoiceId = String(params.invoiceId ?? '').trim()

  if (!invoiceId) {
    throw new Error('Chybí ID faktury.')
  }

  const normalizedDueDate = params.dueDate ? String(params.dueDate).trim() : null
  if (normalizedDueDate && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDueDate)) {
    throw new Error('Neplatné datum splatnosti.')
  }

  const { data, error } = await supabase
    .from('received_invoices')
    .update({ due_date: normalizedDueDate })
    .eq('id', invoiceId)
    .select('*')
    .single()

  if (error || !data) {
    throw new Error('Nepodařilo se upravit datum splatnosti.')
  }

  return data as ReceivedInvoiceRow
}

export async function deleteReceivedInvoice(invoiceId: string) {
  const { supabase } = await requireAdminSupabaseContext()
  const normalizedId = String(invoiceId ?? '').trim()

  if (!normalizedId) {
    throw new Error('Chybí ID faktury.')
  }

  const { data: invoice, error: fetchError } = await supabase
    .from('received_invoices')
    .select('id, file_path')
    .eq('id', normalizedId)
    .single()

  if (fetchError || !invoice) {
    throw new Error('Faktura nebyla nalezena.')
  }

  const { error: storageError } = await supabase
    .storage
    .from(RECEIVED_INVOICES_BUCKET)
    .remove([String((invoice as { file_path: string }).file_path)])

  if (storageError) {
    throw new Error(`Nepodařilo se smazat soubor ze storage: ${storageError.message}`)
  }

  const { error: deleteError } = await supabase
    .from('received_invoices')
    .delete()
    .eq('id', normalizedId)

  if (deleteError) {
    throw new Error('Nepodařilo se smazat evidenci faktury.')
  }
}

export async function archiveReceivedInvoiceNotifications(invoiceId: string) {
  const { supabase } = await requireAdminSupabaseContext()
  const normalizedId = String(invoiceId ?? '').trim()

  if (!normalizedId) return

  const { error } = await supabase
    .from('notifications')
    .update({
      archived_at: new Date().toISOString(),
      read_at: new Date().toISOString(),
    })
    .eq('entity_type', 'received_invoice')
    .eq('entity_id', normalizedId)
    .is('archived_at', null)

  if (error) {
    throw new Error(`Nepodařilo se archivovat notifikace faktury: ${error.message}`)
  }
}
