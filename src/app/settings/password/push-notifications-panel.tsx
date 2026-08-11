'use client'

import { useEffect, useState, useTransition } from 'react'
import { deletePushSubscription, savePushSubscription } from './push-actions'
import { syncPushSubscriptionWithServer } from './push-subscription-client'

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
  const [status, setStatus] = useState<PushStatus>('checking')
  const [message, setMessage] = useState('')
  const [isEnabling, startEnablingTransition] = useTransition()
  const [isRemoving, startRemovingTransition] = useTransition()

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
        const result = await syncPushSubscriptionWithServer()

        if (!cancelled) {
          setStatus(result.hasLocalSubscription ? 'enabled' : 'ready')

          if (result.serverSyncStatus === 'resynced') {
            setMessage('Notifikace byly pro toto zařízení automaticky obnoveny.')
          }
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

    startEnablingTransition(async () => {
      const result = await savePushSubscription(subscription.toJSON())

      if (!result.success) {
        setMessage(result.error ?? 'Notifikace se nepodařilo uložit.')
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
      setMessage('Notifikace se nepodařilo vypnout v prohlížeči.')
      return
    }

    startRemovingTransition(async () => {
      const result = await deletePushSubscription(endpoint)

      if (!result.success) {
        setMessage(result.error ?? 'Notifikace se nepodařilo vypnout.')
        return
      }

      setStatus('ready')
      setMessage('Notifikace byly vypnuty pro toto zařízení.')
    })
  }

  const isBusy = isEnabling || isRemoving
  const isEnabled = status === 'enabled'
  const isUnavailable = status === 'unsupported' || status === 'not-configured'
  const stateLabel =
    status === 'checking'
      ? 'Zjišťuji stav'
      : isEnabled
        ? 'Zapnuté'
        : isUnavailable
          ? 'Nedostupné'
          : 'Vypnuté'
  const buttonLabel = isEnabling
    ? 'ZAPÍNÁM...'
    : isRemoving
      ? 'VYPÍNÁM...'
      : isEnabled
        ? 'VYPNOUT NOTIFIKACE'
        : 'ZAPNOUT NOTIFIKACE'

  return (
    <div className="mt-5 border-t border-[#d5e2ec] pt-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)]">
      <div className="flex items-center justify-between gap-3">
        <div className="password-page__eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Notifikace
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            isEnabled
              ? 'bg-emerald-100 text-emerald-700'
              : isUnavailable
                ? 'bg-amber-100 text-amber-800'
                : 'bg-slate-100 text-slate-600'
          }`}
        >
          {stateLabel}
        </span>
      </div>

      <div className="password-page__widget-card mt-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="password-page__text text-sm text-zinc-500">
            Dostávejte upozornění na důležité změny i mimo otevřenou aplikaci.
          </p>
          <button
            type="button"
            onClick={() => void (isEnabled ? disableNotifications() : enableNotifications())}
            disabled={isBusy || status === 'checking' || isUnavailable}
            className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-3 py-2 text-[12px] font-semibold tracking-[0.01em] transition duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${
              isEnabled
                ? 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
                : 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(41,128,185,0.24)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_26px_rgba(41,128,185,0.32)]'
            }`}
          >
            {buttonLabel}
          </button>
        </div>

        {status === 'unsupported' ? (
          <p className="mt-3 text-xs font-medium text-amber-800">
            Tento prohlížeč notifikace nepodporuje.
          </p>
        ) : null}

        {status === 'not-configured' ? (
          <p className="mt-3 text-xs font-medium text-amber-800">
            Notifikace teď nejsou v aplikaci dostupné.
          </p>
        ) : null}

        {message ? <p className="mt-3 text-xs font-medium text-zinc-600">{message}</p> : null}
      </div>
    </div>
  )
}
