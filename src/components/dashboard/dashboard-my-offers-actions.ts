'use server'

import { getOfferRuntimeContext } from '@/lib/offers/permissions'

export type OfferCommentDetail = {
  id: string
  authorUserId: string | null
  authorName: string | null
  note: string
  createdAt: string
}

export async function getOfferCommentsForDashboard(
  offerId: string
): Promise<{ success: true; comments: OfferCommentDetail[] } | { success: false; error: string }> {
  try {
    const normalizedOfferId = String(offerId ?? '').trim()
    if (!normalizedOfferId) {
      return { success: false, error: 'Chybí ID nabídky.' }
    }

    const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

    let offerQuery = supabase.from('offers').select('id, created_by').eq('id', normalizedOfferId)
    if (!isAdmin) {
      offerQuery = offerQuery.eq('created_by', profile.id)
    }

    const { data: offer, error: offerError } = await offerQuery.single<{
      id: string
      created_by: string
    }>()

    if (offerError || !offer) {
      return { success: false, error: 'Nabídka nebyla nalezena nebo k ní nemáš oprávnění.' }
    }

    const { data: notes, error: notesError } = await supabase
      .from('offer_progress_notes')
      .select('id, author_user_id, note, created_at')
      .eq('offer_id', normalizedOfferId)
      .order('created_at', { ascending: false })

    if (notesError) {
      return { success: false, error: 'Nepodařilo se načíst komentáře nabídky.' }
    }

    const typedNotes = (notes ?? []) as Array<{
      id: string
      author_user_id: string | null
      note: string | null
      created_at: string | null
    }>

    const authorIds = Array.from(
      new Set(typedNotes.map((item) => item.author_user_id).filter((id): id is string => Boolean(id)))
    )

    let profileMap = new Map<string, string | null>()
    if (authorIds.length > 0) {
      const { data: authors } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', authorIds)

      profileMap = new Map(
        ((authors ?? []) as Array<{ id: string; name: string | null }>).map((row) => [row.id, row.name])
      )
    }

    const comments: OfferCommentDetail[] = typedNotes
      .filter((item) => Boolean(item.note) && Boolean(item.created_at))
      .map((item) => ({
        id: item.id,
        authorUserId: item.author_user_id,
        authorName: item.author_user_id ? (profileMap.get(item.author_user_id) ?? null) : null,
        note: String(item.note),
        createdAt: String(item.created_at),
      }))

    return { success: true, comments }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se načíst komentáře nabídky.',
    }
  }
}

