'use client'

import type { MouseEvent, ReactNode } from 'react'
import { NAVIGATION_OVERLAY_START_EVENT } from '@/components/navigation/navigation-overlay'

type TaskFilterSubmitButtonProps = {
  className: string
  children: ReactNode
}

export function TaskFilterSubmitButton({
  className,
  children,
}: TaskFilterSubmitButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    const details = event.currentTarget.closest('details')
    if (details) {
      details.removeAttribute('open')
    }
    window.dispatchEvent(new Event(NAVIGATION_OVERLAY_START_EVENT))
  }

  return (
    <button type="submit" onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
