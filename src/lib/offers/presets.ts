export const OFFER_SERVICE_PRESETS = [
  'Pronájem DA',
  'Doprava',
  'Kabeláž',
  'Instal. / deinstal.',
  'Odborná obsluha',
  'PHM',
] as const

export const OFFER_SERVICE_PRESET_ALIASES: Record<string, string> = {
  'Připojovací kabeláž': 'Kabeláž',
  'Připojení a odpojení': 'Instal. / deinstal.',
}

export const OFFER_DEPOT_PRESETS = [
  'DOLNÍ BŘEŽANY',
  'FRENŠTÁT p. R.',
  'HUMPOLEC',
  'KARLOVY VARY',
  'BRNO',
] as const

export const OFFER_SERVICE_GROUP_LABEL = 'Služby'
export const OFFER_DEPOT_GROUP_LABEL = 'Depo'
