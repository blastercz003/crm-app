import { createClient } from '@/lib/supabase/server'
import { getCurrentUserNotifications } from '@/lib/notifications/getNotifications'
import {
  GLOBAL_SEARCH_MIN_QUERY_LENGTH,
} from './config'
import { GLOBAL_SEARCH_SECTIONS } from './sections'
import type {
  GlobalSearchResponse,
  GlobalSearchResultItem,
  GlobalSearchSectionKey,
  GlobalSearchSectionResult,
} from './types'

type GlobalSearchProfile = {
  id: string
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  can_view_offers: boolean | null
  can_view_connection_points: boolean | null
  can_view_stores: boolean | null
  jobs_sales_scope: 'MICHAL' | 'LÍDA' | null
}

type ClientRow = {
  id: string
  name: string
  ico: string | null
  address: string | null
  contact_person: string | null
  contact_email: string | null
  created_at: string
}

type TaskRow = {
  id: string
  title: string
  note: string | null
  company_name: string | null
  contact_person: string | null
  status: string | null
  due_date: string | null
  created_at: string | null
}

type MeetingRow = {
  id: string
  company_name: string | null
  contact_person: string | null
  title: string | null
  status: 'planned' | 'completed'
  meeting_datetime: string | null
}

type OfferRow = {
  id: string
  offer_number: string
  title: string
  status: string
  updated_at: string
  client_id: string
}

type OfferClientRow = {
  id: string
  name: string
}

type JobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  job_status: string
  start_at: string
  end_at: string
  updated_at: string
  sales_owner?: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
}

type FinanceJoinRow = {
  id: string
  invoice_number: string | null
  sale_amount: number | null
  job:
    | {
        id: string
        job_number: string
        company_name: string
        contact_person: string | null
        start_at: string
        invoice_status: string
      }
    | {
        id: string
        job_number: string
        company_name: string
        contact_person: string | null
        start_at: string
        invoice_status: string
      }[]
    | null
}

type StoreRow = {
  id: string
  chain_name: string
  store_number: string
  city: string
  address: string
  phone_1: string
  phone_2: string | null
  phone_3: string | null
  updated_at: string
}

type ConnectionPointFolderSearchRow = {
  id: string
  name: string
  updated_at: string
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function escapeLike(value: string) {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll(',', ' ').trim()
}

function getSearchTokens(query: string) {
  return normalize(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function textMatchScore(value: string | null | undefined, query: string) {
  if (!value) return 0

  const normalizedValue = normalize(value)
  const normalizedQuery = normalize(query)

  if (!normalizedQuery) return 0
  if (normalizedValue === normalizedQuery) return 100
  if (normalizedValue.startsWith(normalizedQuery)) return 70
  if (normalizedValue.includes(normalizedQuery)) return 45

  return 0
}

function recencyScore(value: string | null | undefined) {
  if (!value) return 0

  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return 0

  const ageDays = (Date.now() - time) / (1000 * 60 * 60 * 24)
  if (ageDays <= 7) return 25
  if (ageDays <= 30) return 15
  if (ageDays <= 180) return 8
  return 2
}

function topAndSort(items: Array<GlobalSearchResultItem & { score: number }>) {
  return items
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return bTime - aTime
    })
    .map((item) => {
      const { score, ...rest } = item
      void score
      return rest
    })
}

function topAndSortByStartAtAsc(
  items: Array<GlobalSearchResultItem & { score: number; startAt: string | null }>
) {
  return items
    .sort((a, b) => {
      const aTime = a.startAt ? new Date(a.startAt).getTime() : Number.MAX_SAFE_INTEGER
      const bTime = b.startAt ? new Date(b.startAt).getTime() : Number.MAX_SAFE_INTEGER

      if (aTime !== bTime) return aTime - bTime
      if (b.score !== a.score) return b.score - a.score
      return (b.updatedAt ? new Date(b.updatedAt).getTime() : 0) - (a.updatedAt ? new Date(a.updatedAt).getTime() : 0)
    })
    .map((item) => {
      const { score, startAt, ...rest } = item
      void score
      void startAt
      return rest
    })
}

function getSectionLabel(key: GlobalSearchSectionKey) {
  return GLOBAL_SEARCH_SECTIONS.find((section) => section.key === key)?.label ?? key
}

function getTaskStatusLabel(status: string | null) {
  if (status === 'done') return 'Vyřešený'
  if (status === 'todo') return 'Aktivní'
  return status
}

function getMeetingStatusLabel(status: string | null) {
  if (status === 'planned') return 'Plánované'
  if (status === 'completed') return 'Proběhlé'
  return status
}

function getOfferStatusLabel(status: string | null) {
  if (status === 'draft') return 'Rozpracovaná'
  if (status === 'submitted') return 'Ke schválení'
  if (status === 'changes_requested') return 'K úpravě'
  if (status === 'approved') return 'Schválená'
  if (status === 'sent_to_client') return 'Odeslaná'
  if (status === 'in_progress') return 'V řešení'
  if (status === 'realizace') return 'Realizace'
  if (status === 'ordered') return 'Objednáno'
  if (status === 'rejected') return 'Zamítnuto'
  return status
}

function getInvoiceStatusLabel(status: string | null) {
  if (status === 'bez_faktury') return 'Bez faktury'
  if (status === 'k_fakturaci') return 'K fakturaci'
  if (status === 'vyfakturovano') return 'Vyfakturováno'
  return status
}

function getJobStatusLabel(status: string | null) {
  if (status === 'nova') return 'NOVÁ'
  if (status === 'k_reseni') return 'V ŘEŠENÍ'
  if (status === 'realizace') return 'REALIZACE'
  if (status === 'ukoncena') return 'UKONČENÁ'
  if (status === 'storno') return 'STORNO'
  return status
}

function getEffectiveJobStatus(status: string | null, endAt: string | null) {
  if (status !== 'realizace' && status !== 'ukoncena') {
    return status
  }

  if (!endAt) {
    return status
  }

  const endTime = new Date(endAt).getTime()
  if (Number.isNaN(endTime)) {
    return status
  }

  return endTime < Date.now() ? 'ukoncena' : 'realizace'
}

function formatMeetingDateTime(value: string | null) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const parts = new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Prague',
  }).formatToParts(date)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  const day = get('day')
  const month = get('month')
  const year = get('year')
  const hour = get('hour')
  const minute = get('minute')

  if (!day || !month || !year || !hour || !minute) {
    return value
  }

  return `${day}.${month}.${year} ${hour}:${minute}`
}

