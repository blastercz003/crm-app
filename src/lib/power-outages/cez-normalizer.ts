import 'server-only'

import type { CezOutage } from './cez-source'
import {
  normalizePowerOutageText,
  parsePowerOutageDate,
  powerOutageAddressKey,
  powerOutageSha256,
  powerOutageStatus,
} from './normalization'
import { cezAnnouncementUrl, powerOutageSourceUrl } from './public-links'

export type NormalizedPowerOutageAddress = {
  externalAddressId: string | null
  addressKey: string
  municipality: string
  municipalityCode: string | null
  townPart: string | null
  street: string
  houseNumber: string | null
  orientationNumber: string | null
  postalCode: string | null
  rawAddress: string
  normalizedMunicipality: string
  normalizedStreet: string
  latitude: number | null
  longitude: number | null
  metadata: Record<string, unknown>
}

export type NormalizedPowerOutage = {
  source: 'cez'
  externalId: string
  sourceStatus: 'scheduled' | 'active' | 'completed' | 'cancelled'
  title: string
  description: string | null
  startsAt: string
  endsAt: string
  archiveAt: string
  municipality: string | null
  municipalityCode: string | null
  district: string | null
  region: string | null
  sourceUrl: string
  announcementUrl: string | null
  payloadSha256: string
  sourceUpdatedAt: string | null
  metadata: Record<string, unknown>
  addresses: NormalizedPowerOutageAddress[]
}

function joinAddress(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ')
}

function normalizeCezAddresses(outage: CezOutage) {
  const result = new Map<string, NormalizedPowerOutageAddress>()

  for (const town of outage.addresses?.towns ?? []) {
    let townHasStreet = false

    for (const district of town.town_districts ?? []) {
      for (const townPart of district.town_parts ?? []) {
        for (const street of townPart.streets ?? []) {
          townHasStreet = true
          const streetName = street.name?.trim() ?? ''
          const key = powerOutageAddressKey([
            String(town.code),
            townPart.name,
            streetName,
          ])
          result.set(key, {
            externalAddressId: null,
            addressKey: key,
            municipality: town.name,
            municipalityCode: String(town.code),
            townPart: townPart.name?.trim() || null,
            street: streetName,
            houseNumber: null,
            orientationNumber: null,
            postalCode: null,
            rawAddress: joinAddress([streetName, townPart.name, town.name]),
            normalizedMunicipality: normalizePowerOutageText(town.name),
            normalizedStreet: normalizePowerOutageText(streetName),
            latitude: null,
            longitude: null,
            metadata: {
              houseNumbers: street.house_nums ?? null,
              evidenceNumbers: street.ev_nums ?? null,
              orientationNumbers: street.street_nums ?? null,
            },
          })
        }
      }
    }

    if (!townHasStreet) {
      const key = powerOutageAddressKey([String(town.code), town.name])
      result.set(key, {
        externalAddressId: null,
        addressKey: key,
        municipality: town.name,
        municipalityCode: String(town.code),
        townPart: null,
        street: '',
        houseNumber: null,
        orientationNumber: null,
        postalCode: null,
        rawAddress: town.name,
        normalizedMunicipality: normalizePowerOutageText(town.name),
        normalizedStreet: '',
        latitude: null,
        longitude: null,
        metadata: { townLevelOnly: true },
      })
    }
  }

  return [...result.values()]
}

export function normalizeCezOutage(
  outage: CezOutage,
  now = new Date(),
): NormalizedPowerOutage {
  const startsAt = parsePowerOutageDate(outage.opened_at, 'Začátek odstávky ČEZ')
  const endsAt = parsePowerOutageDate(outage.fix_expected_at, 'Konec odstávky ČEZ')
  if (endsAt <= startsAt) {
    throw new Error(`Odstávka ČEZ ${String(outage.id)} nemá platné časové rozmezí.`)
  }

  const addresses = normalizeCezAddresses(outage)
  const firstTown = outage.addresses?.towns?.[0]
  const archiveAt = endsAt

  return {
    source: 'cez',
    externalId: String(outage.id),
    sourceStatus: powerOutageStatus(startsAt, endsAt, now),
    title: 'Plánovaná odstávka elektřiny',
    description: null,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    archiveAt: archiveAt.toISOString(),
    municipality: firstTown?.name ?? null,
    municipalityCode: firstTown ? String(firstTown.code) : null,
    district: firstTown?.district ?? null,
    region: null,
    sourceUrl: powerOutageSourceUrl('cez', firstTown ? String(firstTown.code) : null),
    announcementUrl: cezAnnouncementUrl(outage.announcement_key),
    payloadSha256: powerOutageSha256(outage),
    sourceUpdatedAt: null,
    metadata: {
      contract: 'cez-public-address-v1',
      announcementKey: outage.announcement_key ?? null,
      addressCount: addresses.length,
    },
    addresses,
  }
}
