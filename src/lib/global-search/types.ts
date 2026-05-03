export type GlobalSearchSectionKey =
  | 'clients'
  | 'tasks'
  | 'meetings'
  | 'offers'
  | 'jobs'
  | 'jobs_portal'
  | 'faktury'
  | 'notifications'

export type GlobalSearchSectionConfig = {
  key: GlobalSearchSectionKey
  label: string
  listHref: string
  buildShowAllHref: (query: string) => string
}

export type GlobalSearchResultItem = {
  id: string
  title: string
  subtitle?: string | null
  meta?: string | null
  statusLabel?: string | null
  updatedAt?: string | null
  href: string
}

export type GlobalSearchSectionResult = {
  key: GlobalSearchSectionKey
  label: string
  hasAccess: boolean
  totalCount: number
  items: GlobalSearchResultItem[]
}

export type GlobalSearchResponse = {
  query: string
  sections: GlobalSearchSectionResult[]
}

export type GlobalSearchLogEvent = {
  userId: string
  query: string
  createdAt: string
  latencyMs: number
  clickedSection?: GlobalSearchSectionKey | null
  clickedItemId?: string | null
}
