'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TouchEvent as ReactTouchEvent } from 'react'
import {
  createInitialGameState,
  detectObstacleCollision,
  detectSelfCollision,
  detectWallCollision,
  getNextHeadPosition,
  getObstaclesForLevel,
  getSpeedForLevel,
  isDirectionChangeAllowed,
  moveSnake,
  recalculateLevelFromFood,
  spawnBonusFood,
  spawnFood,
} from '@/lib/snake/gameLogic'
import { DIFFICULTY_CONFIGS, GAME_MODES, SNAKE_GRID_SIZE } from '@/lib/snake/constants'
import { calculateScore } from '@/lib/snake/scoring'
import { createSnakeSoundEngine } from '@/lib/snake/sound'
import {
  getOrCreateGuestPlayerId,
  loadGuestDisplayName,
  loadLocalBest,
  loadSnakeSettings,
  saveGuestDisplayName,
  saveLocalBest,
  saveSnakeSettings,
  type SnakeSettings as SnakeSettingsState,
} from '@/lib/snake/storage'
import { getThemeByName, toSafeHexColor } from '@/lib/snake/themes'
import type {
  DifficultyFilter,
  Direction,
  LeaderboardResponse,
  PeriodFilter,
} from '@/lib/snake/types'
import styles from './snake.module.css'
import { SnakeCanvas } from './SnakeCanvas'
import { SnakeGameOverDialog } from './SnakeGameOverDialog'
import { SnakeLeaderboard } from './SnakeLeaderboard'
import { SnakeLogoArcade } from './SnakeLogoArcade'
import { SnakeMobileControls } from './SnakeMobileControls'
import { SnakeSettings } from './SnakeSettings'
import { SnakeStartScreen } from './SnakeStartScreen'

type SnakeGameProps = {
  isAuthenticated: boolean
  defaultDisplayName: string
}

type RunStatus = 'ready' | 'countdown' | 'running' | 'paused' | 'game-over'

type EnemyState = {
  active: boolean
  position: { x: number; y: number } | null
  foodsRemaining: number
  lastMoveAtMs: number
}

type FxParticle = {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  ttl: number
  size: number
  color: string
}

type TrailPoint = {
  x: number
  y: number
  life: number
}

const DEFAULT_SETTINGS: SnakeSettingsState = {
  difficulty: 'normal',
  gameMode: 'classic',
  visualSkin: 'classic-arcade',
  themeName: 'classic-green',
  soundEnabled: true,
  customSnakeColor: null,
  customFoodColor: null,
  customBoardColor: null,
  customAccentColor: null,
}

