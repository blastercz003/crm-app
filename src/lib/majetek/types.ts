export type AssetStatus = 'active' | 'sold'

export type AssetTabKey =
  | 'overview'
  | 'documents'
  | 'photos'
  | 'insurance'
  | 'stk'
  | 'service'
  | 'rent'
  | 'electricity'
  | 'repairs'

export type AssetDocumentTabKey = Exclude<AssetTabKey, 'overview' | 'documents'>

export type AssetCategorySeed = {
  key: string
  label: string
  iconKey: string
  color: string
  sortOrder: number
  tabs: AssetTabKey[]
}

export type AssetDocumentTypeSeed = {
  key: string
  label: string
  sortOrder: number
  tabs: AssetDocumentTabKey[]
}

export type AssetStatusOption = {
  value: AssetStatus
  label: string
}
