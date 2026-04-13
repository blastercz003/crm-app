'use client'

import Link from 'next/link'

type ClientOption = {
  id: string
  name: string
}

type MeetingFormValues = {
  id?: string
  client_id?: string | null
  company_name?: string | null
  contact_person?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  address?: string | null
  title?: string | null
  meeting_datetime?: string | null
  pre_meeting_note?: string | null
  result_note?: string | null
  follow_up_task?: string | null
  status?: 'planned' | 'completed'
}

type MeetingFormProps = {
  action: (formData: FormData) => void
  submitLabel: string
  cancelHref: string
  initialValues?: MeetingFormValues
  clients: ClientOption[]
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateTimeLocalInput(value?: string | null) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function MeetingForm({
  action,
  submitLabel,
  cancelHref,
  initialValues,
  clients,
}: MeetingFormProps) {
  return (
    <form action={action} className="space-y-6">
      {initialValues?.id ? (
        <input type="hidden" name="id" value={initialValues.id} />
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="client_id"
            className="text-sm font-medium text-gray-900"
          >
            Klient z databáze
          </label>
          <select
            id="client_id"
            name="client_id"
            defaultValue={initialValues?.client_id ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          >
            <option value="">Bez napojení na klienta</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500">
            Vyber existujícího klienta. Textová pole níže zatím zůstávají kvůli
            kompatibilitě starších schůzek.
          </p>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="company_name"
            className="text-sm font-medium text-gray-900"
          >
            Firma
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            defaultValue={initialValues?.company_name ?? ''}
            placeholder="Např. ABC Stavby s.r.o."
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_person"
            className="text-sm font-medium text-gray-900"
          >
            Kontaktní osoba
          </label>
          <input
            id="contact_person"
            name="contact_person"
            type="text"
            defaultValue={initialValues?.contact_person ?? ''}
            placeholder="Např. Jan Novák"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_phone"
            className="text-sm font-medium text-gray-900"
          >
            Telefon
          </label>
          <input
            id="contact_phone"
            name="contact_phone"
            type="text"
            defaultValue={initialValues?.contact_phone ?? ''}
            placeholder="Např. +420 777 123 456"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_email"
            className="text-sm font-medium text-gray-900"
          >
            E-mail
          </label>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            defaultValue={initialValues?.contact_email ?? ''}
            placeholder="Např. novak@firma.cz"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="address"
            className="text-sm font-medium text-gray-900"
          >
            Adresa
          </label>
          <input
            id="address"
            name="address"
            type="text"
            defaultValue={initialValues?.address ?? ''}
            placeholder="Např. Ulice 123, Praha"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="title"
            className="text-sm font-medium text-gray-900"
          >
            Název schůzky
          </label>
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={initialValues?.title ?? ''}
            placeholder="Např. Úvodní schůzka"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="meeting_datetime"
            className="text-sm font-medium text-gray-900"
          >
            Datum a čas
          </label>
          <input
            id="meeting_datetime"
            name="meeting_datetime"
            type="datetime-local"
            defaultValue={formatDateTimeLocalInput(initialValues?.meeting_datetime)}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="status"
            className="text-sm font-medium text-gray-900"
          >
            Stav
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? 'planned'}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          >
            <option value="planned">Plánovaná</option>
            <option value="completed">Dokončená</option>
          </select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="pre_meeting_note"
            className="text-sm font-medium text-gray-900"
          >
            Poznámka před schůzkou
          </label>
          <textarea
            id="pre_meeting_note"
            name="pre_meeting_note"
            rows={4}
            defaultValue={initialValues?.pre_meeting_note ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="result_note"
            className="text-sm font-medium text-gray-900"
          >
            Výsledek schůzky
          </label>
          <textarea
            id="result_note"
            name="result_note"
            rows={4}
            defaultValue={initialValues?.result_note ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="follow_up_task"
            className="text-sm font-medium text-gray-900"
          >
            Navazující úkol
          </label>
          <textarea
            id="follow_up_task"
            name="follow_up_task"
            rows={3}
            defaultValue={initialValues?.follow_up_task ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:justify-end">
        <Link
          href={cancelHref}
          className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Zrušit
        </Link>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}