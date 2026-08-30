'use client'

import { useRouter } from 'next/navigation'
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import {
  deleteJobAction,
  getJobFormSuggestionsAction,
  updateJobAction,
  type JobFormSuggestions,
  type UpdateJobActionState,
} from './actions'
import { JobFormToggleCard } from '@/components/jobs/job-pp-required-toggle'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  useModalActionSuccess,
  useModalMotionClose,
} from '@/components/ui/modal-motion'
import { TechnicianNamesInput } from './technician-names-input'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'
type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type InvoiceStatus =
  | 'bez_faktury'
  | 'k_fakturaci'
  | 'vyfakturovano'

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type OfferOption = {
  id: string
  client_id: string
  offer_number: string
  title: string
  order_reference?: string | null
  realization_starts_at: string | null
  realization_ends_at: string | null
  realization_address: string | null
}

export type JobFormValues = {
  id: string
  job_number: string
  company_name: string
  client_id?: string | null
  offer_id?: string | null
  client_contact_id?: string | null
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  client_order_number?: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  marny_vyjezd?: boolean | null
  pohotovost?: boolean | null
  pp_required?: boolean
  job_status: JobStatus
  invoice_status: InvoiceStatus
}

type EditJobButtonProps = {
  job: JobFormValues
  clientSuggestions?: ClientOption[]
  clientContacts?: ClientContactOption[]
  offerSuggestions?: OfferOption[]
  jobOfferSuggestions?: OfferOption[]
  technicianSuggestions?: string[]
  className?: string
  children?: React.ReactNode
  isAdmin?: boolean
  onOpen?: () => void
}

const initialUpdateState: UpdateJobActionState = {
  success: false,
  error: null,
}

export function EditJobButton({
  job,
  clientSuggestions = [],
  clientContacts = [],
  offerSuggestions = [],
  jobOfferSuggestions = [],
  technicianSuggestions = [],
  className,
  children,
  isAdmin = true,
  onOpen,
}: EditJobButtonProps) {
  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-lg px-1 py-1 text-[12px] font-semibold text-gray-900 transition hover:bg-black/[0.025]'

  if (!isAdmin) {
    return <span className={resolvedClassName}>{children ?? job.job_number}</span>
  }

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={resolvedClassName}>
        {children ?? job.job_number}
      </button>
    )
  }

  return (
    <UncontrolledEditJobButton
      job={job}
      clientSuggestions={clientSuggestions}
      clientContacts={clientContacts}
      offerSuggestions={offerSuggestions}
      jobOfferSuggestions={jobOfferSuggestions}
      technicianSuggestions={technicianSuggestions}
      className={resolvedClassName}
    >
      {children}
    </UncontrolledEditJobButton>
  )
}

