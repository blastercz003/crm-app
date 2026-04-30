export type OfferStatus =
  | 'draft'
  | 'submitted'
  | 'changes_requested'
  | 'approved'
  | 'sent_to_client'
  | 'ordered'
  | 'rejected'

export type OfferType = 'classic' | 'bsafe24'

export type OfferRow = {
  id: string
  offer_number: string
  client_id: string
  client_contact_id: string | null
  created_by: string
  last_edited_by: string | null
  approver_user_id: string | null
  title: string
  offer_type: OfferType
  status: OfferStatus
  current_version: number
  submitted_version: number | null
  approved_version: number | null
  currency: string
  valid_until: string | null
  project_name: string | null
  realization_address: string | null
  realization_starts_at: string | null
  realization_ends_at: string | null
  contact_person: string | null
  prepared_by_name: string | null
  prepared_by_phone: string | null
  prepared_by_email: string | null
  intro_note: string | null
  internal_note: string | null
  terms_note: string | null
  rejection_comment: string | null
  submitted_at: string | null
  approved_at: string | null
  rejected_at: string | null
  created_at: string
  updated_at: string
}

export type OfferItemRow = {
  id: string
  offer_id: string
  position: number
  item_section: string
  description: string
  specification: string | null
  quantity: number
  unit: string
  unit_price_without_vat: number
  planned_unit_price_without_vat: number | null
  discount_percent: number
  vat_rate: number
  created_at: string
  updated_at: string
}

export type OfferServiceItemRow = {
  id: string
  offer_id: string
  position: number
  service_name: string
  specification: string | null
  operation: string | null
  created_at: string
  updated_at: string
}

export type OfferClient = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_email: string | null
  address: string | null
  created_by?: string | null
}

export type OfferClientContact = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

export type OfferProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_offers: boolean | null
  offer_prepared_by_name: string | null
  offer_prepared_by_phone: string | null
  offer_prepared_by_email: string | null
}
