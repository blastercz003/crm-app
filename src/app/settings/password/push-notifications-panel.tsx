'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  createTestCrmNotification,
  deletePushSubscription,
  savePushSubscription,
  sendTestPushNotification,
} from './push-actions'

type PushStatus = 'checking' | 'unsupported' | 'not-configured' | 'ready' | 'enabled'

type BadgeDiagnostics = {
  browserLabel: string
  notificationPermission: NotificationPermission | 'unsupported'
  isSecureContext: boolean
  isStandalone: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasNotifications: boolean
  hasBadgeApi: boolean
  hasClearBadgeApi: boolean
  hasPushSubscription: boolean | null
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

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
  const [isRemoving, startRemovingTransition] = useTransition()
  const [isSendingTest, startSendingTestTransition] = useTransition()
  const [isCreatingCrmTest, startCreatingCrmTestTransition] = useTransition()
  const [diagnostics, setDiagnostics] = useState<BadgeDiagnostics | null>(null)

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

  useEffect(() => {
    let cancelled = false

    async function checkBadgeDiagnostics() {
      const navigatorWithStandalone = navigator as NavigatorWithStandalone
      const navigatorWithBadging = navigator as NavigatorWithBadging
      const userAgent = navigator.userAgent
      const hasServiceWorker = 'serviceWorker' in navigator
      const hasPushManager = 'PushManager' in window
      const hasNotifications = 'Notification' in window
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        navigatorWithStandalone.standalone === true
      let hasPushSubscription: boolean | null = null

      if (hasServiceWorker && hasPushManager) {
        try {
          const registration = await navigator.serviceWorker.ready
          const subscription = await registration.pushManager.getSubscription()
          hasPushSubscription = Boolean(subscription)
        } catch {
          hasPushSubscription = null
        }
      }

      if (cancelled) return

      setDiagnostics({
        browserLabel: getBrowserLabel(userAgent),
        notificationPermission: hasNotifications
          ? Notification.permission
          : 'unsupported',
        isSecureContext: window.isSecureContext,
        isStandalone,
        hasServiceWorker,
        hasPushManager,
        hasNotifications,
        hasBadgeApi: typeof navigatorWithBadging.setAppBadge === 'function',
        hasClearBadgeApi:
          typeof navigatorWithBadging.clearAppBadge === 'function',
        hasPushSubscription,
      })
    }

    void checkBadgeDiagnostics()

    return () => {
      cancelled = true
    }
  }, [status])

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

  async function disableNotifications() {
    setMessage('')

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }

    const registration = await navigator.serviceWorker.ready
    const subscription = await registration.pushManager.getSubscription()

    if (!subscription) {
      setStatus('ready')
      setMessage('Notifikace už nejsou zapnuté pro toto zařízení.')
      return
    }

    const endpoint = subscription.endpoint
    const unsubscribed = await subscription.unsubscribe()

    if (!unsubscribed) {
      setMessage('Notifikace se nepodařilo odebrat v prohlížeči.')
      return
    }

    startRemovingTransition(async () => {
      const result = await deletePushSubscription(endpoint)

      if (!result.success) {
        setMessage(result.error ?? 'Subscription se nepodařilo odebrat.')
        return
      }

      setStatus('ready')
      setMessage('Notifikace byly odebrány pro toto zařízení.')
    })
  }

  const isBusy = isPending || isRemoving

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
      <div className="max-w-2xl space-y-5">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
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
              isBusy ||
              status === 'checking' ||
              status === 'unsupported' ||
              status === 'not-configured' ||
              status === 'enabled'
            }
            className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buttonLabel}
          </button>

          <button
            type="button"
            onClick={disableNotifications}
            disabled={isBusy || status !== 'enabled'}
            className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRemoving ? 'ODEBÍRÁM...' : 'ODEBRAT NOTIFIKACE'}
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

        <BadgeDiagnosticsPanel diagnostics={diagnostics} status={status} />
      </div>
    </section>
  )
}

