'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { NAVIGATION_OVERLAY_START_EVENT } from '../../../components/navigation/navigation-overlay'
import {
  clearOfferDirtyState,
  confirmOfferNavigation,
} from './offer-unsaved-changes-guard'

type GuardedOfferLinkProps = {
  href: string
  children: ReactNode
  className?: string
  message: string
}

export function GuardedOfferLink({
  href,
  children,
  className,
  message,
}: GuardedOfferLinkProps) {
  const router = useRouter()

  function handleClick() {
    if (!confirmOfferNavigation(message)) return

    clearOfferDirtyState()
    window.dispatchEvent(new Event(NAVIGATION_OVERLAY_START_EVENT))
    router.push(href)
  }

  return (
    <button type="button" className={className} onClick={handleClick}>
      {children}
    </button>
  )
}
