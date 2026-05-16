import { THEMES } from './constants'
import type { SnakeTheme, ThemeName } from './types'

export function getThemeByName(name: ThemeName | string | null | undefined): SnakeTheme {
  const found = THEMES.find((theme) => theme.name === name)
  return found ?? THEMES[0]
}

export function toSafeHexColor(value: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}
