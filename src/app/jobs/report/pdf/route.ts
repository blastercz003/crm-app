import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, Fragment } from 'react'
import { NextRequest, NextResponse } from 'next/server'
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type ViewMode = 'all' | 'active'

type JobRow = {
  id: string
  job_number: string
  company_name: string
  start_at: string
  end_at: string
  site_address: string | null
  technician_name: string | null
  generator_name: string | null
  marny_vyjezd: boolean | null
  pohotovost: boolean | null
  job_status: JobStatus
}

type ReportInput = {
  query: string
  status: JobStatus | ''
  view: ViewMode
  dateFrom: string
  dateTo: string
}

type DayGroup = {
  key: string
  label: string
  jobs: JobRow[]
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`

Font.register({
  family: 'JobsArial',
  fonts: [
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf'),
      fontWeight: 400,
    },
    {
      src: path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf'),
      fontWeight: 700,
    },
  ],
})

const columnWidths = {
  number: '9%',
  company: '19%',
  term: '14%',
  place: '22%',
  technician: '15%',
  generator: '11%',
  status: '10%',
} as const

const styles = StyleSheet.create({
  page: {
    paddingTop: 76,
    paddingRight: 28,
    paddingBottom: 30,
    paddingLeft: 28,
    backgroundColor: '#ffffff',
    color: '#253044',
    fontFamily: 'JobsArial',
    fontSize: 8,
  },
  fixedHeader: {
    position: 'absolute',
    top: 17,
    right: 28,
    left: 28,
  },
  headerMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1.2,
    borderBottomColor: '#2f77af',
    paddingBottom: 6,
  },
  titleBlock: {
    width: '33.333%',
    alignItems: 'flex-start',
  },
  logoBlock: {
    width: '33.333%',
    alignItems: 'center',
  },
  logo: {
    width: 78,
    height: 22,
    objectFit: 'contain',
  },
  kicker: {
    color: '#2f77af',
    fontSize: 5.7,
    fontWeight: 700,
    letterSpacing: 1.55,
  },
  title: {
    marginTop: 1.5,
    color: '#172033',
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.05,
  },
  summary: {
    width: '33.333%',
    alignItems: 'flex-end',
  },
  summaryTitle: {
    color: '#172033',
    fontSize: 7.8,
    fontWeight: 700,
  },
  summaryMeta: {
    marginTop: 2,
    color: '#64748b',
    fontSize: 5.9,
  },
  filterBar: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    color: '#64748b',
    fontSize: 5.9,
  },
  filterValue: {
    color: '#334155',
    fontWeight: 700,
  },
  dayBlock: {
    marginTop: 4,
  },
  dayHeader: {
    minHeight: 17,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1.2,
    borderBottomColor: '#7baed0',
    backgroundColor: '#f7fbfe',
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  dayTitle: {
    color: '#236f9f',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.6,
  },
  dayCount: {
    color: '#64748b',
    fontSize: 5.7,
  },
  row: {
    minHeight: 21,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: '#a9b5c3',
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  cell: {
    alignSelf: 'stretch',
    paddingHorizontal: 4,
    paddingVertical: 3.2,
    justifyContent: 'center',
    lineHeight: 1.16,
  },
  valueText: {
    transform: 'translateY(4.5)',
  },
  strong: {
    color: '#172033',
    fontWeight: 700,
  },
  companySingleLine: {
    maxLines: 1,
    textOverflow: 'ellipsis',
  },
  jobNumberCell: {
    position: 'relative',
  },
  standbyMarker: {
    position: 'absolute',
    top: 7.5,
    left: 34,
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0.7,
    borderColor: '#8dbfe0',
    borderRadius: 5,
    backgroundColor: '#eaf5fc',
  },
  standbyMarkerText: {
    color: '#236f9f',
    fontSize: 5.8,
    fontWeight: 700,
    lineHeight: 1,
  },
  muted: {
    color: '#64748b',
  },
  status: {
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 3.5,
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.25,
    lineHeight: 1,
  },
  statusNova: {
    borderColor: '#8ab6d5',
    backgroundColor: '#e8f2f9',
    color: '#236f9f',
  },
  statusKReseni: {
    borderColor: '#f2ba80',
    backgroundColor: '#fff3e7',
    color: '#a34b00',
  },
  statusRealizace: {
    borderColor: '#8bcdb4',
    backgroundColor: '#e9f8f1',
    color: '#087750',
  },
  statusUkoncena: {
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    color: '#475569',
  },
  statusStorno: {
    borderColor: '#e9a1a1',
    backgroundColor: '#fcecec',
    color: '#b42323',
  },
  empty: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#dbe3ec',
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    padding: 18,
    color: '#64748b',
    textAlign: 'center',
  },
  footer: {
    position: 'absolute',
    right: 28,
    bottom: 9,
    left: 28,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 0.7,
    borderTopColor: '#dbe3ec',
    paddingTop: 3.5,
    color: '#94a3b8',
    fontSize: 5.3,
  },
})

function isJobStatus(value: string): value is JobStatus {
  return ['nova', 'k_reseni', 'realizace', 'ukoncena', 'storno'].includes(value)
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parseInput(request: NextRequest): ReportInput | string {
  const statusParam = request.nextUrl.searchParams.get('status')?.trim() ?? ''
  const viewParam = request.nextUrl.searchParams.get('view')?.trim() ?? 'all'
  const dateFrom = request.nextUrl.searchParams.get('date_from')?.trim() ?? ''
  const dateTo = request.nextUrl.searchParams.get('date_to')?.trim() ?? ''

  if (statusParam && !isJobStatus(statusParam)) return 'Neplatný stav zakázky.'
  if (viewParam !== 'all' && viewParam !== 'active') return 'Neplatný typ zobrazení.'
  if (dateFrom && !isIsoDate(dateFrom)) return 'Neplatné datum od.'
  if (dateTo && !isIsoDate(dateTo)) return 'Neplatné datum do.'
  if (dateFrom && dateTo && dateFrom > dateTo) return 'Datum od musí být před datem do.'

  return {
    query: request.nextUrl.searchParams.get('q')?.trim().slice(0, 200) ?? '',
    status: statusParam as JobStatus | '',
    view: viewParam as ViewMode,
    dateFrom,
    dateTo,
  }
}

function buildSearchFilter(search: string) {
  const normalized = search
    .replaceAll(',', ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  const escaped = normalized.replaceAll('%', '\\%').replaceAll('_', '\\_')

  return [
    `company_name_search.ilike.%${escaped}%`,
    `technician_name_search.ilike.%${escaped}%`,
    `site_address_search.ilike.%${escaped}%`,
    `generator_name_search.ilike.%${escaped}%`,
    `contact_person_search.ilike.%${escaped}%`,
    `job_number_search.ilike.%${escaped}%`,
    `store_number_search.ilike.%${escaped}%`,
  ].join(',')
}

function formatDate(value: string) {
  const [year, month, day] = value.split('-')
  return `${Number(day)}. ${Number(month)}. ${year}`
}

function formatPeriod(input: ReportInput) {
  if (input.dateFrom && input.dateTo && input.dateFrom === input.dateTo) {
    return `Datum: ${formatDate(input.dateFrom)}`
  }
  if (input.dateFrom && input.dateTo) {
    return `Období: ${formatDate(input.dateFrom)} - ${formatDate(input.dateTo)}`
  }
  if (input.dateFrom) return `Od: ${formatDate(input.dateFrom)}`
  if (input.dateTo) return `Do: ${formatDate(input.dateTo)}`
  return 'Všechny termíny'
}

function formatCount(count: number) {
  if (count === 1) return '1 zakázka'
  if (count >= 2 && count <= 4) return `${count} zakázky`
  return `${count} zakázek`
}

function formatStatusFilter(status: JobStatus | '') {
  if (status === 'nova') return 'Nová'
  if (status === 'k_reseni') return 'V řešení'
  if (status === 'realizace') return 'Realizace'
  if (status === 'ukoncena') return 'Ukončená'
  if (status === 'storno') return 'Storno'
  return 'Všechny stavy'
}

function getDayKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'without-date'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatDayLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'BEZ TERMÍNU'
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
    .format(date)
    .toLocaleUpperCase('cs-CZ')
}

function formatTerm(startValue: string, endValue: string) {
  const start = new Date(startValue)
  const end = new Date(endValue)
  if (Number.isNaN(start.getTime())) return '—'

  const timeFormatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  })
  const shortDateFormatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
  })
  if (Number.isNaN(end.getTime())) return timeFormatter.format(start)
  if (getDayKey(startValue) === getDayKey(endValue)) {
    return `${shortDateFormatter.format(start)} · ${timeFormatter.format(start)} - ${timeFormatter.format(end)}`
  }

  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatter.format(start)} - ${formatter.format(end)}`
}

