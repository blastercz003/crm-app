import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type SearchParams = {
  type?: string
  scope?: string
  q?: string
}

type ActivityPageProps = {
  searchParams?: Promise<SearchParams> | SearchParams
}

type CommentEntityType = 'meeting' | 'client' | 'task'

type ProfileRef = {
  id: string
  name: string | null
}

type CommentAuthor =
  | {
      name: string | null
    }
  | {
      name: string | null
    }[]
  | null

type CommentRow = {
  id: string
  content: string
  created_at: string
  entity_type: CommentEntityType
  entity_id: string
  user_id: string
  author: CommentAuthor
}

type MeetingRow = {
  id: string
  company_name: string | null
  contact_person: string | null
  title: string | null
}

type ClientRow = {
  id: string
  name: string
  contact_person: string | null
}

type TaskRow = {
  id: string
  title: string
  company_name: string | null
  contact_person: string | null
  meeting_id: string | null
  source: 'manual' | 'meeting' | null
}

type EnrichedComment = CommentRow & {
  authorName: string
  isOwnComment: boolean
  context: {
    title: string
    subtitle: string
    href: string
  }
}

function resolveAuthorName(author: CommentAuthor) {
  if (!author) return 'Uživatel'
  if (Array.isArray(author)) return author[0]?.name ?? 'Uživatel'
  return author.name ?? 'Uživatel'
}

function getRelativeTimeLabel(value: string) {
  const now = Date.now()
  const date = new Date(value).getTime()

  if (Number.isNaN(date)) {
    return 'Neznámý čas'
  }

  const diffInSeconds = Math.floor((now - date) / 1000)

  if (diffInSeconds < 10) return 'právě teď'
  if (diffInSeconds < 60) return `před ${diffInSeconds} s`

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes === 1) return 'před 1 min'
  if (diffInMinutes < 60) return `před ${diffInMinutes} min`

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours === 1) return 'před 1 h'
  if (diffInHours < 24) return `před ${diffInHours} h`

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays === 1) return 'včera'
  if (diffInDays < 5) return `před ${diffInDays} dny`

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getFullDateTimeLabel(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getEntityTypeLabel(entityType: CommentEntityType) {
  if (entityType === 'meeting') return 'Schůzka'
  if (entityType === 'client') return 'Klient'
  return 'Úkol'
}

function getEntityTypeBadgeClasses(entityType: CommentEntityType) {
  if (entityType === 'meeting') {
    return 'border-blue-200 bg-blue-50 text-blue-700'
  }

  if (entityType === 'client') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  }

  return 'border-amber-200 bg-amber-50 text-amber-700'
}

function getCommentCountLabel(count: number) {
  if (count === 1) return '1 aktivita'
  if (count >= 2 && count <= 4) return `${count} aktivity`
  return `${count} aktivit`
}

function normalizeTypeFilter(value: string | undefined): 'all' | CommentEntityType {
  if (value === 'meeting' || value === 'client' || value === 'task') {
    return value
  }

  return 'all'
}

function normalizeScopeFilter(value: string | undefined): 'all' | 'mine' {
  return value === 'mine' ? 'mine' : 'all'
}

function normalizeSearchQuery(value: string | undefined) {
  return String(value ?? '').trim()
}

function buildFilterHref(type: string, scope: string, q: string) {
  const params = new URLSearchParams()

  if (type !== 'all') {
    params.set('type', type)
  }

  if (scope !== 'all') {
    params.set('scope', scope)
  }

  if (q.trim()) {
    params.set('q', q.trim())
  }

  const query = params.toString()
  return query ? `/activity?${query}` : '/activity'
}

