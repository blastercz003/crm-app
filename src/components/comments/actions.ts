'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type CommentEntityType = 'meeting' | 'client' | 'task'

type AddCommentInput = {
  entityType: CommentEntityType
  entityId: string
  content: string
  path: string
}

type UpdateCommentInput = {
  commentId: string
  content: string
  path: string
}

type DeleteCommentInput = {
  commentId: string
  path: string
}

const ALLOWED_ENTITY_TYPES: CommentEntityType[] = ['meeting', 'client', 'task']
const MAX_COMMENT_LENGTH = 1000

function normalizeText(value: string) {
  return value.trim()
}

export async function addComment({
  entityType,
  entityId,
  content,
  path,
}: AddCommentInput) {
  const trimmedEntityId = normalizeText(entityId)
  const trimmedContent = normalizeText(content)
  const trimmedPath = normalizeText(path)

  if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
    return {
      error: 'Neplatný typ komentáře.',
    }
  }

  if (!trimmedEntityId) {
    return {
      error: 'Chybí identifikace záznamu, ke kterému má být komentář uložen.',
    }
  }

  if (!trimmedContent) {
    return {
      error: 'Komentář nemůže být prázdný.',
    }
  }

  if (trimmedContent.length > MAX_COMMENT_LENGTH) {
    return {
      error: `Komentář může mít maximálně ${MAX_COMMENT_LENGTH} znaků.`,
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      error: 'Pro přidání komentáře musíte být přihlášený.',
    }
  }

  const { error } = await supabase.from('comments').insert({
    entity_type: entityType,
    entity_id: trimmedEntityId,
    user_id: user.id,
    content: trimmedContent,
  })

  if (error) {
    console.error('addComment insert error:', error)

    return {
      error: 'Komentář se nepodařilo uložit.',
    }
  }

  if (trimmedPath) {
    revalidatePath(trimmedPath)
  }

  return {
    success: true,
    message: 'Komentář byl uložen.',
  }
}

export async function updateComment({
  commentId,
  content,
  path,
}: UpdateCommentInput) {
  const trimmedCommentId = normalizeText(commentId)
  const trimmedContent = normalizeText(content)
  const trimmedPath = normalizeText(path)

  if (!trimmedCommentId) {
    return {
      error: 'Chybí identifikace komentáře.',
    }
  }

  if (!trimmedContent) {
    return {
      error: 'Komentář nemůže být prázdný.',
    }
  }

  if (trimmedContent.length > MAX_COMMENT_LENGTH) {
    return {
      error: `Komentář může mít maximálně ${MAX_COMMENT_LENGTH} znaků.`,
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      error: 'Pro úpravu komentáře musíte být přihlášený.',
    }
  }

  const { data: existingComment, error: existingCommentError } = await supabase
    .from('comments')
    .select('id, user_id')
    .eq('id', trimmedCommentId)
    .maybeSingle()

  if (existingCommentError || !existingComment) {
    console.error('updateComment fetch existing error:', existingCommentError)

    return {
      error: 'Komentář se nepodařilo najít.',
    }
  }

  if (existingComment.user_id !== user.id) {
    return {
      error: 'Můžete upravit pouze svůj vlastní komentář.',
    }
  }

  const { error } = await supabase
    .from('comments')
    .update({
      content: trimmedContent,
    })
    .eq('id', trimmedCommentId)
    .eq('user_id', user.id)

  if (error) {
    console.error('updateComment update error:', error)

    return {
      error: 'Komentář se nepodařilo upravit.',
    }
  }

  if (trimmedPath) {
    revalidatePath(trimmedPath)
  }

  return {
    success: true,
    message: 'Komentář byl upraven.',
  }
}

export async function deleteComment({
  commentId,
  path,
}: DeleteCommentInput) {
  const trimmedCommentId = normalizeText(commentId)
  const trimmedPath = normalizeText(path)

  if (!trimmedCommentId) {
    return {
      error: 'Chybí identifikace komentáře.',
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      error: 'Pro smazání komentáře musíte být přihlášený.',
    }
  }

  const { data: existingComment, error: existingCommentError } = await supabase
    .from('comments')
    .select('id, user_id')
    .eq('id', trimmedCommentId)
    .maybeSingle()

  if (existingCommentError || !existingComment) {
    console.error('deleteComment fetch existing error:', existingCommentError)

    return {
      error: 'Komentář se nepodařilo najít.',
    }
  }

  if (existingComment.user_id !== user.id) {
    return {
      error: 'Můžete smazat pouze svůj vlastní komentář.',
    }
  }

  const { error } = await supabase
    .from('comments')
    .delete()
    .eq('id', trimmedCommentId)
    .eq('user_id', user.id)

  if (error) {
    console.error('deleteComment delete error:', error)

    return {
      error: 'Komentář se nepodařilo smazat.',
    }
  }

  if (trimmedPath) {
    revalidatePath(trimmedPath)
  }

  return {
    success: true,
    message: 'Komentář byl smazán.',
  }
}