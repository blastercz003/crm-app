import { getMeetingCalendarFeedByToken, MEETING_CALENDAR_NAME } from '@/lib/meetings/calendar-feed'

export const dynamic = 'force-dynamic'

const CALENDAR_FILENAME = 'B-ENERGY-SCHUZKY.ics'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const feed = await getMeetingCalendarFeedByToken(token)

  if (!feed) {
    return new Response('Kalendář nebyl nalezen.', { status: 404 })
  }

  return new Response(feed.ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, max-age=0, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'Content-Disposition': `attachment; filename="${CALENDAR_FILENAME}"`,
      'X-WR-CALNAME': MEETING_CALENDAR_NAME,
    },
  })
}
