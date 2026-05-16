import { BASE_FOOD_POINTS, BONUS_MULTIPLIER } from './constants'
import type { Difficulty } from './types'

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  normal: 1.25,
  hard: 1.5,
  expert: 2,
}

export function calculateScore(
  difficulty: Difficulty,
  level: number,
  kind: 'normal' | 'bonus'
) {
  const difficultyMultiplier = DIFFICULTY_MULTIPLIER[difficulty]
  const levelMultiplier = 1 + (Math.max(1, level) - 1) * 0.1
  const raw = BASE_FOOD_POINTS * difficultyMultiplier * levelMultiplier
  const perFood = Math.round(raw)
  return kind === 'bonus' ? perFood * BONUS_MULTIPLIER : perFood
}

export function calculateLevel(foodEaten: number) {
  if (foodEaten <= 0) return 1
  return Math.max(1, Math.floor(foodEaten / 5) + 1)
}
