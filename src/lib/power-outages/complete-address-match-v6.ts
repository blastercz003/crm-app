import {
  evaluateCompleteAddressMatchV4,
  normalizeCompletePostalCode,
  type CompleteAddressMatchV4Candidate,
  type CompleteAddressMatchV4Result,
  type CompleteAddressMatchV4Target,
} from './complete-address-match-v4'

export const COMPLETE_ADDRESS_MATCH_V6_CONTRACT = 'complete-address-match-v6' as const
export const COMPLETE_ADDRESS_MATCH_V6_VERSION = 6

export type CompleteAddressMatchV6Target = CompleteAddressMatchV4Target

export type CompleteAddressMatchV6Candidate = CompleteAddressMatchV4Candidate & {
  houseNumber?: string | number | null
  orientationNumber?: string | number | null
}

export type CompleteAddressMatchV6Result = Omit<
  CompleteAddressMatchV4Result,
  'contract' | 'version'
> & {
  contract: typeof COMPLETE_ADDRESS_MATCH_V6_CONTRACT
  version: typeof COMPLETE_ADDRESS_MATCH_V6_VERSION
}

type NumberPair = {
  houseNumber: string | null
  orientationNumber: string | null
  rolesReliable: boolean
}

type NumberMatch = 'exact_role' | 'exact_value' | 'unresolved' | 'conflict'

function normalizeNumber(value: unknown) {
  const match = String(value ?? '').trim().toLocaleLowerCase('cs-CZ').match(/^0*(\d+)([a-z]?)$/i)
  if (!match) return null
  const number = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(number) && number > 0 ? `${number}${match[2] ?? ''}` : null
}

function normalizeCode(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits || null
}

function targetPairs(target: CompleteAddressMatchV6Target) {
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
      rolesReliable: Boolean(match[2]),
    })
  }
  return values
}

function candidatePairs(candidate: CompleteAddressMatchV6Candidate) {
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
  target: CompleteAddressMatchV6Target,
  candidate: CompleteAddressMatchV6Candidate,
): NumberMatch {
  const expected = targetPairs(target)
  const actual = candidatePairs(candidate)
  if (expected.length === 0 || actual.length === 0) return 'unresolved'

  let valueMatch = false
  let incompletePairMatch = false
  for (const targetPair of expected) {
    for (const candidatePair of actual) {
      // A complete EG.D pair is an indivisible address identity. It must never
      // be confirmed from a match against just one half of the pair.
      if (targetPair.houseNumber && targetPair.orientationNumber) {
        if (
          candidatePair.rolesReliable
          && candidatePair.houseNumber === targetPair.houseNumber
          && candidatePair.orientationNumber === targetPair.orientationNumber
        ) return 'exact_role'
        if (
          !candidatePair.rolesReliable
          && (
            candidatePair.houseNumber === targetPair.houseNumber
            || candidatePair.houseNumber === targetPair.orientationNumber
          )
        ) incompletePairMatch = true
        continue
      }

      // A single number in an EG.D notice can denote either Czech address
      // number role. With a hard locality identity it is safe to compare its
      // value against both structured candidate roles.
      const expectedNumber = targetPair.houseNumber ?? targetPair.orientationNumber
      if (!expectedNumber) continue
      if (candidatePair.rolesReliable) {
        const sameRole = targetPair.houseNumber
          ? candidatePair.houseNumber === expectedNumber
          : candidatePair.orientationNumber === expectedNumber
        if (sameRole) return 'exact_role'
        if (
          candidatePair.houseNumber === expectedNumber
          || candidatePair.orientationNumber === expectedNumber
        ) valueMatch = true
      } else if (candidatePair.houseNumber === expectedNumber) {
        valueMatch = true
      }
    }
  }

  if (valueMatch) return 'exact_value'
  return incompletePairMatch ? 'unresolved' : 'conflict'
}