function getEffectiveStatus(job: JobRow): JobStatus {
  if (job.job_status !== 'realizace' && job.job_status !== 'ukoncena') {
    return job.job_status
  }
  const endAt = new Date(job.end_at)
  if (Number.isNaN(endAt.getTime())) return job.job_status
  return endAt.getTime() < Date.now() ? 'ukoncena' : 'realizace'
}

function statusMeta(status: JobStatus) {
  if (status === 'nova') return { label: 'NOVÁ', style: styles.statusNova }
  if (status === 'k_reseni') return { label: 'V ŘEŠENÍ', style: styles.statusKReseni }
  if (status === 'realizace') return { label: 'REALIZACE', style: styles.statusRealizace }
  if (status === 'storno') return { label: 'STORNO', style: styles.statusStorno }
  return { label: 'UKONČENÁ', style: styles.statusUkoncena }
}

function groupJobs(jobs: JobRow[]): DayGroup[] {
  return [...jobs]
    .sort((first, second) => {
      const dateDifference = new Date(first.start_at).getTime() - new Date(second.start_at).getTime()
      if (dateDifference !== 0) return dateDifference
      return first.job_number.localeCompare(second.job_number, 'cs', { numeric: true })
    })
    .reduce<DayGroup[]>((groups, job) => {
      const key = getDayKey(job.start_at)
      const lastGroup = groups.at(-1)
      if (lastGroup?.key === key) {
        lastGroup.jobs.push(job)
      } else {
        groups.push({ key, label: formatDayLabel(job.start_at), jobs: [job] })
      }
      return groups
    }, [])
}

