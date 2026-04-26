export const OFFER_SERVICE_PRESETS = [
  'Pronájem DA',
  'Doprava',
  'Kabeláž',
  'Instal. / deinstal.',
  'Odborná obsluha',
  'PHM',
  'Tankování',
] as const

export const OFFER_SERVICE_PRESET_ALIASES: Record<string, string> = {
  'Připojovací kabeláž': 'Kabeláž',
  'Připojení a odpojení': 'Instal. / deinstal.',
}

export const OFFER_DEPOT_PRESETS = [
  'PRAHA',
  'FRENŠTÁT p. R.',
  'HUMPOLEC',
  'KARLOVY VARY',
  'BRNO',
] as const

export const BSAFE24_BACKUP_LOCATION_PRESETS = ['ANO', 'NE'] as const

export const BSAFE24_BACKUP_LOCATION_COUNT_PRESETS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
] as const

export const BSAFE24_DEPOT_PRESETS = ['5 VÝJEZDOVÝCH DEP V ČR'] as const

export const OFFER_SERVICE_GROUP_LABEL = 'Služby'
export const OFFER_DEPOT_GROUP_LABEL = 'Depo'
export const OFFER_ITEM_SECTION_NOTE_GROUP_LABEL = 'Poznámka sekce položek'
export const BSAFE24_BACKUP_LOCATION_GROUP_LABEL = 'Současná záloha lokalit'
export const BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL = 'Počet lokalit'