function UncontrolledEditJobButton({
  job,
  clientSuggestions = [],
  clientContacts = [],
  offerSuggestions = [],
  jobOfferSuggestions = [],
  technicianSuggestions = [],
  className,
  children,
}: Omit<EditJobButtonProps, 'isAdmin' | 'onOpen'>) {
  const [isOpen, setIsOpen] = useState(false)

  function openModal() {
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {children ?? job.job_number}
      </button>

      {isOpen ? (
        <EditJobModal
          job={job}
          clientSuggestions={clientSuggestions}
          clientContacts={clientContacts}
          offerSuggestions={offerSuggestions}
          jobOfferSuggestions={jobOfferSuggestions}
          technicianSuggestions={technicianSuggestions}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

export function EditJobModalController({
  job,
  clientSuggestions = [],
  clientContacts = [],
  offerSuggestions = [],
  jobOfferSuggestions = [],
  technicianSuggestions = [],
  onClose,
}: Omit<EditJobButtonProps, 'className' | 'children' | 'isAdmin' | 'onOpen'> & {
  onClose: () => void
}) {
  return (
    <EditJobModal
      job={job}
      clientSuggestions={clientSuggestions}
      clientContacts={clientContacts}
      offerSuggestions={offerSuggestions}
      jobOfferSuggestions={jobOfferSuggestions}
      technicianSuggestions={technicianSuggestions}
      onClose={onClose}
    />
  )
}

function EditJobModal({
  job,
  clientSuggestions,
  clientContacts,
  offerSuggestions,
  jobOfferSuggestions,
  technicianSuggestions,
  onClose: closeImmediately,
}: {
  job: JobFormValues
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  offerSuggestions: OfferOption[]
  jobOfferSuggestions: OfferOption[]
  technicianSuggestions: string[]
  onClose: () => void
}) {
  const onClose = useModalMotionClose(closeImmediately)
  const router = useRouter()
  const [formSuggestions, setFormSuggestions] =
    useState<JobFormSuggestions | null>(null)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [state, formAction] = useActionState(
    updateJobAction.bind(null, job.id),
    initialUpdateState
  )
  const [isDeleting, startDeleteTransition] = useTransition()

  useEffect(() => {
    let isCurrent = true

    void getJobFormSuggestionsAction(job.offer_id).then((result) => {
      if (!isCurrent) return

      if (!result.success) {
        setSuggestionsError(result.error)
        return
      }

      setFormSuggestions(result.data)
    })

    return () => {
      isCurrent = false
    }
  }, [job.offer_id])

  useModalActionSuccess(state.success, () => {
    router.refresh()
    onClose()
  })

  function handleDeleteClick() {
    const isConfirmed = window.confirm(
      `Opravdu chceš smazat zakázku ${job.job_number}? Tato akce nejde vrátit zpět.`
    )

    if (!isConfirmed) return

    startDeleteTransition(async () => {
      const result = await deleteJobAction(job.id)

      if (!result.success) {
        alert(result.error ?? 'Zakázku se nepodařilo smazat.')
        return
      }

      router.refresh()
      onClose()
    })
  }

  if (suggestionsError) {
    return <JobFormLoadError message={suggestionsError} onClose={onClose} />
  }

  if (!formSuggestions) {
    return <JobFormLoadingModal onClose={onClose} />
  }

  return (
    <JobFormShell
      mode="edit"
      clientSuggestions={formSuggestions.clientSuggestions}
      clientContacts={formSuggestions.clientContacts}
      offerSuggestions={formSuggestions.offerSuggestions}
      jobOfferSuggestions={formSuggestions.offerSuggestions}
      technicianSuggestions={formSuggestions.technicianSuggestions}
      onClose={onClose}
      error={state.error}
      formAction={formAction}
      job={job}
      onDelete={handleDeleteClick}
      isDeleting={isDeleting}
    />
  )
}

function JobFormLoadingModal({ onClose }: { onClose: () => void }) {
  return createPortal(
    <div data-modal-motion-root className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm [html[data-theme='dark']_&]:bg-[#020617]/72">
      <section
        data-modal-motion-surface
        role="dialog"
        aria-modal="true"
        aria-label="Načítání formuláře zakázky"
        className="w-full max-w-sm rounded-3xl border border-white/90 bg-[linear-gradient(155deg,#ffffff_0%,#f1f6fb_100%)] p-6 text-center shadow-[0_24px_56px_rgba(15,23,42,0.28)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.2)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(19,31,51,0.99)_0%,rgba(8,17,32,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[0_24px_56px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.05)]"
      >
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#2f78b1] [html[data-theme='dark']_&]:text-[#8fceff]">
          Zakázky
        </p>
        <p className="mt-3 text-base font-semibold text-gray-900 [html[data-theme='dark']_&]:text-slate-100">
          Načítám formulář…
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.2)] [html[data-theme='dark']_&]:bg-[rgba(30,41,59,0.88)] [html[data-theme='dark']_&]:text-slate-200"
        >
          Zrušit
        </button>
      </section>
    </div>,
    document.body
  )
}

function JobFormLoadError({
  message,
  onClose,
}: {
  message: string
  onClose: () => void
}) {
  return createPortal(
    <div data-modal-motion-root className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <section
        data-modal-motion-surface
        role="dialog"
        aria-modal="true"
        aria-label="Nepodařilo se načíst formulář zakázky"
        className="w-full max-w-sm rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(241,246,251,0.94)_100%)] p-6 text-center shadow-[0_24px_56px_rgba(15,23,42,0.28)]"
      >
        <p className="text-base font-semibold text-gray-900">Formulář se nepodařilo načíst.</p>
        <p className="mt-2 text-sm text-gray-600">{message}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-5 inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700"
        >
          Zavřít
        </button>
      </section>
    </div>,
    document.body
  )
}

function JobFormShell({
  mode,
  clientSuggestions,
  clientContacts,
  offerSuggestions,
  jobOfferSuggestions,
  technicianSuggestions,
  onClose,
  error,
  formAction,
  job,
  onDelete,
  isDeleting,
}: {
  mode: 'edit'
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  offerSuggestions: OfferOption[]
  jobOfferSuggestions: OfferOption[]
  technicianSuggestions: string[]
  onClose: () => void
  error: string | null
  formAction: (payload: FormData) => void
  job: JobFormValues
  onDelete: () => void
  isDeleting: boolean
}) {
  const companyOptions = useMemo(() => {
    const map = new Map<string, ClientOption>()

    clientSuggestions.forEach((client) => {
      const id = client.id.trim()
      const name = client.name.trim()

      if (!id || !name) return

      map.set(id, {
        id,
        name,
      })
    })

    if (
      job.client_id &&
      job.company_name?.trim() &&
      !map.has(job.client_id)
    ) {
      map.set(job.client_id, {
        id: job.client_id,
        name: job.company_name.trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job.client_id, job.company_name])

  const combinedOfferOptions = useMemo(() => {
    const map = new Map<string, OfferOption>()

    const addOffer = (offer: OfferOption) => {
      const id = offer.id.trim()
      const clientId = offer.client_id.trim()
      const offerNumber = offer.offer_number.trim()
      const title = offer.title.trim()

      if (!id || !clientId || !offerNumber || !title) return

      map.set(id, {
        id,
        client_id: clientId,
        offer_number: offerNumber,
        title,
        order_reference: offer.order_reference ?? null,
        realization_starts_at: offer.realization_starts_at ?? null,
        realization_ends_at: offer.realization_ends_at ?? null,
        realization_address: offer.realization_address ?? null,
      })
    }

    offerSuggestions.forEach(addOffer)
    jobOfferSuggestions.forEach(addOffer)

    return Array.from(map.values()).sort((a, b) =>
      a.offer_number.localeCompare(b.offer_number, 'cs', { sensitivity: 'base' })
    )
  }, [jobOfferSuggestions, offerSuggestions])

  const companyInputRef = useRef<HTMLInputElement>(null)

  const canonicalCompanyName =
    companyOptions.find((client) => client.id === job.client_id)?.name ??
    job.company_name ??
    ''

  const [companyName, setCompanyName] = useState(canonicalCompanyName)
  const [selectedClientId, setSelectedClientId] = useState(job.client_id ?? '')
  const [selectedOfferId, setSelectedOfferId] = useState(job.offer_id ?? '')
  const [selectedContactId, setSelectedContactId] = useState(job.client_contact_id ?? '')
  const [contactPerson, setContactPerson] = useState(job.contact_person ?? '')
  const [startAt, setStartAt] = useState(toDateTimeLocalValue(job.start_at))
  const [endAt, setEndAt] = useState(toDateTimeLocalValue(job.end_at))
  const [siteAddress, setSiteAddress] = useState(job.site_address ?? '')
  const [clientOrderNumber, setClientOrderNumber] = useState(job.client_order_number ?? '')
  const [technicianName, setTechnicianName] = useState(job.technician_name ?? '')
  const [ppRequired, setPpRequired] = useState(job.pp_required ?? true)
  const [marnyVyjezd, setMarnyVyjezd] = useState(Boolean(job.marny_vyjezd))
  const [pohotovost, setPohotovost] = useState(Boolean(job.pohotovost))
  const [companyTouched, setCompanyTouched] = useState(false)
  const [companyHasFocus, setCompanyHasFocus] = useState(false)

  const selectedClient = useMemo(() => {
    return companyOptions.find((client) => client.id === selectedClientId) ?? null
  }, [companyOptions, selectedClientId])
  const selectedClientContacts = clientContacts.filter(
    (contact) => contact.client_id === selectedClientId
  )
  const selectedClientOffers = combinedOfferOptions.filter(
    (offer) => offer.client_id === selectedClientId
  )

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  const showCompanyError = companyTouched && !companySelectionIsValid

  const title = (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span>Upravit zakázku</span>
      <span className="jobs-page__job-form-modal__job-number inline-flex shrink-0 items-center rounded-full border px-2 py-1 text-[11px] font-semibold tracking-[0.04em]">
        {job.job_number}
      </span>
    </span>
  )
  const submitLabel = 'ULOŽIT ZMĚNY'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function setAutocompleteSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      companyInputRef.current?.focus()
      companyInputRef.current?.setSelectionRange(start, end)
    })
  }

  function handleCompanyChange(nextRawValue: string) {
    setCompanyTouched(true)

    const trimmedValue = nextRawValue.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      setSelectedContactId('')
      setSelectedOfferId('')
      setContactPerson('')
      return
    }

    const exactMatch =
      companyOptions.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      const nextClientId = exactMatch.id
      setCompanyName(exactMatch.name)
      setSelectedClientId(nextClientId)
      setSelectedContactId('')
      if (nextClientId !== selectedClientId) {
        setSelectedOfferId('')
      }
      setContactPerson('')
      return
    }

    const prefixMatches = companyOptions.filter((client) =>
      normalizeSearchText(client.name).startsWith(normalizedValue)
    )

    if (prefixMatches.length === 1) {
      const matchedClient = prefixMatches[0]
      const completedName = matchedClient.name

      setCompanyName(completedName)
      setSelectedClientId(matchedClient.id)
      setSelectedContactId('')
      if (matchedClient.id !== selectedClientId) {
        setSelectedOfferId('')
      }
      setContactPerson('')

      setAutocompleteSelection(nextRawValue.length, completedName.length)
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
    setSelectedContactId('')
    setSelectedOfferId('')
    setContactPerson('')
  }

  function handleCompanyFocus() {
    setCompanyHasFocus(true)
  }

  function handleCompanyBlur() {
    setCompanyHasFocus(false)
    setCompanyTouched(true)

    const trimmedValue = companyName.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      setSelectedContactId('')
      setSelectedOfferId('')
      setContactPerson('')
      return
    }

    const exactMatch =
      companyOptions.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      if (exactMatch.id !== selectedClientId) {
        setSelectedOfferId('')
      }
      setSelectedClientId(exactMatch.id)
      return
    }

    setSelectedClientId('')
    setSelectedContactId('')
    setContactPerson('')
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactId(nextContactId)

    const nextContact =
      selectedClientContacts.find((contact) => contact.id === nextContactId) ?? null

    setContactPerson(nextContact?.name ?? '')
  }

  function handleOfferChange(nextOfferId: string) {
    setSelectedOfferId(nextOfferId)

    const nextOffer =
      selectedClientOffers.find((offer) => offer.id === nextOfferId) ?? null

    if (!nextOffer) {
      return
    }

    setStartAt(toStoredOfferDateTimeLocalValue(nextOffer.realization_starts_at))
    setEndAt(toStoredOfferDateTimeLocalValue(nextOffer.realization_ends_at))
    setSiteAddress(nextOffer.realization_address ?? '')
    setClientOrderNumber(nextOffer.order_reference ?? '')
  }

  const companyStatusText = (() => {
    const trimmedValue = companyName.trim()

    if (!trimmedValue) {
      return ''
    }

    if (companySelectionIsValid) {
      return 'Klient nalezen v seznamu.'
    }

    return 'Firma neexistuje v seznamu klientů.'
  })()

  const companyStatusClassName =
    companySelectionIsValid
      ? 'text-emerald-700'
      : companyName.trim()
        ? 'text-red-600'
        : 'text-gray-500'

  function truncateOfferTitle(title: string) {
    if (title.length <= 20) return title
    return `${title.slice(0, 20)}...`
  }

  const modalContent = (
    <div
      data-modal-motion-root
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-3 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          data-modal-motion-surface
          className="jobs-page__modal-shell jobs-page__job-form-modal relative flex w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div className="jobs-page__modal-header jobs-page__job-form-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <ModalHeading section="ZAKÁZKY" title={title} />

            <button
              type="button"
              onClick={onClose}
              className="jobs-page__job-form-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="job_status" value={job.job_status} />
            <input
              type="hidden"
              name="invoice_status"
              value={job.invoice_status}
            />
            <input type="hidden" name="client_id" value={selectedClientId} />
            <input type="hidden" name="client_contact_id" value={selectedContactId} />
            <input type="hidden" name="offer_id" value={selectedOfferId} />
            <input type="hidden" name="pp_required" value={ppRequired ? '1' : '0'} />
            <input
              type="hidden"
              name="company_name"
              value={companySelectionIsValid ? companyName.trim() : ''}
            />

            <div className="jobs-page__job-form-modal__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-4">
              <div className="grid gap-3 xl:grid-cols-[1.08fr_0.87fr_1.05fr]">
                <section className="jobs-page__job-form-modal__section overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.90)_0%,rgba(241,245,250,0.82)_100%)] p-3 sm:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] sm:overflow-visible">
                  <div className="mb-3">
                    <h3 className="jobs-page__job-form-modal__section-title text-sm font-semibold text-gray-900">
                      Základ zakázky
                    </h3>
                  </div>

                  <div className="grid gap-3 xl:grid-cols-2">
                    <div className="xl:col-span-2">
                      <label
                        htmlFor={`${mode}-client-search`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Firma *
                      </label>

                      <input
                        ref={companyInputRef}
                        id={`${mode}-client-search`}
                        type="text"
                        value={companyName}
                        autoComplete="off"
                        placeholder="Začni psát název firmy"
                        onChange={(event) => handleCompanyChange(event.target.value)}
                        onFocus={handleCompanyFocus}
                        onBlur={handleCompanyBlur}
                        className={`jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:ring-2 ${
                          showCompanyError
                            ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                            : companySelectionIsValid && !companyHasFocus
                              ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                              : 'focus:border-[#c2cfdd] focus:ring-[#dbe5ef]'
                        }`}
                      />

                      <p className={`mt-2 text-sm ${companyStatusClassName}`}>
                        {companyStatusText}
                      </p>

                      {showCompanyError ? (
                        <p className="mt-2 text-sm text-red-600">
                          Pro uložení změn musíš zadat existující firmu ze seznamu klientů.
                        </p>
                      ) : null}
                    </div>

                    <div className="xl:col-span-2">
                      <label
                        htmlFor={`${mode}-contact_person`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Osoba
                      </label>
                      {selectedClientContacts.length > 0 ? (
                        <>
                          <select
                            id={`${mode}-client_contact_id`}
                            value={selectedContactId}
                            onChange={(event) => handleContactChange(event.target.value)}
                            className="jobs-page__job-form-modal__field h-10 w-full appearance-none rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                          >
                            <option value="">Bez konkrétní osoby</option>
                            {selectedClientContacts.map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {contact.name}
                                {contact.is_primary ? ' (hlavní)' : ''}
                              </option>
                            ))}
                          </select>
                          <input type="hidden" name="contact_person" value={contactPerson} />
                        </>
                      ) : (
                        <input
                          id={`${mode}-contact_person`}
                          name="contact_person"
                          type="text"
                          value={contactPerson}
                          onChange={(event) => setContactPerson(event.target.value)}
                          placeholder="Kontaktní osoba"
                          className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                        />
                      )}
                    </div>

                    <div className="xl:col-span-2">
                      <label
                        htmlFor={`${mode}-offer_id`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Číslo nabídky <span className="text-[10px] font-normal text-gray-500">(volitelné)</span>
                      </label>
                      <select
                        id={`${mode}-offer_id`}
                        value={selectedOfferId}
                        onChange={(event) => handleOfferChange(event.target.value)}
                        disabled={!selectedClientId}
                        className="jobs-page__job-form-modal__field h-10 w-full appearance-none rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Bez nabídky</option>
                        {selectedClientOffers.map((offer) => (
                          <option key={offer.id} value={offer.id}>
                            {`${offer.offer_number} - ${truncateOfferTitle(offer.title)}`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-client_order_number`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Objednávka
                      </label>
                      <input
                        id={`${mode}-client_order_number`}
                        name="client_order_number"
                        type="text"
                        value={clientOrderNumber}
                        onChange={(event) => setClientOrderNumber(event.target.value)}
                        placeholder="Číslo objednávky klienta"
                        className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-sales_owner`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Obchodník
                      </label>
                      <select
                        id={`${mode}-sales_owner`}
                        name="sales_owner"
                        defaultValue={job.sales_owner ?? 'JIŘÍ'}
                        className="jobs-page__job-form-modal__field h-10 w-full appearance-none rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      >
                        <option value="JIŘÍ">JIŘÍ</option>
                        <option value="MICHAL">MICHAL</option>
                        <option value="LÍDA">LÍDA</option>
                      </select>
                    </div>
                  </div>
                </section>

                <section className="jobs-page__job-form-modal__section overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.90)_0%,rgba(241,245,250,0.82)_100%)] p-3 sm:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] sm:overflow-visible">
                  <div className="mb-3">
                    <h3 className="jobs-page__job-form-modal__section-title text-sm font-semibold text-gray-900">
                      Termín a místo
                    </h3>
                  </div>

                  <div className="grid gap-3">
                    <div className="min-w-0">
                      <label
                        htmlFor={`${mode}-start_at`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Začátek *
                      </label>
                      <input
                        id={`${mode}-start_at`}
                        name="start_at"
                        type="datetime-local"
                        required
                        value={startAt}
                        onChange={(event) => setStartAt(event.target.value)}
                        className="jobs-page__job-form-modal__field h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div className="min-w-0">
                      <label
                        htmlFor={`${mode}-end_at`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Konec *
                      </label>
                      <input
                        id={`${mode}-end_at`}
                        name="end_at"
                        type="datetime-local"
                        required
                        value={endAt}
                        onChange={(event) => setEndAt(event.target.value)}
                        className="jobs-page__job-form-modal__field h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-site_address`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Adresa realizace
                      </label>
                      <input
                        id={`${mode}-site_address`}
                        name="site_address"
                        type="text"
                        value={siteAddress}
                        onChange={(event) => setSiteAddress(event.target.value)}
                        placeholder="Adresa realizace"
                        className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-store_number`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Číslo prodejny
                      </label>
                      <input
                        id={`${mode}-store_number`}
                        name="store_number"
                        type="text"
                        defaultValue={job.store_number ?? ''}
                        placeholder="Např. 154"
                        className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                  </div>
                </section>

                <section className="jobs-page__job-form-modal__section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.90)_0%,rgba(241,245,250,0.82)_100%)] p-3 sm:p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="jobs-page__job-form-modal__section-title text-sm font-semibold text-gray-900">
                      Realizace
                    </h3>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <label
                        htmlFor={`${mode}-technician_name`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Technik
                      </label>
                      <TechnicianNamesInput
                        id={`${mode}-technician_name`}
                        name="technician_name"
                        value={technicianName}
                        onValueChange={setTechnicianName}
                        technicians={technicianSuggestions}
                        placeholder="Zadej jedno nebo více jmen techniků"
                        className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-generator_name`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Agregát
                      </label>
                      <input
                        id={`${mode}-generator_name`}
                        name="generator_name"
                        type="text"
                        defaultValue={job.generator_name ?? ''}
                        placeholder="Např. Aggreko 250 kVA"
                        className="jobs-page__job-form-modal__field h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`${mode}-info_note`}
                        className="jobs-page__job-form-modal__label mb-1 block text-sm font-medium text-gray-700"
                      >
                        Info k zakázce
                      </label>
                      <textarea
                        id={`${mode}-info_note`}
                        name="info_note"
                        rows={4}
                        defaultValue={job.info_note ?? ''}
                        placeholder="Libovolná interní poznámka k zakázce"
                        className="jobs-page__job-form-modal__field w-full resize-none rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 py-2.5 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <JobFormToggleCard
                        label="POVINNÝ PP"
                        checked={ppRequired}
                        onChange={setPpRequired}
                      />
                      <JobFormToggleCard
                        label="MARNÝ VÝJEZD"
                        name="marny_vyjezd"
                        checked={marnyVyjezd}
                        tone="danger"
                        onChange={(checked) => {
                          setMarnyVyjezd(checked)
                          if (checked) setPohotovost(false)
                        }}
                      />
                      <JobFormToggleCard
                        label="POHOTOVOST"
                        name="pohotovost"
                        checked={pohotovost}
                        tone="standby"
                        onChange={(checked) => {
                          setPohotovost(checked)
                          if (checked) setMarnyVyjezd(false)
                        }}
                      />
                    </div>
                  </div>
                </section>
              </div>

              {error ? (
                <div className="jobs-page__job-form-modal__error mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="jobs-page__job-form-modal__footer flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 px-3 py-3 sm:px-5">
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="standard-form-modal__danger-action inline-flex min-w-0 shrink-0 items-center justify-center whitespace-nowrap !px-3 sm:min-w-[170px] sm:!px-5"
                >
                  {isDeleting ? (
                    <>
                      <span className="sm:hidden">MAŽU…</span>
                      <span className="hidden sm:inline">MAŽU ZAKÁZKU…</span>
                    </>
                  ) : (
                    <>
                      <span className="sm:hidden">SMAZAT</span>
                      <span className="hidden sm:inline">SMAZAT ZAKÁZKU</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDeleting}
                  className="standard-form-modal__cancel-action inline-flex shrink-0 items-center justify-center !px-3 sm:!px-5"
                >
                  ZRUŠIT
                </button>

                <SubmitButton
                  label={submitLabel}
                  disabled={isDeleting || !companySelectionIsValid}
                  className="shrink-0 !px-3 sm:!px-5"
                />
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function SubmitButton({
  label,
  disabled = false,
  className = '',
}: {
  label: string
  disabled?: boolean
  className?: string
}) {
  const { pending } = useFormStatus()
  const isDisabled = pending || disabled

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={`standard-form-modal__primary-action inline-flex items-center justify-center ${className}`}
    >
      {pending ? 'UKLÁDÁM…' : label}
    </button>
  )
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}

function toStoredOfferDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const normalized = String(value).trim()
  const match = normalized.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/)

  if (match) {
    return `${match[1]}T${match[2]}`
  }

  return toDateTimeLocalValue(value)
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('cs')
}
