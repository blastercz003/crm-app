import { reportAppError, type AppErrorContext } from './reportAppError'

type ReportActionErrorInput = {
  error: unknown
  action: string
  section: string
  errorType?: string
  userId?: string | null
  context?: AppErrorContext
  digest?: string | null
}

export async function reportActionError(input: ReportActionErrorInput) {
  return reportAppError({
    error: input.error,
    route: input.action,
    section: input.section,
    errorType: input.errorType ?? 'ServerActionError',
    userId: input.userId ?? null,
    context: input.context ?? {},
    digest: input.digest ?? null,
  })
}
