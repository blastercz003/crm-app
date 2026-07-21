type PresencePeriod = 'today' | '7d' | '30d'

type TrackPresenceInput = {
  route?: string | null
  section?: string | null
  action?: string | null
  addActivityLog?: boolean
}

import type { ReceivedInvoiceRow } from '@/lib/received-invoices/types'

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...init,
  })

  if (!response.ok) throw new Error(`Dashboard API request failed: ${response.status}`)
  return response.json() as Promise<T>
}

export function trackUserPresence(input?: TrackPresenceInput) {
  return fetchJson<{ success: boolean; error: string | null }>('/api/dashboard/presence', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input ?? {}),
  })
}

export function getPresenceOverviewForAdmin(period: PresencePeriod = 'today') {
  return fetchJson<{
    success: boolean
    error: string | null
    onlineUsers: unknown[]
    usersInPeriod: unknown[]
  }>(`/api/dashboard/presence?mode=overview&period=${period}`)
}

export function getUserActivityForAdmin(userId: string, limit = 30, period: PresencePeriod = 'today') {
  const params = new URLSearchParams({
    mode: 'activity',
    userId,
    limit: String(limit),
    period,
  })
  return fetchJson<{ success: boolean; error: string | null; items: unknown[] }>(
    `/api/dashboard/presence?${params.toString()}`
  )
}

export function getTodayJobsForDashboard() {
  return fetchJson<{ success: boolean; error: string | null; items: unknown[] }>(
    '/api/dashboard/today-jobs'
  )
}

export function getReceivedInvoicesForDashboard(filter?: string) {
  const params = new URLSearchParams({ mode: 'list' })
  if (filter) params.set('filter', filter)
  return fetchJson<{
    success: boolean
    error: string | null
    rows: ReceivedInvoiceRow[]
  }>(`/api/dashboard/received-invoices?${params.toString()}`)
}

export function getReceivedInvoicePreviewUrl(invoiceId: string) {
  const params = new URLSearchParams({ mode: 'preview', invoiceId })
  return fetchJson<{
    success: boolean
    error: string | null
    signedUrl: string | null
  }>(`/api/dashboard/received-invoices?${params.toString()}`)
}

export function getMyDashboardQuickNote() {
  return fetchJson<{
    success: boolean
    error: string | null
    content: string
    updatedAt: string | null
  }>('/api/dashboard/quick-note')
}
