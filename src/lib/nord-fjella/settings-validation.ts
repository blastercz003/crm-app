import type { NordFjellaSettingsRow } from '@/lib/nord-fjella/types'

type SettingsIssue = {
  field: keyof NordFjellaSettingsRow
  label: string
}

const REQUIRED_PROVIDER_FIELDS: SettingsIssue[] = [
  { field: 'provider_company_name', label: 'Název firmy' },
  { field: 'provider_company_id_number', label: 'IČO' },
  { field: 'provider_vat_number', label: 'DIČ' },
  { field: 'provider_street', label: 'Ulice a číslo' },
  { field: 'provider_city', label: 'Město' },
  { field: 'provider_postal_code', label: 'PSČ' },
  { field: 'provider_country', label: 'Země' },
  { field: 'provider_email', label: 'E-mail' },
  { field: 'provider_phone', label: 'Telefon' },
  { field: 'provider_bank_account', label: 'Číslo účtu' },
]

export function getNordFjellaProviderSettingsIssues(settings: NordFjellaSettingsRow | null) {
  if (!settings) {
    return REQUIRED_PROVIDER_FIELDS.map((issue) => issue.label)
  }

  return REQUIRED_PROVIDER_FIELDS.filter((issue) => {
    const value = settings[issue.field]
    return typeof value !== 'string' || value.trim().length === 0
  }).map((issue) => issue.label)
}

export function hasCompleteNordFjellaProviderSettings(settings: NordFjellaSettingsRow | null) {
  return getNordFjellaProviderSettingsIssues(settings).length === 0
}
