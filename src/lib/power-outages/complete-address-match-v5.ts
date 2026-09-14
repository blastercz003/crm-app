import {
  evaluateCompleteAddressMatchV4,
  type CompleteAddressMatchV4Candidate,
  type CompleteAddressMatchV4Result,
  type CompleteAddressMatchV4Target,
} from './complete-address-match-v4'

export const COMPLETE_ADDRESS_MATCH_V5_CONTRACT = 'complete-address-match-v5' as const
export const COMPLETE_ADDRESS_MATCH_V5_VERSION = 5

export type CompleteAddressMatchV5Target = CompleteAddressMatchV4Target

export type CompleteAddressMatchV5Candidate = CompleteAddressMatchV4Candidate & {
  houseNumber?: string | number | null
  orientationNumber?: string | number | null
}

export type CompleteAddressMatchV5Result = Omit<
  CompleteAddressMatchV4Result,
  'contract' | 'version'
> & {
  contract: typeof COMPLETE_ADDRESS_MATCH_V5_CONTRACT
  version: typeof COMPLETE_ADDRESS_MATCH_V5_VERSION
}

type NumberPair = {
  houseNumber: string | null
  orientationNumber: string | null
  rolesReliable: boolean
}

function normalizeNumber(value: unknown) {
  const match = String(value ?? '').trim().toLocaleLowerCase('cs-CZ').match(/^0*(\d+)([a-z]?)$/i)
  if (!match) return null
  const number = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(number) && number > 0 ? `${number}${match[2] ?? ''}` : null
}

function targetPairs(target: CompleteAddressMatchV5Target) {
  const values = [
    { houseNumber: target.houseNumber, orientationNumber: target.orientationNumber },
    ...(target.buildingNumberPairs ?? []),
  ].map((pair) => ({
    houseNumber: normalizeNumber(pair.houseNumber),
    orientationNumber: normalizeNumber(pair.orientationNumber),
    rolesReliable: true,
  })).filter((pair) => pair.houseNumber || pair.orientationNumber)

  return [...new Map(values.map((pair) => [
    `${pair.houseNumber ?? ''}|${pair.orientationNumber ?? ''}`,
    pair,
  ])).values()]
}

function parsedCandidatePairs(displayAddress: string) {
  const withoutPostalCode = displayAddress.replace(/(?:^|\D)\d{3}\s?\d{2}(?=\D|$)/g, ' ')
  const values: NumberPair[] = []
  for (const match of withoutPostalCode.matchAll(
    /(?:^|[^\p{L}\d])0*(\d+[a-z]?)(?:\s*\/\s*0*(\d+[a-z]?))?(?=$|[^\p{L}\d])/giu,
  )) {
    values.push({
      houseNumber: normalizeNumber(match[1]),
      orientationNumber: normalizeNumber(match[2]),
      // Lomitko nese obe role. U samostatneho cisla poskytovatel bez
      // strukturovanych poli nerozlisuje cislo popisne od orientacniho.
      rolesReliable: Boolean(match[2]),
    })
  }
  return values
}

function candidatePairs(candidate: CompleteAddressMatchV5Candidate) {
  const explicitHouse = normalizeNumber(candidate.houseNumber)
  const explicitOrientation = normalizeNumber(candidate.orientationNumber)
  if (explicitHouse || explicitOrientation) {
    return [{
      houseNumber: explicitHouse,
      orientationNumber: explicitOrientation,
      rolesReliable: true,
    }]
  }
  return parsedCandidatePairs(candidate.displayAddress)
}

function roleAwareBuildingMatch(
  target: CompleteAddressMatchV5Target,
  candidate: CompleteAddressMatchV5Candidate,
) {
  const expected = targetPairs(target)
  const actual = candidatePairs(candidate)
  if (expected.length === 0 || actual.length === 0) return 'unresolved' as const

  let ambiguousNumberMatch = false
  for (const targetPair of expected) {
    for (const candidatePair of actual) {
      if (targetPair.houseNumber && targetPair.orientationNumber) {
        if (
          candidatePair.rolesReliable
          && candidatePair.houseNumber === targetPair.houseNumber
          && candidatePair.orientationNumber === targetPair.orientationNumber
        ) return 'exact' as const
        if (
          !candidatePair.rolesReliable
          && (
            candidatePair.houseNumber === targetPair.houseNumber
            || candidatePair.houseNumber === targetPair.orientationNumber
          )
        ) ambiguousNumberMatch = true
        continue
      }

      if (targetPair.houseNumber) {
        if (candidatePair.rolesReliable && candidatePair.houseNumber === targetPair.houseNumber) {
          return 'exact' as const
        }
        if (
          !candidatePair.rolesReliable
          && candidatePair.houseNumber === targetPair.houseNumber
        ) ambiguousNumberMatch = true
        continue
      }

      if (targetPair.orientationNumber) {
        if (
          candidatePair.rolesReliable
          && candidatePair.orientationNumber === targetPair.orientationNumber
        ) return 'exact' as const
        if (
          !candidatePair.rolesReliable
          && candidatePair.houseNumber === targetPair.orientationNumber
        ) ambiguousNumberMatch = true
      }
    }
  }

  return ambiguousNumberMatch ? 'unresolved' as const : 'conflict' as const
}

function refinedResult(
  base: CompleteAddressMatchV4Result,
  classification: 'exact_address' | 'needs_external_verification' | 'address_conflict',
  reasonCode: string,
): CompleteAddressMatchV5Result {
  return {
    ...base,
    contract: COMPLETE_ADDRESS_MATCH_V5_CONTRACT,
    version: COMPLETE_ADDRESS_MATCH_V5_VERSION,
    classification,
    automaticConfirmationAllowed: classification === 'exact_address',
    confidenceCeiling: classification === 'exact_address'
      ? base.confidenceCeiling
      : classification === 'needs_external_verification'
        ? 0.68
        : 0.2,
    reasonCodes: classification === 'exact_address'
      ? [...new Set([...base.reasonCodes, reasonCode])]
      : [reasonCode],
  }
}

export function evaluateCompleteAddressMatchV5(input: {
  target: CompleteAddressMatchV5Target
  candidate: CompleteAddressMatchV5Candidate
}): CompleteAddressMatchV5Result {
  const base = evaluateCompleteAddressMatchV4(input)
  const versionedBase: CompleteAddressMatchV5Result = {
    ...base,
    contract: COMPLETE_ADDRESS_MATCH_V5_CONTRACT,
    version: COMPLETE_ADDRESS_MATCH_V5_VERSION,
  }

  // Konflikt PSČ, obce, ulice, RÚIAN nebo vzdálenosti má přednost před
  // číselnou kontrolou a nesmí být změkčen.
  if (base.classification === 'address_conflict') return versionedBase
  if (!base.automaticConfirmationAllowed) return versionedBase

  const roleMatch = roleAwareBuildingMatch(input.target, input.candidate)
  if (roleMatch === 'exact') {
    return refinedResult(base, 'exact_address', 'building_number_roles_match')
  }
  if (roleMatch === 'unresolved') {
    return refinedResult(
      base,
      'needs_external_verification',
      'building_number_roles_unresolved',
    )
  }
  return refinedResult(base, 'address_conflict', 'building_number_roles_mismatch')
}
