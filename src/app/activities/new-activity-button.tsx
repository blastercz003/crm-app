'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Bell,
  BellOff,
  CalendarClock,
  Check,
  ChevronDown,
  ClipboardPenLine,
  Mail,
  MapPin,
  Phone,
  Plus,
  Repeat2,
  X,
} from 'lucide-react'
import { createManualActivityAction } from './actions'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  requestModalMotionClose,
  useModalActionSuccess,
  useModalMotionClose,
} from '@/components/ui/modal-motion'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityActionState, ActivityClientOption, ActivityListItem, ActivityRecurrenceUnit, ManualActivityType } from '@/lib/activities/types'

const INITIAL_STATE: ActivityActionState = { success: false, error: null }

const ACTIVITY_TYPES: Array<{
  value: ManualActivityType
  label: string
  mobileLabel: string
  icon: typeof Phone
}> = [
  { value: 'phone_call', label: 'Telefonát', mobileLabel: 'Telefon', icon: Phone },
  { value: 'email', label: 'E-mail', mobileLabel: 'E-mail', icon: Mail },
  { value: 'in_person_meeting', label: 'Osobní kontakt', mobileLabel: 'Kontakt', icon: MapPin },
  { value: 'work_log', label: 'Pracovní zápis', mobileLabel: 'Zápis', icon: ClipboardPenLine },
  { value: 'other', label: 'Ostatní', mobileLabel: 'Ostatní', icon: Plus },
]

function toLocalDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatActivityDateTimeDisplay(date: Date) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Prague',
  }).format(date)
}

function normalizeClientSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
}

type ActivityFormAction = (
  state: ActivityActionState,
  formData: FormData,
) => Promise<ActivityActionState>

function SubmitButton({ planned, editing }: { planned: boolean; editing: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="standard-form-modal__primary-action inline-flex items-center justify-center"
    >
      {pending ? 'UKLÁDÁM…' : editing ? 'ULOŽIT ZMĚNY' : planned ? 'NAPLÁNOVAT AKTIVITU' : 'ULOŽIT AKTIVITU'}
    </button>
  )
}

