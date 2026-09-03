import 'server-only'

import { unzipSync } from 'fflate'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizePowerOutageText } from './normalization'
import { fetchPowerOutageSource } from './source-http'

const RUIAN_MUNICIPALITY_URL = 'https://services.cuzk.cz/sestavy/cis/UI_OBEC.zip'
const RUIAN_ADDRESS_INDEX_URL = 'https://services.cuzk.cz/atom-index/RUIAN-CSV-ADR-OB/5513/'
const RUIAN_ADDRESS_ORIGIN = 'https://vdp.cuzk.gov.cz'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type MunicipalityRow = {
  municipality_code: string
  municipality_name: string
  municipality_name_normalized: string
  district_code: string | null
  source_valid_on: string
  is_active: boolean
}

type MunicipalityCandidate = {
  municipality_code: string
  municipality_name: string
  metadata: Record<string, unknown> | null
  representative_attempt_count: number
}

type RepresentativeAddress = {
  addressCode: string
  municipalityCode: string
  municipalityName: string
  townPart: string | null
  street: string | null
  buildingType: string | null
  houseNumber: string
  orientationNumber: string | null
  orientationSuffix: string | null
  postalCode: string | null
  sjtskY: number | null
  sjtskX: number | null
}

function normalizeMunicipalityName(value: string) {
  const normalized = normalizePowerOutageText(value)
  if (normalized) return normalized

  // Sdílený normalizátor odstraňuje samostatné slovo „ulice“. Obec Úlice je
  // proto jediný platný název RÚIAN, který by jinak skončil prázdným řetězcem.
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
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
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => worker(),
  ))
  return results
}

function parseCsvLine(line: string) {
  const fields: string[] = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ';' && !quoted) {
      fields.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }
  fields.push(value.trim())
  return fields
}

function csvRows(value: string) {
  return value
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseCsvLine)
}

function unzipSingleCsv(body: ArrayBuffer, encoding: 'utf-8' | 'windows-1250') {
  const entries = unzipSync(new Uint8Array(body))
  const csvEntry = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.csv'))
  if (!csvEntry) throw new Error('Archiv RÚIAN neobsahuje očekávaný CSV soubor.')
  return new TextDecoder(encoding).decode(csvEntry[1])
}

function sourceDate(response: Response) {
  const lastModified = response.headers.get('last-modified')
  const parsed = lastModified ? new Date(lastModified) : new Date()
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10)
}

async function upsertMunicipalities(client: ServiceClient, rows: MunicipalityRow[]) {
  for (const batch of chunks(rows, 500)) {
    const { error } = await client
      .from('complete_power_outage_cez_municipalities')
      .upsert(batch, { onConflict: 'municipality_code' })
    if (error) throw error
  }
}

export async function importCompleteCezMunicipalityCatalog() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro import katalogu obcí RÚIAN.')

  const { response, body } = await fetchPowerOutageSource(
    RUIAN_MUNICIPALITY_URL,
    { headers: { Accept: 'application/zip' } },
    { timeoutMs: 60_000, maxBytes: 2 * 1024 * 1024, retryCount: 3, decodeText: false },
  )
  if (!response.ok) throw new Error(`Číselník obcí RÚIAN odpověděl HTTP ${response.status}.`)

  const rows = csvRows(unzipSingleCsv(body, 'windows-1250'))
  const header = rows.shift()
  if (!header || header[0] !== 'KOD' || header[1] !== 'NAZEV') {
    throw new Error('Číselník obcí RÚIAN má neočekávanou strukturu.')
  }

  const validOn = sourceDate(response)
  const municipalities = rows
    .filter((row) => /^\d{6}$/.test(row[0] ?? ''))
    .map((row): MunicipalityRow => ({
      municipality_code: row[0],
      municipality_name: row[1],
      municipality_name_normalized: normalizeMunicipalityName(row[1]),
      district_code: row[4] || null,
      source_valid_on: validOn,
      is_active: !(row[8] ?? '').trim(),
    }))

  const activeMunicipalityCount = municipalities.filter((municipality) => municipality.is_active).length
  if (activeMunicipalityCount < 6_000 || activeMunicipalityCount > 7_000) {
    throw new Error(`Číselník RÚIAN obsahuje neočekávaný počet aktivních obcí: ${activeMunicipalityCount}.`)
  }
  await upsertMunicipalities(client, municipalities)

  return {
    status: 'succeeded' as const,
    source: 'UI_OBEC',
    sourceValidOn: validOn,
    municipalityCount: activeMunicipalityCount,
    catalogRowCount: municipalities.length,
  }
}

