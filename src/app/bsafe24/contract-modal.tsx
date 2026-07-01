'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  createBSafe24ContractAction,
  deleteBSafe24ContractAction,
  type UpsertBSafe24ContractActionState,
  updateBSafe24ContractAction,
} from './actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

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

type BackupAddressDraft = {
  id: string
  address: string
  contactPerson: string
  generatorPower: string
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

type BSafe24ContractModalLauncherProps = {
  clientOptions: ClientOption[]
  clientContacts: ClientContactOption[]
  contract?: ContractFormValues
  mode: 'create' | 'edit'
  readOnly?: boolean
  className?: string
  label?: string
}

const initialState: UpsertBSafe24ContractActionState = {
  success: false,
  error: null,
}

const fieldClassName =
  'h-11 w-full rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme=\'dark\']_&]:text-[#f8fbff] [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'

function normalizeMonthlyFeeInput(value: string) {
  const normalized = value
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=.*\.)/g, '')
    .replace(/,(?=.*,)/g, '')
    .trim()

  return normalized
}

function formatMonthlyFeeDisplay(value: string) {
  const normalized = normalizeMonthlyFeeInput(value).replace(',', '.')

  if (!normalized) {
    return ''
  }

  const parsed = Number(normalized)

  if (!Number.isFinite(parsed)) {
    return value
  }

  const formattedNumber = new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
    .format(parsed)
    .replace(/[\s\u00a0\u202f]/g, '.')

  if (Number.isInteger(parsed)) {
    return `${formattedNumber},- Kč`
  }

  return `${formattedNumber} Kč`
}

function normalizeDriveTimeInput(value: string) {
  return value.replace(/[^\d]/g, '').trim()
}

function formatDriveTimeDisplay(value: string) {
  const normalized = normalizeDriveTimeInput(value)

  if (!normalized) {
    return ''
  }

  return `DOJEZD DO ${normalized} HODIN`
}

function createDraftAddress(): BackupAddressDraft {
  return {
    id: `draft-${Math.random().toString(36).slice(2, 10)}`,
    address: '',
    contactPerson: '',
    generatorPower: '',
  }
}

function toDraftAddresses(
  input: ContractFormValues['backup_addresses'] | undefined
): BackupAddressDraft[] {
  const items =
    input?.map((item, index) => ({
      id: `existing-${index}`,
      address: item.address ?? '',
      contactPerson: item.contact_person ?? '',
      generatorPower: item.generator_power ?? '',
    })) ?? []

  return items.length > 0 ? items : [createDraftAddress()]
}

