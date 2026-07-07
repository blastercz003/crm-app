export type NordFjellaGuestType = 'person' | 'company'

export type NordFjellaRecordType =
  | 'reservation'
  | 'owner_block'
  | 'technical_block'

export type NordFjellaReservationStatus =
  | 'inquiry'
  | 'reserved'
  | 'completed'
  | 'cancelled'

export type NordFjellaSettlementStatus =
  | 'draft'
  | 'in_progress'
  | 'closed'

export type NordFjellaPaymentStatus =
  | 'unpaid'
  | 'deposit_paid'
  | 'partially_paid'
  | 'paid'
  | 'refund_or_overpayment'

export type NordFjellaPaymentMethod = 'bank_transfer' | 'cash'

export type NordFjellaVatMode = 'vat_12' | 'vat_21' | 'vat_exempt'

export type NordFjellaReservationFileDocumentType =
  | 'id_card'
  | 'drivers_license'
  | 'passport'
  | 'other'

export type NordFjellaReservationItemType =
  | 'accommodation'
  | 'cleaning'
  | 'city_tax'
  | 'discount'
  | 'cancellation_fee'
  | 'manual_service'

export type NordFjellaGuestRow = {
  id: string
  guest_type: NordFjellaGuestType
  full_name: string | null
  company_name: string | null
  contact_name: string | null
  email: string
  phone: string
  street: string
  city: string
  postal_code: string
  country: string
  birth_date: string | null
  identity_document_number: string | null
  ico: string | null
  dic: string | null
  note: string | null
  search_text: string
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type NordFjellaReservationRow = {
  id: string
  reservation_number: string
  variable_symbol: string
  record_type: NordFjellaRecordType
  reservation_status: NordFjellaReservationStatus | null
  settlement_status: NordFjellaSettlementStatus
  payment_status: NordFjellaPaymentStatus | null
  guest_id: string | null
  guest_type: NordFjellaGuestType | null
  guest_full_name: string | null
  guest_company_name: string | null
  guest_contact_name: string | null
  guest_email: string | null
  guest_phone: string | null
  guest_street: string | null
  guest_city: string | null
  guest_postal_code: string | null
  guest_country: string | null
  guest_birth_date: string | null
  guest_identity_document_number: string | null
  guest_ico: string | null
  guest_dic: string | null
  stay_start_date: string
  stay_end_date: string
  adult_count: number
  child_count: number
  accommodation_night_rate: number
  accommodation_vat_rate: number
  city_tax_rate: number
  city_tax_person_count: number
  cleaning_fee: number
  cleaning_fee_vat_rate: number
  security_deposit_amount: number
  security_deposit_received: boolean
  security_deposit_received_at: string | null
  security_deposit_refunded_at: string | null
  security_deposit_refund_amount: number | null
  security_deposit_withheld_amount: number | null
  security_deposit_withheld_reason: string | null
  requested_deposit_amount: number | null
  deposit_due_date: string | null
  deposit_paid_amount: number | null
  deposit_paid_at: string | null
  deposit_payment_method: NordFjellaPaymentMethod | null
  balance_paid_amount: number | null
  balance_paid_at: string | null
  balance_payment_method: NordFjellaPaymentMethod | null
  cancellation_fee_amount: number | null
  internal_note: string | null
  public_note: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export type NordFjellaReservationItemRow = {
  id: string
  reservation_id: string
  sort_order: number
  item_type: NordFjellaReservationItemType
  label: string
  quantity: number
  unit: string
  unit_price: number
  vat_mode: NordFjellaVatMode
  note: string | null
  created_at: string
  updated_at: string
}

export type NordFjellaSettingsRow = {
  singleton_key: 'primary'
  object_name: string
  provider_company_name: string
  provider_company_id_number: string
  provider_vat_number: string
  provider_street: string
  provider_city: string
  provider_postal_code: string
  provider_country: string
  provider_email: string
  provider_phone: string
  provider_bank_account: string
  provider_iban: string | null
  provider_swift: string | null
  default_accommodation_vat_rate: number
  default_cleaning_fee: number
  default_security_deposit: number
  default_invoice_due_days: number
  public_note_template: string | null
  created_at: string
  updated_at: string
}

export type NordFjellaReservationFileRow = {
  id: string
  reservation_id: string
  guest_id: string | null
  document_type: NordFjellaReservationFileDocumentType
  file_name: string
  display_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string
  file_size_bytes: number
  uploaded_by: string | null
  created_at: string
  updated_at: string
}
