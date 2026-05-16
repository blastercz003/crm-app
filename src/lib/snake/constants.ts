import type { DifficultyConfig, GameMode, SnakeTheme, VisualSkin } from './types'

export const SNAKE_GRID_SIZE = 24
export const SNAKE_CELL_SIZE = 14

export const LOCAL_STORAGE_KEYS = {
  settings: 'snake-settings-v1',
  localBest: 'snake-local-best-v1',
  guestPlayerId: 'snake-guest-player-id-v1',
  guestDisplayName: 'snake-guest-display-name-v1',
} as const

export const BASE_FOOD_POINTS = 10
export const BONUS_MULTIPLIER = 3

export const THEMES: SnakeTheme[] = [
  {
    name: 'classic-green',
    label: 'Klasik Green',
    snakeColor: '#22c55e',
    snakeHeadColor: '#86efac',
    foodColor: '#ef4444',
    bonusFoodColor: '#f97316',
    boardColor: '#0a0f0d',
    accentColor: '#22c55e',
    gridColor: 'rgba(134,239,172,0.10)',
  },
  {
    name: 'neon',
    label: 'Neon Cyber',
    snakeColor: '#22d3ee',
    snakeHeadColor: '#a78bfa',
    foodColor: '#f472b6',
    bonusFoodColor: '#fb7185',
    boardColor: '#050816',
    accentColor: '#22d3ee',
    gridColor: 'rgba(34,211,238,0.16)',
  },
  {
    name: 'ocean',
    label: 'Violet Void',
    snakeColor: '#a78bfa',
    snakeHeadColor: '#c4b5fd',
    foodColor: '#22d3ee',
    bonusFoodColor: '#67e8f9',
    boardColor: '#130a24',
    accentColor: '#a78bfa',
    gridColor: 'rgba(196,181,253,0.13)',
  },
  {
    name: 'candy',
    label: 'Sunset Arcade',
    snakeColor: '#f59e0b',
    snakeHeadColor: '#fcd34d',
    foodColor: '#f43f5e',
    bonusFoodColor: '#fb7185',
    boardColor: '#2a1020',
    accentColor: '#f59e0b',
    gridColor: 'rgba(252,211,77,0.14)',
  },
  {
    name: 'monochrome',
    label: 'Mono CRT',
    snakeColor: '#f4f4f5',
    snakeHeadColor: '#ffffff',
    foodColor: '#a1a1aa',
    bonusFoodColor: '#d4d4d8',
    boardColor: '#050505',
    accentColor: '#d4d4d8',
    gridColor: 'rgba(255,255,255,0.10)',
  },
]

export const DIFFICULTY_CONFIGS: DifficultyConfig[] = [
  {
    key: 'easy',
    label: 'Easy',
    initialSpeedMs: 170,
    speedIncreasePerLevelMs: 4,
    minSpeedMs: 80,
    scoreMultiplier: 1,
    baseObstacleCount: 0,
  },
  {
    key: 'normal',
    label: 'Normal',
    initialSpeedMs: 140,
    speedIncreasePerLevelMs: 5,
    minSpeedMs: 70,
    scoreMultiplier: 1.25,
    baseObstacleCount: 0,
  },
  {
    key: 'hard',
    label: 'Hard',
    initialSpeedMs: 115,
    speedIncreasePerLevelMs: 6,
    minSpeedMs: 62,
    scoreMultiplier: 1.5,
    baseObstacleCount: 2,
  },
  {
    key: 'expert',
    label: 'Expert',
    initialSpeedMs: 95,
    speedIncreasePerLevelMs: 7,
    minSpeedMs: 52,
    scoreMultiplier: 2,
    baseObstacleCount: 4,
  },
]

export const GAME_MODES: Array<{ key: GameMode; label: string }> = [
  { key: 'classic', label: 'Classic' },
  { key: 'arcade-chaos', label: 'Arcade Chaos' },
  { key: 'zen', label: 'Zen Mode' },
  { key: 'enemy-hunt', label: 'Enemy Hunt' },
]

export const VISUAL_SKINS: Array<{ key: VisualSkin; label: string }> = [
  { key: 'classic-arcade', label: 'Classic Arcade' },
  { key: 'hyper-hd', label: 'Hyper HD režim' },
]
