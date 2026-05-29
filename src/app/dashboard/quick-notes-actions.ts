'use server'

import { createClient } from '@/lib/supabase/server'

const QUICK_NOTE_MAX_LENGTH = 1000

function normalizeContent(value: unknown) {
  return String(value ?? '').slice(0, QUICK_NOTE_MAX_LENGTH)
}

async function requireAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Uživatel není přihlášen.' }
  }

  return { supabase, user, error: null }
}

export async function getMyDashboardQuickNoteAction() {
  try {
    const { supabase, user, error: accessError } = await requireAuthenticatedUser()
    if (!user) {
      return { success: false, error: accessError, content: '', updatedAt: null as string | null }
    }

    const { data, error } = await supabase
      .from('dashboard_quick_notes')
      .select('content, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      return { success: false, error: 'Poznámku se nepodařilo načíst.', content: '', updatedAt: null as string | null }
    }

    return {
      success: true,
      error: null,
      content: String(data?.content ?? ''),
      updatedAt: data?.updated_at ?? null,
    }
  } catch {
    return { success: false, error: 'Poznámku se nepodařilo načíst.', content: '', updatedAt: null as string | null }
  }
}

export async function upsertMyDashboardQuickNoteAction(input: { content: string }) {
  try {
    const { supabase, user, error: accessError } = await requireAuthenticatedUser()
    if (!user) {
      return { success: false, error: accessError, updatedAt: null as string | null }
    }

    const content = normalizeContent(input.content)

    const { data, error } = await supabase
      .from('dashboard_quick_notes')
      .upsert(
        {
          user_id: user.id,
          content,
        },
        { onConflict: 'user_id' }
      )
      .select('updated_at')
      .single()

    if (error) {
      return { success: false, error: 'Poznámku se nepodařilo uložit.', updatedAt: null as string | null }
    }

    return {
      success: true,
      error: null,
      updatedAt: data?.updated_at ?? null,
    }
  } catch {
    return { success: false, error: 'Poznámku se nepodařilo uložit.', updatedAt: null as string | null }
  }
}

export async function clearMyDashboardQuickNoteAction() {
  try {
    const { supabase, user, error: accessError } = await requireAuthenticatedUser()
    if (!user) {
      return { success: false, error: accessError }
    }

    const { error } = await supabase
      .from('dashboard_quick_notes')
      .delete()
      .eq('user_id', user.id)

    if (error) {
      return { success: false, error: 'Poznámku se nepodařilo smazat.' }
    }

    return { success: true, error: null }
  } catch {
    return { success: false, error: 'Poznámku se nepodařilo smazat.' }
  }
}
