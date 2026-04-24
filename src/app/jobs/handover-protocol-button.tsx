'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  getHandoverProtocolDraftAction,
  saveHandoverProtocolDraftAction,
  type HandoverProtocolAccessoryInput,
  type HandoverProtocolDeviceInput,
} from './handover-protocol-actions'

type JobProtocolButtonJob = {
  id: string
  job_number: string
  site_address: string | null
}

type HandoverProtocolButtonProps = {
  job: JobProtocolButtonJob
  compact?: boolean
}

type DraftState = {
  handover_title: string
  handover_place: string
  contact_person: string
  contact_phone: string
  is_sent: boolean
  devices: HandoverProtocolDeviceInput[]
  accessories: HandoverProtocolAccessoryInput[]
}

function createEmptyDevice(): HandoverProtocolDeviceInput {
  return {
    device_name: '',
    mth_start: '',
    mth_end: '',
  }
}

function createEmptyAccessory(): HandoverProtocolAccessoryInput {
  return {
    item_name: '',
    issued_value: '',
    returned_value: '',
  }
}

function buildInitialDraft(siteAddress: string | null): DraftState {
  return {
    handover_title: '',
    handover_place: siteAddress ?? '',
    contact_person: '',
    contact_phone: '',
    is_sent: false,
    devices: [createEmptyDevice()],
    accessories: [createEmptyAccessory()],
  }
}

function sanitizeDraft(state: DraftState) {
  return {
    handover_title: state.handover_title,
    handover_place: state.handover_place,
    contact_person: state.contact_person,
    contact_phone: state.contact_phone,
    is_sent: state.is_sent,
    devices: state.devices,
    accessories: state.accessories,
  }
}

