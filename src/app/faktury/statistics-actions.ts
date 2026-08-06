'use server'

import { reportActionError } from '@/lib/errors/reportActionError'
import { resolveCzechCityFromAddress } from '@/lib/czech-map/resolve-city'
import { querySupabaseInBatches } from '@/lib/supabase/query-in-batches'
import { createClient } from '@/lib/supabase/server'

export type FinanceStatisticsView = 'week' | 'month' | 'year'

export type FinanceStatisticsJob = {
  id: string
  jobNumber: string
  companyName: string
  startAt: string
  isWastedTrip: boolean
  kilometers: number
  hours: number
}

export type FinanceStatisticsTechnician = {
  id: string
  name: string
  jobCount: number
  wastedTripCount: number
  kilometers: number
  hours: number
  averageKilometersPerJob: number
  averageHoursPerJob: number
  jobs: FinanceStatisticsJob[]
}

export type FinanceStatisticsSalesOwner = {
  name: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  jobCount: number
  sale: number
  cost: number
  profit: number
  averageProfitPerJob: number
  profitMargin: number
  financialJobCount: number
}

export type FinanceStatisticsCustomer = {
  name: string
  jobCount: number
  sale: number
  cost: number
  profit: number
  financialJobCount: number
  averageProfitPerJob: number
  profitMargin: number
}

export type FinanceStatisticsGenerator = {
  name: string
  jobCount: number
  sale: number
  cost: number
  profit: number
  financialJobCount: number
  averageProfitPerJob: number
  profitMargin: number
}

export type FinanceStatisticsTrendPoint = {
  key: string
  label: string
  jobCount: number
  sale: number
  profit: number
}

export type FinanceStatisticsMapJob = {
  id: string
  companyName: string
  startAt: string
  latitude: number
  longitude: number
}

export type FinanceStatisticsPayload = {
  view: FinanceStatisticsView
  anchorDate: string
  period: {
    from: string
    to: string
    previousAnchor: string
    nextAnchor: string
  }
  summary: {
    jobCount: number
    wastedTripCount: number
    kilometers: number
    hours: number
    averageKilometersPerJob: number
    averageHoursPerJob: number
    sale: number
    cost: number
    profit: number
    financialJobCount: number
    standbyCount: number
  }
  technicians: FinanceStatisticsTechnician[]
  salesOwners: FinanceStatisticsSalesOwner[]
  customerSummary: {
    customerCount: number
    repeatCustomerCount: number
    averageJobsPerCustomer: number
    averageSalePerCustomer: number
    averageProfitPerCustomer: number
    topThreeSaleShare: number
  }
  customers: FinanceStatisticsCustomer[]
  generatorSummary: {
    generatorCount: number
    assignedJobCount: number
    unassignedJobCount: number
    assignmentRate: number
    averageJobsPerGenerator: number
    topThreeUsageShare: number
  }
  generators: FinanceStatisticsGenerator[]
  jobsWithoutGeneratorCount: number
  trend: FinanceStatisticsTrendPoint[]
  mapJobs: FinanceStatisticsMapJob[]
}

export type FinanceStatisticsActionResult =
  | {
      success: true
      payload: FinanceStatisticsPayload
    }
  | {
      success: false
      error: string
    }

type ProfileRoleRow = {
  role: string | null
}

type TechnicianProfileRow = {
  id: string
  name: string | null
}

type StatisticsFinanceRow = {
  id: string
  job_id: string
  sale_amount: number | string | null
  cost_amount: number | string | null
  job:
    | {
        id: string
        job_number: string
        company_name: string
        sales_owner: string
        start_at: string
        site_address: string | null
        marny_vyjezd: boolean | null
        pohotovost: boolean | null
        job_status: string
        generator_name: string | null
      }
    | {
        id: string
        job_number: string
        company_name: string
        sales_owner: string
        start_at: string
        site_address: string | null
        marny_vyjezd: boolean | null
        pohotovost: boolean | null
        job_status: string
        generator_name: string | null
      }[]
    | null
}

type StatisticsCostItemRow = {
  job_finance_id: string
  technician_id: string | null
  preset_key: string | null
  quantity: number | string | null
}

