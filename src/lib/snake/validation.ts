import { z } from 'zod'
import { getDifficultyConfig } from './gameLogic'
import { calculateScore } from './scoring'
import type { Difficulty, GameMode } from './types'

const DIFFICULTIES = ['easy', 'normal', 'hard', 'expert'] as const
const GAME_MODES = ['classic', 'arcade-chaos', 'zen', 'enemy-hunt'] as const

export const scorePayloadSchema = z.object({
  score: z.number().int().nonnegative(),
  level: z.number().int().min(1).max(99),
  difficulty: z.enum(DIFFICULTIES),
  gameMode: z.enum(GAME_MODES),
  durationMs: z.number().int().min(500).max(1000 * 60 * 60),
  foodEaten: z.number().int().min(1).max(5000),
  displayName: z.string().min(1).max(32),
  anonymousPlayerId: z.string().min(8).max(128).nullable(),
  themeName: z.string().max(64).nullable(),
})

export function sanitizeDisplayName(value: string) {
  return value.replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 32)
}

export function isPossibleScore(payload: {
  score: number
  level: number
  difficulty: Difficulty
  durationMs: number
  foodEaten: number
}) {
  const config = getDifficultyConfig(payload.difficulty)
  const minTick = Math.max(config.minSpeedMs, 45)
  const maxTicks = Math.floor(payload.durationMs / minTick)

  if (payload.foodEaten > maxTicks + 2) return false

  const normalAtLevel = calculateScore(payload.difficulty, payload.level, 'normal')
  const maxPerFood = normalAtLevel * 3
  const theoreticalMax = payload.foodEaten * maxPerFood

  return payload.score <= theoreticalMax
}

export function parseDifficultyFilter(value: string | null) {
  if (!value || value === 'all') return 'all'
  if (DIFFICULTIES.includes(value as (typeof DIFFICULTIES)[number])) {
    return value as Difficulty
  }
  return 'all'
}

export function parsePeriodFilter(value: string | null) {
  if (value === 'today' || value === 'week' || value === 'all') return value
  return 'all'
}

export function normalizeGameMode(value: unknown): GameMode | null {
  if (typeof value !== 'string') return null
  if (GAME_MODES.includes(value as (typeof GAME_MODES)[number])) return value as GameMode
  return null
}
