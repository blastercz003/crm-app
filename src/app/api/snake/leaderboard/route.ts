import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Difficulty } from '@/lib/snake/types'
import { normalizeGameMode, parseDifficultyFilter, parsePeriodFilter } from '@/lib/snake/validation'

type SnakeScoreRow = {
  id: string
  user_id: string | null
  display_name: string
  score: number
  level: number
  difficulty: string
  game_mode?: string | null
  metadata?: { gameMode?: string } | null
  created_at: string
}

function getPeriodStartIso(period: 'today' | 'week' | 'all') {
  if (period === 'all') return null

  const now = new Date()
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return start.toISOString()
  }

  const day = now.getDay()
  const diffToMonday = day === 0 ? 6 : day - 1
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday)
  return start.toISOString()
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const difficulty = parseDifficultyFilter(searchParams.get('difficulty'))
  const period = parsePeriodFilter(searchParams.get('period'))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const periodStart = getPeriodStartIso(period)

  const runQuery = async () => {
    let query = supabase.from('snake_scores').select('*')

    if (difficulty !== 'all') {
      query = query.eq('difficulty', difficulty)
    }
    if (periodStart) {
      query = query.gte('created_at', periodStart)
    }

    return query.order('score', { ascending: false }).order('created_at', { ascending: true }).limit(100)
  }

  let { data, error } = await runQuery()
  if (error && (error.message.includes('game_mode') || error.message.includes('column'))) {
    const fallback = await runQuery()
    data = fallback.data
    error = fallback.error
  }

  if (error) {
    return NextResponse.json({ error: `Načtení leaderboardu selhalo: ${error.message}` }, { status: 500 })
  }

  const rows = (data ?? []) as SnakeScoreRow[]

  const entries = rows.slice(0, 20).map((entry, index) => ({
    rank: index + 1,
    displayName: entry.display_name,
    score: entry.score,
    level: entry.level,
    difficulty: entry.difficulty as Difficulty,
    gameMode:
      normalizeGameMode((entry as { game_mode?: string | null }).game_mode) ??
      normalizeGameMode((entry as { metadata?: { gameMode?: string } | null }).metadata?.gameMode),
    createdAt: entry.created_at,
    isCurrentPlayer: Boolean(user?.id && entry.user_id === user.id),
  }))

  const currentBest = user?.id
    ? rows.find((row) => row.user_id === user.id)
    : null

  const currentPlayerBest = currentBest
    ? {
        rank: rows.findIndex((row) => row.id === currentBest.id) + 1,
        score: currentBest.score,
      }
    : null

  return NextResponse.json({ entries, currentPlayerBest })
}
