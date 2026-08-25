import { getDispatcherJobCalendarFeedByToken } from '@/lib/jobs/dispatcher-calendar-feed'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params
    const feed = await getDispatcherJobCalendarFeedByToken(token)

    if (!feed) {
      return new Response('Kalendář nebyl nalezen.', { status: 404 })
    }

    const isPersonal = feed.feed.calendar_scope === 'sales_owner'
    const calendarFilename = isPersonal
      ? 'B-ENERGY-MOJE-ZAKAZKY.ics'
      : 'B-ENERGY-VSECHNY-ZAKAZKY.ics'
    const calendarName = isPersonal
      ? 'B-ENERGY MOJE ZAKAZKY'
      : 'B-ENERGY VSECHNY ZAKAZKY'

    return new Response(feed.ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Content-Disposition': `inline; filename="${calendarFilename}"`,
        'X-WR-CALNAME': calendarName,
      },
    })
  } catch (error) {
    console.error('Generování dispečerského kalendáře selhalo.', error)
    const message =
      process.env.NODE_ENV === 'development' && error instanceof Error
        ? error.message
        : 'Kalendář se nepodařilo vygenerovat.'

    return new Response(message, { status: 500 })
  }
}
