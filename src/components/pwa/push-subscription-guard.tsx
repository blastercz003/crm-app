'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { SuccessConfirmationModal } from '@/components/ui/success-confirmation-modal'
import { createClient } from '@/lib/supabase/client'
import {
  supportsPushNotifications,
  syncPushSubscriptionWithServer,
} from '@/app/settings/password/push-subscription-client'

const PUSH_RECOVERY_MODAL_DISMISSED_KEY = 'pushSubscriptionRecoveryModalDismissed'

export function PushSubscriptionGuard() {
  const pathname = usePathname()
  const router = useRouter()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const checkInFlightRef = useRef(false)

  useEffect(() => {
    if (pathname === '/settings/password') {
      setIsModalOpen(false)
    }
  }, [pathname])

  useEffect(() => {
    let isActive = true

    function shouldSuppressModal() {
      if (pathname === '/settings/password') return true

      try {
        return sessionStorage.getItem(PUSH_RECOVERY_MODAL_DISMISSED_KEY) === 'true'
      } catch {
        return false
      }
    }

    async function runCheck() {
      if (!isActive || checkInFlightRef.current || pathname === '/settings/password') return
      if (!supportsPushNotifications()) return
      if (Notification.permission !== 'granted') return

      const supabase = createClient()
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser()

      if (!isActive || error || !user) return

      checkInFlightRef.current = true

      try {
        const result = await syncPushSubscriptionWithServer()

        if (!isActive) return

        if (result.shouldPromptManualRecovery && !shouldSuppressModal()) {
          setIsModalOpen(true)
        }
      } finally {
        checkInFlightRef.current = false
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void runCheck()
      }
    }

    function handleWindowFocus() {
      void runCheck()
    }

    void runCheck()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    return () => {
      isActive = false
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [pathname])

  function handleConfirm() {
    try {
      sessionStorage.setItem(PUSH_RECOVERY_MODAL_DISMISSED_KEY, 'true')
    } catch {}

    setIsModalOpen(false)
    router.push('/settings/password')
  }

  return (
    <SuccessConfirmationModal
      isOpen={isModalOpen}
      section="Aplikace"
      title="Obnova notifikací"
      message="Push notifikace je potřeba obnovit pro toto zařízení."
      onConfirm={handleConfirm}
    />
  )
}
