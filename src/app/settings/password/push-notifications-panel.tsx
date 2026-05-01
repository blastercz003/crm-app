'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  createTestCrmNotification,
  savePushSubscription,
  sendTestPushNotification,
} from './push-actions'

type PushStatus = 'checking' | 'unsupported' | 'not-configured' | 'ready' | 'enabled'

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index)
  }

  return output
}

export function PushNotificationsPanel() {
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''
  const showTestControls =
    process.env.NEXT_PUBLIC_PUSH_TEST_CONTROLS_ENABLED === 'true'
  const [status, setStatus] = useState<PushStatus>('checking')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const [isSendingTest, startSendingTestTransition] = useTransition()
  const [isCreatingCrmTest, startCreatingCrmTestTransition] = useTransition()

  const buttonLabel = useMemo(() => {
    if (isPending) return 'ZAPÍNÁM...'
    if (status === 'enabled') return 'NOTIFIKACE JSOU ZAPNUTÉ'
    return 'ZAPNOUT NOTIFIKACE'
  }, [isPending, status])

  useEffect(() => {
    let cancelled = false

    async function checkPushStatus() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setStatus('unsupported')
        return
      }

      if (!vapidPublicKey) {
        if (!cancelled) setStatus('not-configured')
        return
      }

      try {
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        if (!cancelled) {
          setStatus(subscription ? 'enabled' : 'ready')
        }
      } catch {
        if (!cancelled) setStatus('ready')
      }
    }

    void checkPushStatus()

    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  async function enableNotifications() {
    setMessage('')

    if (!vapidPublicKey) {
      setStatus('not-configured')
      return
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }

    const permission = await Notification.requestPermission()

    if (permission !== 'granted') {
      setMessage('Notifikace nebyly povoleny v prohlížeči.')
      return
    }

    const registration = await navigator.serviceWorker.ready
    const existingSubscription = await registration.pushManager.getSubscription()
    const subscription =
      existingSubscription ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }))

    const serializedSubscription = subscription.toJSON()

    startTransition(async () => {
      const result = await savePushSubscription(serializedSubscription)

      if (!result.success) {
        setMessage(result.error ?? 'Subscription se nepodařilo uložit.')
        return
      }

      setStatus('enabled')
      setMessage('Notifikace jsou zapnuté pro toto zařízení.')
    })
  }

  function sendTestNotification() {
    setMessage('')

    startSendingTestTransition(async () => {
      const result = await sendTestPushNotification()

      if (!result.success) {
        setMessage(result.error ?? 'Testovací notifikaci se nepodařilo odeslat.')
        return
      }

      setMessage(
        `Testovací notifikace byla odeslána (${result.sentCount} zařízení).`
      )
    })
  }

  function createCrmTestNotification() {
    setMessage('')

    startCreatingCrmTestTransition(async () => {
      const result = await createTestCrmNotification()

      if (!result.success) {
        setMessage(
          result.error ?? 'Testovací CRM notifikaci se nepodařilo vytvořit.'
        )
        return
      }

      setMessage('Testovací CRM notifikace byla vytvořena.')
    })
  }

  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="max-w-xl space-y-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Push notifikace
          </h2>
        </div>

        {status === 'unsupported' ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Tento prohlížeč nepodporuje Web Push notifikace.
          </div>
        ) : null}

        {status === 'not-configured' ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Chybí konfigurace VAPID public key.
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
            {message}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={enableNotifications}
            disabled={
              isPending ||
              status === 'checking' ||
              status === 'unsupported' ||
              status === 'not-configured' ||
              status === 'enabled'
            }
            className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buttonLabel}
          </button>

          {showTestControls ? (
            <>
              <button
                type="button"
                onClick={sendTestNotification}
                disabled={isSendingTest || status !== 'enabled'}
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSendingTest ? 'ODESÍLÁM...' : 'POSLAT TEST'}
              </button>

              <button
                type="button"
                onClick={createCrmTestNotification}
                disabled={isCreatingCrmTest || status !== 'enabled'}
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingCrmTest ? 'VYTVÁŘÍM...' : 'CRM TEST'}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
