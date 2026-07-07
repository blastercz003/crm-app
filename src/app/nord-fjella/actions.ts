'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import type {
  NordFjellaGuestRow,
  NordFjellaGuestType,
  NordFjellaPaymentMethod,
  NordFjellaPaymentStatus,
  NordFjellaReservationFileDocumentType,
  NordFjellaReservationFileRow,
  NordFjellaRecordType,
  NordFjellaReservationItemType,
  NordFjellaReservationStatus,
  NordFjellaSettlementStatus,
  NordFjellaVatMode,
} from '@/lib/nord-fjella/types'

const NORD_FJELLA_GUEST_DOCUMENTS_BUCKET = 'nord-fjella-guest-documents'
const MAX_NORD_FJELLA_GUEST_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_NORD_FJELLA_GUEST_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export type CreateNordFjellaReservationActionState = {
  success: boolean
  error: string | null
  reservationNumber?: string
}

export type UpdateNordFjellaReservationActionState = {
  success: boolean
  error: string | null
  reservationId?: string
}

export type DeleteNordFjellaReservationActionState = {
  success: boolean
  error: string | null
  deletedReservationId: string | null
}

export type UpdateNordFjellaSettingsActionState = {
  success: boolean
  error: string | null
}

export type NordFjellaReservationFileActionState = {
  success: boolean
  error: string | null
}

export type NordFjellaReservationFileUrlActionState = {
  success: boolean
  error: string | null
  signedUrl: string | null
}

export type UploadNordFjellaReservationFilesActionState = {
  success: boolean
  error: string | null
  uploadedFiles: NordFjellaReservationFileRow[]
}

export type DeleteNordFjellaReservationFileActionState = {
  success: boolean
  error: string | null
  deletedFileId: string | null
}

type CurrentProfile = {
  id: string
  role: string | null
  can_view_nord_fjella: boolean | null
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalString(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeUuid(value: FormDataEntryValue | null) {
  const normalized = String(value ?? '').trim()

  if (!normalized) return null

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized
  )
    ? normalized
    : null
}

function parseRequiredNumber(value: string, label: string) {
  const normalized = value.replace(/\s+/g, '').replace(',', '.')
  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} musí být číslo.`)
  }

  return parsed
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')

  return normalized
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 120)
}

function normalizeNordFjellaReservationFileDocumentType(
  value: FormDataEntryValue | null
): NordFjellaReservationFileDocumentType {
  if (value === 'drivers_license' || value === 'passport' || value === 'other') {
    return value
  }

  return 'id_card'
}

function buildNordFjellaReservationFileStoragePath(reservationId: string, fileName: string) {
  const safeName = sanitizeFileName(fileName) || 'doklad'
  return `reservation/${reservationId}/${randomUUID()}-${safeName}`
}

function parseNonNegativeNumber(value: string, label: string) {
  const parsed = parseRequiredNumber(value, label)

  if (parsed < 0) {
    throw new Error(`${label} musí být 0 nebo vyšší.`)
  }

  return parsed
}

function parseNonNegativeInteger(value: string, label: string) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} musí být celé číslo 0 nebo vyšší.`)
  }

  return parsed
}

function parseOptionalNonNegativeNumber(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return parseNonNegativeNumber(trimmed, label)
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  return parseRequiredNumber(trimmed, 'Hodnota')
}

function normalizeGuestType(value: FormDataEntryValue | null): NordFjellaGuestType {
  return value === 'company' ? 'company' : 'person'
}

function normalizeRecordType(value: FormDataEntryValue | null): NordFjellaRecordType {
  if (value === 'owner_block' || value === 'technical_block') {
    return value
  }

  return 'reservation'
}

function normalizeReservationStatus(value: FormDataEntryValue | null): NordFjellaReservationStatus {
  if (value === 'completed' || value === 'cancelled') {
    return value
  }

  return 'reserved'
}

function normalizeSettlementStatus(value: FormDataEntryValue | null): NordFjellaSettlementStatus {
  if (value === 'in_progress' || value === 'closed') {
    return value
  }

  return 'draft'
}

function normalizePaymentStatus(value: FormDataEntryValue | null): NordFjellaPaymentStatus {
  if (
    value === 'deposit_paid' ||
    value === 'partially_paid' ||
    value === 'paid' ||
    value === 'refund_or_overpayment'
  ) {
    return value
  }

  return 'unpaid'
}

function normalizePaymentMethod(value: FormDataEntryValue | null): NordFjellaPaymentMethod | null {
  if (value === 'bank_transfer' || value === 'cash') {
    return value
  }

  return null
}

