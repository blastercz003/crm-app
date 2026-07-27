'use server'

import { createClient } from '@/lib/supabase/server'
import type {
  OfferProgressNoteRow,
  OfferRow,
} from '@/lib/offers/types'
import type { JobAttachment, JobAttachmentRow } from '@/lib/job-attachments'
import { mapJobAttachmentRow } from '@/lib/job-attachments'

const JOB_INFO_MEDIA_BUCKET = 'job-info-media'

type ProfileRoleRow = {
  role: string | null
}

type FinanceRow = {
  id: string
  job_id: string
  client_order_number: string | null
  invoice_number: string | null
  sale_amount: number | null
  cost_amount: number | null
}

type JobRow = {
  id: string
  job_number: string
  offer_id: string | null
  company_name: string
  sales_owner: string | null
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  info_alert_enabled: boolean | null
  marny_vyjezd: boolean | null
  job_status: string | null
  invoice_status: string | null
  evidence_status: string | null
  created_at: string
  updated_at: string
}

type JobTechnicianRow = {
  technician_id: string
  position: number | null
}

type ProfileNameRow = {
  id: string
  name: string | null
}

type FinanceCostRow = {
  id: string
  label: string
  supplier: string | null
  technician_id: string | null
  preset_key: string | null
  sort_order: number | null
  unit_price: number | string | null
  quantity: number | string | null
  line_total: number | string | null
}

