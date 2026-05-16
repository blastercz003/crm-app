export type Direction = 'up' | 'down' | 'left' | 'right'

export type Difficulty = 'easy' | 'normal' | 'hard' | 'expert'

export type GameMode = 'classic' | 'arcade-chaos' | 'zen' | 'enemy-hunt'
export type VisualSkin = 'classic-arcade' | 'hyper-hd'

export type DifficultyFilter = Difficulty | 'all'

export type PeriodFilter = 'today' | 'week' | 'all'

export type ThemeName =
  | 'classic-green'
  | 'neon'
  | 'ocean'
  | 'candy'
  | 'monochrome'

export type Point = {
  x: number
  y: number
}

export type SnakeTheme = {
  name: ThemeName
  label: string
  snakeColor: string
  snakeHeadColor: string
  foodColor: string
  bonusFoodColor: string
  boardColor: string
  accentColor: string
  gridColor: string
}

export type DifficultyConfig = {
  key: Difficulty
  label: string
  initialSpeedMs: number
  speedIncreasePerLevelMs: number
  minSpeedMs: number
  scoreMultiplier: number
  baseObstacleCount: number
}

export type SnakeFood = {
  position: Point
  kind: 'normal' | 'bonus'
  expiresAtMs: number | null
}

export type SnakeGameState = {
  snake: Point[]
  direction: Direction
  queuedDirection: Direction
  food: SnakeFood
  obstacles: Point[]
  score: number
  level: number
  foodEaten: number
  startedAtMs: number | null
  endedAtMs: number | null
}

export type LeaderboardEntry = {
  rank: number
  displayName: string
  score: number
  level: number
  difficulty: Difficulty
  gameMode: GameMode | null
  createdAt: string
  isCurrentPlayer: boolean
}

export type LeaderboardResponse = {
  entries: LeaderboardEntry[]
  currentPlayerBest: {
    rank: number
    score: number
  } | null
}
