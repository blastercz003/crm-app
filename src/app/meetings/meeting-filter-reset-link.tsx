'use client'

import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

type MeetingFilterResetLinkProps = {
  href: string
  className: string
  detailsId?: string
  children: ReactNode
}

export function MeetingFilterResetLink({
  href,
  className,
  detailsId,
  children,
}: MeetingFilterResetLinkProps) {
  function handleClick(_event: MouseEvent<HTMLAnchorElement>) {
    if (!detailsId) return
    const details = document.getElementById(detailsId)
    if (details instanceof HTMLDetailsElement) {
      details.removeAttribute('open')
    }
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
