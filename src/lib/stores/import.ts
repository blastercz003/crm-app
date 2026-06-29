import ExcelJS from 'exceljs'
import { Buffer } from 'node:buffer'

export const STORE_IMPORT_HEADERS = [
  'chain_name',
  'store_number',
  'city',
  'address',
  'phone_1',
  'phone_2',
  'phone_3',
] as const

export const STORE_IMPORT_ALLOWED_CHAINS = [
  'PENNY MARKET',
  'LIDL',
  'ALBERT',
  'BILLA',
] as const

export type StoreImportAllowedChain = (typeof STORE_IMPORT_ALLOWED_CHAINS)[number]

export type StoreImportRow = {
  chain_name: string
  store_number: string
  city: string
  address: string
  phone_1: string
  phone_2: string | null
  phone_3: string | null
  rowNumber: number
}

export type StoreImportRowError = {
  rowNumber: number
  reasons: string[]
  raw: Record<string, string>
}

export type StoreImportParseResult = {
  headers: string[]
  validRows: StoreImportRow[]
  invalidRows: StoreImportRowError[]
  totalRows: number
}

function normalizeCellValue(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value).trim()
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (typeof value === 'object' && value && 'text' in value) {
    const text = (value as { text?: unknown }).text
    return typeof text === 'string' ? text.trim() : String(text ?? '').trim()
  }

  return String(value).trim()
}

function isAllowedChain(value: string): value is StoreImportAllowedChain {
  return STORE_IMPORT_ALLOWED_CHAINS.includes(value as StoreImportAllowedChain)
}

function buildEmptyRawRecord() {
  return {
    chain_name: '',
    store_number: '',
    city: '',
    address: '',
    phone_1: '',
    phone_2: '',
    phone_3: '',
  }
}

export async function parseStoresImportWorkbook(
  fileBuffer: ArrayBuffer,
  expectedChainName: string
): Promise<StoreImportParseResult> {
  const workbook = new ExcelJS.Workbook()
  await (
    workbook.xlsx as unknown as { load: (input: unknown) => Promise<unknown> }
  ).load(Buffer.from(fileBuffer))

  const worksheet = workbook.getWorksheet('Import') ?? workbook.worksheets[0]

  if (!worksheet) {
    throw new Error('Soubor neobsahuje žádný list pro import.')
  }

  const headerRow = worksheet.getRow(1)
  const headers = STORE_IMPORT_HEADERS.map((_, index) =>
    normalizeCellValue(headerRow.getCell(index + 1).value)
  )

  const missingHeaders = STORE_IMPORT_HEADERS.filter(
    (header, index) => headers[index] !== header
  )

  if (missingHeaders.length > 0) {
    throw new Error(
      `Neplatná hlavička importu. Očekávány sloupce: ${STORE_IMPORT_HEADERS.join(', ')}`
    )
  }

  const validRows: StoreImportRow[] = []
  const invalidRows: StoreImportRowError[] = []
  const seenKeys = new Set<string>()

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber)
    const raw = {
      chain_name: normalizeCellValue(row.getCell(1).value),
      store_number: normalizeCellValue(row.getCell(2).value),
      city: normalizeCellValue(row.getCell(3).value),
      address: normalizeCellValue(row.getCell(4).value),
      phone_1: normalizeCellValue(row.getCell(5).value),
      phone_2: normalizeCellValue(row.getCell(6).value),
      phone_3: normalizeCellValue(row.getCell(7).value),
    }

    const isCompletelyEmpty = Object.values(raw).every((value) => value === '')
    if (isCompletelyEmpty) {
      continue
    }

    const reasons: string[] = []

    if (!raw.chain_name) reasons.push('Chybí chain_name.')
    if (!raw.store_number) reasons.push('Chybí store_number.')
    if (!raw.city) reasons.push('Chybí city.')
    if (!raw.phone_1) reasons.push('Chybí phone_1.')

    if (raw.chain_name && !isAllowedChain(raw.chain_name)) {
      reasons.push(
        `Nepovolený chain_name: ${raw.chain_name}. Povolené hodnoty jsou ${STORE_IMPORT_ALLOWED_CHAINS.join(', ')}.`
      )
    }

    if (raw.chain_name && raw.chain_name !== expectedChainName) {
      reasons.push(
        `Řádek patří jinému řetězci (${raw.chain_name}) než vybranému importu (${expectedChainName}).`
      )
    }

    const uniqueKey = `${raw.chain_name}::${raw.store_number}`
    if (
      raw.chain_name &&
      raw.store_number &&
      seenKeys.has(uniqueKey)
    ) {
      reasons.push('Duplicitní chain_name + store_number v tomto souboru.')
    }

    if (reasons.length > 0) {
      invalidRows.push({
        rowNumber,
        reasons,
        raw,
      })
      continue
    }

    seenKeys.add(uniqueKey)
    validRows.push({
      ...raw,
      phone_2: raw.phone_2 || null,
      phone_3: raw.phone_3 || null,
      rowNumber,
    })
  }

  return {
    headers,
    validRows,
    invalidRows,
    totalRows: validRows.length + invalidRows.length,
  }
}

export function emptyStoreImportParseResult(): StoreImportParseResult {
  return {
    headers: [...STORE_IMPORT_HEADERS],
    validRows: [],
    invalidRows: [],
    totalRows: 0,
  }
}

export function emptyStoreImportRow() {
  return buildEmptyRawRecord()
}
