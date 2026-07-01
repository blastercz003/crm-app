import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { BSafe24SearchBar } from './search-bar'
import { BSafe24ContractModalLauncher } from './contract-modal'
import { BSafe24ContractRowActions } from './contract-row-actions'
import type { BSafe24FileRow } from './actions'

export const metadata: Metadata = {
  title: 'B-SAFE 24',
}

type BSafe24PageProps = {
  searchParams?: Promise<{
    q?: string
    status?: string | string[]
    owner?: string | string[]
    sort?: string | string[]
  }>
}

type ProfilePermissionRow = {
  role: string | null
  can_view_bsafe24: boolean | null
}

type BSafe24ContractRow = {
  id: string
  contract_number: string
  client_id: string
  client_contact_id: string | null
  client_name: string
  contact_person: string | null
  client_address: string
  sales_owner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  monthly_fee: number | string
  drive_time_hours: number | string | null
  is_active: boolean
  internal_note: string | null
  updated_at: string
}

type BSafe24BackupAddressRow = {
  id: string
  contract_id: string
  sort_order: number
  address: string
  contact_person: string | null
  generator_power: string | null
}

type BSafe24FileDatabaseRow = BSafe24FileRow

type BSafe24ContractViewModel = {
  id: string
  contractNumber: string
  clientId: string
  clientContactId: string | null
  clientName: string
  contactPerson: string | null
  clientAddress: string
  salesOwner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  monthlyFee: number
  driveTimeHours: number | null
  isActive: boolean
  internalNote: string | null
  updatedAt: string
  firstBackupAddress: string | null
  firstBackupGeneratorPower: string | null
  backupAddresses: Array<{
    address: string
    contact_person: string | null
    generator_power: string | null
  }>
  files: BSafe24FileRow[]
  allSearchValues: string[]
}

type ClientOption = {
  id: string
  name: string
  address: string | null
  contact_person: string | null
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type ContractFilterStatus = 'all' | 'active' | 'inactive'
type ContractSortOption =
  | 'client_asc'
  | 'client_desc'
  | 'contract_asc'
  | 'contract_desc'
  | 'monthly_fee_desc'
  | 'monthly_fee_asc'
  | 'drive_time_asc'
  | 'updated_at_desc'

type OwnerStat = {
  owner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  activeCount: number
  activeMonthlyFeeTotal: number
}

type TotalStat = {
  activeCount: number
  activeMonthlyFeeTotal: number
}

const SALES_OWNER_OPTIONS = ['JIŘÍ', 'MICHAL', 'LÍDA'] as const
const CONTRACT_SORT_OPTIONS: Array<{ value: ContractSortOption; label: string }> = [
  { value: 'client_asc', label: 'Klient A–Z' },
  { value: 'client_desc', label: 'Klient Z–A' },
  { value: 'contract_asc', label: 'Smlouva A–Z' },
  { value: 'contract_desc', label: 'Smlouva Z–A' },
  { value: 'monthly_fee_desc', label: 'Paušál od nejvyššího' },
  { value: 'monthly_fee_asc', label: 'Paušál od nejnižšího' },
  { value: 'drive_time_asc', label: 'Dojezd od nejkratšího' },
  { value: 'updated_at_desc', label: 'Naposledy upravené od nejnovějšího' },
]

function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

function getMultiParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value
  }

  return value ? [value] : []
}

function isSalesOwner(value: string): value is (typeof SALES_OWNER_OPTIONS)[number] {
  return SALES_OWNER_OPTIONS.includes(value as (typeof SALES_OWNER_OPTIONS)[number])
}

function isContractFilterStatus(value: string): value is ContractFilterStatus {
  return value === 'all' || value === 'active' || value === 'inactive'
}

function isContractSortOption(value: string): value is ContractSortOption {
  return CONTRACT_SORT_OPTIONS.some((option) => option.value === value)
}

