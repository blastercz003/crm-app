import type { ActivityListItem } from '@/lib/activities/types'
import type { OfferStatus } from '@/lib/offers/types'
import type {
  StickyNoteCounts,
  StickyNoteListItem,
} from '@/lib/sticky-notes/types'

export type ActivityWorkspaceUser = {
  id: string
  name: string
}

export type ActivityWorkspaceTask = {
  id: string
  title: string
  note: string | null
  status: string | null
  priority: string | null
  repeatInterval: string | null
  hasNotification: boolean
  dueDate: string | null
  createdAt: string | null
  createdBy: string | null
  assignedTo: string | null
  clientId: string | null
  clientName: string | null
  companyName: string | null
  contactPerson: string | null
}

export type ActivityWorkspaceTaskDetail = ActivityWorkspaceTask & {
  clientContactId: string | null
  creatorName: string
  assigneeName: string
}

export type ActivityWorkspaceTaskDetailResult = {
  success: boolean
  error: string | null
  task: ActivityWorkspaceTaskDetail | null
}

export type ActivityWorkspaceMeeting = {
  id: string
  title: string | null
  status: string | null
  meetingDateTime: string | null
  clientId: string | null
  clientName: string | null
  companyName: string | null
  contactPerson: string | null
  contactPhone: string | null
  contactEmail: string | null
  assignedUserId: string | null
}

export type ActivityWorkspaceMeetingDetail = ActivityWorkspaceMeeting & {
  clientContactId: string | null
  address: string | null
  preMeetingNote: string | null
  resultNote: string | null
  followUpTask: string | null
  followUpTaskNote: string | null
  followUpTaskPriority: string | null
  followUpTaskDueDate: string | null
  createdAt: string | null
  updatedAt: string | null
  createdBy: string | null
  creatorName: string
  assignedUserName: string
}

export type ActivityWorkspaceMeetingDetailResult = {
  success: boolean
  error: string | null
  meeting: ActivityWorkspaceMeetingDetail | null
}

export type ActivityWorkspaceOffer = {
  id: string
  offerNumber: string
  title: string
  status: OfferStatus
  updatedAt: string
  clientId: string
  clientName: string | null
  createdBy: string
}

export type ActivityWorkspaceOfferStatusOption = {
  value: OfferStatus
  label: string
  count: number
  tone: 'blue' | 'green' | 'amber' | 'orange' | 'red'
}

export type ActivityWorkspaceOfferProgressNote = {
  id: string
  note: string
  createdAt: string
  authorName: string
}

export type ActivityWorkspaceOfferDetail = ActivityWorkspaceOffer & {
  offerType: 'classic' | 'bsafe24'
  currentVersion: number
  submittedVersion: number | null
  approvedVersion: number | null
  currency: string
  validUntil: string | null
  projectName: string | null
  realizationAddress: string | null
  realizationStartsAt: string | null
  realizationEndsAt: string | null
  contactPerson: string | null
  internalNote: string | null
  rejectionComment: string | null
  submittedAt: string | null
  createdAt: string
  authorName: string
  lastEditorName: string | null
  itemCount: number
  subtotalWithoutVat: number
  vatTotal: number
  totalWithVat: number
  progressNotes: ActivityWorkspaceOfferProgressNote[]
  progressNotesTotal: number
}

export type ActivityWorkspaceOfferDetailResult = {
  success: boolean
  error: string | null
  offer: ActivityWorkspaceOfferDetail | null
}

export type ActivityWorkspaceJobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
export type ActivityWorkspaceJobPeriod = 'today' | 'this_week' | 'next_week' | 'next_30_days' | 'all'

export type ActivityWorkspaceJob = {
  id: string
  jobNumber: string
  companyName: string
  salesOwner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  startAt: string
  endAt: string
  technicianName: string | null
  generatorName: string | null
  siteAddress: string | null
  jobStatus: ActivityWorkspaceJobStatus
  marnyVyjezd: boolean
  pohotovost: boolean
  hasInfo: boolean
}

export type ActivityWorkspaceJobDetail = ActivityWorkspaceJob & {
  clientId: string | null
  offerId: string | null
  clientContactId: string | null
  contactPerson: string | null
  storeNumber: string | null
  clientOrderNumber: string | null
  infoNote: string | null
  ppRequired: boolean
  invoiceStatus: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
  evidenceStatus: 'nove' | 'zapsano'
  createdAt: string
  updatedAt: string
}

export type ActivityWorkspaceJobDetailResult = {
  success: boolean
  error: string | null
  job: ActivityWorkspaceJobDetail | null
}

export type ActivityWorkspaceData = {
  viewer: {
    id: string
    name: string | null
    isAdmin: boolean
  }
  selectedUser: ActivityWorkspaceUser
  userOptions: ActivityWorkspaceUser[]
  kpis: {
    activitiesToday: number
    activitiesThisWeek: number
    overdueTasks: number
    activeTasks: number
    meetingsToday: number
    meetingsTotal: number
    jobsThisWeek: number
    jobsTotal: number
  }
  manualActivities: {
    planned: ActivityListItem[]
    logged: ActivityListItem[]
    plannedTotal: number
    loggedTotal: number
  }
  systemHistory: {
    items: ActivityListItem[]
    total: number
    today: number
  }
  tasks: {
    items: ActivityWorkspaceTask[]
    activeTotal: number
    overdueTotal: number
  }
  meetings: {
    items: ActivityWorkspaceMeeting[]
    upcomingTotal: number
    todayTotal: number
  }
  offers: {
    available: boolean
    mode: 'approval' | 'in_progress' | 'hidden'
    selectedStatus: OfferStatus | null
    selectedStatusLabel: string
    statusOptions: ActivityWorkspaceOfferStatusOption[]
    items: ActivityWorkspaceOffer[]
    total: number
  }
  jobs: {
    available: boolean
    canEdit: boolean
    listHref: '/jobs' | '/jobs-portal'
    selectedPeriod: ActivityWorkspaceJobPeriod
    selectedStatus: ActivityWorkspaceJobStatus | 'active' | 'all'
    items: ActivityWorkspaceJob[]
    total: number
  }
  stickyNotes: {
    items: StickyNoteListItem[]
    total: number
    counts: StickyNoteCounts
  }
}

export type ActivitySystemHistoryActionResult = {
  success: boolean
  error: string | null
  items: ActivityListItem[]
  total: number
}

export type ActivityWorkspaceFormOptions = {
  clients: Array<{
    id: string
    name: string
  }>
  taskUsers: Array<{
    id: string
    name: string | null
    role: string | null
  }>
  taskContacts: Array<{
    id: string
    client_id: string
    name: string
    is_primary: boolean
  }>
  meetingContacts: Array<{
    id: string
    client_id: string
    name: string
    phone: string | null
    email: string | null
    is_primary: boolean
  }>
}