function getBrowserLabel(userAgent: string) {
  if (/Android/i.test(userAgent) && /Chrome/i.test(userAgent)) {
    return 'Android Chrome'
  }

  if (/iPhone|iPad|iPod/i.test(userAgent) && /Safari/i.test(userAgent)) {
    return 'iOS Safari / PWA'
  }

  if (/Edg\//i.test(userAgent)) return 'Microsoft Edge'
  if (/Chrome/i.test(userAgent)) return 'Chrome'
  if (/Safari/i.test(userAgent)) return 'Safari'
  if (/Firefox/i.test(userAgent)) return 'Firefox'

  return 'Neznámý prohlížeč'
}

function BadgeDiagnosticsPanel({
  diagnostics,
  status,
}: {
  diagnostics: BadgeDiagnostics | null
  status: PushStatus
}) {
  const badgeReady = diagnostics?.hasBadgeApi === true
  const pushReady =
    diagnostics?.isSecureContext === true &&
    diagnostics?.hasServiceWorker === true &&
    diagnostics?.hasPushManager === true &&
    diagnostics?.hasNotifications === true

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:items-start sm:justify-between sm:text-left">
        <div className="w-full sm:w-auto">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-zinc-500">
            Diagnostika
          </h3>
          <p className="mt-1 text-sm text-zinc-600">
            Analyzuje aktuální prohlížeč.
          </p>
        </div>

        <span
          className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            badgeReady
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {badgeReady ? 'BADGE PODPOROVÁN' : 'BADGE NELZE OVĚŘIT'}
        </span>
      </div>

      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <DiagnosticsRow
          label="Zařízení / prohlížeč"
          value={diagnostics?.browserLabel ?? 'Zjišťuji...'}
          state={diagnostics ? 'neutral' : 'pending'}
        />
        <DiagnosticsRow
          label="Web Push"
          value={pushReady ? 'Podporován' : 'Nepodporován / nekompletní'}
          state={pushReady ? 'ok' : 'warn'}
        />
        <DiagnosticsRow
          label="Oprávnění notifikací"
          value={getPermissionLabel(diagnostics?.notificationPermission)}
          state={
            diagnostics?.notificationPermission === 'granted'
              ? 'ok'
              : diagnostics?.notificationPermission === 'denied'
                ? 'warn'
                : 'neutral'
          }
        />
        <DiagnosticsRow
          label="PWA režim"
          value={diagnostics?.isStandalone ? 'Spuštěno jako appka' : 'Běží v prohlížeči'}
          state={diagnostics?.isStandalone ? 'ok' : 'neutral'}
        />
        <DiagnosticsRow
          label="Badge API"
          value={diagnostics?.hasBadgeApi ? 'Dostupné' : 'Nedostupné'}
          state={diagnostics?.hasBadgeApi ? 'ok' : 'warn'}
        />
        <DiagnosticsRow
          label="Odebrání badge"
          value={diagnostics?.hasClearBadgeApi ? 'Dostupné' : 'Fallback přes nulu'}
          state={diagnostics?.hasClearBadgeApi ? 'ok' : 'neutral'}
        />
        <DiagnosticsRow
          label="Subscription"
          value={getSubscriptionLabel(diagnostics?.hasPushSubscription, status)}
          state={diagnostics?.hasPushSubscription ? 'ok' : 'neutral'}
        />
        <DiagnosticsRow
          label="Bezpečný kontext"
          value={diagnostics?.isSecureContext ? 'Ano' : 'Ne'}
          state={diagnostics?.isSecureContext ? 'ok' : 'warn'}
        />
      </div>
    </div>
  )
}

function DiagnosticsRow({
  label,
  value,
  state,
}: {
  label: string
  value: string
  state: 'ok' | 'warn' | 'neutral' | 'pending'
}) {
  const dotClass =
    state === 'ok'
      ? 'bg-emerald-500'
      : state === 'warn'
        ? 'bg-amber-500'
        : state === 'pending'
          ? 'bg-zinc-300'
          : 'bg-sky-500'

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2">
      <span className="text-zinc-500">{label}</span>
      <span className="inline-flex items-center gap-2 text-right font-medium text-zinc-800">
        <span className={`h-2 w-2 rounded-full ${dotClass}`} />
        {value}
      </span>
    </div>
  )
}

function getPermissionLabel(
  permission: BadgeDiagnostics['notificationPermission'] | undefined
) {
  if (!permission) return 'Zjišťuji...'
  if (permission === 'unsupported') return 'Nepodporováno'
  if (permission === 'granted') return 'Povoleno'
  if (permission === 'denied') return 'Zakázáno'
  return 'Zatím nerozhodnuto'
}

function getSubscriptionLabel(
  hasPushSubscription: boolean | null | undefined,
  status: PushStatus
) {
  if (hasPushSubscription === true) return 'Uložena v prohlížeči'
  if (hasPushSubscription === false) return 'Zatím není'
  if (status === 'checking') return 'Zjišťuji...'
  return 'Nelze ověřit'
}
