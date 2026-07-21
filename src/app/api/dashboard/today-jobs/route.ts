import { NextResponse } from 'next/server'
import { getTodayJobsForDashboard } from '@/lib/dashboard/today-jobs-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getTodayJobsForDashboard())
}
