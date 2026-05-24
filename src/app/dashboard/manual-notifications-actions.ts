'use server'

import { randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { createNotification } from '@/lib/notifications/createNotification'

type HistoryRow = {
  id: string
  entity_id: string | null
  title: string
  message: string | null
  created_at: string
  recipient_user_id: string
}

type ProfileRow = {
  id: string
  name: string | null
}

function normalizeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength)
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Uživatel není přihlášen.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    return { supabase, user: null, error: 'Pouze admin může odesílat ruční notifikace.' }
  }

  return { supabase, user, error: null }
}

export async function sendManualNotificationForAdminAction(input: {
  recipientUserIds: string[]
  title: string
  message?: string | null
}) {
  try {
    const { supabase, user, error: accessError } = await requireAdmin()
    if (!user) {
      return { success: false, error: accessError, sentCount: 0 }
    }

    const title = normalizeText(String(input.title ?? ''), 120)
    const message = normalizeText(String(input.message ?? ''), 500)
    const uniqueRecipientIds = Array.from(
      new Set((input.recipientUserIds ?? []).map((id) => String(id).trim()).filter(Boolean))
    )

    if (!title) {
      return { success: false, error: 'Nadpis je povinný.', sentCount: 0 }
    }

    if (uniqueRecipientIds.length === 0) {
      return { success: false, error: 'Vyber alespoň jednoho uživatele.', sentCount: 0 }
    }

    const { data: profileRows, error: profileRowsError } = await supabase
      .from('profiles')
      .select('id')
      .in('id', uniqueRecipientIds)

    if (profileRowsError) {
      return { success: false, error: 'Nepodařilo se ověřit příjemce.', sentCount: 0 }
    }

    const validIds = new Set((profileRows ?? []).map((row) => row.id as string))
    const recipients = uniqueRecipientIds.filter((id) => validIds.has(id))

    if (recipients.length === 0) {
      return { success: false, error: 'Nebyl vybrán žádný platný uživatel.', sentCount: 0 }
    }

    const batchId = randomUUID()

    await Promise.all(
      recipients.map((recipientUserId) =>
        createNotification({
          supabase,
          recipientUserId,
          actorUserId: user.id,
          category: 'system',
          type: 'manual_admin',
          title,
          message: message || null,
          entityType: 'manual_notification',
          entityId: batchId,
          href: '/notifications',
          priority: 'normal',
          skipSelfNotification: false,
        })
      )
    )

    return {
      success: true,
      error: null,
      sentCount: recipients.length,
    }
  } catch {
    return { success: false, error: 'Nepodařilo se odeslat ruční notifikaci.', sentCount: 0 }
  }
}

export async function getManualNotificationHistoryForAdminAction(limit = 20) {
  try {
    const { supabase, user, error: accessError } = await requireAdmin()
    if (!user) {
      return { success: false, error: accessError, items: [] }
    }

    const safeLimit = Math.max(5, Math.min(60, Number(limit) || 20))
    const scanLimit = safeLimit * 12

    const { data, error } = await supabase
      .from('notifications')
      .select('id, entity_id, title, message, created_at, recipient_user_id')
      .eq('actor_user_id', user.id)
      .eq('category', 'system')
      .eq('type', 'manual_admin')
      .order('created_at', { ascending: false })
      .limit(scanLimit)

    if (error) {
      return { success: false, error: 'Nepodařilo se načíst historii notifikací.', items: [] }
    }

    const rows = (data ?? []) as HistoryRow[]

    const grouped = new Map<
      string,
      {
        batchId: string
        createdAt: string
        title: string
        message: string | null
        recipientUserIds: string[]
      }
    >()

    for (const row of rows) {
      const key = row.entity_id ?? row.id
      const existing = grouped.get(key)
      if (existing) {
        existing.recipientUserIds.push(row.recipient_user_id)
        continue
      }
      grouped.set(key, {
        batchId: key,
        createdAt: row.created_at,
        title: row.title,
        message: row.message,
        recipientUserIds: [row.recipient_user_id],
      })
    }

    const historyItems = Array.from(grouped.values())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, safeLimit)

    const allRecipientIds = Array.from(
      new Set(historyItems.flatMap((item) => item.recipientUserIds).filter(Boolean))
    )

    const profileMap = new Map<string, string>()
    if (allRecipientIds.length > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, name')
        .in('id', allRecipientIds)

      for (const profile of (profileRows ?? []) as ProfileRow[]) {
        profileMap.set(profile.id, profile.name?.trim() || 'Uživatel')
      }
    }

    const items = historyItems.map((item) => {
      const uniqueRecipientIds = Array.from(new Set(item.recipientUserIds))
      return {
        batchId: item.batchId,
        createdAt: item.createdAt,
        title: item.title,
        message: item.message,
        recipientUserIds: uniqueRecipientIds,
        recipientNames: uniqueRecipientIds.map((id) => profileMap.get(id) ?? 'Uživatel'),
        recipientCount: uniqueRecipientIds.length,
      }
    })

    return {
      success: true,
      error: null,
      items,
    }
  } catch {
    return { success: false, error: 'Nepodařilo se načíst historii notifikací.', items: [] }
  }
}
