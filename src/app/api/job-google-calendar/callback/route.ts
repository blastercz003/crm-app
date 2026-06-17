import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completeJobGoogleCalendarOAuth } from '@/lib/jobs/google-calendar'

const STATE_COOKIE_NAME = 'job_google_calendar_oauth_state'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    const redirectUrl = new URL('/zakazky-techniku', request.url)
    redirectUrl.searchParams.set(
      'google_calendar_error',
      errorDescription ?? error
    )
    return NextResponse.redirect(redirectUrl)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (!code || !state) {
    const redirectUrl = new URL('/zakazky-techniku', request.url)
    redirectUrl.searchParams.set(
      'google_calendar_error',
      'Google neposlal autorizační kód.'
    )
    return NextResponse.redirect(redirectUrl)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const cookieState = request.headers
    .get('cookie')
    ?.match(new RegExp(`${STATE_COOKIE_NAME}=([^;]+)`))?.[1]

  if (!cookieState || cookieState !== state) {
    const redirectUrl = new URL('/zakazky-techniku', request.url)
    redirectUrl.searchParams.set(
      'google_calendar_error',
      'Google aktivace neprošla bezpečnostní kontrolou.'
    )
    return NextResponse.redirect(redirectUrl)
  }

  const redirectUri = new URL('/api/job-google-calendar/callback', request.url).toString()

  try {
    const result = await completeJobGoogleCalendarOAuth({
      code,
      redirectUri,
      userId: user.id,
    })

    const redirectUrl = new URL('/zakazky-techniku', request.url)
    if (typeof result.insertedCount === 'number') {
      redirectUrl.searchParams.set(
        'google_calendar_status',
        result.insertedCount > 0 ? `created:${result.insertedCount}` : 'connected'
      )
    }

    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete(STATE_COOKIE_NAME)
    return response
  } catch (callbackError) {
    const redirectUrl = new URL('/zakazky-techniku', request.url)
    redirectUrl.searchParams.set(
      'google_calendar_error',
      callbackError instanceof Error
        ? callbackError.message
        : 'Nepodařilo se aktivovat Google kalendář.'
    )

    const response = NextResponse.redirect(redirectUrl)
    response.cookies.delete(STATE_COOKIE_NAME)
    return response
  }
}

