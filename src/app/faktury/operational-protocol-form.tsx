'use client'

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import type {
  OperationalProtocolClientOption,
  OperationalProtocolDraftInput,
  OperationalProtocolSubtenantChoice,
} from '@/lib/operational-protocols/types'
import {
  checkOperationalProtocolJobNumberAction,
  searchOperationalProtocolClientsAction,
} from './operational-protocol-actions'

type JobNumberStatus =
  | { kind: 'idle'; message: '' }
  | { kind: 'checking'; message: string }
  | { kind: 'available'; message: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string }

const INPUT_CLASS =
  "block h-11 w-full min-w-0 max-w-full rounded-2xl border border-zinc-200 bg-white/92 px-3.5 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_7px_18px_rgba(15,23,42,0.07)] outline-none transition placeholder:text-zinc-400 focus:border-[#8dbfe0] focus:ring-2 focus:ring-[#b9d8ef]/75 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.17)] [html[data-theme='dark']_&]:bg-[rgba(10,20,35,0.9)] [html[data-theme='dark']_&]:text-slate-100 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.025),0_8px_20px_rgba(0,0,0,0.2)] [html[data-theme='dark']_&]:placeholder:text-slate-600 [html[data-theme='dark']_&:focus]:border-[rgba(82,166,224,0.5)] [html[data-theme='dark']_&:focus]:ring-[rgba(51,126,178,0.24)]"
const LABEL_CLASS =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"
const PANEL_CLASS =
  "rounded-[24px] border border-white/80 bg-white/72 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_28px_rgba(15,23,42,0.08)] sm:p-4 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(13,23,39,0.88)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_30px_rgba(0,0,0,0.24)]"
const PANEL_TITLE_CLASS =
  "text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-600 [html[data-theme='dark']_&]:text-slate-300"

export function createEmptyOperationalProtocolDraft(): OperationalProtocolDraftInput {
  return {
    copiedFromProtocolId: null,
    jobNumber: '',
    jobTitle: '',
    realizationStartAt: '',
    realizationEndAt: '',
    handoverPlace: '',
    sourceClientId: null,
    clientName: '',
    clientAddress: '',
    clientIco: '',
    clientContactPerson: '',
    clientContactPhone: '',
    subtenantChoice: null,
    subtenantName: '',
    subtenantNote: '',
    realizationAt: '',
    realizationCompletedAt: '',
    technicianName: '',
    devices: [
      {
        deviceName: '',
        mthStart: '',
        mthEnd: '',
        fuelStartPercent: '',
        fuelEndPercent: '',
      },
    ],
    accessories: [{ itemName: '' }],
  }
}

