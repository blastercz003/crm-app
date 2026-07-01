'use client'

import type { BSafe24FileRow } from './actions'
import { BSafe24ContractModalLauncher } from './contract-modal'
import { BSafe24FilesModalLauncher } from './files-modal'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'

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

type ContractFormValues = {
  id: string
  contract_number: string
  client_id: string
  client_contact_id: string | null
  client_name: string
  contact_person: string | null
  client_address: string
  sales_owner: SalesOwner
  monthly_fee: number
  drive_time_hours: number | null
  is_active: boolean
  internal_note: string | null
  backup_addresses: Array<{
    address: string
    contact_person: string | null
    generator_power: string | null
  }>
}

type BSafe24ContractRowActionsProps = {
  clientOptions: ClientOption[]
  clientContacts: ClientContactOption[]
  contract: ContractFormValues
  files: BSafe24FileRow[]
  isAdmin: boolean
  canUploadFiles?: boolean
  canDeleteFiles?: boolean
  className?: string
}

const detailActionButtonBaseClassName =
  'inline-flex h-8 w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-xl border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.02em] transition duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:hover:translate-y-0'

export function BSafe24ContractRowActions({
  clientOptions,
  clientContacts,
  contract,
  files,
  isAdmin,
  canUploadFiles = true,
  canDeleteFiles = false,
  className,
}: BSafe24ContractRowActionsProps) {
  return (
    <div className={`flex w-full min-w-0 items-center justify-center ${className ?? ''}`}>
      <div className="flex max-w-full flex-nowrap items-center justify-center gap-1.5 whitespace-nowrap">
        <BSafe24FilesModalLauncher
          contractId={contract.id}
          contractNumber={contract.contract_number}
          initialFiles={files}
          canUpload={canUploadFiles}
          canDelete={canDeleteFiles}
          className={`${detailActionButtonBaseClassName} border-[#76a9d3]/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-[#1b5f95] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] hover:text-[#154d78] [html[data-theme='dark']_&]:border-[rgba(96,165,250,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(18,33,56,0.96)_0%,rgba(12,24,42,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&]:hover:bg-[linear-gradient(155deg,rgba(22,39,66,0.98)_0%,rgba(15,28,48,0.96)_100%)] [html[data-theme='dark']_&]:hover:text-[#dbeafe]`}
        />
        <BSafe24ContractModalLauncher
          mode="edit"
          clientOptions={clientOptions}
          clientContacts={clientContacts}
          contract={contract}
          readOnly={!isAdmin}
          label="DETAIL"
          className={`${detailActionButtonBaseClassName} border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:bg-zinc-800 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(18,30,50,0.98)_0%,rgba(12,20,34,0.96)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&]:hover:bg-[linear-gradient(155deg,rgba(23,37,60,0.98)_0%,rgba(16,26,43,0.96)_100%)]`}
        />
      </div>
    </div>
  )
}