function parseDateOnly(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} má neplatný formát.`)
  }

  return value
}

function normalizeItemType(value: unknown): NordFjellaReservationItemType {
  if (
    value === 'accommodation' ||
    value === 'cleaning' ||
    value === 'city_tax' ||
    value === 'discount' ||
    value === 'cancellation_fee'
  ) {
    return value
  }

  return 'manual_service'
}

function normalizeVatMode(value: unknown): NordFjellaVatMode {
  if (value === 'vat_21' || value === 'vat_exempt') {
    return value
  }

  return 'vat_12'
}

function parseReservationItemsPayload(formData: FormData) {
  const raw = getString(formData, 'reservation_items_payload')

  if (!raw) {
    return []
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Doplňkové položky mají neplatný formát.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Doplňkové položky mají neplatný formát.')
  }

  return parsed
    .map((item, index) => {
      const typed = item as Record<string, unknown>
      const itemType = normalizeItemType(typed.itemType)
      const label = String(typed.label ?? '').trim()
      const quantity = parseNonNegativeNumber(String(typed.quantity ?? '0'), `Množství u položky ${index + 1}`)
      const unit = String(typed.unit ?? '').trim() || 'ks'
      const unitPrice = parseOptionalNumber(String(typed.unitPrice ?? '0')) ?? 0
      const normalizedUnitPrice = itemType === 'discount' ? -Math.abs(unitPrice) : unitPrice
      const note = String(typed.note ?? '').trim() || null

      if (!label) {
        return null
      }

      return {
        sort_order: Number.isInteger(typed.sortOrder) ? Number(typed.sortOrder) : index,
        item_type: itemType,
        label,
        quantity,
        unit,
        unit_price: normalizedUnitPrice,
        vat_mode: normalizeVatMode(typed.vatMode),
        note,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
}

async function replaceReservationItems(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  reservationId: string
  items: Array<{
    sort_order: number
    item_type: NordFjellaReservationItemType
    label: string
    quantity: number
    unit: string
    unit_price: number
    vat_mode: NordFjellaVatMode
    note: string | null
  }>
}) {
  const { supabase, reservationId, items } = params

  const { error: deleteError } = await supabase
    .from('nord_fjella_reservation_items')
    .delete()
    .eq('reservation_id', reservationId)

  if (deleteError) {
    throw new Error('Nepodařilo se přepsat doplňkové položky.')
  }

  if (items.length === 0) {
    return
  }

  const { error: insertError } = await supabase.from('nord_fjella_reservation_items').insert(
    items.map((item) => ({
      reservation_id: reservationId,
      ...item,
    }))
  )

  if (insertError) {
    throw new Error('Nepodařilo se uložit doplňkové položky.')
  }
}

async function requireNordFjellaUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, can_view_nord_fjella')
    .eq('id', user.id)
    .single<CurrentProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  if (!canViewNordFjellaSection(profile.role, profile)) {
    throw new Error('Do sekce Nord Fjella nemáš přístup.')
  }

  return { supabase, user, profile }
}

async function getNextReservationNumbers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  year: number
) {
  const prefix = `NF-${year}-`
  const { data, error } = await supabase
    .from('nord_fjella_reservations')
    .select('reservation_number, variable_symbol')
    .like('reservation_number', `${prefix}%`)

  if (error) {
    throw new Error('Nepodařilo se připravit číslo rezervace.')
  }

  let maxSequence = 0

  for (const row of data ?? []) {
    const match = String((row as { reservation_number?: string | null }).reservation_number ?? '').match(
      /^NF-(\d{4})-(\d{4,})$/
    )

    if (!match) continue
    const sequence = Number(match[2])

    if (Number.isInteger(sequence) && sequence > maxSequence) {
      maxSequence = sequence
    }
  }

  const nextSequence = maxSequence + 1
  const padded = String(nextSequence).padStart(4, '0')

  return {
    reservationNumber: `NF-${year}-${padded}`,
    variableSymbol: `${year}${padded}`,
  }
}

async function ensureNoReservationOverlap(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  startDate: string
  endDate: string
  excludeReservationId?: string | null
}) {
  const { supabase, startDate, endDate, excludeReservationId } = params

  let query = supabase
    .from('nord_fjella_reservations')
    .select('id, reservation_number, record_type, reservation_status, stay_start_date, stay_end_date')
    .lt('stay_start_date', endDate)
    .gt('stay_end_date', startDate)

  if (excludeReservationId) {
    query = query.neq('id', excludeReservationId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error('Nepodařilo se ověřit kolizi termínu.')
  }

  const conflicting = (data ?? []).find((row) => {
    const typed = row as {
      reservation_number?: string | null
      record_type?: NordFjellaRecordType | null
      reservation_status?: NordFjellaReservationStatus | null
    }

    if (typed.record_type === 'reservation') {
      return typed.reservation_status === 'reserved'
    }

    return typed.record_type === 'owner_block' || typed.record_type === 'technical_block'
  })

  if (conflicting) {
    const reservationNumber =
      String((conflicting as { reservation_number?: string | null }).reservation_number ?? '').trim() ||
      'existujícím záznamem'
    throw new Error(`Termín koliduje se záznamem ${reservationNumber}.`)
  }
}

async function getNordFjellaReservationForFiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  reservationId: string
) {
  const { data, error } = await supabase
    .from('nord_fjella_reservations')
    .select('id, record_type, guest_id')
    .eq('id', reservationId)
    .maybeSingle<{
      id: string
      record_type: NordFjellaRecordType
      guest_id: string | null
    }>()

  if (error || !data) {
    throw new Error('Rezervaci se nepodařilo načíst.')
  }

  if (data.record_type !== 'reservation') {
    throw new Error('Doklady lze nahrávat pouze k rezervaci hosta.')
  }

  return data
}

async function upsertGuest(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  profileId: string
  existingGuestId: string | null
  guestType: NordFjellaGuestType
  fullName: string | null
  companyName: string | null
  contactName: string | null
  email: string
  phone: string
  street: string
  city: string
  postalCode: string
  country: string
  birthDate: string | null
  identityDocumentNumber: string | null
  ico: string | null
  dic: string | null
  note: string | null
}) {
  const {
    supabase,
    profileId,
    existingGuestId,
    guestType,
    fullName,
    companyName,
    contactName,
    email,
    phone,
    street,
    city,
    postalCode,
    country,
    birthDate,
    identityDocumentNumber,
    ico,
    dic,
    note,
  } = params

  const payload = {
    guest_type: guestType,
    full_name: fullName,
    company_name: companyName,
    contact_name: contactName,
    email,
    phone,
    street,
    city,
    postal_code: postalCode,
    country,
    birth_date: birthDate,
    identity_document_number: identityDocumentNumber,
    ico,
    dic,
    note,
    updated_by: profileId,
  }

  if (existingGuestId) {
    const { data, error } = await supabase
      .from('nord_fjella_guests')
      .update(payload)
      .eq('id', existingGuestId)
      .select('*')
      .single<NordFjellaGuestRow>()

    if (error || !data) {
      throw new Error('Nepodařilo se aktualizovat vybraného hosta.')
    }

    return data.id
  }

  const { data, error } = await supabase
    .from('nord_fjella_guests')
    .insert({
      ...payload,
      created_by: profileId,
    })
    .select('*')
    .single<NordFjellaGuestRow>()

  if (error || !data) {
    throw new Error('Nepodařilo se uložit hosta.')
  }

  return data.id
}

export async function createNordFjellaReservationAction(
  _previousState: CreateNordFjellaReservationActionState,
  formData: FormData
): Promise<CreateNordFjellaReservationActionState> {
  void _previousState

  try {
    const { supabase, profile } = await requireNordFjellaUser()
    const recordType = normalizeRecordType(formData.get('record_type'))
    const guestType = normalizeGuestType(formData.get('guest_type'))
    const reservationItems = parseReservationItemsPayload(formData)
    const startDate = parseDateOnly(getString(formData, 'stay_start_date'), 'Datum příjezdu')
    const endDate = parseDateOnly(getString(formData, 'stay_end_date'), 'Datum odjezdu')

    if (endDate <= startDate) {
      throw new Error('Datum odjezdu musí být po datu příjezdu.')
    }

    await ensureNoReservationOverlap({
      supabase,
      startDate,
      endDate,
    })

    const currentYear = Number(startDate.slice(0, 4))
    const { reservationNumber, variableSymbol } = await getNextReservationNumbers(supabase, currentYear)

    let guestId: string | null = null
    let guestFullName: string | null = null
    let guestCompanyName: string | null = null
    let guestContactName: string | null = null
    let guestEmail: string | null = null
    let guestPhone: string | null = null
    let guestStreet: string | null = null
    let guestCity: string | null = null
    let guestPostalCode: string | null = null
    let guestCountry: string | null = null
    let guestBirthDate: string | null = null
    let guestIdentityDocumentNumber: string | null = null
    let guestIco: string | null = null
    let guestDic: string | null = null
    let reservationStatus: NordFjellaReservationStatus | null = null
    let paymentStatus: NordFjellaPaymentStatus | null = null

    const settlementStatus = normalizeSettlementStatus(formData.get('settlement_status'))
    const internalNote = normalizeOptionalString(formData.get('internal_note'))
    const publicNote = normalizeOptionalString(formData.get('public_note'))

    let adultCount = 0
    let childCount = 0
    let accommodationNightRate = 0
    let accommodationVatRate = 12
    let cityTaxRate = 0
    let cityTaxPersonCount = 0
    let cleaningFee = 0
    let cleaningFeeVatRate = 12
    let securityDepositAmount = 0
    let securityDepositReceived = false
    let securityDepositReceivedAt: string | null = null
    let securityDepositRefundedAt: string | null = null
    let securityDepositRefundAmount: number | null = null
    let securityDepositWithheldAmount: number | null = null
    let securityDepositWithheldReason: string | null = null
    let requestedDepositAmount: number | null = null
    let depositDueDate: string | null = null
    let depositPaidAmount: number | null = null
    let depositPaidAt: string | null = null
    let depositPaymentMethod: NordFjellaPaymentMethod | null = null
    let balancePaidAmount: number | null = null
    let balancePaidAt: string | null = null
    let balancePaymentMethod: NordFjellaPaymentMethod | null = null
    let cancellationFeeAmount: number | null = null

    if (recordType === 'reservation') {
      reservationStatus = normalizeReservationStatus(formData.get('reservation_status'))
      paymentStatus = normalizePaymentStatus(formData.get('payment_status'))
      const existingGuestId = normalizeUuid(formData.get('existing_guest_id'))
      const fullName = normalizeOptionalString(formData.get('guest_full_name'))
      const companyName = normalizeOptionalString(formData.get('guest_company_name'))
      const contactName = normalizeOptionalString(formData.get('guest_contact_name'))
      const email = getString(formData, 'guest_email')
      const phone = getString(formData, 'guest_phone')
      const street = getString(formData, 'guest_street')
      const city = getString(formData, 'guest_city')
      const postalCode = getString(formData, 'guest_postal_code')
      const country = getString(formData, 'guest_country')
      const birthDate = parseDateOnly(getString(formData, 'guest_birth_date'), 'Datum narození')
      const identityDocumentNumber = getString(formData, 'guest_identity_document_number')
      const ico = normalizeOptionalString(formData.get('guest_ico'))
      const dic = normalizeOptionalString(formData.get('guest_dic'))
      const note = normalizeOptionalString(formData.get('guest_note'))

      if (!email) throw new Error('E-mail hosta je povinný.')
      if (!phone) throw new Error('Telefon hosta je povinný.')
      if (!street) throw new Error('Ulice hosta je povinná.')
      if (!city) throw new Error('Město hosta je povinné.')
      if (!postalCode) throw new Error('PSČ hosta je povinné.')
      if (!country) throw new Error('Země hosta je povinná.')
      if (!identityDocumentNumber) {
        throw new Error('Číslo OP nebo pasu je povinné.')
      }

      if (guestType === 'person') {
        if (!fullName) throw new Error('Jméno a příjmení hosta je povinné.')
      } else {
        if (!companyName) throw new Error('Název firmy je povinný.')
        if (!contactName) throw new Error('Kontaktní osoba firmy je povinná.')
        if (!ico) throw new Error('IČO je povinné.')
        if (!dic) throw new Error('DIČ je povinné.')
      }

      guestId = await upsertGuest({
        supabase,
        profileId: profile.id,
        existingGuestId,
        guestType,
        fullName,
        companyName,
        contactName,
        email,
        phone,
        street,
        city,
        postalCode,
        country,
        birthDate,
        identityDocumentNumber,
        ico,
        dic,
        note,
      })

      guestFullName = fullName
      guestCompanyName = companyName
      guestContactName = contactName
      guestEmail = email
      guestPhone = phone
      guestStreet = street
      guestCity = city
      guestPostalCode = postalCode
      guestCountry = country
      guestBirthDate = birthDate
      guestIdentityDocumentNumber = identityDocumentNumber
      guestIco = ico
      guestDic = dic

      adultCount = parseNonNegativeInteger(getString(formData, 'adult_count'), 'Počet dospělých')
      childCount = parseNonNegativeInteger(getString(formData, 'child_count'), 'Počet dětí')
      accommodationNightRate = parseNonNegativeNumber(getString(formData, 'accommodation_night_rate'), 'Cena za noc')
      accommodationVatRate = parseNonNegativeNumber(getString(formData, 'accommodation_vat_rate'), 'DPH ubytování')
      cityTaxRate = parseNonNegativeNumber(getString(formData, 'city_tax_rate'), 'Místní poplatek')
      cityTaxPersonCount = parseNonNegativeInteger(getString(formData, 'city_tax_person_count'), 'Počet osob pro místní poplatek')
      cleaningFee = parseNonNegativeNumber(getString(formData, 'cleaning_fee'), 'Úklid')
      cleaningFeeVatRate = parseNonNegativeNumber(getString(formData, 'cleaning_fee_vat_rate'), 'DPH úklidu')
      securityDepositAmount = parseNonNegativeNumber(getString(formData, 'security_deposit_amount'), 'Kauce')
      securityDepositReceived = formData.get('security_deposit_received') === 'on'
      securityDepositReceivedAt = normalizeOptionalString(formData.get('security_deposit_received_at'))
      securityDepositRefundedAt = normalizeOptionalString(formData.get('security_deposit_refunded_at'))
      securityDepositRefundAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'security_deposit_refund_amount'),
        'Vrácená kauce'
      )
      securityDepositWithheldAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'security_deposit_withheld_amount'),
        'Zadržená kauce'
      )
      securityDepositWithheldReason = normalizeOptionalString(formData.get('security_deposit_withheld_reason'))
      requestedDepositAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'requested_deposit_amount'),
        'Požadovaná záloha'
      )
      depositDueDate = normalizeOptionalString(formData.get('deposit_due_date'))
      depositPaidAmount = parseOptionalNonNegativeNumber(getString(formData, 'deposit_paid_amount'), 'Uhrazená záloha')
      depositPaidAt = normalizeOptionalString(formData.get('deposit_paid_at'))
      depositPaymentMethod = normalizePaymentMethod(formData.get('deposit_payment_method'))
      balancePaidAmount = parseOptionalNonNegativeNumber(getString(formData, 'balance_paid_amount'), 'Uhrazený doplatek')
      balancePaidAt = normalizeOptionalString(formData.get('balance_paid_at'))
      balancePaymentMethod = normalizePaymentMethod(formData.get('balance_payment_method'))
      cancellationFeeAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'cancellation_fee_amount'),
        'Storno poplatek'
      )

      if (adultCount + childCount <= 0) {
        throw new Error('Zadej alespoň jednoho hosta.')
      }
    }

    const { data: insertedReservation, error } = await supabase
      .from('nord_fjella_reservations')
      .insert({
      reservation_number: reservationNumber,
      variable_symbol: variableSymbol,
      record_type: recordType,
      reservation_status: reservationStatus,
      settlement_status: settlementStatus,
      payment_status: paymentStatus,
      guest_id: guestId,
      guest_type: recordType === 'reservation' ? guestType : null,
      guest_full_name: guestFullName,
      guest_company_name: guestCompanyName,
      guest_contact_name: guestContactName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      guest_street: guestStreet,
      guest_city: guestCity,
      guest_postal_code: guestPostalCode,
      guest_country: guestCountry,
      guest_birth_date: guestBirthDate,
      guest_identity_document_number: guestIdentityDocumentNumber,
      guest_ico: guestIco,
      guest_dic: guestDic,
      stay_start_date: startDate,
      stay_end_date: endDate,
      adult_count: adultCount,
      child_count: childCount,
      accommodation_night_rate: accommodationNightRate,
      accommodation_vat_rate: accommodationVatRate,
      city_tax_rate: cityTaxRate,
      city_tax_person_count: cityTaxPersonCount,
      cleaning_fee: cleaningFee,
      cleaning_fee_vat_rate: cleaningFeeVatRate,
      security_deposit_amount: securityDepositAmount,
      security_deposit_received: securityDepositReceived,
      security_deposit_received_at: securityDepositReceivedAt,
      security_deposit_refunded_at: securityDepositRefundedAt,
      security_deposit_refund_amount: securityDepositRefundAmount,
      security_deposit_withheld_amount: securityDepositWithheldAmount,
      security_deposit_withheld_reason: securityDepositWithheldReason,
      requested_deposit_amount: requestedDepositAmount,
      deposit_due_date: depositDueDate,
      deposit_paid_amount: depositPaidAmount,
      deposit_paid_at: depositPaidAt,
      deposit_payment_method: depositPaymentMethod,
      balance_paid_amount: balancePaidAmount,
      balance_paid_at: balancePaidAt,
      balance_payment_method: balancePaymentMethod,
      cancellation_fee_amount: cancellationFeeAmount,
      internal_note: internalNote,
      public_note: publicNote,
      created_by: profile.id,
      updated_by: profile.id,
      })
      .select('id')
      .single<{ id: string }>()

    if (error) {
      if (error.message?.includes('reservation_number')) {
        throw new Error('Rezervaci se nepodařilo uložit kvůli duplicitnímu číslu. Zkus to prosím znovu.')
      }

      throw new Error(`Nepodařilo se uložit pronájem: ${error.message}`)
    }

    if (!insertedReservation) {
      throw new Error('Pronájem se uložil bez identifikace záznamu.')
    }

    if (recordType === 'reservation') {
      await replaceReservationItems({
        supabase,
        reservationId: insertedReservation.id,
        items: reservationItems,
      })
    }

    revalidatePath('/nord-fjella')

    return {
      success: true,
      error: null,
      reservationNumber,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Pronájem se nepodařilo uložit.',
    }
  }
}

export async function updateNordFjellaReservationAction(
  _previousState: UpdateNordFjellaReservationActionState,
  formData: FormData
): Promise<UpdateNordFjellaReservationActionState> {
  void _previousState

  try {
    const { supabase, profile } = await requireNordFjellaUser()
    const reservationId = normalizeUuid(formData.get('reservation_id'))
    const reservationItems = parseReservationItemsPayload(formData)

    if (!reservationId) {
      throw new Error('Chybí identifikace záznamu pro úpravu.')
    }

    const { data: existingReservation, error: existingReservationError } = await supabase
      .from('nord_fjella_reservations')
      .select('id, guest_id')
      .eq('id', reservationId)
      .single<{ id: string; guest_id: string | null }>()

    if (existingReservationError || !existingReservation) {
      throw new Error('Rezervaci se nepodařilo načíst.')
    }

    const recordType = normalizeRecordType(formData.get('record_type'))
    const guestType = normalizeGuestType(formData.get('guest_type'))
    const startDate = parseDateOnly(getString(formData, 'stay_start_date'), 'Datum příjezdu')
    const endDate = parseDateOnly(getString(formData, 'stay_end_date'), 'Datum odjezdu')

    if (endDate <= startDate) {
      throw new Error('Datum odjezdu musí být po datu příjezdu.')
    }

    await ensureNoReservationOverlap({
      supabase,
      startDate,
      endDate,
      excludeReservationId: reservationId,
    })

    let guestId: string | null = null
    let guestFullName: string | null = null
    let guestCompanyName: string | null = null
    let guestContactName: string | null = null
    let guestEmail: string | null = null
    let guestPhone: string | null = null
    let guestStreet: string | null = null
    let guestCity: string | null = null
    let guestPostalCode: string | null = null
    let guestCountry: string | null = null
    let guestBirthDate: string | null = null
    let guestIdentityDocumentNumber: string | null = null
    let guestIco: string | null = null
    let guestDic: string | null = null
    let reservationStatus: NordFjellaReservationStatus | null = null
    let paymentStatus: NordFjellaPaymentStatus | null = null

    const settlementStatus = normalizeSettlementStatus(formData.get('settlement_status'))
    const internalNote = normalizeOptionalString(formData.get('internal_note'))
    const publicNote = normalizeOptionalString(formData.get('public_note'))

    let adultCount = 0
    let childCount = 0
    let accommodationNightRate = 0
    let accommodationVatRate = 12
    let cityTaxRate = 0
    let cityTaxPersonCount = 0
    let cleaningFee = 0
    let cleaningFeeVatRate = 12
    let securityDepositAmount = 0
    let securityDepositReceived = false
    let securityDepositReceivedAt: string | null = null
    let securityDepositRefundedAt: string | null = null
    let securityDepositRefundAmount: number | null = null
    let securityDepositWithheldAmount: number | null = null
    let securityDepositWithheldReason: string | null = null
    let requestedDepositAmount: number | null = null
    let depositDueDate: string | null = null
    let depositPaidAmount: number | null = null
    let depositPaidAt: string | null = null
    let depositPaymentMethod: NordFjellaPaymentMethod | null = null
    let balancePaidAmount: number | null = null
    let balancePaidAt: string | null = null
    let balancePaymentMethod: NordFjellaPaymentMethod | null = null
    let cancellationFeeAmount: number | null = null

    if (recordType === 'reservation') {
      reservationStatus = normalizeReservationStatus(formData.get('reservation_status'))
      paymentStatus = normalizePaymentStatus(formData.get('payment_status'))
      const existingGuestId = normalizeUuid(formData.get('existing_guest_id'))
      const fullName = normalizeOptionalString(formData.get('guest_full_name'))
      const companyName = normalizeOptionalString(formData.get('guest_company_name'))
      const contactName = normalizeOptionalString(formData.get('guest_contact_name'))
      const email = getString(formData, 'guest_email')
      const phone = getString(formData, 'guest_phone')
      const street = getString(formData, 'guest_street')
      const city = getString(formData, 'guest_city')
      const postalCode = getString(formData, 'guest_postal_code')
      const country = getString(formData, 'guest_country')
      const birthDate = parseDateOnly(getString(formData, 'guest_birth_date'), 'Datum narození')
      const identityDocumentNumber = getString(formData, 'guest_identity_document_number')
      const ico = normalizeOptionalString(formData.get('guest_ico'))
      const dic = normalizeOptionalString(formData.get('guest_dic'))
      const note = normalizeOptionalString(formData.get('guest_note'))

      if (!email) throw new Error('E-mail hosta je povinný.')
      if (!phone) throw new Error('Telefon hosta je povinný.')
      if (!street) throw new Error('Ulice hosta je povinná.')
      if (!city) throw new Error('Město hosta je povinné.')
      if (!postalCode) throw new Error('PSČ hosta je povinné.')
      if (!country) throw new Error('Země hosta je povinná.')
      if (!identityDocumentNumber) {
        throw new Error('Číslo OP nebo pasu je povinné.')
      }

      if (guestType === 'person') {
        if (!fullName) throw new Error('Jméno a příjmení hosta je povinné.')
      } else {
        if (!companyName) throw new Error('Název firmy je povinný.')
        if (!contactName) throw new Error('Kontaktní osoba firmy je povinná.')
        if (!ico) throw new Error('IČO je povinné.')
        if (!dic) throw new Error('DIČ je povinné.')
      }

      guestId = await upsertGuest({
        supabase,
        profileId: profile.id,
        existingGuestId: existingGuestId ?? existingReservation.guest_id,
        guestType,
        fullName,
        companyName,
        contactName,
        email,
        phone,
        street,
        city,
        postalCode,
        country,
        birthDate,
        identityDocumentNumber,
        ico,
        dic,
        note,
      })

      guestFullName = fullName
      guestCompanyName = companyName
      guestContactName = contactName
      guestEmail = email
      guestPhone = phone
      guestStreet = street
      guestCity = city
      guestPostalCode = postalCode
      guestCountry = country
      guestBirthDate = birthDate
      guestIdentityDocumentNumber = identityDocumentNumber
      guestIco = ico
      guestDic = dic

      adultCount = parseNonNegativeInteger(getString(formData, 'adult_count'), 'Počet dospělých')
      childCount = parseNonNegativeInteger(getString(formData, 'child_count'), 'Počet dětí')
      accommodationNightRate = parseNonNegativeNumber(getString(formData, 'accommodation_night_rate'), 'Cena za noc')
      accommodationVatRate = parseNonNegativeNumber(getString(formData, 'accommodation_vat_rate'), 'DPH ubytování')
      cityTaxRate = parseNonNegativeNumber(getString(formData, 'city_tax_rate'), 'Místní poplatek')
      cityTaxPersonCount = parseNonNegativeInteger(getString(formData, 'city_tax_person_count'), 'Počet osob pro místní poplatek')
      cleaningFee = parseNonNegativeNumber(getString(formData, 'cleaning_fee'), 'Úklid')
      cleaningFeeVatRate = parseNonNegativeNumber(getString(formData, 'cleaning_fee_vat_rate'), 'DPH úklidu')
      securityDepositAmount = parseNonNegativeNumber(getString(formData, 'security_deposit_amount'), 'Kauce')
      securityDepositReceived = formData.get('security_deposit_received') === 'on'
      securityDepositReceivedAt = normalizeOptionalString(formData.get('security_deposit_received_at'))
      securityDepositRefundedAt = normalizeOptionalString(formData.get('security_deposit_refunded_at'))
      securityDepositRefundAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'security_deposit_refund_amount'),
        'Vrácená kauce'
      )
      securityDepositWithheldAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'security_deposit_withheld_amount'),
        'Zadržená kauce'
      )
      securityDepositWithheldReason = normalizeOptionalString(formData.get('security_deposit_withheld_reason'))
      requestedDepositAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'requested_deposit_amount'),
        'Požadovaná záloha'
      )
      depositDueDate = normalizeOptionalString(formData.get('deposit_due_date'))
      depositPaidAmount = parseOptionalNonNegativeNumber(getString(formData, 'deposit_paid_amount'), 'Uhrazená záloha')
      depositPaidAt = normalizeOptionalString(formData.get('deposit_paid_at'))
      depositPaymentMethod = normalizePaymentMethod(formData.get('deposit_payment_method'))
      balancePaidAmount = parseOptionalNonNegativeNumber(getString(formData, 'balance_paid_amount'), 'Uhrazený doplatek')
      balancePaidAt = normalizeOptionalString(formData.get('balance_paid_at'))
      balancePaymentMethod = normalizePaymentMethod(formData.get('balance_payment_method'))
      cancellationFeeAmount = parseOptionalNonNegativeNumber(
        getString(formData, 'cancellation_fee_amount'),
        'Storno poplatek'
      )
    }

    const { error } = await supabase
      .from('nord_fjella_reservations')
      .update({
        record_type: recordType,
        reservation_status: reservationStatus,
        settlement_status: settlementStatus,
        payment_status: paymentStatus,
        guest_id: guestId,
        guest_type: recordType === 'reservation' ? guestType : null,
        guest_full_name: guestFullName,
        guest_company_name: guestCompanyName,
        guest_contact_name: guestContactName,
        guest_email: guestEmail,
        guest_phone: guestPhone,
        guest_street: guestStreet,
        guest_city: guestCity,
        guest_postal_code: guestPostalCode,
        guest_country: guestCountry,
        guest_birth_date: guestBirthDate,
        guest_identity_document_number: guestIdentityDocumentNumber,
        guest_ico: guestIco,
        guest_dic: guestDic,
        stay_start_date: startDate,
        stay_end_date: endDate,
        adult_count: adultCount,
        child_count: childCount,
        accommodation_night_rate: accommodationNightRate,
        accommodation_vat_rate: accommodationVatRate,
        city_tax_rate: cityTaxRate,
        city_tax_person_count: cityTaxPersonCount,
        cleaning_fee: cleaningFee,
        cleaning_fee_vat_rate: cleaningFeeVatRate,
        security_deposit_amount: securityDepositAmount,
        security_deposit_received: securityDepositReceived,
        security_deposit_received_at: securityDepositReceivedAt,
        security_deposit_refunded_at: securityDepositRefundedAt,
        security_deposit_refund_amount: securityDepositRefundAmount,
        security_deposit_withheld_amount: securityDepositWithheldAmount,
        security_deposit_withheld_reason: securityDepositWithheldReason,
        requested_deposit_amount: requestedDepositAmount,
        deposit_due_date: depositDueDate,
        deposit_paid_amount: depositPaidAmount,
        deposit_paid_at: depositPaidAt,
        deposit_payment_method: depositPaymentMethod,
        balance_paid_amount: balancePaidAmount,
        balance_paid_at: balancePaidAt,
        balance_payment_method: balancePaymentMethod,
        cancellation_fee_amount: cancellationFeeAmount,
        internal_note: internalNote,
        public_note: publicNote,
        updated_by: profile.id,
      })
      .eq('id', reservationId)

    if (error) {
      throw new Error(`Nepodařilo se uložit změny rezervace: ${error.message}`)
    }

    await replaceReservationItems({
      supabase,
      reservationId,
      items: recordType === 'reservation' ? reservationItems : [],
    })

    revalidatePath('/nord-fjella')

    return {
      success: true,
      error: null,
      reservationId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Změny se nepodařilo uložit.',
    }
  }
}

export async function deleteNordFjellaReservationAction(
  reservationId: string
): Promise<DeleteNordFjellaReservationActionState> {
  try {
    const { supabase } = await requireNordFjellaUser()
    const normalizedReservationId = String(reservationId ?? '').trim()

    if (!normalizedReservationId) {
      return {
        success: false,
        error: 'Chybí ID rezervace.',
        deletedReservationId: null,
      }
    }

    const { data: existingReservation, error: existingReservationError } = await supabase
      .from('nord_fjella_reservations')
      .select('id')
      .eq('id', normalizedReservationId)
      .single<{ id: string }>()

    if (existingReservationError || !existingReservation) {
      return {
        success: false,
        error: 'Rezervace nebyla nalezena.',
        deletedReservationId: null,
      }
    }

    const { data: reservationFiles, error: reservationFilesError } = await supabase
      .from('nord_fjella_reservation_files')
      .select('id, storage_bucket, storage_path')
      .eq('reservation_id', normalizedReservationId)
      .returns<
        Array<{
          id: string
          storage_bucket: string
          storage_path: string
        }>
      >()

    if (reservationFilesError) {
      return {
        success: false,
        error: 'Nepodařilo se načíst soubory rezervace ke smazání.',
        deletedReservationId: null,
      }
    }

    for (const file of reservationFiles ?? []) {
      const bucket = String(file.storage_bucket ?? '').trim()
      const path = String(file.storage_path ?? '').trim()

      if (!bucket || !path) continue

      const { error: storageError } = await supabase.storage.from(bucket).remove([path])

      if (storageError) {
        return {
          success: false,
          error: 'Nepodařilo se smazat navázané soubory rezervace.',
          deletedReservationId: null,
        }
      }
    }

    const { error: deleteFilesError } = await supabase
      .from('nord_fjella_reservation_files')
      .delete()
      .eq('reservation_id', normalizedReservationId)

    if (deleteFilesError) {
      return {
        success: false,
        error: 'Nepodařilo se smazat evidenci souborů rezervace.',
        deletedReservationId: null,
      }
    }

    const { error: deleteItemsError } = await supabase
      .from('nord_fjella_reservation_items')
      .delete()
      .eq('reservation_id', normalizedReservationId)

    if (deleteItemsError) {
      return {
        success: false,
        error: 'Nepodařilo se smazat doplňkové položky rezervace.',
        deletedReservationId: null,
      }
    }

    const { error: deleteReservationError } = await supabase
      .from('nord_fjella_reservations')
      .delete()
      .eq('id', normalizedReservationId)

    if (deleteReservationError) {
      return {
        success: false,
        error: 'Nepodařilo se smazat samotnou rezervaci.',
        deletedReservationId: null,
      }
    }

    revalidatePath('/nord-fjella')

    return {
      success: true,
      error: null,
      deletedReservationId: normalizedReservationId,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Rezervaci se nepodařilo smazat.',
      deletedReservationId: null,
    }
  }
}

export async function updateNordFjellaSettingsAction(
  _previousState: UpdateNordFjellaSettingsActionState,
  formData: FormData
): Promise<UpdateNordFjellaSettingsActionState> {
  void _previousState

  try {
    const { supabase } = await requireNordFjellaUser()

    const objectName = getString(formData, 'object_name')
    const providerCompanyName = getString(formData, 'provider_company_name')
    const providerCompanyIdNumber = getString(formData, 'provider_company_id_number')
    const providerVatNumber = getString(formData, 'provider_vat_number')
    const providerStreet = getString(formData, 'provider_street')
    const providerCity = getString(formData, 'provider_city')
    const providerPostalCode = getString(formData, 'provider_postal_code')
    const providerCountry = getString(formData, 'provider_country')
    const providerEmail = getString(formData, 'provider_email')
    const providerPhone = getString(formData, 'provider_phone')
    const providerBankAccount = getString(formData, 'provider_bank_account')
    const providerIban = normalizeOptionalString(formData.get('provider_iban'))
    const providerSwift = normalizeOptionalString(formData.get('provider_swift'))
    const defaultAccommodationVatRate = parseNonNegativeNumber(
      getString(formData, 'default_accommodation_vat_rate'),
      'Výchozí DPH ubytování'
    )
    const defaultCleaningFee = parseNonNegativeNumber(
      getString(formData, 'default_cleaning_fee'),
      'Výchozí úklid'
    )
    const defaultSecurityDeposit = parseNonNegativeNumber(
      getString(formData, 'default_security_deposit'),
      'Výchozí kauce'
    )
    const defaultInvoiceDueDays = parseNonNegativeInteger(
      getString(formData, 'default_invoice_due_days'),
      'Výchozí splatnost'
    )
    const publicNoteTemplate = normalizeOptionalString(formData.get('public_note_template'))

    if (!objectName) throw new Error('Název objektu je povinný.')
    if (!providerCompanyName) throw new Error('Název poskytovatele je povinný.')
    if (!providerStreet) throw new Error('Ulice poskytovatele je povinná.')
    if (!providerCity) throw new Error('Město poskytovatele je povinné.')
    if (!providerPostalCode) throw new Error('PSČ poskytovatele je povinné.')
    if (!providerCountry) throw new Error('Země poskytovatele je povinná.')
    if (!providerEmail) throw new Error('E-mail poskytovatele je povinný.')
    if (!providerPhone) throw new Error('Telefon poskytovatele je povinný.')
    if (!providerBankAccount) throw new Error('Číslo účtu je povinné.')

    const { error } = await supabase.from('nord_fjella_settings').upsert({
      singleton_key: 'primary',
      object_name: objectName,
      provider_company_name: providerCompanyName,
      provider_company_id_number: providerCompanyIdNumber,
      provider_vat_number: providerVatNumber,
      provider_street: providerStreet,
      provider_city: providerCity,
      provider_postal_code: providerPostalCode,
      provider_country: providerCountry,
      provider_email: providerEmail,
      provider_phone: providerPhone,
      provider_bank_account: providerBankAccount,
      provider_iban: providerIban,
      provider_swift: providerSwift,
      default_accommodation_vat_rate: defaultAccommodationVatRate,
      default_cleaning_fee: defaultCleaningFee,
      default_security_deposit: defaultSecurityDeposit,
      default_invoice_due_days: defaultInvoiceDueDays,
      public_note_template: publicNoteTemplate,
    }, { onConflict: 'singleton_key' })

    if (error) {
      throw new Error(`Nepodařilo se uložit nastavení: ${error.message}`)
    }

    revalidatePath('/nord-fjella')

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nastavení se nepodařilo uložit.',
    }
  }
}

export async function uploadNordFjellaReservationFilesAction(
  reservationId: string,
  documentType: NordFjellaReservationFileDocumentType,
  files: File[]
): Promise<UploadNordFjellaReservationFilesActionState> {
  try {
    const { supabase, user } = await requireNordFjellaUser()
    const normalizedReservationId = String(reservationId ?? '').trim()

    if (!normalizedReservationId) {
      return { success: false, error: 'Chybí ID rezervace.', uploadedFiles: [] }
    }

    const reservation = await getNordFjellaReservationForFiles(supabase, normalizedReservationId)
    const normalizedDocumentType = normalizeNordFjellaReservationFileDocumentType(documentType)
    const cleanFiles = files.filter((file) => file instanceof File)

    if (cleanFiles.length === 0) {
      return { success: false, error: 'Vyber alespoň jeden soubor.', uploadedFiles: [] }
    }

    for (const file of cleanFiles) {
      if (file.size > MAX_NORD_FJELLA_GUEST_DOCUMENT_SIZE_BYTES) {
        return {
          success: false,
          error: `Soubor "${file.name}" překračuje limit 10 MB.`,
          uploadedFiles: [],
        }
      }

      const mimeType = String(file.type ?? '').trim().toLowerCase()
      if (!mimeType || !ALLOWED_NORD_FJELLA_GUEST_DOCUMENT_MIME_TYPES.has(mimeType)) {
        return {
          success: false,
          error: `Soubor "${file.name}" musí být PDF, JPG, PNG, WEBP nebo HEIC.`,
          uploadedFiles: [],
        }
      }
    }

    const createdRows: NordFjellaReservationFileRow[] = []

    for (const file of cleanFiles) {
      const storagePath = buildNordFjellaReservationFileStoragePath(normalizedReservationId, file.name)
      const contentType = String(file.type ?? '').trim() || 'application/octet-stream'

      const { error: uploadError } = await supabase.storage
        .from(NORD_FJELLA_GUEST_DOCUMENTS_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        for (const createdRow of createdRows) {
          await supabase.storage.from(NORD_FJELLA_GUEST_DOCUMENTS_BUCKET).remove([createdRow.storage_path])
          await supabase.from('nord_fjella_reservation_files').delete().eq('id', createdRow.id)
        }

        return {
          success: false,
          error: `Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`,
          uploadedFiles: [],
        }
      }

      const { data: insertedRow, error: insertError } = await supabase
        .from('nord_fjella_reservation_files')
        .insert({
          reservation_id: normalizedReservationId,
          guest_id: reservation.guest_id,
          document_type: normalizedDocumentType,
          file_name: file.name,
          display_name: file.name,
          storage_bucket: NORD_FJELLA_GUEST_DOCUMENTS_BUCKET,
          storage_path: storagePath,
          mime_type: contentType,
          file_size_bytes: file.size,
          uploaded_by: user.id,
        })
        .select('*')
        .single<NordFjellaReservationFileRow>()

      if (insertError || !insertedRow) {
        await supabase.storage.from(NORD_FJELLA_GUEST_DOCUMENTS_BUCKET).remove([storagePath])

        for (const createdRow of createdRows) {
          await supabase.storage.from(NORD_FJELLA_GUEST_DOCUMENTS_BUCKET).remove([createdRow.storage_path])
          await supabase.from('nord_fjella_reservation_files').delete().eq('id', createdRow.id)
        }

        return {
          success: false,
          error: `Metadata souboru "${file.name}" se nepodařilo uložit (${insertError?.message ?? 'neznámá chyba'}).`,
          uploadedFiles: [],
        }
      }

      createdRows.push(insertedRow)
    }

    revalidatePath('/nord-fjella')

    return {
      success: true,
      error: null,
      uploadedFiles: createdRows,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se nahrát soubory.',
      uploadedFiles: [],
    }
  }
}

async function getNordFjellaReservationFileUrl(
  fileId: string,
  download: boolean
): Promise<NordFjellaReservationFileUrlActionState> {
  try {
    const { supabase } = await requireNordFjellaUser()
    const normalizedFileId = String(fileId ?? '').trim()

    if (!normalizedFileId) {
      return { success: false, error: 'Chybí ID souboru.', signedUrl: null }
    }

    const { data: row, error: rowError } = await supabase
      .from('nord_fjella_reservation_files')
      .select('id, reservation_id, display_name, storage_bucket, storage_path')
      .eq('id', normalizedFileId)
      .single<{
        id: string
        reservation_id: string
        display_name: string
        storage_bucket: string
        storage_path: string
      }>()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
    }

    await getNordFjellaReservationForFiles(supabase, row.reservation_id)

    const { data, error } = await supabase.storage
      .from(String(row.storage_bucket))
      .createSignedUrl(
        String(row.storage_path),
        60,
        download
          ? {
              download: String(row.display_name ?? '').trim() || undefined,
            }
          : undefined
      )

    if (error || !data?.signedUrl) {
      return {
        success: false,
        error: download
          ? 'Nepodařilo se vytvořit odkaz pro stažení souboru.'
          : 'Nepodařilo se vytvořit odkaz pro otevření souboru.',
        signedUrl: null,
      }
    }

    return { success: true, error: null, signedUrl: data.signedUrl }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se připravit soubor.',
      signedUrl: null,
    }
  }
}

export async function openNordFjellaReservationFileAction(
  fileId: string
): Promise<NordFjellaReservationFileUrlActionState> {
  return getNordFjellaReservationFileUrl(fileId, false)
}

export async function downloadNordFjellaReservationFileAction(
  fileId: string
): Promise<NordFjellaReservationFileUrlActionState> {
  return getNordFjellaReservationFileUrl(fileId, true)
}

export async function deleteNordFjellaReservationFileAction(
  fileId: string
): Promise<DeleteNordFjellaReservationFileActionState> {
  try {
    const { supabase } = await requireNordFjellaUser()
    const normalizedFileId = String(fileId ?? '').trim()

    if (!normalizedFileId) {
      return { success: false, error: 'Chybí ID souboru.', deletedFileId: null }
    }

    const { data: row, error: rowError } = await supabase
      .from('nord_fjella_reservation_files')
      .select('id, reservation_id, storage_bucket, storage_path')
      .eq('id', normalizedFileId)
      .single<{
        id: string
        reservation_id: string
        storage_bucket: string
        storage_path: string
      }>()

    if (rowError || !row) {
      return { success: false, error: 'Soubor nebyl nalezen.', deletedFileId: null }
    }

    await getNordFjellaReservationForFiles(supabase, row.reservation_id)

    const { error: storageError } = await supabase.storage
      .from(String(row.storage_bucket))
      .remove([String(row.storage_path)])

    if (storageError) {
      return { success: false, error: 'Soubor ve storage se nepodařilo smazat.', deletedFileId: null }
    }

    const { error: deleteError } = await supabase
      .from('nord_fjella_reservation_files')
      .delete()
      .eq('id', normalizedFileId)

    if (deleteError) {
      return { success: false, error: 'Metadata souboru se nepodařilo smazat.', deletedFileId: null }
    }

    revalidatePath('/nord-fjella')

    return { success: true, error: null, deletedFileId: normalizedFileId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nepodařilo se smazat soubor.',
      deletedFileId: null,
    }
  }
}
