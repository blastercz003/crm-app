import 'server-only'

import { normalizePowerOutageText } from './normalization'

export type MatchableStore = {
  id: string
  chainName: string
  storeNumber: string
  city: string
  address: string
}

export type MatchableOutageAddress = {
  id: string
  outageId: string
  municipality: string
  townPart: string | null
  street: string
  normalizedMunicipality: string
  normalizedStreet: string
}

export type PowerOutageStoreMatchCandidate = {
  outageId: string
  outageAddressId: string
  store: MatchableStore
  matchStatus: 'needs_review'
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

export function buildPowerOutageStoreMatches(
  stores: MatchableStore[],
  addresses: MatchableOutageAddress[],
) {
  const storesByMunicipality = new Map<string, MatchableStore[]>()
  for (const store of stores) {
    const municipality = storeMunicipality(store.city)
    if (!municipality) continue
    const existing = storesByMunicipality.get(municipality) ?? []
    existing.push(store)
    storesByMunicipality.set(municipality, existing)
  }

  const bestByOutageStore = new Map<string, PowerOutageStoreMatchCandidate>()
  for (const address of addresses) {
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
    for (const store of candidateStores.values()) {
      const storeStreet = normalizeStreet(store.address)
      const exactStreet = Boolean(outageStreet && storeStreet === outageStreet)
      if (outageStreet && !exactStreet) continue

      const candidate: PowerOutageStoreMatchCandidate = {
        outageId: address.outageId,
        outageAddressId: address.id,
        store,
        // Automatická shoda města a ulice je dostatečná pro zobrazení
        // odstávky, ale zůstává K OVĚŘENÍ. Potvrdit ji může až uživatel.
        matchStatus: 'needs_review',
        confidence: exactStreet ? 0.9 : 0.55,
        reasons: exactStreet
          ? ['municipality_exact', 'street_exact', 'manual_confirmation_required']
          : ['municipality_exact', 'source_street_missing', 'manual_review_required'],
      }
      const key = `${candidate.outageId}:${store.id}`
      const previous = bestByOutageStore.get(key)
      if (!previous || candidate.confidence > previous.confidence) {
        bestByOutageStore.set(key, candidate)
      }
    }
  }

  return [...bestByOutageStore.values()]
}
