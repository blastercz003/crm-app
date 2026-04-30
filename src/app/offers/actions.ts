'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createNotification } from '@/lib/notifications/createNotification'
import { getOfferApprover, getOfferRuntimeContext } from '@/lib/offers/permissions'
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
import type { OfferRow, OfferType } from '@/lib/offers/types'

export type OfferFormActionState = {
  success: boolean
  error: string | null
  offerId?: string
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

async function touchOfferVersion(offerId: string, editorId: string) {
  const { supabase, offer } = await loadOfferForAction(offerId)
  const nextStatus = ['approved', 'sent_to_client', 'ordered', 'rejected'].includes(offer.status)
    ? 'draft'
    : offer.status

  const { error } = await supabase
    .from('offers')
    .update({
      status: nextStatus,
      current_version: offer.current_version + 1,
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

  const nextVersion = offer.current_version + 1
  const nextStatus = ['approved', 'sent_to_client', 'ordered', 'rejected'].includes(offer.status)
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

  await touchOfferVersion(offerId, profile.id)

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

  await touchOfferVersion(offerId, profile.id)

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

  await touchOfferVersion(offerId, profile.id)

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

  await touchOfferVersion(offerId, profile.id)

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

  await touchOfferVersion(offerId, profile.id)

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

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
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

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
}

export async function setOfferClientOutcome(offerId: string, status: 'ordered' | 'rejected') {
  const { supabase, profile, isAdmin, offer } = await loadOfferForAction(offerId)

  if (offer.status !== 'sent_to_client') {
    throw new Error('Výsledek od klienta lze nastavit pouze u nabídky odeslané klientovi.')
  }

  const { error } = await supabase
    .from('offers')
    .update({
      status,
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

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
  revalidatePath('/dashboard')
  revalidatePath('/notifications')
}

export async function createOffer(formData: FormData) {
  const result = await createOfferModalAction({ success: false, error: null }, formData)

  if (!result.success || !result.offerId) {
    throw new Error(result.error ?? 'Nepodařilo se vytvořit nabídku.')
  }

  redirect(`/offers/${result.offerId}`)
}

export async function duplicateOffer(formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí nabídka ke kopírování.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)
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
      client_id: offer.client_id,
      client_contact_id: offer.client_contact_id,
      created_by: profile.id,
      last_edited_by: profile.id,
      title: offer.title,
      offer_type: offer.offer_type,
      status: 'draft',
      current_version: 1,
      submitted_version: null,
      approved_version: null,
      currency: offer.currency,
      valid_until: getDefaultValidUntilDate(),
      project_name: offer.project_name,
      realization_address: offer.realization_address,
      realization_starts_at: offer.realization_starts_at,
      realization_ends_at: offer.realization_ends_at,
      contact_person: offer.contact_person,
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

  redirect(`/offers/${duplicatedOffer.id}`)
}
