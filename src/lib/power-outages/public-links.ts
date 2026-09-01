import type { PowerOutageSource } from './types'

const CEZ_OUTAGE_SEARCH_URL = 'https://www.cezdistribuce.cz/pro-zakazniky/potrebuji-vyresit/stavajici-pripojeni/overeni-planovane-odstavky'
const CEZ_ANNOUNCEMENT_ORIGIN = 'https://cdn.bezstavy.cz'
const EGD_OUTAGE_MAP_URL = 'https://www.egd.cz/odstavky-elektrina'

const CEZ_PDF_KEY_PATTERN = /^pdf\/[a-z0-9][a-z0-9._-]*\.pdf$/i

export function powerOutageSourceUrl(
  source: PowerOutageSource,
  municipalityCode?: string | null,
) {
  if (source === 'egd') return EGD_OUTAGE_MAP_URL

  const url = new URL(CEZ_OUTAGE_SEARCH_URL)
  const code = municipalityCode?.trim()
  if (code && /^\d+$/.test(code)) url.searchParams.set('jlTown', code)
  return url.toString()
}

export function cezAnnouncementUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const candidate = value.trim().replace(/^\/+/, '')
  if (!CEZ_PDF_KEY_PATTERN.test(candidate)) return null

  const url = new URL(candidate, `${CEZ_ANNOUNCEMENT_ORIGIN}/`)
  return url.origin === CEZ_ANNOUNCEMENT_ORIGIN ? url.toString() : null
}

