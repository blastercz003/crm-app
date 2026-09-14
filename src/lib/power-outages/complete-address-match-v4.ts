export const COMPLETE_ADDRESS_MATCH_CONTRACT = 'complete-address-match-v4' as const
export const COMPLETE_ADDRESS_MATCH_VERSION = 4

export type CompleteAddressMatchV4Target = {
  municipality: string
  municipalityCode?: string | null
  townPart?: string | null
  street?: string | null
  houseNumber?: string | null
  orientationNumber?: string | null
  buildingNumberPairs?: Array<{
    houseNumber?: string | null
    orientationNumber?: string | null
  }> | null
  postalCode?: string | null
  ruianAddressId?: number | string | null
  latitude?: number | null
  longitude?: number | null
}

export type CompleteAddressMatchV4Candidate = {
  displayAddress: string
  postalCode?: string | null
  ruianAddressId?: number | string | null
  latitude?: number | null
  longitude?: number | null
}

export type CompleteAddressMatchV4Result = {
  contract: typeof COMPLETE_ADDRESS_MATCH_CONTRACT
  version: typeof COMPLETE_ADDRESS_MATCH_VERSION
  classification: 'exact_address' | 'same_building' | 'needs_external_verification' | 'address_conflict'
  automaticConfirmationAllowed: boolean
  confidenceCeiling: number
  reasonCodes: string[]
  distanceMeters: number | null
  normalizedTargetPostalCode: string | null
  normalizedCandidatePostalCode: string | null
  meaningfulStreet: string | null
}

type BuildingNumberPair = {
  houseNumber: string | null
  orientationNumber: string | null
}

function normalizeAddressText(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .replace(/\b(?:ulice|ul)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function normalizeCode(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits || null
}

export function normalizeCompletePostalCode(value: unknown) {
  const match = String(value ?? '').match(/(?:^|\D)(\d{3})\s?(\d{2})(?:\D|$)/)
  return match ? `${match[1]}${match[2]}` : null
}

function normalizeBuildingNumber(value: unknown) {
  const match = String(value ?? '').trim().toLocaleLowerCase('cs-CZ').match(/^0*(\d+)([a-z]?)$/i)
  if (!match) return null
  const number = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(number) && number > 0 ? `${number}${match[2] ?? ''}` : null
}

function meaningfulStreet(target: CompleteAddressMatchV4Target) {
  const street = normalizeAddressText(target.street)
  const municipality = normalizeAddressText(target.municipality)
  const townPart = normalizeAddressText(target.townPart)
  if (!street || street === municipality || street === townPart) return null
  return street
}

function containsNormalizedPhrase(value: string, phrase: string) {
  if (!phrase) return false
  const haystack = ` ${normalizeAddressText(value)} `
  return haystack.includes(` ${phrase} `)
}

function candidateNumberPairs(displayAddress: string) {
  const withoutPostalCode = displayAddress.replace(/(?:^|\D)\d{3}\s?\d{2}(?=\D|$)/g, ' ')
  const pairs: BuildingNumberPair[] = []
  for (const match of withoutPostalCode.matchAll(/(?:^|[^\p{L}\d])0*(\d+[a-z]?)(?:\s*\/\s*0*(\d+[a-z]?))?(?=$|[^\p{L}\d])/giu)) {
    const pair = {
      houseNumber: normalizeBuildingNumber(match[1]),
      orientationNumber: normalizeBuildingNumber(match[2]),
    }
    if (pair.houseNumber || pair.orientationNumber) pairs.push(pair)
  }
  return pairs
}

function buildingMatch(target: CompleteAddressMatchV4Target, candidateAddress: string) {
  const targetPairs = [
    { houseNumber: target.houseNumber, orientationNumber: target.orientationNumber },
    ...(target.buildingNumberPairs ?? []),
  ].map((pair) => ({
    houseNumber: normalizeBuildingNumber(pair.houseNumber),
    orientationNumber: normalizeBuildingNumber(pair.orientationNumber),
  })).filter((pair) => pair.houseNumber || pair.orientationNumber)
  const uniqueTargetPairs = [...new Map(targetPairs.map((pair) => [
    `${pair.houseNumber ?? ''}|${pair.orientationNumber ?? ''}`,
    pair,
  ])).values()]
  if (uniqueTargetPairs.length === 0) return 'missing_target' as const

  const candidates = candidateNumberPairs(candidateAddress)
  if (candidates.length === 0) return 'missing_candidate' as const
  let sameBuilding = false
  for (const targetPair of uniqueTargetPairs) {
    if (targetPair.houseNumber && targetPair.orientationNumber) {
      if (candidates.some((pair) => (
        pair.houseNumber === targetPair.houseNumber
        && pair.orientationNumber === targetPair.orientationNumber
      ))) return 'exact' as const
      if (candidates.some((pair) => pair.houseNumber === targetPair.houseNumber)) sameBuilding = true
      continue
    }
    const expected = targetPair.houseNumber ?? targetPair.orientationNumber
    if (candidates.some((pair) => (
      pair.houseNumber === expected || pair.orientationNumber === expected
    ))) return 'exact' as const
  }
  return sameBuilding ? 'same_building' as const : 'conflict' as const
}

function finiteCoordinate(value: unknown, minimum: number, maximum: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null
}

function distanceMeters(
  left: Pick<CompleteAddressMatchV4Target, 'latitude' | 'longitude'>,
  right: Pick<CompleteAddressMatchV4Candidate, 'latitude' | 'longitude'>,
) {
  const lat1 = finiteCoordinate(left.latitude, -90, 90)
  const lon1 = finiteCoordinate(left.longitude, -180, 180)
  const lat2 = finiteCoordinate(right.latitude, -90, 90)
  const lon2 = finiteCoordinate(right.longitude, -180, 180)
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return null

  const radians = (value: number) => value * Math.PI / 180
  const latitudeDelta = radians(lat2 - lat1)
  const longitudeDelta = radians(lon2 - lon1)
  const value = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(longitudeDelta / 2) ** 2
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value)))
}

