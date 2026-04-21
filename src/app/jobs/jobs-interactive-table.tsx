'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  updateJobEvidenceStatusAction,
  updateJobInfoAction,
  updateJobInlineFieldAction,
  updateJobStatusAction,
} from './actions'
import { EditJobButton } from './edit-job-button'
import { HandoverProtocolButton } from './handover-protocol-button'

type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

type EvidenceStatus = 'nove' | 'zapsano'
type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'

type ClientOption = {
  id: string
  name: string
}

type JobRow = {
  id: string
  job_number: string
  company_name: string
  client_id?: string | null
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  job_status: JobStatus
  evidence_status: EvidenceStatus
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
}

type InlineEditableField =
  | 'company_name'
  | 'contact_person'
  | 'start_at'
  | 'end_at'
  | 'site_address'
  | 'store_number'
  | 'technician_name'
  | 'generator_name'

type JobsInteractiveTableProps = {
  jobs: JobRow[]
  clientSuggestions: ClientOption[]
  isAdmin: boolean
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BUTTON_WIDTH_CLASS = 'min-w-[108px]'
const EVIDENCE_BUTTON_WIDTH_CLASS = 'min-w-[108px]'

function getEffectiveJobStatus(job: JobRow): JobStatus {
  if (job.job_status !== 'realizace' && job.job_status !== 'ukoncena') {
    return job.job_status
  }

  const endAt = new Date(job.end_at)

  if (Number.isNaN(endAt.getTime())) {
    return job.job_status
  }

  return endAt.getTime() < Date.now() ? 'ukoncena' : 'realizace'
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('cs')
}

export function JobsInteractiveTable({
  jobs,
  clientSuggestions,
  isAdmin,
}: JobsInteractiveTableProps) {
  return (
    <>
      <section className="print:block hidden rounded-3xl border border-gray-200 bg-white p-2 shadow-sm lg:block">
        <table className="w-full table-fixed border-separate border-spacing-y-2 print:border-collapse print:border-spacing-y-0">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500 print:text-[9px]">
              <th className="w-[76px] px-2 py-2 print:w-[70px] print:px-1.5 print:py-1.5">
                Zakázka
              </th>
              <th className="w-[112px] px-2 py-2 text-center print:hidden">
                Evidence
              </th>
              <th className="w-[120px] px-2 py-2 print:w-[130px] print:px-1.5 print:py-1.5">
                Firma
              </th>
              <th className="w-[94px] px-2 py-2 print:hidden">Osoba</th>
              <th className="w-[126px] px-2 py-2 print:w-[118px] print:px-1.5 print:py-1.5">
                Začátek
              </th>
              <th className="w-[126px] px-2 py-2 print:w-[118px] print:px-1.5 print:py-1.5">
                Konec
              </th>
              <th className="w-[144px] px-2 py-2 print:w-[150px] print:px-1.5 print:py-1.5">
                Adresa
              </th>
              <th className="w-[74px] px-2 py-2 print:hidden">Prodejna</th>
              <th className="w-[96px] px-2 py-2 print:w-[88px] print:px-1.5 print:py-1.5">
                Technik
              </th>
              <th className="w-[96px] px-2 py-2 print:w-[88px] print:px-1.5 print:py-1.5">
                Agregát
              </th>
              <th className="w-[128px] px-2 py-2 text-center print:hidden">
                Info
              </th>
              <th className="w-[112px] px-2 py-2 text-center print:w-[108px] print:px-1.5 print:py-1.5">
                Stav
              </th>
            </tr>
          </thead>

          <tbody>
            {jobs.map((job) => (
              <DesktopRow
                key={job.id}
                job={job}
                clientSuggestions={clientSuggestions}
                isAdmin={isAdmin}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 print:hidden lg:hidden">
        {jobs.map((job) => (
          <MobileCard
            key={job.id}
            job={job}
            clientSuggestions={clientSuggestions}
            isAdmin={isAdmin}
          />
        ))}
      </section>
    </>
  )
}

function DesktopRow({
  job,
  clientSuggestions,
  isAdmin,
}: {
  job: JobRow
  clientSuggestions: ClientOption[]
  isAdmin: boolean
}) {
  return (
    <tr className="group">
      <td className="rounded-l-2xl border border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:rounded-none print:border print:px-1.5 print:py-1.5">
        <EditJobButton
          job={job}
          clientSuggestions={clientSuggestions}
          isAdmin={isAdmin}
        >
          <span className="block truncate print:text-[11px]">
            {job.job_number}
          </span>
        </EditJobButton>
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:hidden">
        <EvidenceStatusButton job={job} canEdit />
      </td>

      <EditableCell
        job={job}
        field="company_name"
        value={job.company_name}
        canEdit={isAdmin}
        clientSuggestions={clientSuggestions}
      />
      <EditableCell
        job={job}
        field="contact_person"
        value={job.contact_person}
        printHidden
        canEdit={isAdmin}
      />
      <EditableCell
        job={job}
        field="start_at"
        value={job.start_at}
        type="datetime"
        canEdit={isAdmin}
      />
      <EditableCell
        job={job}
        field="end_at"
        value={job.end_at}
        type="datetime"
        canEdit={isAdmin}
      />
      <EditableCell
        job={job}
        field="site_address"
        value={job.site_address}
        canEdit={isAdmin}
      />
      <EditableCell
        job={job}
        field="store_number"
        value={job.store_number}
        printHidden
        canEdit={isAdmin}
      />
      <EditableCell
        job={job}
        field="technician_name"
        value={job.technician_name}
        canEdit
      />
      <EditableCell
        job={job}
        field="generator_name"
        value={job.generator_name}
        canEdit
      />

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:hidden">
        <div className="flex items-center justify-center gap-2">
          <HandoverProtocolButton job={job} />
          <InfoNoteButton job={job} compact canEdit />
        </div>
      </td>

      <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:rounded-none print:border print:px-1.5 print:py-1.5">
        <JobStatusButton job={job} canEdit />
      </td>
    </tr>
  )
}

function MobileCard({
  job,
  clientSuggestions,
  isAdmin,
}: {
  job: JobRow
  clientSuggestions: ClientOption[]
  isAdmin: boolean
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <EditJobButton
            job={job}
            clientSuggestions={clientSuggestions}
            className="text-sm font-semibold leading-tight text-gray-900 hover:underline"
            isAdmin={isAdmin}
          >
            {job.job_number}
          </EditJobButton>
          <p className="mt-0.5 truncate text-sm text-gray-700">
            {job.company_name}
          </p>
        </div>

        <JobStatusButton job={job} canEdit />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] leading-5 text-gray-600">
        <div className="min-w-0">
          <span className="font-medium text-gray-900">Začátek:</span>{' '}
          <span className="break-words">{formatDateTime(job.start_at)}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Konec:</span>{' '}
          <span className="break-words">{formatDateTime(job.end_at)}</span>
        </div>

        <div className="col-span-2 min-w-0">
          <span className="font-medium text-gray-900">Adresa:</span>{' '}
          <span className="break-words">{job.site_address || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Technik:</span>{' '}
          <span className="break-words">{job.technician_name || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Agregát:</span>{' '}
          <span className="break-words">{job.generator_name || '—'}</span>
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex items-center gap-2">
          <HandoverProtocolButton job={job} />
          <InfoNoteButton job={job} canEdit />
          <EvidenceStatusButton job={job} compact canEdit />
        </div>

        <MobileAssignmentButton job={job} canEdit />
      </div>
    </div>
  )
}

function MobileAssignmentButton({
  job,
  canEdit,
}: {
  job: JobRow
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [technicianValue, setTechnicianValue] = useState(job.technician_name ?? '')
  const [generatorValue, setGeneratorValue] = useState(job.generator_name ?? '')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setTechnicianValue(job.technician_name ?? '')
    setGeneratorValue(job.generator_name ?? '')
  }, [job.generator_name, job.technician_name])

  function saveAssignments() {
    if (!canEdit) {
      setIsOpen(false)
      return
    }

    const originalTechnician = job.technician_name ?? ''
    const originalGenerator = job.generator_name ?? ''

    if (
      technicianValue === originalTechnician &&
      generatorValue === originalGenerator
    ) {
      setIsOpen(false)
      return
    }

    startTransition(async () => {
      if (technicianValue !== originalTechnician) {
        const technicianFormData = new FormData()
        technicianFormData.set('field', 'technician_name')
        technicianFormData.set('value', technicianValue)

        const technicianResult = await updateJobInlineFieldAction(
          job.id,
          { success: false, error: null },
          technicianFormData
        )

        if (!technicianResult.success) {
          alert(technicianResult.error ?? 'Technika se nepodařilo uložit.')
          return
        }
      }

      if (generatorValue !== originalGenerator) {
        const generatorFormData = new FormData()
        generatorFormData.set('field', 'generator_name')
        generatorFormData.set('value', generatorValue)

        const generatorResult = await updateJobInlineFieldAction(
          job.id,
          { success: false, error: null },
          generatorFormData
        )

        if (!generatorResult.success) {
          alert(generatorResult.error ?? 'Agregát se nepodařilo uložit.')
          return
        }
      }

      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-8 min-w-[88px] items-center justify-center rounded-xl border border-orange-500 bg-white px-3 text-[11px] font-medium tracking-wide text-orange-600 transition hover:bg-orange-50"
      >
        UPRAVIT
      </button>

      {isOpen ? (
        <ModalShell
          title="UPRAVIT ZAKÁZKU"
          description={`ZAKÁZKA ${job.job_number.toUpperCase()}`}
          descriptionAsBadge
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Technik
              </span>
              <input
                type="text"
                value={technicianValue}
                disabled={isPending || !canEdit}
                onChange={(event) => setTechnicianValue(event.target.value)}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Agregát
              </span>
              <input
                type="text"
                value={generatorValue}
                disabled={isPending || !canEdit}
                onChange={(event) => setGeneratorValue(event.target.value)}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200 disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                ZRUŠIT
              </button>

              {canEdit ? (
                <button
                  type="button"
                  onClick={saveAssignments}
                  disabled={isPending}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'UKLÁDÁM…' : 'ULOŽIT'}
                </button>
              ) : null}
            </div>
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}

function EditableCell({
  job,
  field,
  value,
  type = 'text',
  printHidden = false,
  canEdit,
  clientSuggestions = [],
}: {
  job: JobRow
  field: InlineEditableField
  value: string | null
  type?: 'text' | 'datetime'
  printHidden?: boolean
  canEdit: boolean
  clientSuggestions?: ClientOption[]
}) {
  if (field === 'company_name') {
    return (
      <EditableCompanyCell
        job={job}
        value={value}
        printHidden={printHidden}
        canEdit={canEdit}
        clientSuggestions={clientSuggestions}
      />
    )
  }

  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(
    type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
  )
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraftValue(
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
    )
  }, [type, value])

  useEffect(() => {
    if (isEditing && canEdit) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing, canEdit])

  function cancelEditing() {
    setDraftValue(
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
    )
    setIsEditing(false)
  }

  function saveValue() {
    const originalValue =
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')

    if (draftValue === originalValue) {
      setIsEditing(false)
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', field)
      formData.set('value', draftValue)

      const result = await updateJobInlineFieldAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Změnu se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setIsEditing(false)
    })
  }

  const cellClassName = `border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:border print:px-1.5 print:py-1.5 ${
    printHidden ? 'print:hidden' : ''
  }`

  if (isEditing && canEdit) {
    return (
      <td
        className={`border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-1.5 align-middle ${
          printHidden ? 'print:hidden' : 'print:border print:px-1.5 print:py-1.5'
        }`}
      >
        <input
          ref={inputRef}
          type={type === 'datetime' ? 'datetime-local' : 'text'}
          value={draftValue}
          disabled={isPending}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={saveValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
        />
      </td>
    )
  }

  if (!canEdit) {
    const displayValue = type === 'datetime' ? formatDateTime(value) : value || '—'

    return (
      <td className={cellClassName}>
        <div
          className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]"
          title={displayValue}
        >
          <span className="block truncate">
            {displayValue}
          </span>
        </div>
      </td>
    )
  }

  const displayValue = type === 'datetime' ? formatDateTime(value) : value || '—'

  return (
    <td className={cellClassName}>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 transition hover:bg-black/[0.025] hover:text-gray-900 print:px-0 print:py-0 print:text-[11px] print:hover:bg-transparent"
        title={displayValue}
      >
        <span className="block truncate">
          {displayValue}
        </span>
      </button>
    </td>
  )
}

function EditableCompanyCell({
  job,
  value,
  printHidden = false,
  canEdit,
  clientSuggestions,
}: {
  job: JobRow
  value: string | null
  printHidden?: boolean
  canEdit: boolean
  clientSuggestions: ClientOption[]
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const companyOptions = useMemo(() => {
    const map = new Map<string, ClientOption>()

    clientSuggestions.forEach((client) => {
      const id = client.id.trim()
      const name = client.name.trim()

      if (!id || !name) return

      map.set(id, { id, name })
    })

    if (job.client_id && (value ?? '').trim()) {
      map.set(job.client_id, {
        id: job.client_id,
        name: (value ?? '').trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job.client_id, value])

  const [companyName, setCompanyName] = useState(value ?? '')
  const [selectedClientId, setSelectedClientId] = useState(job.client_id ?? '')

  useEffect(() => {
    setCompanyName(value ?? '')
    setSelectedClientId(job.client_id ?? '')
  }, [job.client_id, value])

  useEffect(() => {
    if (isEditing && canEdit) {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(companyName.length, companyName.length)
    }
  }, [canEdit, companyName.length, isEditing])

  const cellClassName = `border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70 print:border print:px-1.5 print:py-1.5 ${
    printHidden ? 'print:hidden' : ''
  }`

  const selectedClient =
    companyOptions.find((client) => client.id === selectedClientId) ?? null

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  function setAutocompleteSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(start, end)
    })
  }

  function handleCompanyChange(nextRawValue: string) {
    const trimmedValue = nextRawValue.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      return
    }

    const exactMatch =
      companyOptions.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      return
    }

    const prefixMatches = companyOptions.filter((client) =>
      normalizeSearchText(client.name).startsWith(normalizedValue)
    )

    if (prefixMatches.length === 1) {
      const matchedClient = prefixMatches[0]
      const completedName = matchedClient.name

      setCompanyName(completedName)
      setSelectedClientId(matchedClient.id)
      setAutocompleteSelection(nextRawValue.length, completedName.length)
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
  }

  function cancelEditing() {
    setCompanyName(value ?? '')
    setSelectedClientId(job.client_id ?? '')
    setIsEditing(false)
  }

  function saveValue() {
    const originalValue = value ?? ''
    const originalClientId = job.client_id ?? ''

    if (
      companyName === originalValue &&
      (selectedClientId ?? '') === originalClientId
    ) {
      setIsEditing(false)
      return
    }

    if (!companySelectionIsValid) {
      cancelEditing()
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', 'company_name')
      formData.set('value', companyName.trim())
      formData.set('client_id', selectedClientId)

      const result = await updateJobInlineFieldAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Firmu se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setIsEditing(false)
    })
  }

  const displayValue = value || '—'

  if (isEditing && canEdit) {
    return (
      <td
        className={`border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-1.5 align-middle ${
          printHidden ? 'print:hidden' : 'print:border print:px-1.5 print:py-1.5'
        }`}
      >
        <input
          ref={inputRef}
          type="text"
          value={companyName}
          disabled={isPending}
          onChange={(event) => handleCompanyChange(event.target.value)}
          onBlur={saveValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          autoComplete="off"
          className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
        />
      </td>
    )
  }

  if (!canEdit) {
    return (
      <td className={cellClassName}>
        <div
          className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]"
          title={displayValue}
        >
          <span className="block truncate">{displayValue}</span>
        </div>
      </td>
    )
  }

  return (
    <td className={cellClassName}>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 transition hover:bg-black/[0.025] hover:text-gray-900 print:px-0 print:py-0 print:text-[11px] print:hover:bg-transparent"
        title={displayValue}
      >
        <span className="block truncate">{displayValue}</span>
      </button>
    </td>
  )
}

function InfoNoteButton({
  job,
  compact = false,
  canEdit,
}: {
  job: JobRow
  compact?: boolean
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [draftValue, setDraftValue] = useState(job.info_note ?? '')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setDraftValue(job.info_note ?? '')
  }, [job.info_note])

  function saveInfo() {
    if (!canEdit) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('info_note', draftValue)

      const result = await updateJobInfoAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Info k zakázce se nepodařilo uložit.')
        return
      }

      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex h-8 items-center justify-center rounded-xl ${
          compact ? 'min-w-[78px]' : 'min-w-[78px]'
        } border px-3 text-[11px] font-medium tracking-wide transition ${
          job.info_note
            ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {job.info_note ? 'ZOBRAZIT' : canEdit ? 'PŘIDAT' : 'INFO'}
      </button>

      {isOpen ? (
        <ModalShell
          title="INFO K ZAKÁZCE"
          description={`ZAKÁZKA ${job.job_number}`}
          descriptionAsBadge
          showHeaderDivider={false}
          onClose={() => setIsOpen(false)}
        >
          {canEdit ? (
            <>
              <textarea
                value={draftValue}
                onChange={(event) => setDraftValue(event.target.value)}
                rows={5}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                placeholder="Doplň interní poznámku k zakázce"
              />

              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  ZRUŠIT
                </button>

                <button
                  type="button"
                  onClick={saveInfo}
                  disabled={isPending}
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'UKLÁDÁM…' : 'ULOŽIT'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-700">
                {job.info_note?.trim() ? job.info_note : 'Bez interní poznámky.'}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Zavřít
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      ) : null}
    </>
  )
}

function JobStatusButton({
  job,
  canEdit,
}: {
  job: JobRow
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getJobStatusMeta(getEffectiveJobStatus(job))

  const options: { value: JobStatus; label: string; className: string }[] = [
    getJobStatusMeta('nova'),
    getJobStatusMeta('k_reseni'),
    getJobStatusMeta('realizace'),
    getJobStatusMeta('ukoncena'),
    getJobStatusMeta('storno'),
  ]

  function saveStatus(nextStatus: JobStatus) {
    if (!canEdit) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('job_status', nextStatus)

      const result = await updateJobStatusAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Stav zakázky se nepodařilo uložit.')
        return
      }

      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition hover:opacity-95 print:min-w-0 print:px-2 print:text-[10px] ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <ModalShell
          title={canEdit ? 'Změnit stav zakázky' : 'Stav zakázky'}
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
          {canEdit ? (
            <div className="space-y-2">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isPending}
                  onClick={() => saveStatus(option.value)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span
                    className={`inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${option.className}`}
                  >
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                Aktuální stav:{' '}
                <span className="font-semibold text-gray-900">{meta.label}</span>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Zavřít
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      ) : null}
    </>
  )
}

function EvidenceStatusButton({
  job,
  compact = false,
  canEdit,
}: {
  job: JobRow
  compact?: boolean
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getEvidenceStatusMeta(job.evidence_status)

  const options: {
    value: EvidenceStatus
    label: string
    className: string
  }[] = [getEvidenceStatusMeta('nove'), getEvidenceStatusMeta('zapsano')]

  function saveEvidenceStatus(nextStatus: EvidenceStatus) {
    if (!canEdit) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('evidence_status', nextStatus)

      const result = await updateJobEvidenceStatusAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Stav evidence se nepodařilo uložit.')
        return
      }

      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex h-8 ${
          compact ? 'min-w-[96px]' : EVIDENCE_BUTTON_WIDTH_CLASS
        } max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition hover:opacity-95 ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <ModalShell
          title={canEdit ? 'Změnit stav evidence' : 'Stav evidence'}
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
          {canEdit ? (
            <div className="space-y-2">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={isPending}
                  onClick={() => saveEvidenceStatus(option.value)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium text-gray-900">
                    {option.label}
                  </span>
                  <span
                    className={`inline-flex h-8 ${EVIDENCE_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${option.className}`}
                  >
                    {option.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700">
                Aktuální stav evidence:{' '}
                <span className="font-semibold text-gray-900">{meta.label}</span>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Zavřít
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      ) : null}
    </>
  )
}

function ModalShell({
  title,
  description,
  descriptionAsBadge = false,
  showHeaderDivider = true,
  onClose,
  children,
}: {
  title: string
  description?: string
  descriptionAsBadge?: boolean
  showHeaderDivider?: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/45 p-3 sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
          <div
            className={`mb-4 flex items-start justify-between gap-4 ${
              showHeaderDivider ? 'border-b border-gray-100 pb-4' : ''
            }`}
          >
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              {description ? (
                descriptionAsBadge ? (
                  <div className="mt-1.5 inline-flex items-center rounded-full border border-[#2980B9] bg-[#2980B9] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white">
                    {description}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-500">{description}</p>
                )
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}

function getJobStatusMeta(status: JobStatus) {
  switch (status) {
    case 'nova':
      return {
        value: 'nova' as JobStatus,
        label: 'NOVÁ',
        className:
          'border border-blue-300 bg-blue-100 text-blue-800 shadow-sm',
      }
    case 'k_reseni':
      return {
        value: 'k_reseni' as JobStatus,
        label: 'V ŘEŠENÍ',
        className:
          'border border-amber-300 bg-amber-100 text-amber-800 shadow-sm',
      }
    case 'realizace':
      return {
        value: 'realizace' as JobStatus,
        label: 'REALIZACE',
        className:
          'border border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm',
      }
    case 'ukoncena':
      return {
        value: 'ukoncena' as JobStatus,
        label: 'UKONČENÁ',
        className:
          'border border-slate-300 bg-slate-100 text-slate-700 shadow-sm',
      }
    case 'storno':
      return {
        value: 'storno' as JobStatus,
        label: 'STORNO',
        className: 'border border-red-300 bg-red-100 text-red-800 shadow-sm',
      }
  }
}

function getEvidenceStatusMeta(status: EvidenceStatus) {
  switch (status) {
    case 'nove':
      return {
        value: 'nove' as EvidenceStatus,
        label: 'ZAPSAT',
        className:
          'border border-[#2980B9] bg-[#2980B9] text-white shadow-sm hover:bg-[#2471A3]',
      }
    case 'zapsano':
      return {
        value: 'zapsano' as EvidenceStatus,
        label: 'ZAPSÁNO',
        className:
          'border border-gray-300 bg-white text-gray-900 shadow-sm hover:bg-gray-50',
      }
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(value))
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}
