'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createNotification } from '@/lib/notifications/createNotification'
import { getOfferApprover, getOfferRuntimeContext } from '@/lib/offers/permissions'
import {
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_DEPOT_PRESETS,
  OFFER_SERVICE_PRESET_ALIASES,
  OFFER_SERVICE_GROUP_LABEL,
  OFFER_SERVICE_PRESETS,
} from '@/lib/offers/presets'
import type { OfferRow } from '@/lib/offers/types'

export type OfferFormActionState = {
  success: boolean
  error: string | null
  offerId?: string
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key)
  return value || null
}

function getNumber(formData: FormData, key: string, fallback = 0) {
  const raw = getString(formData, key).replace(',', '.')
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getDateTimeOrNull(formData: FormData, key: string) {
  const value = getString(formData, key)
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

function createOfferNumber() {
  const now = new Date()
  const year = now.getFullYear()
  const stamp = `${now.getTime()}`.slice(-8)
  return `NAB-${year}-${stamp}`
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
  const nextStatus = ['approved', 'ordered', 'rejected'].includes(offer.status)
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
    const title = getString(formData, 'title')

    if (!clientId) {
      throw new Error('Vyber klienta.')
    }

    if (!title) {
      throw new Error('Název nabídky je povinný.')
    }

    const { supabase, profile } = await ensureClientAccess(clientId)
    const offerNumber = createOfferNumber()

    const { data, error } = await supabase
      .from('offers')
      .insert({
        offer_number: offerNumber,
        client_id: clientId,
        created_by: profile.id,
        last_edited_by: profile.id,
        title,
        project_name: getOptionalString(formData, 'project_name'),
        realization_address: getOptionalString(formData, 'realization_address'),
        contact_person: getOptionalString(formData, 'contact_person'),
        valid_until: getDefaultValidUntilDate(),
        intro_note: getOptionalString(formData, 'intro_note'),
        internal_note: getOptionalString(formData, 'internal_note'),
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) {
      throw new Error(`Nepodařilo se vytvořit nabídku: ${error?.message ?? 'Neznámá chyba'}`)
    }

    const defaultServiceItems = [
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
        service_name: 'DOLNÍ BŘEŽANY',
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

  if (!title) {
    throw new Error('Název nabídky je povinný.')
  }

  const nextVersion = offer.current_version + 1
  const nextStatus = ['approved', 'ordered', 'rejected'].includes(offer.status)
    ? 'draft'
    : offer.status

  const { error } = await supabase
    .from('offers')
    .update({
      title,
      project_name: getOptionalString(formData, 'project_name'),
      realization_address: getOptionalString(formData, 'realization_address'),
      realization_starts_at: getDateTimeOrNull(formData, 'realization_starts_at'),
      realization_ends_at: getDateTimeOrNull(formData, 'realization_ends_at'),
      contact_person: getOptionalString(formData, 'contact_person'),
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

  if (!description) {
    revalidatePath(`/offers/${offerId}`)
    return
  }

  const { count, error: countError } = await supabase
    .from('offer_items')
    .select('id', { count: 'exact', head: true })
    .eq('offer_id', offerId)

  if (countError) {
    throw new Error(`Nepodařilo se načíst položky nabídky: ${countError.message}`)
  }

  const { error } = await supabase.from('offer_items').insert({
    offer_id: offerId,
    position: (count ?? 0) + 1,
    description,
    specification: getOptionalString(formData, 'specification'),
    quantity: getNumber(formData, 'quantity', 1),
    unit: getString(formData, 'unit') || 'ks',
    unit_price_without_vat: getNumber(formData, 'unit_price_without_vat', 0),
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

export async function moveOfferItem(itemId: string, direction: 'up' | 'down', formData: FormData) {
  const offerId = getString(formData, 'offer_id')

  if (!offerId) {
    throw new Error('Chybí ID nabídky.')
  }

  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  const { data: currentItem, error: currentError } = await supabase
    .from('offer_items')
    .select('id, position')
    .eq('id', itemId)
    .eq('offer_id', offerId)
    .single<{ id: string; position: number }>()

  if (currentError || !currentItem) {
    throw new Error('Položka nabídky nebyla nalezena.')
  }

  const neighborQuery = supabase
    .from('offer_items')
    .select('id, position')
    .eq('offer_id', offerId)
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

export async function setOfferClientOutcome(offerId: string, status: 'ordered' | 'rejected') {
  const { supabase, profile, offer } = await loadOfferForAction(offerId)

  if (offer.status !== 'approved') {
    throw new Error('Výsledek od klienta lze nastavit pouze u schválené nabídky.')
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

  revalidatePath('/offers')
  revalidatePath(`/offers/${offerId}`)
  revalidatePath(`/clients/${offer.client_id}`)
}

export async function createOffer(formData: FormData) {
  const result = await createOfferModalAction({ success: false, error: null }, formData)

  if (!result.success || !result.offerId) {
    throw new Error(result.error ?? 'Nepodařilo se vytvořit nabídku.')
  }

  redirect(`/offers/${result.offerId}`)
}