export function OperationalProtocolForm({
  value,
  onChange,
}: {
  value: OperationalProtocolDraftInput
  onChange: (value: OperationalProtocolDraftInput) => void
}) {
  const [clientOptions, setClientOptions] = useState<OperationalProtocolClientOption[]>([])
  const [isClientSearchPending, setIsClientSearchPending] = useState(false)
  const [clientSearchError, setClientSearchError] = useState<string | null>(null)
  const [activeClientOptionIndex, setActiveClientOptionIndex] = useState(-1)
  const [jobNumberStatus, setJobNumberStatus] = useState<JobNumberStatus>({
    kind: 'idle',
    message: '',
  })
  const clientSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clientSearchRequestRef = useRef(0)
  const jobNumberRequestRef = useRef(0)

  useEffect(
    () => () => {
      if (clientSearchTimerRef.current) clearTimeout(clientSearchTimerRef.current)
    },
    []
  )

  function updateField<K extends keyof OperationalProtocolDraftInput>(
    field: K,
    fieldValue: OperationalProtocolDraftInput[K]
  ) {
    if (field === 'realizationStartAt') {
      onChange({
        ...value,
        realizationStartAt: String(fieldValue),
        realizationAt: String(fieldValue),
      })
      return
    }

    if (field === 'realizationEndAt') {
      onChange({
        ...value,
        realizationEndAt: String(fieldValue),
        realizationCompletedAt: String(fieldValue),
      })
      return
    }

    onChange({ ...value, [field]: fieldValue })
  }

  function handleClientNameChange(clientName: string) {
    onChange({
      ...value,
      sourceClientId: null,
      clientName,
    })
    setClientOptions([])
    setActiveClientOptionIndex(-1)
    setClientSearchError(null)
    clientSearchRequestRef.current += 1

    if (clientSearchTimerRef.current) clearTimeout(clientSearchTimerRef.current)

    const query = clientName.trim()
    if (query.length < 2) {
      setIsClientSearchPending(false)
      return
    }

    setIsClientSearchPending(true)
    const requestId = clientSearchRequestRef.current
    clientSearchTimerRef.current = setTimeout(async () => {
      const result = await searchOperationalProtocolClientsAction(query)
      if (requestId !== clientSearchRequestRef.current) return

      setIsClientSearchPending(false)
      if (!result.success) {
        setClientSearchError(result.error)
        return
      }

      setClientOptions(result.data)
      setActiveClientOptionIndex(result.data.length > 0 ? 0 : -1)
    }, 260)
  }

  function selectClient(client: OperationalProtocolClientOption) {
    clientSearchRequestRef.current += 1
    if (clientSearchTimerRef.current) clearTimeout(clientSearchTimerRef.current)
    setClientOptions([])
    setActiveClientOptionIndex(-1)
    setClientSearchError(null)
    setIsClientSearchPending(false)
    onChange({
      ...value,
      sourceClientId: client.id,
      clientName: client.name,
      clientAddress: client.address ?? '',
      clientIco: client.ico ?? '',
    })
  }

  function handleClientKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (clientOptions.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveClientOptionIndex((current) =>
        current >= clientOptions.length - 1 ? 0 : current + 1
      )
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveClientOptionIndex((current) =>
        current <= 0 ? clientOptions.length - 1 : current - 1
      )
      return
    }

    if (event.key === 'Enter' && activeClientOptionIndex >= 0) {
      event.preventDefault()
      selectClient(clientOptions[activeClientOptionIndex])
      return
    }

    if (event.key === 'Escape') {
      event.stopPropagation()
      setClientOptions([])
      setActiveClientOptionIndex(-1)
    }
  }

  async function checkJobNumber() {
    const jobNumber = value.jobNumber.trim()
    jobNumberRequestRef.current += 1
    const requestId = jobNumberRequestRef.current

    if (!jobNumber) {
      setJobNumberStatus({ kind: 'idle', message: '' })
      return
    }

    setJobNumberStatus({ kind: 'checking', message: 'Ověřuji číslo zakázky…' })
    const result = await checkOperationalProtocolJobNumberAction(jobNumber)
    if (requestId !== jobNumberRequestRef.current) return

    if (!result.success) {
      setJobNumberStatus({ kind: 'error', message: result.error })
      return
    }

    setJobNumberStatus(
      result.data.available
        ? { kind: 'available', message: 'Číslo zakázky je dostupné.' }
        : { kind: 'unavailable', message: 'Toto číslo zakázky už bylo použito.' }
    )
  }

  function setSubtenantChoice(choice: OperationalProtocolSubtenantChoice) {
    onChange({
      ...value,
      subtenantChoice: choice,
      ...(choice !== 'yes' ? { subtenantName: '', subtenantNote: '' } : {}),
    })
  }

  function updateDevice(
    index: number,
    field: keyof OperationalProtocolDraftInput['devices'][number],
    fieldValue: string
  ) {
    const devices = value.devices.map((device, deviceIndex) =>
      deviceIndex === index ? { ...device, [field]: fieldValue } : device
    )
    updateField('devices', devices)
  }

  function addDevice() {
    updateField('devices', [
      ...value.devices,
      {
        deviceName: '',
        mthStart: '',
        mthEnd: '',
        fuelStartPercent: '',
        fuelEndPercent: '',
      },
    ])
  }

  function removeDevice(index: number) {
    const devices = value.devices.filter((_, deviceIndex) => deviceIndex !== index)
    updateField(
      'devices',
      devices.length > 0
        ? devices
        : [
            {
              deviceName: '',
              mthStart: '',
              mthEnd: '',
              fuelStartPercent: '',
              fuelEndPercent: '',
            },
          ]
    )
  }

  function updateAccessory(index: number, itemName: string) {
    updateField(
      'accessories',
      value.accessories.map((item, itemIndex) =>
        itemIndex === index ? { ...item, itemName } : item
      )
    )
  }

  function addAccessory() {
    updateField('accessories', [...value.accessories, { itemName: '' }])
  }

  function removeAccessory(index: number) {
    const accessories = value.accessories.filter((_, itemIndex) => itemIndex !== index)
    updateField('accessories', accessories.length > 0 ? accessories : [{ itemName: '' }])
  }

  return (
    <div className="space-y-3.5">
      <section className={PANEL_CLASS}>
        <h3 className={PANEL_TITLE_CLASS}>Základ protokolu</h3>

        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-6">
          <FieldShell label="Číslo zakázky" hint="Nepovinné" className="md:col-span-2">
            <input
              type="text"
              value={value.jobNumber}
              onChange={(event) => {
                updateField('jobNumber', event.target.value)
                setJobNumberStatus({ kind: 'idle', message: '' })
              }}
              onBlur={() => void checkJobNumber()}
              placeholder="Např. H512"
              autoComplete="off"
              className={`${INPUT_CLASS} uppercase`}
            />
            {jobNumberStatus.message ? (
              <p
                className={`mt-1.5 text-[11px] ${
                  jobNumberStatus.kind === 'available'
                    ? "text-emerald-600 [html[data-theme='dark']_&]:text-emerald-400"
                    : jobNumberStatus.kind === 'unavailable' || jobNumberStatus.kind === 'error'
                      ? "text-rose-600 [html[data-theme='dark']_&]:text-rose-400"
                      : "text-zinc-500 [html[data-theme='dark']_&]:text-slate-400"
                }`}
              >
                {jobNumberStatus.message}
              </p>
            ) : null}
          </FieldShell>

          <FieldShell label="Název zakázky" required className="md:col-span-4">
            <input
              type="text"
              value={value.jobTitle}
              onChange={(event) => updateField('jobTitle', event.target.value)}
              placeholder="Např. Pronájem záložního zdroje"
              className={INPUT_CLASS}
            />
          </FieldShell>

          <FieldShell label="Termín realizace od" required className="min-w-0 md:col-span-3">
            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl">
              <input
                type="datetime-local"
                value={value.realizationStartAt}
                onChange={(event) => updateField('realizationStartAt', event.target.value)}
                className={`${INPUT_CLASS} filter-datetime-input`}
              />
            </div>
          </FieldShell>

          <FieldShell label="Termín realizace do" required className="min-w-0 md:col-span-3">
            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl">
              <input
                type="datetime-local"
                value={value.realizationEndAt}
                onChange={(event) => updateField('realizationEndAt', event.target.value)}
                className={`${INPUT_CLASS} filter-datetime-input`}
              />
            </div>
          </FieldShell>

          <FieldShell label="Místo realizace" required className="md:col-span-6">
            <input
              type="text"
              value={value.handoverPlace}
              onChange={(event) => updateField('handoverPlace', event.target.value)}
              placeholder="Adresa nebo místo předání"
              className={INPUT_CLASS}
            />
          </FieldShell>
        </div>
      </section>

      <section className={PANEL_CLASS}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={PANEL_TITLE_CLASS}>Přejímající</h3>
          <span className="text-[10px] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            Výběr z klientů lze následně ručně upravit
          </span>
        </div>

        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-6">
          <div
            className="relative min-w-0 md:col-span-4"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setClientOptions([])
                setActiveClientOptionIndex(-1)
              }
            }}
          >
            <label htmlFor="operational-protocol-client" className={LABEL_CLASS}>
              Firma <span className="text-rose-500">*</span>
            </label>
            <input
              id="operational-protocol-client"
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={clientOptions.length > 0}
              aria-controls="operational-protocol-client-options"
              aria-activedescendant={
                activeClientOptionIndex >= 0
                  ? `operational-protocol-client-option-${activeClientOptionIndex}`
                  : undefined
              }
              value={value.clientName}
              onChange={(event) => handleClientNameChange(event.target.value)}
              onKeyDown={handleClientKeyDown}
              placeholder="Začněte psát název firmy nebo IČO"
              autoComplete="off"
              className={INPUT_CLASS}
            />

            {isClientSearchPending ? (
              <div className="pointer-events-none absolute right-3 top-[34px] inline-flex h-5 w-5 items-center justify-center">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#78afd4] border-t-transparent" />
              </div>
            ) : null}

            {clientOptions.length > 0 ? (
              <div
                id="operational-protocol-client-options"
                role="listbox"
                className="absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto rounded-2xl border border-zinc-200 bg-white/98 p-1.5 shadow-[0_18px_38px_rgba(15,23,42,0.2)] backdrop-blur-xl [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.2)] [html[data-theme='dark']_&]:bg-[rgba(10,19,33,0.98)] [html[data-theme='dark']_&]:shadow-[0_22px_44px_rgba(0,0,0,0.5)]"
              >
                {clientOptions.map((client, index) => (
                  <button
                    id={`operational-protocol-client-option-${index}`}
                    key={client.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeClientOptionIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectClient(client)}
                    className={`block w-full rounded-xl px-3 py-2.5 text-left transition ${
                      index === activeClientOptionIndex
                        ? "bg-[#e8f3fa] [html[data-theme='dark']_&]:bg-[rgba(38,92,134,0.36)]"
                        : "hover:bg-zinc-100 [html[data-theme='dark']_&]:hover:bg-[rgba(30,45,67,0.72)]"
                    }`}
                  >
                    <span className="block truncate text-sm font-medium text-zinc-900 [html[data-theme='dark']_&]:text-slate-100">
                      {client.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      {[client.ico ? `IČO ${client.ico}` : null, client.address]
                        .filter(Boolean)
                        .join(' · ') || 'Bez doplňujících údajů'}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <FieldShell label="IČO" className="md:col-span-2">
            <input
              type="text"
              value={value.clientIco}
              onChange={(event) => updateField('clientIco', event.target.value)}
              placeholder="Např. 12345678"
              inputMode="numeric"
              className={INPUT_CLASS}
            />
          </FieldShell>

          <FieldShell label="Adresa" className="md:col-span-6">
            <input
              type="text"
              value={value.clientAddress}
              onChange={(event) => updateField('clientAddress', event.target.value)}
              placeholder="Sídlo nebo fakturační adresa firmy"
              className={INPUT_CLASS}
            />
          </FieldShell>

          <FieldShell label="Kontaktní osoba" className="md:col-span-3">
            <input
              type="text"
              value={value.clientContactPerson}
              onChange={(event) => updateField('clientContactPerson', event.target.value)}
              placeholder="Jméno kontaktní osoby"
              className={INPUT_CLASS}
            />
          </FieldShell>

          <FieldShell label="Telefon" className="md:col-span-3">
            <input
              type="tel"
              value={value.clientContactPhone}
              onChange={(event) => updateField('clientContactPhone', event.target.value)}
              placeholder="Např. +420 777 123 456"
              className={INPUT_CLASS}
            />
          </FieldShell>

          {clientSearchError ? (
            <div className="md:col-span-6 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 [html[data-theme='dark']_&]:border-rose-400/20 [html[data-theme='dark']_&]:bg-rose-950/30 [html[data-theme='dark']_&]:text-rose-300">
              {clientSearchError}
            </div>
          ) : null}
        </div>
      </section>

      <section className={PANEL_CLASS}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className={PANEL_TITLE_CLASS}>Podnájemce</h3>
            <p className="mt-1 text-[11px] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Nepovinný údaj. Bez volby zůstane část v PDF prázdná.
            </p>
          </div>

          <div className="grid grid-cols-3 rounded-2xl border border-zinc-200 bg-zinc-100/75 p-1 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.15)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.7)]">
            {([
              { value: null, label: 'NEUVEDENO' },
              { value: 'yes', label: 'ANO' },
              { value: 'no', label: 'NE' },
            ] as Array<{ value: OperationalProtocolSubtenantChoice; label: string }>).map(
              (option) => {
                const isActive = value.subtenantChoice === option.value
                return (
                  <button
                    key={option.label}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setSubtenantChoice(option.value)}
                    className={`h-9 rounded-xl px-2 text-[9px] font-semibold tracking-[0.06em] transition sm:px-3 ${
                      isActive
                        ? "bg-white text-[#286f9f] shadow-sm [html[data-theme='dark']_&]:bg-[rgba(31,74,111,0.82)] [html[data-theme='dark']_&]:text-[#a9ddfb]"
                        : "text-zinc-500 hover:text-zinc-900 [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&:hover]:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                )
              }
            )}
          </div>
        </div>

        {value.subtenantChoice === 'yes' ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <FieldShell label="Název podnájemce">
              <input
                type="text"
                value={value.subtenantName}
                onChange={(event) => updateField('subtenantName', event.target.value)}
                placeholder="Firma nebo provozovna"
                className={INPUT_CLASS}
              />
            </FieldShell>
            <FieldShell label="Poznámka">
              <input
                type="text"
                value={value.subtenantNote}
                onChange={(event) => updateField('subtenantNote', event.target.value)}
                placeholder="Doplňující informace"
                className={INPUT_CLASS}
              />
            </FieldShell>
          </div>
        ) : null}
      </section>

      <section className={PANEL_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={PANEL_TITLE_CLASS}>Zařízení</h3>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              MTH a stav paliva jsou nepovinné. Nevyplněné hodnoty zůstanou v PDF prázdné.
            </p>
          </div>
          <button
            type="button"
            onClick={addDevice}
            className="inline-flex h-9 items-center justify-center rounded-2xl border border-[#8fc4e4] bg-[#edf7fd] px-3 text-[10px] font-semibold tracking-[0.08em] text-[#2474a7] shadow-sm transition duration-200 hover:-translate-y-[1px] hover:bg-[#e2f2fb] [html[data-theme='dark']_&]:border-[rgba(78,157,211,0.34)] [html[data-theme='dark']_&]:bg-[rgba(24,66,99,0.48)] [html[data-theme='dark']_&]:text-[#a4daf8]"
          >
            + PŘIDAT ZAŘÍZENÍ
          </button>
        </div>

        <div className="mt-3 space-y-2.5">
          {value.devices.map((device, index) => (
            <div
              key={index}
              className="rounded-[20px] border border-zinc-200/85 bg-zinc-50/75 p-3 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.13)] [html[data-theme='dark']_&]:bg-[rgba(5,13,24,0.46)]"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
                  Zařízení {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => removeDevice(index)}
                  aria-label={`Odebrat zařízení ${index + 1}`}
                  title="Odebrat zařízení"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-zinc-200 bg-white/85 text-base leading-none text-zinc-500 transition duration-200 hover:-translate-y-[1px] hover:border-rose-200 hover:text-rose-600 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.86)] [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&:hover]:border-rose-400/30 [html[data-theme='dark']_&:hover]:text-rose-300"
                >
                  ×
                </button>
              </div>

              <div className="mt-2.5 grid min-w-0 gap-3 md:grid-cols-12">
                <FieldShell label="Zařízení / označení" className="md:col-span-4">
                  <input
                    type="text"
                    value={device.deviceName}
                    onChange={(event) => updateDevice(index, 'deviceName', event.target.value)}
                    placeholder="Např. DA 150 kVA · RZ 01"
                    className={INPUT_CLASS}
                  />
                </FieldShell>

                <FieldShell label="MTH START" className="md:col-span-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={device.mthStart}
                    onChange={(event) => updateDevice(index, 'mthStart', event.target.value)}
                    placeholder="Např. 1250,5"
                    className={INPUT_CLASS}
                  />
                </FieldShell>

                <FieldShell label="MTH KONEC" className="md:col-span-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={device.mthEnd}
                    onChange={(event) => updateDevice(index, 'mthEnd', event.target.value)}
                    placeholder="Např. 1268,0"
                    className={INPUT_CLASS}
                  />
                </FieldShell>

                <FieldShell label="Palivo při předání" hint="%" className="md:col-span-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="1"
                    value={device.fuelStartPercent ?? ''}
                    onChange={(event) =>
                      updateDevice(index, 'fuelStartPercent', event.target.value)
                    }
                    placeholder="0–100"
                    className={INPUT_CLASS}
                  />
                </FieldShell>

                <FieldShell label="Palivo při vrácení" hint="%" className="md:col-span-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max="100"
                    step="1"
                    value={device.fuelEndPercent ?? ''}
                    onChange={(event) =>
                      updateDevice(index, 'fuelEndPercent', event.target.value)
                    }
                    placeholder="0–100"
                    className={INPUT_CLASS}
                  />
                </FieldShell>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={PANEL_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={PANEL_TITLE_CLASS}>Příslušenství</h3>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Nepovinný seznam předaného vybavení a doplňků.
            </p>
          </div>
          <button
            type="button"
            onClick={addAccessory}
            className="inline-flex h-9 items-center justify-center rounded-2xl border border-[#8fc4e4] bg-[#edf7fd] px-3 text-[10px] font-semibold tracking-[0.08em] text-[#2474a7] shadow-sm transition duration-200 hover:-translate-y-[1px] hover:bg-[#e2f2fb] [html[data-theme='dark']_&]:border-[rgba(78,157,211,0.34)] [html[data-theme='dark']_&]:bg-[rgba(24,66,99,0.48)] [html[data-theme='dark']_&]:text-[#a4daf8]"
          >
            + PŘIDAT PŘÍSLUŠENSTVÍ
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {value.accessories.map((accessory, index) => (
            <div key={index} className="flex min-w-0 items-center gap-2">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-[10px] font-semibold text-zinc-500 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,13,24,0.5)] [html[data-theme='dark']_&]:text-slate-400">
                {index + 1}
              </span>
              <input
                type="text"
                value={accessory.itemName}
                onChange={(event) => updateAccessory(index, event.target.value)}
                placeholder="Např. prodlužovací kabel 25 m"
                aria-label={`Příslušenství ${index + 1}`}
                className={INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => removeAccessory(index)}
                aria-label={`Odebrat příslušenství ${index + 1}`}
                title="Odebrat příslušenství"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white/85 text-base leading-none text-zinc-500 transition duration-200 hover:-translate-y-[1px] hover:border-rose-200 hover:text-rose-600 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.86)] [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&:hover]:border-rose-400/30 [html[data-theme='dark']_&:hover]:text-rose-300"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className={PANEL_CLASS}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className={PANEL_TITLE_CLASS}>Realizace</h3>
            <p className="mt-1 text-[11px] leading-5 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
              Tyto údaje se propíší do podpisové části protokolu.
            </p>
          </div>
          <span className="rounded-xl border border-[#b8d9ed] bg-[#eef8fd] px-2.5 py-1.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#2877a9] [html[data-theme='dark']_&]:border-[rgba(78,157,211,0.28)] [html[data-theme='dark']_&]:bg-[rgba(24,66,99,0.34)] [html[data-theme='dark']_&]:text-[#9fd9f8]">
            Digitální podpis se doplní při generování
          </span>
        </div>

        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-3">
          <FieldShell label="Datum a čas od" required className="min-w-0">
            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl">
              <input
                type="datetime-local"
                value={value.realizationAt}
                onChange={(event) => updateField('realizationAt', event.target.value)}
                className={`${INPUT_CLASS} filter-datetime-input`}
              />
            </div>
          </FieldShell>

          <FieldShell label="Datum a čas do" required className="min-w-0">
            <div className="min-w-0 max-w-full overflow-hidden rounded-2xl">
              <input
                type="datetime-local"
                value={value.realizationCompletedAt}
                onChange={(event) => updateField('realizationCompletedAt', event.target.value)}
                className={`${INPUT_CLASS} filter-datetime-input`}
              />
            </div>
          </FieldShell>

          <FieldShell label="Technik B-ENERGY" required>
            <input
              type="text"
              value={value.technicianName}
              onChange={(event) => updateField('technicianName', event.target.value)}
              placeholder="Jméno technika"
              autoComplete="off"
              className={INPUT_CLASS}
            />
          </FieldShell>
        </div>
      </section>
    </div>
  )
}

function FieldShell({
  label,
  required = false,
  hint,
  className = '',
  children,
}: {
  label: string
  required?: boolean
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className={LABEL_CLASS.replace('mb-1.5 ', '')}>
          {label} {required ? <span className="text-rose-500">*</span> : null}
        </label>
        {hint ? (
          <span className="text-[9px] uppercase tracking-[0.08em] text-zinc-400 [html[data-theme='dark']_&]:text-slate-500">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}
