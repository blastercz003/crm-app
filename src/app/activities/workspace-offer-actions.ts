'use server'

import { getOfferTotals } from '@/lib/offers/calculations'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import type { OfferItemRow, OfferProgressNoteRow, OfferRow } from '@/lib/offers/types'
import type { ActivityWorkspaceOfferDetailResult } from '@/lib/activities/workspace-types'

export async function getWorkspaceOfferDetailAction(
  offerId: string,
): Promise<ActivityWorkspaceOfferDetailResult> {
  try {
    const normalizedOfferId = offerId.trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedOfferId)) {
      throw new Error('Nabídka nebyla nalezena.')
    }

    const { supabase, profile, isAdmin } = await getOfferRuntimeContext()
    let offerRequest = supabase.from('offers').select('*').eq('id', normalizedOfferId)
    if (!isAdmin) offerRequest = offerRequest.eq('created_by', profile.id)
    const { data: offer, error: offerError } = await offerRequest.single<OfferRow>()
    if (offerError || !offer) throw new Error('Nabídka nebyla nalezena nebo k ní nemáte přístup.')

    const [clientResponse, itemsResponse, notesResponse] = await Promise.all([
      supabase.from('clients').select('id, name').eq('id', offer.client_id).single<{ id: string; name: string }>(),
      supabase
        .from('offer_items')
        .select('id, offer_id, position, item_section, description, specification, quantity, unit, unit_price_without_vat, planned_unit_price_without_vat, discount_percent, vat_rate, created_at, updated_at')
        .eq('offer_id', offer.id)
        .order('position', { ascending: true }),
      supabase
        .from('offer_progress_notes')
        .select('id, offer_id, author_user_id, note, created_at', { count: 'exact' })
        .eq('offer_id', offer.id)
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    if (clientResponse.error || !clientResponse.data) throw new Error('Klient nabídky se nepodařil načíst.')
    if (itemsResponse.error) throw new Error('Položky nabídky se nepodařily načíst.')
    if (notesResponse.error) throw new Error('Komentáře nabídky se nepodařily načíst.')

    const items = (itemsResponse.data ?? []) as OfferItemRow[]
    const notes = (notesResponse.data ?? []) as OfferProgressNoteRow[]
    const profileIds = [...new Set([
      offer.created_by,
      offer.last_edited_by,
      ...notes.map((note) => note.author_user_id),
    ].filter(Boolean))] as string[]
    const profilesResponse = profileIds.length
      ? await supabase.from('profiles').select('id, name').in('id', profileIds)
      : { data: [], error: null }
    if (profilesResponse.error) throw new Error('Autory nabídky se nepodařilo načíst.')
    const profileNames = new Map((profilesResponse.data ?? []).map((item) => [item.id as string, (item.name as string | null)?.trim() || 'Uživatel']))
    const totals = getOfferTotals(items)

    return {
      success: true,
      error: null,
      offer: {
        id: offer.id,
        offerNumber: offer.offer_number,
        title: offer.title,
        status: offer.status,
        updatedAt: offer.updated_at,
        clientId: offer.client_id,
        clientName: clientResponse.data.name,
        createdBy: offer.created_by,
        offerType: offer.offer_type,
        currentVersion: offer.current_version,
        submittedVersion: offer.submitted_version,
        approvedVersion: offer.approved_version,
        currency: offer.currency,
        validUntil: offer.valid_until,
        projectName: offer.project_name,
        realizationAddress: offer.realization_address,
        realizationStartsAt: offer.realization_starts_at,
        realizationEndsAt: offer.realization_ends_at,
        contactPerson: offer.contact_person,
        internalNote: offer.internal_note,
        rejectionComment: offer.rejection_comment,
        submittedAt: offer.submitted_at,
        createdAt: offer.created_at,
        authorName: profileNames.get(offer.created_by) ?? 'Neznámý uživatel',
        lastEditorName: offer.last_edited_by ? profileNames.get(offer.last_edited_by) ?? 'Uživatel' : null,
        itemCount: items.length,
        subtotalWithoutVat: totals.subtotalWithoutVat,
        vatTotal: totals.vatTotal,
        totalWithVat: totals.totalWithVat,
        progressNotesTotal: notesResponse.count ?? 0,
        progressNotes: notes.map((note) => ({
          id: note.id,
          note: note.note,
          createdAt: note.created_at,
          authorName: profileNames.get(note.author_user_id) ?? 'Uživatel',
        })),
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Detail nabídky se nepodařilo načíst.',
      offer: null,
    }
  }
}
