'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

const FADE_OUT_MS = 320

export default function LaunchPage() {
  const router = useRouter()
  const [isFading, setIsFading] = useState(false)
  const hasNavigatedRef = useRef(false)

  useEffect(() => {
    const video = document.getElementById('launch-video') as HTMLVideoElement | null
    if (!video) return

    void video.play().catch(() => {
      // iOS may block autoplay in rare cases; navigation fallback below handles it.
    })

    const fallback = window.setTimeout(() => {
      if (hasNavigatedRef.current) return
      hasNavigatedRef.current = true
      setIsFading(true)
      window.setTimeout(() => {
        router.replace('/dashboard')
      }, FADE_OUT_MS)
    }, 6_000)

    return () => {
      window.clearTimeout(fallback)
    }
  }, [router])

  function navigateToApp() {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    setIsFading(true)
    window.setTimeout(() => {
      router.replace('/dashboard')
    }, FADE_OUT_MS)
  }

  return (
    <main
      className={[
        'fixed inset-0 z-50 overflow-hidden bg-black transition-opacity duration-300',
        isFading ? 'opacity-0' : 'opacity-100',
      ].join(' ')}
    >
      <video
        id="launch-video"
        className="h-full w-full object-cover"
        autoPlay
        muted
        playsInline
        preload="auto"
        onEnded={navigateToApp}
        aria-label="Spouštění aplikace B-ENERGY"
      >
        <source src="/launch/mascot-loading.MP4" type="video/mp4" />
      </video>
    </main>
  )
}