type JobInfoAttachmentRow = {
  id: string
  job_id: string
  file_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
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

type HandoverDeviceRow = {
  id: string
  sort_order: number | null
  device_name: string | null
  mth_start: string | null
  mth_end: string | null
}

type HandoverAccessoryRow = {
  id: string
  sort_order: number | null
  item_name: string | null
  issued_value: string | null
  returned_value: string | null
}

type ProvizeRow = {
  id: string
  sales_owner: string
  base_profit_amount: number
  manual_profit_amount: number | null
  approved_for_payout: boolean
  approved_for_payout_at: string | null
  current_draft_batch_id: string | null
  confirmed_batch_id: string | null
  created_at: string
  updated_at: string
}

type OfferOrderFileRow = {
  id: string
  offer_id: string
  file_name: string
  mime_type: string
  file_size_bytes: number
  created_at: string
}

export type Job360Data = {
  finance: {
    id: string
    clientOrderNumber: string | null
    invoiceNumber: string | null
    saleAmount: number | null
    costAmount: number | null
    profitAmount: number | null
    marginPercent: number | null
  }
  job: {
    id: string
    jobNumber: string
    companyName: string
    salesOwner: string | null
    startAt: string
    endAt: string
    siteAddress: string | null
    storeNumber: string | null
    technicianName: string | null
    generatorName: string | null
    infoNote: string | null
    infoAlertEnabled: boolean
    wastedTrip: boolean
    jobStatus: string | null
    invoiceStatus: string | null
    evidenceStatus: string | null
    createdAt: string
    updatedAt: string
  }
  technicians: Array<{ id: string; name: string }>
  costs: Array<{
    id: string
    label: string
    supplier: string | null
    technicianName: string | null
    presetKey: string | null
    unitPrice: number
    quantity: number
    lineTotal: number
  }>
  commission: {
    salesOwner: string
    profitAmount: number
    commissionRate: number
    commissionAmount: number
    approvedForPayout: boolean
    approvedAt: string | null
    payoutState: 'paid' | 'draft' | 'unpaid'
  } | null
  offer: {
    details: OfferRow
    notes: Array<OfferProgressNoteRow & { authorName: string | null }>
    orderFiles: OfferOrderFileRow[]
  } | null
  protocol: {
    required: boolean
    details: HandoverProtocolRow | null
    devices: HandoverDeviceRow[]
    accessories: HandoverAccessoryRow[]
  }
  attachments: JobAttachment[]
  infoPhotos: Array<{
    id: string
    fileName: string
    mimeType: string
    sizeBytes: number
    createdAt: string
    signedUrl: string | null
  }>
}

export type LoadJob360ActionResult =
  | { success: true; data: Job360Data }
  | { success: false; error: string }

function optionalText(value: unknown) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function commissionRate(salesOwner: string) {
  const normalized = salesOwner.trim().toUpperCase()
  if (normalized === 'MICHAL') return 0.5
  if (normalized === 'LÍDA') return 0.2
  return 0
}

function getEffectiveJobStatus(status: string | null, endAt: string) {
  if (status !== 'realizace' && status !== 'ukoncena') {
    return status
  }

  const endDate = new Date(endAt)
  if (Number.isNaN(endDate.getTime())) {
    return status
  }

  return endDate.getTime() <= Date.now() ? 'ukoncena' : 'realizace'
}

function getEffectiveInvoiceStatus(
  storedStatus: string | null,
  invoiceNumber: string | null
) {
  const normalizedInvoiceNumber = String(invoiceNumber ?? '')
    .trim()
    .toUpperCase()

  if (
    normalizedInvoiceNumber.length > 0 &&
    normalizedInvoiceNumber !== 'STORNO'
  ) {
    return 'vyfakturovano'
  }

  if (normalizedInvoiceNumber === 'STORNO') {
    return 'bez_faktury'
  }

  return storedStatus === 'vyfakturovano' ? 'k_fakturaci' : storedStatus
}

function isMissingSupplierColumn(message: string | undefined) {
  return Boolean(message?.toLowerCase().includes('supplier'))
}

async function requireJob360Admin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, allowed: false, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error) {
    return {
      supabase,
      allowed: false,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  if ((profile as ProfileRoleRow | null)?.role !== 'admin') {
    return {
      supabase,
      allowed: false,
      error: 'Zakázka 360 je dostupná pouze administrátorovi.',
    }
  }

  return { supabase, allowed: true, error: null }
}

export async function getJob360Action(
  financeId: string
): Promise<LoadJob360ActionResult> {
  try {
    const access = await requireJob360Admin()
    if (!access.allowed) {
      return { success: false, error: access.error ?? 'Nemáš oprávnění.' }
    }

    const normalizedFinanceId = String(financeId ?? '').trim()
    if (!normalizedFinanceId) {
      return { success: false, error: 'Chybí ID finančního záznamu.' }
    }

    const { supabase } = access
    const { data: financeData, error: financeError } = await supabase
      .from('job_finances')
      .select(
        'id, job_id, client_order_number, invoice_number, sale_amount, cost_amount'
      )
      .eq('id', normalizedFinanceId)
      .single()

    if (financeError || !financeData) {
      return { success: false, error: 'Finanční záznam nebyl nalezen.' }
    }

    const finance = financeData as FinanceRow
    const { data: jobData, error: jobError } = await supabase
      .from('jobs')
      .select(
        'id, job_number, offer_id, company_name, sales_owner, start_at, end_at, site_address, store_number, technician_name, generator_name, info_note, info_alert_enabled, marny_vyjezd, job_status, invoice_status, evidence_status, created_at, updated_at'
      )
      .eq('id', finance.job_id)
      .single()

    if (jobError || !jobData) {
      return { success: false, error: 'Navázaná zakázka nebyla nalezena.' }
    }

    const job = jobData as JobRow
    const [
      techniciansResponse,
      initialCostsResponse,
      attachmentsResponse,
      infoPhotosResponse,
      ppRequirementResponse,
      protocolResponse,
      commissionResponse,
      offerResponse,
    ] = await Promise.all([
      supabase
        .from('job_technicians')
        .select('technician_id, position')
        .eq('job_id', job.id)
        .order('position', { ascending: true }),
      supabase
        .from('job_finance_cost_items')
        .select(
          'id, label, supplier, technician_id, preset_key, sort_order, unit_price, quantity, line_total'
        )
        .eq('job_finance_id', finance.id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('job_attachments')
        .select(
          'id, job_id, file_name, display_name, storage_bucket, storage_path, mime_type, file_size_bytes, category, note, uploaded_by, created_at'
        )
        .eq('job_id', job.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('job_info_attachments')
        .select('id, job_id, file_path, file_name, mime_type, size_bytes, created_at')
        .eq('job_id', job.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('job_pp_requirements')
        .select('job_id, pp_required')
        .eq('job_id', job.id)
        .maybeSingle(),
      supabase
        .from('handover_protocols')
        .select(
          'id, job_id, handover_title, handover_place, contact_person, contact_phone, is_sent'
        )
        .eq('job_id', job.id)
        .maybeSingle(),
      supabase
        .from('provize_records')
        .select(
          'id, sales_owner, base_profit_amount, manual_profit_amount, approved_for_payout, approved_for_payout_at, current_draft_batch_id, confirmed_batch_id, created_at, updated_at'
        )
        .eq('job_finance_id', finance.id)
        .maybeSingle(),
      job.offer_id
        ? supabase
            .from('offers')
            .select('*')
            .eq('id', job.offer_id)
            .eq('offer_type', 'classic')
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    const coreError =
      techniciansResponse.error ||
      attachmentsResponse.error ||
      infoPhotosResponse.error ||
      ppRequirementResponse.error ||
      protocolResponse.error ||
      commissionResponse.error ||
      offerResponse.error

    if (coreError) {
      return {
        success: false,
        error: 'Část podkladů Zakázky 360 se nepodařilo načíst.',
      }
    }

    let costsData = initialCostsResponse.data
    let costsError = initialCostsResponse.error
    if (costsError && isMissingSupplierColumn(costsError.message)) {
      const fallback = await supabase
        .from('job_finance_cost_items')
        .select(
          'id, label, technician_id, preset_key, sort_order, unit_price, quantity, line_total'
        )
        .eq('job_finance_id', finance.id)
        .order('sort_order', { ascending: true })

      costsData = (fallback.data ?? []).map((item) => ({
        ...item,
        supplier: null,
      }))
      costsError = fallback.error
    }

    if (costsError) {
      return { success: false, error: 'Nepodařilo se načíst nákladové položky.' }
    }

    const technicianRows = (techniciansResponse.data ?? []) as JobTechnicianRow[]
    const costRows = (costsData ?? []) as FinanceCostRow[]
    const profileIds = Array.from(
      new Set(
        [...technicianRows, ...costRows]
          .map((item) =>
            'technician_id' in item ? optionalText(item.technician_id) : null
          )
          .filter((id): id is string => Boolean(id))
      )
    )

    const profilesResponse =
      profileIds.length > 0
        ? await supabase.from('profiles').select('id, name').in('id', profileIds)
        : { data: [], error: null }

    if (profilesResponse.error) {
      return { success: false, error: 'Nepodařilo se načíst jména techniků.' }
    }

    const profileNameById = new Map(
      ((profilesResponse.data ?? []) as ProfileNameRow[]).map((profile) => [
        profile.id,
        optionalText(profile.name) ?? 'Neznámý technik',
      ])
    )

    const protocol = (protocolResponse.data as HandoverProtocolRow | null) ?? null
    const [devicesResponse, accessoriesResponse] = protocol
      ? await Promise.all([
          supabase
            .from('handover_protocol_devices')
            .select('id, sort_order, device_name, mth_start, mth_end')
            .eq('handover_protocol_id', protocol.id)
            .order('sort_order', { ascending: true }),
          supabase
            .from('handover_protocol_accessories')
            .select(
              'id, sort_order, item_name, issued_value, returned_value'
            )
            .eq('handover_protocol_id', protocol.id)
            .order('sort_order', { ascending: true }),
        ])
      : [
          { data: [] as HandoverDeviceRow[], error: null },
          { data: [] as HandoverAccessoryRow[], error: null },
        ]

    if (devicesResponse.error || accessoriesResponse.error) {
      return {
        success: false,
        error: 'Nepodařilo se načíst položky předávacího protokolu.',
      }
    }

    const offer = (offerResponse.data as OfferRow | null) ?? null
    let offerBundle: Job360Data['offer'] = null

    if (offer) {
      const [notes, orderFiles] = await Promise.all([
        supabase
          .from('offer_progress_notes')
          .select('*')
          .eq('offer_id', offer.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('offer_order_files')
          .select(
            'id, offer_id, file_name, mime_type, file_size_bytes, created_at'
          )
          .eq('offer_id', offer.id)
          .order('created_at', { ascending: false }),
      ])

      if (notes.error || orderFiles.error) {
        return {
          success: false,
          error: 'Nepodařilo se načíst všechny podklady navázané nabídky.',
        }
      }

      const typedNotes = (notes.data ?? []) as OfferProgressNoteRow[]
      const authorIds = Array.from(
        new Set(
          typedNotes
            .map((note) => optionalText(note.author_user_id))
            .filter((id): id is string => Boolean(id))
        )
      )
      const authors =
        authorIds.length > 0
          ? await supabase.from('profiles').select('id, name').in('id', authorIds)
          : { data: [], error: null }

      if (authors.error) {
        return {
          success: false,
          error: 'Nepodařilo se načíst autory komentářů nabídky.',
        }
      }

      const authorNameById = new Map(
        ((authors.data ?? []) as ProfileNameRow[]).map((author) => [
          author.id,
          optionalText(author.name),
        ])
      )

      offerBundle = {
        details: offer,
        notes: typedNotes.map((note) => ({
          ...note,
          authorName: authorNameById.get(note.author_user_id) ?? null,
        })),
        orderFiles: (orderFiles.data ?? []) as OfferOrderFileRow[],
      }
    }

    const signedInfoPhotos = await Promise.all(
      ((infoPhotosResponse.data ?? []) as JobInfoAttachmentRow[]).map(
        async (photo) => {
          const { data: signedData } = await supabase.storage
            .from(JOB_INFO_MEDIA_BUCKET)
            .createSignedUrl(photo.file_path, 60 * 60)

          return {
            id: photo.id,
            fileName: photo.file_name,
            mimeType: photo.mime_type,
            sizeBytes: photo.size_bytes,
            createdAt: photo.created_at,
            signedUrl: signedData?.signedUrl ?? null,
          }
        }
      )
    )

    const saleAmount =
      typeof finance.sale_amount === 'number' ? finance.sale_amount : null
    const costAmount =
      typeof finance.cost_amount === 'number' ? finance.cost_amount : null
    const profitAmount =
      saleAmount !== null && costAmount !== null
        ? saleAmount - costAmount
        : null
    const marginPercent =
      profitAmount !== null && saleAmount !== null && saleAmount !== 0
        ? (profitAmount / saleAmount) * 100
        : null
    const commission = (commissionResponse.data as ProvizeRow | null) ?? null
    const effectiveCommissionProfit = commission
      ? typeof commission.manual_profit_amount === 'number'
        ? commission.manual_profit_amount
        : commission.base_profit_amount
      : 0
    const effectiveCommissionRate = commission
      ? commissionRate(commission.sales_owner)
      : 0

    return {
      success: true,
      data: {
        finance: {
          id: finance.id,
          clientOrderNumber: optionalText(finance.client_order_number),
          invoiceNumber: optionalText(finance.invoice_number),
          saleAmount,
          costAmount,
          profitAmount,
          marginPercent,
        },
        job: {
          id: job.id,
          jobNumber: job.job_number,
          companyName: job.company_name,
          salesOwner: optionalText(job.sales_owner),
          startAt: job.start_at,
          endAt: job.end_at,
          siteAddress: optionalText(job.site_address),
          storeNumber: optionalText(job.store_number),
          technicianName: optionalText(job.technician_name),
          generatorName: optionalText(job.generator_name),
          infoNote: optionalText(job.info_note),
          infoAlertEnabled: Boolean(job.info_alert_enabled),
          wastedTrip: Boolean(job.marny_vyjezd),
          jobStatus: optionalText(
            getEffectiveJobStatus(job.job_status, job.end_at)
          ),
          invoiceStatus: optionalText(
            getEffectiveInvoiceStatus(
              job.invoice_status,
              finance.invoice_number
            )
          ),
          evidenceStatus: optionalText(job.evidence_status),
          createdAt: job.created_at,
          updatedAt: job.updated_at,
        },
        technicians: technicianRows.map((row) => ({
          id: row.technician_id,
          name:
            profileNameById.get(row.technician_id) ??
            optionalText(job.technician_name) ??
            'Neznámý technik',
        })),
        costs: costRows.map((row) => ({
          id: row.id,
          label: row.label,
          supplier: optionalText(row.supplier),
          technicianName: row.technician_id
            ? profileNameById.get(row.technician_id) ?? null
            : null,
          presetKey: optionalText(row.preset_key),
          unitPrice: finiteNumber(row.unit_price),
          quantity: finiteNumber(row.quantity),
          lineTotal: finiteNumber(row.line_total),
        })),
        commission: commission
          ? {
              salesOwner: commission.sales_owner,
              profitAmount: effectiveCommissionProfit,
              commissionRate: effectiveCommissionRate,
              commissionAmount: Math.round(
                effectiveCommissionProfit * effectiveCommissionRate
              ),
              approvedForPayout: Boolean(commission.approved_for_payout),
              approvedAt: commission.approved_for_payout_at,
              payoutState: commission.confirmed_batch_id
                ? 'paid'
                : commission.current_draft_batch_id
                  ? 'draft'
                  : 'unpaid',
            }
          : null,
        offer: offerBundle,
        protocol: {
          required: !ppRequirementResponse.data,
          details: protocol,
          devices: (devicesResponse.data ?? []) as HandoverDeviceRow[],
          accessories: (accessoriesResponse.data ?? []) as HandoverAccessoryRow[],
        },
        attachments: (
          (attachmentsResponse.data ?? []) as JobAttachmentRow[]
        ).map(mapJobAttachmentRow),
        infoPhotos: signedInfoPhotos,
      },
    }
  } catch (error) {
    console.error('Job 360 load failed:', error)
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Zakázku 360 se nepodařilo načíst.',
    }
  }
}