function addressLinksFromIndex(html: string) {
  const links = new Map<string, { url: string; sourceValidOn: string }>()
  const pattern = /href="(https:\/\/vdp\.cuzk\.gov\.cz\/vymenny_format\/csv\/(\d{8})_OB_(\d{6})_ADR\.csv\.zip)"/g
  for (const match of html.matchAll(pattern)) {
    const rawUrl = match[1]
    const date = match[2]
    const municipalityCode = match[3]
    const url = new URL(rawUrl, RUIAN_ADDRESS_ORIGIN)
    if (url.protocol !== 'https:' || url.hostname !== 'vdp.cuzk.gov.cz') continue
    links.set(municipalityCode, {
      url: url.toString(),
      sourceValidOn: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
    })
  }
  if (links.size < 6_000) {
    throw new Error(`Index adres RÚIAN obsahuje pouze ${links.size} odkazů.`)
  }
  return links
}

function nullableNumber(value: string | undefined) {
  const number = Number(value)
  return value && Number.isFinite(number) ? number : null
}

function chooseRepresentativeAddress(csv: string, municipality: MunicipalityCandidate) {
  const rows = csvRows(csv)
  const header = rows.shift()
  if (!header || header.length < 19) {
    throw new Error(`Adresní soubor obce ${municipality.municipality_code} má neočekávanou strukturu.`)
  }

  const candidates = rows
    .filter((row) => (
      row[1] === municipality.municipality_code
      && /^\d+$/.test(row[0] ?? '')
      && /^\d+$/.test(row[12] ?? '')
    ))
    .map((row): RepresentativeAddress => ({
      addressCode: row[0],
      municipalityCode: row[1],
      municipalityName: row[2],
      townPart: row[8] || null,
      street: row[10] || null,
      buildingType: row[11] || null,
      houseNumber: row[12],
      orientationNumber: row[13] || null,
      orientationSuffix: row[14] || null,
      postalCode: row[15] || null,
      sjtskY: nullableNumber(row[16]),
      sjtskX: nullableNumber(row[17]),
    }))

  candidates.sort((left, right) => {
    const score = (candidate: RepresentativeAddress) => (
      (candidate.buildingType === 'č.p.' ? 100 : 0)
      + (candidate.street ? 40 : 0)
      + (candidate.orientationNumber ? 10 : 0)
      + (candidate.postalCode ? 5 : 0)
    )
    return score(right) - score(left)
      || Number(left.addressCode) - Number(right.addressCode)
  })
  return candidates[0] ?? null
}

async function loadRepresentativeCandidates(client: ServiceClient, limit: number) {
  const { data, error } = await client
    .from('complete_power_outage_cez_municipalities')
    .select('municipality_code,municipality_name,metadata,representative_attempt_count')
    .eq('is_active', true)
    .in('representative_status', ['pending', 'error'])
    .or(`representative_next_attempt_at.is.null,representative_next_attempt_at.lte.${new Date().toISOString()}`)
    .order('municipality_code')
    .limit(limit)
  if (error) throw error
  return (data ?? []) as MunicipalityCandidate[]
}