export function SnakeGame({ isAuthenticated, defaultDisplayName }: SnakeGameProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef(createInitialGameState(Date.now()))
  const loopRef = useRef<number | null>(null)
  const lastTickRef = useRef(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const timePhaseRef = useRef(0)
  const particlesRef = useRef<FxParticle[]>([])
  const trailRef = useRef<TrailPoint[]>([])
  const lastHeadRef = useRef<{ x: number; y: number } | null>(null)
  const enemyRef = useRef<EnemyState>({
    active: false,
    position: null,
    foodsRemaining: 0,
    lastMoveAtMs: 0,
  })
  const soundRef = useRef(createSnakeSoundEngine())
  const lastTurnSoundAtRef = useRef(0)

  const [runStatus, setRunStatus] = useState<RunStatus>('ready')
  const [countdown, setCountdown] = useState(3)
  const [settings, setSettings] = useState<SnakeSettingsState>(DEFAULT_SETTINGS)
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [foodEaten, setFoodEaten] = useState(0)
  const [localBest, setLocalBest] = useState(0)
  const [onlineRank, setOnlineRank] = useState<number | null>(null)
  const [submitState, setSubmitState] = useState('')
  const [isNewLocalBest, setIsNewLocalBest] = useState(false)
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse>({
    entries: [],
    currentPlayerBest: null,
  })
  const [leaderboardDifficulty, setLeaderboardDifficulty] = useState<DifficultyFilter>('all')
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<PeriodFilter>('week')
  const [leaderboardLoading, setLeaderboardLoading] = useState(false)
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null)
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [specialNotice, setSpecialNotice] = useState<string | null>(null)
  const [enemyFoodsLeft, setEnemyFoodsLeft] = useState(0)
  const [gameOverReason, setGameOverReason] = useState<string | null>(null)
  const [scoreBumpTick, setScoreBumpTick] = useState(0)
  const [levelFlashActive, setLevelFlashActive] = useState(false)
  const isHyperHd = settings.visualSkin === 'hyper-hd'
  const previousScoreRef = useRef(0)

  const theme = useMemo(() => {
    const base = getThemeByName(settings.themeName)
    return {
      ...base,
      snakeColor: settings.customSnakeColor
        ? toSafeHexColor(settings.customSnakeColor, base.snakeColor)
        : base.snakeColor,
      foodColor: settings.customFoodColor
        ? toSafeHexColor(settings.customFoodColor, base.foodColor)
        : base.foodColor,
      boardColor: settings.customBoardColor
        ? toSafeHexColor(settings.customBoardColor, base.boardColor)
        : base.boardColor,
      accentColor: settings.customAccentColor
        ? toSafeHexColor(settings.customAccentColor, base.accentColor)
        : base.accentColor,
    }
  }, [settings])

  const fetchLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true)
    setLeaderboardError(null)

    try {
      const params = new URLSearchParams({
        difficulty: leaderboardDifficulty,
        period: leaderboardPeriod,
      })
      const response = await fetch(`/api/snake/leaderboard?${params.toString()}`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('Nepodařilo se načíst leaderboard.')
      const data = (await response.json()) as LeaderboardResponse
      setLeaderboard(data)
      setOnlineRank(data.currentPlayerBest?.rank ?? null)
    } catch {
      setLeaderboardError('Leaderboard je dočasně nedostupný. Hra běží dál lokálně.')
    } finally {
      setLeaderboardLoading(false)
    }
  }, [leaderboardDifficulty, leaderboardPeriod])

  useEffect(() => {
    const savedSettings = loadSnakeSettings()
    if (savedSettings) setSettings(savedSettings)
    setLocalBest(loadLocalBest())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const touch =
      window.matchMedia('(pointer: coarse)').matches ||
      window.matchMedia('(hover: none)').matches ||
      navigator.maxTouchPoints > 0
    setIsTouchDevice(touch)
  }, [])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  useEffect(() => {
    saveSnakeSettings(settings)
  }, [settings])

  useEffect(() => {
    soundRef.current.setEnabled(settings.soundEnabled)
  }, [settings.soundEnabled])

  useEffect(() => {
    if (score <= previousScoreRef.current) {
      previousScoreRef.current = score
      return
    }
    previousScoreRef.current = score
    setScoreBumpTick((value) => value + 1)
  }, [score])

  const unlockAudio = useCallback(() => {
    soundRef.current.unlock()
  }, [])

  const playSound = useCallback(
    (event: Parameters<(typeof soundRef.current)['play']>[0]) => {
      soundRef.current.play(event)
    },
    []
  )

  const showSpecialNotice = useCallback((message: string) => {
    setSpecialNotice(message)
    window.setTimeout(() => {
      setSpecialNotice((current) => (current === message ? null : current))
    }, 1200)
  }, [])

  const applyModeToNextHead = useCallback(
    (nextHead: { x: number; y: number }) => {
      if (settings.gameMode !== 'zen') return nextHead
      return {
        x: (nextHead.x + SNAKE_GRID_SIZE) % SNAKE_GRID_SIZE,
        y: (nextHead.y + SNAKE_GRID_SIZE) % SNAKE_GRID_SIZE,
      }
    },
    [settings.gameMode]
  )

  const getBonusSpawnChance = useCallback(() => {
    if (settings.gameMode === 'arcade-chaos') return 0.38
    if (settings.gameMode === 'zen') return 0.12
    return 0.18
  }, [settings.gameMode])

  const spawnEnemyStartPoint = useCallback((head: { x: number; y: number }) => {
    const corners = [
      { x: 1, y: 1 },
      { x: SNAKE_GRID_SIZE - 2, y: 1 },
      { x: 1, y: SNAKE_GRID_SIZE - 2 },
      { x: SNAKE_GRID_SIZE - 2, y: SNAKE_GRID_SIZE - 2 },
    ]
    return corners.sort((a, b) => {
      const da = Math.abs(a.x - head.x) + Math.abs(a.y - head.y)
      const db = Math.abs(b.x - head.x) + Math.abs(b.y - head.y)
      return db - da
    })[0]
  }, [])

  const emitParticles = useCallback(
    (x: number, y: number, count: number, color: string) => {
      if (settings.visualSkin !== 'hyper-hd') return
      const next: FxParticle[] = []
      for (let i = 0; i < count; i += 1) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5
        const speed = 0.04 + Math.random() * 0.12
        next.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0,
          ttl: 16 + Math.floor(Math.random() * 12),
          size: 2 + Math.random() * 2.5,
          color,
        })
      }
      particlesRef.current = [...particlesRef.current, ...next].slice(-80)
    },
    [settings.visualSkin]
  )

  const resetState = useCallback(() => {
    const now = Date.now()
    const next = createInitialGameState(now)
    next.obstacles = getObstaclesForLevel(next.level, settings.difficulty)
    next.food = {
      position: spawnFood(next.snake, next.obstacles),
      kind: 'normal',
      expiresAtMs: null,
    }
    stateRef.current = next
    enemyRef.current = {
      active: false,
      position: null,
      foodsRemaining: 0,
      lastMoveAtMs: 0,
    }
    setScore(0)
    setLevel(1)
    setFoodEaten(0)
    setSubmitState('')
    setIsNewLocalBest(false)
    setEnemyFoodsLeft(0)
    setGameOverReason(null)
    setSpecialNotice(null)
  }, [settings.difficulty])

  const beginCountdown = useCallback(() => {
    if (runStatus === 'running' || runStatus === 'countdown') return
    unlockAudio()
    resetState()
    setRunStatus('countdown')
    setCountdown(3)
  }, [resetState, runStatus, unlockAudio])

  useEffect(() => {
    if (runStatus !== 'countdown') return

    const id = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          window.clearInterval(id)
          playSound('countdownGo')
          setRunStatus('running')
          return 0
        }
        playSound('countdownTick')
        return prev - 1
      })
    }, 1000)

    return () => window.clearInterval(id)
  }, [playSound, runStatus])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const viewWidth = Math.floor(canvas.clientWidth || 0)
    const viewHeight = Math.floor(canvas.clientHeight || 0)
    if (viewWidth <= 0 || viewHeight <= 0) return
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.floor(viewWidth * dpr)
    const pixelHeight = Math.floor(viewHeight * dpr)

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.scale(dpr, dpr)

    const state = stateRef.current
    const cellWidth = viewWidth / SNAKE_GRID_SIZE
    const cellHeight = viewHeight / SNAKE_GRID_SIZE
    timePhaseRef.current += 0.016
    const phase = timePhaseRef.current
    const isHyperHd = settings.visualSkin === 'hyper-hd'

    if (!isHyperHd) {
      context.fillStyle = theme.boardColor
      context.fillRect(0, 0, viewWidth, viewHeight)

      context.strokeStyle = 'rgba(255,255,255,0.06)'
      context.lineWidth = 1
      for (let i = 0; i <= SNAKE_GRID_SIZE; i += 1) {
        const x = i * cellWidth
        const y = i * cellHeight
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, viewHeight)
        context.stroke()
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(viewWidth, y)
        context.stroke()
      }

      for (const obstacle of state.obstacles) {
        context.fillStyle = 'rgba(241,245,249,0.24)'
        context.fillRect(
          obstacle.x * cellWidth + 2,
          obstacle.y * cellHeight + 2,
          Math.max(2, cellWidth - 4),
          Math.max(2, cellHeight - 4)
        )
      }

      state.snake.forEach((part, index) => {
        context.fillStyle = index === 0 ? theme.snakeHeadColor : theme.snakeColor
        context.fillRect(
          part.x * cellWidth + 2,
          part.y * cellHeight + 2,
          Math.max(2, cellWidth - 4),
          Math.max(2, cellHeight - 4)
        )
      })

      const food = state.food
      context.fillStyle = food.kind === 'bonus' ? theme.bonusFoodColor : theme.foodColor
      context.beginPath()
      context.arc(
        food.position.x * cellWidth + cellWidth / 2,
        food.position.y * cellHeight + cellHeight / 2,
        Math.min(cellWidth, cellHeight) / 2.7,
        0,
        Math.PI * 2
      )
      context.fill()
    } else {
      const animatedGlow = 0.12 + Math.sin(phase * 0.8) * 0.04
      const bg = context.createLinearGradient(0, 0, viewWidth, viewHeight)
      bg.addColorStop(0, '#050917')
      bg.addColorStop(0.5, '#091632')
      bg.addColorStop(1, '#090d1f')
      context.fillStyle = bg
      context.fillRect(0, 0, viewWidth, viewHeight)

      const light = context.createRadialGradient(
        viewWidth * (0.25 + Math.sin(phase * 0.2) * 0.08),
        viewHeight * (0.22 + Math.cos(phase * 0.16) * 0.08),
        20,
        viewWidth * 0.35,
        viewHeight * 0.35,
        viewWidth * 0.82
      )
      light.addColorStop(0, 'rgba(35,216,255,0.18)')
      light.addColorStop(0.55, 'rgba(144,86,255,0.09)')
      light.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = light
      context.fillRect(0, 0, viewWidth, viewHeight)

      context.strokeStyle = `rgba(85, 184, 255, ${0.08 + animatedGlow * 0.35})`
      context.lineWidth = 1
      for (let i = 0; i <= SNAKE_GRID_SIZE; i += 1) {
        const x = i * cellWidth
        const y = i * cellHeight
        context.beginPath()
        context.moveTo(x, 0)
        context.lineTo(x, viewHeight)
        context.stroke()
        context.beginPath()
        context.moveTo(0, y)
        context.lineTo(viewWidth, y)
        context.stroke()
      }

      const vignette = context.createRadialGradient(
        viewWidth * 0.5,
        viewHeight * 0.5,
        viewWidth * 0.18,
        viewWidth * 0.5,
        viewHeight * 0.5,
        viewWidth * 0.82
      )
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, 'rgba(0,0,0,0.42)')
      context.fillStyle = vignette
      context.fillRect(0, 0, viewWidth, viewHeight)

      for (const obstacle of state.obstacles) {
        const x = obstacle.x * cellWidth + 2
        const y = obstacle.y * cellHeight + 2
        const w = Math.max(2, cellWidth - 4)
        const h = Math.max(2, cellHeight - 4)
        const gradient = context.createLinearGradient(x, y, x + w, y + h)
        gradient.addColorStop(0, 'rgba(148,163,184,0.85)')
        gradient.addColorStop(1, 'rgba(71,85,105,0.85)')
        context.fillStyle = gradient
        context.fillRect(x, y, w, h)
        context.strokeStyle = 'rgba(148, 197, 255, 0.52)'
        context.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1))
      }

      const head = state.snake[0]
      const lastHead = lastHeadRef.current
      if (lastHead && (lastHead.x !== head.x || lastHead.y !== head.y)) {
        trailRef.current.push({ x: lastHead.x, y: lastHead.y, life: 1 })
      }
      lastHeadRef.current = { x: head.x, y: head.y }
      trailRef.current = trailRef.current
        .map((item) => ({ ...item, life: item.life - 0.12 }))
        .filter((item) => item.life > 0)
        .slice(-10)

      for (const item of trailRef.current) {
        const alpha = Math.max(0, item.life) * 0.22
        context.fillStyle = `rgba(106, 240, 155, ${alpha})`
        context.fillRect(
          item.x * cellWidth + 3,
          item.y * cellHeight + 3,
          Math.max(2, cellWidth - 6),
          Math.max(2, cellHeight - 6)
        )
      }

      const pulse = 0.9 + Math.sin(phase * 3.2) * 0.06
      state.snake.forEach((part, index) => {
        const x = part.x * cellWidth + 2
        const y = part.y * cellHeight + 2
        const w = Math.max(2, cellWidth - 4)
        const h = Math.max(2, cellHeight - 4)
        const radius = Math.max(2, Math.min(w, h) * 0.22)
        const body = context.createLinearGradient(x, y, x + w, y + h)
        if (index === 0) {
          body.addColorStop(0, '#d9fff0')
          body.addColorStop(1, '#39d98a')
          context.shadowBlur = 18 * pulse
          context.shadowColor = 'rgba(91, 255, 184, 0.48)'
        } else {
          body.addColorStop(0, '#52eab3')
          body.addColorStop(1, '#1db06f')
          context.shadowBlur = 10 * pulse
          context.shadowColor = 'rgba(91, 255, 184, 0.25)'
        }
        context.fillStyle = body
        context.beginPath()
        context.roundRect(x, y, w, h, radius)
        context.fill()
        context.shadowBlur = 0
      })

      const food = state.food
      const fx = food.position.x * cellWidth + cellWidth / 2
      const fy = food.position.y * cellHeight + cellHeight / 2
      const baseRadius = Math.min(cellWidth, cellHeight) / 3
      const breath = 1 + Math.sin(phase * 4.6) * 0.08
      const orbRadius = baseRadius * breath

      context.beginPath()
      context.fillStyle =
        food.kind === 'bonus' ? 'rgba(255,211,110,0.24)' : 'rgba(255,103,145,0.2)'
      context.arc(fx, fy, orbRadius * (food.kind === 'bonus' ? 2.6 : 2.1), 0, Math.PI * 2)
      context.fill()

      const orb = context.createRadialGradient(fx - orbRadius * 0.3, fy - orbRadius * 0.35, 1, fx, fy, orbRadius)
      if (food.kind === 'bonus') {
        orb.addColorStop(0, '#fff7cf')
        orb.addColorStop(0.45, '#ffd166')
        orb.addColorStop(1, '#f59e0b')
      } else {
        orb.addColorStop(0, '#ffe6ef')
        orb.addColorStop(0.4, '#ff7a8f')
        orb.addColorStop(1, '#e11d48')
      }
      context.fillStyle = orb
      context.beginPath()
      context.arc(fx, fy, orbRadius, 0, Math.PI * 2)
      context.fill()

      if (food.kind === 'bonus' && food.expiresAtMs) {
        const remaining = Math.max(0, food.expiresAtMs - Date.now())
        const ratio = Math.min(1, remaining / 6000)
        context.strokeStyle = `rgba(255, 225, 145, ${0.35 + (1 - ratio) * 0.4})`
        context.lineWidth = 2
        context.beginPath()
        context.arc(fx, fy, orbRadius * 1.65, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio)
        context.stroke()
      }

      particlesRef.current = particlesRef.current
        .map((particle) => ({
          ...particle,
          x: particle.x + particle.vx,
          y: particle.y + particle.vy,
          life: particle.life + 1,
        }))
        .filter((particle) => particle.life < particle.ttl)

      for (const particle of particlesRef.current) {
        const alpha = 1 - particle.life / particle.ttl
        context.fillStyle = particle.color.replace('ALPHA', alpha.toFixed(3))
        context.beginPath()
        context.arc(
          particle.x * cellWidth + cellWidth / 2,
          particle.y * cellHeight + cellHeight / 2,
          particle.size * alpha,
          0,
          Math.PI * 2
        )
        context.fill()
      }

      context.strokeStyle = 'rgba(116, 220, 255, 0.36)'
      context.lineWidth = 2
      context.strokeRect(1, 1, viewWidth - 2, viewHeight - 2)
    }

    const enemy = enemyRef.current
    if (enemy.active && enemy.position) {
      const ex = enemy.position.x * cellWidth + cellWidth / 2
      const ey = enemy.position.y * cellHeight + cellHeight / 2
      const radius = Math.min(cellWidth, cellHeight) / 2.5

      context.beginPath()
      context.fillStyle =
        settings.visualSkin === 'hyper-hd' ? 'rgba(248, 113, 113, 0.22)' : 'rgba(248, 113, 113, 0.16)'
      context.arc(ex, ey, radius * 1.8, 0, Math.PI * 2)
      context.fill()

      context.beginPath()
      context.fillStyle = '#f87171'
      context.arc(ex, ey, radius, 0, Math.PI * 2)
      context.fill()

      context.beginPath()
      context.fillStyle = '#fee2e2'
      context.arc(ex - radius * 0.2, ey - radius * 0.2, radius * 0.25, 0, Math.PI * 2)
      context.fill()
    }
  }, [settings.visualSkin, theme])

  const submitScore = useCallback(async () => {
    const endState = stateRef.current
    if (!endState.startedAtMs || endState.score <= 0) return

    const durationMs = Math.max(500, Date.now() - endState.startedAtMs)
    const displayName = isAuthenticated ? defaultDisplayName : loadGuestDisplayName() || 'Guest'
    const anonymousPlayerId = isAuthenticated ? null : getOrCreateGuestPlayerId()

    setSubmitState('Odesílám skóre...')

    try {
      const response = await fetch('/api/snake/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score: endState.score,
          level: endState.level,
          difficulty: settings.difficulty,
          gameMode: settings.gameMode,
          durationMs,
          foodEaten: endState.foodEaten,
          displayName,
          anonymousPlayerId,
          themeName: settings.themeName,
        }),
      })

      if (!response.ok) throw new Error('submit failed')

      setSubmitState('Skóre odesláno.')
      await fetchLeaderboard()
    } catch {
      setSubmitState('Skóre se nepodařilo odeslat, ale lokální výsledek zůstal.')
    }
  }, [defaultDisplayName, fetchLeaderboard, isAuthenticated, settings.difficulty, settings.gameMode, settings.themeName])

  const tick = useCallback(() => {
    const state = stateRef.current
    const activeDirection = isDirectionChangeAllowed(state.direction, state.queuedDirection)
      ? state.queuedDirection
      : state.direction
    state.direction = activeDirection

    const head = state.snake[0]
    const rawNextHead = getNextHeadPosition(head, activeDirection)
    const nextHead = applyModeToNextHead(rawNextHead)
    const wallHit = settings.gameMode === 'zen' ? false : detectWallCollision(nextHead)

    if (
      wallHit ||
      detectSelfCollision(state.snake, nextHead) ||
      detectObstacleCollision(state.obstacles, nextHead)
    ) {
      playSound('gameOver')
      state.endedAtMs = Date.now()
      setGameOverReason(wallHit ? 'Náraz do stěny' : 'Kolize')
      setRunStatus('game-over')
      if (state.score > localBest) {
        saveLocalBest(state.score)
        setLocalBest(state.score)
        setIsNewLocalBest(true)
      }
      submitScore()
      return
    }

    const ateFood =
      nextHead.x === state.food.position.x && nextHead.y === state.food.position.y

    state.snake = moveSnake(state.snake, nextHead, ateFood)

    if (ateFood) {
      playSound(state.food.kind === 'bonus' ? 'bonusFood' : 'food')
      emitParticles(
        state.food.position.x,
        state.food.position.y,
        state.food.kind === 'bonus' ? 18 : 10,
        state.food.kind === 'bonus' ? 'rgba(255, 219, 135, ALPHA)' : 'rgba(255, 142, 184, ALPHA)'
      )
      state.foodEaten += 1
      const previousLevel = state.level
      state.level = recalculateLevelFromFood(state.foodEaten)
      state.score += calculateScore(settings.difficulty, state.level, state.food.kind)

      if (settings.gameMode === 'enemy-hunt' && enemyRef.current.active) {
        enemyRef.current.foodsRemaining = Math.max(0, enemyRef.current.foodsRemaining - 1)
        setEnemyFoodsLeft(enemyRef.current.foodsRemaining)
        if (enemyRef.current.foodsRemaining === 0) {
          enemyRef.current.active = false
          enemyRef.current.position = null
          showSpecialNotice('HUNTER OFFLINE')
        }
      }

      if (state.level > previousLevel && settings.gameMode === 'enemy-hunt') {
        enemyRef.current = {
          active: true,
          position: spawnEnemyStartPoint(nextHead),
          foodsRemaining: 2,
          lastMoveAtMs: 0,
        }
        setEnemyFoodsLeft(2)
        showSpecialNotice('LEVEL UP • HUNTER ONLINE')
      }
      if (state.level > previousLevel) {
        setLevelFlashActive(true)
        window.setTimeout(() => setLevelFlashActive(false), 340)
        if (settings.gameMode !== 'enemy-hunt') {
          showSpecialNotice('LEVEL UP')
        }
        emitParticles(nextHead.x, nextHead.y, 14, 'rgba(129, 228, 255, ALPHA)')
      }

      const canSpawnBonus = state.level >= 4 && Math.random() < getBonusSpawnChance()
      if (canSpawnBonus) {
        state.food = spawnBonusFood(Date.now(), state.snake, state.obstacles)
      } else {
        state.food = { position: spawnFood(state.snake, state.obstacles), kind: 'normal', expiresAtMs: null }
      }

      const nextObstacles =
        settings.gameMode === 'zen' ? [] : getObstaclesForLevel(state.level, settings.difficulty)
      if (nextObstacles.length > state.obstacles.length) {
        playSound('obstacleRise')
      }
      state.obstacles = nextObstacles

      setScore(state.score)
      setLevel(state.level)
      setFoodEaten(state.foodEaten)
    }

    if (state.food.kind === 'bonus' && state.food.expiresAtMs && Date.now() > state.food.expiresAtMs) {
      state.food = { position: spawnFood(state.snake, state.obstacles), kind: 'normal', expiresAtMs: null }
    }

    if (settings.gameMode === 'enemy-hunt' && enemyRef.current.active && enemyRef.current.position) {
      const now = Date.now()
      const speed = getSpeedForLevel(state.level, settings.difficulty)
      const enemyStepInterval = Math.max(140, Math.floor(speed * 1.45))

      if (now - enemyRef.current.lastMoveAtMs >= enemyStepInterval) {
        enemyRef.current.lastMoveAtMs = now
        const enemy = enemyRef.current.position
        const headNow = state.snake[0]
        const dx = headNow.x - enemy.x
        const dy = headNow.y - enemy.y

        const horizontal =
          Math.abs(dx) >= Math.abs(dy) ? { x: enemy.x + Math.sign(dx), y: enemy.y } : null
        const vertical =
          Math.abs(dy) >= Math.abs(dx) ? { x: enemy.x, y: enemy.y + Math.sign(dy) } : null
        const candidates = [horizontal, vertical].filter(
          (point): point is { x: number; y: number } => Boolean(point)
        )
        const validMove = candidates.find(
          (candidate) =>
            candidate.x >= 0 &&
            candidate.y >= 0 &&
            candidate.x < SNAKE_GRID_SIZE &&
            candidate.y < SNAKE_GRID_SIZE &&
            !detectObstacleCollision(state.obstacles, candidate)
        )

        enemyRef.current.position = validMove ?? enemy

        if (
          enemyRef.current.position.x === headNow.x &&
          enemyRef.current.position.y === headNow.y
        ) {
          playSound('gameOver')
          state.endedAtMs = Date.now()
          setGameOverReason('Chytil tě nepřítel')
          setRunStatus('game-over')
          if (state.score > localBest) {
            saveLocalBest(state.score)
            setLocalBest(state.score)
            setIsNewLocalBest(true)
          }
          submitScore()
        }
      }
    }
  }, [
    applyModeToNextHead,
    emitParticles,
    getBonusSpawnChance,
    localBest,
    playSound,
    settings.difficulty,
    settings.gameMode,
    showSpecialNotice,
    spawnEnemyStartPoint,
    submitScore,
  ])

  const loop = useCallback(
    (time: number) => {
      if (runStatus !== 'running') return
      const state = stateRef.current
      const baseSpeed = getSpeedForLevel(state.level, settings.difficulty)
      const speed =
        settings.gameMode === 'arcade-chaos'
          ? Math.max(45, Math.floor(baseSpeed * 0.88))
          : settings.gameMode === 'zen'
            ? Math.floor(baseSpeed * 1.22)
            : baseSpeed

      if (time - lastTickRef.current >= speed) {
        lastTickRef.current = time
        tick()
      }

      draw()
      loopRef.current = window.requestAnimationFrame(loop)
    },
    [draw, runStatus, settings.difficulty, settings.gameMode, tick]
  )

  useEffect(() => {
    draw()
  }, [draw, runStatus])

  useEffect(() => {
    if (runStatus !== 'running') {
      if (loopRef.current) window.cancelAnimationFrame(loopRef.current)
      loopRef.current = null
      return
    }

    loopRef.current = window.requestAnimationFrame(loop)
    return () => {
      if (loopRef.current) window.cancelAnimationFrame(loopRef.current)
      loopRef.current = null
    }
  }, [loop, runStatus])

  const setDirection = useCallback(
    (next: Direction) => {
      const state = stateRef.current
      const current = state.queuedDirection || state.direction
      if (!isDirectionChangeAllowed(current, next)) return
      state.queuedDirection = next
      unlockAudio()
      const now = performance.now()
      if (now - lastTurnSoundAtRef.current > 60) {
        playSound('turn')
        lastTurnSoundAtRef.current = now
      }

      if (runStatus !== 'running' || !isTouchDevice) return

      const baseSpeed = getSpeedForLevel(state.level, settings.difficulty)
      const speed =
        settings.gameMode === 'arcade-chaos'
          ? Math.max(45, Math.floor(baseSpeed * 0.88))
          : settings.gameMode === 'zen'
            ? Math.floor(baseSpeed * 1.22)
            : baseSpeed

      if (now - lastTickRef.current >= speed * 0.35) {
        lastTickRef.current = now
        tick()
        draw()
      }
    },
    [draw, isTouchDevice, playSound, runStatus, settings.difficulty, settings.gameMode, tick, unlockAudio]
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key) && runStatus === 'running') {
        event.preventDefault()
      }
      if (key === 'arrowup' || key === 'w') setDirection('up')
      if (key === 'arrowdown' || key === 's') setDirection('down')
      if (key === 'arrowleft' || key === 'a') setDirection('left')
      if (key === 'arrowright' || key === 'd') setDirection('right')
      if (key === ' ' && (runStatus === 'running' || runStatus === 'paused')) {
        event.preventDefault()
        setRunStatus((prev) => (prev === 'running' ? 'paused' : 'running'))
      }
      if (key === 'enter' && runStatus === 'game-over') {
        beginCountdown()
      }
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [beginCountdown, runStatus, setDirection])

  const onTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY }
  }

  const onTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return
    const touch = event.changedTouches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y
    touchStartRef.current = null

    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) return
    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? 'right' : 'left')
    } else {
      setDirection(dy > 0 ? 'down' : 'up')
    }
  }

  useEffect(() => {
    const target = canvasRef.current
    if (!target) return

    const prevent = (event: TouchEvent) => {
      if (runStatus === 'running') event.preventDefault()
    }

    target.addEventListener('touchmove', prevent, { passive: false })
    return () => target.removeEventListener('touchmove', prevent)
  }, [runStatus])

  return (
    <section className={`${styles.shell} ${isHyperHd ? styles.hyperHdShell : ''}`}>
      <header className={`${styles.logoSlot} flex items-center justify-center lg:hidden`}>
        <SnakeLogoArcade />
      </header>

      <div className={styles.layout}>
        <section className={`${styles.card} ${styles.gameCard} ${isHyperHd ? styles.hyperHdGameCard : ''} p-3 sm:p-4`}>
          <div className={`${styles.canvasWrap} ${isHyperHd ? styles.hyperHdCanvasWrap : ''} ${levelFlashActive ? styles.levelFlash : ''}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <SnakeCanvas ref={canvasRef} />

            {runStatus === 'ready' && !isTouchDevice ? (
              <SnakeStartScreen
                onStart={beginCountdown}
                isHyperHd={isHyperHd}
                modeLabel={GAME_MODES.find((mode) => mode.key === settings.gameMode)?.label ?? settings.gameMode}
                difficultyLabel={
                  DIFFICULTY_CONFIGS.find((difficulty) => difficulty.key === settings.difficulty)?.label ??
                  settings.difficulty
                }
              />
            ) : null}

            {runStatus === 'countdown' ? (
              <div className={styles.overlay}>
                <div className={`${styles.overlayCard} ${isHyperHd ? styles.hyperHdOverlayCard : ''} text-center`}>
                  <p className="text-sm text-slate-200">Start za</p>
                  <p className="text-4xl font-bold">{countdown}</p>
                </div>
              </div>
            ) : null}

            {runStatus === 'paused' ? (
              <div className={styles.overlay}>
                <div className={`${styles.overlayCard} ${isHyperHd ? styles.hyperHdOverlayCard : ''}`}>
                  <h2 className="text-lg font-semibold">Pauza</h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary} ${isHyperHd ? styles.hyperHdPrimaryButton : ''} px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
                      onClick={() => setRunStatus('running')}
                    >
                      POKRAČOVAT
                    </button>
                    <button
                      type="button"
                      className={`${styles.button} px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
                      onClick={beginCountdown}
                    >
                      RESTART
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {runStatus === 'game-over' ? (
              <SnakeGameOverDialog
                score={score}
                level={level}
                foodEaten={foodEaten}
                isNewLocalBest={isNewLocalBest}
                submitState={gameOverReason ? `${gameOverReason}. ${submitState || 'Připraveno'}` : submitState || 'Připraveno'}
                onPlayAgain={beginCountdown}
                isHyperHd={isHyperHd}
              />
            ) : null}

            {specialNotice ? (
              <div className={`${styles.specialNotice} ${isHyperHd ? styles.hyperHdSpecialNotice : ''}`} aria-live="polite">
                {specialNotice}
              </div>
            ) : null}
          </div>

          <div className={`${styles.desktopNoShrink} mt-3 lg:hidden`}>
            <SnakeMobileControls onDirection={setDirection} />
          </div>

          <div className={`${styles.desktopNoShrink} mt-3 grid grid-cols-2 gap-2`}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary} ${isHyperHd ? styles.hyperHdPrimaryButton : ''} w-full px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] sm:px-4 sm:text-sm sm:tracking-[0.06em] focus:outline-2 focus:outline-offset-2 focus:outline-blue-500`}
              onClick={beginCountdown}
              disabled={runStatus === 'running' || runStatus === 'countdown'}
            >
              SPUSTIT / RESTART
            </button>
            <button
              type="button"
              className={`${styles.button} w-full px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] sm:px-4 sm:text-sm sm:tracking-[0.06em] focus:outline-2 focus:outline-offset-2 focus:outline-blue-500`}
              onClick={() => setRunStatus((prev) => (prev === 'running' ? 'paused' : 'running'))}
              disabled={runStatus !== 'running' && runStatus !== 'paused'}
            >
              PAUZA / POKRAČOVAT
            </button>
          </div>
        </section>

        <aside className={`${styles.rightColumn} flex min-h-0 flex-col gap-3`}>
          <header className={`${styles.logoSlot} hidden items-center justify-center lg:flex`}>
            <SnakeLogoArcade />
          </header>

          <SnakeSettings
            difficulty={settings.difficulty}
            gameMode={settings.gameMode}
            visualSkin={settings.visualSkin}
            themeName={settings.themeName}
            soundEnabled={settings.soundEnabled}
            disabled={runStatus === 'running' || runStatus === 'countdown'}
            onDifficultyChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                difficulty: value,
              }))
            }
            onGameModeChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                gameMode: value,
              }))
            }
            onVisualSkinChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                visualSkin: value,
              }))
            }
            onThemeChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                themeName: value,
              }))
            }
            onSoundEnabledChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                soundEnabled: value,
              }))
            }
          />

          <div className={`${styles.card} ${styles.panelCard} ${isHyperHd ? styles.hyperHdHudPanel : ''} p-3`}>
            <div className={styles.hudGrid}>
              <HudItem label="Score" value={String(score)} pulseKey={scoreBumpTick} isHyperHd={isHyperHd} />
              <HudItem label="Level" value={String(level)} />
              <HudItem label="Local best" value={String(localBest)} />
              <HudItem label="Rank" value={onlineRank ? `#${onlineRank}` : '-'} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {settings.gameMode === 'enemy-hunt' ? (
                <span className={styles.modeBadge}>
                  ENEMY: {enemyFoodsLeft > 0 ? `ACTIVE (${enemyFoodsLeft}/2)` : 'OFFLINE'}
                </span>
              ) : null}
            </div>
          </div>

          <SnakeLeaderboard
            data={leaderboard}
            loading={leaderboardLoading}
            error={leaderboardError}
            difficulty={leaderboardDifficulty}
            period={leaderboardPeriod}
            onDifficultyChange={setLeaderboardDifficulty}
            onPeriodChange={setLeaderboardPeriod}
          />
        </aside>
      </div>

      {!isAuthenticated ? (
        <section className={`${styles.card} mt-4 p-4`}>
          <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-zinc-700">Guest profil</h2>
          <label className="mt-2 block text-sm">
            <span className="mb-1 block text-zinc-600">Display name</span>
            <input
              className={`${styles.input} w-full px-3 py-2`}
              defaultValue={loadGuestDisplayName()}
              onBlur={(event) => saveGuestDisplayName(event.target.value)}
              maxLength={32}
            />
          </label>
        </section>
      ) : null}
    </section>
  )
}

function HudItem({
  label,
  value,
  pulseKey,
  isHyperHd,
}: {
  label: string
  value: string
  pulseKey?: number
  isHyperHd?: boolean
}) {
  const pulseClass = typeof pulseKey === 'number' ? styles.scoreBump : ''
  return (
    <div className={styles.hudCard}>
      <p className={styles.hudLabel}>{label}</p>
      <p
        key={pulseKey}
        className={`${styles.hudValue} ${pulseClass} ${isHyperHd ? styles.hyperHdHudValue : ''}`}
      >
        {value}
      </p>
    </div>
  )
}
