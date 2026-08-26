'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'

type OfferPdfLinkProps = {
  offerId: string
  className: string
  children: ReactNode
  guardUnsavedChanges?: boolean
  returnTo?: 'offers' | 'detail'
  mobilePendingLabel?: string
}

export function OfferPdfLink({
  offerId,
  className,
  children,
  guardUnsavedChanges = false,
  returnTo = 'detail',
  mobilePendingLabel,
}: OfferPdfLinkProps) {
  const [isMobilePending, setIsMobilePending] = useState(false)
  const firstFrameRef = useRef<number | null>(null)
  const secondFrameRef = useRef<number | null>(null)
  const printHref = `/offers/${offerId}/pdf?standalone=1&print=1`
  const mobilePreviewHref = `/offers/${offerId}/pdf?standalone=1&mobilePreview=1&returnTo=${returnTo}`

  useEffect(() => {
    const resetPending = () => setIsMobilePending(false)

    window.addEventListener('pageshow', resetPending)
    return () => {
      window.removeEventListener('pageshow', resetPending)
      if (firstFrameRef.current !== null) {
        window.cancelAnimationFrame(firstFrameRef.current)
      }
      if (secondFrameRef.current !== null) {
        window.cancelAnimationFrame(secondFrameRef.current)
      }
    }
  }, [])

  function openMobilePreview(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || !window.matchMedia('(max-width: 767px)').matches) return

    event.preventDefault()
    if (isMobilePending) return

    setIsMobilePending(true)
    firstFrameRef.current = window.requestAnimationFrame(() => {
      secondFrameRef.current = window.requestAnimationFrame(() => {
        window.location.assign(mobilePreviewHref)
      })
    })
  }

  return (
    <Link
      href={printHref}
      target="_blank"
      rel="noreferrer"
      onClick={openMobilePreview}
      aria-busy={isMobilePending}
      aria-disabled={isMobilePending || undefined}
      data-offer-unsaved-guard={guardUnsavedChanges ? 'true' : undefined}
      className={`${className} relative`}
    >
      <span className={isMobilePending ? 'invisible' : undefined}>{children}</span>
      {isMobilePending ? (
        <span className="absolute inset-0 inline-flex items-center justify-center gap-2" aria-hidden="true">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current/35 border-t-current" />
          {mobilePendingLabel ? <span>{mobilePendingLabel}</span> : null}
        </span>
      ) : null}
    </Link>
  )
}
