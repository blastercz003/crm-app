import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
} from '@/app/tasks/taskUi'
import {
  EditClientContactButton,
  NewClientContactButton,
} from '../client-contact-buttons'
import { ClientActivityTabs } from '../client-activity-tabs'
import { deleteClientContact, setPrimaryClientContact } from '../actions'
import { EditClientButton } from '../edit-client-button'

type ClientRow = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  note: string | null
  created_at: string
}

type ProfileRow = {
  role: string | null
  can_view_jobs: boolean | null
}

type ClientContactRow = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  role: string | null
  note: string | null
  is_primary: boolean
}

type ClientMeetingRow = {
  id: string
  title: string | null
  meeting_datetime: string | null
  status: 'planned' | 'completed'
  contact_person: string | null
  company_name: string | null
}

type ClientTaskRow = {
  id: string
  title: string
  note: string | null
  due_date: string | null
  status: string | null
  priority: string | null
  contact_person: string | null
  assigned_to: string | null
  assignee:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
}

type ClientOfferRow = {
  id: string
  offer_number: string
  title: string
  status: 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'ordered' | 'rejected'
  valid_until: string | null
  updated_at: string
}

type ClientJobRow = {
  id: string
  job_number: string
  contact_person: string | null
  sales_owner: 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function resolveAssigneeName(
  assignee:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
) {
  if (!assignee) return 'Nepřiřazeno'
  if (Array.isArray(assignee)) return assignee[0]?.name ?? 'Nepřiřazeno'
  return assignee.name ?? 'Nepřiřazeno'
}

function getTaskStatusLabel(status: string | null) {
  if (status === 'done') return 'Hotovo'
  return 'K vyřízení'
}

function getTaskStatusClass(status: string | null) {
  if (status === 'done') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-700'
}

function getOfferStatusLabel(status: ClientOfferRow['status']) {
  if (status === 'ordered') return 'Objednáno'
  if (status === 'rejected') return 'Zamítnuto'
  if (status === 'approved') return 'Schválená'
  if (status === 'submitted') return 'Ke schválení'
  if (status === 'changes_requested') return 'Vrácená'
  return 'Rozpracovaná'
}

function getOfferStatusClass(status: ClientOfferRow['status']) {
  if (status === 'ordered') return 'bg-green-600 text-white'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-700'
  if (status === 'submitted') return 'bg-[#2980B9]/10 text-[#236f9f]'
  if (status === 'changes_requested') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-600'
}

function getJobStatusLabel(status: ClientJobRow['job_status']) {
  if (status === 'k_reseni') return 'K řešení'
  if (status === 'realizace') return 'Realizace'
  if (status === 'ukoncena') return 'Ukončená'
  if (status === 'storno') return 'Storno'
  return 'Nová'
}

function getJobStatusClass(status: ClientJobRow['job_status']) {
  if (status === 'realizace') {
    return 'border border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm'
  }

  if (status === 'ukoncena') {
    return 'border border-slate-300 bg-slate-100 text-slate-700 shadow-sm'
  }

  if (status === 'storno') {
    return 'border border-red-300 bg-red-100 text-red-800 shadow-sm'
  }

  if (status === 'k_reseni') {
    return 'border border-amber-300 bg-amber-100 text-amber-800 shadow-sm'
  }

  return 'border border-blue-300 bg-blue-100 text-blue-800 shadow-sm'
}

function getInvoiceStatusLabel(status: ClientJobRow['invoice_status']) {
  if (status === 'k_fakturaci') return 'K fakturaci'
  if (status === 'vyfakturovano') return 'Vyfakturováno'
  return 'Bez faktury'
}

function renderMeetingsContent(meetings: ClientMeetingRow[]) {
  if (meetings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        Klient zatím nemá žádné schůzky.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {meetings.map((meeting) => (
        <Link
          key={meeting.id}
          href={`/meetings/${meeting.id}`}
          className="block min-h-[112px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {meeting.title || 'Bez názvu schůzky'}
              </p>

              <p className="mt-1 truncate text-sm text-gray-600">
                {meeting.contact_person ||
                  meeting.company_name ||
                  'Bez doplňujících údajů'}
              </p>

              <p className="mt-2 text-xs text-gray-500">
                {formatDateTime(meeting.meeting_datetime)}
              </p>
            </div>

            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                meeting.status === 'completed'
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              }`}
            >
              {meeting.status === 'completed' ? 'Dokončeno' : 'Plánováno'}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function renderTasksContent(tasks: ClientTaskRow[]) {
  if (tasks.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        Klient zatím nemá žádné úkoly.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <Link
          key={task.id}
          href={`/tasks/${task.id}/edit`}
          className="relative block min-h-[112px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
        >
          <div className="flex h-full min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0 pr-[178px] sm:flex-1 sm:pr-0">
              <p className="truncate text-sm font-medium text-gray-900">
                {task.title}
              </p>

              <p className="mt-1 truncate text-sm text-gray-600">
                {task.contact_person || 'Bez kontaktní osoby'}
              </p>

              {task.note ? (
                <p className="mt-2 line-clamp-1 text-xs leading-5 text-gray-500 sm:line-clamp-2">
                  {task.note}
                </p>
              ) : null}
            </div>

            <div className="absolute bottom-4 right-4 top-4 flex w-[170px] shrink-0 flex-col items-end justify-between gap-2 text-right sm:static sm:h-full sm:w-[265px]">
              <div className="flex w-full min-w-0 flex-nowrap justify-end gap-1.5 overflow-hidden">
                {task.priority ? (
                  <span
                    className={`inline-flex min-w-0 max-w-[108px] shrink items-center rounded-full px-2.5 py-1 text-xs font-medium sm:max-w-[155px] ${getPriorityBadgeClass(task.priority)}`}
                  >
                    <span className="truncate">
                      Priorita: {getPriorityLabel(task.priority)}
                    </span>
                  </span>
                ) : null}

                <span
                  className={`inline-flex min-w-0 max-w-[62px] shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium sm:max-w-[100px] ${getTaskStatusClass(task.status)}`}
                >
                  <span className="truncate">
                    {getTaskStatusLabel(task.status)}
                  </span>
                </span>
              </div>

              <div className="flex w-full min-w-0 flex-nowrap justify-end gap-2 overflow-hidden text-xs text-gray-500">
                <p className="max-w-[95px] truncate sm:max-w-none">
                  Termín: {task.due_date || 'Bez termínu'}
                </p>
                <p className="max-w-[64px] truncate sm:max-w-none">
                  Řeší: {resolveAssigneeName(task.assignee)}
                </p>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

function renderOffersContent(offers: ClientOfferRow[]) {
  if (offers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        Klient zatím nemá žádné nabídky.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {offers.map((offer) => (
        <Link
          key={offer.id}
          href={`/offers/${offer.id}`}
          className="block min-h-[112px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {offer.offer_number}
              </p>
              <p className="mt-1 truncate text-sm text-gray-600">
                {offer.title}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Platnost: {formatDate(offer.valid_until ?? offer.updated_at)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getOfferStatusClass(offer.status)}`}
            >
              {getOfferStatusLabel(offer.status)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

function renderJobsContent({
  jobs,
  canViewJobs,
}: {
  jobs: ClientJobRow[]
  canViewJobs: boolean
}) {
  if (!canViewJobs) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        Zakázky se zobrazují pouze uživatelům s oprávněním k zakázkám.
      </div>
    )
  }

  if (jobs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
        Klient zatím nemá žádné zakázky.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => (
        <Link
          key={job.id}
          href="/jobs"
          className="block min-h-[112px] overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">
                {job.job_number}
              </p>
              {job.site_address || job.store_number ? (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-500">
                  {[
                    job.site_address,
                    job.store_number ? `Prodejna ${job.store_number}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 overflow-hidden text-xs text-gray-500">
                <span className="truncate">
                  Začátek: {formatDateTime(job.start_at)}
                </span>
                <span className="truncate">
                  Konec: {formatDateTime(job.end_at)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 overflow-hidden text-xs text-gray-500">
                <span className="truncate">Obchodník: {job.sales_owner}</span>
                <span className="truncate">
                  Fakturace: {getInvoiceStatusLabel(job.invoice_status)}
                </span>
              </div>
            </div>

            <span
              className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getJobStatusClass(job.job_status)}`}
            >
              {getJobStatusLabel(job.job_status)}
            </span>
          </div>
        </Link>
      ))}
    </div>
  )
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_jobs')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfileRow | null
  const isAdmin = typedProfile?.role === 'admin'
  const canViewJobs = isAdmin || Boolean(typedProfile?.can_view_jobs)

  let clientRequest = supabase.from('clients').select('*').eq('id', id)

  if (!isAdmin) {
    clientRequest = clientRequest.eq('created_by', user.id)
  }

  const jobsRequest = canViewJobs
    ? supabase
        .from('jobs')
        .select(`
          id,
          job_number,
          contact_person,
          sales_owner,
          start_at,
          end_at,
          site_address,
          store_number,
          job_status,
          invoice_status
        `)
        .eq('client_id', id)
        .order('start_at', { ascending: false })
    : Promise.resolve({ data: [], error: null })

  const [
    clientResponse,
    contactsResponse,
    meetingsResponse,
    tasksResponse,
    offersResponse,
    jobsResponse,
  ] = await Promise.all([
    clientRequest.single(),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, role, note, is_primary')
      .eq('client_id', id)
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('meetings')
      .select('id, title, meeting_datetime, status, contact_person, company_name')
      .eq('client_id', id)
      .order('meeting_datetime', { ascending: false }),
    supabase
      .from('tasks')
      .select(`
        id,
        title,
        note,
        due_date,
        status,
        priority,
        contact_person,
        assigned_to,
        assignee:assigned_to (
          id,
          name
        )
      `)
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('offers')
      .select('id, offer_number, title, status, valid_until, updated_at')
      .eq('client_id', id)
      .order('updated_at', { ascending: false }),
    jobsRequest,
  ])

  const { data: client, error: clientError } = clientResponse
  const { data: contacts, error: contactsError } = contactsResponse
  const { data: meetings, error: meetingsError } = meetingsResponse
  const { data: tasks, error: tasksError } = tasksResponse
  const { data: offers, error: offersError } = offersResponse
  const { data: jobs, error: jobsError } = jobsResponse

  if (clientError || !client) {
    notFound()
  }

  if (meetingsError) {
    throw new Error('Nepodařilo se načíst schůzky klienta.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klienta.')
  }

  if (tasksError) {
    throw new Error('Nepodařilo se načíst úkoly klienta.')
  }

  if (offersError) {
    throw new Error('Nepodařilo se načíst nabídky klienta.')
  }

  if (jobsError) {
    throw new Error('Nepodařilo se načíst zakázky klienta.')
  }

  const typedClient = client as ClientRow
  const typedContacts = (contacts ?? []) as ClientContactRow[]
  const typedMeetings = (meetings ?? []) as ClientMeetingRow[]
  const typedTasks = (tasks ?? []) as ClientTaskRow[]
  const typedOffers = (offers ?? []) as ClientOfferRow[]
  const typedJobs = (jobs ?? []) as ClientJobRow[]

  return (
    <main className="min-h-screen bg-gray-50">
      <style>
        {`
          @media (min-width: 1280px) {
            .client-detail-note {
              width: calc((min(100vw - 4rem, 1500px) - 20px) * 0.2957746479 - 24px);
            }
          }
        `}
      </style>

      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-5">
            <div className="flex gap-2 sm:hidden">
              <EditClientButton
                client={typedClient}
                label="UPRAVIT KLIENTA"
                canDeleteClient={isAdmin}
                className="inline-flex h-10 min-w-0 flex-1 shrink items-center justify-center whitespace-nowrap rounded-2xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              />

              <Link
                href="/clients"
                className="inline-flex h-10 min-w-0 flex-1 shrink items-center justify-center whitespace-nowrap rounded-2xl px-3 text-sm font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: '#2980B9' }}
              >
                ZPĚT NA KLIENTY
              </Link>
            </div>

            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                    {typedClient.name}
                  </h1>

                  {typedClient.ico ? (
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                      IČO: {typedClient.ico}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 grid gap-1.5 text-sm text-gray-600 xl:max-w-3xl">
                  <p className="min-w-0">
                    <span className="font-medium text-gray-900">Adresa:</span>{' '}
                    {typedClient.address || '—'}
                  </p>
                </div>

                <div className="client-detail-note mt-5 w-full">
                  <div className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                      Interní poznámka
                    </p>
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                      {typedClient.note || 'Zatím bez poznámky.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="hidden self-stretch flex-col items-end justify-between gap-3 sm:flex xl:w-[320px]">
                <div className="flex gap-2">
                  <EditClientButton
                    client={typedClient}
                    label="UPRAVIT KLIENTA"
                    canDeleteClient={isAdmin}
                    className="inline-flex h-10 min-w-0 shrink items-center justify-center whitespace-nowrap rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50 sm:w-[150px]"
                  />

                  <Link
                    href="/clients"
                    className="inline-flex h-10 min-w-0 shrink items-center justify-center whitespace-nowrap rounded-2xl px-4 text-sm font-medium text-white transition hover:opacity-90 sm:w-[150px]"
                    style={{ backgroundColor: '#2980B9' }}
                  >
                    ZPĚT NA KLIENTY
                  </Link>
                </div>

                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">Vytvořeno:</span>{' '}
                  {formatDate(typedClient.created_at)}
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.42fr)_minmax(0,1fr)]">
          <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Kontaktní osoby
                </h2>
              </div>

              <NewClientContactButton
                clientId={typedClient.id}
                hasContacts={typedContacts.length > 0}
                className="inline-flex h-10 w-[150px] shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-black px-4 text-sm font-medium text-white transition hover:bg-gray-800"
              />
            </div>

            {typedContacts.length === 0 ? (
              <div className="m-5 rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500 sm:m-6">
                Klient zatím nemá žádné kontaktní osoby.
              </div>
            ) : (
              <div className="grid gap-3 p-5 sm:p-6 lg:grid-cols-2 xl:grid-cols-1">
                {typedContacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex min-h-[168px] flex-col rounded-2xl border border-gray-200 bg-gray-50 p-3.5"
                  >
                    <div className="flex flex-1 flex-col">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-gray-900">
                            {contact.name}
                          </h3>

                          {contact.is_primary ? (
                            <span className="rounded-full bg-[#2980B9]/10 px-2.5 py-1 text-xs font-medium text-[#236f9f]">
                              Hlavní kontakt
                            </span>
                          ) : null}
                        </div>

                        {contact.role ? (
                          <p className="mt-1 text-sm text-gray-600">
                            {contact.role}
                          </p>
                        ) : null}
                      </div>

                      <div className="mt-2 grid gap-0.5 text-sm text-gray-600">
                        <p>Telefon: {contact.phone || '—'}</p>
                        <p className="break-all">E-mail: {contact.email || '—'}</p>
                        {contact.note ? (
                          <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-gray-500">
                            {contact.note}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-auto flex flex-wrap justify-end gap-2 pt-3">
                      {!contact.is_primary ? (
                        <form action={setPrimaryClientContact}>
                          <input type="hidden" name="id" value={contact.id} />
                          <input
                            type="hidden"
                            name="client_id"
                            value={typedClient.id}
                          />
                          <button
                            type="submit"
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 transition hover:bg-gray-100"
                          >
                            NASTAVIT HLAVNÍ
                          </button>
                        </form>
                      ) : null}

                      <EditClientContactButton contact={contact} />

                      <form action={deleteClientContact}>
                        <input type="hidden" name="id" value={contact.id} />
                        <input
                          type="hidden"
                          name="client_id"
                          value={typedClient.id}
                        />
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-50"
                        >
                          SMAZAT
                        </button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <ClientActivityTabs
            meetingsCount={typedMeetings.length}
            tasksCount={typedTasks.length}
            offersCount={typedOffers.length}
            jobsCount={canViewJobs ? typedJobs.length : 0}
            meetingsContent={renderMeetingsContent(typedMeetings)}
            tasksContent={renderTasksContent(typedTasks)}
            offersContent={renderOffersContent(typedOffers)}
            jobsContent={renderJobsContent({ jobs: typedJobs, canViewJobs })}
          />
        </div>
      </div>
    </main>
  )
}
