import { LOCAL_STORAGE_KEYS } from './constants'
import type { Difficulty, ThemeName } from './types'

export type SnakeSettings = {
  difficulty: Difficulty
  themeName: ThemeName
  customSnakeColor: string | null
  customFoodColor: string | null
  customBoardColor: string | null
  customAccentColor: string | null
}

export function loadSnakeSettings(): SnakeSettings | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.settings)
    if (!raw) return null
    return JSON.parse(raw) as SnakeSettings
  } catch {
    return null
  }
}

export function saveSnakeSettings(settings: SnakeSettings) {
  window.localStorage.setItem(LOCAL_STORAGE_KEYS.settings, JSON.stringify(settings))
}

export function loadLocalBest() {
  const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.localBest)
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

export function saveLocalBest(score: number) {
  window.localStorage.setItem(LOCAL_STORAGE_KEYS.localBest, String(score))
}

export function getOrCreateGuestPlayerId() {
  const existing = window.localStorage.getItem(LOCAL_STORAGE_KEYS.guestPlayerId)
  if (existing) return existing

  const created = globalThis.crypto?.randomUUID?.() ?? `guest-${Date.now()}-${Math.random()}`
  window.localStorage.setItem(LOCAL_STORAGE_KEYS.guestPlayerId, created)
  return created
}

export function loadGuestDisplayName() {
  return window.localStorage.getItem(LOCAL_STORAGE_KEYS.guestDisplayName) ?? ''
}

export function saveGuestDisplayName(value: string) {
  window.localStorage.setItem(LOCAL_STORAGE_KEYS.guestDisplayName, value)
}
