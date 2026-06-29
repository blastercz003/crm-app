'use client'

import {
  checkPushSubscriptionStatus,
  savePushSubscription,
} from './push-actions'

export type PushSubscriptionServerSyncStatus =
  | 'idle'
  | 'checking'
  | 'synced'
  | 'resynced'
  | 'missing'
  | 'failed'

export type PushSubscriptionSyncResult = {
  hasLocalSubscription: boolean
  serverSyncStatus: PushSubscriptionServerSyncStatus
  shouldPromptManualRecovery: boolean
}

export function supportsPushNotifications() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function getCurrentPushSubscription() {
  if (!supportsPushNotifications()) {
    return null
  }

  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

export async function syncPushSubscriptionWithServer(): Promise<PushSubscriptionSyncResult> {
  const subscription = await getCurrentPushSubscription()

  if (!subscription) {
    return {
      hasLocalSubscription: false,
      serverSyncStatus: 'idle',
      shouldPromptManualRecovery: false,
    }
  }

  const checkResult = await checkPushSubscriptionStatus(subscription.endpoint)

  if (!checkResult.success) {
    return {
      hasLocalSubscription: true,
      serverSyncStatus: 'failed',
      shouldPromptManualRecovery: false,
    }
  }

  if (checkResult.status === 'found') {
    return {
      hasLocalSubscription: true,
      serverSyncStatus: 'synced',
      shouldPromptManualRecovery: false,
    }
  }

  const saveResult = await savePushSubscription(subscription.toJSON())

  if (saveResult.success) {
    return {
      hasLocalSubscription: true,
      serverSyncStatus: 'resynced',
      shouldPromptManualRecovery: false,
    }
  }

  return {
    hasLocalSubscription: true,
    serverSyncStatus: 'missing',
    shouldPromptManualRecovery: true,
  }
}
