import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateMeeting, deleteMeeting } from '../../actions'
import { MeetingForm } from '@/components/meetings/meeting-form'

type MeetingData = {
  id: string
  client_id: string | null
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
  status: 'planned' | 'completed'
}

type ClientOption = {
  id: string
  name: string
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

  const [meetingResponse, clientsResponse] = await Promise.all([
    supabase.from('meetings').select('*').eq('id', id).single(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
  ])

  const { data: meeting, error: meetingError } = meetingResponse
  const { data: clients, error: clientsError } = clientsResponse

  if (meetingError || !meeting) {
    notFound()
  }

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  const typedMeeting = meeting as MeetingData
  const meetingTitle =
    typedMeeting.title ?? typedMeeting.company_name ?? 'Upravit schůzku'

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                {meetingTitle}
              </h1>
              <p className="text-sm text-gray-500">
                Uprav detaily schůzky a případně ji napoj na klienta z databáze.
              </p>
            </div>

            <div className="flex flex-row items-center gap-3 lg:justify-end">
              <form action={deleteMeeting} className="shrink-0">
                <input type="hidden" name="id" value={id} />
                <button
                  type="submit"
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-red-700 transition hover:bg-red-100"
                >
                  SMAZAT SCHŮZKU
                </button>
              </form>

              <Link
                href={`/meetings/${id}`}
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
              >
                DETAIL SCHŮZKY
              </Link>

              <Link
                href="/meetings"
                className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-2xl px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:opacity-90"
                style={{ backgroundColor: '#2980B9' }}
              >
                ZPĚT NA SCHŮZKY
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Úprava schůzky
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Změň kontaktní údaje, termín, obsah schůzky i navazující výstup.
            </p>
          </div>

          <MeetingForm
            action={updateMeeting}
            submitLabel="ULOŽIT ZMĚNY"
            cancelHref={`/meetings/${id}`}
            cancelLabel="ZRUŠIT ÚPRAVY"
            initialValues={typedMeeting}
            clients={(clients ?? []) as ClientOption[]}
          />
        </section>
      </div>
    </main>
  )
}
