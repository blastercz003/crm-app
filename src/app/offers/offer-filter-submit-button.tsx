'use client'

import { NAVIGATION_OVERLAY_START_EVENT } from '@/components/navigation/navigation-overlay'
import type { ReactNode } from 'react'

type OfferFilterSubmitButtonProps = {
  className: string
  children: ReactNode
}

export function OfferFilterSubmitButton({
  className,
  children,
}: OfferFilterSubmitButtonProps) {
  return (
    <button
      type="submit"
      onClick={() => {
        window.dispatchEvent(new Event(NAVIGATION_OVERLAY_START_EVENT))
      }}
      className={className}
    >
      {children}
    </button>
  )
}