function normalizeSearchValue(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function getSearchTokens(search: string) {
  return normalizeSearchValue(search)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function formatCurrency(value: number) {
  const formattedValue = new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace(/[\s\u00a0\u202f]/g, '.')

  return `${formattedValue},- Kč`
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatDriveTimeHours(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  const roundedValue = Math.trunc(value)
  const lastDigit = roundedValue % 10
  const lastTwoDigits = roundedValue % 100

  const unit =
    roundedValue === 1
      ? 'HODINA'
      : lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)
        ? 'HODINY'
        : 'HODIN'

  return `${roundedValue} ${unit}`
}

function getSelectedOwnersLabel(selectedOwners: Array<(typeof SALES_OWNER_OPTIONS)[number]>) {
  if (selectedOwners.length === 0) {
    return 'Všichni obchodníci'
  }

  if (selectedOwners.length === SALES_OWNER_OPTIONS.length) {
    return 'Všichni obchodníci'
  }

  return selectedOwners.join(', ')
}

function contractMatchesQuery(
  contract: BSafe24ContractViewModel,
  tokens: string[]
) {
  if (tokens.length === 0) return true

  return tokens.every((token) =>
    contract.allSearchValues.some((value) => value.includes(token))
  )
}

function sortContracts(
  contracts: BSafe24ContractViewModel[],
  sortOption: ContractSortOption
) {
  return [...contracts].sort((left, right) => {
    switch (sortOption) {
      case 'client_desc':
        return right.clientName.localeCompare(left.clientName, 'cs', { sensitivity: 'base' })
      case 'contract_asc':
        return left.contractNumber.localeCompare(right.contractNumber, 'cs', { sensitivity: 'base' })
      case 'contract_desc':
        return right.contractNumber.localeCompare(left.contractNumber, 'cs', { sensitivity: 'base' })
      case 'monthly_fee_desc':
        return right.monthlyFee - left.monthlyFee
      case 'monthly_fee_asc':
        return left.monthlyFee - right.monthlyFee
      case 'drive_time_asc':
        return (left.driveTimeHours ?? Number.MAX_SAFE_INTEGER) - (right.driveTimeHours ?? Number.MAX_SAFE_INTEGER)
      case 'updated_at_desc':
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      case 'client_asc':
      default:
        return left.clientName.localeCompare(right.clientName, 'cs', { sensitivity: 'base' })
    }
  })
}

function buildContractViewModels(params: {
  contracts: BSafe24ContractRow[]
  backupAddresses: BSafe24BackupAddressRow[]
  files: BSafe24FileDatabaseRow[]
}) {
  const { contracts, backupAddresses, files } = params
  const backupAddressesByContract = new Map<string, BSafe24BackupAddressRow[]>()
  const filesByContract = new Map<string, BSafe24FileDatabaseRow[]>()

  for (const address of backupAddresses) {
    const items = backupAddressesByContract.get(address.contract_id) ?? []
    items.push(address)
    backupAddressesByContract.set(address.contract_id, items)
  }

  for (const file of files) {
    const items = filesByContract.get(file.contract_id) ?? []
    items.push(file)
    filesByContract.set(file.contract_id, items)
  }

  return contracts.map((contract) => {
    const contractBackupAddresses = (backupAddressesByContract.get(contract.id) ?? []).sort(
      (a, b) => {
        if (a.sort_order !== b.sort_order) {
          return a.sort_order - b.sort_order
        }

        return a.address.localeCompare(b.address, 'cs', { sensitivity: 'base' })
      }
    )

    const firstBackupAddress = contractBackupAddresses[0]?.address?.trim() || null
    const firstBackupGeneratorPower =
      contractBackupAddresses[0]?.generator_power?.trim() || null
    const contractFiles = [...(filesByContract.get(contract.id) ?? [])].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )
    const monthlyFee =
      typeof contract.monthly_fee === 'number'
        ? contract.monthly_fee
        : Number(contract.monthly_fee ?? 0)
    const driveTimeHours =
      typeof contract.drive_time_hours === 'number'
        ? contract.drive_time_hours
        : contract.drive_time_hours == null
          ? null
          : Number(contract.drive_time_hours)

    const allSearchValues = [
      contract.contract_number,
      contract.client_name,
      contract.contact_person ?? '',
      contract.client_address,
      contract.drive_time_hours != null ? `dojezd do ${contract.drive_time_hours} hodin` : '',
      contract.drive_time_hours != null ? String(contract.drive_time_hours) : '',
      ...contractBackupAddresses.flatMap((address) => [
        address.address,
        address.contact_person ?? '',
        address.generator_power ?? '',
      ]),
    ]
      .map((value) => normalizeSearchValue(value))
      .filter(Boolean)

    return {
      id: contract.id,
      contractNumber: contract.contract_number,
      clientId: contract.client_id,
      clientContactId: contract.client_contact_id,
      clientName: contract.client_name,
      contactPerson: contract.contact_person,
      clientAddress: contract.client_address,
      salesOwner: contract.sales_owner,
      monthlyFee: Number.isFinite(monthlyFee) ? monthlyFee : 0,
      driveTimeHours:
        driveTimeHours != null && Number.isFinite(driveTimeHours) ? driveTimeHours : null,
      isActive: contract.is_active,
      internalNote: contract.internal_note,
      updatedAt: contract.updated_at,
      firstBackupAddress,
      firstBackupGeneratorPower,
      backupAddresses: contractBackupAddresses.map((address) => ({
        address: address.address,
        contact_person: address.contact_person,
        generator_power: address.generator_power,
      })),
      files: contractFiles,
      allSearchValues,
    }
  })
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? 'inline-flex rounded-full border border-emerald-200/90 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] [html[data-theme=\'dark\']_&]:border-[rgba(16,185,129,0.25)] [html[data-theme=\'dark\']_&]:bg-[rgba(6,78,59,0.45)] [html[data-theme=\'dark\']_&]:text-emerald-200'
          : 'inline-flex rounded-full border border-zinc-200/90 bg-zinc-100/90 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(30,41,59,0.74)] [html[data-theme=\'dark\']_&]:text-slate-300'
      }
    >
      {isActive ? 'Aktivní' : 'Neaktivní'}
    </span>
  )
}