function formatCurrencyCzk(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) return null

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDateTimeRange(startAt: string | null, endAt: string | null) {
  const start = formatMeetingDateTime(startAt)
  const end = formatMeetingDateTime(endAt)

  if (start && end) {
    return `${start} - ${end}`
  }

  if (start) return start
  if (end) return end
  return null
}

async function searchClients(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
}) {
  const { supabase, query } = params

  let request = supabase
    .from('clients')
    .select('id, name, ico, address, contact_person, contact_email, created_at')
    .order('created_at', { ascending: false })
    .limit(40)

  const escaped = escapeLike(query)
  request = request.or(
    [
      `name.ilike.%${escaped}%`,
      `ico.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
      `contact_email.ilike.%${escaped}%`,
    ].join(',')
  )

  const { data, error } = await request
  if (error) throw new Error(`Global search clients failed: ${error.message}`)

  const rows = (data ?? []) as ClientRow[]
  const items = rows.map((row) => {
    const score =
      textMatchScore(row.name, query) * 2 +
      textMatchScore(row.ico, query) +
      textMatchScore(row.contact_person, query) +
      textMatchScore(row.contact_email, query) +
      recencyScore(row.created_at)

    return {
      id: row.id,
      title: row.name,
      subtitle: row.address,
      meta: row.contact_person,
      statusLabel: row.ico ? `IČO ${row.ico}` : null,
      updatedAt: row.created_at,
      href: `/clients/${row.id}`,
      score,
    }
  })

  return {
    key: 'clients' as const,
    label: getSectionLabel('clients'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchTasks(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
  isAdmin: boolean
  userId: string
}) {
  const { supabase, query, isAdmin, userId } = params

  let request = supabase
    .from('tasks')
    .select('id, title, note, company_name, contact_person, status, due_date, created_at')
    .order('created_at', { ascending: false })
    .limit(60)

  if (!isAdmin) {
    request = request.or(`assigned_to.eq.${userId},created_by.eq.${userId}`)
  }

  const escaped = escapeLike(query)
  request = request.or(
    [
      `title.ilike.%${escaped}%`,
      `note.ilike.%${escaped}%`,
      `company_name.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
    ].join(',')
  )

  const { data, error } = await request
  if (error) throw new Error(`Global search tasks failed: ${error.message}`)

  const dedup = new Map<string, TaskRow>()
  ;((data ?? []) as TaskRow[]).forEach((row) => {
    dedup.set(row.id, row)
  })

  const rows = Array.from(dedup.values())

  const items = rows.map((row) => {
    const statusLabel = getTaskStatusLabel(row.status)
    const score =
      textMatchScore(row.title, query) * 2 +
      textMatchScore(row.company_name, query) +
      textMatchScore(row.contact_person, query) +
      textMatchScore(row.note, query) +
      recencyScore(row.created_at)

    return {
      id: row.id,
      title: row.title,
      subtitle: [row.company_name, row.contact_person].filter(Boolean).join(' • ') || null,
      meta: row.due_date || null,
      statusLabel,
      updatedAt: row.created_at,
      href: `/tasks/${row.id}`,
      score,
    }
  })

  return {
    key: 'tasks' as const,
    label: getSectionLabel('tasks'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchMeetings(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
  isAdmin: boolean
  userId: string
}) {
  const { supabase, query, isAdmin, userId } = params

  let request = supabase
    .from('meetings')
    .select('id, company_name, contact_person, title, status, meeting_datetime')
    .order('meeting_datetime', { ascending: false })
    .limit(60)

  if (!isAdmin) {
    request = request.eq('assigned_user_id', userId)
  }

  const escaped = escapeLike(query)
  request = request.or(
    [
      `company_name.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
      `title.ilike.%${escaped}%`,
      `contact_phone.ilike.%${escaped}%`,
      `contact_email.ilike.%${escaped}%`,
      `address.ilike.%${escaped}%`,
      `pre_meeting_note.ilike.%${escaped}%`,
      `result_note.ilike.%${escaped}%`,
      `follow_up_task.ilike.%${escaped}%`,
    ].join(',')
  )

  const { data, error } = await request
  if (error) throw new Error(`Global search meetings failed: ${error.message}`)

  const rows = (data ?? []) as MeetingRow[]

  const items = rows.map((row) => {
    const statusLabel = getMeetingStatusLabel(row.status)
    const dateLabel = formatMeetingDateTime(row.meeting_datetime)

    const score =
      textMatchScore(row.title, query) * 2 +
      textMatchScore(row.company_name, query) +
      textMatchScore(row.contact_person, query) +
      recencyScore(row.meeting_datetime)

    return {
      id: row.id,
      title: row.title || row.company_name || 'Schůzka',
      subtitle: [row.company_name, row.contact_person].filter(Boolean).join(' • ') || null,
      meta: dateLabel,
      statusLabel,
      updatedAt: row.meeting_datetime,
      href: `/meetings/${row.id}`,
      score,
    }
  })

  return {
    key: 'meetings' as const,
    label: getSectionLabel('meetings'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchOffers(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
  isAdmin: boolean
  userId: string
}) {
  const { supabase, query, isAdmin, userId } = params

  let request = supabase
    .from('offers')
    .select('id, offer_number, title, status, updated_at, client_id')
    .order('updated_at', { ascending: false })
    .limit(60)

  if (!isAdmin) {
    request = request.eq('created_by', userId)
  }

  const escaped = escapeLike(query)

  let matchingClientIds: string[] = []
  const clientQuery = supabase.from('clients').select('id').ilike('name', `%${escaped}%`)

  const clientsResponse = await clientQuery
  if (clientsResponse.error) {
    throw new Error(`Global search offers client match failed: ${clientsResponse.error.message}`)
  }

  matchingClientIds = ((clientsResponse.data ?? []) as { id: string }[]).map((item) => item.id)

  const baseFilter = `title.ilike.%${escaped}%,offer_number.ilike.%${escaped}%`
  const filter =
    matchingClientIds.length > 0
      ? `${baseFilter},client_id.in.(${matchingClientIds.join(',')})`
      : baseFilter

  request = request.or(filter)

  const { data, error } = await request
  if (error) throw new Error(`Global search offers failed: ${error.message}`)

  const rows = (data ?? []) as OfferRow[]

  const clientIds = Array.from(new Set(rows.map((row) => row.client_id).filter(Boolean)))
  const clientMap = new Map<string, string>()

  if (clientIds.length > 0) {
    const clientsQuery = await supabase.from('clients').select('id, name').in('id', clientIds)
    if (!clientsQuery.error) {
      ;((clientsQuery.data ?? []) as OfferClientRow[]).forEach((client) => {
        clientMap.set(client.id, client.name)
      })
    }
  }

  const items = rows.map((row) => {
    const clientName = clientMap.get(row.client_id) ?? null
    const statusLabel = getOfferStatusLabel(row.status)

    const score =
      textMatchScore(row.offer_number, query) * 2 +
      textMatchScore(row.title, query) * 2 +
      textMatchScore(clientName, query) +
      recencyScore(row.updated_at)

    return {
      id: row.id,
      title: row.title,
      subtitle: clientName,
      meta: row.offer_number,
      statusLabel,
      updatedAt: row.updated_at,
      href: `/offers/${row.id}`,
      score,
    }
  })

  return {
    key: 'offers' as const,
    label: getSectionLabel('offers'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchJobs(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
  isAdmin: boolean
}) {
  const { supabase, query, isAdmin } = params

  let request = supabase
    .from('jobs')
    .select('id, job_number, company_name, contact_person, job_status, start_at, end_at, updated_at, sales_owner')
    .order('updated_at', { ascending: false })
    .limit(60)

  const escaped = escapeLike(query)
  request = request.or(
    [
      `company_name.ilike.%${escaped}%`,
      `technician_name.ilike.%${escaped}%`,
      `site_address.ilike.%${escaped}%`,
      `generator_name.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
      `job_number.ilike.%${escaped}%`,
      `store_number.ilike.%${escaped}%`,
    ].join(',')
  )

  if (!isAdmin) {
    // Access is already checked by section-level permission; keep data scope as section allows.
  }

  const { data, error } = await request
  if (error) throw new Error(`Global search jobs failed: ${error.message}`)

  const rows = (data ?? []) as JobRow[]

  const items = rows.map((row) => {
    const effectiveStatus = getEffectiveJobStatus(row.job_status, row.end_at)

    const score =
      textMatchScore(row.job_number, query) * 2 +
      textMatchScore(row.company_name, query) * 2 +
      textMatchScore(row.contact_person, query) +
      recencyScore(row.updated_at)

    return {
      id: row.id,
      title: `${row.job_number} • ${row.company_name}`,
      subtitle: row.contact_person,
      meta: formatDateTimeRange(row.start_at, row.end_at),
      statusLabel: getJobStatusLabel(effectiveStatus),
      startAt: row.start_at,
      updatedAt: row.updated_at,
      href: `/jobs?q=${encodeURIComponent(row.job_number)}`,
      score,
    }
  })

  return {
    key: 'jobs' as const,
    label: getSectionLabel('jobs'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSortByStartAtAsc(items),
  }
}

async function searchJobsPortal(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
  allowedSalesOwners: Array<'MICHAL' | 'LÍDA'>
}) {
  const { supabase, query, allowedSalesOwners } = params

  let request = supabase
    .from('jobs')
    .select('id, job_number, company_name, contact_person, job_status, start_at, end_at, updated_at, sales_owner')
    .in('sales_owner', allowedSalesOwners)
    .order('updated_at', { ascending: false })
    .limit(60)

  const escaped = escapeLike(query)
  request = request.or(
    [
      `company_name.ilike.%${escaped}%`,
      `technician_name.ilike.%${escaped}%`,
      `site_address.ilike.%${escaped}%`,
      `generator_name.ilike.%${escaped}%`,
      `contact_person.ilike.%${escaped}%`,
      `job_number.ilike.%${escaped}%`,
      `store_number.ilike.%${escaped}%`,
    ].join(',')
  )

  const { data, error } = await request
  if (error) throw new Error(`Global search jobs portal failed: ${error.message}`)

  const rows = (data ?? []) as JobRow[]

  const items = rows.map((row) => {
    const effectiveStatus = getEffectiveJobStatus(row.job_status, row.end_at)

    const score =
      textMatchScore(row.job_number, query) * 2 +
      textMatchScore(row.company_name, query) * 2 +
      textMatchScore(row.contact_person, query) +
      recencyScore(row.updated_at)

    return {
      id: row.id,
      title: `${row.job_number} • ${row.company_name}`,
      subtitle: [row.contact_person, row.sales_owner].filter(Boolean).join(' • '),
      meta: formatDateTimeRange(row.start_at, row.end_at),
      statusLabel: getJobStatusLabel(effectiveStatus),
      startAt: row.start_at,
      updatedAt: row.updated_at,
      href: `/jobs-portal?q=${encodeURIComponent(row.job_number)}`,
      score,
    }
  })

  return {
    key: 'jobs_portal' as const,
    label: getSectionLabel('jobs_portal'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSortByStartAtAsc(items),
  }
}

async function searchFaktury(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
}) {
  const { supabase, query } = params

  const escaped = escapeLike(query)

  const matchingJobsResponse = await supabase
    .from('jobs')
    .select('id')
    .or(
      [
        `job_number.ilike.%${escaped}%`,
        `company_name.ilike.%${escaped}%`,
        `contact_person.ilike.%${escaped}%`,
        `site_address.ilike.%${escaped}%`,
        `store_number.ilike.%${escaped}%`,
      ].join(',')
    )
    .limit(100)

  if (matchingJobsResponse.error) {
    throw new Error(`Global search faktury jobs match failed: ${matchingJobsResponse.error.message}`)
  }

  const jobIds = ((matchingJobsResponse.data ?? []) as { id: string }[]).map((item) => item.id)

  let request = supabase
    .from('job_finances')
    .select('id, invoice_number, sale_amount, job:jobs(id, job_number, company_name, contact_person, start_at, invoice_status)')
    .order('created_at', { ascending: false })
    .limit(60)

  if (jobIds.length > 0) {
    request = request.or(`invoice_number.ilike.%${escaped}%,info_note.ilike.%${escaped}%,job_id.in.(${jobIds.join(',')})`)
  } else {
    request = request.or(`invoice_number.ilike.%${escaped}%,info_note.ilike.%${escaped}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(`Global search faktury failed: ${error.message}`)

  const rows = (data ?? []) as FinanceJoinRow[]

  const items = rows
    .map((row) => {
      const job = Array.isArray(row.job) ? row.job[0] : row.job
      if (!job) return null

      const score =
        textMatchScore(row.invoice_number, query) * 2 +
        textMatchScore(job.job_number, query) * 2 +
        textMatchScore(job.company_name, query) * 2 +
        textMatchScore(job.contact_person, query) +
        recencyScore(job.start_at)

      return {
        id: row.id,
        title: row.invoice_number ? row.invoice_number : 'Bez čísla faktury',
        subtitle: `Zakázka: ${job.job_number} • ${job.company_name}`,
        meta: formatCurrencyCzk(row.sale_amount)
          ? `Částka: ${formatCurrencyCzk(row.sale_amount)}`
          : null,
        statusLabel: getInvoiceStatusLabel(job.invoice_status),
        updatedAt: job.start_at,
        href: `/faktury?q=${encodeURIComponent(job.job_number)}`,
        score,
      }
    })
    .filter(Boolean) as Array<GlobalSearchResultItem & { score: number }>

  return {
    key: 'faktury' as const,
    label: getSectionLabel('faktury'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchStores(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
}) {
  const { supabase, query } = params
  const searchTokens = getSearchTokens(query)

  if (searchTokens.length === 0) {
    return {
      key: 'stores' as const,
      label: getSectionLabel('stores'),
      hasAccess: true,
      totalCount: 0,
      items: [],
    }
  }

  let request = supabase
    .from('stores')
    .select('id, chain_name, store_number, city, address, phone_1, phone_2, phone_3, updated_at')
    .order('updated_at', { ascending: false })
    .limit(60)

  for (const token of searchTokens) {
    const escapedToken = token.replaceAll('%', '\\%').replaceAll('_', '\\_')
    request = request.ilike('search_text', `%${escapedToken}%`)
  }

  const { data, error } = await request
  if (error) throw new Error(`Global search stores failed: ${error.message}`)

  const rows = (data ?? []) as StoreRow[]

  const items = rows.map((row) => {
    const phones = [row.phone_1, row.phone_2, row.phone_3].filter(Boolean).join(' • ')
    const addressParts = [row.city, row.address].filter(Boolean).join(' • ')

    const score =
      textMatchScore(row.chain_name, query) * 2 +
      textMatchScore(row.store_number, query) * 2 +
      textMatchScore(row.city, query) * 2 +
      textMatchScore(row.address, query) +
      textMatchScore(row.phone_1, query) +
      textMatchScore(row.phone_2, query) +
      textMatchScore(row.phone_3, query) +
      recencyScore(row.updated_at)

    return {
      id: row.id,
      title: `${row.chain_name} • ${row.store_number}`,
      subtitle: addressParts || null,
      meta: phones || null,
      updatedAt: row.updated_at,
      href: `/prodejny?q=${encodeURIComponent(`${row.chain_name} ${row.store_number}`)}`,
      score,
    }
  })

  return {
    key: 'stores' as const,
    label: getSectionLabel('stores'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchConnectionPoints(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  query: string
}) {
  const { supabase, query } = params
  const searchTokens = getSearchTokens(query)

  if (searchTokens.length === 0) {
    return {
      key: 'connection_points' as const,
      label: getSectionLabel('connection_points'),
      hasAccess: true,
      totalCount: 0,
      items: [],
    }
  }

  let request = supabase
    .from('connection_point_folders')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
    .limit(60)

  for (const token of searchTokens) {
    const escapedToken = token.replaceAll('%', '\\%').replaceAll('_', '\\_')
    request = request.ilike('search_text', `%${escapedToken}%`)
  }

  const { data, error } = await request
  if (error) {
    throw new Error(`Global search connection points failed: ${error.message}`)
  }

  const rows = (data ?? []) as ConnectionPointFolderSearchRow[]

  const items = rows.map((row) => ({
    id: row.id,
    title: row.name,
    subtitle: 'Složka přípojného bodu',
    meta: null,
    updatedAt: row.updated_at,
    href: `/pripojne-body/${row.id}`,
    score: textMatchScore(row.name, query) * 2 + recencyScore(row.updated_at),
  }))

  return {
    key: 'connection_points' as const,
    label: getSectionLabel('connection_points'),
    hasAccess: true,
    totalCount: rows.length,
    items: topAndSort(items),
  }
}

async function searchNotifications(query: string) {
  const notifications = await getCurrentUserNotifications({
    status: 'active',
    search: query,
    limit: 100,
  })

  const items = notifications.map((row) => {
    const score =
      textMatchScore(row.title, query) * 2 +
      textMatchScore(row.message, query) +
      recencyScore(row.created_at)

    return {
      id: row.id,
      title: row.title,
      subtitle: row.message,
      meta: row.category,
      statusLabel: row.priority,
      updatedAt: row.created_at,
      href: row.href || `/notifications?search=${encodeURIComponent(query)}`,
      score,
    }
  })

  return {
    key: 'notifications' as const,
    label: getSectionLabel('notifications'),
    hasAccess: true,
    totalCount: notifications.length,
    items: topAndSort(items),
  }
}

export async function globalSearch(rawQuery: string): Promise<GlobalSearchResponse> {
  const query = rawQuery.trim()

  if (query.length < GLOBAL_SEARCH_MIN_QUERY_LENGTH) {
    return {
      query,
      sections: [],
    }
  }

  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, can_view_jobs, can_view_jobs_portal, can_view_offers, can_view_connection_points, can_view_stores, jobs_sales_scope')
    .eq('id', user.id)
    .single<GlobalSearchProfile>()

  if (profileError || !profile) {
    throw new Error('Nepodařilo se načíst profil uživatele pro hledání.')
  }

  const isAdmin = profile.role === 'admin'
  const sections: GlobalSearchSectionResult[] = []

  sections.push(await searchClients({ supabase, query }))
  sections.push(await searchTasks({ supabase, query, isAdmin, userId: user.id }))
  sections.push(await searchMeetings({ supabase, query, isAdmin, userId: user.id }))

  if (isAdmin || profile.can_view_offers) {
    sections.push(await searchOffers({ supabase, query, isAdmin, userId: user.id }))
  }

  if (isAdmin || profile.can_view_jobs) {
    sections.push(await searchJobs({ supabase, query, isAdmin }))
  }

  if (profile.can_view_jobs_portal) {
    const allowedSalesOwners: Array<'MICHAL' | 'LÍDA'> = isAdmin
      ? ['MICHAL', 'LÍDA']
      : profile.jobs_sales_scope
        ? [profile.jobs_sales_scope]
        : []

    if (allowedSalesOwners.length > 0) {
      sections.push(
        await searchJobsPortal({
          supabase,
          query,
          allowedSalesOwners,
        })
      )
    }
  }

  if (
    isAdmin ||
    profile.role === 'TECHNIK' ||
    profile.can_view_connection_points
  ) {
    sections.push(await searchConnectionPoints({ supabase, query }))
  }

  if (isAdmin || profile.can_view_stores) {
    sections.push(await searchStores({ supabase, query }))
  }

  if (isAdmin) {
    sections.push(await searchFaktury({ supabase, query }))
  }

  sections.push(await searchNotifications(query))

  return {
    query,
    sections,
  }
}