function result(
  classification: CompleteAddressMatchV4Result['classification'],
  reasonCodes: string[],
  context: Pick<CompleteAddressMatchV4Result, 'distanceMeters' | 'normalizedTargetPostalCode' | 'normalizedCandidatePostalCode' | 'meaningfulStreet'>,
): CompleteAddressMatchV4Result {
  const automaticConfirmationAllowed = classification === 'exact_address' || classification === 'same_building'
  return {
    contract: COMPLETE_ADDRESS_MATCH_CONTRACT,
    version: COMPLETE_ADDRESS_MATCH_VERSION,
    classification,
    automaticConfirmationAllowed,
    confidenceCeiling: classification === 'exact_address'
      ? 0.98
      : classification === 'same_building'
        ? 0.92
        : classification === 'needs_external_verification'
          ? 0.68
          : 0.2,
    reasonCodes: [...new Set(reasonCodes)],
    ...context,
  }
}

export function evaluateCompleteAddressMatchV4(input: {
  target: CompleteAddressMatchV4Target
  candidate: CompleteAddressMatchV4Candidate
}): CompleteAddressMatchV4Result {
  const target = input.target
  const candidate = input.candidate
  const targetPostalCode = normalizeCompletePostalCode(target.postalCode)
  const candidatePostalCode = normalizeCompletePostalCode(candidate.postalCode)
    ?? normalizeCompletePostalCode(candidate.displayAddress)
  const street = meaningfulStreet(target)
  const distance = distanceMeters(target, candidate)
  const context = {
    distanceMeters: distance,
    normalizedTargetPostalCode: targetPostalCode,
    normalizedCandidatePostalCode: candidatePostalCode,
    meaningfulStreet: street,
  }
  const targetRuian = normalizeCode(target.ruianAddressId)
  const candidateRuian = normalizeCode(candidate.ruianAddressId)

  if (targetRuian && candidateRuian) {
    return targetRuian === candidateRuian
      ? result('exact_address', ['ruian_address_id_match'], context)
      : result('address_conflict', ['ruian_address_id_mismatch'], context)
  }
  if (targetPostalCode && candidatePostalCode && targetPostalCode !== candidatePostalCode) {
    return result('address_conflict', ['postal_code_mismatch'], context)
  }

  const municipality = normalizeAddressText(target.municipality)
  if (!municipality || !containsNormalizedPhrase(candidate.displayAddress, municipality)) {
    return result('address_conflict', ['municipality_mismatch'], context)
  }
  if (street && !containsNormalizedPhrase(candidate.displayAddress, street)) {
    return result('address_conflict', ['street_mismatch'], context)
  }
  if (distance !== null && distance > 500) {
    return result('address_conflict', ['coordinate_distance_too_large'], context)
  }

  const numberMatch = buildingMatch(target, candidate.displayAddress)
  if (numberMatch === 'conflict') return result('address_conflict', ['building_number_mismatch'], context)
  if (numberMatch === 'missing_target' || numberMatch === 'missing_candidate') {
    return result('needs_external_verification', [`building_number_${numberMatch}`], context)
  }
  const hasStrongLocalityIdentity = Boolean(
    targetPostalCode && candidatePostalCode && targetPostalCode === candidatePostalCode,
  ) || (distance !== null && distance <= 150)
    || Boolean(
      targetPostalCode
      && !candidatePostalCode
      && numberMatch === 'exact'
      && distance !== null
      && distance <= 500,
    )
  if (!hasStrongLocalityIdentity) {
    return result('needs_external_verification', [
      targetPostalCode ? 'candidate_postal_code_missing' : 'strong_locality_identity_missing',
    ], context)
  }

  if (!street) {
    return result(
      numberMatch === 'same_building' ? 'same_building' : 'exact_address',
      [
        'numbered_locality_match',
        targetPostalCode && candidatePostalCode
          ? 'postal_code_match'
          : distance !== null && distance <= 150
            ? 'coordinate_match'
            : 'coordinate_supported_number_match',
      ],
      context,
    )
  }
  return result(
    numberMatch === 'same_building' ? 'same_building' : 'exact_address',
    [
      'municipality_match',
      'street_match',
      'building_number_match',
      targetPostalCode && candidatePostalCode
        ? 'postal_code_match'
        : distance !== null && distance <= 150
          ? 'coordinate_match'
          : 'coordinate_supported_number_match',
    ],
    context,
  )
}
