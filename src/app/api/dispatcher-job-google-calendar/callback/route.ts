import { NextResponse } from 'next/server'
import { requireDispatcherCalendarAccess } from '@/lib/jobs/dispatcher-calendar-access'
import { completeDispatcherGoogleCalendarOAuth } from '@/lib/jobs/dispatcher-google-calendar'
import type { DispatcherCalendarScope } from '@/lib/jobs/dispatcher-calendar-scope'

const STATE_COOKIE_NAME = 'dispatcher_job_google_calendar_oauth_state'
const SCOPE_COOKIE_NAME = 'dispatcher_job_google_calendar_oauth_scope'

export const dynamic = 'force-dynamic'

function readCookie(request: Request, name: string) {
  return request.headers
    .get('cookie')
    ?.match(new RegExp(`${name}=([^;]+)`))?.[1]
}

function getCalendarScope(request: Request): DispatcherCalendarScope {
  return readCookie(request, SCOPE_COOKIE_NAME) === 'sales_owner'
    ? 'sales_owner'
    : 'all_jobs'
}

function redirectWithError(
  request: Request,
  message: string,
  calendarScope = getCalendarScope(request)
) {
  const redirectUrl = new URL(
    calendarScope === 'sales_owner' ? '/jobs-portal' : '/jobs',
    request.url
  )
  redirectUrl.searchParams.set('dispatcher_calendar_error', message)
  return NextResponse.redirect(redirectUrl)
}

export async function GET(request: Request) {
  const calendarScope = getCalendarScope(request)
  const url = new URL(request.url)
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
  if (oauthError) return redirectWithError(request, oauthError)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return redirectWithError(request, 'Google neposlal autorizační kód.')

  const { user, error } = await requireDispatcherCalendarAccess(calendarScope)
  if (!user) return redirectWithError(request, error ?? 'Nemáš oprávnění pro kalendář.')

  const cookieState = readCookie(request, STATE_COOKIE_NAME)
  if (!cookieState || cookieState !== state) {
    return redirectWithError(request, 'Google aktivace neprošla bezpečnostní kontrolou.')
  }

  const redirectUri = new URL(
    '/api/dispatcher-job-google-calendar/callback',
    request.url
  ).toString()

  try {
    const result = await completeDispatcherGoogleCalendarOAuth({
      code,
      redirectUri,
      userId: user.id,
      calendarScope,
    })
    const redirectUrl = new URL(
      calendarScope === 'sales_owner' ? '/jobs-portal' : '/jobs',
      request.url
    )
    redirectUrl.searchParams.set(
      'dispatcher_calendar_status',
      result.insertedCount > 0 ? `created:${result.insertedCount}` : 'connected'
    )
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete(STATE_COOKIE_NAME)
    response.cookies.delete(SCOPE_COOKIE_NAME)
    return response
  } catch (error) {
    const response = redirectWithError(
      request,
      error instanceof Error ? error.message : 'Nepodařilo se aktivovat Google kalendář.'
    )
    response.cookies.delete(STATE_COOKIE_NAME)
    response.cookies.delete(SCOPE_COOKIE_NAME)
    return response
  }
}
