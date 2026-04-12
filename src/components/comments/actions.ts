'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type AddCommentInput = {
  entityType: string
  entityId: string
  content: string
  path: string
}

export async function addComment({
  entityType,
  entityId,
  content,
  path,
}: AddCommentInput) {
  const trimmedContent = content.trim()

  if (!entityType || !entityId || !trimmedContent) {
    return {
      error: 'Komentář se nepodařilo uložit. Zkontrolujte vyplněný text.',
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      error: 'Pro přidání komentáře musíte být přihlášený.',
    }
  }

  const { error } = await supabase.from('comments').insert({
    entity_type: entityType,
    entity_id: entityId,
    user_id: user.id,
    content: trimmedContent,
  })

  if (error) {
    return {
      error: 'Komentář se nepodařilo uložit.',
    }
  }

  revalidatePath(path)

  return {
    success: true,
  }
}