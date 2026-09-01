import 'server-only'

import ExcelJS from 'exceljs'
import { Readable } from 'node:stream'
import { fetchPowerOutageSource } from './source-http'

const PRE_EXPORT_URL = 'https://www.predistribuce.cz/cs/distribucni-sit/stav-distribucni-site/export/'
const EXPECTED_HEADERS = ['Lokalita', 'Začátek', 'Konec', 'Provádějící firma', 'Důvod'] as const
const MAX_EXPORT_BYTES = 2 * 1024 * 1024
const MAX_EXPORT_ROWS = 5_000

export type PreOutageRow = {
  locality: string
  startsAtLocal: string
  endsAtLocal: string
  contractor: string | null
  reason: string
  rowNumber: number
}

function cellText(cell: ExcelJS.Cell) {
  return cell.text.replace(/\r\n?/g, '\n').trim()
}

function assertXlsxPayload(body: ArrayBuffer) {
  const bytes = new Uint8Array(body)
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error('Export PRE neobsahuje očekávaný XLSX soubor.')
  }
}

export async function loadPreOutages() {
  const loadedAt = new Date().toISOString()
  const { response, body } = await fetchPowerOutageSource(
    PRE_EXPORT_URL,
    { headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel' } },
    { timeoutMs: 30_000, maxBytes: MAX_EXPORT_BYTES, retryCount: 2, decodeText: false },
  )
  if (!response.ok) {
    throw new Error(`Export plánovaných odstávek PRE odpověděl HTTP ${response.status}.`)
  }
  assertXlsxPayload(body)

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.read(Readable.from([new Uint8Array(body)]))
  const worksheet = workbook.worksheets[0]
  if (!worksheet) throw new Error('Export PRE neobsahuje žádný list.')

  const headers = EXPECTED_HEADERS.map((_, index) => cellText(worksheet.getRow(1).getCell(index + 1)))
  if (headers.some((header, index) => header !== EXPECTED_HEADERS[index])) {
    throw new Error(`Export PRE změnil strukturu sloupců (${headers.join(', ')}).`)
  }

  const rows: PreOutageRow[] = []
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const locality = cellText(row.getCell(1))
    const startsAtLocal = cellText(row.getCell(2))
    const endsAtLocal = cellText(row.getCell(3))
    const contractor = cellText(row.getCell(4)) || null
    const reason = cellText(row.getCell(5))
    if (!locality && !startsAtLocal && !endsAtLocal && !reason) return
    if (!locality || !startsAtLocal || !endsAtLocal || !reason) {
      throw new Error(`Řádek ${rowNumber} exportu PRE neobsahuje povinné údaje.`)
    }
    rows.push({ locality, startsAtLocal, endsAtLocal, contractor, reason, rowNumber })
  })

  if (rows.length === 0) {
    throw new Error('Export PRE je prázdný; stávající data proto nebyla změněna.')
  }
  if (rows.length > MAX_EXPORT_ROWS) {
    throw new Error(`Export PRE překročil bezpečnostní limit ${MAX_EXPORT_ROWS} záznamů.`)
  }

  return {
    source: 'pre' as const,
    sourceUrl: PRE_EXPORT_URL,
    contract: 'pre-public-xlsx-v1',
    loadedAt,
    responseBytes: body.byteLength,
    rows,
  }
}

export async function probePreSource() {
  const loaded = await loadPreOutages()
  return {
    source: 'pre' as const,
    ok: true as const,
    contract: loaded.contract,
    recordCount: loaded.rows.length,
    responseBytes: loaded.responseBytes,
    firstTerm: loaded.rows[0]?.startsAtLocal ?? null,
    lastTerm: loaded.rows.at(-1)?.endsAtLocal ?? null,
  }
}
