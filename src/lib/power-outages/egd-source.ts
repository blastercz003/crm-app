import 'server-only'

import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { z } from 'zod'
import { fetchPowerOutageSource, parseSourceJson } from './source-http'

const EGD_OUTAGES_PAGE_URL = 'https://www.egd.cz/odstavky-elektrina'
const EGD_CONFIG_PASSWORD = 'sdkaM87sZaLNQCpM'
const EGD_ALLOWED_API_ORIGIN = 'https://api.egd.cz'

const egdDrupalSettingsSchema = z.object({
  eon: z.object({
    BLACKOUT: z.object({
      api_url: z.string().min(1),
      api_token: z.string().min(1),
    }),
  }),
}).passthrough()

const egdAddressSchema = z.object({
  psc: z.string().nullish(),
  obec: z.string().nullish(),
  ulice: z.string().nullish(),
  castObce: z.string().nullish(),
  stredUlice: z.object({
    sirka: z.coerce.number().finite().nullish(),
    delka: z.coerce.number().finite().nullish(),
  }).passthrough().nullish(),
  detail: z.array(z.object({
    cisloOrientacni: z.union([z.string(), z.number()]).nullish(),
    cisloPopisne: z.union([z.string(), z.number()]).nullish(),
    poloha: z.object({
      sirka: z.coerce.number().finite().nullish(),
      delka: z.coerce.number().finite().nullish(),
    }).passthrough().nullish(),
  }).passthrough()).nullish(),
}).passthrough()

const egdOutageSchema = z.object({
  cislo: z.union([z.string(), z.number()]),
  popis: z.string().nullish(),
  stav: z.string().nullish(),
  terminy: z.array(z.object({
    datumOd: z.string().min(1),
    datumDo: z.string().min(1),
    stav: z.string().nullish(),
  }).passthrough()).nullish(),
  adresy: z.array(egdAddressSchema).nullish(),
}).passthrough()

const egdListResponseSchema = z.object({
  odstavky: z.object({
    list: z.object({
      data: z.array(egdOutageSchema),
    }).passthrough(),
  }).passthrough(),
}).passthrough()

export type EgdAddress = z.infer<typeof egdAddressSchema>
export type EgdOutage = z.infer<typeof egdOutageSchema>

export type EgdOutageLoadResult = {
  outages: EgdOutage[]
  queryScope: string
  dateFrom: string
  dateTo: string
  fallbackReason?: string
}

type GraphQlNode = Record<string, unknown>

function gqlName(value: string): GraphQlNode {
  return { kind: 'Name', value }
}

function gqlField(name: string, children?: GraphQlNode[]): GraphQlNode {
  return {
    kind: 'Field',
    name: gqlName(name),
    arguments: [],
    directives: [],
    ...(children
      ? { selectionSet: { kind: 'SelectionSet', selections: children } }
      : {}),
  }
}

function gqlFragmentSpread(name: string): GraphQlNode {
  return {
    kind: 'FragmentSpread',
    name: gqlName(name),
    directives: [],
  }
}

function gqlFragmentDefinition(
  name: string,
  typeName: string,
  fields: GraphQlNode[],
): GraphQlNode {
  return {
    kind: 'FragmentDefinition',
    name: gqlName(name),
    typeCondition: { kind: 'NamedType', name: gqlName(typeName) },
    directives: [],
    selectionSet: { kind: 'SelectionSet', selections: fields },
  }
}

function buildEgdQueryDocument(): GraphQlNode {
  return {
    kind: 'Document',
    definitions: [{
      kind: 'OperationDefinition',
      operation: 'query',
      name: gqlName('filterOutages'),
      variableDefinitions: [{
        kind: 'VariableDefinition',
        variable: { kind: 'Variable', name: gqlName('filter') },
        type: {
          kind: 'NonNullType',
          type: { kind: 'NamedType', name: gqlName('OdstavkyFilter') },
        },
        directives: [],
      }],
      directives: [],
      selectionSet: {
        kind: 'SelectionSet',
        selections: [{
          ...gqlField('odstavky', [{
            ...gqlField('list', [gqlField('data', [
              gqlFragmentSpread('ExtendedOutageInfo'),
              gqlField('terminy', [
                gqlFragmentSpread('BasicTermInfo'),
                gqlFragmentSpread('TermStateInfo'),
              ]),
              gqlField('adresy', [
                gqlFragmentSpread('AddressFields'),
                gqlFragmentSpread('StreetLocation'),
              ]),
            ])]),
            arguments: [{
              kind: 'Argument',
              name: gqlName('filter'),
              value: { kind: 'Variable', name: gqlName('filter') },
            }],
          }]),
        }],
      },
    },
    gqlFragmentDefinition('AddressFields', 'OdstavkaAdresa', [
      gqlField('psc'),
      gqlField('obec'),
      gqlField('ulice'),
      gqlField('castObce'),
    ]),
    gqlFragmentDefinition('StreetLocation', 'OdstavkaAdresa', [
      gqlField('stredUlice', [gqlField('sirka'), gqlField('delka')]),
    ]),
    gqlFragmentDefinition('BasicTermInfo', 'OdstavkaTermin', [
      gqlField('datumOd'),
      gqlField('datumDo'),
    ]),
    gqlFragmentDefinition('TermStateInfo', 'OdstavkaTermin', [
      gqlField('stav'),
    ]),
    gqlFragmentDefinition('ExtendedOutageInfo', 'OdstavkaData', [
      gqlField('cislo'),
      gqlField('popis'),
      gqlField('stav'),
    ])],
    loc: { start: 0, end: 1205 },
  }
}

