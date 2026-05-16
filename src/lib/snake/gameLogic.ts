import { DIFFICULTY_CONFIGS, SNAKE_GRID_SIZE } from './constants'
import { calculateLevel } from './scoring'
import type {
  Difficulty,
  DifficultyConfig,
  Direction,
  Point,
  SnakeFood,
  SnakeGameState,
} from './types'

function pointKey(point: Point) {
  return `${point.x},${point.y}`
}

function randomFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function getDifficultyConfig(difficulty: Difficulty): DifficultyConfig {
  return DIFFICULTY_CONFIGS.find((entry) => entry.key === difficulty) ?? DIFFICULTY_CONFIGS[1]
}

export function createInitialGameState(nowMs: number): SnakeGameState {
  const snake: Point[] = [
    { x: 12, y: 12 },
    { x: 11, y: 12 },
    { x: 10, y: 12 },
  ]

  return {
    snake,
    direction: 'right',
    queuedDirection: 'right',
    food: {
      position: spawnFood(snake, []),
      kind: 'normal',
      expiresAtMs: null,
    },
    obstacles: [],
    score: 0,
    level: 1,
    foodEaten: 0,
    startedAtMs: nowMs,
    endedAtMs: null,
  }
}

export function getNextHeadPosition(head: Point, direction: Direction): Point {
  if (direction === 'up') return { x: head.x, y: head.y - 1 }
  if (direction === 'down') return { x: head.x, y: head.y + 1 }
  if (direction === 'left') return { x: head.x - 1, y: head.y }
  return { x: head.x + 1, y: head.y }
}

export function isDirectionChangeAllowed(current: Direction, next: Direction) {
  if (current === next) return true
  if (current === 'up' && next === 'down') return false
  if (current === 'down' && next === 'up') return false
  if (current === 'left' && next === 'right') return false
  if (current === 'right' && next === 'left') return false
  return true
}

export function moveSnake(snake: Point[], nextHead: Point, grow: boolean) {
  const nextSnake = [nextHead, ...snake]
  if (!grow) nextSnake.pop()
  return nextSnake
}

export function detectWallCollision(head: Point) {
  return (
    head.x < 0 ||
    head.y < 0 ||
    head.x >= SNAKE_GRID_SIZE ||
    head.y >= SNAKE_GRID_SIZE
  )
}

export function detectSelfCollision(snake: Point[], head: Point) {
  return snake.some((part) => part.x === head.x && part.y === head.y)
}

export function detectObstacleCollision(obstacles: Point[], head: Point) {
  return obstacles.some((obstacle) => obstacle.x === head.x && obstacle.y === head.y)
}

export function spawnFood(snake: Point[], obstacles: Point[]) {
  const blocked = new Set([...snake, ...obstacles].map(pointKey))
  const free: Point[] = []

  for (let x = 0; x < SNAKE_GRID_SIZE; x += 1) {
    for (let y = 0; y < SNAKE_GRID_SIZE; y += 1) {
      const point = { x, y }
      if (!blocked.has(pointKey(point))) free.push(point)
    }
  }

  if (free.length === 0) return { x: 0, y: 0 }
  return randomFrom(free)
}

export function spawnBonusFood(
  nowMs: number,
  snake: Point[],
  obstacles: Point[]
): SnakeFood {
  return {
    position: spawnFood(snake, obstacles),
    kind: 'bonus',
    expiresAtMs: nowMs + 6000,
  }
}

export function getObstaclesForLevel(level: number, difficulty: Difficulty): Point[] {
  const config = getDifficultyConfig(difficulty)
  const obstacleCount = Math.max(
    0,
    level >= 3 ? config.baseObstacleCount + Math.floor((level - 3) / 2) : 0
  )

  if (obstacleCount === 0) return []

  const obstacles: Point[] = []
  const taken = new Set<string>()
  const protectedZone = new Set<string>([
    '12,12',
    '11,12',
    '10,12',
    '13,12',
    '12,11',
    '12,13',
  ])

  while (obstacles.length < obstacleCount) {
    const point = {
      x: Math.floor(Math.random() * SNAKE_GRID_SIZE),
      y: Math.floor(Math.random() * SNAKE_GRID_SIZE),
    }
    const key = pointKey(point)
    if (taken.has(key) || protectedZone.has(key)) continue
    obstacles.push(point)
    taken.add(key)
  }

  return obstacles
}

export function shouldSpawnBonusFood(level: number) {
  if (level < 4) return false
  return Math.random() < 0.18
}

export function getSpeedForLevel(level: number, difficulty: Difficulty) {
  const config = getDifficultyConfig(difficulty)
  const current = config.initialSpeedMs - (level - 1) * config.speedIncreasePerLevelMs
  return Math.max(config.minSpeedMs, current)
}

export function recalculateLevelFromFood(foodEaten: number) {
  return calculateLevel(foodEaten)
}
