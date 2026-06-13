import { getServiceRoleClient } from '@/lib/supabase/service'

export type AppErrorContext = Record<string, unknown>

export type ReportAppErrorInput = {
  error: unknown
  errorType?: string
  route?: string | null
  section?: string | null
  userId?: string | null
  context?: AppErrorContext
  digest?: string | null
}

type ErrorLike = {
  name?: string
  message?: string
  stack?: string
  digest?: string
}

function getErrorLike(error: unknown): ErrorLike {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      digest: (error as ErrorLike).digest,
    }
  }

  if (typeof error === 'object' && error !== null) {
    const value = error as ErrorLike
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      digest: value.digest,
    }
  }

  return {
    message: String(error),
  }
}

function toCompactDateId(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function toRandomSuffix(length = 5) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let result = ''

  for (let index = 0; index < length; index += 1) {
    const randomIndex = Math.floor(Math.random() * alphabet.length)
    result += alphabet[randomIndex]
  }

  return result
}

function buildErrorCode() {
  return `ERR-${toCompactDateId()}-${toRandomSuffix()}`
}

export async function reportAppError(input: ReportAppErrorInput) {
  const errorLike = getErrorLike(input.error)
  const errorCode = buildErrorCode()

  const payload = {
    error_code: errorCode,
    error_type:
      input.errorType ??
      errorLike.name ??
      (input.digest ? 'NextError' : 'UnknownError'),
    message: errorLike.message ?? 'Neznámá chyba',
    stack: errorLike.stack ?? null,
    digest: input.digest ?? errorLike.digest ?? null,
    route: input.route ?? null,
    section: input.section ?? null,
    user_id: input.userId ?? null,
    context: input.context ?? {},
    created_at: new Date().toISOString(),
  }

  try {
    const supabase = getServiceRoleClient()

    if (!supabase) {
      console.error('App error logging failed: missing service role client.', {
        errorCode,
        ...payload,
      })
      return { errorCode }
    }

    const { error } = await supabase.from('app_error_logs').insert(payload)

    if (error) {
      console.error('App error logging failed.', {
        errorCode,
        dbError: error.message,
        ...payload,
      })
    }
  } catch (loggingError) {
    console.error('App error logging failed unexpectedly.', {
      errorCode,
      loggingError,
      ...payload,
    })
  }

  return { errorCode }
}
