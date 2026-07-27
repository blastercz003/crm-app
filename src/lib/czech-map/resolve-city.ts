import 'server-only'

import rawCityLocations from './city-locations.json'

type CityLocationTuple = [
  normalizedName: string,
  displayName: string,
  latitude: number,
  longitude: number,
]

export type ResolvedCzechCity = {
  name: string
  latitude: number
  longitude: number
}

const cityLocations = (
  rawCityLocations as unknown as {
    cities: CityLocationTuple[]
  }
).cities

const cityByNormalizedName = new Map(
  cityLocations.map(([key, name, latitude, longitude]) => [
    key,
    { name, latitude, longitude },
  ])
)

const LARGE_CITY_NAMES = [
  'praha',
  'brno',
  'ostrava',
  'plzen',
  'liberec',
  'olomouc',
  'ceske budejovice',
  'hradec kralove',
  'usti nad labem',
  'pardubice',
  'zlin',
  'havirov',
  'kladno',
  'most',
  'opava',
  'frydek mistek',
  'jihlava',
  'teplice',
  'decin',
  'karlovy vary',
] as const

const PLACE_ALIASES: Record<string, string> = {
  'ceske budejovice c': 'ceske budejovice',
  'dvur kralove': 'dvur kralove nad labem',
  'frydek mistek': 'frydek mistek',
  'hradec kralove': 'hradec kralove',
  'karlovy vary': 'karlovy vary',
  'mlada boleslav': 'mlada boleslav',
  plzen: 'pilsen',
  praha: 'prague',
  'usti n l': 'usti nad labem',
  'usti nad lab': 'usti nad labem',
  'val mezirici': 'valasske mezirici',
  'zdirec nad doubravou': 'zdirec nad doubravkou',
}

export function normalizeCzechPlaceName(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function findCity(normalizedName: string) {
  if (!normalizedName) return null

  const alias = PLACE_ALIASES[normalizedName] ?? normalizedName
  return cityByNormalizedName.get(alias) ?? null
}

function getCityCandidates(address: string) {
  const cityPart = String(address)
    .split(',')[0]
    ?.replace(/\([^)]*\)/g, ' ')
    .trim() ?? ''
  const normalizedCity = normalizeCzechPlaceName(cityPart)
  const expandedCity = normalizedCity
    .replace(/\bn\b/g, 'nad')
    .replace(/\bp\b/g, 'pod')
  const withoutContextPrefix = expandedCity
    .replace(/^depo\s+/, '')
    .replace(/^csob\s+/, '')
    .replace(/^vojenske muzeum\s+/, '')
  const candidates = new Set<string>([
    normalizedCity,
    expandedCity,
    withoutContextPrefix,
    normalizedCity.replace(/\s+\d+[a-z]?$/, ''),
    expandedCity.replace(/\s+\d+[a-z]?$/, ''),
  ])

  if (expandedCity.includes(' u ')) {
    candidates.add(expandedCity.split(' u ')[0])
  }

  const hyphenParts = cityPart
    .split(/\s*[-–—]\s*/)
    .map(normalizeCzechPlaceName)
    .filter(Boolean)

  if (hyphenParts.length > 1) {
    candidates.add(hyphenParts[hyphenParts.length - 1])
    candidates.add(hyphenParts[0])
  }

  for (const largeCity of LARGE_CITY_NAMES) {
    if (
      normalizedCity === largeCity ||
      normalizedCity.startsWith(`${largeCity} `)
    ) {
      candidates.add(largeCity)
    }
  }

  return candidates
}

export function resolveCzechCityFromAddress(
  address: string | null | undefined
): ResolvedCzechCity | null {
  const normalizedAddress = String(address ?? '').trim()

  if (!normalizedAddress) return null

  for (const candidate of getCityCandidates(normalizedAddress)) {
    const city = findCity(candidate)

    if (city) return city
  }

  return null
}