type CalendarDate = {
  year: number
  month: number
  day: number
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const STATISTICS_PRESET_KEYS = ['doprava', 'prace-technika'] as const
const SALES_OWNERS: FinanceStatisticsSalesOwner['name'][] = [
  'JIŘÍ',
  'MICHAL',
  'LÍDA',
]

function formatCalendarDate(value: CalendarDate) {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
}

function calendarDateFromUtcDate(value: Date): CalendarDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  }
}

function parseCalendarDate(value: string): CalendarDate | null {
  if (!DATE_PATTERN.test(value)) {
    return null
  }

  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return { year, month, day }
}

function shiftCalendarDate(value: CalendarDate, days: number) {
  return calendarDateFromUtcDate(
    new Date(Date.UTC(value.year, value.month - 1, value.day + days))
  )
}

function getPragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value),
    day: Number(parts.find((part) => part.type === 'day')?.value),
  }
}

function getPeriod(view: FinanceStatisticsView, anchor: CalendarDate) {
  if (view === 'week') {
    const anchorDate = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day))
    const isoDay = anchorDate.getUTCDay() || 7
    const from = shiftCalendarDate(anchor, 1 - isoDay)
    const toExclusive = shiftCalendarDate(from, 7)

    return {
      from,
      toExclusive,
      previousAnchor: shiftCalendarDate(anchor, -7),
      nextAnchor: shiftCalendarDate(anchor, 7),
    }
  }

  if (view === 'month') {
    const from = { year: anchor.year, month: anchor.month, day: 1 }
    const toExclusive = calendarDateFromUtcDate(
      new Date(Date.UTC(anchor.year, anchor.month, 1))
    )

    return {
      from,
      toExclusive,
      previousAnchor: calendarDateFromUtcDate(
        new Date(Date.UTC(anchor.year, anchor.month - 2, 1))
      ),
      nextAnchor: toExclusive,
    }
  }

  return {
    from: { year: anchor.year, month: 1, day: 1 },
    toExclusive: { year: anchor.year + 1, month: 1, day: 1 },
    previousAnchor: { year: anchor.year - 1, month: 1, day: 1 },
    nextAnchor: { year: anchor.year + 1, month: 1, day: 1 },
  }
}

function getPragueDateTimeParts(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value)

  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  }
}

function pragueMidnightToIso(value: CalendarDate) {
  const targetAsUtc = Date.UTC(value.year, value.month - 1, value.day)
  let candidate = targetAsUtc

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const represented = getPragueDateTimeParts(new Date(candidate))
    const representedAsUtc = Date.UTC(
      represented.year,
      represented.month - 1,
      represented.day,
      represented.hour,
      represented.minute,
      represented.second
    )

    candidate += targetAsUtc - representedAsUtc
  }

  return new Date(candidate).toISOString()
}

function normalizeQuantity(value: number | string | null) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeMoney(value: number | string | null) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeGroupKey(value: string) {
  return value.trim().toLocaleUpperCase('cs-CZ')
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100
}

function getAverage(total: number, count: number) {
  return count > 0 ? roundMetric(total / count) : 0
}

function getCalendarDayDifference(from: CalendarDate, to: CalendarDate) {
  const fromTime = Date.UTC(from.year, from.month - 1, from.day)
  const toTime = Date.UTC(to.year, to.month - 1, to.day)

  return Math.floor((toTime - fromTime) / 86_400_000)
}

function createTrendPoints(
  view: FinanceStatisticsView,
  period: ReturnType<typeof getPeriod>
): FinanceStatisticsTrendPoint[] {
  const emptyPoint = (key: string, label: string): FinanceStatisticsTrendPoint => ({
    key,
    label,
    jobCount: 0,
    sale: 0,
    profit: 0,
  })

  if (view === 'week') {
    const dayLabels = ['PO', 'ÚT', 'ST', 'ČT', 'PÁ', 'SO', 'NE']

    return dayLabels.map((label, index) => {
      const date = shiftCalendarDate(period.from, index)

      return emptyPoint(
        formatCalendarDate(date),
        `${label} ${date.day}.`
      )
    })
  }

  if (view === 'month') {
    const lastDay = shiftCalendarDate(period.toExclusive, -1).day
    const bucketCount = Math.ceil(lastDay / 7)

    return Array.from({ length: bucketCount }, (_, index) => {
      const fromDay = index * 7 + 1
      const toDay = Math.min(fromDay + 6, lastDay)

      return emptyPoint(
        `week-${index + 1}`,
        `${fromDay}.–${toDay}.`
      )
    })
  }

  const monthLabels = [
    'LED',
    'ÚNO',
    'BŘE',
    'DUB',
    'KVĚ',
    'ČVN',
    'ČVC',
    'SRP',
    'ZÁŘ',
    'ŘÍJ',
    'LIS',
    'PRO',
  ]

  return monthLabels.map((label, index) =>
    emptyPoint(`${period.from.year}-${index + 1}`, label)
  )
}

