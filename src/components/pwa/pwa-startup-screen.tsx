'use client'

import { useEffect } from 'react'

const STARTUP_SCREEN_ID = 'pwa-startup-screen'
const STARTUP_TEXT_ID = 'pwa-startup-screen-text'
const STARTUP_FINISHED_KEY = 'pwaStartupFinished'
const STARTUP_ACTIVE_KEY = 'pwaStartupActive'
const STARTUP_FADE_MS = 250
const DESKTOP_STARTUP_DELAY_MS = 140
const STARTUP_FAILSAFE_HIDE_MS = 10_000
const TYPEWRITER_STEP_MS = 42

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

function ensureStartupScreen() {
  if (typeof document === 'undefined') return
  if (document.getElementById(STARTUP_SCREEN_ID)) return

  const element = document.createElement('div')
  element.id = STARTUP_SCREEN_ID
  element.setAttribute('aria-hidden', 'true')
  element.innerHTML = `
    <div class="pwa-startup-screen__content">
      <img
        class="pwa-startup-screen__logo"
        src="/launch/startup-logo.png"
        alt="B-ENERGY"
        width="220"
        height="220"
      />
      <p class="pwa-startup-screen__text">
        <span id="${STARTUP_TEXT_ID}"></span><span class="pwa-startup-screen__cursor" aria-hidden="true">|</span>
      </p>
    </div>
  `

  document.body.appendChild(element)
  startTypewriterMessage()
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

function hideStartupScreen() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const el = document.getElementById(STARTUP_SCREEN_ID)

  sessionStorage.setItem(STARTUP_FINISHED_KEY, 'true')
  sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'false')

  if (typewriterTimerId) {
    window.clearInterval(typewriterTimerId)
    typewriterTimerId = null
  }

  if (!el) return

  el.classList.add('is-hiding')

  window.setTimeout(() => {
    el.remove()
  }, STARTUP_FADE_MS)
}

export function markDashboardStartupReady() {
  if (typeof window === 'undefined') return

  if (sessionStorage.getItem(STARTUP_ACTIVE_KEY) !== 'true') return

  hideStartupScreen()
}

export function PwaStartupScreenController() {
  useEffect(() => {
    if (!shouldShowStartupScreen()) {
      sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'false')
      return
    }

    const isDesktopStartup = !isStandalonePwa() && !isMobileDevice()

    sessionStorage.setItem(STARTUP_ACTIVE_KEY, 'true')

    const showTimerId = window.setTimeout(
      () => {
        ensureStartupScreen()
      },
      isDesktopStartup ? DESKTOP_STARTUP_DELAY_MS : 0
    )

    const failSafeTimerId = window.setTimeout(() => {
      hideStartupScreen()
    }, STARTUP_FAILSAFE_HIDE_MS)

    return () => {
      window.clearTimeout(showTimerId)
      window.clearTimeout(failSafeTimerId)
    }
  }, [])

  return null
}

export function DashboardStartupReadyBridge() {
  useEffect(() => {
    markDashboardStartupReady()
  }, [])

  return null
}
