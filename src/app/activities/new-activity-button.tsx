'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  CalendarClock,
  ClipboardPenLine,
  Mail,
  MapPin,
  Phone,
  Plus,
  X,
} from 'lucide-react'
import { createManualActivityAction } from './actions'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityActionState, ActivityClientOption, ActivityListItem, ManualActivityType } from '@/lib/activities/types'

const INITIAL_STATE: ActivityActionState = { success: false, error: null }

const ACTIVITY_TYPES: Array<{
  value: ManualActivityType
  label: string
  icon: typeof Phone
}> = [
  { value: 'phone_call', label: 'Telefonát', icon: Phone },
  { value: 'email', label: 'E-mail', icon: Mail },
  { value: 'in_person_meeting', label: 'Osobní kontakt', icon: MapPin },
  { value: 'work_log', label: 'Pracovní zápis', icon: ClipboardPenLine },
  { value: 'other', label: 'Ostatní', icon: Plus },
]

function toLocalDateTimeInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
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
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#2473aa] bg-[linear-gradient(155deg,#4d96cb_0%,#2f7fb8_55%,#236a9e_100%)] px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(35,106,158,0.25)] transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? 'UKLÁDÁM…' : editing ? 'ULOŽIT ZMĚNY' : planned ? 'NAPLÁNOVAT AKTIVITU' : 'ULOŽIT AKTIVITU'}
    </button>
  )
}

export function ActivityFormModal({ clients, activity = null, initialClientId = '', action, onClose, onSaved }: {
  clients: ActivityClientOption[]
  activity?: ActivityListItem | null
  initialClientId?: string
  action: ActivityFormAction
  onClose: () => void
  onSaved: () => void
}) {
  const [state, formAction] = useActionState(action, INITIAL_STATE)
  const editing = Boolean(activity)
  const [mode, setMode] = useState<'logged' | 'planned'>(() => activity?.status === 'planned' ? 'planned' : 'logged')
  const [activityType, setActivityType] = useState<ManualActivityType>(() => {
    const value = activity?.activity_type as ManualActivityType | undefined
    return value && ACTIVITY_TYPES.some((type) => type.value === value) ? value : 'phone_call'
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

  useEffect(() => {
    if (state.success) onSaved()
  }, [onSaved, state.success])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="activities-modal fixed inset-0 z-[120] overflow-y-auto overscroll-contain bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-form-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section className="activities-modal__shell relative w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.97)_0%,rgba(249,250,251,0.95)_48%,rgba(244,244,245,0.93)_100%)] shadow-[0_32px_82px_rgba(24,24,27,0.34)]">
          <header className="activities-modal__header flex items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6">
            <ModalHeading id="activity-form-title" section="AKTIVITY" title={editing ? 'Upravit aktivitu' : 'Nová aktivita'} />
            <button type="button" onClick={onClose} aria-label="Zavřít" className="activities-modal__close inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm transition hover:-translate-y-px hover:text-zinc-900"><X aria-hidden size={18} /></button>
          </header>

          <form action={formAction} className="activities-modal__body space-y-5 px-5 py-5 sm:px-6 sm:py-6">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="activity_type" value={activityType} />
            <input type="hidden" name="occurred_at" value={toLocalDateTimeInput(now)} />

            <fieldset>
              <div className="activities-modal__mode-switch grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200/80 bg-zinc-100/75 p-1.5">
                <button type="button" onClick={() => setMode('logged')} className={`activities-modal__mode ${mode === 'logged' ? 'activities-modal__mode--active' : ''}`}><ClipboardPenLine aria-hidden size={17} /> Zapsat hotovou činnost</button>
                <button type="button" onClick={() => setMode('planned')} className={`activities-modal__mode ${mode === 'planned' ? 'activities-modal__mode--active' : ''}`}><CalendarClock aria-hidden size={17} /> Naplánovat další krok</button>
              </div>
            </fieldset>

            <fieldset>
              <legend className="activities-modal__label">Typ aktivity</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {ACTIVITY_TYPES.map((type) => {
                  const Icon = type.icon
                  const selected = activityType === type.value
                  return <button key={type.value} type="button" onClick={() => setActivityType(type.value)} aria-pressed={selected} className={`activities-modal__type ${selected ? 'activities-modal__type--active' : ''}`}><Icon aria-hidden size={17} /><span>{type.label}</span></button>
                })}
              </div>
            </fieldset>

            <div>
              <label htmlFor="activity-title" className="activities-modal__label">{mode === 'planned' ? 'Co chcete udělat?' : 'Co jste udělal/a?'}</label>
              <input id="activity-title" name="title" required maxLength={240} autoFocus defaultValue={activity?.title ?? ''} className="activities-modal__input mt-2" placeholder={mode === 'planned' ? 'Např. Zavolat klientovi ohledně nabídky' : 'Např. Volala jsem třem potenciálním klientům'} />
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
              {mode === 'planned' ? <div key="planned-date"><label htmlFor="activity-scheduled-for" className="activities-modal__label">Termín</label><input id="activity-scheduled-for" name="scheduled_for" type="datetime-local" required defaultValue={toLocalDateTimeInput(plannedDefault)} className="activities-modal__input mt-2" /></div> : <div key="logged-date"><label htmlFor="activity-occurred-visible" className="activities-modal__label">Datum a čas zápisu</label><input id="activity-occurred-visible" type="datetime-local" disabled value={toLocalDateTimeInput(now)} className="activities-modal__input mt-2 opacity-75" /></div>}
            </div>

            <div>
              <label htmlFor="activity-description" className="activities-modal__label">Doplňující poznámka <span className="font-normal text-zinc-400">(volitelné)</span></label>
              <textarea id="activity-description" name="description" maxLength={5000} rows={3} defaultValue={activity?.description ?? ''} className="activities-modal__input mt-2 min-h-24 resize-y py-3" placeholder="Podrobnosti, domluvený další postup nebo výsledek…" />
            </div>

            {state.error ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{state.error}</div> : null}

            <footer className="flex flex-col-reverse gap-3 border-t border-zinc-200/75 pt-5 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50">ZRUŠIT</button>
              <SubmitButton planned={mode === 'planned'} editing={editing} />
            </footer>
          </form>
        </section>
      </div>
    </div>
  )
}

export function NewActivityButton({ clients, initialClientId = '', label = 'NOVÁ AKTIVITA', className }: {
  clients: ActivityClientOption[]
  initialClientId?: string
  label?: string
  className?: string
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

  const resolvedClassName = [
    'inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>{label}</button>
      {mounted && isOpen ? createPortal(<ActivityFormModal key={formKey} clients={clients} initialClientId={initialClientId} action={createManualActivityAction} onClose={() => setIsOpen(false)} onSaved={handleSaved} />, document.body) : null}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>
  )
}
