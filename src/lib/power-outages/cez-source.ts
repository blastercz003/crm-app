import 'server-only'

import { z } from 'zod'
import { fetchPowerOutageSource, parseSourceJson } from './source-http'

const CEZ_API_ORIGIN = 'https://api.bezstavy.cz'
const CEZ_ADDRESS_SEARCH_URL = `${CEZ_API_ORIGIN}/address/search`

const cezAddressSchema = z.object({
  id: z.coerce.number().int().positive(),
  postCode: z.coerce.number().int().positive().nullish(),
  town: z.string().min(1),
  townCode: z.coerce.number().int().positive(),
  houseNum: z.union([z.string(), z.number()]).nullish(),
  houseNumType: z.string().nullish(),
  street: z.string().nullish(),
  streetNum: z.union([z.string(), z.number()]).nullish(),
  townPart: z.string().nullish(),
  region: z.string().nullish(),
  district: z.string().nullish(),
  dso: z.string().nullish(),
  lat: z.coerce.number().finite().nullish(),
  lon: z.coerce.number().finite().nullish(),
}).passthrough()

const cezStreetSchema = z.object({
  name: z.string().nullish(),
  house_nums: z.string().nullish(),
  ev_nums: z.string().nullish(),
  street_nums: z.string().nullish(),
}).passthrough()

const cezTownSchema = z.object({
  name: z.string(),
  code: z.coerce.number().int(),
  district: z.string().nullish(),
  town_districts: z.array(z.object({
    town_parts: z.array(z.object({
      name: z.string().nullish(),
      streets: z.array(cezStreetSchema).nullish(),
    }).passthrough()).nullish(),
  }).passthrough()).nullish(),
  cadastral_territories: z.array(z.unknown()).nullish(),
}).passthrough()

const cezOutageSchema = z.object({
  id: z.union([z.string(), z.number()]),
  announcement_key: z.string().nullish(),
  opened_at: z.string().min(1),
  fix_expected_at: z.string().min(1),
  addresses: z.object({
    towns: z.array(cezTownSchema).nullish(),
    orphan_territories: z.unknown().nullish(),
  }).passthrough().nullish(),
}).passthrough()

const cezInspectionSchema = z.object({
  outages: z.array(cezOutageSchema).nullish(),
  outages_in_town: z.array(cezOutageSchema).nullish(),
}).passthrough()

export type CezAddress = z.infer<typeof cezAddressSchema>
export type CezOutage = z.infer<typeof cezOutageSchema>
export type CezInspection = z.infer<typeof cezInspectionSchema>

export type CezStoreLookup = {
  id: string
  city: string
  address: string
  verifiedAddressId?: number | null
  verifiedTownCode?: number | null
  distributor?: 'cez' | 'egd' | 'unknown' | null
}

export type CezCatalogLoadResult = {
  outages: CezOutage[]
  searchedStoreCount: number
  coveredTownCount: number
  skippedStoreCount: number
  inspectedAddressCount: number
}

function normalizeProbeQuery(value: string) {
  const query = value.trim().replace(/\s+/g, ' ')
  if (query.length < 3 || query.length > 160) {
    throw new Error('ČEZ diagnostika vyžaduje adresní dotaz o délce 3 až 160 znaků.')
  }
  return query
}

export async function searchCezAddresses(queryInput: string) {
  const query = normalizeProbeQuery(queryInput)
  const url = new URL(CEZ_ADDRESS_SEARCH_URL)
  url.searchParams.set('q', query)

  const { response, text } = await fetchPowerOutageSource(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Vyhledávání adres ČEZ odpovědělo HTTP ${response.status}.`)
  }

  return z.array(cezAddressSchema).parse(
    parseSourceJson(text, 'Vyhledávání adres ČEZ'),
  )
}

export async function inspectCezAddress(addressId: number) {
  if (!Number.isSafeInteger(addressId) || addressId <= 0) {
    throw new Error('Identifikátor adresy ČEZ není platný.')
  }

  const url = `${CEZ_API_ORIGIN}/cezd/api/inspectaddress/${addressId}`
  const { response, text } = await fetchPowerOutageSource(url, {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Kontrola odstávek ČEZ odpověděla HTTP ${response.status}.`)
  }

  return cezInspectionSchema.parse(
    parseSourceJson(text, 'Kontrola odstávek ČEZ'),
  )
}

function normalizeLookupValue(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function isCezDistributionAddress(address: CezAddress) {
  return normalizeLookupValue(address.dso).includes('cez')
}

function chooseAddress(
  candidates: CezAddress[],
  store: CezStoreLookup,
) {
  const city = normalizeLookupValue(store.city)
  const street = normalizeLookupValue(store.address).replace(/\s+\d.*$/, '')
  return candidates.find((candidate) => (
    normalizeLookupValue(candidate.town) === city
    && street.length > 0
    && normalizeLookupValue(candidate.street) === street
  )) ?? candidates.find((candidate) => (
    normalizeLookupValue(candidate.town) === city
  )) ?? null
}

export function chooseCezAddress(
  candidates: CezAddress[],
  store: CezStoreLookup,
) {
  return chooseAddress(candidates.filter(isCezDistributionAddress), store)
}

export function chooseDistributionAddress(
  candidates: CezAddress[],
  store: CezStoreLookup,
) {
  return chooseAddress(candidates, store)
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let cursor = 0

  async function worker() {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(values[index])
      // Veřejné rozhraní není zatěžováno okamžitou sérií dalších požadavků.
      await new Promise((resolve) => setTimeout(resolve, 180))
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), values.length) },
      () => worker(),
    ),
  )
  return results
}