export function BSafe24ContractModalLauncher({
  clientOptions,
  clientContacts,
  contract,
  mode,
  readOnly = false,
  className,
  label,
}: BSafe24ContractModalLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  const defaultLabel =
    label ?? (mode === 'create' ? 'NOVÁ SMLOUVA' : 'UPRAVIT')

  const resolvedClassName =
    className ??
    (mode === 'create'
      ? 'inline-flex w-full items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)] sm:w-auto'
      : 'inline-flex items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_18px_rgba(24,78,129,0.24)] transition duration-200 ease-out hover:-translate-y-[1px]')

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={resolvedClassName}
      >
        {defaultLabel}
      </button>

      {isOpen ? (
        <BSafe24ContractModal
          clientOptions={clientOptions}
          clientContacts={clientContacts}
          contract={contract}
          mode={mode}
          readOnly={readOnly}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function BSafe24ContractModal({
  clientOptions,
  clientContacts,
  contract,
  mode,
  readOnly,
  onClose,
}: {
  clientOptions: ClientOption[]
  clientContacts: ClientContactOption[]
  contract?: ContractFormValues
  mode: 'create' | 'edit'
  readOnly: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const action = mode === 'create' ? createBSafe24ContractAction : updateBSafe24ContractAction
  const [state, formAction] = useActionState(action, initialState)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, startDeleteTransition] = useTransition()
  const [clientQuery, setClientQuery] = useState(contract?.client_name ?? '')
  const [selectedClientId, setSelectedClientId] = useState(contract?.client_id ?? '')
  const [selectedContactId, setSelectedContactId] = useState(contract?.client_contact_id ?? '')
  const [isActive, setIsActive] = useState(
    contract?.is_active ?? (mode === 'create' ? false : true)
  )
  const [monthlyFeeInput, setMonthlyFeeInput] = useState(
    contract?.monthly_fee != null ? String(contract.monthly_fee) : ''
  )
  const [isMonthlyFeeFocused, setIsMonthlyFeeFocused] = useState(false)
  const [driveTimeInput, setDriveTimeInput] = useState(
    contract?.drive_time_hours != null ? String(contract.drive_time_hours) : ''
  )
  const [isDriveTimeFocused, setIsDriveTimeFocused] = useState(false)
  const [backupAddresses, setBackupAddresses] = useState<BackupAddressDraft[]>(
    toDraftAddresses(contract?.backup_addresses)
  )
  const [clientTouched, setClientTouched] = useState(Boolean(contract?.client_id))
  const [isClientMenuOpen, setIsClientMenuOpen] = useState(false)
  const clientMenuRef = useRef<HTMLDivElement | null>(null)

  const selectedClient = useMemo(
    () => clientOptions.find((item) => item.id === selectedClientId) ?? null,
    [clientOptions, selectedClientId]
  )

  const selectedClientContacts = useMemo(
    () =>
      clientContacts
        .filter((contact) => contact.client_id === selectedClientId)
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name, 'cs')),
    [clientContacts, selectedClientId]
  )

  const filteredClientOptions = useMemo(() => {
    const normalizedQuery = clientQuery
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()

    if (!normalizedQuery) {
      return clientOptions.slice(0, 12)
    }

    return clientOptions
      .filter((client) =>
        client.name
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .includes(normalizedQuery)
      )
      .slice(0, 12)
  }, [clientOptions, clientQuery])

  const resolvedContactPerson = useMemo(() => {
    const selectedContact =
      selectedClientContacts.find((contact) => contact.id === selectedContactId) ?? null

    return selectedContact?.name ?? ''
  }, [selectedClientContacts, selectedContactId])

  const normalizedMonthlyFeeInput = useMemo(
    () => normalizeMonthlyFeeInput(monthlyFeeInput),
    [monthlyFeeInput]
  )
  const normalizedDriveTimeInput = useMemo(
    () => normalizeDriveTimeInput(driveTimeInput),
    [driveTimeInput]
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  function handleDeleteContract() {
    if (!contract?.id || mode !== 'edit') {
      return
    }

    if (!window.confirm(`Opravdu chceš smazat smlouvu ${contract.contract_number}?`)) {
      return
    }

    setDeleteError(null)

    startDeleteTransition(async () => {
      const result = await deleteBSafe24ContractAction(contract.id)

      if (!result.success) {
        setDeleteError(result.error ?? 'Smlouvu se nepodařilo smazat.')
        return
      }

      onClose()
      router.refresh()
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (
        clientMenuRef.current &&
        event.target instanceof Node &&
        !clientMenuRef.current.contains(event.target)
      ) {
        setIsClientMenuOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function handleClientChange(nextClientId: string) {
    setClientTouched(true)
    setSelectedClientId(nextClientId)

    const matchedClient =
      clientOptions.find((client) => client.id === nextClientId) ?? null
    setClientQuery(matchedClient?.name ?? '')

    const contactsForClient = clientContacts
      .filter((contact) => contact.client_id === nextClientId)
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))

    const defaultContact = contactsForClient[0] ?? null
    setSelectedContactId(defaultContact?.id ?? '')
    setIsClientMenuOpen(false)
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactId(nextContactId)
  }

  function handleClientQueryChange(nextValue: string) {
    setClientTouched(true)
    setClientQuery(nextValue)
    setIsClientMenuOpen(true)

    const normalizedValue = nextValue
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()

    if (!normalizedValue) {
      setSelectedClientId('')
      setSelectedContactId('')
      return
    }

    const exactMatch =
      clientOptions.find(
        (client) =>
          client.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim() === normalizedValue
      ) ?? null

    if (exactMatch) {
      handleClientChange(exactMatch.id)
      return
    }

    if (selectedClientId) {
      setSelectedClientId('')
      setSelectedContactId('')
    }
  }

  function updateBackupAddress(
    draftId: string,
    field: keyof Omit<BackupAddressDraft, 'id'>,
    value: string
  ) {
    setBackupAddresses((current) =>
      current.map((item) =>
        item.id === draftId
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    )
  }

  function addBackupAddress() {
    setBackupAddresses((current) => [...current, createDraftAddress()])
  }

  function removeBackupAddress(draftId: string) {
    setBackupAddresses((current) => {
      if (current.length === 1) {
        return [{ ...current[0], address: '', contactPerson: '', generatorPower: '' }]
      }

      return current.filter((item) => item.id !== draftId)
    })
  }

  const modalTitle =
    mode === 'create'
      ? 'Nová smlouva B-SAFE 24'
      : readOnly
        ? 'Detail smlouvy B-SAFE 24'
        : 'Upravit smlouvu B-SAFE 24'
  const submitLabel = mode === 'create' ? 'ULOŽIT SMLOUVU' : 'ULOŽIT ZMĚNY'

  return createPortal(
    <div
      className="fixed inset-0 z-[120] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(17,27,46,0.98)_0%,rgba(12,20,34,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[0_36px_84px_rgba(0,0,0,0.34)] sm:max-h-[calc(100vh-3rem)]">
          <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                {modalTitle}
              </h2>
              {contract?.contract_number ? (
                <div className="mt-2 flex justify-start">
                  <span className="inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_8px_14px_rgba(24,78,129,0.26)]">
                    SMLOUVA {contract.contract_number}
                  </span>
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(165deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
              aria-label="Zavřít"
            >
              ×
            </button>
          </div>

          <form action={readOnly ? undefined : formAction} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6">
            {mode === 'edit' && contract?.id ? (
              <input type="hidden" name="contract_id" value={contract.id} />
            ) : null}

            <input type="hidden" name="client_id" value={selectedClientId} />
            <input type="hidden" name="client_contact_id" value={selectedContactId} />
            <input type="hidden" name="contact_person" value={resolvedContactPerson} />
            <input type="hidden" name="is_active" value={isActive ? 'true' : 'false'} />
            <input type="hidden" name="monthly_fee" value={normalizedMonthlyFeeInput} />
            <input type="hidden" name="drive_time_hours" value={normalizedDriveTimeInput} />
            <input
              type="hidden"
              name="backup_addresses_json"
              value={JSON.stringify(
                backupAddresses.map((item) => ({
                  address: item.address,
                  contactPerson: item.contactPerson,
                  generatorPower: item.generatorPower,
                }))
              )}
            />

            <div className="grid gap-4">
              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="grid gap-4 md:grid-cols-3">
                  {readOnly ? (
                    <ReadOnlyField
                      label="Číslo smlouvy"
                      value={contract?.contract_number?.trim() || '—'}
                    />
                  ) : (
                    <Field
                      label="Číslo smlouvy"
                      name="contract_number"
                      defaultValue={contract?.contract_number ?? ''}
                      required
                    />
                  )}

                  {readOnly ? (
                    <ReadOnlyField
                      label="Klient"
                      value={clientQuery.trim() || contract?.client_name?.trim() || '—'}
                    />
                  ) : (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                        Klient
                      </label>
                      <div className="relative" ref={clientMenuRef}>
                        <input
                          type="text"
                          value={clientQuery}
                          onChange={(event) => handleClientQueryChange(event.target.value)}
                          onFocus={() => {
                            setIsClientMenuOpen(true)
                          }}
                          placeholder="Začni psát název firmy"
                          className={fieldClassName}
                        />
                        {isClientMenuOpen && filteredClientOptions.length > 0 ? (
                          <div className="absolute left-0 top-[calc(100%+0.5rem)] z-20 max-h-64 w-full overflow-y-auto rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(244,247,251,0.94)_100%)] p-2 shadow-[0_18px_40px_rgba(15,23,42,0.14),inset_0_1px_0_rgba(255,255,255,0.92)] backdrop-blur-[12px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.98)_0%,rgba(12,20,34,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[0_18px_40px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)]">
                            <div className="space-y-1">
                              {filteredClientOptions.map((client) => (
                                <button
                                  key={client.id}
                                  type="button"
                                  onClick={() => handleClientChange(client.id)}
                                  className={`flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition ${
                                    client.id === selectedClientId
                                      ? 'bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.22)]'
                                      : 'text-zinc-700 hover:bg-white/90 [html[data-theme=\'dark\']_&]:text-slate-200 [html[data-theme=\'dark\']_&]:hover:bg-[rgba(15,23,42,0.82)]'
                                  }`}
                                >
                                  {client.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      {!selectedClientId && clientTouched ? (
                        <p className="mt-2 text-xs text-red-600 [html[data-theme='dark']_&]:text-red-300">
                          Vyber klienta z nabídky.
                        </p>
                      ) : null}
                    </div>
                  )}

                  {readOnly ? (
                    <ReadOnlyField
                      label="Kontaktní osoba klienta"
                      value={resolvedContactPerson.trim() || 'Bez vazby'}
                    />
                  ) : (
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                        Kontaktní osoba klienta
                      </label>
                      <div className="relative">
                        <select
                          value={selectedContactId}
                          onChange={(event) => handleContactChange(event.target.value)}
                          className={`${fieldClassName} appearance-none pr-8`}
                        >
                          <option value="">Bez vazby</option>
                          {selectedClientContacts.map((contact) => (
                            <option key={contact.id} value={contact.id}>
                              {contact.name}
                              {contact.is_primary ? ' (hlavní)' : ''}
                            </option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                          ⌄
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                    Detail smlouvy
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <ReadOnlyField
                      label="Adresa klienta"
                      value={selectedClient?.address?.trim() || 'Po výběru klienta se doplní automaticky'}
                    />

                    {readOnly ? (
                      <ReadOnlyField
                        label="Obchodník"
                        value={contract?.sales_owner ?? '—'}
                      />
                    ) : (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                          Obchodník
                        </label>
                        <div className="relative">
                          <select
                            name="sales_owner"
                            defaultValue={contract?.sales_owner ?? 'JIŘÍ'}
                            className={`${fieldClassName} appearance-none pr-8`}
                          >
                            <option value="JIŘÍ">JIŘÍ</option>
                            <option value="MICHAL">MICHAL</option>
                            <option value="LÍDA">LÍDA</option>
                          </select>
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                            ⌄
                          </span>
                        </div>
                      </div>
                    )}

                    {readOnly ? (
                      <ReadOnlyField
                        label="Paušál / měsíc"
                        value={formatMonthlyFeeDisplay(monthlyFeeInput) || '—'}
                      />
                    ) : (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                          Paušál / měsíc
                        </label>
                        <input
                          value={
                            isMonthlyFeeFocused
                              ? monthlyFeeInput
                              : formatMonthlyFeeDisplay(monthlyFeeInput)
                          }
                          onFocus={() => setIsMonthlyFeeFocused(true)}
                          onBlur={() => setIsMonthlyFeeFocused(false)}
                          onChange={(event) =>
                            setMonthlyFeeInput(normalizeMonthlyFeeInput(event.target.value))
                          }
                          required
                          inputMode="decimal"
                          placeholder="Např. 1000"
                          className={fieldClassName}
                        />
                      </div>
                    )}

                    {readOnly ? (
                      <ReadOnlyField
                        label="Dojezdový čas"
                        value={formatDriveTimeDisplay(driveTimeInput) || '—'}
                      />
                    ) : (
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                          Dojezdový čas
                        </label>
                        <input
                          value={
                            isDriveTimeFocused
                              ? driveTimeInput
                              : formatDriveTimeDisplay(driveTimeInput)
                          }
                          onFocus={() => setIsDriveTimeFocused(true)}
                          onBlur={() => setIsDriveTimeFocused(false)}
                          onChange={(event) =>
                            setDriveTimeInput(normalizeDriveTimeInput(event.target.value))
                          }
                          inputMode="numeric"
                          placeholder="Např. 2"
                          className={fieldClassName}
                        />
                      </div>
                    )}

                    {readOnly ? (
                      <ReadOnlyField
                        label="Stav smlouvy"
                        value={isActive ? 'Aktivní' : 'Neaktivní'}
                        className="md:col-span-2"
                      />
                    ) : (
                      <div className="md:col-span-2">
                        <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                          Stav smlouvy
                        </div>
                        <div className="grid grid-cols-2 gap-2 md:max-w-[30rem]">
                          <button
                            type="button"
                            onClick={() => {
                              setIsActive(true)
                            }}
                            className={`inline-flex h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold uppercase tracking-[0.04em] transition duration-200 ${
                              isActive
                                ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.28)]'
                                : 'border-white/75 bg-white/80 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                            }`}
                          >
                            Aktivní
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsActive(false)
                            }}
                            className={`inline-flex h-11 items-center justify-center rounded-xl border px-3 text-sm font-semibold uppercase tracking-[0.04em] transition duration-200 ${
                              !isActive
                                ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(24,78,129,0.28)]'
                                : 'border-white/75 bg-white/80 text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme=\'dark\']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme=\'dark\']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                            }`}
                          >
                            Neaktivní
                          </button>
                        </div>
                        <p className="mt-1.5 max-w-[34rem] text-[11px] leading-5 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                          Aktivní smlouva musí mít nahrané PDF smlouvy. Nový záznam proto nejdřív založ jako neaktivní.
                        </p>
                      </div>
                    )}

                    {readOnly ? (
                      <ReadOnlyField
                        label="Interní poznámka"
                        value={contract?.internal_note?.trim() || '—'}
                        className="md:col-span-2"
                      />
                    ) : (
                      <TextAreaField
                        label="Interní poznámka"
                        name="internal_note"
                        defaultValue={contract?.internal_note ?? ''}
                        className="md:col-span-2"
                        rows={3}
                      />
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
                      Zálohované adresy
                    </div>
                    {!readOnly ? (
                    <button
                      type="button"
                      onClick={addBackupAddress}
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_18px_rgba(24,78,129,0.24)] transition duration-200 hover:-translate-y-[1px]"
                    >
                      + Adresa
                    </button>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {backupAddresses.map((item, index) => (
                      <div
                        key={item.id}
                        className="rounded-2xl border border-white/75 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                            Adresa {index + 1}
                          </div>
                          {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => removeBackupAddress(item.id)}
                            className="inline-flex h-8 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium uppercase tracking-[0.04em] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
                          >
                            Odebrat
                          </button>
                          ) : null}
                        </div>

                        <div className="grid gap-3">
                          {readOnly ? (
                            <>
                              <ReadOnlyField label="Adresa" value={item.address.trim() || '—'} />
                              <ReadOnlyField
                                label="Kontaktní osoba"
                                value={item.contactPerson.trim() || '—'}
                              />
                              <ReadOnlyField
                                label="Výkon DA"
                                value={item.generatorPower.trim() || '—'}
                              />
                            </>
                          ) : (
                            <>
                              <Field
                                label="Adresa"
                                value={item.address}
                                onChange={(value) => updateBackupAddress(item.id, 'address', value)}
                                required
                              />
                              <Field
                                label="Kontaktní osoba"
                                value={item.contactPerson}
                                onChange={(value) => updateBackupAddress(item.id, 'contactPerson', value)}
                              />
                              <Field
                                label="Výkon DA"
                                value={item.generatorPower}
                                onChange={(value) => updateBackupAddress(item.id, 'generatorPower', value)}
                              />
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {state.error || deleteError ? (
              <div className="mt-4 rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] [html[data-theme='dark']_&]:border-[rgba(239,68,68,0.24)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(69,10,10,0.5)_0%,rgba(38,12,12,0.42)_100%)] [html[data-theme='dark']_&]:text-red-200">
                {state.error ?? deleteError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="sm:min-w-[120px]">
                {mode === 'edit' && contract?.id && !readOnly ? (
                  <button
                    type="button"
                    onClick={handleDeleteContract}
                    disabled={isDeleting}
                    className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-red-200/90 bg-white/92 px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(239,68,68,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-70 [html[data-theme='dark']_&]:border-[rgba(248,113,113,0.28)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.82)] [html[data-theme='dark']_&]:text-red-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)]"
                  >
                    SMAZAT
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&]:hover:bg-[linear-gradient(155deg,rgba(22,35,58,0.98)_0%,rgba(16,26,43,0.96)_100%)]"
                >
                  {readOnly ? 'ZAVŘÍT' : 'ZRUŠIT'}
                </button>
                {!readOnly ? <SubmitContractButton label={submitLabel} /> : null}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}

function SubmitContractButton({ label }: { label: string }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:translate-y-0 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&]:hover:bg-[linear-gradient(155deg,rgba(22,35,58,0.98)_0%,rgba(16,26,43,0.96)_100%)]"
    >
      {pending ? 'UKLÁDÁM' : label}
    </button>
  )
}

function ReadOnlyField({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={className}>
      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </div>
      <div className="flex min-h-11 items-center rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        {value}
      </div>
    </div>
  )
}

function Field({
  label,
  name,
  defaultValue,
  value,
  onChange,
  required = false,
  readOnly = false,
  className,
}: {
  label: string
  name?: string
  defaultValue?: string
  value?: string
  onChange?: (value: string) => void
  required?: boolean
  readOnly?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </label>
      <input
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        required={required}
        readOnly={readOnly}
        className="h-11 w-full rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      />
    </div>
  )
}

function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 4,
  readOnly = false,
  className,
}: {
  label: string
  name: string
  defaultValue: string
  rows?: number
  readOnly?: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        rows={rows}
        readOnly={readOnly}
        className="w-full rounded-xl border border-white/75 bg-white/80 px-3 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.72)] [html[data-theme='dark']_&]:text-[#f8fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
      />
    </div>
  )
}
