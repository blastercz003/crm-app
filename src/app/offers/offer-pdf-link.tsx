'use client'

import Link from 'next/link'
import type { MouseEvent, ReactNode } from 'react'

type OfferPdfLinkProps = {
  offerId: string
  className: string
  children: ReactNode
  guardUnsavedChanges?: boolean
  returnTo?: 'offers' | 'detail'
}

export function OfferPdfLink({
  offerId,
  className,
  children,
  guardUnsavedChanges = false,
  returnTo = 'detail',
}: OfferPdfLinkProps) {
  const printHref = `/offers/${offerId}/pdf?standalone=1&print=1`
  const mobilePreviewHref = `/offers/${offerId}/pdf?standalone=1&mobilePreview=1&returnTo=${returnTo}`

  function openMobilePreview(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || !window.matchMedia('(max-width: 767px)').matches) return

    event.preventDefault()
    window.location.assign(mobilePreviewHref)
  }

  return (
    <Link
      href={printHref}
      target="_blank"
      rel="noreferrer"
      onClick={openMobilePreview}
      data-offer-unsaved-guard={guardUnsavedChanges ? 'true' : undefined}
      className={className}
    >
      {children}
    </Link>
  )
}