/**
 * ČEZ neposkytuje veřejný export celého území. Katalog proto prohledáváme přes
 * existující adresy prodejen a každé nalezené město kontrolujeme pouze jednou.
 */
export async function loadCezOutagesForStoreCatalog(
  stores: CezStoreLookup[],
  options: { concurrency?: number } = {},
): Promise<CezCatalogLoadResult> {
  const uniqueStores = [...new Map(
    stores
      .filter((store) => store.city.trim() && store.address.trim())
      .map((store) => [
        `${normalizeLookupValue(store.city)}:${normalizeLookupValue(store.address)}`,
        store,
      ]),
  ).values()]

  const storesByCity = new Map<string, CezStoreLookup[]>()
  for (const store of uniqueStores) {
    const cityKey = normalizeLookupValue(store.city)
    const group = storesByCity.get(cityKey) ?? []
    group.push(store)
    storesByCity.set(cityKey, group)
  }

  const resolved = await mapWithConcurrency(
    [...storesByCity.values()],
    options.concurrency ?? 3,
    async (cityStores) => {
      if (cityStores.every((store) => store.distributor === 'egd')) {
        return { address: null, attemptedCount: 0 }
      }
      const verified = cityStores.find((store) => (
        store.distributor === 'cez'
        && Number.isSafeInteger(store.verifiedAddressId)
        && Number.isSafeInteger(store.verifiedTownCode)
      ))
      if (verified?.verifiedAddressId && verified.verifiedTownCode) {
        return {
          address: {
            id: verified.verifiedAddressId,
            town: verified.city,
            townCode: verified.verifiedTownCode,
            street: null,
            dso: 'ČEZ Distribuce',
          } as CezAddress,
          attemptedCount: 0,
        }
      }
      let attemptedCount = 0
      for (const store of cityStores) {
        attemptedCount += 1
        const candidates = await searchCezAddresses(`${store.address}, ${store.city}`)
        const address = chooseCezAddress(candidates, store)
        if (address) return { address, attemptedCount }
      }
      return { address: null, attemptedCount }
    },
  )

  const selectedByTown = new Map<number, CezAddress>()
  for (const item of resolved) {
    if (item.address && !selectedByTown.has(item.address.townCode)) {
      selectedByTown.set(item.address.townCode, item.address)
    }
  }

  const inspections = await mapWithConcurrency(
    [...selectedByTown.values()],
    options.concurrency ?? 3,
    (address) => inspectCezAddress(address.id),
  )

  const outagesById = new Map<string, CezOutage>()
  for (const inspection of inspections) {
    for (const outage of [
      ...(inspection.outages ?? []),
      ...(inspection.outages_in_town ?? []),
    ]) {
      outagesById.set(String(outage.id), outage)
    }
  }

  return {
    outages: [...outagesById.values()],
    searchedStoreCount: resolved.reduce((sum, item) => sum + item.attemptedCount, 0),
    coveredTownCount: selectedByTown.size,
    skippedStoreCount: resolved.filter((item) => !item.address).length,
    inspectedAddressCount: inspections.length,
  }
}

function countCezAffectedStreets(
  outages: z.infer<typeof cezOutageSchema>[],
) {
  const unique = new Set<string>()
  for (const outage of outages) {
    for (const town of outage.addresses?.towns ?? []) {
      for (const district of town.town_districts ?? []) {
        for (const townPart of district.town_parts ?? []) {
          for (const street of townPart.streets ?? []) {
            unique.add(`${town.code}:${townPart.name ?? ''}:${street.name ?? ''}`)
          }
        }
      }
    }
  }
  return unique.size
}

export async function probeCezSource(input: {
  query: string
  addressId?: number | null
}) {
  const startedAt = Date.now()
  const addresses = await searchCezAddresses(input.query)
  const selected = input.addressId
    ? addresses.find((address) => address.id === input.addressId)
    : addresses[0]

  if (!selected) {
    throw new Error(
      input.addressId
        ? 'Požadovaný identifikátor nebyl mezi výsledky hledání ČEZ.'
        : 'ČEZ pro zadaný dotaz nenalezl žádnou adresu.',
    )
  }

  const inspection = await inspectCezAddress(selected.id)
  const exactOutages = inspection.outages ?? []
  const townOutages = inspection.outages_in_town ?? []
  const allOutages = [...exactOutages, ...townOutages]

  return {
    source: 'cez' as const,
    ok: true as const,
    durationMs: Date.now() - startedAt,
    contract: 'cez-public-address-v1',
    addressSearchResultCount: addresses.length,
    selectedAddress: {
      id: selected.id,
      town: selected.town,
      townCode: selected.townCode,
      townPart: selected.townPart ?? null,
      district: selected.district ?? null,
      distributor: selected.dso ?? null,
    },
    exactOutageCount: exactOutages.length,
    townOutageCount: townOutages.length,
    affectedStreetCount: countCezAffectedStreets(allOutages),
    announcementCount: allOutages.filter((outage) => outage.announcement_key).length,
  }
}
