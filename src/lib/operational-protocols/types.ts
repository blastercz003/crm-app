export const OPERATIONAL_PROTOCOLS_BUCKET = 'operational-protocols'
export const OPERATIONAL_PROTOCOLS_STORAGE_PREFIX = 'provozni-protokoly'

export type OperationalProtocolSubtenantChoice = 'yes' | 'no' | null

export type OperationalProtocolClientOption = {
  id: string
  name: string
  address: string | null
  ico: string | null
}

export type OperationalProtocolDeviceInput = {
  deviceName: string
  mthStart: string
  mthEnd: string
  fuelStartPercent: string | number | null
  fuelEndPercent: string | number | null
}

export type OperationalProtocolAccessoryInput = {
  itemName: string
}

export type OperationalProtocolDraftInput = {
  copiedFromProtocolId: string | null
  jobNumber: string
  jobTitle: string
  realizationStartAt: string
  realizationEndAt: string
  handoverPlace: string
  sourceClientId: string | null
  clientName: string
  clientAddress: string
  clientIco: string
  clientContactPerson: string
  clientContactPhone: string
  subtenantChoice: OperationalProtocolSubtenantChoice
  subtenantName: string
  subtenantNote: string
  realizationAt: string
  realizationCompletedAt: string
  technicianName: string
  devices: OperationalProtocolDeviceInput[]
  accessories: OperationalProtocolAccessoryInput[]
}

export type NormalizedOperationalProtocolDraft = {
  jobNumber: string | null
  jobTitle: string
  realizationStartAt: string
  realizationEndAt: string
  handoverPlace: string
  sourceClientId: string | null
  clientName: string
  clientAddress: string | null
  clientIco: string | null
  clientContactPerson: string | null
  clientContactPhone: string | null
  subtenantChoice: OperationalProtocolSubtenantChoice
  subtenantName: string | null
  subtenantNote: string | null
  realizationAt: string
  realizationCompletedAt: string
  technicianName: string
  devices: Array<{
    deviceName: string
    mthStart: string | null
    mthEnd: string | null
    fuelStartPercent: number | null
    fuelEndPercent: number | null
  }>
  accessories: Array<{
    itemName: string
  }>
}

export type OperationalProtocolPdfData = NormalizedOperationalProtocolDraft & {
  generatedAt: string
}

export type OperationalProtocolListItem = {
  id: string
  jobNumber: string | null
  jobTitle: string
  clientName: string
  realizationStartAt: string
  realizationEndAt: string
  handoverPlace: string
  technicianName: string
  createdAt: string
  createdByName: string | null
  pdfFileName: string
  deviceCount: number
  accessoryCount: number
}

export type OperationalProtocolDetail = {
  id: string
  jobNumber: string | null
  jobTitle: string
  realizationStartAt: string
  realizationEndAt: string
  handoverPlace: string
  sourceClientId: string | null
  clientName: string
  clientAddress: string | null
  clientIco: string | null
  clientContactPerson: string | null
  clientContactPhone: string | null
  subtenantChoice: OperationalProtocolSubtenantChoice
  subtenantName: string | null
  subtenantNote: string | null
  realizationAt: string
  realizationCompletedAt: string
  technicianName: string
  digitallySignedAt: string
  finalizedAt: string
  createdAt: string
  createdBy: string | null
  createdByName: string | null
  copiedFromProtocolId: string | null
  pdfStoragePath: string
  pdfFileName: string
  pdfSizeBytes: number
  pdfSha256: string
  devices: Array<{
    id: string
    sortOrder: number
    deviceName: string
    mthStart: string | null
    mthEnd: string | null
    fuelStartPercent: number | null
    fuelEndPercent: number | null
  }>
  accessories: Array<{
    id: string
    sortOrder: number
    itemName: string
  }>
}

export type OperationalProtocolArchiveFilters = {
  query?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
}

export type OperationalProtocolActionResult<T> =
  | {
      success: true
      error: null
      data: T
      warning?: string | null
    }
  | {
      success: false
      error: string
      data: null
      warning?: null
    }
