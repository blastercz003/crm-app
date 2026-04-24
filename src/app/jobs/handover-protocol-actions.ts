'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
}

type JobProtocolRow = {
  id: string
  job_number: string
  site_address: string | null
  company_name: string
  client_id: string | null
  start_at: string | null
  end_at: string | null
}

type ClientDetailsRow = {
  id: string
  name: string | null
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
}

type HandoverProtocolRow = {
  id: string
  job_id: string
  handover_title: string | null
  handover_place: string | null
  contact_person: string | null
  contact_phone: string | null
  is_sent: boolean | null
}

type DeviceRow = {
  id: string
  handover_protocol_id: string
  sort_order: number
  device_name: string | null
  mth_start: string | null
  mth_end: string | null
}

type AccessoryRow = {
  id: string
  handover_protocol_id: string
  sort_order: number
  item_name: string | null
  issued_value: string | null
  returned_value: string | null
}

export type HandoverProtocolDeviceInput = {
  id?: string
  device_name: string
  mth_start: string
  mth_end: string
}

export type HandoverProtocolAccessoryInput = {
  id?: string
  item_name: string
  issued_value: string
  returned_value: string
}

export type HandoverProtocolDraftInput = {
  handover_title: string
  handover_place: string
  contact_person: string
  contact_phone: string
  is_sent: boolean
  devices: HandoverProtocolDeviceInput[]
  accessories: HandoverProtocolAccessoryInput[]
}

export type HandoverProtocolDraft = {
  id: string | null
  handover_title: string
  handover_place: string
  contact_person: string
  contact_phone: string
  is_sent: boolean
  devices: HandoverProtocolDeviceInput[]
  accessories: HandoverProtocolAccessoryInput[]
}

export type HandoverProtocolPreviewData = {
  job: {
    id: string
    job_number: string
    company_name: string
    site_address: string | null
    start_at: string | null
    end_at: string | null
  }
  client: {
    name: string
    ico: string | null
    contact_person: string | null
    contact_phone: string | null
    contact_email: string | null
    address: string | null
  }
  protocol: HandoverProtocolDraft
}

type ActionResult<T> = {
  success: boolean
  error: string | null
  data?: T
}

function trimText(value: string | null | undefined) {
  return (value ?? '').trim()
}

function isMissingIsSentColumnError(message: string | undefined) {
  if (!message) return false

  const normalized = message.toLowerCase()
  return normalized.includes('is_sent') && normalized.includes('column')
}

function sanitizeDraftInput(input: HandoverProtocolDraftInput, siteAddress: string | null) {
  return {
    handover_title: trimText(input.handover_title),
    handover_place: trimText(input.handover_place) || trimText(siteAddress),
    contact_person: trimText(input.contact_person),
    contact_phone: trimText(input.contact_phone),
    is_sent: Boolean(input.is_sent),
    devices: input.devices
      .map((device, index) => ({
        id: device.id,
        sort_order: index,
        device_name: trimText(device.device_name),
        mth_start: trimText(device.mth_start),
        mth_end: trimText(device.mth_end),
      }))
      .filter(
        (device) => device.device_name || device.mth_start || device.mth_end
      ),
    accessories: input.accessories
      .map((item, index) => ({
        id: item.id,
        sort_order: index,
        item_name: trimText(item.item_name),
        issued_value: trimText(item.issued_value),
        returned_value: trimText(item.returned_value),
      }))
      .filter(
        (item) => item.item_name || item.issued_value || item.returned_value
      ),
  }
}

async function requireJobsAccess() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      error: 'Nejsi přihlášený.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as ProfilePermissionRow | null

  if (!typedProfile?.can_view_jobs) {
    return {
      supabase,
      error: 'Nemáš oprávnění pro práci se zakázkami.',
    }
  }

  return {
    supabase,
    error: null,
  }
}

async function getJobBaseData(supabase: Awaited<ReturnType<typeof createClient>>, jobId: string) {
  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, job_number, site_address, company_name, client_id, start_at, end_at')
    .eq('id', jobId)
    .single()

  if (jobError || !job) {
    return {
      error: 'Zakázka nebyla nalezena.',
      job: null,
    }
  }

  return {
    error: null,
    job: job as JobProtocolRow,
  }
}

