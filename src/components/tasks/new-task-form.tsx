type UserOption = {
  id: string
  name: string | null
  email?: string | null
}

type Props = {
  action: (formData: FormData) => void | Promise<void>
  users: UserOption[]
  currentUserId: string
}

function getUserLabel(user: UserOption) {
  return user.name?.trim() || user.email?.trim() || user.id
}

export function NewTaskForm({ action, users, currentUserId }: Props) {
  return (
    <form
      action={action}
      className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-900">Nový úkol</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Můžeš přidat vlastní úkol sobě nebo ho přiřadit kolegovi.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_220px_240px_auto]">
        <div>
          <label
            htmlFor="title"
            className="mb-1.5 block text-sm font-medium text-zinc-700"
          >
            Text úkolu
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            placeholder="Např. Poslat nabídku klientovi"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="company_name"
            className="mb-1.5 block text-sm font-medium text-zinc-700"
          >
            Firma
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            placeholder="Nepovinné"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="contact_person"
            className="mb-1.5 block text-sm font-medium text-zinc-700"
          >
            Kontaktní osoba
          </label>
          <input
            id="contact_person"
            name="contact_person"
            type="text"
            placeholder="Nepovinné"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="due_at"
            className="mb-1.5 block text-sm font-medium text-zinc-700"
          >
            Termín
          </label>
          <input
            id="due_at"
            name="due_at"
            type="datetime-local"
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
          />
        </div>

        <div>
          <label
            htmlFor="assigned_user_id"
            className="mb-1.5 block text-sm font-medium text-zinc-700"
          >
            Přiřadit uživateli
          </label>
          <select
            id="assigned_user_id"
            name="assigned_user_id"
            defaultValue={currentUserId}
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none transition focus:border-zinc-500"
          >
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {getUserLabel(user)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Přidat úkol
          </button>
        </div>
      </div>
    </form>
  )
}