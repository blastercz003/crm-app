import { ASSET_DOCUMENT_TYPE_TAB_OPTIONS } from './config'
import type { AssetDocumentTabKey, AssetTabKey } from './types'

export const ASSET_TAB_LABELS: Record<AssetTabKey, string> = {
  overview: 'Přehled',
  documents: 'Dokumenty',
  photos: 'Fotky',
  insurance: 'Pojištění',
  stk: 'STK',
  service: 'Servis',
  rent: 'Pronájem',
  electricity: 'Elektřina',
  repairs: 'Poznámky',
}

export const ASSET_TAB_DESCRIPTIONS: Record<AssetTabKey, string> = {
  overview: 'Hlavní informace o majetku, stav a nejdůležitější metadata.',
  documents: 'Kupní smlouvy, pojistky, faktury a další přílohy.',
  photos: 'Fotky majetku pro rychlou vizuální kontrolu.',
  insurance: 'Pojištění, pojistné smlouvy a důležité termíny.',
  stk: 'STK, technická kontrola a související doklady.',
  service: 'Servisní záznamy, údržba a související dokumentace.',
  rent: 'Informace o pronájmu, nájemcích a souvisejících smlouvách.',
  electricity: 'Roční vyúčtování elektřiny, dodavatelé a související doklady.',
  repairs: 'Samostatné poznámky k majetku bez timeline.',
}

export const ASSET_TAB_ORDER: AssetTabKey[] = [
  'overview',
  'documents',
  'photos',
  'insurance',
  'stk',
  'service',
  'rent',
  'electricity',
  'repairs',
]

export function isAssetTabKey(value: string): value is AssetTabKey {
  return value in ASSET_TAB_LABELS
}

export function normalizeAssetTabs(value: unknown): AssetTabKey[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is AssetTabKey => typeof entry === 'string' && isAssetTabKey(entry))
}

const allowedDocumentTabs = new Set(ASSET_DOCUMENT_TYPE_TAB_OPTIONS.map((option) => option.key))

export function normalizeDocumentTypeTabs(value: unknown): AssetDocumentTabKey[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(
    (entry): entry is AssetDocumentTabKey =>
      typeof entry === 'string' && allowedDocumentTabs.has(entry as AssetDocumentTabKey)
  )
}

export function getDocumentTypeTabs(value: unknown): AssetTabKey[] {
  return ['documents', ...normalizeDocumentTypeTabs(value)]
}

export function documentTypeMatchesTab(value: unknown, tab: AssetTabKey) {
  if (tab === 'documents') {
    return true
  }

  return normalizeDocumentTypeTabs(value).includes(tab as AssetDocumentTabKey)
}

export function isMissingColumnError(error: unknown) {
  if (!error || typeof error !== 'object') return false

  const typedError = error as { code?: string; message?: string }
  return typedError.code === '42703' || typedError.message?.includes('tabs_config') === true
}

export function buildAssetDetailHref(assetId: string, tab?: AssetTabKey) {
  const search = new URLSearchParams()

  if (tab && tab !== 'overview') {
    search.set('tab', tab)
  }

  const queryString = search.toString()
  return queryString ? `/majetek/${assetId}?${queryString}` : `/majetek/${assetId}`
}