async function representativeQueueCounts(client: ServiceClient) {
  const [queueResult, reviewResult, noAddressResult] = await Promise.all([
    client
      .from('complete_power_outage_cez_municipalities')
      .select('municipality_code', { count: 'exact', head: true })
      .eq('is_active', true)
      .in('representative_status', ['pending', 'error']),
    client
      .from('complete_power_outage_cez_municipalities')
      .select('municipality_code', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('representative_status', 'needs_review'),
    client
      .from('complete_power_outage_cez_municipalities')
      .select('municipality_code', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('representative_status', 'no_address'),
  ])
  if (queueResult.error) throw queueResult.error
  if (reviewResult.error) throw reviewResult.error
  if (noAddressResult.error) throw noAddressResult.error
  return {
    queueRemainingCount: queueResult.count ?? 0,
    reviewRemainingCount: reviewResult.count ?? 0,
    noAddressCount: noAddressResult.count ?? 0,
    remainingCount: (queueResult.count ?? 0) + (reviewResult.count ?? 0),
  }
}

export async function importCompleteCezRepresentativeAddresses(requestedLimit = 100) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro import reprezentativních adres RÚIAN.')
  const limit = Math.min(250, Math.max(1, Math.trunc(requestedLimit)))
  const candidates = await loadRepresentativeCandidates(client, limit)
  if (candidates.length === 0) {
    const counts = await representativeQueueCounts(client)
    return {
      status: 'no_change' as const,
      processedCount: 0,
      resolvedCount: 0,
      errorCount: 0,
      reviewCount: 0,
      ...counts,
    }
  }

  const { response: indexResponse, text: indexHtml } = await fetchPowerOutageSource(
    RUIAN_ADDRESS_INDEX_URL,
    { headers: { Accept: 'text/html' } },
    { timeoutMs: 60_000, maxBytes: 2 * 1024 * 1024, retryCount: 3 },
  )
  if (!indexResponse.ok) throw new Error(`Index adres RÚIAN odpověděl HTTP ${indexResponse.status}.`)
  const links = addressLinksFromIndex(indexHtml)

  const results = await mapWithConcurrency(candidates, 4, async (municipality) => {
    const source = links.get(municipality.municipality_code)
    if (!source) {
      return {
        municipality,
        source: null,
        representative: null,
        retryable: true,
        error: 'Adresní soubor není v indexu RÚIAN.',
      }
    }
    try {
      const { response, body } = await fetchPowerOutageSource(
        source.url,
        { headers: { Accept: 'application/zip' } },
        { timeoutMs: 60_000, maxBytes: 8 * 1024 * 1024, retryCount: 3, decodeText: false },
      )
      if (!response.ok) throw new Error(`RÚIAN odpověděl HTTP ${response.status}.`)
      const representative = chooseRepresentativeAddress(
        unzipSingleCsv(body, 'windows-1250'),
        municipality,
      )
      return {
        municipality,
        source,
        representative,
        retryable: false,
        error: representative ? null : 'Obec nemá použitelné adresní místo.',
      }
    } catch (error) {
      return {
        municipality,
        source,
        representative: null,
        retryable: true,
        error: error instanceof Error ? error.message : 'Import adresního místa selhal.',
      }
    }
  })

  const now = new Date().toISOString()
  const resolved = results.filter((result) => result.representative && result.source)
  for (const batch of chunks(resolved, 200)) {
    const rows = batch.map(({ municipality, representative, source }) => ({
      municipality_code: municipality.municipality_code,
      municipality_name: municipality.municipality_name,
      municipality_name_normalized: normalizeMunicipalityName(municipality.municipality_name),
      representative_address_code: representative!.addressCode,
      representative_street: representative!.street,
      representative_house_number: representative!.houseNumber,
      representative_orientation_number: representative!.orientationNumber
        ? `${representative!.orientationNumber}${representative!.orientationSuffix ?? ''}`
        : null,
      representative_postal_code: representative!.postalCode,
      representative_sjtsk_y: representative!.sjtskY,
      representative_sjtsk_x: representative!.sjtskX,
      representative_status: 'resolved',
      representative_attempt_count: municipality.representative_attempt_count + 1,
      representative_last_attempt_at: now,
      representative_next_attempt_at: null,
      representative_error_message: null,
      source_valid_on: source!.sourceValidOn,
      metadata: {
        ...(municipality.metadata ?? {}),
        ruianAddressImport: {
          importedAt: now,
          sourceUrl: source!.url,
          townPart: representative!.townPart,
          buildingType: representative!.buildingType,
        },
      },
    }))
    const { error } = await client
      .from('complete_power_outage_cez_municipalities')
      .upsert(rows, { onConflict: 'municipality_code' })
    if (error) throw error
  }

  for (const result of results.filter((item) => item.error)) {
    const { error } = await client
      .from('complete_power_outage_cez_municipalities')
      .update({
        representative_status: result.retryable ? 'error' : 'no_address',
        representative_attempt_count: result.municipality.representative_attempt_count + 1,
        representative_last_attempt_at: now,
        representative_next_attempt_at: result.retryable
          ? new Date(Date.now() + 6 * 60 * 60_000).toISOString()
          : null,
        representative_error_message: result.error,
        metadata: {
          ...(result.municipality.metadata ?? {}),
          ruianAddressImport: {
            importedAt: now,
            sourceUrl: result.source?.url ?? null,
            error: result.error,
          },
        },
      })
      .eq('municipality_code', result.municipality.municipality_code)
    if (error) throw error
  }

  const counts = await representativeQueueCounts(client)

  return {
    status: results.some((result) => result.error) ? 'partial' as const : 'succeeded' as const,
    processedCount: results.length,
    resolvedCount: resolved.length,
    errorCount: results.filter((result) => result.error && result.retryable).length,
    reviewCount: 0,
    skippedNoAddressCount: results.filter((result) => result.error && !result.retryable).length,
    ...counts,
  }
}

export async function importCompleteCezRuian(input: {
  phase: 'catalog' | 'representatives' | 'all'
  limit?: number
}) {
  const result: Record<string, unknown> = { phase: input.phase }
  if (input.phase === 'catalog' || input.phase === 'all') {
    result.catalog = await importCompleteCezMunicipalityCatalog()
  }
  if (input.phase === 'representatives' || input.phase === 'all') {
    result.representatives = await importCompleteCezRepresentativeAddresses(input.limit)
  }
  return result
}
