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
  shouldSpawnBonusFood,
  spawnBonusFood,
  spawnFood,
} from '@/lib/snake/gameLogic'
import { SNAKE_GRID_SIZE } from '@/lib/snake/constants'
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

const DEFAULT_SETTINGS: SnakeSettingsState = {
  difficulty: 'normal',
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

  const unlockAudio = useCallback(() => {
    soundRef.current.unlock()
  }, [])

  const playSound = useCallback(
    (event: Parameters<(typeof soundRef.current)['play']>[0]) => {
      soundRef.current.play(event)
    },
    []
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
    setScore(0)
    setLevel(1)
    setFoodEaten(0)
    setSubmitState('')
    setIsNewLocalBest(false)
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

    const cellWidth = viewWidth / SNAKE_GRID_SIZE
    const cellHeight = viewHeight / SNAKE_GRID_SIZE

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

    for (const obstacle of stateRef.current.obstacles) {
      context.fillStyle = 'rgba(241,245,249,0.24)'
      context.fillRect(
        obstacle.x * cellWidth + 2,
        obstacle.y * cellHeight + 2,
        Math.max(2, cellWidth - 4),
        Math.max(2, cellHeight - 4)
      )
    }

    stateRef.current.snake.forEach((part, index) => {
      context.fillStyle = index === 0 ? theme.snakeHeadColor : theme.snakeColor
      context.fillRect(
        part.x * cellWidth + 2,
        part.y * cellHeight + 2,
        Math.max(2, cellWidth - 4),
        Math.max(2, cellHeight - 4)
      )
    })

    const food = stateRef.current.food
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
  }, [theme])

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
  }, [defaultDisplayName, fetchLeaderboard, isAuthenticated, settings.difficulty, settings.themeName])

  const tick = useCallback(() => {
    const state = stateRef.current
    const activeDirection = isDirectionChangeAllowed(state.direction, state.queuedDirection)
      ? state.queuedDirection
      : state.direction
    state.direction = activeDirection

    const head = state.snake[0]
    const nextHead = getNextHeadPosition(head, activeDirection)

    if (
      detectWallCollision(nextHead) ||
      detectSelfCollision(state.snake, nextHead) ||
      detectObstacleCollision(state.obstacles, nextHead)
    ) {
      playSound('gameOver')
      state.endedAtMs = Date.now()
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
      state.foodEaten += 1
      state.level = recalculateLevelFromFood(state.foodEaten)
      state.score += calculateScore(settings.difficulty, state.level, state.food.kind)

      if (shouldSpawnBonusFood(state.level)) {
        state.food = spawnBonusFood(Date.now(), state.snake, state.obstacles)
      } else {
        state.food = { position: spawnFood(state.snake, state.obstacles), kind: 'normal', expiresAtMs: null }
      }

      const nextObstacles = getObstaclesForLevel(state.level, settings.difficulty)
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
  }, [localBest, playSound, settings.difficulty, submitScore])

  const loop = useCallback(
    (time: number) => {
      if (runStatus !== 'running') return
      const state = stateRef.current
      const speed = getSpeedForLevel(state.level, settings.difficulty)

      if (time - lastTickRef.current >= speed) {
        lastTickRef.current = time
        tick()
      }

      draw()
      loopRef.current = window.requestAnimationFrame(loop)
    },
    [draw, runStatus, settings.difficulty, tick]
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

      const speed = getSpeedForLevel(state.level, settings.difficulty)

      if (now - lastTickRef.current >= speed * 0.35) {
        lastTickRef.current = now
        tick()
        draw()
      }
    },
    [draw, isTouchDevice, playSound, runStatus, settings.difficulty, tick, unlockAudio]
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
    <section className={styles.shell}>
      <header className={`${styles.logoSlot} flex items-center justify-center lg:hidden`}>
        <SnakeLogoArcade />
      </header>

      <div className={styles.layout}>
        <section className={`${styles.card} ${styles.gameCard} p-3 sm:p-4`}>
          <div className={styles.canvasWrap} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <SnakeCanvas ref={canvasRef} />

            {runStatus === 'ready' && !isTouchDevice ? (
              <SnakeStartScreen onStart={beginCountdown} />
            ) : null}

            {runStatus === 'countdown' ? (
              <div className={styles.overlay}>
                <div className={`${styles.overlayCard} text-center`}>
                  <p className="text-sm text-slate-200">Start za</p>
                  <p className="text-4xl font-bold">{countdown}</p>
                </div>
              </div>
            ) : null}

            {runStatus === 'paused' ? (
              <div className={styles.overlay}>
                <div className={styles.overlayCard}>
                  <h2 className="text-lg font-semibold">Pauza</h2>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={`${styles.button} ${styles.buttonPrimary} px-4 py-2 text-sm font-semibold uppercase tracking-[0.06em]`}
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
                submitState={submitState || 'Připraveno'}
                onPlayAgain={beginCountdown}
              />
            ) : null}
          </div>

          <div className={`${styles.desktopNoShrink} mt-3 lg:hidden`}>
            <SnakeMobileControls onDirection={setDirection} />
          </div>

          <div className={`${styles.desktopNoShrink} mt-3 grid grid-cols-2 gap-2`}>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonPrimary} w-full px-2 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] sm:px-4 sm:text-sm sm:tracking-[0.06em] focus:outline-2 focus:outline-offset-2 focus:outline-blue-500`}
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
            themeName={settings.themeName}
            soundEnabled={settings.soundEnabled}
            disabled={runStatus === 'running' || runStatus === 'countdown'}
            onDifficultyChange={(value) =>
              setSettings((prev) => ({
                ...prev,
                difficulty: value,
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

          <div className={`${styles.card} ${styles.panelCard} p-3`}>
            <div className={styles.hudGrid}>
              <HudItem label="Score" value={String(score)} />
              <HudItem label="Level" value={String(level)} />
              <HudItem label="Local best" value={String(localBest)} />
              <HudItem label="Online rank" value={onlineRank ? `#${onlineRank}` : '-'} />
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

function HudItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.hudCard}>
      <p className={styles.hudLabel}>{label}</p>
      <p className={styles.hudValue}>{value}</p>
    </div>
  )
}
