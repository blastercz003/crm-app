'use client'

import { useEffect, useRef } from 'react'

export function SystemHistoryLiveBadge() {
  const badgeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const badge = badgeRef.current
    if (!badge) return

    let visible = true
    const syncActivity = () => {
      badge.dataset.liveActive = document.visibilityState === 'visible' && visible ? 'true' : 'false'
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      syncActivity()
    }, { threshold: 0.05 })

    observer.observe(badge)
    document.addEventListener('visibilitychange', syncActivity)
    syncActivity()

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', syncActivity)
    }
  }, [])

  return (
    <span ref={badgeRef} className="activities-workspace__live-badge" role="status" aria-label="Poslední události jsou sledovány živě">
      <span className="activities-workspace__live-dot" aria-hidden />
      ŽIVĚ
    </span>
  )
}
