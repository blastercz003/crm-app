import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createMeetingGoogleCalendarOAuthUrl } from '@/lib/meetings/calendar-feed'

const STATE_COOKIE_NAME = 'meeting_google_calendar_oauth_state'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const state = crypto.randomUUID()
    const redirectUri = new URL(
      '/api/meeting-google-calendar/callback',
      request.url
    ).toString()
    const authUrl = await createMeetingGoogleCalendarOAuthUrl({
      redirectUri,
      state,
    })

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

    return response
  } catch (error) {
    const redirectUrl = new URL('/meetings', request.url)
    redirectUrl.searchParams.set(
      'google_calendar_error',
      error instanceof Error ? error.message : 'Nepodařilo se připravit Google přihlášení.'
    )
    return NextResponse.redirect(redirectUrl)
  }
}