function ReportHeader({ input, count, generatedAt }: { input: ReportInput; count: number; generatedAt: Date }) {
  return h(View, { style: styles.fixedHeader, fixed: true }, [
    h(View, { key: 'main', style: styles.headerMain }, [
      h(View, { key: 'titles', style: styles.titleBlock }, [
        h(Text, { key: 'kicker', style: styles.kicker }, 'PROVOZNÍ PLÁN'),
        h(Text, { key: 'title', style: styles.title }, 'Plán zakázek'),
      ]),
      h(View, { key: 'logo-block', style: styles.logoBlock }, [
        h(Image, { key: 'logo', src: logoDataUri, style: styles.logo }),
      ]),
      h(View, { key: 'summary', style: styles.summary }, [
        h(Text, { key: 'period', style: styles.summaryTitle }, formatPeriod(input)),
        h(
          Text,
          { key: 'meta', style: styles.summaryMeta },
          `${formatCount(count)} · vytvořeno ${new Intl.DateTimeFormat('cs-CZ', {
            timeZone: PRAGUE_TIME_ZONE,
            dateStyle: 'short',
            timeStyle: 'short',
          }).format(generatedAt)}`
        ),
      ]),
    ]),
    h(View, { key: 'filters', style: styles.filterBar }, [
      h(Text, { key: 'status' }, [
        'Stav: ',
        h(Text, { key: 'value', style: styles.filterValue }, formatStatusFilter(input.status)),
      ]),
      h(Text, { key: 'view' }, [
        'Zobrazení: ',
        h(
          Text,
          { key: 'value', style: styles.filterValue },
          input.view === 'active' ? 'Pouze aktivní' : 'Všechny'
        ),
      ]),
      input.query
        ? h(Text, { key: 'query' }, [
            'Hledání: ',
            h(Text, { key: 'value', style: styles.filterValue }, input.query),
          ])
        : null,
    ]),
  ])
}

function JobRowView({ job, isLast }: { job: JobRow; isLast: boolean }) {
  const status = statusMeta(getEffectiveStatus(job))
  const cell = (key: string, value: string, width: string, strong = false) =>
    h(View, { key, style: [styles.cell, { width }] }, [
      h(
        Text,
        { key: 'text', style: strong ? [styles.valueText, styles.strong] : styles.valueText },
        value || '—'
      ),
    ])

  return h(View, { style: isLast ? [styles.row, styles.lastRow] : styles.row, wrap: false }, [
    h(View, {
      key: 'number',
      style: [styles.cell, styles.jobNumberCell, { width: columnWidths.number }],
    }, [
      h(Text, { key: 'value', style: [styles.valueText, styles.strong] }, job.job_number || '—'),
      job.pohotovost
        ? h(View, { key: 'standby', style: styles.standbyMarker }, [
            h(Text, { key: 'label', style: styles.standbyMarkerText }, 'P'),
          ])
        : null,
    ]),
    h(View, { key: 'company', style: [styles.cell, { width: columnWidths.company }] }, [
      h(
        Text,
        { key: 'text', style: [styles.companySingleLine, styles.valueText] },
        job.company_name || '—'
      ),
    ]),
    cell('term', formatTerm(job.start_at, job.end_at), columnWidths.term),
    cell('place', job.site_address ?? '—', columnWidths.place),
    cell('technician', job.technician_name ?? '—', columnWidths.technician, true),
    cell('generator', job.generator_name ?? '—', columnWidths.generator),
    h(View, { key: 'status', style: [styles.cell, { width: columnWidths.status }] }, [
      h(View, { key: 'badge', style: [styles.status, status.style] }, [
        h(Text, { key: 'value', style: styles.statusText }, status.label),
      ]),
    ]),
  ])
}