async function getProtocolDraftData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  job: JobProtocolRow
) {
  const protocolResponse = await supabase
    .from('handover_protocols')
    .select('id, job_id, handover_title, handover_place, contact_person, contact_phone, is_sent')
    .eq('job_id', job.id)
    .maybeSingle()

  let protocol = protocolResponse.data
  let protocolError = protocolResponse.error

  if (protocolError && isMissingIsSentColumnError(protocolError.message)) {
    const fallbackResponse = await supabase
      .from('handover_protocols')
      .select('id, job_id, handover_title, handover_place, contact_person, contact_phone')
      .eq('job_id', job.id)
      .maybeSingle()

    protocol = fallbackResponse.data
    protocolError = fallbackResponse.error
  }

  if (protocolError) {
    return {
      error: 'Nepodařilo se načíst předávací protokol.',
      protocol: null,
      devices: [] as DeviceRow[],
      accessories: [] as AccessoryRow[],
    }
  }

  if (!protocol) {
    return {
      error: null,
      protocol: null,
      devices: [] as DeviceRow[],
      accessories: [] as AccessoryRow[],
    }
  }

  const protocolId = (protocol as HandoverProtocolRow).id

  const [devicesResponse, accessoriesResponse] = await Promise.all([
    supabase
      .from('handover_protocol_devices')
      .select('id, handover_protocol_id, sort_order, device_name, mth_start, mth_end')
      .eq('handover_protocol_id', protocolId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('handover_protocol_accessories')
      .select('id, handover_protocol_id, sort_order, item_name, issued_value, returned_value')
      .eq('handover_protocol_id', protocolId)
      .order('sort_order', { ascending: true }),
  ])

  if (devicesResponse.error || accessoriesResponse.error) {
    return {
      error: 'Nepodařilo se načíst položky předávacího protokolu.',
      protocol: null,
      devices: [] as DeviceRow[],
      accessories: [] as AccessoryRow[],
    }
  }

  return {
    error: null,
    protocol: protocol as HandoverProtocolRow,
    devices: (devicesResponse.data ?? []) as DeviceRow[],
    accessories: (accessoriesResponse.data ?? []) as AccessoryRow[],
  }
}

function buildDraftFromRows(params: {
  job: JobProtocolRow
  protocol: HandoverProtocolRow | null
  devices: DeviceRow[]
  accessories: AccessoryRow[]
}): HandoverProtocolDraft {
  const { job, protocol, devices, accessories } = params

  return {
    id: protocol?.id ?? null,
    handover_title: protocol?.handover_title ?? '',
    handover_place: protocol?.handover_place ?? job.site_address ?? '',
    contact_person: protocol?.contact_person ?? '',
    contact_phone: protocol?.contact_phone ?? '',
    is_sent: protocol?.is_sent ?? false,
    devices: devices.map((device) => ({
      id: device.id,
      device_name: device.device_name ?? '',
      mth_start: device.mth_start ?? '',
      mth_end: device.mth_end ?? '',
    })),
    accessories: accessories.map((item) => ({
      id: item.id,
      item_name: item.item_name ?? '',
      issued_value: item.issued_value ?? '',
      returned_value: item.returned_value ?? '',
    })),
  }
}

export async function getHandoverProtocolDraftAction(
  jobId: string
): Promise<ActionResult<HandoverProtocolDraft>> {
  const { supabase, error: accessError } = await requireJobsAccess()

  if (accessError) {
    return {
      success: false,
      error: accessError,
    }
  }

  const { error: jobError, job } = await getJobBaseData(supabase, jobId)

  if (jobError || !job) {
    return {
      success: false,
      error: jobError,
    }
  }

  const protocolData = await getProtocolDraftData(supabase, job)

  if (protocolData.error) {
    return {
      success: false,
      error: protocolData.error,
    }
  }

  return {
    success: true,
    error: null,
    data: buildDraftFromRows({
      job,
      protocol: protocolData.protocol,
      devices: protocolData.devices,
      accessories: protocolData.accessories,
    }),
  }
}

export async function saveHandoverProtocolDraftAction(
  jobId: string,
  input: HandoverProtocolDraftInput
): Promise<ActionResult<{ protocolId: string }>> {
  const { supabase, error: accessError } = await requireJobsAccess()

  if (accessError) {
    return {
      success: false,
      error: accessError,
    }
  }

  const { error: jobError, job } = await getJobBaseData(supabase, jobId)

  if (jobError || !job) {
    return {
      success: false,
      error: jobError,
    }
  }

  const sanitized = sanitizeDraftInput(input, job.site_address)

  const protocolResponse = await supabase
    .from('handover_protocols')
    .upsert(
      {
        job_id: job.id,
        handover_title: sanitized.handover_title || null,
        handover_place: sanitized.handover_place || null,
        contact_person: sanitized.contact_person || null,
        contact_phone: sanitized.contact_phone || null,
        is_sent: sanitized.is_sent,
      },
      {
        onConflict: 'job_id',
      }
    )
    .select('id')
    .single()

  let protocol = protocolResponse.data
  let protocolError = protocolResponse.error

  if (protocolError && isMissingIsSentColumnError(protocolError.message)) {
    const fallbackResponse = await supabase
      .from('handover_protocols')
      .upsert(
        {
          job_id: job.id,
          handover_title: sanitized.handover_title || null,
          handover_place: sanitized.handover_place || null,
          contact_person: sanitized.contact_person || null,
          contact_phone: sanitized.contact_phone || null,
        },
        {
          onConflict: 'job_id',
        }
      )
      .select('id')
      .single()

    protocol = fallbackResponse.data
    protocolError = fallbackResponse.error
  }

  if (protocolError || !protocol) {
    return {
      success: false,
      error: 'Nepodařilo se uložit předávací protokol.',
    }
  }

  const protocolId = String(protocol.id)

  const [deleteDevicesResult, deleteAccessoriesResult] = await Promise.all([
    supabase
      .from('handover_protocol_devices')
      .delete()
      .eq('handover_protocol_id', protocolId),
    supabase
      .from('handover_protocol_accessories')
      .delete()
      .eq('handover_protocol_id', protocolId),
  ])

  if (deleteDevicesResult.error || deleteAccessoriesResult.error) {
    return {
      success: false,
      error: 'Nepodařilo se přepsat položky předávacího protokolu.',
    }
  }

  if (sanitized.devices.length > 0) {
    const { error } = await supabase.from('handover_protocol_devices').insert(
      sanitized.devices.map((device) => ({
        handover_protocol_id: protocolId,
        sort_order: device.sort_order,
        device_name: device.device_name || null,
        mth_start: device.mth_start || null,
        mth_end: device.mth_end || null,
      }))
    )

    if (error) {
      return {
        success: false,
        error: 'Nepodařilo se uložit zařízení předávacího protokolu.',
      }
    }
  }

  if (sanitized.accessories.length > 0) {
    const { error } = await supabase
      .from('handover_protocol_accessories')
      .insert(
        sanitized.accessories.map((item) => ({
          handover_protocol_id: protocolId,
          sort_order: item.sort_order,
          item_name: item.item_name || null,
          issued_value: item.issued_value || null,
          returned_value: item.returned_value || null,
        }))
      )

    if (error) {
      return {
        success: false,
        error: 'Nepodařilo se uložit příslušenství předávacího protokolu.',
      }
    }
  }

  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}/pp`)

  return {
    success: true,
    error: null,
    data: {
      protocolId,
    },
  }
}

export async function getHandoverProtocolPreviewData(
  jobId: string
): Promise<ActionResult<HandoverProtocolPreviewData>> {
  const { supabase, error: accessError } = await requireJobsAccess()

  if (accessError) {
    return {
      success: false,
      error: accessError,
    }
  }

  const { error: jobError, job } = await getJobBaseData(supabase, jobId)

  if (jobError || !job) {
    return {
      success: false,
      error: jobError,
    }
  }

  const protocolData = await getProtocolDraftData(supabase, job)

  if (protocolData.error) {
    return {
      success: false,
      error: protocolData.error,
    }
  }

  const clientResponse = job.client_id
    ? await supabase
        .from('clients')
        .select('id, name, ico, contact_person, contact_phone, contact_email, address')
        .eq('id', job.client_id)
        .maybeSingle()
    : { data: null, error: null }

  if (clientResponse.error) {
    return {
      success: false,
      error: 'Nepodařilo se načíst údaje klienta pro protokol.',
    }
  }

  const client = (clientResponse.data ?? null) as ClientDetailsRow | null

  return {
    success: true,
    error: null,
    data: {
      job: {
        id: job.id,
        job_number: job.job_number,
        company_name: job.company_name,
        site_address: job.site_address,
        start_at: job.start_at,
        end_at: job.end_at,
      },
      client: {
        name: client?.name ?? job.company_name,
        ico: client?.ico ?? null,
        contact_person: client?.contact_person ?? null,
        contact_phone: client?.contact_phone ?? null,
        contact_email: client?.contact_email ?? null,
        address: client?.address ?? job.site_address ?? null,
      },
      protocol: buildDraftFromRows({
        job,
        protocol: protocolData.protocol,
        devices: protocolData.devices,
        accessories: protocolData.accessories,
      }),
    },
  }
}
