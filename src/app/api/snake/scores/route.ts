import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPossibleScore, sanitizeDisplayName, scorePayloadSchema } from '@/lib/snake/validation'

type ScoreInsertResponseRow = {
  id: string
  score: number
  level: number
  difficulty: string
  game_mode?: string | null
  created_at: string
  display_name: string
}

export async function POST(request: Request) {
  let parsedBody: unknown

  try {
    parsedBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Neplatné JSON tělo.' }, { status: 400 })
  }

  const parsed = scorePayloadSchema.safeParse(parsedBody)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Neplatný formát skóre.' }, { status: 400 })
  }

  const body = parsed.data
  const displayName = sanitizeDisplayName(body.displayName)

  if (!displayName) {
    return NextResponse.json({ error: 'Neplatné jméno hráče.' }, { status: 400 })
  }

  if (!isPossibleScore(body)) {
    return NextResponse.json({ error: 'Skóre neodpovídá pravidlům hry.' }, { status: 422 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const userId = user?.id ?? null
  const anonymousPlayerId = userId ? null : body.anonymousPlayerId

  if (!userId && !anonymousPlayerId) {
    return NextResponse.json({ error: 'Chybí identita hráče.' }, { status: 400 })
  }

  const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString()
  let duplicateQuery = supabase
    .from('snake_scores')
    .select('id')
    .eq('score', body.score)
    .eq('difficulty', body.difficulty)
    .gte('created_at', tenSecondsAgo)
    .limit(1)

  duplicateQuery = userId
    ? duplicateQuery.eq('user_id', userId)
    : duplicateQuery.eq('anonymous_player_id', anonymousPlayerId)

  const { data: duplicateRows } = await duplicateQuery

  if (duplicateRows && duplicateRows.length > 0) {
    return NextResponse.json({ error: 'Duplicitní odeslání skóre.' }, { status: 429 })
  }

  const insertPayload = {
    user_id: userId,
    anonymous_player_id: anonymousPlayerId,
    display_name: displayName,
    score: body.score,
    level: body.level,
    difficulty: body.difficulty,
    game_mode: body.gameMode,
    duration_ms: body.durationMs,
    food_eaten: body.foodEaten,
    theme_name: body.themeName,
    metadata: {
      submittedAt: new Date().toISOString(),
      gameMode: body.gameMode,
    },
  }

  const primaryInsert = await supabase
    .from('snake_scores')
    .insert(insertPayload)
    .select('id, score, level, difficulty, game_mode, created_at, display_name')
    .single()

  let data = primaryInsert.data as ScoreInsertResponseRow | null
  let error = primaryInsert.error

  if (error && (error.message.includes('game_mode') || error.message.includes('column'))) {
    const fallbackPayload = {
      ...insertPayload,
      metadata: {
        ...insertPayload.metadata,
        modeStoredInMetadata: true,
      },
    }
    delete (fallbackPayload as { game_mode?: string }).game_mode

    const fallback = await supabase
      .from('snake_scores')
      .insert(fallbackPayload)
      .select('id, score, level, difficulty, created_at, display_name')
      .single()

    data = fallback.data as ScoreInsertResponseRow | null
    error = fallback.error
  }

  if (error) {
    return NextResponse.json({ error: `Uložení skóre selhalo: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true, entry: data })
}
