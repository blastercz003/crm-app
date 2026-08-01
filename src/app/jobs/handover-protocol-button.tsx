'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { SuccessConfirmationModal } from '@/components/ui/success-confirmation-modal'
import { ModalHeading } from '@/components/ui/modal-heading'
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
  className?: string
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
  className = '',
}: HandoverProtocolButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="Předávací protokol"
        aria-label="Předávací protokol"
        className={`inline-flex h-8 items-center justify-center rounded-xl border border-[#6fa9d1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] ${className} ${
          compact
            ? 'min-w-[78px] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(41,128,185,0.3)]'
            : 'w-8 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(41,128,185,0.3)]'
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
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
  }

  function addDevice() {
    setDraft((current) => ({
      ...current,
      devices: [...current.devices, createEmptyDevice()],
    }))
  }

  function removeDevice(index: number) {
    setDraft((current) => ({
      ...current,
      devices:
        current.devices.length === 1
          ? [createEmptyDevice()]
          : current.devices.filter((_, deviceIndex) => deviceIndex !== index),
    }))
  }

  function addAccessory() {
    setDraft((current) => ({
      ...current,
      accessories: [...current.accessories, createEmptyAccessory()],
    }))
  }

  function removeAccessory(index: number) {
    setDraft((current) => ({
      ...current,
      accessories:
        current.accessories.length === 1
          ? [createEmptyAccessory()]
          : current.accessories.filter((_, itemIndex) => itemIndex !== index),
    }))
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
  }

  function toggleSentState(nextIsSent: boolean) {
    const nextDraft = {
      ...draft,
      is_sent: nextIsSent,
    }

    setDraft(nextDraft)
    setLoadError(null)
    setSuccessMessage(null)

    startSaving(async () => {
      const result = await saveHandoverProtocolDraftAction(job.id, sanitizeDraft(nextDraft))

      if (!result.success) {
        setLoadError(result.error ?? 'Nepodařilo se uložit stav předávacího protokolu.')
        setDraft(draft)
        return
      }

      if (nextIsSent) {
        setSuccessMessage('Předávací protokol byl úspěšně odeslán do sekce Moje zakázky.')
      }
    })
  }

  function persistDraft(nextAction: 'save' | 'preview' | 'generate') {
    setLoadError(null)
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

      if (nextAction === 'save') return

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

  const modalContent = (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto bg-zinc-950/38 p-2 backdrop-blur-[5px] sm:p-3 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-2 sm:items-center sm:py-3">
        <div className="jobs-page__modal-shell jobs-page__handover-modal flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:max-h-[calc(100dvh-1.5rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div className="jobs-page__handover-header flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex min-w-0 flex-col items-start">
              <ModalHeading section="ZAKÁZKY" title="Předávací protokol" />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="jobs-page__handover-job-badge inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_10px_18px_rgba(24,78,129,0.26)]">
                  ZAKÁZKA {job.job_number}
                </div>
                {draft.is_sent ? (
                  <button
                    type="button"
                    disabled={isLoading || isSaving}
                    onClick={() => toggleSentState(!draft.is_sent)}
                    className="jobs-page__job-status-button inline-flex items-center justify-center rounded-full border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                    data-status="realizace"
                  >
                    POSLÁNO TECHNIKOVI
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isLoading || isSaving}
                    onClick={() => toggleSentState(!draft.is_sent)}
                    className="jobs-page__handover-sent-badge inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.08em] transition disabled:cursor-not-allowed disabled:opacity-60 jobs-page__handover-sent-badge--send"
                  >
                    ODESLAT TECHNIKOVI
                  </button>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-3">
            <div className="grid gap-3">
              <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(15,23,42,0.08)]">
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
                    className="jobs-page__handover-row grid gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1fr)_auto]"
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
                        className="jobs-page__handover-remove inline-flex h-10 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
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
                    className="jobs-page__handover-row grid gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1fr)_auto]"
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
                        className="jobs-page__handover-remove inline-flex h-10 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px]"
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

            </div>
          </div>

          <div className="jobs-page__handover-footer border-t border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-4 py-3 sm:px-5 sm:py-3">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={onClose}
                className="jobs-page__handover-cancel rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-5 py-3 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
              >
                ZRUŠIT
              </button>

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={isLoading || isSaving}
                  onClick={() => persistDraft('save')}
                  className="jobs-page__handover-save rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-5 py-3 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  ULOŽIT DO ZAKÁZKY
                </button>
                <button
                  type="button"
                  disabled={isLoading || isSaving || !canPreview}
                  onClick={() => persistDraft('preview')}
                  className="jobs-page__handover-preview rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-5 py-3 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  NÁHLED
                </button>
                <button
                  type="button"
                  disabled={isLoading || isSaving || !canPreview}
                  onClick={() => persistDraft('generate')}
                  className="jobs-page__handover-generate inline-flex items-center justify-center gap-2 rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-5 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
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

  if (typeof document === 'undefined') {
    return null
  }

  return (
    <>
      {createPortal(modalContent, document.body)}
      <SuccessConfirmationModal
        isOpen={Boolean(successMessage)}
        section="Zakázky"
        title="PP odeslán technikovi"
        message={successMessage ?? ''}
        confirmLabel="OK"
        onConfirm={() => setSuccessMessage(null)}
      />
    </>
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
    <section className="jobs-page__handover-section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(15,23,42,0.08)]">
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="jobs-page__handover-add inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
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
  const baseInputClass =
    'jobs-page__handover-input h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition'

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
        className={`${baseInputClass} ${
          readOnly
            ? 'text-gray-700'
            : 'text-gray-900 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'
        }`}
      />
    </div>
  )
}
