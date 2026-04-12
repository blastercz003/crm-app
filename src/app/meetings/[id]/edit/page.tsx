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

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              Upravit schůzku
            </h1>
            <p className="text-sm text-gray-500">
              Uprav schůzku a případně ji napoj na klienta z databáze.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <MeetingForm
            action={updateMeeting}
            submitLabel="Uložit změny"
            cancelHref="/meetings"
            initialValues={meeting as MeetingData}
            clients={(clients ?? []) as ClientOption[]}
          />

          <div className="mt-6 border-t border-gray-100 pt-6">
            <form action={deleteMeeting}>
              <input type="hidden" name="id" value={id} />
              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
              >
                Smazat schůzku
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  )
}