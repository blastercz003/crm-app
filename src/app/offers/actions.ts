'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createNotification } from '@/lib/notifications/createNotification'
import { reportActionError } from '@/lib/errors/reportActionError'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import { getOfferApprover, getOfferRuntimeContext } from '@/lib/offers/permissions'
import { optimizeUploadFile } from '@/lib/uploads/optimize-upload-file'
import {
  BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL,
  BSAFE24_BACKUP_LOCATION_COUNT_PRESETS,
  BSAFE24_BACKUP_LOCATION_GROUP_LABEL,
  BSAFE24_BACKUP_LOCATION_PRESETS,
  BSAFE24_DEPOT_PRESETS,
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_DEPOT_PRESETS,
  OFFER_DEPOT_SELECTION_LIMIT,
  OFFER_ITEM_SECTION_NOTE_GROUP_LABEL,
  OFFER_SERVICE_PRESET_ALIASES,
  OFFER_SERVICE_GROUP_LABEL,
  OFFER_SERVICE_PRESETS,
} from '@/lib/offers/presets'
import type { OfferOrderFileRow, OfferRow, OfferStatus, OfferType } from '@/lib/offers/types'

export type OfferFormActionState = {
  success: boolean
  error: string | null
  offerId?: string
}

export type OfferFormOptions = {
  clients: Array<{ id: string; name: string }>
  contacts: Array<{ id: string; client_id: string; name: string; is_primary: boolean }>
}

export async function getOfferFormOptionsAction(): Promise<OfferFormOptions> {
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()
  let clientsQuery = supabase.from('clients').select('id, name').order('name', { ascending: true })
  if (!isAdmin) clientsQuery = clientsQuery.eq('created_by', profile.id)

  const [clientsResponse, contactsResponse] = await Promise.all([
    clientsQuery,
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  if (clientsResponse.error || contactsResponse.error) {
    throw new Error('Nepodařilo se načíst klienty pro formulář nabídky.')
  }

  return { clients: clientsResponse.data ?? [], contacts: contactsResponse.data ?? [] }
}

export type OfferItemInput = {
  description: string
  specification?: string | null
  unitPrice: number
  plannedUnitPrice?: number | null
  unit: string
  quantity: number
  discountPercent: number
  itemSection: string
}

export type SaveOfferItemsActionState = {
  success: boolean
  error: string | null
}

export type OfferOrderFileListItem = {
  id: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  createdAt: string
}

export type OfferOrderData = {
  orderReference: string | null
  files: OfferOrderFileListItem[]
}

export type UploadOfferOrderFileActionState =
  | {
      success: true
      error: null
      fileId: string
      orderReference: string | null
    }
  | {
      success: false
      error: string
      fileId: null
      orderReference: string | null
    }

export type SaveOfferOrderReferenceActionState =
  | {
      success: true
      error: null
      orderReference: string | null
    }
  | {
      success: false
      error: string
      orderReference: string | null
    }

export type OpenOfferOrderFileActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

export type DownloadOfferOrderFileActionState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

const OFFER_ORDER_FILES_BUCKET = 'offer-orders'
const OFFER_ORDER_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024
const OFFER_ORDER_ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/bmp',
  'image/tiff',
])
const OFFER_ORDER_ALLOWED_PDF_MIME_TYPES = new Set(['application/pdf'])

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key)
  return value || null
}

function getOptionalContactId(formData: FormData) {
  return getOptionalString(formData, 'client_contact_id')
}

