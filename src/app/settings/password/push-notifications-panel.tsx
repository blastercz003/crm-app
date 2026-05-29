'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  deletePushSubscription,
  savePushSubscription,
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
  const [status, setStatus] = useState<PushStatus>('checking')
  const [message, setMessage] = useState('')
  const [isPending, startTransition] = useTransition()
  const [isRemoving, startRemovingTransition] = useTransition()
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

  return (
    <section className="rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5">
      <div className="space-y-4">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
            Push notifikace
          </h2>
        </div>

        {status === 'unsupported' ? (
          <div className="rounded-2xl border border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(255,251,235,0.92)_100%)] px-4 py-3 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(245,158,11,0.1)]">
            Tento prohlížeč nepodporuje Web Push notifikace.
          </div>
        ) : null}

        {status === 'not-configured' ? (
          <div className="rounded-2xl border border-amber-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(255,251,235,0.92)_100%)] px-4 py-3 text-sm font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_22px_rgba(245,158,11,0.1)]">
            Chybí konfigurace VAPID public key.
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(248,250,252,0.9)_100%)] px-4 py-3 text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_10px_20px_rgba(15,23,42,0.08)]">
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
            className="inline-flex items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-4 py-2.5 text-sm font-semibold tracking-[0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_26px_rgba(41,128,185,0.32)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)]"
          >
            {buttonLabel}
          </button>

          <button
            type="button"
            onClick={disableNotifications}
            disabled={isBusy || status !== 'enabled'}
            className="inline-flex items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-2.5 text-sm font-semibold tracking-[0.01em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {isRemoving ? 'ODEBÍRÁM...' : 'ODEBRAT NOTIFIKACE'}
          </button>

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
    <div className="rounded-2xl border border-white/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.86)_0%,rgba(244,248,252,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_14px_28px_rgba(15,23,42,0.08)]">
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
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/85 bg-[linear-gradient(135deg,rgba(255,255,255,0.9)_0%,rgba(246,249,252,0.88)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
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