export function HandoverProtocolButton({
  job,
  compact = false,
}: HandoverProtocolButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Předávací protokol"
        aria-label="Předávací protokol"
        className={`inline-flex h-8 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 ${
          compact ? 'min-w-[78px] px-3' : 'w-8'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M7 3h7l5 5v13H7a2 2 0 01-2-2V5a2 2 0 012-2z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 3v5h5M9 13h6M9 17h6"
          />
        </svg>
      </button>

      {isOpen ? <HandoverProtocolModal job={job} onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

function HandoverProtocolModal({
  job,
  onClose,
}: {
  job: JobProtocolButtonJob
  onClose: () => void
}) {
  const [draft, setDraft] = useState<DraftState>(() => buildInitialDraft(job.site_address))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving] = useTransition()

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    startLoading(async () => {
      const result = await getHandoverProtocolDraftAction(job.id)

      if (!result.success || !result.data) {
        setLoadError(result.error ?? 'Nepodařilo se načíst předávací protokol.')
        return
      }

      setDraft({
        handover_title: result.data.handover_title,
        handover_place: result.data.handover_place || job.site_address || '',
        contact_person: result.data.contact_person,
        contact_phone: result.data.contact_phone,
        is_sent: result.data.is_sent,
        devices:
          result.data.devices.length > 0
            ? result.data.devices.map((device) => ({
                ...device,
                mth_start: '',
                mth_end: '',
              }))
            : [createEmptyDevice()],
        accessories:
          result.data.accessories.length > 0
            ? result.data.accessories.map((item) => ({
                ...item,
                issued_value: '',
                returned_value: '',
              }))
            : [createEmptyAccessory()],
      })
    })
  }, [job.id, job.site_address])

  const canPreview = useMemo(
    () =>
      draft.devices.some((item) => item.device_name.trim()) ||
      draft.accessories.some((item) => item.item_name.trim()),
    [draft.accessories, draft.devices]
  )

  function updateDevice(index: number, field: keyof HandoverProtocolDeviceInput, value: string) {
    setDraft((current) => ({
      ...current,
      devices: current.devices.map((device, deviceIndex) =>
        deviceIndex === index ? { ...device, [field]: value } : device
      ),
    }))
    setSaveMessage(null)
  }

  function updateAccessory(
    index: number,
    field: keyof HandoverProtocolAccessoryInput,
    value: string
  ) {
    setDraft((current) => ({
      ...current,
      accessories: current.accessories.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      ),
    }))
    setSaveMessage(null)
  }

  function addDevice() {
    setDraft((current) => ({
      ...current,
      devices: [...current.devices, createEmptyDevice()],
    }))
    setSaveMessage(null)
  }

  function removeDevice(index: number) {
    setDraft((current) => ({
      ...current,
      devices:
        current.devices.length === 1
          ? [createEmptyDevice()]
          : current.devices.filter((_, deviceIndex) => deviceIndex !== index),
    }))
    setSaveMessage(null)
  }

  function addAccessory() {
    setDraft((current) => ({
      ...current,
      accessories: [...current.accessories, createEmptyAccessory()],
    }))
    setSaveMessage(null)
  }

  function removeAccessory(index: number) {
    setDraft((current) => ({
      ...current,
      accessories:
        current.accessories.length === 1
          ? [createEmptyAccessory()]
          : current.accessories.filter((_, itemIndex) => itemIndex !== index),
    }))
    setSaveMessage(null)
  }

  function updateField(
    field: 'handover_title' | 'contact_person' | 'contact_phone',
    value: string
  ) {
    setDraft((current) => ({
      ...current,
      [field]: value,
      ...(field === 'contact_person' ? { contact_phone: '' } : {}),
    }))
    setSaveMessage(null)
  }

  function toggleSentState(nextIsSent: boolean) {
    const nextDraft = {
      ...draft,
      is_sent: nextIsSent,
    }

    setDraft(nextDraft)
    setLoadError(null)
    setSaveMessage(null)

    startSaving(async () => {
      const result = await saveHandoverProtocolDraftAction(job.id, sanitizeDraft(nextDraft))

      if (!result.success) {
        setLoadError(result.error ?? 'Nepodařilo se uložit stav předávacího protokolu.')
        setDraft(draft)
        return
      }

      setSaveMessage(
        nextIsSent
          ? 'Předávací protokol byl označen jako POSLÁNO.'
          : 'Předávací protokol byl označen jako NEPOSLÁNO.'
      )
    })
  }

  function persistDraft(nextAction: 'save' | 'preview' | 'generate') {
    setLoadError(null)
    setSaveMessage(null)
    const shouldUseCurrentTab =
      nextAction !== 'save' &&
      window.matchMedia('(max-width: 1023px)').matches
    const previewWindow =
      nextAction === 'save' || shouldUseCurrentTab
        ? null
        : window.open('', '_blank')

    startSaving(async () => {
      const result = await saveHandoverProtocolDraftAction(job.id, sanitizeDraft(draft))

      if (!result.success) {
        previewWindow?.close()
        setLoadError(result.error ?? 'Předávací protokol se nepodařilo uložit.')
        return
      }

      if (nextAction === 'save') {
        setSaveMessage('Předávací protokol byl uložen do zakázky.')
        return
      }

      const url =
        nextAction === 'generate'
          ? `/jobs/${job.id}/pp?standalone=1&print=1`
          : `/jobs/${job.id}/pp`

      if (previewWindow) {
        previewWindow.location.href = url
        return
      }

      window.location.assign(url)
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/45 p-2 backdrop-blur-sm sm:p-3"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-2 sm:items-center sm:py-3">
        <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-1.5rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-3">
            <div className="flex min-w-0 flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Předávací protokol
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center rounded-full border border-[#2980B9] bg-[#2980B9] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white">
                  ZAKÁZKA {job.job_number}
                </div>
                <button
                  type="button"
                  disabled={isLoading || isSaving}
                  onClick={() => toggleSentState(!draft.is_sent)}
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    draft.is_sent
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {draft.is_sent ? 'POSLÁNO' : 'NEPOSLÁNO'}
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-3">
            <div className="grid gap-3">
              <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3.5">
                <div className="mb-3 text-left">
                  <h3 className="text-base font-semibold tracking-tight text-gray-900">
                    Základ protokolu
                  </h3>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    label="Název zakázky"
                    value={draft.handover_title}
                    onChange={(value) => updateField('handover_title', value)}
                  />
                  <Field
                    label="Kontaktní osoba / Telefon"
                    value={
                      draft.contact_phone
                        ? `${draft.contact_person} ${draft.contact_phone}`.trim()
                        : draft.contact_person
                    }
                    onChange={(value) => updateField('contact_person', value)}
                  />
                </div>
              </section>

              <EditableRowsSection
                title="Zařízení"
                addLabel="PŘIDAT ZAŘÍZENÍ"
                onAdd={addDevice}
              >
                {draft.devices.map((device, index) => (
                  <div
                    key={device.id ?? `device-${index}`}
                    className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-2.5 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <Field
                      label="Název / kód zařízení"
                      value={device.device_name}
                      onChange={(value) => updateDevice(index, 'device_name', value)}
                    />
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeDevice(index)}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition hover:bg-red-50"
                      >
                        ODEBRAT
                      </button>
                    </div>
                  </div>
                ))}
              </EditableRowsSection>

              <EditableRowsSection
                title="Příslušenství"
                addLabel="PŘIDAT PŘÍSLUŠENSTVÍ"
                onAdd={addAccessory}
              >
                {draft.accessories.map((item, index) => (
                  <div
                    key={item.id ?? `accessory-${index}`}
                    className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-2.5 md:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <Field
                      label="Název / kód příslušenství"
                      value={item.item_name}
                      onChange={(value) => updateAccessory(index, 'item_name', value)}
                    />
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={() => removeAccessory(index)}
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-4 text-sm font-medium text-red-600 transition hover:bg-red-50"
                      >
                        ODEBRAT
                      </button>
                    </div>
                  </div>
                ))}
              </EditableRowsSection>

              {loadError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {loadError}
                </div>
              ) : null}

              {saveMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {saveMessage}
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3 sm:px-5 sm:py-3">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-11 items-center justify-center rounded-2xl bg-red-600 px-5 text-sm font-medium text-white transition hover:bg-red-700"
              >
                ZRUŠIT
              </button>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={isLoading || isSaving}
                  onClick={() => persistDraft('save')}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  ULOŽIT DO ZAKÁZKY
                </button>
                <button
                  type="button"
                  disabled={isLoading || isSaving || !canPreview}
                  onClick={() => persistDraft('preview')}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-zinc-900 px-5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  NÁHLED
                </button>
                <button
                  type="button"
                  disabled={isLoading || isSaving || !canPreview}
                  onClick={() => persistDraft('generate')}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2980B9] px-5 text-sm font-medium text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  GENEROVAT PP
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function EditableRowsSection({
  title,
  addLabel,
  onAdd,
  children,
}: {
  title: string
  addLabel: string
  onAdd: () => void
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-3.5">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          {addLabel}
        </button>
      </div>

      <div className="grid gap-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
  readOnly = false,
}: {
  label: string
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        type="text"
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
        className={`h-11 w-full rounded-xl border px-3 text-sm outline-none transition ${
          readOnly
            ? 'border-gray-200 bg-gray-100 text-gray-700'
            : 'border-gray-200 bg-white text-gray-900 focus:border-gray-300 focus:ring-2 focus:ring-gray-200'
        }`}
      />
    </div>
  )
}