function decryptEgdRuntimeValue(value: string) {
  const derived = pbkdf2Sync(EGD_CONFIG_PASSWORD, '', 5_000, 32, 'md5')
  const decipher = createDecipheriv(
    'aes-128-cbc',
    derived.subarray(0, 16),
    derived.subarray(16, 32),
  )
  return Buffer.concat([
    decipher.update(Buffer.from(value, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function parseEgdRuntimeConfig(html: string) {
  const scriptPattern = /<script[^>]+data-drupal-selector=["']drupal-settings-json["'][^>]*>([\s\S]*?)<\/script>/i
  const match = html.match(scriptPattern)
  if (!match?.[1]) {
    throw new Error('Veřejná stránka EG.D neobsahuje očekávanou runtime konfiguraci.')
  }

  const settings = egdDrupalSettingsSchema.parse(
    parseSourceJson(match[1], 'Runtime konfigurace EG.D'),
  )
  const apiBase = decryptEgdRuntimeValue(settings.eon.BLACKOUT.api_url)
  const apiToken = decryptEgdRuntimeValue(settings.eon.BLACKOUT.api_token)
  const endpoint = new URL(`${apiBase}${apiToken}`)

  if (endpoint.origin !== EGD_ALLOWED_API_ORIGIN) {
    throw new Error('Runtime konfigurace EG.D odkazuje na neočekávaný server.')
  }
  if (!endpoint.pathname.startsWith('/blackout/')) {
    throw new Error('Runtime konfigurace EG.D obsahuje neočekávanou cestu API.')
  }

  return { endpoint: endpoint.toString() }
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function encodeEgdQuery(value: unknown) {
  const base64 = Buffer.from(JSON.stringify(value), 'utf8').toString('base64')
  return Buffer.from(base64, 'utf8').toString('hex').split('').reverse().join('')
}

function unwrapEgdResponse(value: unknown) {
  if (Array.isArray(value)) {
    const first = value[0]
    const isGraphQlBatch = Boolean(
      first
      && typeof first === 'object'
      && ('data' in first || 'errors' in first),
    )
    if (!isGraphQlBatch) {
      return { odstavky: { list: { data: value } } }
    }
  }

  const responseEnvelope = Array.isArray(value) ? value[0] : value
  if (
    responseEnvelope
    && typeof responseEnvelope === 'object'
    && 'data' in responseEnvelope
  ) {
    const directData = (responseEnvelope as { data?: unknown }).data
    if (
      directData
      && typeof directData === 'object'
      && 'odstavky' in directData
    ) {
      return directData
    }
  }

  const outer = z.object({
    data: z.object({ processEncodedQuery: z.unknown() }).nullish(),
    errors: z.array(z.object({ message: z.string() }).passthrough()).nullish(),
  }).passthrough().parse(responseEnvelope)

  if (outer.errors?.length) {
    throw new Error(`EG.D GraphQL: ${outer.errors[0].message}`)
  }
  const processed = outer.data?.processEncodedQuery
  if (processed == null) {
    throw new Error('EG.D nevrátil očekávaná data odstávek.')
  }

  const decoded = typeof processed === 'string'
    ? parseSourceJson(processed, 'Data odstávek EG.D')
    : processed

  // Veřejný resolver EG.D může vrátit buď původní GraphQL obálku, nebo již
  // rozbalené pole `list.data`. Obě varianty pocházejí ze stejného dotazu.
  return Array.isArray(decoded)
    ? { odstavky: { list: { data: decoded } } }
    : decoded
}

function describePayloadShape(value: unknown, depth = 0): string {
  if (depth >= 3) return Array.isArray(value) ? 'array' : typeof value
  if (Array.isArray(value)) {
    return `array(${value.length})${value.length ? `[${describePayloadShape(value[0], depth + 1)}]` : ''}`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 8)
    return `{${entries.map(([key, nested]) => `${key}:${describePayloadShape(nested, depth + 1)}`).join(',')}}`
  }
  return value === null ? 'null' : typeof value
}

export async function loadEgdOutages(input: {
  city?: string
  daysAhead?: number
}): Promise<EgdOutageLoadResult> {
  const city = input.city?.trim().replace(/\s+/g, ' ') ?? ''
  if (city.length > 120) {
    throw new Error('Název obce pro EG.D může mít nejvýše 120 znaků.')
  }
  const daysAhead = Math.min(90, Math.max(1, Math.round(input.daysAhead ?? 30)))

  const page = await fetchPowerOutageSource(EGD_OUTAGES_PAGE_URL, {
    headers: { Accept: 'text/html' },
  })
  if (!page.response.ok) {
    throw new Error(`Veřejná stránka EG.D odpověděla HTTP ${page.response.status}.`)
  }
  const config = parseEgdRuntimeConfig(page.text)

  const dateFrom = new Date()
  const dateTo = new Date(dateFrom)
  dateTo.setUTCDate(dateTo.getUTCDate() + daysAhead)
  const filter = {
    fulltext: { obec: city, psc: '', ean: '', cislo: '', ulice: '' },
    datumOd: formatDate(dateFrom),
    datumDo: formatDate(dateTo),
    platne: false,
  }
  const encodedQuery = encodeEgdQuery({
    query: buildEgdQueryDocument(),
    variables: { filter },
  })

  const api = await fetchPowerOutageSource(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      operationName: 'filterOutages',
      query: 'query filterOutages($encodedQuery: String!) {\n  processEncodedQuery(encodedQuery: $encodedQuery)\n}',
      variables: { encodedQuery },
    }),
  }, { timeoutMs: 35_000, maxBytes: 16 * 1024 * 1024 })
  if (!api.response.ok) {
    throw new Error(`Rozhraní odstávek EG.D odpovědělo HTTP ${api.response.status}.`)
  }

  const unwrapped = unwrapEgdResponse(
    parseSourceJson(api.text, 'Rozhraní odstávek EG.D'),
  )
  const parsedPayload = egdListResponseSchema.safeParse(unwrapped)
  if (!parsedPayload.success) {
    throw new Error(
      `EG.D vrátil neočekávanou datovou obálku ${describePayloadShape(unwrapped)}.`,
    )
  }
  return {
    outages: parsedPayload.data.odstavky.list.data,
    queryScope: city || 'whole-distribution-area',
    dateFrom: filter.datumOd,
    dateTo: filter.datumDo,
  }
}

export async function loadEgdOutagesWithCityFallback(input: {
  daysAhead?: number
  cities: string[]
}) {
  try {
    return await loadEgdOutages({ daysAhead: input.daysAhead })
  } catch (wholeAreaError) {
    const cities = [...new Set(
      input.cities.map((city) => city.trim()).filter(Boolean),
    )]
    if (cities.length === 0) throw wholeAreaError

    const outages = new Map<string, EgdOutage>()
    let dateFrom = ''
    let dateTo = ''
    for (const city of cities) {
      const loaded = await loadEgdOutages({ city, daysAhead: input.daysAhead })
      dateFrom ||= loaded.dateFrom
      dateTo ||= loaded.dateTo
      for (const outage of loaded.outages) {
        const key = String(outage.cislo)
        const existing = outages.get(key)
        if (!existing) {
          outages.set(key, outage)
          continue
        }
        const addresses = [...(existing.adresy ?? []), ...(outage.adresy ?? [])]
        const terms = [...(existing.terminy ?? []), ...(outage.terminy ?? [])]
        outages.set(key, {
          ...existing,
          adresy: [...new Map(addresses.map((address) => [
            JSON.stringify({
              psc: address.psc ?? null,
              obec: address.obec ?? null,
              ulice: address.ulice ?? null,
              castObce: address.castObce ?? null,
            }),
            address,
          ])).values()],
          terminy: [...new Map(terms.map((term) => [
            `${term.datumOd}|${term.datumDo}`,
            term,
          ])).values()],
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 220))
    }

    return {
      outages: [...outages.values()],
      queryScope: `city-fallback:${cities.length}`,
      dateFrom,
      dateTo,
      fallbackReason: wholeAreaError instanceof Error
        ? wholeAreaError.message.slice(0, 1_000)
        : 'Celoplošný dotaz EG.D selhal.',
    } satisfies EgdOutageLoadResult
  }
}

export async function probeEgdSource(input: {
  city?: string
  daysAhead?: number
}) {
  const startedAt = Date.now()
  const loaded = await loadEgdOutages(input)
  const outages = loaded.outages
  const uniqueCities = new Set<string>()
  let termCount = 0
  let addressGroupCount = 0
  let buildingCount = 0
  for (const outage of outages) {
    termCount += outage.terminy?.length ?? 0
    for (const address of outage.adresy ?? []) {
      addressGroupCount += 1
      buildingCount += address.detail?.length ?? 0
      if (address.obec) uniqueCities.add(address.obec)
    }
  }

  return {
    source: 'egd' as const,
    ok: true as const,
    durationMs: Date.now() - startedAt,
    contract: 'egd-public-map-v1',
    queryScope: loaded.queryScope,
    dateFrom: loaded.dateFrom,
    dateTo: loaded.dateTo,
    outageCount: outages.length,
    termCount,
    addressGroupCount,
    buildingCount,
    affectedCityCount: uniqueCities.size,
  }
}
