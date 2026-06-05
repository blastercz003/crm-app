import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { joinTitleParts } from '@/lib/pageTitles'
import { updateMeeting, deleteMeeting } from '../../actions'
import { MeetingForm } from '@/components/meetings/meeting-form'

type MeetingData = {
  id: string
  client_id: string | null
  client_contact_id: string | null
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  title: string | null
  meeting_datetime: string | null
  pre_meeting_note: string | null
  result_note: string | null
  follow_up_task: string | null
  follow_up_task_note: string | null
  follow_up_task_priority: string | null
  follow_up_task_due_date: string | null
  status: 'planned' | 'completed'
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('meetings')
    .select('company_name, contact_person, title')
    .eq('id', id)
    .maybeSingle<Pick<MeetingData, 'company_name' | 'contact_person' | 'title'>>()

  const meetingTitle = joinTitleParts(
    data?.company_name,
    data?.contact_person,
    data?.title
  )

  return {
    title: meetingTitle ? `Upravit schůzku - ${meetingTitle}` : 'Upravit schůzku',
  }
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

export default async function EditMeetingPage({
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

  const [profileResponse, meetingResponse, clientsResponse, contactsResponse] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, role')
      .eq('id', user.id)
      .single(),
    supabase.from('meetings').select('*').eq('id', id).single(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  const { data: profile, error: profileError } = profileResponse
  const { data: meeting, error: meetingError } = meetingResponse
  const { data: clients, error: clientsError } = clientsResponse
  const { data: contacts, error: contactsError } = contactsResponse

  if (profileError || !profile) {
    notFound()
  }

  if (meetingError || !meeting) {
    notFound()
  }

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  const typedMeeting = meeting as MeetingData
  const meetingTitle =
    typedMeeting.title ?? typedMeeting.company_name ?? 'Upravit schůzku'
  const canDelete = profile.role === 'admin'

  return (
    <main className="meetings-page meetings-detail-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="meetings-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="meetings-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="meetings-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                {meetingTitle}
              </h1>
            </div>

            <div className="flex flex-row items-center gap-3 lg:justify-end">
              {canDelete ? (
                <form action={deleteMeeting} className="shrink-0">
                  <input type="hidden" name="id" value={id} />
                  <button
                    type="submit"
                    className="meetings-page__delete-button inline-flex items-center justify-center whitespace-nowrap rounded-2xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(220,38,38,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_28px_rgba(220,38,38,0.3)]"
                  >
                    SMAZAT SCHŮZKU
                  </button>
                </form>
              ) : null}

              <Link
                href={`/meetings/${id}`}
                className="meetings-page__detail-button inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                DETAIL SCHŮZKY
              </Link>

              <Link
                href="/meetings"
                className="clients-page__back-button meetings-page__back-button inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                ZPĚT NA SCHŮZKY
              </Link>
            </div>
          </div>
        </section>

        <section className="meetings-page__panel rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Úprava schůzky
            </h2>
          </div>

          <MeetingForm
            action={updateMeeting}
            submitLabel="ULOŽIT ZMĚNY"
            cancelHref={`/meetings/${id}`}
            cancelLabel="ZRUŠIT ÚPRAVY"
            initialValues={typedMeeting}
            clients={(clients ?? []) as ClientOption[]}
            contacts={(contacts ?? []) as ClientContactOption[]}
          />
        </section>
      </div>
    </main>
  )
}