function buildMeetingMap(rows: MeetingRow[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

function buildClientMap(rows: ClientRow[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

function buildTaskMap(rows: TaskRow[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

function resolveContext(
  comment: CommentRow,
  meetingMap: Map<string, MeetingRow>,
  clientMap: Map<string, ClientRow>,
  taskMap: Map<string, TaskRow>
) {
  if (comment.entity_type === 'meeting') {
    const meeting = meetingMap.get(comment.entity_id)

    return {
      title:
        meeting?.company_name?.trim() ||
        meeting?.title?.trim() ||
        'Schůzka bez názvu',
      subtitle: meeting?.contact_person?.trim() || 'Detail schůzky',
      href: `/meetings/${comment.entity_id}`,
    }
  }

  if (comment.entity_type === 'client') {
    const client = clientMap.get(comment.entity_id)

    return {
      title: client?.name?.trim() || 'Klient bez názvu',
      subtitle: client?.contact_person?.trim() || 'Detail klienta',
      href: `/clients/${comment.entity_id}`,
    }
  }

  const task = taskMap.get(comment.entity_id)

  return {
    title:
      task?.title?.trim() ||
      task?.company_name?.trim() ||
      'Úkol bez názvu',
    subtitle:
      task?.company_name?.trim() ||
      task?.contact_person?.trim() ||
      'Související úkol',
    href: task?.meeting_id ? `/meetings/${task.meeting_id}` : '/dashboard',
  }
}

function getPragueDateKey(value: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(new Date(value))
}

function getTodayPragueDateKey() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(new Date())
}

function shiftDateKey(dateKey: string, diffDays: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + diffDays)

  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')

  return `${yyyy}-${mm}-${dd}`
}

function getDayBucket(value: string) {
  const todayKey = getTodayPragueDateKey()
  const yesterdayKey = shiftDateKey(todayKey, -1)
  const valueKey = getPragueDateKey(value)

  if (valueKey === todayKey) return 'today'
  if (valueKey === yesterdayKey) return 'yesterday'
  return 'older'
}

function groupCommentsByDay(comments: EnrichedComment[]) {
  return {
    today: comments.filter((comment) => getDayBucket(comment.created_at) === 'today'),
    yesterday: comments.filter(
      (comment) => getDayBucket(comment.created_at) === 'yesterday'
    ),
    older: comments.filter((comment) => getDayBucket(comment.created_at) === 'older'),
  }
}

function matchesSearch(comment: EnrichedComment, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase('cs-CZ')

  if (!normalizedQuery) return true

  const haystack = [
    comment.content,
    comment.authorName,
    comment.context.title,
    comment.context.subtitle,
    getEntityTypeLabel(comment.entity_type),
  ]
    .join(' ')
    .toLocaleLowerCase('cs-CZ')

  return haystack.includes(normalizedQuery)
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={[
        'inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition',
        active
          ? 'bg-zinc-900 text-white shadow-sm'
          : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'blue' | 'emerald' | 'amber'
}) {
  const toneClasses =
    tone === 'blue'
      ? 'border-blue-200 bg-blue-50'
      : tone === 'emerald'
        ? 'border-emerald-200 bg-emerald-50'
        : tone === 'amber'
          ? 'border-amber-200 bg-amber-50'
          : 'border-zinc-200 bg-white'

  return (
    <div
      className={`min-w-[84px] rounded-2xl border px-3 py-2.5 shadow-sm ${toneClasses}`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold leading-none tracking-tight text-zinc-950">
        {value}
      </div>
    </div>
  )
}

function InfoChip({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
      {label}
    </div>
  )
}

function SearchInput({
  defaultValue,
  typeFilter,
  scopeFilter,
}: {
  defaultValue: string
  typeFilter: 'all' | CommentEntityType
  scopeFilter: 'all' | 'mine'
}) {
  return (
    <form method="get" className="w-full">
      <input type="hidden" name="type" value={typeFilter} />
      <input type="hidden" name="scope" value={scopeFilter} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          name="q"
          defaultValue={defaultValue}
          placeholder="Hledat podle firmy, osoby, autora nebo textu komentáře…"
          className="h-12 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400"
        />

        <div className="flex gap-2">
          <button
            type="submit"
            className="inline-flex h-12 items-center justify-center rounded-2xl bg-zinc-900 px-5 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
          >
            Hledat
          </button>

          <Link
            href={buildFilterHref(typeFilter, scopeFilter, '')}
            className="inline-flex h-12 items-center justify-center rounded-2xl border border-zinc-300 bg-white px-5 text-sm font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
          >
            Vyčistit
          </Link>
        </div>
      </div>
    </form>
  )
}

function SectionHeader({
  eyebrow,
  title,
  count,
}: {
  eyebrow: string
  title: string
  count: number
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          {eyebrow}
        </div>
        <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">
          {title}
        </h3>
      </div>

      <span className="inline-flex min-w-9 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-600">
        {count}
      </span>
    </div>
  )
}

function CommentCard({
  comment,
}: {
  comment: EnrichedComment
}) {
  return (
    <article
      className={`rounded-2xl border bg-white p-3.5 transition ${
        comment.isOwnComment
          ? 'border-blue-200 shadow-sm'
          : 'border-zinc-200 hover:border-zinc-300'
      }`}
    >
      <div className="flex gap-3">
        <div
          className={`w-1 shrink-0 rounded-full ${
            comment.isOwnComment ? 'bg-blue-500' : 'bg-zinc-200'
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-zinc-950">
                  {comment.authorName}
                </p>

                {comment.isOwnComment ? (
                  <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    Ty
                  </span>
                ) : null}

                <span
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${getEntityTypeBadgeClasses(comment.entity_type)}`}
                >
                  {getEntityTypeLabel(comment.entity_type)}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span title={getFullDateTimeLabel(comment.created_at)}>
                  {getRelativeTimeLabel(comment.created_at)}
                </span>
                <span>•</span>
                <span className="font-medium text-zinc-700">{comment.context.title}</span>
                <span>•</span>
                <span>{comment.context.subtitle}</span>
              </div>

              <p className="mt-2.5 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-700">
                {comment.content}
              </p>
            </div>

            <div className="flex shrink-0 items-center">
              <Link
                href={comment.context.href}
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-4 py-2.5 text-xs font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                OTEVŘÍT DETAIL
              </Link>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function DaySection({
  eyebrow,
  title,
  comments,
}: {
  eyebrow: string
  title: string
  comments: EnrichedComment[]
}) {
  if (comments.length === 0) return null

  return (
    <section>
      <SectionHeader eyebrow={eyebrow} title={title} count={comments.length} />

      <div className="space-y-2.5">
        {comments.map((comment) => (
          <CommentCard key={comment.id} comment={comment} />
        ))}
      </div>
    </section>
  )
}

export default async function ActivityPage({ searchParams }: ActivityPageProps) {
  const resolvedSearchParams =
    searchParams && typeof (searchParams as Promise<SearchParams>).then === 'function'
      ? await (searchParams as Promise<SearchParams>)
      : ((searchParams as SearchParams | undefined) ?? {})

  const typeFilter = normalizeTypeFilter(resolvedSearchParams.type)
  const scopeFilter = normalizeScopeFilter(resolvedSearchParams.scope)
  const searchQuery = normalizeSearchQuery(resolvedSearchParams.q)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single<ProfileRef & { role: string | null }>()

  if (profileError) {
    throw new Error(`Nepodařilo se načíst profil uživatele: ${profileError.message}`)
  }

  let commentsQuery = supabase
    .from('comments')
    .select(`
      id,
      content,
      created_at,
      entity_type,
      entity_id,
      user_id,
      author:profiles!comments_user_id_fkey (
        name
      )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (typeFilter !== 'all') {
    commentsQuery = commentsQuery.eq('entity_type', typeFilter)
  }

  if (scopeFilter === 'mine') {
    commentsQuery = commentsQuery.eq('user_id', user.id)
  }

  const { data: commentsData, error: commentsError } = await commentsQuery

  if (commentsError) {
    console.error('ActivityPage comments fetch error:', commentsError)
    throw new Error('Nepodařilo se načíst aktivitu týmu.')
  }

  const comments = (commentsData ?? []) as CommentRow[]

  const meetingIds = Array.from(
    new Set(
      comments
        .filter((comment) => comment.entity_type === 'meeting')
        .map((comment) => comment.entity_id)
    )
  )

  const clientIds = Array.from(
    new Set(
      comments
        .filter((comment) => comment.entity_type === 'client')
        .map((comment) => comment.entity_id)
    )
  )

  const taskIds = Array.from(
    new Set(
      comments
        .filter((comment) => comment.entity_type === 'task')
        .map((comment) => comment.entity_id)
    )
  )

  const [meetingsResult, clientsResult, tasksResult] = await Promise.all([
    meetingIds.length > 0
      ? supabase
          .from('meetings')
          .select('id, company_name, contact_person, title')
          .in('id', meetingIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length > 0
      ? supabase
          .from('clients')
          .select('id, name, contact_person')
          .in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    taskIds.length > 0
      ? supabase
          .from('tasks')
          .select('id, title, company_name, contact_person, meeting_id, source')
          .in('id', taskIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (meetingsResult.error) {
    console.error('ActivityPage meetings fetch error:', meetingsResult.error)
    throw new Error('Nepodařilo se načíst související schůzky.')
  }

  if (clientsResult.error) {
    console.error('ActivityPage clients fetch error:', clientsResult.error)
    throw new Error('Nepodařilo se načíst související klienty.')
  }

  if (tasksResult.error) {
    console.error('ActivityPage tasks fetch error:', tasksResult.error)
    throw new Error('Nepodařilo se načíst související úkoly.')
  }

  const meetingMap = buildMeetingMap((meetingsResult.data ?? []) as MeetingRow[])
  const clientMap = buildClientMap((clientsResult.data ?? []) as ClientRow[])
  const taskMap = buildTaskMap((tasksResult.data ?? []) as TaskRow[])

  const enrichedComments: EnrichedComment[] = comments.map((comment) => ({
    ...comment,
    authorName: resolveAuthorName(comment.author),
    isOwnComment: comment.user_id === user.id,
    context: resolveContext(comment, meetingMap, clientMap, taskMap),
  }))

  const visibleComments = enrichedComments.filter((comment) =>
    matchesSearch(comment, searchQuery)
  )

  const groupedComments = groupCommentsByDay(visibleComments)

  const typeFilterLabel =
    typeFilter === 'all'
      ? 'Vše'
      : typeFilter === 'meeting'
        ? 'Schůzky'
        : typeFilter === 'client'
          ? 'Klienti'
          : 'Úkoly'

  const scopeFilterLabel = scopeFilter === 'mine' ? 'Moje komentáře' : 'Celý tým'

  const myVisibleCount = visibleComments.filter((comment) => comment.isOwnComment).length
  const todayVisibleCount = groupedComments.today.length
  const meetingVisibleCount = visibleComments.filter(
    (comment) => comment.entity_type === 'meeting'
  ).length
  const clientVisibleCount = visibleComments.filter(
    (comment) => comment.entity_type === 'client'
  ).length
  const taskVisibleCount = visibleComments.filter(
    (comment) => comment.entity_type === 'task'
  ).length

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Teamwork
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Aktivita týmu
              </h1>

              <p className="mt-2 text-sm text-zinc-500">
                Přehled posledních komentářů ze schůzek, klientů a úkolů na jednom místě.
              </p>
            </div>

            <div className="flex w-full max-w-full flex-col gap-3 lg:w-auto lg:items-end">
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
                >
                  ZPĚT NA DASHBOARD
                </Link>

                <Link
                  href="/activity"
                  className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
                >
                  OBNOVIT AKTIVITU
                </Link>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:justify-end">
                <StatCard label="Celkem" value={visibleComments.length} />
                <StatCard label="Moje" value={myVisibleCount} tone="blue" />
                <StatCard label="Dnes" value={todayVisibleCount} tone="emerald" />
                <StatCard label="Schůzky" value={meetingVisibleCount} tone="blue" />
                <StatCard label="Klienti" value={clientVisibleCount} tone="emerald" />
                <StatCard label="Úkoly" value={taskVisibleCount} tone="amber" />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="p-4 md:p-5">
            <div className="space-y-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  Typ aktivity
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterTab
                    href={buildFilterHref('all', scopeFilter, searchQuery)}
                    label="Vše"
                    active={typeFilter === 'all'}
                  />
                  <FilterTab
                    href={buildFilterHref('meeting', scopeFilter, searchQuery)}
                    label="Schůzky"
                    active={typeFilter === 'meeting'}
                  />
                  <FilterTab
                    href={buildFilterHref('client', scopeFilter, searchQuery)}
                    label="Klienti"
                    active={typeFilter === 'client'}
                  />
                  <FilterTab
                    href={buildFilterHref('task', scopeFilter, searchQuery)}
                    label="Úkoly"
                    active={typeFilter === 'task'}
                  />
                </div>
              </div>

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  Rozsah
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <FilterTab
                    href={buildFilterHref(typeFilter, 'all', searchQuery)}
                    label="Všichni"
                    active={scopeFilter === 'all'}
                  />
                  <FilterTab
                    href={buildFilterHref(typeFilter, 'mine', searchQuery)}
                    label="Moje"
                    active={scopeFilter === 'mine'}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <InfoChip label={`Typ: ${typeFilterLabel}`} />
                <InfoChip label={`Rozsah: ${scopeFilterLabel}`} />
                <InfoChip label={`Uživatel: ${profile?.name ?? user.email}`} />
                {searchQuery ? <InfoChip label={`Hledání: ${searchQuery}`} /> : null}
              </div>

              <SearchInput
                defaultValue={searchQuery}
                typeFilter={typeFilter}
                scopeFilter={scopeFilter}
              />
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Feed
              </div>
              <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-950 md:text-2xl">
                Poslední komentáře
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {visibleComments.length > 0
                  ? `Zobrazeno ${getCommentCountLabel(visibleComments.length)}.`
                  : 'Aktuálně tu není žádná aktivita pro zvolený filtr.'}
              </p>
            </div>

            <span className="inline-flex min-w-10 items-center justify-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-600">
              {visibleComments.length}
            </span>
          </div>

          {visibleComments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8">
              <p className="text-sm text-zinc-600">
                Pro zvolený filtr a hledání tu zatím nejsou žádné aktivity.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href="/activity"
                  className="inline-flex items-center rounded-2xl bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.08em] text-white transition hover:bg-zinc-800"
                >
                  ZOBRAZIT VŠE
                </Link>

                <Link
                  href={buildFilterHref(typeFilter, 'all', '')}
                  className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium uppercase tracking-[0.08em] text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
                >
                  VYČISTIT HLEDÁNÍ
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <DaySection
                eyebrow="Dnes"
                title="Dnešní aktivita"
                comments={groupedComments.today}
              />
              <DaySection
                eyebrow="Včera"
                title="Včerejší aktivita"
                comments={groupedComments.yesterday}
              />
              <DaySection
                eyebrow="Dříve"
                title="Starší aktivita"
                comments={groupedComments.older}
              />
            </div>
          )}
        </section>
      </div>
    </main>
  )
}