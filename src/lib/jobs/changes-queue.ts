import type { SupabaseClient } from '@supabase/supabase-js'

export type JobChangeKind = 'new_job' | 'updated_job'

export type QueueJobSnapshot = {
  id: string
  job_number: string | null
  start_at: string | null
}

export type ChangedValues = Record<string, string | null>

const FIELD_LABELS: Record<string, string> = {
  company_name: 'Firma',
  contact_person: 'Osoba',
  sales_owner: 'Obchodník',
  start_at: 'Začátek',
  end_at: 'Konec',
  site_address: 'Adresa',
  store_number: 'Prodejna',
  technician_name: 'Technik',
  generator_name: 'Agregát',
  info_note: 'Info',
  job_status: 'Stav zakázky',
  invoice_status: 'Fakturace',
}

const FIELD_ORDER = [
  'company_name',
  'contact_person',
  'sales_owner',
  'start_at',
  'end_at',
  'site_address',
  'store_number',
  'technician_name',
  'generator_name',
  'info_note',
  'job_status',
  'invoice_status',
] as const

function normalizeField(value: string) {
  return value.trim()
}

function getSortedFields(fields: string[]) {
  const incoming = new Set(fields.map(normalizeField).filter(Boolean))

  const ordered = FIELD_ORDER.filter((field) => incoming.has(field))
  const custom = Array.from(incoming)
    .filter((field) => !FIELD_ORDER.includes(field as (typeof FIELD_ORDER)[number]))
    .sort((a, b) => a.localeCompare(b, 'cs', { sensitivity: 'base' }))

  return [...ordered, ...custom]
}

function toFieldLabel(field: string) {
  return FIELD_LABELS[field] ?? field
}

function formatFieldValue(field: string, value: string | null) {
  if (!value) return '—'

  if (field === 'start_at' || field === 'end_at') {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    return new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'Europe/Prague',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return value
}

export function mergeChangedFields(previous: string[], next: string[]) {
  const merged = new Set<string>()

  previous.forEach((field) => {
    const normalized = normalizeField(field)
    if (normalized) merged.add(normalized)
  })

  next.forEach((field) => {
    const normalized = normalizeField(field)
    if (normalized) merged.add(normalized)
  })

  return getSortedFields(Array.from(merged))
}

export function buildChangedFieldsLabel(fields: string[]) {
  const normalized = getSortedFields(fields)
  if (normalized.length === 0) return ''

  return normalized.map(toFieldLabel).join(', ')
}

export function buildChangedValuesLabel({
  changedValues,
  orderedFields,
}: {
  changedValues: ChangedValues
  orderedFields: string[]
}) {
  const fields = getSortedFields(orderedFields)

  if (fields.length === 0) return ''

  return fields
    .map((field) => {
      const label = toFieldLabel(field)
      const value = formatFieldValue(field, changedValues[field] ?? null)
      return `${label}: ${value}`
    })
    .join(' · ')
}

export function mergeChangedValues({
  previous,
  next,
}: {
  previous: ChangedValues
  next: ChangedValues
}) {
  return {
    ...previous,
    ...next,
  }
}

export async function upsertJobChangeQueueEntry({
  supabase,
  job,
  kind,
  nextFields,
  nextValues = {},
}: {
  supabase: SupabaseClient
  job: QueueJobSnapshot
  kind: JobChangeKind
  nextFields: string[]
  nextValues?: ChangedValues
}) {
  const { data: existing, error: existingError } = await supabase
    .from('job_changes_queue')
    .select('changed_fields, changed_values')
    .eq('job_id', job.id)
    .maybeSingle()

  if (existingError) {
    throw new Error(`Nepodařilo se načíst změnovou frontu: ${existingError.message}`)
  }

  const previousFields = Array.isArray(existing?.changed_fields)
    ? (existing.changed_fields as string[])
    : []
  const previousValues =
    existing?.changed_values && typeof existing.changed_values === 'object'
      ? (existing.changed_values as ChangedValues)
      : {}

  const mergedFields = kind === 'updated_job'
    ? mergeChangedFields(previousFields, nextFields)
    : []
  const mergedValues = kind === 'updated_job'
    ? mergeChangedValues({
        previous: previousValues,
        next: nextValues,
      })
    : {}

  const changedFieldsLabel = kind === 'updated_job'
    ? buildChangedValuesLabel({
        changedValues: mergedValues,
        orderedFields: mergedFields,
      })
    : ''

  let { error: upsertError } = await supabase.from('job_changes_queue').upsert(
    {
      job_id: job.id,
      kind,
      changed_fields: mergedFields,
      changed_values: mergedValues,
      changed_fields_label: changedFieldsLabel,
      job_start_at: job.start_at,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'job_id',
    }
  )

  if (
    upsertError?.message &&
    upsertError.message.toLowerCase().includes('changed_values') &&
    upsertError.message.toLowerCase().includes('column')
  ) {
    const fallback = await supabase.from('job_changes_queue').upsert(
      {
        job_id: job.id,
        kind,
        changed_fields: mergedFields,
        changed_fields_label: kind === 'updated_job' ? buildChangedFieldsLabel(mergedFields) : '',
        job_start_at: job.start_at,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'job_id',
      }
    )
    upsertError = fallback.error
  }

  if (upsertError) {
    throw new Error(`Nepodařilo se uložit změnu do fronty: ${upsertError.message}`)
  }
}
