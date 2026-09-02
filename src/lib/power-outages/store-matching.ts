import 'server-only'

import { normalizePowerOutageText } from './normalization'

export type MatchableStore = {
  id: string
  chainName: string
  storeNumber: string
  city: string
  address: string
  addressNumbers: string[]
}

export type MatchableOutageAddress = {
  id: string
  outageId: string
  municipality: string
  townPart: string | null
  street: string
  normalizedMunicipality: string
  normalizedStreet: string
  addressNumbers: string[]
}

export type PowerOutageStoreMatchCandidate = {
  outageId: string
  outageAddressId: string
  store: MatchableStore
  matchStatus: 'confirmed' | 'needs_review'
  confidence: number
  reasons: string[]
}

function normalizeStreet(value: string) {
  return normalizePowerOutageText(value.split(',')[0] ?? value)
    .replace(/^(?:nam|namesti)\s+/, 'namesti ')
    .replace(/^(?:tr|trida)\s+/, 'trida ')
    .replace(/\s+\d+[a-z]?(?:\s+\d+[a-z]?)?$/, '')
    .trim()
}

function normalizedAddressNumbers(values: string[]) {
  return new Set(
    values
      .map((value) => normalizePowerOutageText(value).replace(/\s+/g, ''))
      .filter(Boolean),
  )
}

function canonicalMunicipality(value: string) {
  const normalized = normalizePowerOutageText(value)
    .replace(/^hlavni mesto\s+/, '')
  if (normalized === 'praha' || normalized.startsWith('praha ')) return 'praha'
  return normalized
}

function municipalityVariants(value: string, townPart?: string | null) {
  const variants = new Set<string>()
  const municipality = canonicalMunicipality(value)
  const part = canonicalMunicipality(townPart ?? '')
  if (municipality) variants.add(municipality)
  if (part) variants.add(part)
  if (municipality === 'praha' || municipality.startsWith('praha ')) {
    variants.add('praha')
  }
  return variants
}

function storeMunicipality(value: string) {
  return canonicalMunicipality(value)
}

export async function buildPowerOutageStoreMatches(
  stores: MatchableStore[],
  addresses: MatchableOutageAddress[],
  options: {
    batchSize?: number
    onProgress?: (processedAddressCount: number, totalAddressCount: number) => Promise<void>
  } = {},
) {
  const batchSize = Math.max(25, Math.trunc(options.batchSize ?? 250))
  const reportProgress = async (processedAddressCount: number) => {
    if (
      options.onProgress
      && (processedAddressCount % batchSize === 0 || processedAddressCount === addresses.length)
    ) {
      await options.onProgress(processedAddressCount, addresses.length)
    }
  }
  const storesByMunicipality = new Map<string, MatchableStore[]>()
  for (const store of stores) {
    const municipality = storeMunicipality(store.city)
    if (!municipality) continue
    const existing = storesByMunicipality.get(municipality) ?? []
    existing.push(store)
    storesByMunicipality.set(municipality, existing)
  }

  const bestByOutageStore = new Map<string, PowerOutageStoreMatchCandidate>()
  for (let addressIndex = 0; addressIndex < addresses.length; addressIndex += 1) {
    const address = addresses[addressIndex]
    const variants = municipalityVariants(
      address.normalizedMunicipality || address.municipality,
      address.townPart,
    )
    const candidateStores = new Map<string, MatchableStore>()
    for (const variant of variants) {
      for (const store of storesByMunicipality.get(variant) ?? []) {
        candidateStores.set(store.id, store)
      }
    }

    const outageStreet = normalizeStreet(address.normalizedStreet || address.street)
    // Záznam bez konkrétní ulice nesmí vytvořit shodu pro všechny prodejny
    // ve městě. Takové zdrojové záznamy zůstávají pouze v importovaném katalogu.
    if (!outageStreet) {
      await reportProgress(addressIndex + 1)
      continue
    }
    const outageNumbers = normalizedAddressNumbers(address.addressNumbers)

    for (const store of candidateStores.values()) {
      const storeStreet = normalizeStreet(store.address)
      const exactStreet = Boolean(outageStreet && storeStreet === outageStreet)
      if (!exactStreet) continue

      const storeNumbers = normalizedAddressNumbers(store.addressNumbers)
      const matchingNumbers = [...storeNumbers]
        .filter((value) => outageNumbers.has(value))
      if (
        storeNumbers.size > 0
        && outageNumbers.size > 0
        && matchingNumbers.length === 0
      ) {
        continue
      }

      const allStoreNumbersMatch = storeNumbers.size > 0
        && outageNumbers.size > 0
        && matchingNumbers.length === storeNumbers.size
      const partialNumberMatch = matchingNumbers.length > 0 && !allStoreNumbersMatch
      const matchStatus = allStoreNumbersMatch ? 'confirmed' : 'needs_review'

      const candidate: PowerOutageStoreMatchCandidate = {
        outageId: address.outageId,
        outageAddressId: address.id,
        store,
        matchStatus,
        confidence: allStoreNumbersMatch
          ? 1
          : partialNumberMatch
            ? 0.9
            : storeNumbers.size === 0
              ? 0.78
              : 0.72,
        reasons: [
          'municipality_exact',
          'street_exact',
          ...(allStoreNumbersMatch
            ? ['address_numbers_exact', 'auto_confirmed']
            : partialNumberMatch
              ? ['address_numbers_partial', 'manual_confirmation_required']
              : storeNumbers.size === 0
                ? ['store_address_numbers_missing', 'manual_confirmation_required']
                : ['source_address_numbers_missing', 'manual_confirmation_required']),
        ],
      }
      const key = `${candidate.outageId}:${store.id}`
      const previous = bestByOutageStore.get(key)
      if (!previous || candidate.confidence > previous.confidence) {
        bestByOutageStore.set(key, candidate)
      }
    }

    await reportProgress(addressIndex + 1)
  }

  return [...bestByOutageStore.values()]
}
