'use client'

import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

type JobsPortalFilterResetLinkProps = {
  href: string
  className: string
  children: ReactNode
}

export function JobsPortalFilterResetLink({
  href,
  className,
  children,
}: JobsPortalFilterResetLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const details = event.currentTarget.closest('details')
    if (details) {
      details.removeAttribute('open')
    }
  }

  return (
    <Link href={href} className={className} onClick={handleClick}>
      {children}
    </Link>
  )
}
