import 'server-only'

import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { z } from 'zod'
import { fetchPowerOutageSource, parseSourceJson } from './source-http'

const EGD_OUTAGES_PAGE_URL = 'https://www.egd.cz/odstavky-elektrina'
const EGD_CONFIG_PASSWORD = 'sdkaM87sZaLNQCpM'
const EGD_ALLOWED_API_ORIGIN = 'https://api.egd.cz'
const EGD_EDGE_REGION = 'eu-central-1'
// Hodnoty jsou veřejnou runtime konfigurací stránky EG.D, nikoli privátními
// přihlašovacími údaji. Slouží pouze jako fallback, pokud EG.D zablokuje IP
// produkčního serveru ještě před stažením veřejného HTML.
const EGD_FALLBACK_API_URL_ENCRYPTED = 'kbWiCdDEsscQjA846IB+i4uREhhXplGAqdBvcFGfD8A='
const EGD_FALLBACK_API_TOKEN_ENCRYPTED = 'UfzeedON5iYaplMVa6EsK7StcLnqHMPa2faF4e/Gids='
const EGD_BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const EGD_PAGE_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  'User-Agent': EGD_BROWSER_USER_AGENT,
} as const

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

const egdEdgeSourceResponseSchema = z.object({
  ok: z.literal(true),
  source: z.literal('egd'),
  configSource: z.enum(['live-html', 'built-in-fallback']),
  queryScope: z.string().min(1),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  outages: z.array(egdOutageSchema),
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
type EgdRuntimeConfig = {
  endpoint: string
  fallbackReason?: string
}

let cachedRuntimeConfig: (EgdRuntimeConfig & { expiresAt: number }) | null = null

function edgeSourceConfig() {
  const token = process.env.POWER_OUTAGES_EGD_EDGE_TOKEN?.trim()
  if (!token) return null

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (!supabaseUrl) {
    throw new Error('Pro EG.D Edge zdroj chybí NEXT_PUBLIC_SUPABASE_URL.')
  }
  const supabaseOrigin = new URL(supabaseUrl).origin
  const endpoint = new URL(
    process.env.POWER_OUTAGES_EGD_EDGE_URL?.trim()
      || `${supabaseOrigin}/functions/v1/power-outages-egd-probe`,
  )
  if (endpoint.protocol !== 'https:' || endpoint.origin !== supabaseOrigin) {
    throw new Error('EG.D Edge zdroj musí být hostovaný ve stejném Supabase projektu.')
  }
  if (endpoint.pathname !== '/functions/v1/power-outages-egd-probe') {
    throw new Error('EG.D Edge zdroj obsahuje neočekávanou cestu funkce.')
  }
  endpoint.searchParams.set('forceFunctionRegion', EGD_EDGE_REGION)
  return { endpoint: endpoint.toString(), token }
}

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
      gqlField('detail', [
        gqlField('cisloPopisne'),
        gqlField('cisloOrientacni'),
        gqlField('poloha', [gqlField('sirka'), gqlField('delka')]),
      ]),
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

function validateEgdRuntimeConfig(encryptedApiUrl: string, encryptedApiToken: string) {
  const apiBase = decryptEgdRuntimeValue(encryptedApiUrl)
  const apiToken = decryptEgdRuntimeValue(encryptedApiToken)
  const endpoint = new URL(`${apiBase}${apiToken}`)

  if (endpoint.origin !== EGD_ALLOWED_API_ORIGIN) {
    throw new Error('Runtime konfigurace EG.D odkazuje na neočekávaný server.')
  }
  if (!endpoint.pathname.startsWith('/blackout/')) {
    throw new Error('Runtime konfigurace EG.D obsahuje neočekávanou cestu API.')
  }

  return { endpoint: endpoint.toString() }
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
  return validateEgdRuntimeConfig(
    settings.eon.BLACKOUT.api_url,
    settings.eon.BLACKOUT.api_token,
  )
}

function fallbackEgdRuntimeConfig(reason: unknown): EgdRuntimeConfig {
  const encryptedApiUrl = process.env.EGD_BLACKOUT_API_URL_ENCRYPTED?.trim()
    || EGD_FALLBACK_API_URL_ENCRYPTED
  const encryptedApiToken = process.env.EGD_BLACKOUT_API_TOKEN_ENCRYPTED?.trim()
    || EGD_FALLBACK_API_TOKEN_ENCRYPTED
  return {
    ...validateEgdRuntimeConfig(encryptedApiUrl, encryptedApiToken),
    fallbackReason: reason instanceof Error
      ? `Runtime HTML EG.D nebylo dostupné: ${reason.message}`.slice(0, 1_000)
      : 'Runtime HTML EG.D nebylo dostupné.',
  }
}

async function loadEgdRuntimeConfig(): Promise<EgdRuntimeConfig> {
  if (cachedRuntimeConfig && cachedRuntimeConfig.expiresAt > Date.now()) {
    return cachedRuntimeConfig
  }

  let config: EgdRuntimeConfig
  try {
    const page = await fetchPowerOutageSource(EGD_OUTAGES_PAGE_URL, {
      headers: EGD_PAGE_HEADERS,
    })
    if (!page.response.ok) {
      throw new Error(`Veřejná stránka EG.D odpověděla HTTP ${page.response.status}.`)
    }
    config = parseEgdRuntimeConfig(page.text)
  } catch (error) {
    config = fallbackEgdRuntimeConfig(error)
  }

  cachedRuntimeConfig = { ...config, expiresAt: Date.now() + 30 * 60_000 }
  return config
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

async function loadEgdOutagesFromEdge(input: {
  city?: string
  daysAhead?: number
}): Promise<EgdOutageLoadResult | null> {
  const config = edgeSourceConfig()
  if (!config) return null

  const response = await fetchPowerOutageSource(config.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-region': EGD_EDGE_REGION,
    },
    body: JSON.stringify({
      mode: 'source',
      city: input.city?.trim() ?? '',
      daysAhead: input.daysAhead ?? 30,
    }),
  }, { timeoutMs: 55_000, maxBytes: 20 * 1024 * 1024, retryCount: 2 })

  if (!response.response.ok) {
    let detail = ''
    try {
      const parsed = JSON.parse(response.text) as {
        error?: unknown
        api?: { error?: unknown; status?: unknown }
      }
      detail = typeof parsed.error === 'string'
        ? parsed.error
        : typeof parsed.api?.error === 'string'
          ? parsed.api.error
          : typeof parsed.api?.status === 'number'
            ? `API EG.D odpovědělo HTTP ${parsed.api.status}.`
            : ''
    } catch {
      detail = response.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    }
    throw new Error(
      `Supabase Edge zdroj EG.D odpověděl HTTP ${response.response.status}`
      + `${detail ? `: ${detail.slice(0, 300)}` : '.'}`,
    )
  }

  const parsed = egdEdgeSourceResponseSchema.safeParse(
    parseSourceJson(response.text, 'Supabase Edge zdroj EG.D'),
  )
  if (!parsed.success) {
    throw new Error('Supabase Edge zdroj EG.D vrátil neočekávaná data.')
  }

  return {
    outages: parsed.data.outages,
    queryScope: `edge:${parsed.data.queryScope}`,
    dateFrom: parsed.data.dateFrom,
    dateTo: parsed.data.dateTo,
    ...(parsed.data.configSource === 'built-in-fallback'
      ? { fallbackReason: 'Supabase Edge zdroj použil vestavěnou runtime konfiguraci EG.D.' }
      : {}),
  }
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

  const edgeLoaded = await loadEgdOutagesFromEdge({ city, daysAhead })
  if (edgeLoaded) return edgeLoaded

  const config = await loadEgdRuntimeConfig()

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
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
      Origin: 'https://www.egd.cz',
      Referer: `${EGD_OUTAGES_PAGE_URL}/`,
      'User-Agent': EGD_BROWSER_USER_AGENT,
      'Sec-CH-UA': '"Not)A;Brand";v="8", "Chromium";v="140", "Google Chrome";v="140"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      Priority: 'u=1, i',
    },
    body: JSON.stringify({
      operationName: 'filterOutages',
      query: 'query filterOutages($encodedQuery: String!) {\n  processEncodedQuery(encodedQuery: $encodedQuery)\n}',
      variables: { encodedQuery },
    }),
  }, { timeoutMs: 35_000, maxBytes: 16 * 1024 * 1024, retryCount: 3 })
  if (!api.response.ok) {
    const responseHint = api.text
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180)
    const server = api.response.headers.get('server')
    throw new Error(
      `Rozhraní odstávek EG.D odpovědělo HTTP ${api.response.status}`
      + `${server ? ` (server: ${server})` : ''}`
      + `${responseHint ? `: ${responseHint}` : '.'}`,
    )
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
    ...(config.fallbackReason ? { fallbackReason: config.fallbackReason } : {}),
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