function DayBlock({ group }: { group: DayGroup }) {
  return h(Fragment, null, [
    // Direct page siblings keep column widths stable; presence ahead moves the first row with the separator.
    h(View, { key: 'header', style: [styles.dayBlock, styles.dayHeader], minPresenceAhead: 64 }, [
      h(Text, { key: 'label', style: styles.dayTitle }, group.label),
      h(Text, { key: 'count', style: styles.dayCount }, formatCount(group.jobs.length)),
    ]),
    ...group.jobs.map((job, index) =>
      h(JobRowView, { key: job.id, job, isLast: index === group.jobs.length - 1 })
    ),
  ])
}

function ReportDocument({ jobs, input, generatedAt }: { jobs: JobRow[]; input: ReportInput; generatedAt: Date }) {
  const groups = groupJobs(jobs)

  return h(Document, { title: 'Plán zakázek', author: 'B-ENERGY' }, [
    h(Page, { key: 'page', size: 'A4', orientation: 'landscape', style: styles.page, wrap: true }, [
      h(ReportHeader, { key: 'header', input, count: jobs.length, generatedAt }),
      ...(groups.length > 0
        ? groups.map((group) => h(DayBlock, { key: group.key, group }))
        : [h(Text, { key: 'empty', style: styles.empty }, 'Aktuálním filtrům neodpovídají žádné zakázky.')]),
      h(View, { key: 'footer', style: styles.footer, fixed: true }, [
        h(Text, { key: 'company' }, 'B-ENERGY · interní plánovací přehled'),
        h(Text, {
          key: 'page',
          render: ({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}`,
        }),
      ]),
    ]),
  ])
}

function fileName(input: ReportInput) {
  const range = input.dateFrom || input.dateTo
    ? `${input.dateFrom || 'zacatek'}-${input.dateTo || 'konec'}`
    : 'vse'
  return `plan-zakazek-${range}.pdf`
}

export async function GET(request: NextRequest) {
  const input = parseInput(request)
  if (typeof input === 'string') {
    return NextResponse.json({ error: input }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs, role, skryt_marny_vyjezd')
    .eq('id', user.id)
    .single()
  if (profileError) {
    return NextResponse.json({ error: 'Nepodařilo se ověřit oprávnění.' }, { status: 500 })
  }
  if (profile?.role !== 'admin' && !profile?.can_view_jobs) {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 })
  }

  let query = supabase
    .from('jobs')
    .select('id, job_number, company_name, start_at, end_at, site_address, technician_name, generator_name, marny_vyjezd, pohotovost, job_status')

  if (input.query) query = query.or(buildSearchFilter(input.query))
  if (input.status) query = query.eq('job_status', input.status)
  if (input.view === 'active') query = query.in('job_status', ['nova', 'k_reseni', 'realizace'])
  if (input.dateFrom && input.dateTo) {
    query = query
      .lte('start_at', `${input.dateTo}T23:59:59`)
      .gte('end_at', `${input.dateFrom}T00:00:00`)
  } else if (input.dateFrom) {
    query = query.gte('start_at', `${input.dateFrom}T00:00:00`)
  } else if (input.dateTo) {
    query = query.lte('start_at', `${input.dateTo}T23:59:59`)
  }

  const { data, error } = await query.order('start_at', { ascending: true })
  if (error) {
    return NextResponse.json({ error: 'Nepodařilo se načíst zakázky.' }, { status: 500 })
  }

  const jobs = ((data ?? []) as JobRow[]).filter(
    (job) => !profile?.skryt_marny_vyjezd || !job.marny_vyjezd
  )

  try {
    const generatedAt = new Date()
    const buffer = await renderToBuffer(ReportDocument({ jobs, input, generatedAt }))
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileName(input)}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('PDF plán zakázek se nepodařilo vytvořit.', error)
    return NextResponse.json({ error: 'PDF plán zakázek se nepodařilo vytvořit.' }, { status: 500 })
  }
}
