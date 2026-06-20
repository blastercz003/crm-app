import type {
  AssetCategorySeed,
  AssetDocumentTabKey,
  AssetDocumentTypeSeed,
  AssetStatusOption,
} from './types'
import type { AssetTabKey } from './types'

export const ASSET_STATUS_OPTIONS: AssetStatusOption[] = [
  { value: 'active', label: 'Aktivní' },
  { value: 'sold', label: 'Prodáno' },
]

export const ASSET_CATEGORY_SEEDS: AssetCategorySeed[] = [
  {
    key: 'osobni_vozy',
    label: 'Osobní vozy',
    iconKey: 'car',
    color: '#2f77af',
    sortOrder: 1,
    tabs: ['overview', 'insurance', 'stk', 'service', 'repairs', 'documents', 'photos'],
  },
  {
    key: 'domy',
    label: 'Domy',
    iconKey: 'house',
    color: '#4f92cb',
    sortOrder: 2,
    tabs: ['overview', 'insurance', 'rent', 'electricity', 'documents', 'photos', 'repairs'],
  },
  {
    key: 'byty',
    label: 'Byty',
    iconKey: 'building',
    color: '#5f9dca',
    sortOrder: 3,
    tabs: ['overview', 'insurance', 'rent', 'electricity', 'documents', 'photos', 'repairs'],
  },
  {
    key: 'elektronika',
    label: 'Elektronika',
    iconKey: 'cpu',
    color: '#3a7eb8',
    sortOrder: 4,
    tabs: ['overview', 'insurance', 'service', 'repairs', 'documents', 'photos'],
  },
]

export const ASSET_DOCUMENT_TYPE_SEEDS: AssetDocumentTypeSeed[] = [
  { key: 'kupni_smlouva', label: 'Kupní smlouva', sortOrder: 1, tabs: [] },
  { key: 'pojistna_smlouva', label: 'Pojistná smlouva', sortOrder: 2, tabs: ['insurance'] },
  { key: 'stk', label: 'STK', sortOrder: 3, tabs: ['stk'] },
  { key: 'servis', label: 'Servis', sortOrder: 4, tabs: ['service'] },
  { key: 'revize', label: 'Revize', sortOrder: 5, tabs: ['service'] },
  { key: 'najemni_smlouva', label: 'Nájemní smlouva', sortOrder: 6, tabs: ['rent'] },
  { key: 'faktura', label: 'Faktura', sortOrder: 7, tabs: ['service'] },
  { key: 'fotodokumentace', label: 'Fotodokumentace', sortOrder: 8, tabs: ['photos'] },
  { key: 'jine', label: 'Jiné', sortOrder: 9, tabs: [] },
]

export const ASSET_DOCUMENT_TYPE_SEED_TABS_BY_LABEL = new Map(
  ASSET_DOCUMENT_TYPE_SEEDS.map((seed) => [seed.label, seed.tabs] as const)
)

export const ASSET_ICON_OPTIONS: Array<{
  key: string
  label: string
}> = [
  { key: 'car', label: 'Auto' },
  { key: 'house', label: 'Dům' },
  { key: 'building', label: 'Byt' },
  { key: 'cpu', label: 'Elektronika' },
]

export const ASSET_TAB_OPTIONS: Array<{
  key: AssetTabKey
  label: string
}> = [
  { key: 'overview', label: 'Přehled' },
  { key: 'documents', label: 'Dokumenty' },
  { key: 'photos', label: 'Fotky' },
  { key: 'insurance', label: 'Pojištění' },
  { key: 'stk', label: 'STK' },
  { key: 'service', label: 'Servis' },
  { key: 'rent', label: 'Pronájem' },
  { key: 'electricity', label: 'Elektřina' },
  { key: 'repairs', label: 'Opravy' },
]

export const ASSET_DOCUMENT_TYPE_TAB_OPTIONS: Array<{
  key: AssetDocumentTabKey
  label: string
}> = ASSET_TAB_OPTIONS.filter(
  (option): option is { key: AssetDocumentTabKey; label: string } =>
    option.key !== 'overview' && option.key !== 'documents'
)