function roleAgnosticIdentityIsSafe(
  target: CompleteAddressMatchV6Target,
  candidate: CompleteAddressMatchV6Candidate,
  base: CompleteAddressMatchV4Result,
) {
  const targetRuian = normalizeCode(target.ruianAddressId)
  const candidateRuian = normalizeCode(candidate.ruianAddressId)
  if (targetRuian && candidateRuian && targetRuian === candidateRuian) return true

  const targetPostalCode = normalizeCompletePostalCode(target.postalCode)
  const candidatePostalCode = normalizeCompletePostalCode(candidate.postalCode)
    ?? normalizeCompletePostalCode(candidate.displayAddress)
  return Boolean(
    base.meaningfulStreet
    && targetPostalCode
    && candidatePostalCode
    && targetPostalCode === candidatePostalCode,
  )
}

function refinedResult(
  base: CompleteAddressMatchV4Result,
  classification: 'exact_address' | 'needs_external_verification' | 'address_conflict',
  reasonCode: string,
): CompleteAddressMatchV6Result {
  return {
    ...base,
    contract: COMPLETE_ADDRESS_MATCH_V6_CONTRACT,
    version: COMPLETE_ADDRESS_MATCH_V6_VERSION,
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

export function evaluateCompleteAddressMatchV6(input: {
  target: CompleteAddressMatchV6Target
  candidate: CompleteAddressMatchV6Candidate
}): CompleteAddressMatchV6Result {
  // V4 accepts optional coordinates, but JavaScript Number(null) is zero.
  // Sanitize absent values here so EG.D v6 never gains false coordinate proof.
  const base = evaluateCompleteAddressMatchV4({
    target: {
      ...input.target,
      latitude: input.target.latitude ?? undefined,
      longitude: input.target.longitude ?? undefined,
    },
    candidate: {
      ...input.candidate,
      latitude: input.candidate.latitude ?? undefined,
      longitude: input.candidate.longitude ?? undefined,
    },
  })
  const versionedBase: CompleteAddressMatchV6Result = {
    ...base,
    contract: COMPLETE_ADDRESS_MATCH_V6_CONTRACT,
    version: COMPLETE_ADDRESS_MATCH_V6_VERSION,
  }

  const numberMatch = roleAwareBuildingMatch(input.target, input.candidate)
  const strongAddressIdentity = roleAgnosticIdentityIsSafe(
    input.target,
    input.candidate,
    base,
  )

  // EG.D target coordinates can represent the centre of a street rather than
  // a building. A coordinate-only conflict therefore cannot veto an otherwise
  // exact street + postal/RUIAN + number identity.
  if (base.classification === 'address_conflict') {
    const coordinateOnlyConflict = base.reasonCodes.length === 1
      && base.reasonCodes[0] === 'coordinate_distance_too_large'
    if (
      coordinateOnlyConflict
      && strongAddressIdentity
      && (numberMatch === 'exact_role' || numberMatch === 'exact_value')
    ) {
      return refinedResult(
        {
          ...base,
          confidenceCeiling: 0.98,
          reasonCodes: ['egd_strong_locality_and_number_match'],
        },
        'exact_address',
        'egd_street_center_distance_ignored',
      )
    }
    return versionedBase
  }
  if (!base.automaticConfirmationAllowed) return versionedBase

  if (numberMatch === 'exact_role') {
    return refinedResult(base, 'exact_address', 'building_number_roles_match')
  }
  if (numberMatch === 'exact_value') {
    return strongAddressIdentity
      ? refinedResult(base, 'exact_address', 'egd_single_number_value_match')
      : refinedResult(base, 'needs_external_verification', 'egd_single_number_identity_insufficient')
  }
  if (numberMatch === 'unresolved') {
    return refinedResult(base, 'needs_external_verification', 'building_number_roles_unresolved')
  }
  return refinedResult(base, 'address_conflict', 'building_number_roles_mismatch')
}
