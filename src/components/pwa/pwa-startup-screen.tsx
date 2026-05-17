'use client'

import { useEffect } from 'react'
import Image from 'next/image'

const STARTUP_SCREEN_ID = 'pwa-startup-screen'
const STARTUP_TEXT_ID = 'pwa-startup-screen-text'
const STARTUP_FINISHED_KEY = 'pwaStartupFinished'
const STARTUP_ACTIVE_KEY = 'pwaStartupActive'
const DASHBOARD_READY_KEY = 'pwaDashboardReady'
const STARTUP_FADE_MS = 250
const STARTUP_MIN_VISIBLE_MS = 4_000
const STARTUP_FAILSAFE_HIDE_MS = 15_000
const TYPEWRITER_STEP_MS = 42
const DASHBOARD_READY_EVENT = 'pwa-startup:dashboard-ready'

const STARTUP_MESSAGES = [
  'Načítám aplikaci...',
  'Spouštím aplikaci…',
  'Inicializuji systém…',
  'Synchronizuji data…',
  'Chvíli strpení, startuji…',
]

let typewriterTimerId: number | null = null

function isStandalonePwa() {
  if (typeof window === 'undefined') return false

  const isDisplayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true
  const isIosStandalone =
    typeof navigator !== 'undefined' &&
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)

  return isDisplayModeStandalone || isIosStandalone
}

function isMobileDevice() {
  if (typeof navigator === 'undefined') return false

  const ua = navigator.userAgent || ''
  const isAndroid = /Android/i.test(ua)
  const isIos = /iPhone|iPad|iPod/i.test(ua)

  return isAndroid || isIos
}

function shouldShowStartupScreen() {
  if (typeof window === 'undefined') return false

  const mobilePwaStartup = isStandalonePwa() && isMobileDevice()
  const desktopBrowserStartup =
    !isStandalonePwa() &&
    !isMobileDevice() &&
    (window.location.pathname === '/' || window.location.pathname === '/dashboard')

  if (!mobilePwaStartup && !desktopBrowserStartup) return false

  return sessionStorage.getItem(STARTUP_FINISHED_KEY) !== 'true'
}

function startTypewriterMessage() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const textElement = document.getElementById(STARTUP_TEXT_ID)

  if (!textElement) return

  const message = STARTUP_MESSAGES[Math.floor(Math.random() * STARTUP_MESSAGES.length)] ?? ''
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  if (typewriterTimerId) {
    window.clearInterval(typewriterTimerId)
    typewriterTimerId = null
  }

  if (prefersReducedMotion) {
    textElement.textContent = message
    return
  }

  let index = 0
  textElement.textContent = ''

  typewriterTimerId = window.setInterval(() => {
    index += 1
    textElement.textContent = message.slice(0, index)

    if (index >= message.length && typewriterTimerId) {
      window.clearInterval(typewriterTimerId)
      typewriterTimerId = null
    }
  }, TYPEWRITER_STEP_MS)
}

function hideStartupScreen(markFinished = true) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const el = document.getElementById(STARTUP_SCREEN_ID)

  if (markFinished) {
    sessionStorage.setItem(STARTUP_FINISHED_KEY, 'true')
  }
  sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'false')

  if (typewriterTimerId) {
    window.clearInterval(typewriterTimerId)
    typewriterTimerId = null
  }

  if (!el) return

  el.classList.add('is-hiding')

  window.setTimeout(() => {
    el.setAttribute('hidden', 'true')
    el.classList.remove('is-hiding')
  }, STARTUP_FADE_MS)
}

function showStartupScreen() {
  if (typeof document === 'undefined') return

  const el = document.getElementById(STARTUP_SCREEN_ID)
  if (!el) return

  el.removeAttribute('hidden')
  startTypewriterMessage()
}

export function markDashboardStartupReady() {
  if (typeof window === 'undefined') return

  sessionStorage.setItem(DASHBOARD_READY_KEY, 'true')
  window.dispatchEvent(new Event(DASHBOARD_READY_EVENT))
}

export function PwaStartupScreenController() {
  useEffect(() => {
    const shouldShow = shouldShowStartupScreen()
    const startupShownAt = performance.now()

    if (!shouldShow) {
      sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'false')
      hideStartupScreen(false)
      return
    }

    sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'true')
    sessionStorage.setItem(DASHBOARD_READY_KEY, 'false')
    showStartupScreen()

    let hideTimerId: number | null = null
    const failSafeTimerId = window.setTimeout(() => {
      hideStartupScreen()
    }, STARTUP_FAILSAFE_HIDE_MS)

    function scheduleHide() {
      const elapsedMs = performance.now() - startupShownAt
      const remainingMs = Math.max(0, STARTUP_MIN_VISIBLE_MS - elapsedMs)

      if (hideTimerId) {
        window.clearTimeout(hideTimerId)
      }

      hideTimerId = window.setTimeout(() => {
        hideStartupScreen()
      }, remainingMs)
    }

    function onDashboardReady() {
      if (sessionStorage.getItem(STARTUP_ACTIVE_KEY) !== 'true') return
      scheduleHide()
    }

    window.addEventListener(DASHBOARD_READY_EVENT, onDashboardReady)

    if (sessionStorage.getItem(DASHBOARD_READY_KEY) === 'true') {
      onDashboardReady()
    }

    return () => {
      window.removeEventListener(DASHBOARD_READY_EVENT, onDashboardReady)
      window.clearTimeout(failSafeTimerId)
      if (hideTimerId) {
        window.clearTimeout(hideTimerId)
      }
    }
  }, [])

  return null
}

export function PwaStartupScreenShell() {
  return (
    <div id={STARTUP_SCREEN_ID} aria-hidden="true">
      <div className="pwa-startup-screen__content">
        <Image
          className="pwa-startup-screen__logo"
          src="/launch/startup-logo.png"
          alt="B-ENERGY"
          width={110}
          height={110}
        />
        <p className="pwa-startup-screen__text">
          <span id={STARTUP_TEXT_ID} />
          <span className="pwa-startup-screen__cursor" aria-hidden="true">
            |
          </span>
        </p>
      </div>
    </div>
  )
}

export function DashboardStartupReadyBridge() {
  useEffect(() => {
    if (sessionStorage.getItem(STARTUP_ACTIVE_KEY) !== 'true') return

    markDashboardStartupReady()
  }, [])

  return null
}