function getNumber(formData: FormData, key: string, fallback = 0) {
  const raw = getString(formData, key).replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getOptionalNumber(formData: FormData, key: string) {
  const raw = getString(formData, key).replace(',', '.')
  if (!raw) return null

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function sanitizeOfferOrderFileName(value: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  const safe = normalized.replace(/[^a-zA-Z0-9._\-() ,'!*$&@=;:+?]/g, '_')
  return safe.length > 0 ? safe : 'soubor'
}

function buildOfferOrderStoragePath(offerId: string, fileName: string) {
  const safeName = sanitizeOfferOrderFileName(fileName)
  return `offer/${offerId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`
}

function isOfferOrderPdfMimeType(mimeType: string) {
  return OFFER_ORDER_ALLOWED_PDF_MIME_TYPES.has(mimeType)
}

function isOfferOrderImageMimeType(mimeType: string) {
  return OFFER_ORDER_ALLOWED_IMAGE_MIME_TYPES.has(mimeType)
}

function normalizeOrderReference(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized : null
}

async function prepareOfferOrderUploadFile(file: File) {
  const originalMimeType = String(file.type ?? '').trim().toLowerCase()

  if (!isOfferOrderPdfMimeType(originalMimeType) && !isOfferOrderImageMimeType(originalMimeType)) {
    throw new Error('Podporované jsou pouze PDF a obrázky.')
  }

  if (isOfferOrderPdfMimeType(originalMimeType)) {
    if (file.size > OFFER_ORDER_MAX_FILE_SIZE_BYTES) {
      throw new Error(`Soubor "${file.name}" překračuje limit 2 MB.`)
    }

    return file
  }

  let optimizedFile = file

  try {
    optimizedFile = await optimizeUploadFile(file)
  } catch {
    optimizedFile = file
  }

  if (optimizedFile.size <= OFFER_ORDER_MAX_FILE_SIZE_BYTES) {
    return optimizedFile
  }

  if (file.size <= OFFER_ORDER_MAX_FILE_SIZE_BYTES) {
    return file
  }

  throw new Error(`Soubor "${file.name}" překračuje limit 2 MB i po optimalizaci.`)
}

async function updateOfferOrderReferenceInternal(params: {
  supabase: Awaited<ReturnType<typeof getOfferRuntimeContext>>['supabase']
  profileId: string
  offer: OfferRow
  nextValue: string | null
}) {
  const { supabase, profileId, offer, nextValue } = params
  const previousValue = normalizeOrderReference(offer.order_reference)
  const normalizedNextValue = normalizeOrderReference(nextValue)

  if (previousValue === normalizedNextValue) {
    return normalizedNextValue
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('offers')
    .update({
      order_reference: normalizedNextValue,
      last_edited_by: profileId,
      updated_at: now,
    })
    .eq('id', offer.id)

  if (error) {
    throw new Error(`Nepodařilo se uložit číslo objednávky: ${error.message}`)
  }

  await logUserActivity({
    action: normalizedNextValue
      ? `Změnil číslo objednávky u nabídky ${offer.offer_number} na ${normalizedNextValue}`
      : `Vymazal číslo objednávky u nabídky ${offer.offer_number}`,
    section: 'Nabídky',
    route: `/offers/${offer.id}`,
    userId: profileId,
  })

  return normalizedNextValue
}

async function getOfferOrderFilesCount(
  supabase: Awaited<ReturnType<typeof getOfferRuntimeContext>>['supabase'],
  offerId: string
) {
  const { count, error } = await supabase
    .from('offer_order_files')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se ověřit podklady k objednávce: ${error.message}`)
  }

  return count ?? 0
}

function getDateTimeOrNull(formData: FormData, key: string) {
  const value = getString(formData, key)
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function getOfferType(formData: FormData): OfferType {
  const value = getString(formData, 'offer_type')
  return value === 'bsafe24' ? 'bsafe24' : 'classic'
}

function getAllowedManualStatusTargets(
  currentStatus: OfferStatus,
  isAdmin: boolean
): OfferStatus[] {
  const baseMap: Record<OfferStatus, OfferStatus[]> = {
    draft: ['submitted'],
    submitted: ['draft'],
    changes_requested: ['draft', 'submitted', 'in_progress'],
    approved: ['sent_to_client', 'draft', 'realizace'],
    sent_to_client: ['in_progress', 'ordered', 'rejected', 'draft', 'realizace'],
    in_progress: ['sent_to_client', 'ordered', 'rejected', 'draft', 'realizace'],
    ordered: ['in_progress', 'sent_to_client', 'draft', 'rejected', 'realizace'],
    rejected: ['in_progress', 'sent_to_client', 'draft', 'ordered', 'realizace'],
    realizace: ['draft'],
  }

  const targets = baseMap[currentStatus] ?? []

  // Keep "K úpravě" out of the list-switcher target states.
  const withoutChangesRequested = targets.filter((status) => status !== 'changes_requested')

  if (isAdmin) return withoutChangesRequested

  // Non-admin users cannot force approval from the list.
  return withoutChangesRequested.filter((status) => status !== 'approved')
}

async function createOfferNumber(
  supabase: Awaited<ReturnType<typeof getOfferRuntimeContext>>['supabase']
) {
  const { data, error } = await supabase.rpc('next_offer_number')

  if (error || typeof data !== 'string') {
    throw new Error(
      `Nepodařilo se vygenerovat číslo nabídky: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  return data
}

function getDefaultValidUntilDate() {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date.toISOString().slice(0, 10)
}

async function ensureClientAccess(clientId: string) {
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let query = supabase
    .from('clients')
    .select('id, name, created_by')
    .eq('id', clientId)

  if (!isAdmin) {
    query = query.eq('created_by', profile.id)
  }

  const { data, error } = await query.single<{
    id: string
    name: string | null
    created_by: string | null
  }>()

  if (error || !data) {
    throw new Error('Vybraný klient nebyl nalezen nebo k němu nemáš oprávnění.')
  }

  return { supabase, profile, isAdmin, client: data }
}

async function resolveOfferContact(params: {
  supabase: Awaited<ReturnType<typeof getOfferRuntimeContext>>['supabase']
  clientId: string
  contactId: string | null
  fallbackContactPerson: string | null
}) {
  const { supabase, clientId, contactId, fallbackContactPerson } = params

  if (!contactId) {
    return {
      contactId: null,
      contactPerson: fallbackContactPerson,
    }
  }

  const { data, error } = await supabase
    .from('client_contacts')
    .select('id, client_id, name')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .single()

  if (error || !data) {
    throw new Error('Vybraná kontaktní osoba nebyla nalezena.')
  }

  return {
    contactId: data.id,
    contactPerson: data.name ?? fallbackContactPerson,
  }
}

async function loadOfferForAction(offerId: string) {
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let query = supabase.from('offers').select('*').eq('id', offerId)

  if (!isAdmin) {
    query = query.eq('created_by', profile.id)
  }

  const { data, error } = await query.single<OfferRow>()

  if (error || !data) {
    throw new Error('Nabídka nebyla nalezena nebo k ní nemáš oprávnění.')
  }

  return { supabase, profile, isAdmin, offer: data }
}

function isApprovalLockedStatus(status: OfferStatus) {
  return ['approved', 'sent_to_client', 'in_progress', 'ordered', 'rejected', 'realizace'].includes(status)
}

function getOfferStatusActivityLabel(status: OfferStatus) {
  const map: Record<OfferStatus, string> = {
    draft: 'Rozpracováno',
    submitted: 'Ke schválení',
    changes_requested: 'Vráceno k úpravě',
    approved: 'Schváleno',
    sent_to_client: 'Odesláno klientovi',
    in_progress: 'V řešení',
    ordered: 'Objednáno',
    rejected: 'Zamítnuto',
    realizace: 'Realizace',
  }

  return map[status] ?? status
}

async function touchOfferVersion(
  offerId: string,
  editorId: string,
  options?: { requiresApprovalReset?: boolean }
) {
  const { supabase, offer } = await loadOfferForAction(offerId)
  const requiresApprovalReset = options?.requiresApprovalReset ?? true
  const shouldResetApproval = requiresApprovalReset && isApprovalLockedStatus(offer.status)
  const shouldBumpVersion = shouldResetApproval || !isApprovalLockedStatus(offer.status)
  const nextStatus = shouldResetApproval ? 'draft' : offer.status

  const { error } = await supabase
    .from('offers')
    .update({
      status: nextStatus,
      current_version: shouldBumpVersion ? offer.current_version + 1 : offer.current_version,
      last_edited_by: editorId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se aktualizovat verzi nabídky: ${error.message}`)
  }
}

export async function createOfferModalAction(
  _prevState: OfferFormActionState,
  formData: FormData
): Promise<OfferFormActionState> {
  try {
    const clientId = getString(formData, 'client_id')
    const contactId = getOptionalContactId(formData)
    const title = getString(formData, 'title')
    const offerType = getOfferType(formData)

    if (!clientId) {
      throw new Error('Vyber klienta.')
    }

    if (!title) {
      throw new Error('Název nabídky je povinný.')
    }

    const { supabase, profile } = await ensureClientAccess(clientId)
    const resolvedContact = await resolveOfferContact({
      supabase,
      clientId,
      contactId,
      fallbackContactPerson: getOptionalString(formData, 'contact_person'),
    })
    const offerNumber = await createOfferNumber(supabase)

    const { data, error } = await supabase
      .from('offers')
      .insert({
        offer_number: offerNumber,
        client_id: clientId,
        client_contact_id: resolvedContact.contactId,
        created_by: profile.id,
        last_edited_by: profile.id,
        title,
        offer_type: offerType,
        project_name: getOptionalString(formData, 'project_name'),
        realization_address: getOptionalString(formData, 'realization_address'),
        contact_person: resolvedContact.contactPerson,
        prepared_by_name: profile.offer_prepared_by_name ?? profile.name,
        prepared_by_phone: profile.offer_prepared_by_phone,
        prepared_by_email: profile.offer_prepared_by_email,
        valid_until: getDefaultValidUntilDate(),
        intro_note: getOptionalString(formData, 'intro_note'),
        internal_note: getOptionalString(formData, 'internal_note'),
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) {
      throw new Error(`Nepodařilo se vytvořit nabídku: ${error?.message ?? 'Neznámá chyba'}`)
    }

    const defaultServiceItems =
      offerType === 'bsafe24'
        ? [
            {
              offer_id: data.id,
              position: 1,
              service_name: 'NE',
              specification: BSAFE24_BACKUP_LOCATION_GROUP_LABEL,
              operation: 'Vybráno',
            },
            {
              offer_id: data.id,
              position: 2,
              service_name: '5 VÝJEZDOVÝCH DEP V ČR',
              specification: OFFER_DEPOT_GROUP_LABEL,
              operation: 'Vybráno',
            },
          ]
        : [
            ...OFFER_SERVICE_PRESETS.map((serviceName, index) => ({
              offer_id: data.id,
              position: index + 1,
              service_name: serviceName,
              specification: OFFER_SERVICE_GROUP_LABEL,
              operation: 'Vybráno',
            })),
            {
              offer_id: data.id,
              position: OFFER_SERVICE_PRESETS.length + 1,
              service_name: 'PRAHA',
              specification: OFFER_DEPOT_GROUP_LABEL,
              operation: 'Vybráno',
            },
          ]

    const { error: defaultsError } = await supabase
      .from('offer_service_items')
      .insert(defaultServiceItems)

    if (defaultsError) {
      throw new Error(`Nabídka byla vytvořena, ale nepodařilo se nastavit výchozí služby: ${defaultsError.message}`)
    }

    revalidatePath('/offers')
    revalidatePath(`/clients/${clientId}`)

    return {
      success: true,
      error: null,
      offerId: data.id,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'createOfferModalAction',
      section: 'offers',
      errorType: 'CreateOfferModalActionError',
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se vytvořit nabídku.',
    }
  }
}

export async function updateOfferDetails(offerId: string, formData: FormData) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const title = getString(formData, 'title')
  const contactId = getOptionalContactId(formData)

  if (!title) {
    throw new Error('Název nabídky je povinný.')
  }

  const shouldResetApproval = false
  const nextVersion =
    isApprovalLockedStatus(offer.status) && !shouldResetApproval
      ? offer.current_version
      : offer.current_version + 1
  const nextStatus =
    isApprovalLockedStatus(offer.status) && shouldResetApproval
      ? 'draft'
      : offer.status
  const resolvedContact = await resolveOfferContact({
    supabase,
    clientId: offer.client_id,
    contactId,
    fallbackContactPerson: getOptionalString(formData, 'contact_person'),
  })

  const { error } = await supabase
    .from('offers')
    .update({
      title,
      project_name: getOptionalString(formData, 'project_name'),
      realization_address: getOptionalString(formData, 'realization_address'),
      realization_starts_at: getDateTimeOrNull(formData, 'realization_starts_at'),
      realization_ends_at: getDateTimeOrNull(formData, 'realization_ends_at'),
      client_contact_id: resolvedContact.contactId,
      contact_person: resolvedContact.contactPerson,
      prepared_by_name: getOptionalString(formData, 'prepared_by_name'),
      prepared_by_phone: getOptionalString(formData, 'prepared_by_phone'),
      prepared_by_email: getOptionalString(formData, 'prepared_by_email'),
      valid_until: getOptionalString(formData, 'valid_until'),
      intro_note: getOptionalString(formData, 'intro_note'),
      internal_note: getOptionalString(formData, 'internal_note'),
      terms_note: getOptionalString(formData, 'terms_note'),
      status: nextStatus,
      current_version: nextVersion,
      last_edited_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se uložit nabídku: ${error.message}`)
  }

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  redirect(`/offers/${offerId}?saved=1`)
}

export async function updateOfferInternalNote(offerId: string, formData: FormData) {
  const { supabase } = await loadOfferForAction(offerId)

  const { error } = await supabase
    .from('offers')
    .update({
      internal_note: getOptionalString(formData, 'internal_note'),
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se uložit poznámku: ${error.message}`)
  }

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
}

export async function deleteOffer(offerId: string) {
  const { supabase, offer } = await loadOfferForAction(offerId)

  const clientId = offer.client_id
  const { error } = await supabase.from('offers').delete().eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se smazat nabídku: ${error.message}`)
  }

  revalidatePath('/offers')
  revalidatePath(`/clients/${clientId}`)
  redirect('/offers')
}

export async function addOfferItem(offerId: string, formData: FormData) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const description = getString(formData, 'description')
  const itemSection = getString(formData, 'item_section') || 'main'

  if (!description) {
    revalidatePath(`/offers/${offerId}`)
    return
  }

  const { count, error: countError } = await supabase
    .from('offer_items')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId)
    .eq('item_section', itemSection)

  if (countError) {
    throw new Error(`Nepodařilo se načíst položky nabídky: ${countError.message}`)
  }

  const { error } = await supabase.from('offer_items').insert({
    offer_id: offerId,
    position: (count ?? 0) + 1,
    item_section: itemSection,
    description,
    specification: getOptionalString(formData, 'specification'),
    quantity: getNumber(formData, 'quantity', 1),
    unit: getString(formData, 'unit') || 'ks',
    unit_price_without_vat: getNumber(formData, 'unit_price_without_vat', 0),
    planned_unit_price_without_vat: getOptionalNumber(formData, 'planned_unit_price_without_vat'),
    discount_percent: getNumber(formData, 'discount_percent', 0),
    vat_rate: 21,
  })

  if (error) {
    throw new Error(`Nepodařilo se přidat položku: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id)

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function updateOfferItem(itemId: string, formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const description = getString(formData, 'description')

  if (!description) {
    revalidatePath(`/offers/${offerId}`)
    return
  }

  const { error } = await supabase
    .from('offer_items')
    .update({
      description,
      specification: getOptionalString(formData, 'specification'),
      quantity: getNumber(formData, 'quantity', 1),
      unit: getString(formData, 'unit') || 'ks',
      unit_price_without_vat: getNumber(formData, 'unit_price_without_vat', 0),
      planned_unit_price_without_vat: getOptionalNumber(formData, 'planned_unit_price_without_vat'),
      discount_percent: getNumber(formData, 'discount_percent', 0),
      vat_rate: 21,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('offer_id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se upravit položku: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id)

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function saveOfferItemsAction(
  offerId: string,
  itemSection: string,
  items: OfferItemInput[],
  sectionNote = ''
): Promise<SaveOfferItemsActionState> {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const normalizedSection = String(itemSection ?? '').trim() || 'main'

  if (!Array.isArray(items)) {
    return {
      success: false,
      error: 'Položky nabídky nejsou ve správném formátu.',
    }
  }

  const normalizedItems = items
    .map((item, index) => {
      const description = String(item.description ?? '').trim()
      const specification = String(item.specification ?? '').trim() || null
      const unit = String(item.unit ?? '').trim() || 'ks'
      const unitPrice = Number(item.unitPrice)
      const plannedUnitPrice = item.plannedUnitPrice == null ? null : Number(item.plannedUnitPrice)
      const quantity = Number(item.quantity)
      const discountPercent = Number(item.discountPercent)

      if (!description) {
        return {
          success: false as const,
          error: 'Každý řádek nabídky musí mít vyplněnou položku.',
          row: null,
        }
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return {
          success: false as const,
          error: `Jednotková cena u položky "${description}" není platná.`,
          row: null,
        }
      }

      if (plannedUnitPrice !== null && (!Number.isFinite(plannedUnitPrice) || plannedUnitPrice < 0)) {
        return {
          success: false as const,
          error: `Plánovaná cena u položky "${description}" není platná.`,
          row: null,
        }
      }

      if (!Number.isFinite(quantity) || quantity < 0) {
        return {
          success: false as const,
          error: `Množství u položky "${description}" není platné.`,
          row: null,
        }
      }

      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        return {
          success: false as const,
          error: `Sleva u položky "${description}" musí být v rozmezí 0 až 100 %.`,
          row: null,
        }
      }

      return {
        success: true as const,
        error: null,
        row: {
          offer_id: offerId,
          position: index + 1,
          item_section: normalizedSection,
          description,
          specification,
          quantity,
          unit,
          unit_price_without_vat: unitPrice,
          planned_unit_price_without_vat: plannedUnitPrice,
          discount_percent: discountPercent,
          vat_rate: 21,
        },
      }
    })

  const validationError = normalizedItems.find((item) => !item.success)

  if (validationError && !validationError.success) {
    return {
      success: false,
      error: validationError.error,
    }
  }

  const rowsToInsert = normalizedItems
    .filter(
      (
        item
      ): item is Extract<typeof item, { success: true; row: NonNullable<typeof item.row> }> =>
        item.success && Boolean(item.row)
    )
    .map((item) => item.row)

  const deleteQuery = supabase
    .from('offer_items')
    .delete()
    .eq('offer_id', offerId)

  const { error: deleteError } =
    offer.offer_type === 'bsafe24' && normalizedSection === 'bsafe_service'
      ? await deleteQuery.in('item_section', ['bsafe_service', 'main'])
      : offer.offer_type === 'bsafe24' && normalizedSection === 'bsafe_realization'
        ? await deleteQuery.in('item_section', ['bsafe_realization', 'bsafe_planned_trip'])
      : offer.offer_type === 'classic' && normalizedSection === 'classic_generators'
        ? await deleteQuery.in('item_section', ['classic_generators', 'main'])
      : await deleteQuery.eq('item_section', normalizedSection)

  if (deleteError) {
    return {
      success: false,
      error: `Původní položky nabídky se nepodařilo aktualizovat: ${deleteError.message}`,
    }
  }

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('offer_items')
      .insert(rowsToInsert)

    if (insertError) {
      return {
        success: false,
        error: `Položky nabídky se nepodařilo uložit: ${insertError.message}`,
      }
    }
  }

  const normalizedSectionNote = String(sectionNote ?? '').trim()

  const { data: existingSectionNote, error: existingSectionNoteError } = await supabase
    .from('offer_service_items')
    .select('id')
    .eq('offer_id', offerId)
    .eq('specification', OFFER_ITEM_SECTION_NOTE_GROUP_LABEL)
    .eq('service_name', normalizedSection)
    .maybeSingle<{ id: string }>()

  if (existingSectionNoteError) {
    return {
      success: false,
      error: `Poznámku sekce se nepodařilo ověřit: ${existingSectionNoteError.message}`,
    }
  }

  if (existingSectionNote) {
    const { error: noteUpdateError } = await supabase
      .from('offer_service_items')
      .update({
        operation: normalizedSectionNote,
      })
      .eq('id', existingSectionNote.id)
      .eq('offer_id', offerId)

    if (noteUpdateError) {
      return {
        success: false,
        error: `Poznámku sekce se nepodařilo uložit: ${noteUpdateError.message}`,
      }
    }
  } else {
    const { count, error: noteCountError } = await supabase
      .from('offer_service_items')
      .select('id', { count: 'exact', head: true })
      .eq('offer_id', offerId)

    if (noteCountError) {
      return {
        success: false,
        error: `Poznámku sekce se nepodařilo připravit: ${noteCountError.message}`,
      }
    }

    const { error: noteInsertError } = await supabase.from('offer_service_items').insert({
      offer_id: offerId,
      position: (count ?? 0) + 1,
      service_name: normalizedSection,
      specification: OFFER_ITEM_SECTION_NOTE_GROUP_LABEL,
      operation: normalizedSectionNote,
    })

    if (noteInsertError) {
      return {
        success: false,
        error: `Poznámku sekce se nepodařilo uložit: ${noteInsertError.message}`,
      }
    }
  }

  await touchOfferVersion(offerId, profile.id)

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)

  return {
    success: true,
    error: null,
  }
}

export async function moveOfferItem(itemId: string, direction: 'up' | 'down', formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { data: currentItem, error: currentError } = await supabase
    .from('offer_items')
    .select('id, position, item_section')
    .eq('id', itemId)
    .eq('offer_id', offerId)
    .single<{ id: string; position: number; item_section: string }>()

  if (currentError || !currentItem) {
    throw new Error('Položka nabídky nebyla nalezena.')
  }

  const neighborQuery = supabase
    .from('offer_items')
    .select('id, position')
    .eq('offer_id', offerId)
    .eq('item_section', currentItem.item_section)
    .order('position', { ascending: direction === 'down' })
    .limit(1)

  const { data: neighbor, error: neighborError } =
    direction === 'up'
      ? await neighborQuery.lt('position', currentItem.position).maybeSingle<{ id: string; position: number }>()
      : await neighborQuery.gt('position', currentItem.position).maybeSingle<{ id: string; position: number }>()

  if (neighborError) {
    throw new Error(`Nepodařilo se změnit pořadí položky: ${neighborError.message}`)
  }

  if (!neighbor) {
    revalidatePath(`/offers/${offerId}`)
    return
  }

  const now = new Date().toISOString()
  const { error: currentUpdateError } = await supabase
    .from('offer_items')
    .update({ position: neighbor.position, updated_at: now })
    .eq('id', currentItem.id)
    .eq('offer_id', offerId)

  if (currentUpdateError) {
    throw new Error(`Nepodařilo se změnit pořadí položky: ${currentUpdateError.message}`)
  }

  const { error: neighborUpdateError } = await supabase
    .from('offer_items')
    .update({ position: currentItem.position, updated_at: now })
    .eq('id', neighbor.id)
    .eq('offer_id', offerId)

  if (neighborUpdateError) {
    throw new Error(`Nepodařilo se změnit pořadí položky: ${neighborUpdateError.message}`)
  }

  await touchOfferVersion(offerId, profile.id)

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function addOfferServiceItem(offerId: string, formData: FormData) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const serviceName = getString(formData, 'service_name')

  if (!serviceName) {
    throw new Error('Název služby je povinný.')
  }

  const { count, error: countError } = await supabase
    .from('offer_service_items')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId)

  if (countError) {
    throw new Error(`Nepodařilo se načíst rozsah služby: ${countError.message}`)
  }

  const { error } = await supabase.from('offer_service_items').insert({
    offer_id: offerId,
    position: (count ?? 0) + 1,
    service_name: serviceName,
    specification: getOptionalString(formData, 'specification'),
    operation: getOptionalString(formData, 'operation'),
  })

  if (error) {
    throw new Error(`Nepodařilo se přidat službu: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id, { requiresApprovalReset: false })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function updateOfferServiceItem(itemId: string, formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)
  const serviceName = getString(formData, 'service_name')

  if (!serviceName) {
    throw new Error('Název služby je povinný.')
  }

  const { error } = await supabase
    .from('offer_service_items')
    .update({
      service_name: serviceName,
      specification: getOptionalString(formData, 'specification'),
      operation: getOptionalString(formData, 'operation'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .eq('offer_id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se upravit službu: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id, { requiresApprovalReset: false })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function toggleOfferPresetItem(offerId: string, formData: FormData) {
  const group = getString(formData, 'group')
  const value = getString(formData, 'value')
  const allowedValues =
    group === OFFER_SERVICE_GROUP_LABEL
      ? OFFER_SERVICE_PRESETS
      : group === OFFER_DEPOT_GROUP_LABEL
        ? OFFER_DEPOT_PRESETS
        : null

  if (!allowedValues || !(allowedValues as readonly string[]).includes(value)) {
    throw new Error('Vybraná položka nabídky není platná.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { data: existing, error: existingError } = await supabase
    .from('offer_service_items')
    .select('id')
    .eq('offer_id', offerId)
    .eq('service_name', value)
    .eq('specification', group)
    .maybeSingle<{ id: string }>()

  if (existingError) {
    throw new Error(`Nepodařilo se ověřit položku nabídky: ${existingError.message}`)
  }

  if (!existing && group === OFFER_DEPOT_GROUP_LABEL) {
    const { count, error: depotCountError } = await supabase
      .from('offer_service_items')
      .select('id', { count: 'exact', head: true })
      .eq('offer_id', offerId)
      .eq('specification', OFFER_DEPOT_GROUP_LABEL)

    if (depotCountError) {
      throw new Error(`Nepodařilo se ověřit počet vybraných dep: ${depotCountError.message}`)
    }

    if ((count ?? 0) >= OFFER_DEPOT_SELECTION_LIMIT) {
      throw new Error(`U klasické nabídky lze vybrat maximálně ${OFFER_DEPOT_SELECTION_LIMIT} depa.`)
    }
  }

  let aliasExisting: { id: string } | null = null

  if (!existing && group === OFFER_SERVICE_GROUP_LABEL) {
    const aliasValue = Object.entries(OFFER_SERVICE_PRESET_ALIASES).find(
      ([, nextValue]) => nextValue === value
    )?.[0]

    if (aliasValue) {
      const { data, error } = await supabase
        .from('offer_service_items')
        .select('id')
        .eq('offer_id', offerId)
        .eq('service_name', aliasValue)
        .eq('specification', group)
        .maybeSingle<{ id: string }>()

      if (error) {
        throw new Error(`Nepodařilo se ověřit položku nabídky: ${error.message}`)
      }

      aliasExisting = data
    }
  }

  if (existing || aliasExisting) {
    const { error } = await supabase
      .from('offer_service_items')
      .delete()
      .eq('id', (existing ?? aliasExisting)?.id)
      .eq('offer_id', offerId)

    if (error) {
      throw new Error(`Nepodařilo se odebrat položku nabídky: ${error.message}`)
    }
  } else {
    const { count, error: countError } = await supabase
      .from('offer_service_items')
      .select('id', { count: 'exact', head: true })
      .eq('offer_id', offerId)

    if (countError) {
      throw new Error(`Nepodařilo se načíst položky nabídky: ${countError.message}`)
    }

    const { error } = await supabase.from('offer_service_items').insert({
      offer_id: offerId,
      position: (count ?? 0) + 1,
      service_name: value,
      specification: group,
      operation: 'Vybráno',
    })

    if (error) {
      throw new Error(`Nepodařilo se přidat položku nabídky: ${error.message}`)
    }
  }

  await touchOfferVersion(offerId, profile.id, { requiresApprovalReset: false })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function setOfferPresetChoice(offerId: string, formData: FormData) {
  const group = getString(formData, 'group')
  const value = getString(formData, 'value')
  const allowedValues =
    group === BSAFE24_BACKUP_LOCATION_GROUP_LABEL
      ? BSAFE24_BACKUP_LOCATION_PRESETS
      : group === BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL
        ? BSAFE24_BACKUP_LOCATION_COUNT_PRESETS
        : group === OFFER_DEPOT_GROUP_LABEL
          ? BSAFE24_DEPOT_PRESETS
          : null

  if (!allowedValues || !(allowedValues as readonly string[]).includes(value)) {
    throw new Error('Vybraná položka nabídky není platná.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { error: deleteError } = await supabase
    .from('offer_service_items')
    .delete()
    .eq('offer_id', offerId)
    .eq('specification', group)

  if (deleteError) {
    throw new Error(`Nepodařilo se změnit výběr nabídky: ${deleteError.message}`)
  }

  if (group === BSAFE24_BACKUP_LOCATION_GROUP_LABEL && value === 'NE') {
    const { error } = await supabase
      .from('offer_service_items')
      .delete()
      .eq('offer_id', offerId)
      .eq('specification', BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL)

    if (error) {
      throw new Error(`Nepodařilo se odebrat počet lokalit: ${error.message}`)
    }
  }

  const { count, error: countError } = await supabase
    .from('offer_service_items')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId)

  if (countError) {
    throw new Error(`Nepodařilo se načíst položky nabídky: ${countError.message}`)
  }

  const { error: insertError } = await supabase.from('offer_service_items').insert({
    offer_id: offerId,
    position: (count ?? 0) + 1,
    service_name: value,
    specification: group,
    operation: 'Vybráno',
  })

  if (insertError) {
    throw new Error(`Nepodařilo se uložit výběr nabídky: ${insertError.message}`)
  }

  await touchOfferVersion(offerId, profile.id, { requiresApprovalReset: false })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function deleteOfferServiceItem(itemId: string, formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { error } = await supabase
    .from('offer_service_items')
    .delete()
    .eq('id', itemId)
    .eq('offer_id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se odstranit službu: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id, { requiresApprovalReset: false })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function deleteOfferItem(itemId: string, formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { error } = await supabase
    .from('offer_items')
    .delete()
    .eq('id', itemId)
    .eq('offer_id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se odstranit položku: ${error.message}`)
  }

  await touchOfferVersion(offerId, profile.id)

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function submitOfferForApproval(offerId: string) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  if (offer.status === 'submitted' && offer.submitted_version === offer.current_version) {
    revalidatePath('/offers')
    revalidatePath(`/offers/${offerId}`)
    return
  }

  const approver = await getOfferApprover({ supabase })
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('offers')
    .update({
      status: 'submitted',
      submitted_version: offer.current_version,
      approver_user_id: approver.id,
      submitted_at: now,
      rejection_comment: null,
      last_edited_by: profile.id,
      updated_at: now,
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se odeslat nabídku ke schválení: ${error.message}`)
  }

  await createNotification({
    supabase,
    recipientUserId: approver.id,
    actorUserId: profile.id,
    category: 'offers',
    type: 'offer_approval_requested',
    title: 'Nabídka ke schválení',
    message: `${profile.name ?? 'Uživatel'} odeslal nabídku ${offer.offer_number} ke schválení.`,
    entityType: 'offer',
    entityId: offerId,
    href: `/offers/${offerId}`,
    priority: 'high',
    dedupeKey: `offer_approval_requested:${offerId}:${offer.current_version}`,
  })

  await logUserActivity({
    action: `Odeslal nabídku ${offer.offer_number} ke schválení`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function submitOfferForApprovalWithAutosave(
  offerId: string,
  formData: FormData
) {
  try {
    const { supabase, profile, offer } = await loadOfferForAction(offerId)
    const title = getString(formData, 'title')
    const contactId = getOptionalContactId(formData)

    if (!title) {
      return { success: false as const, error: 'Název nabídky je povinný.' }
    }

    const nextVersion = offer.current_version + 1
    const resolvedContact = await resolveOfferContact({
      supabase,
      clientId: offer.client_id,
      contactId,
      fallbackContactPerson: getOptionalString(formData, 'contact_person'),
    })

    const approver = await getOfferApprover({ supabase })
    const now = new Date().toISOString()

    const { error } = await supabase
      .from('offers')
      .update({
        title,
        project_name: getOptionalString(formData, 'project_name'),
        realization_address: getOptionalString(formData, 'realization_address'),
        realization_starts_at: getDateTimeOrNull(formData, 'realization_starts_at'),
        realization_ends_at: getDateTimeOrNull(formData, 'realization_ends_at'),
        client_contact_id: resolvedContact.contactId,
        contact_person: resolvedContact.contactPerson,
        prepared_by_name: getOptionalString(formData, 'prepared_by_name'),
        prepared_by_phone: getOptionalString(formData, 'prepared_by_phone'),
        prepared_by_email: getOptionalString(formData, 'prepared_by_email'),
        valid_until: getOptionalString(formData, 'valid_until'),
        intro_note: getOptionalString(formData, 'intro_note'),
        internal_note: getOptionalString(formData, 'internal_note'),
        terms_note: getOptionalString(formData, 'terms_note'),
        status: 'submitted',
        current_version: nextVersion,
        submitted_version: nextVersion,
        approver_user_id: approver.id,
        submitted_at: now,
        rejection_comment: null,
        last_edited_by: profile.id,
        updated_at: now,
      })
      .eq('id', offerId)

    if (error) {
      return {
        success: false as const,
        error: `Nepodařilo se odeslat nabídku ke schválení: ${error.message}`,
      }
    }

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_approval_requested',
      title: 'Nabídka ke schválení',
      message: `${profile.name ?? 'Uživatel'} odeslal nabídku ${offer.offer_number} ke schválení.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'high',
      dedupeKey: `offer_approval_requested:${offerId}:${nextVersion}`,
    })

    await logUserActivity({
      action: `Odeslal nabídku ${offer.offer_number} ke schválení (s autosave)`,
      section: 'Nabídky',
      route: `/offers/${offerId}`,
      userId: profile.id,
    })

    revalidatePath('/offers')
    revalidatePath(`/offers/${offerId}`)
    revalidatePath(`/clients/${offer.client_id}`)
    revalidatePath('/dashboard')
    revalidatePath('/notifications')

    return { success: true as const, error: null }
  } catch (error) {
    await reportActionError({
      error,
      action: 'sendOfferToClient',
      section: 'offers',
      errorType: 'SendOfferToClientError',
      context: { offerId },
    })
    return {
      success: false as const,
      error: error instanceof Error ? error.message : 'Nepodařilo se odeslat nabídku ke schválení.',
    }
  }
}

export async function approveOffer(offerId: string) {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)

  if (!isAdmin) {
    throw new Error('Nabídku může schválit pouze admin.')
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('offers')
    .update({
      status: 'approved',
      approved_version: offer.current_version,
      approver_user_id: profile.id,
      approved_at: now,
      rejection_comment: null,
      last_edited_by: profile.id,
      updated_at: now,
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se schválit nabídku: ${error.message}`)
  }

  await createNotification({
    supabase,
    recipientUserId: offer.created_by,
    actorUserId: profile.id,
    category: 'offers',
    type: 'offer_approved',
    title: 'Nabídka schválena',
    message: `Nabídka ${offer.offer_number} byla schválena.`,
    entityType: 'offer',
    entityId: offerId,
    href: `/offers/${offerId}`,
    priority: 'normal',
    dedupeKey: `offer_approved:${offerId}:${offer.current_version}`,
  })

  await logUserActivity({
    action: `Schválil nabídku ${offer.offer_number}`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function rejectOffer(offerId: string, formData: FormData) {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)

  if (!isAdmin) {
    throw new Error('Nabídku může vrátit pouze admin.')
  }

  const rejectionComment = getString(formData, 'rejection_comment')

  if (!rejectionComment) {
    throw new Error('Komentář k vrácení nabídky je povinný.')
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('offers')
    .update({
      status: 'changes_requested',
      approver_user_id: profile.id,
      rejected_at: now,
      rejection_comment: rejectionComment,
      last_edited_by: profile.id,
      updated_at: now,
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se vrátit nabídku k úpravě: ${error.message}`)
  }

  await createNotification({
    supabase,
    recipientUserId: offer.created_by,
    actorUserId: profile.id,
    category: 'offers',
    type: 'offer_rejected',
    title: 'Nabídka vrácena k úpravě',
    message: `Nabídka ${offer.offer_number} byla vrácena k úpravě: ${rejectionComment}`,
    entityType: 'offer',
    entityId: offerId,
    href: `/offers/${offerId}`,
    priority: 'high',
    dedupeKey: `offer_rejected:${offerId}:${offer.current_version}:${now}`,
  })

  await logUserActivity({
    action: `Vrácena nabídka ${offer.offer_number} k úpravě`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function sendOfferToClient(offerId: string) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  if (offer.status !== 'approved') {
    throw new Error('Klientovi lze odeslat pouze schválenou nabídku.')
  }

  const { error } = await supabase
    .from('offers')
    .update({
      status: 'sent_to_client',
      last_edited_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se označit nabídku jako odeslanou klientovi: ${error.message}`)
  }

  try {
    const approver = await getOfferApprover({ supabase })

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_sent_to_client',
      title: 'Nabídka odeslána klientovi',
      message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} odeslal nabídku ${offer.offer_number} klientovi.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'normal',
      dedupeKey: `offer_sent_to_client:${offerId}`,
    })
  } catch (error) {
    console.error('Nepodařilo se vytvořit notifikaci o odeslání nabídky klientovi.', error)
    await reportActionError({
      error,
      action: 'sendOfferToClient:notification',
      section: 'offers',
      errorType: 'OfferSentNotificationError',
      userId: profile.id,
      context: { offerId },
    })
  }

  await logUserActivity({
    action: `Odeslal nabídku ${offer.offer_number} klientovi`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function setOfferClientOutcome(
  offerId: string,
  status: 'ordered' | 'rejected',
  rejectionInput?: FormData | string
) {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)

  if (
    offer.status !== 'sent_to_client' &&
    offer.status !== 'in_progress' &&
    offer.status !== 'ordered' &&
    offer.status !== 'rejected'
  ) {
    throw new Error(
      'Výsledek od klienta lze nastavit pouze u nabídky odeslané klientovi nebo ve stavu V řešení.'
    )
  }

  const rejectionCommentValue =
    rejectionInput instanceof FormData
      ? String(rejectionInput.get('rejection_comment') ?? '')
      : String(rejectionInput ?? '')

  const normalizedRejectionComment =
    status === 'rejected' ? rejectionCommentValue.trim() : ''

  if (status === 'rejected' && !normalizedRejectionComment) {
    throw new Error('Důvod zamítnutí je povinný.')
  }

  const { error } = await supabase
    .from('offers')
    .update({
      status,
      rejection_comment: status === 'rejected' ? normalizedRejectionComment : null,
      last_edited_by: profile.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se změnit stav nabídky: ${error.message}`)
  }

  if (status === 'ordered' && !isAdmin) {
    const approver = await getOfferApprover({ supabase })

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_ordered',
      title: 'Nabídka objednána',
      message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} označil nabídku ${offer.offer_number} jako objednanou.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'high',
      dedupeKey: `offer_ordered:${offerId}`,
    })
  }

  await logUserActivity({
    action:
      status === 'ordered'
        ? `Nastavil výsledek nabídky ${offer.offer_number}: objednáno`
        : `Nastavil výsledek nabídky ${offer.offer_number}: zamítnuto (${normalizedRejectionComment})`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function setOfferStatusFromList(
  offerId: string,
  nextStatus: OfferStatus,
  rejectionComment?: string
) {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)
  const isOwner = offer.created_by === profile.id

  if (!isAdmin && !isOwner) {
    throw new Error('Stav nabídky může měnit pouze zakladatel nabídky nebo admin.')
  }

  if (nextStatus === 'changes_requested') {
    throw new Error('Stav K úpravě nelze přepnout z přehledu nabídek.')
  }

  const allowedTargets = getAllowedManualStatusTargets(offer.status, isAdmin)
  if (!allowedTargets.includes(nextStatus)) {
    throw new Error('Tento přechod stavu nabídky není povolený.')
  }

  if (nextStatus === 'realizace') {
    if (!isAdmin) {
      throw new Error('Do stavu REALIZACE může nabídku přepnout pouze admin.')
    }
  }

  const now = new Date().toISOString()
  const normalizedRejectionComment =
    nextStatus === 'rejected' ? String(rejectionComment ?? '').trim() : ''
  const patch: Partial<OfferRow> & { status: OfferStatus; updated_at: string; last_edited_by: string } = {
    status: nextStatus,
    updated_at: now,
    last_edited_by: profile.id,
  }

  if (nextStatus === 'submitted') {
    const approver = await getOfferApprover({ supabase })
    patch.submitted_version = offer.current_version
    patch.approver_user_id = approver.id
    patch.submitted_at = now
    patch.rejection_comment = null
  }

  if (nextStatus === 'approved') {
    patch.approved_version = offer.current_version
    patch.approved_at = now
  }

  if (nextStatus === 'draft') {
    patch.rejection_comment = null
  }

  if (nextStatus === 'realizace') {
    patch.rejection_comment = null
  }

  if (nextStatus === 'rejected') {
    if (!normalizedRejectionComment) {
      throw new Error('Důvod zamítnutí je povinný.')
    }
    patch.rejection_comment = normalizedRejectionComment
  }

  const { error } = await supabase.from('offers').update(patch).eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se změnit stav nabídky: ${error.message}`)
  }

  if (nextStatus === 'submitted') {
    const approver = await getOfferApprover({ supabase })

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_approval_requested',
      title: 'Nabídka ke schválení',
      message: `${profile.name ?? 'Uživatel'} odeslal nabídku ${offer.offer_number} ke schválení.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'high',
      dedupeKey: `offer_approval_requested:${offerId}:${offer.current_version}`,
    })
  }

  if (nextStatus === 'approved') {
    await createNotification({
      supabase,
      recipientUserId: offer.created_by,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_approved',
      title: 'Nabídka schválena',
      message: `Nabídka ${offer.offer_number} byla schválena.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'normal',
      dedupeKey: `offer_approved:${offerId}:${offer.current_version}`,
    })
  }

  if (nextStatus === 'sent_to_client') {
    try {
      const approver = await getOfferApprover({ supabase })

      await createNotification({
        supabase,
        recipientUserId: approver.id,
        actorUserId: profile.id,
        category: 'offers',
        type: 'offer_sent_to_client',
        title: 'Nabídka odeslána klientovi',
        message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} odeslal nabídku ${offer.offer_number} klientovi.`,
        entityType: 'offer',
        entityId: offerId,
        href: `/offers/${offerId}`,
        priority: 'normal',
        dedupeKey: `offer_sent_to_client:${offerId}`,
      })
    } catch (notificationError) {
      console.error('Nepodařilo se vytvořit notifikaci o odeslání nabídky klientovi.', notificationError)
    }
  }

  if (nextStatus === 'in_progress') {
    try {
      const approver = await getOfferApprover({ supabase })

      await createNotification({
        supabase,
        recipientUserId: approver.id,
        actorUserId: profile.id,
        category: 'offers',
        type: 'offer_in_progress',
        title: 'Nabídka ve stavu V řešení',
        message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} přepnul nabídku ${offer.offer_number} do stavu V řešení.`,
        entityType: 'offer',
        entityId: offerId,
        href: `/offers/${offerId}`,
        priority: 'normal',
        dedupeKey: `offer_in_progress:${offerId}:${now}`,
      })
    } catch (notificationError) {
      console.error('Nepodařilo se vytvořit notifikaci pro stav V řešení.', notificationError)
    }
  }

  if (nextStatus === 'ordered' && !isAdmin) {
    const approver = await getOfferApprover({ supabase })

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_ordered',
      title: 'Nabídka objednána',
      message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} označil nabídku ${offer.offer_number} jako objednanou.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'high',
      dedupeKey: `offer_ordered:${offerId}`,
    })
  }

  await logUserActivity({
    action: `Změnil stav nabídky ${offer.offer_number} na ${getOfferStatusActivityLabel(nextStatus)}`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function markOfferInProgress(offerId: string) {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  if (offer.status !== 'sent_to_client' && offer.status !== 'changes_requested') {
    throw new Error(
      'Do stavu V řešení lze nabídku přepnout pouze ze stavu Odeslaná nebo K úpravě.'
    )
  }

  const now = new Date().toISOString()

  const { error } = await supabase
    .from('offers')
    .update({
      status: 'in_progress',
      last_edited_by: profile.id,
      updated_at: now,
    })
    .eq('id', offerId)

  if (error) {
    throw new Error(`Nepodařilo se přepnout nabídku do stavu V řešení: ${error.message}`)
  }

  try {
    const approver = await getOfferApprover({ supabase })

    await createNotification({
      supabase,
      recipientUserId: approver.id,
      actorUserId: profile.id,
      category: 'offers',
      type: 'offer_in_progress',
      title: 'Nabídka ve stavu V řešení',
      message: `Uživatel ${profile.name ?? 'Neznámý uživatel'} přepnul nabídku ${offer.offer_number} do stavu V řešení.`,
      entityType: 'offer',
      entityId: offerId,
      href: `/offers/${offerId}`,
      priority: 'normal',
      dedupeKey: `offer_in_progress:${offerId}:${now}`,
    })
  } catch (notificationError) {
    console.error('Nepodařilo se vytvořit notifikaci pro stav V řešení.', notificationError)
  }

  await logUserActivity({
    action: `Přepnul nabídku ${offer.offer_number} do stavu V řešení`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function addOfferProgressNote(offerId: string, formData: FormData) {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)

  if (offer.status !== 'in_progress') {
    throw new Error('Průběžné poznámky lze přidávat pouze ve stavu V řešení.')
  }

  const note = getString(formData, 'progress_note')

  if (!note) {
    throw new Error('Komentář je povinný.')
  }

  if (!isAdmin && offer.created_by !== profile.id) {
    throw new Error('Komentář ve stavu V řešení může přidat pouze zakladatel nabídky nebo admin.')
  }

  const now = new Date().toISOString()
  const { error } = await supabase.from('offer_progress_notes').insert({
    offer_id: offerId,
    author_user_id: profile.id,
    note,
    created_at: now,
  })

  if (error) {
    throw new Error(`Nepodařilo se uložit průběžný komentář: ${error.message}`)
  }

  const { error: touchError } = await supabase
    .from('offers')
    .update({
      last_edited_by: profile.id,
      updated_at: now,
    })
    .eq('id', offerId)

  if (touchError) {
    throw new Error(`Komentář byl uložen, ale nepodařilo se aktualizovat nabídku: ${touchError.message}`)
  }

  const recipientUserIds = new Set<string>()
  if (offer.created_by !== profile.id) {
    recipientUserIds.add(offer.created_by)
  }
  if (offer.approver_user_id && offer.approver_user_id !== profile.id) {
    recipientUserIds.add(offer.approver_user_id)
  }

  for (const recipientUserId of recipientUserIds) {
    try {
      await createNotification({
        supabase,
        recipientUserId,
        actorUserId: profile.id,
        category: 'offers',
        type: 'offer_progress_note_added',
        title: 'Nový komentář ve stavu V řešení',
        message: `${profile.name ?? 'Uživatel'} přidal komentář k nabídce ${offer.offer_number}.`,
        entityType: 'offer',
        entityId: offerId,
        href: `/offers/${offerId}`,
        priority: 'normal',
        dedupeKey: `offer_progress_note_added:${offerId}:${recipientUserId}:${now}`,
      })
    } catch (notificationError) {
      console.error('Nepodařilo se vytvořit notifikaci k progres komentáři.', notificationError)
    }
  }

  await logUserActivity({
    action: `Přidal komentář k nabídce ${offer.offer_number}`,
    section: 'Nabídky',
    route: `/offers/${offerId}`,
    userId: profile.id,
  })

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function getOfferOrderData(offerId: string): Promise<OfferOrderData> {
  const { supabase, offer } = await loadOfferForAction(offerId)

  const { data, error } = await supabase
    .from('offer_order_files')
    .select('id, file_name, mime_type, file_size_bytes, created_at')
    .eq('offer_id', offer.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Nepodařilo se načíst podklady k objednávce: ${error.message}`)
  }

  const files = ((data ?? []) as Array<Pick<OfferOrderFileRow, 'id' | 'file_name' | 'mime_type' | 'file_size_bytes' | 'created_at'>>).map(
    (row) => ({
      id: row.id,
      fileName: row.file_name,
      mimeType: row.mime_type,
      fileSizeBytes: row.file_size_bytes,
      createdAt: row.created_at,
    })
  )

  return {
    orderReference: normalizeOrderReference(offer.order_reference),
    files,
  }
}

export async function saveOfferOrderReferenceAction(
  offerId: string,
  orderReferenceInput: string | null
): Promise<SaveOfferOrderReferenceActionState> {
  try {
    const { supabase, profile, offer } = await loadOfferForAction(offerId)
    if (offer.status === 'realizace') {
      return {
        success: false,
        error: 'Ve stavu Realizace už nelze číslo objednávky upravovat.',
        orderReference: normalizeOrderReference(offer.order_reference),
      }
    }

    const orderReference = await updateOfferOrderReferenceInternal({
      supabase,
      profileId: profile.id,
      offer,
      nextValue: orderReferenceInput,
    })

    revalidatePath('/offers')
    revalidatePath(`/offers/${offerId}`)
    revalidatePath(`/clients/${offer.client_id}`)
    revalidatePath('/dashboard')

    return { success: true, error: null, orderReference }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Nepodařilo se uložit číslo objednávky.',
      orderReference: normalizeOrderReference(orderReferenceInput),
    }
  }
}

export async function uploadOfferOrderFileAction(
  offerId: string,
  formData: FormData
): Promise<UploadOfferOrderFileActionState> {
  try {
    const { supabase, profile, offer } = await loadOfferForAction(offerId)
    if (offer.status === 'realizace') {
      return {
        success: false,
        error: 'Ve stavu Realizace už nelze nahrávat další podklady k objednávce.',
        fileId: null,
        orderReference: normalizeOrderReference(offer.order_reference),
      }
    }

    const fileEntry = formData.get('file')

    if (!(fileEntry instanceof File) || fileEntry.size <= 0) {
      return { success: false, error: 'Vyber soubor k nahrání.', fileId: null, orderReference: normalizeOrderReference(offer.order_reference) }
    }

    const preparedFile = await prepareOfferOrderUploadFile(fileEntry)
    const orderReferenceInput = getOptionalString(formData, 'order_reference')
    const storagePath = buildOfferOrderStoragePath(offer.id, preparedFile.name)
    const uploadBuffer = Buffer.from(await preparedFile.arrayBuffer())
    const contentType = String(preparedFile.type ?? fileEntry.type ?? '').trim().toLowerCase() || 'application/octet-stream'

    const { error: uploadError } = await supabase.storage
      .from(OFFER_ORDER_FILES_BUCKET)
      .upload(storagePath, uploadBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })

    if (uploadError) {
      throw new Error(`Soubor "${fileEntry.name}" se nepodařilo nahrát (${uploadError.message}).`)
    }

    const now = new Date().toISOString()
    const { data: insertedRow, error: insertError } = await supabase
      .from('offer_order_files')
      .insert({
        offer_id: offer.id,
        storage_path: storagePath,
        file_name: sanitizeOfferOrderFileName(preparedFile.name),
        mime_type: contentType,
        file_size_bytes: preparedFile.size,
        uploaded_by: profile.id,
        created_at: now,
      })
      .select('id')
      .single()

    if (insertError || !insertedRow) {
      await supabase.storage.from(OFFER_ORDER_FILES_BUCKET).remove([storagePath])
      throw new Error(`Metadata souboru "${fileEntry.name}" se nepodařilo uložit.`)
    }

    const resolvedOrderReference = await updateOfferOrderReferenceInternal({
      supabase,
      profileId: profile.id,
      offer,
      nextValue: orderReferenceInput,
    })

    await logUserActivity({
      action: `Nahrál podklad k objednávce pro nabídku ${offer.offer_number}: ${sanitizeOfferOrderFileName(preparedFile.name)}`,
      section: 'Nabídky',
      route: `/offers/${offer.id}`,
      userId: profile.id,
    })

    revalidatePath('/offers')
    revalidatePath(`/offers/${offerId}`)
    revalidatePath(`/clients/${offer.client_id}`)
    revalidatePath('/dashboard')

    return {
      success: true,
      error: null,
      fileId: String((insertedRow as { id: string }).id),
      orderReference: resolvedOrderReference,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Nepodařilo se nahrát podklad k objednávce.',
      fileId: null,
      orderReference: normalizeOrderReference(getOptionalString(formData, 'order_reference')),
    }
  }
}

export async function openOfferOrderFileAction(
  offerOrderFileId: string
): Promise<OpenOfferOrderFileActionState> {
  try {
    const { supabase } = await getOfferRuntimeContext()
    const normalizedId = String(offerOrderFileId ?? '').trim()

    if (!normalizedId) {
      return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
    }

    const { data: row, error: rowError } = await supabase
      .from('offer_order_files')
      .select('id, storage_path')
      .eq('id', normalizedId)
      .single()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
    }

    const { data, error } = await supabase.storage
      .from(OFFER_ORDER_FILES_BUCKET)
      .createSignedUrl(String((row as { storage_path: string }).storage_path), 60 * 10)

    if (error || !data?.signedUrl) {
      return { success: false, error: 'Nepodařilo se vytvořit odkaz na soubor.', signedUrl: null }
    }

    return { success: true, error: null, signedUrl: data.signedUrl }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se vytvořit odkaz na soubor.',
      signedUrl: null,
    }
  }
}

export async function downloadOfferOrderFileAction(
  offerOrderFileId: string
): Promise<DownloadOfferOrderFileActionState> {
  try {
    const { supabase } = await getOfferRuntimeContext()
    const normalizedId = String(offerOrderFileId ?? '').trim()

    if (!normalizedId) {
      return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
    }

    const { data: row, error: rowError } = await supabase
      .from('offer_order_files')
      .select('id, file_name, storage_path')
      .eq('id', normalizedId)
      .single()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
    }

    const typedRow = row as { file_name: string; storage_path: string }
    const { data, error } = await supabase.storage
      .from(OFFER_ORDER_FILES_BUCKET)
      .createSignedUrl(String(typedRow.storage_path), 60 * 10, {
        download: String(typedRow.file_name ?? '').trim() || undefined,
      })

    if (error || !data?.signedUrl) {
      return { success: false, error: 'Nepodařilo se vytvořit odkaz pro stažení.', signedUrl: null }
    }

    return { success: true, error: null, signedUrl: data.signedUrl }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se vytvořit odkaz pro stažení.',
      signedUrl: null,
    }
  }
}

export async function finalizeOfferOrderedStatusAction(offerId: string) {
  const { supabase, offer } = await loadOfferForAction(offerId)
  const attachmentsCount = await getOfferOrderFilesCount(supabase, offer.id)

  if (attachmentsCount <= 0) {
    throw new Error('Před změnou stavu na Objednáno musí být nahrán alespoň jeden soubor.')
  }

  await setOfferStatusFromList(offerId, 'ordered')
}

export async function createOffer(formData: FormData) {
  const result = await createOfferModalAction({ success: false, error: null }, formData)

  if (!result.success || !result.offerId) {
    throw new Error(result.error ?? 'Nepodařilo se vytvořit nabídku.')
  }

  redirect(`/offers/${result.offerId}`)
}

export async function duplicateOffer(formData: FormData) {
  const result = await duplicateOfferModalAction({ success: false, error: null }, formData)

  if (!result.success || !result.offerId) {
    throw new Error(result.error ?? 'Nepodařilo se vytvořit kopii nabídky.')
  }

  redirect(`/offers/${result.offerId}`)
}

export async function duplicateOfferModalAction(
  _prevState: OfferFormActionState,
  formData: FormData
): Promise<OfferFormActionState> {
  const offerId = getString(formData, 'offer_id')
  let resolvedClientId = ''

  try {
    const clientId = getString(formData, 'client_id')
    resolvedClientId = clientId
    const contactId = getOptionalContactId(formData)
    const title = getString(formData, 'title')

    if (!offerId) {
      throw new Error('Chybí nabídka ke kopírování.')
    }

    if (!clientId) {
      throw new Error('Vyber klienta.')
    }

    if (!title) {
      throw new Error('Název nabídky je povinný.')
    }

    const { supabase, profile, offer } = await loadOfferForAction(offerId)
    await ensureClientAccess(clientId)
    const resolvedContact = await resolveOfferContact({
      supabase,
      clientId,
      contactId,
      fallbackContactPerson: null,
    })

    const [itemsResponse, serviceItemsResponse] = await Promise.all([
      supabase
        .from('offer_items')
        .select('*')
        .eq('offer_id', offer.id)
        .order('position', { ascending: true }),
      supabase
        .from('offer_service_items')
        .select('*')
        .eq('offer_id', offer.id)
        .order('position', { ascending: true }),
    ])

    if (itemsResponse.error || serviceItemsResponse.error) {
      throw new Error('Nepodařilo se načíst data původní nabídky pro kopii.')
    }

    const { data: duplicatedOffer, error: offerError } = await supabase
      .from('offers')
      .insert({
        offer_number: await createOfferNumber(supabase),
        client_id: clientId,
        client_contact_id: resolvedContact.contactId,
        created_by: profile.id,
        last_edited_by: profile.id,
        title,
        offer_type: offer.offer_type,
        status: 'draft',
        current_version: 1,
        submitted_version: null,
        approved_version: null,
        currency: offer.currency,
        valid_until: getDefaultValidUntilDate(),
        project_name: offer.project_name,
        realization_address: getOptionalString(formData, 'realization_address'),
        realization_starts_at: offer.realization_starts_at,
        realization_ends_at: offer.realization_ends_at,
        contact_person: resolvedContact.contactPerson,
        prepared_by_name: offer.prepared_by_name,
        prepared_by_phone: offer.prepared_by_phone,
        prepared_by_email: offer.prepared_by_email,
        intro_note: offer.intro_note,
        internal_note: offer.internal_note,
        terms_note: offer.terms_note,
        rejection_comment: null,
        submitted_at: null,
        approved_at: null,
        rejected_at: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (offerError || !duplicatedOffer) {
      throw new Error(`Nepodařilo se vytvořit kopii nabídky: ${offerError?.message ?? 'Neznámá chyba'}`)
    }

    const copiedItems = (itemsResponse.data ?? []).map((item) => ({
      offer_id: duplicatedOffer.id,
      position: item.position,
      item_section: item.item_section,
      description: item.description,
      specification: item.specification,
      quantity: item.quantity,
      unit: item.unit,
      unit_price_without_vat: item.unit_price_without_vat,
      planned_unit_price_without_vat: item.planned_unit_price_without_vat,
      discount_percent: item.discount_percent,
      vat_rate: item.vat_rate,
    }))

    if (copiedItems.length > 0) {
      const { error } = await supabase.from('offer_items').insert(copiedItems)

      if (error) {
        throw new Error(`Kopie nabídky vznikla, ale nepodařilo se zkopírovat položky: ${error.message}`)
      }
    }

    const copiedServiceItems = (serviceItemsResponse.data ?? []).map((item) => ({
      offer_id: duplicatedOffer.id,
      position: item.position,
      service_name: item.service_name,
      specification: item.specification,
      operation: item.operation,
    }))

    if (copiedServiceItems.length > 0) {
      const { error } = await supabase.from('offer_service_items').insert(copiedServiceItems)

      if (error) {
        throw new Error(`Kopie nabídky vznikla, ale nepodařilo se zkopírovat služby: ${error.message}`)
      }
    }

    revalidatePath('/offers')
    revalidatePath(`/clients/${offer.client_id}`)
    revalidatePath(`/clients/${clientId}`)

    return {
      success: true,
      error: null,
      offerId: duplicatedOffer.id,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'duplicateOfferModalAction',
      section: 'offers',
      errorType: 'DuplicateOfferModalActionError',
      context: { offerId, clientId: resolvedClientId },
    })
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se vytvořit kopii nabídky.',
    }
  }
}
