import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FUEL_TYPE = 'diesel'
const SOURCE = 'mBenzin.cz'
const SOURCE_URL = 'https://www.mbenzin.cz/'
const FETCH_TIMEOUT_MS = 2500
const VAT_RATE = 1.21
const DIESEL_MARGIN_WITHOUT_VAT = 2

type FuelPriceCacheRow = {
  fuel_type: string
  source_price_with_vat: number
  display_price_without_vat: number
  source: string
  source_url: string
  fetched_at: string
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&aacute;/g, 'á')
    .replace(/&Aacute;/g, 'Á')
    .replace(/&iacute;/g, 'í')
    .replace(/&Iacute;/g, 'Í')
    .replace(/&eacute;/g, 'é')
    .replace(/&Eacute;/g, 'É')
    .replace(/&yacute;/g, 'ý')
    .replace(/&Yacute;/g, 'Ý')
    .replace(/&uacute;/g, 'ú')
    .replace(/&Uacute;/g, 'Ú')
    .replace(/&ů/g, 'ů')
    .replace(/&oacute;/g, 'ó')
    .replace(/&Oacute;/g, 'Ó')
    .replace(/&ě/g, 'ě')
    .replace(/&scaron;/g, 'š')
    .replace(/&Scaron;/g, 'Š')
    .replace(/&ccaron;/g, 'č')
    .replace(/&Ccaron;/g, 'Č')
    .replace(/&rcaron;/g, 'ř')
    .replace(/&Rcaron;/g, 'Ř')
    .replace(/&zcaron;/g, 'ž')
    .replace(/&Zcaron;/g, 'Ž')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function getPragueDateKey(value: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function isFetchedToday(fetchedAt: string | null | undefined) {
  if (!fetchedAt) return false

  const parsed = new Date(fetchedAt)

  if (Number.isNaN(parsed.getTime())) return false

  return getPragueDateKey(parsed) === getPragueDateKey(new Date())
}

function formatPrice(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

function toResponse(row: FuelPriceCacheRow) {
  return NextResponse.json({
    success: true,
    priceText: `${formatPrice(Number(row.display_price_without_vat))} Kč/l`,
    source: row.source,
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
  })
}

function parseMbenzinDieselPrice(html: string) {
  const text = decodeHtmlEntities(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')

  const averagePriceMatch = text.match(
    /Benzín\s+Nafta\s+LPG\s+CNG\s+(\d{1,3},\d{1,2})\s+(\d{1,3},\d{1,2})\s+(\d{1,3},\d{1,2})\s+(\d{1,3},\d{1,2})/
  )

  if (averagePriceMatch?.[2]) {
    return Number(averagePriceMatch[2].replace(',', '.'))
  }

  const todayRowMatch = text.match(/Dnes[\s\S]{0,300}?(\d{1,3},\d{1,2})\s*Kč[\s\S]{0,120}?(\d{1,3},\d{1,2})\s*Kč/)

  if (todayRowMatch?.[2]) {
    return Number(todayRowMatch[2].replace(',', '.'))
  }

  const recentPricesMatch = text.match(
    /Aktuální cena paliv v posledních dnech\s+Datum\s+Benzín\s+Nafta\s+(?:Dnes|Včera|\d{1,2}\.\d{1,2}\.\d{4})\s+(\d{1,3},\d{1,2})\s*Kč\s+(\d{1,3},\d{1,2})\s*Kč/
  )

  if (recentPricesMatch?.[2]) {
    return Number(recentPricesMatch[2].replace(',', '.'))
  }

  return null
}

async function fetchCurrentDieselPriceWithVat() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(SOURCE_URL, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'user-agent': 'meeting-crm/1.0 fuel-price-cache',
      },
    })

    if (!response.ok) return null

    const html = await response.text()
    const price = parseMbenzinDieselPrice(html)

    return typeof price === 'number' && Number.isFinite(price) && price > 0
      ? price
      : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  const { data: cachedRow } = await supabase
    .from('fuel_price_cache')
    .select('fuel_type, source_price_with_vat, display_price_without_vat, source, source_url, fetched_at')
    .eq('fuel_type', FUEL_TYPE)
    .maybeSingle<FuelPriceCacheRow>()

  if (cachedRow && isFetchedToday(cachedRow.fetched_at)) {
    return toResponse(cachedRow)
  }

  const sourcePriceWithVat = await fetchCurrentDieselPriceWithVat()

  if (typeof sourcePriceWithVat !== 'number') {
    return NextResponse.json({
      success: false,
      error: 'unavailable',
    })
  }

  const displayPriceWithoutVat =
    sourcePriceWithVat / VAT_RATE + DIESEL_MARGIN_WITHOUT_VAT
  const fetchedAt = new Date().toISOString()
  const fallbackRow: FuelPriceCacheRow = {
    fuel_type: FUEL_TYPE,
    source_price_with_vat: sourcePriceWithVat,
    display_price_without_vat: displayPriceWithoutVat,
    source: SOURCE,
    source_url: SOURCE_URL,
    fetched_at: fetchedAt,
  }

  const { data: savedRow, error } = await supabase
    .from('fuel_price_cache')
    .upsert({
      fuel_type: FUEL_TYPE,
      source_price_with_vat: sourcePriceWithVat,
      display_price_without_vat: displayPriceWithoutVat,
      source: SOURCE,
      source_url: SOURCE_URL,
      fetched_at: fetchedAt,
      updated_at: fetchedAt,
    })
    .select('fuel_type, source_price_with_vat, display_price_without_vat, source, source_url, fetched_at')
    .single<FuelPriceCacheRow>()

  if (error || !savedRow) return toResponse(fallbackRow)

  return toResponse(savedRow)
}
