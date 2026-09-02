export type BuildingNumberPair = {
  houseNumber: string | null
  orientationNumber: string | null
}

export function normalizeBuildingNumber(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const match = String(value).trim().toLocaleLowerCase('cs-CZ').match(/^0*(\d+)([a-z]?)$/i)
  if (!match) return null
  const numericPart = Number.parseInt(match[1], 10)
  if (!Number.isSafeInteger(numericPart) || numericPart <= 0) return null
  return `${numericPart}${match[2] ?? ''}`
}

function pairKey(pair: BuildingNumberPair) {
  return `${pair.houseNumber ?? ''}|${pair.orientationNumber ?? ''}`
}

export function buildingNumberPair(
  houseNumber: unknown,
  orientationNumber: unknown,
): BuildingNumberPair | null {
  const normalized = {
    houseNumber: normalizeBuildingNumber(houseNumber),
    orientationNumber: normalizeBuildingNumber(orientationNumber),
  }
  return normalized.houseNumber || normalized.orientationNumber ? normalized : null
}

export function dedupeBuildingNumberPairs(values: BuildingNumberPair[]) {
  return [...new Map(values.map((value) => [pairKey(value), value])).values()]
}

export function trustedBuildingNumberPairs(input: {
  houseNumber?: unknown
  orientationNumber?: unknown
  metadata?: Record<string, unknown> | null
}) {
  const pairs: BuildingNumberPair[] = []
  const direct = buildingNumberPair(input.houseNumber, input.orientationNumber)
  if (direct) pairs.push(direct)

  const storedPairs = input.metadata?.buildingNumberPairs
  if (Array.isArray(storedPairs)) {
    for (const value of storedPairs) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const record = value as Record<string, unknown>
      const pair = buildingNumberPair(record.houseNumber, record.orientationNumber)
      if (pair) pairs.push(pair)
    }
  }
  return dedupeBuildingNumberPairs(pairs)
}

export function displayBuildingNumber(pair: BuildingNumberPair) {
  if (pair.houseNumber && pair.orientationNumber) {
    return `${pair.houseNumber}/${pair.orientationNumber}`
  }
  return pair.houseNumber ?? pair.orientationNumber ?? ''
}

export function legacyNumberEvidenceCount(metadata: Record<string, unknown> | null | undefined) {
  const result = new Set<string>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (typeof value !== 'string' && typeof value !== 'number') return
    for (const match of String(value).matchAll(/\b\d+[a-z]?\b/gi)) {
      const number = normalizeBuildingNumber(match[0])
      if (number) result.add(number)
    }
  }
  visit(metadata?.houseNumbers)
  visit(metadata?.orientationNumbers)
  visit(metadata?.evidenceNumbers)
  return result.size
}
