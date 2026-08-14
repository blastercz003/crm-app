import { NextResponse } from 'next/server'
import {
  getNotificationAutomationMetadata,
  runNotificationAutomations,
} from '@/lib/notifications/automationNotifications'
import { runPendingJobPostCreateTasks } from '@/app/jobs/actions'
import { reportRouteError } from '@/lib/errors/reportRouteError'

function isAuthorized(request: Request) {
  const token = process.env.NOTIFICATIONS_AUTOMATION_TOKEN

  if (!token) {
    return false
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const providedToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : ''

  return providedToken.length > 0 && providedToken === token
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const [result, jobPostCreateTasks] = await Promise.all([
      runNotificationAutomations(new Date()),
      runPendingJobPostCreateTasks(),
    ])

    return NextResponse.json({
      ok: true,
      ...result,
      jobPostCreateTasks,
      metadata: getNotificationAutomationMetadata(new Date()),
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Nepodařilo se spustit automatické notifikace.'

    await reportRouteError({
      error,
      route: '/api/notifications/automations',
      section: 'notifications-automations',
      errorType: 'NotificationsAutomationsRouteError',
    })

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
