import 'server-only'

import type { EgdAddress, EgdOutage } from './egd-source'
import type {
  NormalizedPowerOutage,
  NormalizedPowerOutageAddress,
} from './cez-normalizer'
import {
  normalizePowerOutageText,
  parsePowerOutageDate,
  powerOutageAddressKey,
  powerOutageSha256,
  powerOutageStatus,
} from './normalization'

const EGD_PUBLIC_OUTAGE_URL = 'https://www.egd.cz/odstavky-elektrina'

export type NormalizedEgdOutage = Omit<NormalizedPowerOutage, 'source'> & {
  source: 'egd'
}

function optionalText(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value).trim()
  return text || null
}

function normalizeEgdAddress(address: EgdAddress) {
  const municipality = address.obec?.trim() ?? ''
  if (!municipality) return null

  const street = address.ulice?.trim() ?? ''
  const townPart = address.castObce?.trim() || null
  const postalCode = address.psc?.trim() || null
  const details = address.detail ?? []
  const firstDetail = details[0]
  const latitude = address.stredUlice?.sirka
    ?? firstDetail?.poloha?.sirka
    ?? null
  const longitude = address.stredUlice?.delka
    ?? firstDetail?.poloha?.delka
    ?? null
  const houseNumbers = [...new Set(details
    .map((detail) => optionalText(detail.cisloPopisne))
    .filter((value): value is string => Boolean(value)))]
  const orientationNumbers = [...new Set(details
    .map((detail) => optionalText(detail.cisloOrientacni))
    .filter((value): value is string => Boolean(value)))]
  const key = powerOutageAddressKey([
    municipality,
    townPart,
    street,
    postalCode,
  ])

  return {
    externalAddressId: null,
    addressKey: key,
    municipality,
    municipalityCode: null,
    townPart,
    street,
    houseNumber: null,
    orientationNumber: null,
    postalCode,
    rawAddress: [street, townPart, municipality, postalCode]
      .filter(Boolean)
      .join(', '),
    normalizedMunicipality: normalizePowerOutageText(municipality),
    normalizedStreet: normalizePowerOutageText(street),
    latitude,
    longitude,
    metadata: {
      buildingCount: details.length,
      // Úplné množiny jsou nutné pro přesné párování prodejen. Pořadí
      // popisného a orientačního čísla při porovnání nehraje roli.
      houseNumbers,
      orientationNumbers,
      houseNumberSample: houseNumbers.slice(0, 12),
      orientationNumberSample: orientationNumbers.slice(0, 12),
    },
  } satisfies NormalizedPowerOutageAddress
}

function normalizeEgdAddresses(outage: EgdOutage) {
  const addresses = new Map<string, NormalizedPowerOutageAddress>()
  for (const sourceAddress of outage.adresy ?? []) {
    const address = normalizeEgdAddress(sourceAddress)
    if (address) addresses.set(address.addressKey, address)
  }
  return [...addresses.values()]
}

function isCancelledStatus(value: string | null | undefined) {
  const normalized = normalizePowerOutageText(value)
  return normalized.includes('zrus')
    || normalized.includes('storno')
    || normalized.includes('cancel')
}

export function normalizeEgdOutage(
  outage: EgdOutage,
  now = new Date(),
): NormalizedEgdOutage[] {
  const addresses = normalizeEgdAddresses(outage)
  const firstAddress = addresses[0]
  const baseExternalId = String(outage.cislo)
  const terms = outage.terminy ?? []

  return terms.map((term, termIndex) => {
    const startsAt = parsePowerOutageDate(term.datumOd, 'Začátek odstávky EG.D')
    const endsAt = parsePowerOutageDate(term.datumDo, 'Konec odstávky EG.D')
    if (endsAt <= startsAt) {
      throw new Error(`Odstávka EG.D ${baseExternalId} nemá platné časové rozmezí.`)
    }

    const cancelled = isCancelledStatus(term.stav) || isCancelledStatus(outage.stav)
    const externalId = terms.length === 1
      ? baseExternalId
      : `${baseExternalId}:${startsAt.toISOString()}:${endsAt.toISOString()}`

    return {
      source: 'egd',
      externalId,
      sourceStatus: cancelled
        ? 'cancelled'
        : powerOutageStatus(startsAt, endsAt, now),
      title: 'Plánovaná odstávka elektřiny',
      description: outage.popis?.trim() || null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      archiveAt: new Date(endsAt.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
      municipality: firstAddress?.municipality ?? null,
      municipalityCode: null,
      district: null,
      region: null,
      sourceUrl: EGD_PUBLIC_OUTAGE_URL,
      announcementUrl: null,
      payloadSha256: powerOutageSha256({ outage, term, termIndex }),
      sourceUpdatedAt: null,
      metadata: {
        contract: 'egd-public-map-v1',
        outageNumber: baseExternalId,
        outageStatus: outage.stav ?? null,
        termStatus: term.stav ?? null,
        termIndex,
        termCount: terms.length,
        addressCount: addresses.length,
      },
      addresses,
    }
  })
}
