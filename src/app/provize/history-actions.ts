'use server'

import type { ProvizeSalesOwner } from '@/lib/provize/access'
import {
  getProvizeHistoryPayload,
  requireProvizeHistoryAccess,
} from '@/lib/provize/history'
import type { ProvizeHistoryPayload } from '@/lib/provize/history'

type HistoryActionResult =
  | {
      success: true
      payload: ProvizeHistoryPayload
    }
  | {
      success: false
      error: string
    }

export async function getProvizeHistoryAction(
  requestedOwner?: ProvizeSalesOwner
): Promise<HistoryActionResult> {
  const access = await requireProvizeHistoryAccess()

  if (!access.success) {
    return {
      success: false,
      error: access.error,
    }
  }

  try {
    const payload = await getProvizeHistoryPayload(access, requestedOwner)

    return {
      success: true,
      payload,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : 'Historii výplat se nepodařilo načíst.',
    }
  }
}
