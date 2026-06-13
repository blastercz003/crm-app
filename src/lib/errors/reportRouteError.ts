import { reportAppError, type AppErrorContext } from './reportAppError'

type ReportRouteErrorInput = {
  error: unknown
  route: string
  section: string
  errorType: string
  userId?: string | null
  context?: AppErrorContext
  digest?: string | null
}

export async function reportRouteError(input: ReportRouteErrorInput) {
  return reportAppError({
    error: input.error,
    route: input.route,
    section: input.section,
    errorType: input.errorType,
    userId: input.userId ?? null,
    context: input.context ?? {},
    digest: input.digest ?? null,
  })
}
