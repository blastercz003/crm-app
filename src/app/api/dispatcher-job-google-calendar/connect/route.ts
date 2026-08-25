import { NextResponse } from 'next/server'
import { requireDispatcherCalendarAccess } from '@/lib/jobs/dispatcher-calendar-access'
import { createDispatcherGoogleCalendarOAuthUrl } from '@/lib/jobs/dispatcher-google-calendar'
import type { DispatcherCalendarScope } from '@/lib/jobs/dispatcher-calendar-scope'

const STATE_COOKIE_NAME = 'dispatcher_job_google_calendar_oauth_state'
const SCOPE_COOKIE_NAME = 'dispatcher_job_google_calendar_oauth_scope'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const requestedScope = new URL(request.url).searchParams.get('scope')
  const calendarScope: DispatcherCalendarScope =
    requestedScope === 'sales_owner' ? 'sales_owner' : 'all_jobs'
  const returnPath = calendarScope === 'sales_owner' ? '/jobs-portal' : '/jobs'

  try {
    const { user, error } = await requireDispatcherCalendarAccess(calendarScope)
    if (!user) {
      const redirectUrl = new URL(error === 'Nejsi přihlášený.' ? '/login' : '/dashboard', request.url)
      return NextResponse.redirect(redirectUrl)
    }

    const state = crypto.randomUUID()
    const redirectUri = new URL(
      '/api/dispatcher-job-google-calendar/callback',
      request.url
    ).toString()
    const authUrl = createDispatcherGoogleCalendarOAuthUrl({ redirectUri, state })
    const response = NextResponse.redirect(authUrl)
    response.cookies.set({
      name: STATE_COOKIE_NAME,
      value: state,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.url.startsWith('https://'),
      path: '/',
      maxAge: 10 * 60,
    })
    response.cookies.set({
      name: SCOPE_COOKIE_NAME,
      value: calendarScope,
      httpOnly: true,
      sameSite: 'lax',
      secure: request.url.startsWith('https://'),
      path: '/',
      maxAge: 10 * 60,
    })
    return response
  } catch (error) {
    const redirectUrl = new URL(returnPath, request.url)
    redirectUrl.searchParams.set(
      'dispatcher_calendar_error',
      error instanceof Error ? error.message : 'Nepodařilo se připravit Google přihlášení.'
    )
    return NextResponse.redirect(redirectUrl)
  }
}
