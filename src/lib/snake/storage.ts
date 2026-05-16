import { LOCAL_STORAGE_KEYS } from './constants'
import type { Difficulty, GameMode, ThemeName, VisualSkin } from './types'

export type SnakeSettings = {
  difficulty: Difficulty
  gameMode: GameMode
  visualSkin: VisualSkin
  themeName: ThemeName
  soundEnabled: boolean
  customSnakeColor: string | null
  customFoodColor: string | null
  customBoardColor: string | null
  customAccentColor: string | null
}

export function loadSnakeSettings(): SnakeSettings | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEYS.settings)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SnakeSettings>
    if (!parsed.difficulty || !parsed.themeName) return null
    return {
      difficulty: parsed.difficulty,
      gameMode: (parsed.gameMode as GameMode) ?? 'classic',
      visualSkin: (parsed.visualSkin as VisualSkin) ?? 'classic-arcade',
      themeName: parsed.themeName,
      soundEnabled: parsed.soundEnabled ?? true,
      customSnakeColor: parsed.customSnakeColor ?? null,
      customFoodColor: parsed.customFoodColor ?? null,
      customBoardColor: parsed.customBoardColor ?? null,
      customAccentColor: parsed.customAccentColor ?? null,
    }
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
