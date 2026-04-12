import Link from 'next/link'

type UserOption = {
  id: string
  name: string | null
  role: string | null
}

type ClientOption = {
  id: string
  name: string
}

type TaskFormValues = {
  title?: string | null
  note?: string | null
  due_date?: string | null
  status?: string | null
  priority?: string | null
  assigned_to?: string | null
  client_id?: string | null
  company_name?: string | null
  contact_person?: string | null
}

type TaskFormProps = {
  users: UserOption[]
  clients: ClientOption[]
  submitLabel: string
  cancelHref?: string
  action: (formData: FormData) => void | Promise<void>
  initialValues?: TaskFormValues
}

const inputClassName =
  'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200'

const labelClassName = 'mb-2 block text-sm font-medium text-gray-700'

export default function TaskForm({
  users,
  clients,
  submitLabel,
  cancelHref = '/tasks',
  action,
  initialValues,
}: TaskFormProps) {
  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="title" className={labelClassName}>
            Název úkolu
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={initialValues?.title ?? ''}
            className={inputClassName}
            placeholder="Např. Zavolat klientovi kvůli termínu schůzky"
          />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="client_id" className={labelClassName}>
            Klient z databáze
          </label>
          <select
            id="client_id"
            name="client_id"
            defaultValue={initialValues?.client_id ?? ''}
            className={inputClassName}
          >
            <option value="">Bez napojení na klienta</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-gray-500">
            Klient je volitelný. Úkol může fungovat i jako běžný interní úkol mezi uživateli.
          </p>
        </div>

        <div>
          <label htmlFor="company_name" className={labelClassName}>
            Firma
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            defaultValue={initialValues?.company_name ?? ''}
            className={inputClassName}
            placeholder="Např. ABC Stavby s.r.o."
          />
        </div>

        <div>
          <label htmlFor="contact_person" className={labelClassName}>
            Kontaktní osoba
          </label>
          <input
            id="contact_person"
            name="contact_person"
            type="text"
            defaultValue={initialValues?.contact_person ?? ''}
            className={inputClassName}
            placeholder="Např. Jan Novák"
          />
        </div>

        <div>
          <label htmlFor="assigned_to" className={labelClassName}>
            Přiřadit uživateli
          </label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={initialValues?.assigned_to ?? ''}
            className={inputClassName}
          >
            <option value="">Nepřiřazeno</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name ?? 'Uživatel bez jména'}
                {user.role ? ` (${user.role})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="due_date" className={labelClassName}>
            Termín
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initialValues?.due_date ?? ''}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="priority" className={labelClassName}>
            Priorita
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={initialValues?.priority ?? 'medium'}
            className={inputClassName}
          >
            <option value="low">Nízká</option>
            <option value="medium">Střední</option>
            <option value="high">Vysoká</option>
          </select>
        </div>

        <div>
          <label htmlFor="status" className={labelClassName}>
            Stav
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? 'todo'}
            className={inputClassName}
          >
            <option value="todo">K vyřízení</option>
            <option value="in_progress">Rozpracováno</option>
            <option value="done">Hotovo</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="note" className={labelClassName}>
            Poznámka
          </label>
          <textarea
            id="note"
            name="note"
            rows={6}
            defaultValue={initialValues?.note ?? ''}
            className={`${inputClassName} min-h-[220px] resize-y`}
            placeholder="Doplňující informace k úkolu"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-lg bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
        >
          {submitLabel}
        </button>

        <Link
          href={cancelHref}
          className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
        >
          Zrušit
        </Link>
      </div>
    </form>
  )
}