function MobileContractCard({
  contract,
  clientOptions,
  clientContacts,
  isAdmin,
}: {
  contract: BSafe24ContractViewModel
  clientOptions: ClientOption[]
  clientContacts: ClientContactOption[]
  isAdmin: boolean
}) {
  return (
    <article className="rounded-[24px] border border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_16px_34px_rgba(0,0,0,0.24)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Číslo smlouvy
          </div>
          <div className="mt-1 text-base font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
            {contract.contractNumber}
          </div>
        </div>
        <StatusBadge isActive={contract.isActive} />
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Klient
          </div>
          <div className="mt-1 text-sm font-medium text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
            {contract.clientName}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Osoba
          </div>
          <div className="mt-1 text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
            {contract.contactPerson?.trim() || '—'}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Obchodník
          </div>
          <div className="mt-1 text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
            {contract.salesOwner}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Adresa
          </div>
          <div className="mt-1 text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
            {contract.firstBackupAddress || '—'}
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Výkon
          </div>
          <div className="mt-1 text-sm text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
            {contract.firstBackupGeneratorPower?.trim() || '—'}
          </div>
        </div>

        <div className="flex items-end justify-between gap-3 pt-1">
          <div className="grid gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                Paušál
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                {formatCurrency(contract.monthlyFee)}
              </div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                Dojezd
              </div>
              <div className="mt-1 text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                {formatDriveTimeHours(contract.driveTimeHours)}
              </div>
            </div>
          </div>

          <DetailPlaceholder
            clientOptions={clientOptions}
            clientContacts={clientContacts}
            contract={contract}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </article>
  )
}