export function ActivityFormModal({ clients, activity = null, initialClientId = '', initialValues, action, onClose, onSaved }: {
  clients: ActivityClientOption[]
  activity?: ActivityListItem | null
  initialClientId?: string
  initialValues?: {
    title?: string
    description?: string
    activityType?: ManualActivityType
  }
  action: ActivityFormAction
  onClose: () => void
  onSaved: (state: ActivityActionState) => void
}) {
  const requestClose = useModalMotionClose(onClose)
  const [state, formAction] = useActionState(action, INITIAL_STATE)
  const editing = Boolean(activity)
  const [mode, setMode] = useState<'logged' | 'planned'>(() => activity?.status === 'planned' ? 'planned' : 'logged')
  const [reminderEnabled, setReminderEnabled] = useState(activity?.reminder_enabled ?? false)
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(Boolean(activity?.recurrence_unit))
  const [recurrenceUnit, setRecurrenceUnit] = useState<ActivityRecurrenceUnit>(activity?.recurrence_unit ?? 'week')
  const [recurrenceInterval, setRecurrenceInterval] = useState(activity?.recurrence_interval ?? 1)
  const [customRecurrence, setCustomRecurrence] = useState(Boolean(activity?.recurrence_interval && activity.recurrence_interval > 1))
  const [activityType, setActivityType] = useState<ManualActivityType>(() => {
    const value = activity?.activity_type as ManualActivityType | undefined
    return value && ACTIVITY_TYPES.some((type) => type.value === value)
      ? value
      : initialValues?.activityType ?? 'phone_call'
  })
  const now = useState(() => new Date(activity?.occurred_at ?? Date.now()))[0]
  const plannedDefault = useState(() => {
    if (activity?.scheduled_for) return new Date(activity.scheduled_for)
    const value = new Date()
    value.setDate(value.getDate() + 1)
    value.setMinutes(0, 0, 0)
    value.setHours(Math.max(8, value.getHours()))
    return value
  })[0]
  const initialClient = clients.find((client) => client.id === (activity?.client_id ?? initialClientId)) ?? null
  const clientInputRef = useRef<HTMLInputElement>(null)
  const [clientId, setClientId] = useState(initialClient?.id ?? '')
  const [clientQuery, setClientQuery] = useState(initialClient?.name ?? '')
  const [clientFilter, setClientFilter] = useState(initialClient?.name ?? '')
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [activeClientIndex, setActiveClientIndex] = useState(0)
  const filteredClients = useMemo(() => {
    const normalizedFilter = normalizeClientSearch(clientFilter)
    if (!normalizedFilter) return clients.slice(0, 8)
    return clients
      .filter((client) => normalizeClientSearch(client.name).includes(normalizedFilter))
      .sort((left, right) => {
        const leftStarts = normalizeClientSearch(left.name).startsWith(normalizedFilter)
        const rightStarts = normalizeClientSearch(right.name).startsWith(normalizedFilter)
        return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name, 'cs')
      })
      .slice(0, 8)
  }, [clientFilter, clients])

  function selectClient(client: ActivityClientOption) {
    setClientId(client.id)
    setClientQuery(client.name)
    setClientFilter(client.name)
    setClientSuggestionsOpen(false)
    setActiveClientIndex(0)
  }

  function handleClientChange(value: string) {
    if (!value) {
      setClientId('')
      setClientQuery('')
      setClientFilter('')
      setClientSuggestionsOpen(true)
      setActiveClientIndex(0)
      return
    }

    const normalizedValue = normalizeClientSearch(value)
    const prefixMatch = clients.find((client) => normalizeClientSearch(client.name).startsWith(normalizedValue))

    setClientFilter(value)
    setClientSuggestionsOpen(true)
    setActiveClientIndex(0)

    if (!prefixMatch) {
      setClientId('')
      setClientQuery(value)
      return
    }

    setClientId(prefixMatch.id)
    setClientQuery(prefixMatch.name)
    requestAnimationFrame(() => {
      clientInputRef.current?.setSelectionRange(value.length, prefixMatch.name.length)
    })
  }

  function handleClientKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && clientSuggestionsOpen) {
      event.preventDefault()
      event.stopPropagation()
      setClientSuggestionsOpen(false)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setClientSuggestionsOpen(true)
      setActiveClientIndex((current) => {
        if (filteredClients.length === 0) return 0
        const direction = event.key === 'ArrowDown' ? 1 : -1
        return (current + direction + filteredClients.length) % filteredClients.length
      })
      return
    }

    if (event.key === 'Enter' && clientSuggestionsOpen && filteredClients[activeClientIndex]) {
      event.preventDefault()
      selectClient(filteredClients[activeClientIndex])
    }
  }

  useBodyScrollLock(true)

  useModalActionSuccess(state.success, () => {
    requestModalMotionClose(() => onSaved(state))
  })

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [requestClose])

  return (
    <div
      data-modal-motion-root
      className="activities-modal fixed inset-0 z-[120] overflow-hidden overscroll-none bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-form-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <div className="flex h-full min-h-0 items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose() }}>
        <section data-modal-motion-surface className="standard-form-modal__shell activities-modal__shell relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.97)_0%,rgba(249,250,251,0.95)_48%,rgba(244,244,245,0.93)_100%)] shadow-[0_32px_82px_rgba(24,24,27,0.34)]">
          <header className="standard-form-modal__header activities-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6">
            <ModalHeading id="activity-form-title" section="AKTIVITY" title={editing ? 'Upravit aktivitu' : 'Nová aktivita'} />
            <button type="button" onClick={requestClose} aria-label="Zavřít" className="standard-form-modal__close activities-modal__close inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm transition hover:-translate-y-px hover:text-zinc-900"><X aria-hidden size={18} /></button>
          </header>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="activity_type" value={activityType} />
            <input type="hidden" name="occurred_at" value={toLocalDateTimeInput(now)} />
            <input type="hidden" name="reminder_enabled" value={mode === 'planned' && reminderEnabled ? 'true' : 'false'} />
            <input type="hidden" name="recurrence_enabled" value={mode === 'planned' && recurrenceEnabled ? 'true' : 'false'} />
            <input type="hidden" name="recurrence_unit" value={recurrenceUnit} />
            <input type="hidden" name="recurrence_interval" value={recurrenceInterval} />

            <div className="standard-form-modal__body activities-modal__body min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 sm:py-6">

            <fieldset>
              <div className="activities-modal__mode-switch grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200/80 bg-zinc-100/75 p-1.5">
                <button type="button" onClick={() => setMode('logged')} className={`activities-modal__mode ${mode === 'logged' ? 'activities-modal__mode--active' : ''}`}><ClipboardPenLine aria-hidden size={17} /> Zapsat činnost</button>
                <button type="button" onClick={() => setMode('planned')} className={`activities-modal__mode ${mode === 'planned' ? 'activities-modal__mode--active' : ''}`}><CalendarClock aria-hidden size={17} /> Naplánovat aktivitu</button>
              </div>
            </fieldset>

            <fieldset>
              <legend className="activities-modal__label">Typ aktivity</legend>
              <div className="mt-2 grid grid-cols-5 gap-1.5 sm:gap-2">
                {ACTIVITY_TYPES.map((type) => {
                  const Icon = type.icon
                  const selected = activityType === type.value
                  return <button key={type.value} type="button" onClick={() => setActivityType(type.value)} aria-pressed={selected} className={`activities-modal__type min-w-0 ${selected ? 'activities-modal__type--active' : ''}`}><Icon aria-hidden size={17} /><span className="sm:hidden">{type.mobileLabel}</span><span className="hidden sm:inline">{type.label}</span></button>
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor="activity-title" className="activities-modal__label">{mode === 'planned' ? 'Co chcete udělat?' : 'Co jste udělal/a?'}</label>
              <input id="activity-title" name="title" required maxLength={240} defaultValue={activity?.title ?? initialValues?.title ?? ''} className="activities-modal__input mt-2" placeholder={mode === 'planned' ? 'Např. Zavolat klientovi ohledně nabídky' : 'Např. Volala jsem třem potenciálním klientům'} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="activity-client" className="activities-modal__label">Klient <span className="font-normal text-zinc-400">(volitelné)</span></label>
                <input type="hidden" name="client_id" value={clientId} />
                <div className="relative mt-2">
                  <input
                    ref={clientInputRef}
                    id="activity-client"
                    type="text"
                    role="combobox"
                    aria-autocomplete="both"
                    aria-expanded={clientSuggestionsOpen}
                    aria-controls="activity-client-suggestions"
                    aria-activedescendant={clientSuggestionsOpen && filteredClients[activeClientIndex] ? `activity-client-option-${filteredClients[activeClientIndex].id}` : undefined}
                    autoComplete="off"
                    value={clientQuery}
                    onChange={(event) => handleClientChange(event.target.value)}
                    onFocus={() => setClientSuggestionsOpen(true)}
                    onBlur={() => window.setTimeout(() => {
                      setClientSuggestionsOpen(false)
                      if (!clientId) {
                        setClientQuery('')
                        setClientFilter('')
                      }
                    }, 120)}
                    onKeyDown={handleClientKeyDown}
                    className="activities-modal__input"
                    placeholder="Začněte psát název klienta"
                  />
                  {clientSuggestionsOpen ? (
                    <div id="activity-client-suggestions" role="listbox" className="activities-modal__client-suggestions absolute inset-x-0 top-[calc(100%+0.4rem)] z-30 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(24,24,27,0.18)]">
                      {filteredClients.length > 0 ? filteredClients.map((client, index) => (
                        <button
                          key={client.id}
                          id={`activity-client-option-${client.id}`}
                          type="button"
                          role="option"
                          aria-selected={client.id === clientId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectClient(client)}
                          className={`activities-modal__client-suggestion flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${index === activeClientIndex ? 'activities-modal__client-suggestion--active bg-sky-50 text-sky-800' : 'text-zinc-700 hover:bg-zinc-50'}`}
                        >
                          {client.name}
                        </button>
                      )) : <p className="px-3 py-2 text-sm text-zinc-500">Žádný klient nenalezen.</p>}
                    </div>
                  ) : null}
                </div>
              </div>
              {mode === 'planned' ? (
                <div key="planned-date" className="activities-modal__date-field min-w-0">
                  <label htmlFor="activity-scheduled-for" className="activities-modal__label">Termín</label>
                  <input id="activity-scheduled-for" name="scheduled_for" type="datetime-local" required defaultValue={toLocalDateTimeInput(plannedDefault)} className="activities-modal__input activities-modal__datetime-input mt-2 appearance-none" />
                </div>
              ) : (
                <div key="logged-date" className="activities-modal__date-field min-w-0">
                  <label htmlFor="activity-occurred-visible" className="activities-modal__label">Datum a čas zápisu</label>
                  <input id="activity-occurred-visible" type="text" readOnly value={formatActivityDateTimeDisplay(now)} className="activities-modal__input mt-2 cursor-default opacity-75" />
                </div>
              )}
            </div>

            {mode === 'planned' ? (
              <div>
                <p id="activity-planning-options-label" className="activities-modal__label">Upozornění a opakování</p>
                <fieldset aria-labelledby="activity-planning-options-label" className="activities-modal__planning-options mt-2 rounded-2xl border border-zinc-200/80 bg-white/55 p-3.5 sm:p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={reminderEnabled}
                    onClick={() => setReminderEnabled((current) => !current)}
                    className={`activities-modal__option-toggle ${reminderEnabled ? 'activities-modal__option-toggle--active' : ''}`}
                  >
                    <span className="activities-modal__option-icon">
                      {reminderEnabled ? <Bell aria-hidden size={17} /> : <BellOff aria-hidden size={17} />}
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block text-xs font-semibold">Notifikace</strong>
                      <span className="mt-0.5 block text-[10px] leading-4 opacity-70">15 minut před termínem</span>
                    </span>
                    {reminderEnabled ? <Check aria-hidden size={16} className="shrink-0" /> : null}
                  </button>

                  <button
                    type="button"
                    aria-pressed={recurrenceEnabled}
                    onClick={() => setRecurrenceEnabled((current) => !current)}
                    className={`activities-modal__option-toggle ${recurrenceEnabled ? 'activities-modal__option-toggle--active' : ''}`}
                  >
                    <span className="activities-modal__option-icon"><Repeat2 aria-hidden size={17} /></span>
                    <span className="min-w-0 flex-1 text-left">
                      <strong className="block text-xs font-semibold">Opakovat aktivitu</strong>
                      <span className="mt-0.5 block text-[10px] leading-4 opacity-70">Po dokončení vytvoří další</span>
                    </span>
                    {recurrenceEnabled ? <Check aria-hidden size={16} className="shrink-0" /> : null}
                  </button>
                </div>

                {recurrenceEnabled ? (
                  <div className="activities-modal__recurrence mt-3 rounded-xl border border-zinc-200/75 bg-zinc-50/70 p-2.5">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {([
                        { label: 'DENNĚ', unit: 'day' as const },
                        { label: 'TÝDNĚ', unit: 'week' as const },
                        { label: 'MĚSÍČNĚ', unit: 'month' as const },
                      ]).map((option) => (
                        <button
                          key={option.unit}
                          type="button"
                          aria-pressed={!customRecurrence && recurrenceUnit === option.unit && recurrenceInterval === 1}
                          onClick={() => { setRecurrenceUnit(option.unit); setRecurrenceInterval(1); setCustomRecurrence(false) }}
                          className={`activities-modal__recurrence-choice ${!customRecurrence && recurrenceUnit === option.unit && recurrenceInterval === 1 ? 'activities-modal__recurrence-choice--active' : ''}`}
                        >
                          {option.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        aria-pressed={customRecurrence}
                        onClick={() => { setCustomRecurrence(true); setRecurrenceInterval((current) => Math.max(2, current)) }}
                        className={`activities-modal__recurrence-choice ${customRecurrence ? 'activities-modal__recurrence-choice--active' : ''}`}
                      >
                        VLASTNÍ
                      </button>
                    </div>

                    {customRecurrence ? (
                      <div className="mt-2.5 grid grid-cols-[auto_5rem_minmax(8rem,1fr)] items-center gap-2 text-xs font-semibold text-zinc-600">
                        <span>Každé</span>
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={recurrenceInterval}
                          onChange={(event) => setRecurrenceInterval(Math.min(365, Math.max(1, Number(event.target.value) || 1)))}
                          className="activities-modal__input h-10 px-3 text-center"
                          aria-label="Interval opakování"
                        />
                        <span className="relative min-w-0">
                          <select
                            value={recurrenceUnit}
                            onChange={(event) => setRecurrenceUnit(event.target.value as ActivityRecurrenceUnit)}
                            className="activities-modal__input h-10 min-w-0 appearance-none rounded-[0.85rem] py-0 pr-9"
                            aria-label="Jednotka opakování"
                          >
                            <option value="day">dny</option>
                            <option value="week">týdny</option>
                            <option value="month">měsíce</option>
                          </select>
                          <ChevronDown aria-hidden size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400" />
                        </span>
                      </div>
                    ) : null}
                    <p className="mt-2 text-[10px] leading-4 text-zinc-500">Další termín se vytvoří až po dokončení této aktivity. Zmeškané termíny se nepřidávají zpětně.</p>
                  </div>
                ) : null}
                </fieldset>
              </div>
            ) : null}

            <div>
              <label htmlFor="activity-description" className="activities-modal__label">Doplňující poznámka <span className="font-normal text-zinc-400">(volitelné)</span></label>
              <textarea id="activity-description" name="description" maxLength={5000} rows={3} defaultValue={activity?.description ?? initialValues?.description ?? ''} className="activities-modal__input mt-2 min-h-24 resize-y py-3 sm:h-[91px] sm:min-h-[91px]" placeholder="Podrobnosti, domluvený další postup nebo výsledek…" />
            </div>

            {state.error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{state.error}</div> : null}
            </div>

            <footer className="standard-form-modal__footer activities-modal__footer flex shrink-0 flex-col-reverse gap-3 border-t border-zinc-200/75 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <SubmitButton planned={mode === 'planned'} editing={editing} />
            </footer>
          </form>
        </section>
      </div>
    </div>
  )
}

export function NewActivityButton({ clients, initialClientId = '', label = 'NOVÁ AKTIVITA', className, replaceClassName = false }: {
  clients: ActivityClientOption[]
  initialClientId?: string
  label?: string
  className?: string
  replaceClassName?: boolean
}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [mounted] = useState(() => typeof window !== 'undefined')
  const { toast, isVisible, showToast } = useAnimatedActionToast()

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function handleSaved() {
    setIsOpen(false)
    showToast({ title: 'AKTIVITA ULOŽENA', message: 'Záznam byl přidán do historie aktivit.', tone: 'success' })
    router.refresh()
  }

  const defaultClassName =
    'inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]'
  const resolvedClassName = replaceClassName && className
    ? className
    : [defaultClassName, className].filter(Boolean).join(' ')

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>{label}</button>
      {mounted && isOpen ? createPortal(<ActivityFormModal key={formKey} clients={clients} initialClientId={initialClientId} action={createManualActivityAction} onClose={() => setIsOpen(false)} onSaved={handleSaved} />, document.body) : null}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>
  )
}
