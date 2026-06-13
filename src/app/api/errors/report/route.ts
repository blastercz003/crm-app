import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { reportAppError } from '@/lib/errors/reportAppError'

type ReportErrorRequestBody = {
  errorType?: string
  message?: string
  stack?: string
  digest?: string | null
  route?: string | null
  section?: string | null
  context?: Record<string, unknown>
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReportErrorRequestBody
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { errorCode } = await reportAppError({
      errorType: body.errorType ?? 'UnhandledClientError',
      error: {
        name: body.errorType ?? 'UnhandledClientError',
        message: body.message ?? 'Neznámá chyba',
        stack: body.stack ?? undefined,
      },
      digest: body.digest ?? null,
      route: body.route ?? null,
      section: body.section ?? null,
      userId: user?.id ?? null,
      context: body.context ?? {},
    })

    return NextResponse.json({ ok: true, errorCode })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Nepodařilo se zapsat chybu.'

    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    )
  }
}
