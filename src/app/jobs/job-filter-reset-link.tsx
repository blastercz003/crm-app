'use client'

import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

type JobFilterResetLinkProps = {
  href: string
  className: string
  children: ReactNode
}

export function JobFilterResetLink({
  href,
  className,
  children,
}: JobFilterResetLinkProps) {
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