function getTrendPointIndex(
  view: FinanceStatisticsView,
  period: ReturnType<typeof getPeriod>,
  startAt: string
) {
  const date = getPragueDateTimeParts(new Date(startAt))

  if (view === 'week') {
    return getCalendarDayDifference(period.from, date)
  }

  if (view === 'month') {
    return Math.floor((date.day - 1) / 7)
  }

  return date.month - 1
}

function getJob(row: StatisticsFinanceRow) {
  return Array.isArray(row.job) ? row.job[0] ?? null : row.job
}

export async function getFinanceStatisticsAction(
  view: FinanceStatisticsView,
  anchorDate?: string
): Promise<FinanceStatisticsActionResult> {
  let currentUserId: string | null = null

  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    currentUserId = user?.id ?? null

    if (!user) {
      return { success: false, error: 'Neautorizovaný přístup.' }
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single<ProfileRoleRow>()

    if (profileError || profile?.role !== 'admin') {
      return { success: false, error: 'Statistiku může zobrazit pouze admin.' }
    }

    if (view !== 'week' && view !== 'month' && view !== 'year') {
      return { success: false, error: 'Vybrané období statistiky není platné.' }
    }

    const anchor = parseCalendarDate(String(anchorDate ?? '')) ?? getPragueToday()
    const period = getPeriod(view, anchor)
    const fromIso = pragueMidnightToIso(period.from)
    const toIso = pragueMidnightToIso(period.toExclusive)

    const [{ data: financeRows, error: financeError }, technicianResponse] =
      await Promise.all([
        supabase
          .from('job_finances')
          .select(
            `
              id,
              job_id,
              sale_amount,
              cost_amount,
              job:jobs!inner (
                id,
                job_number,
                company_name,
                sales_owner,
                start_at,
                site_address,
                marny_vyjezd,
                pohotovost,
                job_status,
                generator_name
              )
            `
          )
          .gte('job.start_at', fromIso)
          .lt('job.start_at', toIso)
          .neq('job.job_status', 'storno'),
        supabase
          .from('profiles')
          .select('id, name')
          .eq('can_be_assigned_as_technician', true)
          .order('name', { ascending: true }),
      ])

    if (financeError) {
      throw new Error('Nepodařilo se načíst zakázky pro statistiku.')
    }

    if (technicianResponse.error) {
      throw new Error('Nepodařilo se načíst techniky pro statistiku.')
    }

    const finances = (financeRows ?? []) as StatisticsFinanceRow[]
    const financeIds = finances.map((row) => row.id)
    const jobsByFinanceId = new Map(
      finances
        .map((row) => [row.id, getJob(row)] as const)
        .filter((entry): entry is [string, NonNullable<ReturnType<typeof getJob>>] =>
          Boolean(entry[1])
        )
    )

    let costItems: StatisticsCostItemRow[] = []

    if (financeIds.length > 0) {
      const { data, error } =
        await querySupabaseInBatches<StatisticsCostItemRow>({
          values: financeIds,
          batchSize: 75,
          queryBatch: (financeIdBatch) =>
            supabase
              .from('job_finance_cost_items')
              .select('job_finance_id, technician_id, preset_key, quantity')
              .in('job_finance_id', financeIdBatch)
              .in('preset_key', [...STATISTICS_PRESET_KEYS]),
        })

      if (error) {
        throw new Error('Nepodařilo se načíst výkony techniků pro statistiku.')
      }

      costItems = (data ?? []) as StatisticsCostItemRow[]
    }

    const techniciansById = new Map(
      ((technicianResponse.data ?? []) as TechnicianProfileRow[])
        .map((row) => ({ id: String(row.id), name: String(row.name ?? '').trim() }))
        .filter((row) => row.id && row.name)
        .map((row) => [row.id, row] as const)
    )

    const technicianStats = new Map<
      string,
      {
        id: string
        name: string
        jobNumbers: Set<string>
        wastedTripJobNumbers: Set<string>
        kilometers: number
        hours: number
        jobs: Map<string, FinanceStatisticsJob>
      }
    >()

    let totalKilometers = 0
    let totalHours = 0

    for (const item of costItems) {
      const quantity = normalizeQuantity(item.quantity)

      const technicianId = String(item.technician_id ?? '')
      const technician = techniciansById.get(technicianId)
      const job = jobsByFinanceId.get(item.job_finance_id)

      if (!technician || !job || quantity <= 0) {
        continue
      }

      const current = technicianStats.get(technicianId) ?? {
        id: technician.id,
        name: technician.name,
        jobNumbers: new Set<string>(),
        wastedTripJobNumbers: new Set<string>(),
        kilometers: 0,
        hours: 0,
        jobs: new Map<string, FinanceStatisticsJob>(),
      }
      const jobNumber = String(job.job_number ?? '').trim()
      const jobKey = jobNumber || String(job.id)
      const currentJob = current.jobs.get(jobKey) ?? {
        id: String(job.id),
        jobNumber,
        companyName: String(job.company_name ?? '').trim(),
        startAt: job.start_at,
        isWastedTrip: Boolean(job.marny_vyjezd),
        kilometers: 0,
        hours: 0,
      }

      current.jobNumbers.add(jobKey)

      if (job.marny_vyjezd) {
        current.wastedTripJobNumbers.add(jobKey)
      }

      if (item.preset_key === 'doprava') {
        current.kilometers += quantity
        currentJob.kilometers += quantity
        totalKilometers += quantity
      }

      if (item.preset_key === 'prace-technika') {
        current.hours += quantity
        currentJob.hours += quantity
        totalHours += quantity
      }

      current.jobs.set(jobKey, currentJob)
      technicianStats.set(technicianId, current)
    }

    const uniqueJobs = new Map<
      string,
      {
        job: NonNullable<ReturnType<typeof getJob>>
        finance: StatisticsFinanceRow
      }
    >()

    for (const row of finances) {
      const job = getJob(row)

      if (!job) continue

      const jobNumber = String(job.job_number ?? '').trim()
      uniqueJobs.set(jobNumber || String(job.id), { job, finance: row })
    }

    const jobCount = uniqueJobs.size
    const uniqueJobEntries = Array.from(uniqueJobs.values())
    const mapJobs = uniqueJobEntries.flatMap(({ job }) => {
      const city = resolveCzechCityFromAddress(job.site_address)

      if (!city) return []

      return [
        {
          id: String(job.id),
          companyName: String(job.company_name ?? '').trim(),
          startAt: job.start_at,
          latitude: city.latitude,
          longitude: city.longitude,
        },
      ]
    })
    const wastedTripCount = uniqueJobEntries.filter(({ job }) =>
      Boolean(job.marny_vyjezd)
    ).length
    const standbyCount = uniqueJobEntries.filter(({ job }) =>
      Boolean(job.pohotovost)
    ).length
    const salesOwnerStats = new Map<
      FinanceStatisticsSalesOwner['name'],
      Omit<FinanceStatisticsSalesOwner, 'averageProfitPerJob' | 'profitMargin'>
    >(
      SALES_OWNERS.map((name) => [
        name,
        {
          name,
          jobCount: 0,
          sale: 0,
          cost: 0,
          profit: 0,
          financialJobCount: 0,
        },
      ])
    )
    const customersByKey = new Map<
      string,
      Omit<FinanceStatisticsCustomer, 'averageProfitPerJob' | 'profitMargin'>
    >()
    const generatorsByKey = new Map<
      string,
      {
        name: string
        jobIds: Set<string>
        sale: number
        cost: number
        profit: number
        financialJobCount: number
      }
    >()
    let jobsWithoutGeneratorCount = 0
    let sale = 0
    let cost = 0
    let profit = 0
    let financialJobCount = 0
    const trend = createTrendPoints(view, period)

    for (const { job, finance } of uniqueJobEntries) {
      const jobKey = String(job.job_number ?? '').trim() || String(job.id)
      const owner = String(job.sales_owner ?? '').trim() as FinanceStatisticsSalesOwner['name']
      const ownerStats = salesOwnerStats.get(owner)
      const trendPoint = trend[getTrendPointIndex(view, period, job.start_at)]

      if (ownerStats) {
        ownerStats.jobCount += 1
      }

      if (trendPoint) {
        trendPoint.jobCount += 1
      }

      const saleAmount = normalizeMoney(finance.sale_amount)
      const costAmount = normalizeMoney(finance.cost_amount)
      const hasCompleteFinance = saleAmount !== null && costAmount !== null

      if (hasCompleteFinance) {
        sale += saleAmount
        cost += costAmount
        profit += saleAmount - costAmount
        financialJobCount += 1

        if (ownerStats) {
          ownerStats.sale += saleAmount
          ownerStats.cost += costAmount
          ownerStats.profit += saleAmount - costAmount
          ownerStats.financialJobCount += 1
        }

        if (trendPoint) {
          trendPoint.sale += saleAmount
          trendPoint.profit += saleAmount - costAmount
        }
      }

      const customerName = String(job.company_name ?? '').trim() || 'Bez zákazníka'
      const customerKey = normalizeGroupKey(customerName)
      const customer = customersByKey.get(customerKey) ?? {
        name: customerName,
        jobCount: 0,
        sale: 0,
        cost: 0,
        profit: 0,
        financialJobCount: 0,
      }

      customer.jobCount += 1

      if (hasCompleteFinance) {
        customer.sale += saleAmount
        customer.cost += costAmount
        customer.profit += saleAmount - costAmount
        customer.financialJobCount += 1
      }

      customersByKey.set(customerKey, customer)

      const generatorName = String(job.generator_name ?? '').trim()

      if (!generatorName) {
        jobsWithoutGeneratorCount += 1
      } else {
        const generatorKey = normalizeGroupKey(generatorName)
        const generator = generatorsByKey.get(generatorKey) ?? {
          name: generatorName,
          jobIds: new Set<string>(),
          sale: 0,
          cost: 0,
          profit: 0,
          financialJobCount: 0,
        }

        generator.jobIds.add(jobKey)

        if (hasCompleteFinance) {
          generator.sale += saleAmount
          generator.cost += costAmount
          generator.profit += saleAmount - costAmount
          generator.financialJobCount += 1
        }

        generatorsByKey.set(generatorKey, generator)
      }
    }

    const salesOwners = SALES_OWNERS.map((name) => {
      const owner = salesOwnerStats.get(name)!

      return {
        ...owner,
        sale: roundMetric(owner.sale),
        cost: roundMetric(owner.cost),
        profit: roundMetric(owner.profit),
        averageProfitPerJob: getAverage(
          owner.profit,
          owner.financialJobCount
        ),
        profitMargin:
          owner.sale !== 0
            ? roundMetric((owner.profit / owner.sale) * 100)
            : 0,
      }
    })
    const customers = Array.from(customersByKey.values())
      .map((customer) => ({
        ...customer,
        sale: roundMetric(customer.sale),
        cost: roundMetric(customer.cost),
        profit: roundMetric(customer.profit),
        averageProfitPerJob: getAverage(
          customer.profit,
          customer.financialJobCount
        ),
        profitMargin:
          customer.sale !== 0
            ? roundMetric((customer.profit / customer.sale) * 100)
            : 0,
      }))
      .sort(
        (a, b) =>
          b.jobCount - a.jobCount ||
          b.sale - a.sale ||
          a.name.localeCompare(b.name, 'cs')
      )
    const customerCount = customers.length
    const repeatCustomerCount = customers.filter(
      (customer) => customer.jobCount > 1
    ).length
    const topThreeSale = [...customers]
      .sort((a, b) => b.sale - a.sale)
      .slice(0, 3)
      .reduce((sum, customer) => sum + customer.sale, 0)
    const customerSummary = {
      customerCount,
      repeatCustomerCount,
      averageJobsPerCustomer: getAverage(jobCount, customerCount),
      averageSalePerCustomer: getAverage(sale, customerCount),
      averageProfitPerCustomer: getAverage(profit, customerCount),
      topThreeSaleShare:
        sale > 0 ? roundMetric((topThreeSale / sale) * 100) : 0,
    }
    const generators = Array.from(generatorsByKey.values())
      .map((generator) => ({
        name: generator.name,
        jobCount: generator.jobIds.size,
        sale: roundMetric(generator.sale),
        cost: roundMetric(generator.cost),
        profit: roundMetric(generator.profit),
        financialJobCount: generator.financialJobCount,
        averageProfitPerJob: getAverage(
          generator.profit,
          generator.financialJobCount
        ),
        profitMargin:
          generator.sale !== 0
            ? roundMetric((generator.profit / generator.sale) * 100)
            : 0,
      }))
      .sort(
        (a, b) =>
          b.jobCount - a.jobCount || a.name.localeCompare(b.name, 'cs')
      )
    const assignedJobCount = Math.max(jobCount - jobsWithoutGeneratorCount, 0)
    const topThreeGeneratorJobs = generators
      .slice(0, 3)
      .reduce((sum, generator) => sum + generator.jobCount, 0)
    const generatorSummary = {
      generatorCount: generators.length,
      assignedJobCount,
      unassignedJobCount: jobsWithoutGeneratorCount,
      assignmentRate:
        jobCount > 0 ? roundMetric((assignedJobCount / jobCount) * 100) : 0,
      averageJobsPerGenerator: getAverage(
        assignedJobCount,
        generators.length
      ),
      topThreeUsageShare:
        assignedJobCount > 0
          ? roundMetric((topThreeGeneratorJobs / assignedJobCount) * 100)
          : 0,
    }
    const technicians = Array.from(technicianStats.values())
      .map((technician) => ({
        id: technician.id,
        name: technician.name,
        jobCount: technician.jobNumbers.size,
        wastedTripCount: technician.wastedTripJobNumbers.size,
        kilometers: roundMetric(technician.kilometers),
        hours: roundMetric(technician.hours),
        averageKilometersPerJob: getAverage(
          technician.kilometers,
          technician.jobNumbers.size
        ),
        averageHoursPerJob: getAverage(
          technician.hours,
          technician.jobNumbers.size
        ),
        jobs: Array.from(technician.jobs.values())
          .map((job) => ({
            ...job,
            kilometers: roundMetric(job.kilometers),
            hours: roundMetric(job.hours),
          }))
          .sort((a, b) => b.startAt.localeCompare(a.startAt)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'))

    return {
      success: true,
      payload: {
        view,
        anchorDate: formatCalendarDate(anchor),
        period: {
          from: formatCalendarDate(period.from),
          to: formatCalendarDate(shiftCalendarDate(period.toExclusive, -1)),
          previousAnchor: formatCalendarDate(period.previousAnchor),
          nextAnchor: formatCalendarDate(period.nextAnchor),
        },
        summary: {
          jobCount,
          wastedTripCount,
          kilometers: roundMetric(totalKilometers),
          hours: roundMetric(totalHours),
          averageKilometersPerJob: getAverage(totalKilometers, jobCount),
          averageHoursPerJob: getAverage(totalHours, jobCount),
          sale: roundMetric(sale),
          cost: roundMetric(cost),
          profit: roundMetric(profit),
          financialJobCount,
          standbyCount: roundMetric(standbyCount),
        },
        technicians,
        salesOwners,
        customerSummary,
        customers,
        generatorSummary,
        generators,
        jobsWithoutGeneratorCount,
        trend: trend.map((point) => ({
          ...point,
          sale: roundMetric(point.sale),
          profit: roundMetric(point.profit),
        })),
        mapJobs,
      },
    }
  } catch (error) {
    const { errorCode } = await reportActionError({
      error,
      action: 'getFinanceStatisticsAction',
      section: 'faktury',
      errorType: 'FinanceStatisticsError',
      userId: currentUserId,
      context: {
        view,
        anchorDate: String(anchorDate ?? ''),
      },
    })

    return {
      success: false,
      error: `Statistiku se nepodařilo načíst. (${errorCode})`,
    }
  }
}
