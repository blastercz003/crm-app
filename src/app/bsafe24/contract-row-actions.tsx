'use client'

import { useState, useTransition } from 'react'
import {
  downloadBSafe24FileAction,
  openBSafe24FileAction,
  type BSafe24FileRow,
} from './actions'
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
  className?: string
}

const detailActionButtonBaseClassName =
  'inline-flex h-8 w-[82px] shrink-0 items-center justify-center rounded-xl border px-1.5 py-1 text-[10px] font-semibold uppercase tracking-[0.02em] transition duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:hover:translate-y-0'

export function BSafe24ContractRowActions({
  clientOptions,
  clientContacts,
  contract,
  files,
  isAdmin,
  className,
}: BSafe24ContractRowActionsProps) {
  const [message, setMessage] = useState<string | null>(null)
  const [isBusy, startTransition] = useTransition()

  const offerFile = files.find((file) => file.file_type === 'offer_pdf') ?? null
  const contractFile = files.find((file) => file.file_type === 'contract_pdf') ?? null

  function handleOpenFile(fileId: string, download = false) {
    setMessage(null)

    startTransition(async () => {
      const result = download
        ? await downloadBSafe24FileAction(fileId)
        : await openBSafe24FileAction(fileId)

      if (!result.success || !result.signedUrl) {
        setMessage(
          result.error ??
            (download
              ? 'Nepodařilo se připravit stažení souboru.'
              : 'Nepodařilo se otevřít soubor.')
        )
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <div className={`flex flex-col items-end gap-2 ${className ?? ''}`}>
      <div className="flex flex-nowrap justify-end gap-2 whitespace-nowrap">
        <ActionButton
          label="NABÍDKA"
          onClick={() => {
            if (offerFile) {
              handleOpenFile(offerFile.id)
            }
          }}
          disabled={!offerFile || isBusy}
          variant={offerFile ? 'primary' : 'disabled'}
          title={offerFile ? 'Otevřít nahranou nabídku PDF' : 'Nabídka PDF zatím není nahraná'}
        />
        <ActionButton
          label="SMLOUVA"
          onClick={() => {
            if (contractFile) {
              handleOpenFile(contractFile.id, true)
            }
          }}
          disabled={!contractFile || isBusy}
          variant={contractFile ? 'primary' : 'disabled'}
          title={
            contractFile
              ? 'Stáhnout nahranou smlouvu PDF'
              : 'Smlouva PDF zatím není nahraná'
          }
        />
        <BSafe24FilesModalLauncher
          contractId={contract.id}
          contractNumber={contract.contract_number}
          initialFiles={files}
          isAdmin={isAdmin}
          className={`${detailActionButtonBaseClassName} border-[#76a9d3]/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-[#1b5f95] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] hover:text-[#154d78] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.22)]`}
        />
        {isAdmin ? (
          <BSafe24ContractModalLauncher
            mode="edit"
            clientOptions={clientOptions}
            clientContacts={clientContacts}
            contract={contract}
            className={`${detailActionButtonBaseClassName} border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:bg-zinc-800 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]`}
          />
        ) : null}
      </div>

      {message ? (
        <div className="text-right text-[11px] text-red-500 [html[data-theme='dark']_&]:text-red-300">
          {message}
        </div>
      ) : null}
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  disabled,
  variant,
  title,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  variant: 'primary' | 'secondary' | 'danger' | 'disabled'
  title?: string
}) {
  const variantClassName =
    variant === 'primary'
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_18px_rgba(24,78,129,0.24)]'
      : variant === 'danger'
        ? 'border-red-200/90 bg-white/92 text-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(239,68,68,0.08)] [html[data-theme=\'dark\']_&]:border-[rgba(248,113,113,0.28)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme=\'dark\']_&]:text-red-300'
        : variant === 'disabled'
          ? 'border-zinc-200/80 bg-zinc-100/80 text-zinc-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.10)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.48)] [html[data-theme=\'dark\']_&]:text-slate-500'
          : 'border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:bg-zinc-800 [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme=\'dark\']_&]:text-[#f8fbff] [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${detailActionButtonBaseClassName} ${variantClassName}`}
    >
      {label}
    </button>
  )
}