function DetailPlaceholder({
  clientOptions,
  clientContacts,
  contract,
  isAdmin,
}: {
  clientOptions: ClientOption[]
  clientContacts: ClientContactOption[]
  contract: BSafe24ContractViewModel
  isAdmin: boolean
}) {
  return (
    <BSafe24ContractRowActions
      clientOptions={clientOptions}
      clientContacts={clientContacts}
      files={contract.files}
      isAdmin={isAdmin}
      contract={{
        id: contract.id,
        contract_number: contract.contractNumber,
        client_id: contract.clientId,
        client_contact_id: contract.clientContactId,
        client_name: contract.clientName,
        contact_person: contract.contactPerson,
        client_address: contract.clientAddress,
        sales_owner: contract.salesOwner,
        monthly_fee: contract.monthlyFee,
        drive_time_hours: contract.driveTimeHours,
        is_active: contract.isActive,
        internal_note: contract.internalNote,
        backup_addresses: contract.backupAddresses,
      }}
    />
  )
}

export default async function BSafe24Page({ searchParams }: BSafe24PageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const query = resolvedSearchParams?.q?.trim() ?? ''
  const statusParam = getSingleParam(resolvedSearchParams?.status)
  const ownerParams = getMultiParam(resolvedSearchParams?.owner)
  const sortParam = getSingleParam(resolvedSearchParams?.sort)
  const hasSearch = query.length >= 3
  const searchTokens = hasSearch ? getSearchTokens(query) : []
  const statusFilter = isContractFilterStatus(statusParam) ? statusParam : 'all'
  const sortFilter = isContractSortOption(sortParam) ? sortParam : 'client_asc'
  const selectedOwners = ownerParams
    .map((owner) => owner.trim().toUpperCase())
    .filter(isSalesOwner)

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_bsafe24')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'

  if (!isAdmin && !typedProfile?.can_view_bsafe24) {
    redirect('/dashboard')
  }

  const [
    { data: contractsData, error: contractsError },
    { data: backupAddressesData, error: backupAddressesError },
    { data: filesData, error: filesError },
    { data: clientsData, error: clientsError },
    { data: clientContactsData, error: clientContactsError },
  ] =
    await Promise.all([
      supabase
        .from('bsafe24_contracts')
        .select(
          'id, contract_number, client_id, client_contact_id, client_name, contact_person, client_address, sales_owner, monthly_fee, drive_time_hours, is_active, internal_note, updated_at'
        )
        .order('contract_number', { ascending: false }),
      supabase
        .from('bsafe24_backup_addresses')
        .select('id, contract_id, sort_order, address, contact_person, generator_power')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase
        .from('bsafe24_files')
        .select(
          'id, contract_id, file_type, file_name, display_name, storage_bucket, storage_path, mime_type, file_size_bytes, uploaded_by, created_at'
        )
        .order('created_at', { ascending: false }),
      isAdmin
        ? supabase
            .from('clients')
            .select('id, name, address, contact_person')
            .order('name', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      isAdmin
        ? supabase
            .from('client_contacts')
            .select('id, client_id, name, is_primary')
            .order('is_primary', { ascending: false })
            .order('name', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ])

  if (contractsError) {
    throw new Error('Nepodařilo se načíst smlouvy B-SAFE 24.')
  }

  if (backupAddressesError) {
    throw new Error('Nepodařilo se načíst zálohované adresy B-SAFE 24.')
  }

  if (filesError) {
    throw new Error('Nepodařilo se načíst soubory B-SAFE 24.')
  }

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty pro B-SAFE 24.')
  }

  if (clientContactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů pro B-SAFE 24.')
  }

  const clientOptions = ((clientsData ?? []) as ClientOption[])
    .map((client) => ({
      id: String(client.id ?? '').trim(),
      name: String(client.name ?? '').trim(),
      address: client.address ?? null,
      contact_person: client.contact_person ?? null,
    }))
    .filter((client) => client.id && client.name)

  const clientContacts = ((clientContactsData ?? []) as ClientContactOption[])
    .map((contact) => ({
      id: String(contact.id ?? '').trim(),
      client_id: String(contact.client_id ?? '').trim(),
      name: String(contact.name ?? '').trim(),
      is_primary: Boolean(contact.is_primary),
    }))
    .filter((contact) => contact.id && contact.client_id && contact.name)

  const contracts = buildContractViewModels({
    contracts: (contractsData ?? []) as BSafe24ContractRow[],
    backupAddresses: (backupAddressesData ?? []) as BSafe24BackupAddressRow[],
    files: (filesData ?? []) as BSafe24FileDatabaseRow[],
  })

  const ownerStats = SALES_OWNER_OPTIONS.map<OwnerStat>((owner) => {
    const activeContracts = contracts.filter(
      (contract) => contract.salesOwner === owner && contract.isActive
    )

    return {
      owner,
      activeCount: activeContracts.length,
      activeMonthlyFeeTotal: activeContracts.reduce(
        (sum, contract) => sum + contract.monthlyFee,
        0
      ),
    }
  })

  const totalStats = contracts
    .filter((contract) => contract.isActive)
    .reduce<TotalStat>(
      (accumulator, contract) => ({
        activeCount: accumulator.activeCount + 1,
        activeMonthlyFeeTotal:
          accumulator.activeMonthlyFeeTotal + contract.monthlyFee,
      }),
      {
        activeCount: 0,
        activeMonthlyFeeTotal: 0,
      }
    )

  const visibleContracts = sortContracts(
    contracts.filter((contract) => {
      if (hasSearch && !contractMatchesQuery(contract, searchTokens)) {
        return false
      }

      if (statusFilter === 'active' && !contract.isActive) {
        return false
      }

      if (statusFilter === 'inactive' && contract.isActive) {
        return false
      }

      if (selectedOwners.length > 0 && !selectedOwners.includes(contract.salesOwner)) {
        return false
      }

      return true
    }),
    sortFilter
  )

  const hasActiveFilters = Boolean(
    query || statusFilter !== 'all' || selectedOwners.length > 0 || sortFilter !== 'client_asc'
  )

  return (
    <main className="bsafe24-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)]">
      <PresenceSectionTracker section="B-SAFE 24" route="/bsafe24" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 [html[data-theme='dark']_&]:bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_50%,#09111f_100%)] [html[data-theme='dark']_&]:opacity-100"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(78,160,220,0.12)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl [html[data-theme='dark']_&]:bg-[rgba(12,87,140,0.10)]"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div className="relative -ml-7 h-10 w-[220px] sm:-ml-11 sm:h-12 sm:w-[280px]">
                <Image
                  src="/bsafe24-logo-light.png"
                  alt="B-SAFE 24"
                  fill
                  className="object-contain [html[data-theme='dark']_&]:hidden"
                  priority
                />
                <Image
                  src="/bsafe24-logo-dark.png"
                  alt="B-SAFE 24"
                  fill
                  className="hidden object-contain [html[data-theme='dark']_&]:block"
                  priority
                />
              </div>
            </div>

            <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:w-auto">
              <BSafe24SearchBar initialQuery={query} />

              <Link
                href="/dashboard"
                className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-gray-800 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)] sm:w-auto"
              >
                ZPĚT NA DASHBOARD
              </Link>

              {isAdmin ? (
                <BSafe24ContractModalLauncher
                  mode="create"
                  clientOptions={clientOptions}
                  clientContacts={clientContacts}
                />
              ) : null}
            </div>
          </div>
        </section>

        <section className="relative z-30 overflow-visible rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-4">
              {ownerStats.map((stat) => (
                <div
                  key={stat.owner}
                  className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
                >
                  <div className="text-base font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                    {stat.owner}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                    <span>Aktivní smlouvy</span>
                    <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                      {stat.activeCount}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                    <span>Paušál / měsíc</span>
                    <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                      {formatCurrency(stat.activeMonthlyFeeTotal)}
                    </span>
                  </div>
                </div>
              ))}

              <div className="rounded-2xl border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(35,111,159,0.12)] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.22)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(16,49,99,0.42)_0%,rgba(18,36,73,0.34)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]">
                <div className="text-base font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                  Všechny smlouvy
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                  <span>Aktivní smlouvy</span>
                  <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                    {totalStats.activeCount}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                  <span>Paušál / měsíc</span>
                  <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                    {formatCurrency(totalStats.activeMonthlyFeeTotal)}
                  </span>
                </div>
              </div>
            </div>

            <form action="/bsafe24" method="get" className="space-y-4">
              <input type="hidden" name="q" value={query} />

              <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,320px)_260px_auto] lg:items-end">
                <div>
                  <label
                    htmlFor="bsafe24-status"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"
                  >
                    Stav smlouvy
                  </label>
                  <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <select
                      id="bsafe24-status"
                      name="status"
                      defaultValue={statusFilter}
                      className="block h-10 w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-[#f8fbff]"
                    >
                      <option value="all">Všechny</option>
                      <option value="active">Aktivní</option>
                      <option value="inactive">Neaktivní</option>
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div>
                  <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                    Obchodník
                  </div>
                  <details className="group relative">
                    <summary className="flex h-10 cursor-pointer list-none items-center justify-between rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-sm text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 marker:content-none hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-200 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]">
                      <span className="truncate font-medium">
                        {getSelectedOwnersLabel(selectedOwners)}
                      </span>
                      <span
                        aria-hidden
                        className="ml-3 shrink-0 text-xs text-zinc-500 transition duration-200 group-open:rotate-180 [html[data-theme='dark']_&]:text-slate-400"
                      >
                        ⌄
                      </span>
                    </summary>

                    <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 w-full min-w-[240px] rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(244,247,251,0.94)_100%)] p-3 shadow-[0_18px_40px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-[12px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.98)_0%,rgba(12,20,34,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[0_18px_40px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="space-y-2">
                        {SALES_OWNER_OPTIONS.map((owner) => {
                          const checked = selectedOwners.includes(owner)

                          return (
                            <label
                              key={owner}
                              className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2.5 text-sm font-medium transition duration-200 ${
                                checked
                                  ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.22)]'
                                  : 'border-white/75 bg-white/88 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.06)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.78)] [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.18)]'
                              }`}
                            >
                              <span>{owner}</span>
                              <input
                                type="checkbox"
                                name="owner"
                                value={owner}
                                defaultChecked={checked}
                                className="h-4 w-4 rounded border-white/70 text-[#2f77af] focus:ring-[#9dc7e5]"
                              />
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </details>
                </div>

                <div>
                  <label
                    htmlFor="bsafe24-sort"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"
                  >
                    Řazení
                  </label>
                  <div className="relative min-w-0 overflow-hidden rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus-within:border-[#9dc7e5] focus-within:ring-2 focus-within:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <select
                      id="bsafe24-sort"
                      name="sort"
                      defaultValue={sortFilter}
                      className="block h-10 w-full appearance-none border-0 bg-transparent px-3 pr-8 text-sm text-gray-900 outline-none [html[data-theme='dark']_&]:text-[#f8fbff]"
                    >
                      {CONTRACT_SORT_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">⌄</span>
                  </div>
                </div>

                <div className="flex items-end gap-2 lg:justify-end">
                  <button
                    type="submit"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                  >
                    Použít filtry
                  </button>

                  <Link
                    href="/bsafe24"
                    className="inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
                  >
                    Reset
                  </Link>
                </div>
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-400">
              <span className="inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                Stav: <span className="ml-1 font-medium">{statusFilter === 'all' ? 'Všechny' : statusFilter === 'active' ? 'Aktivní' : 'Neaktivní'}</span>
              </span>
              {query ? (
                <span className="inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  Hledání: <span className="ml-1 font-medium">{query}</span>
                </span>
              ) : null}
              {selectedOwners.map((owner) => (
                <span
                  key={owner}
                  className="inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                >
                  Obchodník: <span className="ml-1 font-medium">{owner}</span>
                </span>
              ))}
              {sortFilter !== 'client_asc' ? (
                <span className="inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  Řazení:
                  <span className="ml-1 font-medium">
                    {CONTRACT_SORT_OPTIONS.find((option) => option.value === sortFilter)?.label}
                  </span>
                </span>
              ) : null}
              {hasActiveFilters ? (
                <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-2.5 py-1 font-semibold text-[#236f9f] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.22)] [html[data-theme='dark']_&]:bg-[rgba(30,64,175,0.24)] [html[data-theme='dark']_&]:text-sky-200">
                  Filtr aktivní
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {contracts.length === 0 ? (
          <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
            <h2 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
              Zatím tu nejsou žádné smlouvy
            </h2>
            <p className="mt-2 text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
              Jakmile přidáme první záznamy, zobrazí se zde tabulka i mobilní karty.
            </p>
          </section>
        ) : visibleContracts.length === 0 ? (
          <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
            <h2 className="text-xl font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
              Žádná smlouva neodpovídá aktuálnímu filtru
            </h2>
            <p className="mt-2 text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
              Zkus upravit hledání nebo změnit stav smlouvy či vybraného obchodníka.
            </p>
          </section>
        ) : (
          <>
            <section className="hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
              <div className="overflow-x-auto">
                <table className="min-w-full table-fixed border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.94)_0%,rgba(245,246,248,0.92)_100%)] shadow-sm [html[data-theme='dark']_&]:bg-[linear-gradient(180deg,rgba(18,28,46,0.98)_0%,rgba(12,20,34,0.96)_100%)]">
                    <tr>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Smlouva
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Klient
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Osoba
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Obchodník
                      </th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Adresa
                      </th>
                      <th className="w-[140px] px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Paušál
                      </th>
                      <th className="w-[110px] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Dojezd
                      </th>
                      <th className="w-[110px] px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Výkon
                      </th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Stav
                      </th>
                      <th className="w-[220px] px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        Detaily
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleContracts.map((contract, index) => (
                      <tr
                        key={contract.id}
                        className={`transition duration-200 ease-out hover:bg-white/75 [html[data-theme='dark']_&]:hover:bg-[rgba(30,41,59,0.38)] ${
                          index % 2 === 0
                            ? 'bg-white/55 [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.18)]'
                            : 'bg-transparent'
                        }`}
                      >
                        <td className="px-4 py-2.5 text-xs font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                          {contract.contractNumber}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-800 [html[data-theme='dark']_&]:text-slate-200">
                          <div className="truncate" title={contract.clientName}>
                            {contract.clientName}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          <div className="truncate" title={contract.contactPerson?.trim() || '—'}>
                            {contract.contactPerson?.trim() || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          {contract.salesOwner}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          <div className="truncate" title={contract.firstBackupAddress || '—'}>
                            {contract.firstBackupAddress || '—'}
                          </div>
                        </td>
                        <td className="w-[140px] whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                          {formatCurrency(contract.monthlyFee)}
                        </td>
                        <td className="w-[110px] whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                          {formatDriveTimeHours(contract.driveTimeHours)}
                        </td>
                        <td className="w-[110px] whitespace-nowrap px-4 py-2.5 text-xs text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                          <div className="truncate" title={contract.firstBackupGeneratorPower || '—'}>
                            {contract.firstBackupGeneratorPower || '—'}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <StatusBadge isActive={contract.isActive} />
                        </td>
                        <td className="w-[220px] px-4 py-2.5 text-center">
                          <DetailPlaceholder
                            clientOptions={clientOptions}
                            clientContacts={clientContacts}
                            contract={contract}
                            isAdmin={isAdmin}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="grid gap-4 lg:hidden">
              {visibleContracts.map((contract) => (
                <MobileContractCard
                  key={contract.id}
                  contract={contract}
                  clientOptions={clientOptions}
                  clientContacts={clientContacts}
                  isAdmin={isAdmin}
                />
              ))}
            </section>
          </>
        )}

        {visibleContracts.length > 0 ? (
          <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_44px_rgba(0,0,0,0.24)]">
            <div className="flex flex-col gap-3 text-sm text-zinc-600 [html[data-theme='dark']_&]:text-slate-300 sm:flex-row sm:items-center sm:justify-between">
              <div>
                Zobrazené smlouvy: <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">{visibleContracts.length}</span>
              </div>
              <div>
                Poslední změna:{' '}
                <span className="font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                  {formatDateTime(visibleContracts[0].updatedAt)}
                </span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}
