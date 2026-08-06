'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ExternalLink,
  FileImage,
  FileText,
  HardHat,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Paperclip,
  ReceiptText,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  openJobAttachmentAction,
  openOfferOrderAttachmentAction,
} from './actions'
import {
  getJob360Action,
  type Job360Data,
} from './job-360-actions'

type Job360ModalProps = {
  financeId: string
  jobNumber: string
  onClose: () => void
}

const PANEL_CLASS =
  'rounded-[24px] border border-white/80 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_30px_rgba(15,23,42,0.07)] [html[data-theme="dark"]_&]:border-white/[0.08] [html[data-theme="dark"]_&]:bg-white/[0.035] [html[data-theme="dark"]_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_14px_36px_rgba(0,0,0,0.18)]'
const SUBTLE_TEXT_CLASS =
  'text-slate-500 [html[data-theme="dark"]_&]:text-slate-400'
const VALUE_TEXT_CLASS =
  'text-slate-900 [html[data-theme="dark"]_&]:text-slate-100'
const LINK_BUTTON_CLASS =
  'inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-[#83add0]/55 bg-[#eaf3fa]/80 px-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#286b9f] transition hover:-translate-y-px hover:border-[#5f96c2] hover:bg-[#dcecf8] focus:outline-none focus:ring-2 focus:ring-[#4f92cb]/45 [html[data-theme="dark"]_&]:border-[#4f92cb]/35 [html[data-theme="dark"]_&]:bg-[#4f92cb]/10 [html[data-theme="dark"]_&]:text-[#8fc3ea] [html[data-theme="dark"]_&]:hover:bg-[#4f92cb]/18'

const JOB_STATUS_LABELS: Record<string, string> = {
  nova: 'Nová',
  k_reseni: 'K řešení',
  realizace: 'Realizace',
  ukoncena: 'Ukončená',
  storno: 'Storno',
}

const INVOICE_STATUS_LABELS: Record<string, string> = {
  bez_faktury: 'Bez faktury',
  k_fakturaci: 'K fakturaci',
  vyfakturovano: 'Vyfakturováno',
}

const EVIDENCE_STATUS_LABELS: Record<string, string> = {
  neevidovano: 'Neevidováno',
  k_evidenci: 'K evidenci',
  evidovano: 'Evidováno',
}

const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Koncept',
  submitted: 'Ke schválení',
  changes_requested: 'Vráceno k úpravě',
  approved: 'Schválená',
  sent_to_client: 'Odeslaná klientovi',
  in_progress: 'Rozpracovaná',
  ordered: 'Objednaná',
  rejected: 'Zamítnutá',
  realizace: 'Realizace',
}

const ATTACHMENT_CATEGORY_LABELS: Record<string, string> = {
  predavaci_protokol: 'Nahrané předávací protokoly',
  foto: 'Fotografie realizace',
  jine: 'Ostatní dokumenty',
}

export function Job360Modal({
  financeId,
  jobNumber,
  onClose,
}: Job360ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [data, setData] = useState<Job360Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    let active = true

    startTransition(async () => {
      const result = await getJob360Action(financeId)
      if (!active) return

      if (!result.success) {
        setError(result.error)
        return
      }

      setData(result.data)
      setError(null)
    })

    return () => {
      active = false
    }
  }, [financeId])

  function openJobDocument(attachmentId: string) {
    setDocumentError(null)
    setOpeningDocumentId(attachmentId)

    startTransition(async () => {
      const result = await openJobAttachmentAction(attachmentId)
      setOpeningDocumentId(null)

      if (!result.success || !result.signedUrl) {
        setDocumentError(result.error ?? 'Dokument se nepodařilo otevřít.')
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  function openOfferDocument(attachmentId: string) {
    setDocumentError(null)
    setOpeningDocumentId(attachmentId)

    startTransition(async () => {
      const result = await openOfferOrderAttachmentAction(attachmentId)
      setOpeningDocumentId(null)

      if (!result.success || !result.signedUrl) {
        setDocumentError(
          result.error ?? 'Objednávkový podklad se nepodařilo otevřít.'
        )
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[150] bg-zinc-950/48 p-2 backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-360-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-[1440px] items-center justify-center">
        <div className="flex max-h-full w-full flex-col overflow-hidden rounded-[30px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.985)_0%,rgba(244,248,252,0.975)_48%,rgba(234,242,249,0.96)_100%)] shadow-[0_38px_90px_rgba(15,23,42,0.34)] [html[data-theme='dark']_&]:border-white/[0.1] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(13,22,37,0.995)_0%,rgba(8,16,29,0.995)_58%,rgba(5,12,23,0.995)_100%)] [html[data-theme='dark']_&]:shadow-[0_42px_100px_rgba(0,0,0,0.58)]">
          <header className="relative flex shrink-0 items-start justify-between gap-4 border-b border-slate-200/75 px-4 py-4 sm:px-6 [html[data-theme='dark']_&]:border-white/[0.08]">
            <ModalHeading
              section="FAKTURY"
              title={`Souhrn zakázky · ${data?.job.jobNumber ?? jobNumber}`}
              id="job-360-title"
              className="min-w-0"
            />

            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/80 bg-white/75 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-[#4f92cb]/45 [html[data-theme='dark']_&]:border-white/[0.1] [html[data-theme='dark']_&]:bg-white/[0.05] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:bg-white/[0.1] [html[data-theme='dark']_&]:hover:text-white"
              aria-label="Zavřít Zakázku 360"
              title="Zavřít"
            >
              <X className="h-5 w-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6">
            {isPending && !data ? <LoadingState /> : null}
            {error ? <ErrorState message={error} /> : null}
            {data ? (
              <div className="grid gap-5">
                <OverviewSection data={data} />
                <OfferSection
                  data={data}
                  openingDocumentId={openingDocumentId}
                  onOpenDocument={openOfferDocument}
                />
                <FinanceSection data={data} />
                <ProtocolSection data={data} />
                <DocumentsSection
                  data={data}
                  openingDocumentId={openingDocumentId}
                  onOpenDocument={openJobDocument}
                />
              </div>
            ) : null}
          </div>

          {documentError ? (
            <footer className="shrink-0 border-t border-slate-200/75 px-4 py-3 sm:px-6 [html[data-theme='dark']_&]:border-white/[0.08]">
              <p className="text-right text-xs font-medium text-red-600 [html[data-theme='dark']_&]:text-red-400">
                {documentError}
              </p>
            </footer>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  )
}

function LoadingState() {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[360px] items-center justify-center`}>
      <div className="text-center">
        <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-[#3c83ba]" />
        <p className={`mt-3 text-sm ${SUBTLE_TEXT_CLASS}`}>
          Načítám všechny podklady realizace…
        </p>
      </div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={`${PANEL_CLASS} flex min-h-[280px] items-center justify-center p-6`}>
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-500" />
        <h3 className={`mt-3 text-lg font-semibold ${VALUE_TEXT_CLASS}`}>
          Zakázku 360 se nepodařilo načíst
        </h3>
        <p className={`mt-2 text-sm ${SUBTLE_TEXT_CLASS}`}>{message}</p>
      </div>
    </div>
  )
}

function OverviewSection({ data }: { data: Job360Data }) {
  const { job, technicians } = data
  const technicianNames =
    technicians.length > 0
      ? technicians.map((technician) => technician.name).join(', ')
      : job.technicianName

  return (
    <Section
      icon={<BriefcaseBusiness className="h-5 w-5" />}
      title="Přehled realizace"
      subtitle="Uložený stav a základní údaje realizace"
    >
      <div className={`${PANEL_CLASS} p-4 sm:p-5`}>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${SUBTLE_TEXT_CLASS}`}>
                Zakázka
              </p>
              <p className={`mt-1 text-lg font-semibold ${VALUE_TEXT_CLASS}`}>
                {job.jobNumber} · {job.companyName}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <StatusBadge label={statusLabel(JOB_STATUS_LABELS, job.jobStatus)} />
              <StatusBadge
                label={statusLabel(INVOICE_STATUS_LABELS, job.invoiceStatus)}
                tone="blue"
              />
              <StatusBadge
                label={statusLabel(EVIDENCE_STATUS_LABELS, job.evidenceStatus)}
              />
              {job.wastedTrip ? <StatusBadge label="Marný výjezd" tone="amber" /> : null}
              {job.standby ? <StatusBadge label="Pohotovost" tone="blue" /> : null}
            </div>
          </div>

          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <InfoField
              icon={<UserRound />}
              label="Obchodník"
              value={job.salesOwner}
            />
            <InfoField
              icon={<CalendarDays />}
              label="Začátek"
              value={formatDateTime(job.startAt)}
            />
            <InfoField
              icon={<CalendarDays />}
              label="Konec"
              value={formatDateTime(job.endAt)}
            />
            <InfoField
              icon={<MapPin />}
              label="Místo realizace"
              value={job.siteAddress}
            />
            <InfoField
              icon={<Building2 />}
              label="Číslo prodejny"
              value={job.storeNumber}
            />
            <InfoField
              icon={<PackageCheck />}
              label="Agregát"
              value={job.generatorName}
            />
            <InfoField
              icon={<HardHat />}
              label="Technici"
              value={technicianNames}
            />
          </div>

          {job.infoNote ? (
            <div className="mt-5 rounded-2xl border border-[#91b8d6]/45 bg-[#edf5fb]/70 p-4 [html[data-theme='dark']_&]:border-[#4f92cb]/25 [html[data-theme='dark']_&]:bg-[#4f92cb]/[0.07]">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-[#347cad]" />
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#347cad]">
                  Info k zakázce
                </p>
                {job.infoAlertEnabled ? (
                  <StatusBadge label="Aktivní upozornění" tone="blue" />
                ) : null}
              </div>
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${VALUE_TEXT_CLASS}`}>
                {job.infoNote}
              </p>
            </div>
          ) : null}
      </div>
    </Section>
  )
}

function OfferSection({
  data,
  openingDocumentId,
  onOpenDocument,
}: {
  data: Job360Data
  openingDocumentId: string | null
  onOpenDocument: (id: string) => void
}) {
  const offer = data.offer

  return (
    <Section
      icon={<ReceiptText className="h-5 w-5" />}
      title="Obchodní podklady"
      subtitle="Základní údaje nabídky, komentáře a objednávkové soubory"
    >
      {!offer ? (
        <EmptyPanel text="K zakázce není přímo navázaná nabídka." />
      ) : (
        <div className="grid gap-4">
          <div className={`${PANEL_CLASS} p-4 sm:p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className={`text-base font-semibold ${VALUE_TEXT_CLASS}`}>
                    {offer.details.offer_number} · {offer.details.title}
                  </h4>
                  <StatusBadge
                    label={statusLabel(
                      OFFER_STATUS_LABELS,
                      offer.details.status
                    )}
                    tone="blue"
                  />
                </div>
                <p className={`mt-1 text-xs ${SUBTLE_TEXT_CLASS}`}>
                  Verze {offer.details.current_version} · Klasická nabídka
                </p>
              </div>
              <a
                href={`/offers/${offer.details.id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className={LINK_BUTTON_CLASS}
              >
                <FileText className="h-4 w-4" />
                Otevřít PDF nabídky
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField
                label="Projekt"
                value={offer.details.project_name}
              />
              <TextField
                label="Platnost do"
                value={formatDate(offer.details.valid_until)}
              />
              <TextField
                label="Objednávka klienta"
                value={offer.details.order_reference}
              />
              <TextField
                label="Připravil"
                value={offer.details.prepared_by_name}
              />
              <TextField
                label="Místo realizace"
                value={offer.details.realization_address}
              />
              <TextField
                label="Začátek realizace"
                value={formatDateTime(offer.details.realization_starts_at)}
              />
              <TextField
                label="Konec realizace"
                value={formatDateTime(offer.details.realization_ends_at)}
              />
              <TextField
                label="Kontaktní osoba"
                value={offer.details.contact_person}
              />
            </div>

          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <DataTablePanel title={`Komentáře nabídky (${offer.notes.length})`}>
              {offer.notes.length > 0 ? (
                <div className="max-h-[320px] divide-y divide-slate-200/60 overflow-y-auto [html[data-theme='dark']_&]:divide-white/[0.06]">
                  {offer.notes.map((note) => (
                    <div key={note.id} className="px-4 py-3">
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className={`text-xs font-semibold ${VALUE_TEXT_CLASS}`}>
                          {note.authorName ?? 'Neznámý autor'}
                        </span>
                        <span className={`text-[11px] ${SUBTLE_TEXT_CLASS}`}>
                          {formatDateTime(note.created_at)}
                        </span>
                      </div>
                      <p className={`mt-1 whitespace-pre-wrap text-sm leading-5 ${VALUE_TEXT_CLASS}`}>
                        {note.note}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock text="K nabídce nejsou uložené komentáře." />
              )}
            </DataTablePanel>

            <DataTablePanel
              title={`Objednávkové podklady (${offer.orderFiles.length})`}
            >
              {offer.orderFiles.length > 0 ? (
                <FileList
                  files={offer.orderFiles.map((file) => ({
                    id: file.id,
                    name: file.file_name,
                    detail: `${formatFileSize(file.file_size_bytes)} · ${formatDateTime(file.created_at)}`,
                  }))}
                  openingDocumentId={openingDocumentId}
                  onOpen={onOpenDocument}
                />
              ) : (
                <EmptyBlock text="K nabídce nejsou nahrané objednávkové podklady." />
              )}
            </DataTablePanel>
          </div>
        </div>
      )}
    </Section>
  )
}

function FinanceSection({ data }: { data: Job360Data }) {
  const { finance, costs, commission } = data

  return (
    <Section
      icon={<WalletCards className="h-5 w-5" />}
      title="Finance"
      subtitle="Fakturační údaje, nákladové položky, výsledek a provize"
    >
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard label="Objednávka" value={finance.clientOrderNumber} />
          <MetricCard label="Faktura" value={finance.invoiceNumber} tone="blue" />
          <MetricCard label="Prodej" value={formatMoney(finance.saleAmount)} />
          <MetricCard label="Náklad" value={formatMoney(finance.costAmount)} />
          <MetricCard
            label="Zisk"
            value={formatMoney(finance.profitAmount)}
            tone={
              finance.profitAmount !== null && finance.profitAmount < 0
                ? 'red'
                : 'green'
            }
          />
          <MetricCard
            label="Marže"
            value={
              finance.marginPercent === null
                ? null
                : `${formatNumber(finance.marginPercent)} %`
            }
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.45fr_0.55fr]">
          <DataTablePanel title={`Nákladové položky (${costs.length})`}>
            {costs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead className={SUBTLE_TEXT_CLASS}>
                    <tr className="border-b border-slate-200/70 [html[data-theme='dark']_&]:border-white/[0.07]">
                      <th className="px-3 py-2 font-semibold">Položka</th>
                      <th className="px-3 py-2 font-semibold">Dodavatel / technik</th>
                      <th className="px-3 py-2 text-right font-semibold">Jednotková cena</th>
                      <th className="px-3 py-2 text-right font-semibold">Množství</th>
                      <th className="px-3 py-2 text-right font-semibold">Celkem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((cost) => (
                      <tr
                        key={cost.id}
                        className="border-b border-slate-200/55 last:border-0 [html[data-theme='dark']_&]:border-white/[0.055]"
                      >
                        <td className={`px-3 py-3 font-medium ${VALUE_TEXT_CLASS}`}>
                          {cost.label}
                        </td>
                        <td className={`px-3 py-3 ${SUBTLE_TEXT_CLASS}`}>
                          {cost.supplier ?? cost.technicianName ?? '—'}
                        </td>
                        <td className={`px-3 py-3 text-right ${VALUE_TEXT_CLASS}`}>
                          {formatMoney(cost.unitPrice)}
                        </td>
                        <td className={`px-3 py-3 text-right ${VALUE_TEXT_CLASS}`}>
                          {formatNumber(cost.quantity)}
                        </td>
                        <td className={`px-3 py-3 text-right font-semibold ${VALUE_TEXT_CLASS}`}>
                          {formatMoney(cost.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyBlock text="Nákladové položky nejsou rozepsané." />
            )}
          </DataTablePanel>

          <div className={`${PANEL_CLASS} p-4 sm:p-5`}>
            <BlockHeading title="Provize" note="Stav přímo navázaného provizního záznamu" />
            {commission ? (
              <div className="mt-4 grid gap-3">
                <TextField label="Obchodník" value={commission.salesOwner} />
                <TextField
                  label="Základ provize"
                  value={formatMoney(commission.profitAmount)}
                />
                <TextField
                  label="Sazba"
                  value={`${formatNumber(commission.commissionRate * 100)} %`}
                />
                <TextField
                  label="Výše provize"
                  value={formatMoney(commission.commissionAmount)}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  <StatusBadge
                    label={
                      commission.approvedForPayout
                        ? 'Schváleno k výplatě'
                        : 'Neschváleno k výplatě'
                    }
                    tone={commission.approvedForPayout ? 'green' : 'default'}
                  />
                  <StatusBadge
                    label={
                      commission.payoutState === 'paid'
                        ? 'Vyplaceno'
                        : commission.payoutState === 'draft'
                          ? 'V draft dávce'
                          : 'Nevyplaceno'
                    }
                    tone={commission.payoutState === 'paid' ? 'green' : 'blue'}
                  />
                </div>
              </div>
            ) : (
              <EmptyBlock text="K realizaci není vytvořený provizní záznam." />
            )}
          </div>
        </div>
      </div>
    </Section>
  )
}

function ProtocolSection({ data }: { data: Job360Data }) {
  const { protocol, job } = data
  const details = protocol.details

  return (
    <Section
      icon={<PackageCheck className="h-5 w-5" />}
      title="Předávací protokol"
      subtitle="Požadavek na PP, uložený návrh a jeho zařízení a příslušenství"
    >
      <div className="grid gap-4">
        <div className={`${PANEL_CLASS} p-4 sm:p-5`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <BlockHeading title="Stav protokolu" />
                <StatusBadge
                  label={protocol.required ? 'PP je vyžadován' : 'PP není vyžadován'}
                  tone={protocol.required ? 'blue' : 'default'}
                />
                {details ? (
                  <StatusBadge
                    label={details.is_sent ? 'Označen jako odeslaný' : 'Neodeslaný návrh'}
                    tone={details.is_sent ? 'green' : 'amber'}
                  />
                ) : null}
              </div>
            </div>
            {details ? (
              <a
                href={`/jobs/${job.id}/pp/pdf`}
                target="_blank"
                rel="noreferrer"
                className={LINK_BUTTON_CLASS}
              >
                <FileText className="h-4 w-4" />
                Otevřít generovaný PP
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : null}
          </div>

          {details ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Název předání" value={details.handover_title} />
              <TextField label="Místo předání" value={details.handover_place} />
              <TextField label="Kontaktní osoba" value={details.contact_person} />
              <TextField label="Telefon" value={details.contact_phone} />
            </div>
          ) : (
            <EmptyBlock text="Návrh předávacího protokolu zatím není uložený." />
          )}
        </div>

        {details ? (
          <div className="grid gap-4 xl:grid-cols-2">
            <DataTablePanel title={`Zařízení (${protocol.devices.length})`}>
              {protocol.devices.length > 0 ? (
                <div className="divide-y divide-slate-200/60 [html[data-theme='dark']_&]:divide-white/[0.06]">
                  {protocol.devices.map((device) => (
                    <div
                      key={device.id}
                      className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <span className={`text-sm font-medium ${VALUE_TEXT_CLASS}`}>
                        {displayValue(device.device_name)}
                      </span>
                      <span className={`text-xs ${SUBTLE_TEXT_CLASS}`}>
                        MTH začátek: {displayValue(device.mth_start)}
                      </span>
                      <span className={`text-xs ${SUBTLE_TEXT_CLASS}`}>
                        MTH konec: {displayValue(device.mth_end)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock text="V návrhu nejsou uvedená zařízení." />
              )}
            </DataTablePanel>

            <DataTablePanel title={`Příslušenství (${protocol.accessories.length})`}>
              {protocol.accessories.length > 0 ? (
                <div className="divide-y divide-slate-200/60 [html[data-theme='dark']_&]:divide-white/[0.06]">
                  {protocol.accessories.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto_auto]"
                    >
                      <span className={`text-sm font-medium ${VALUE_TEXT_CLASS}`}>
                        {displayValue(item.item_name)}
                      </span>
                      <span className={`text-xs ${SUBTLE_TEXT_CLASS}`}>
                        Vydáno: {displayValue(item.issued_value)}
                      </span>
                      <span className={`text-xs ${SUBTLE_TEXT_CLASS}`}>
                        Vráceno: {displayValue(item.returned_value)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock text="V návrhu není uvedené příslušenství." />
              )}
            </DataTablePanel>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function DocumentsSection({
  data,
  openingDocumentId,
  onOpenDocument,
}: {
  data: Job360Data
  openingDocumentId: string | null
  onOpenDocument: (id: string) => void
}) {
  const attachmentGroups = Object.entries(ATTACHMENT_CATEGORY_LABELS)
    .map(([category, label]) => ({
      category,
      label,
      items: data.attachments.filter((item) => item.category === category),
    }))
    .filter((group) => group.items.length > 0)

  return (
    <Section
      icon={<Paperclip className="h-5 w-5" />}
      title="Dokumenty a fotografie"
      subtitle="Soubory přímo uložené u zakázky a fotografie z informační poznámky"
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid gap-4">
          {attachmentGroups.length > 0 ? (
            attachmentGroups.map((group) => (
              <DataTablePanel
                key={group.category}
                title={`${group.label} (${group.items.length})`}
              >
                <FileList
                  files={group.items.map((file) => ({
                    id: file.id,
                    name: file.displayName || file.fileName,
                    detail: [
                      formatFileSize(file.fileSizeBytes),
                      formatDateTime(file.createdAt),
                      file.note,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }))}
                  openingDocumentId={openingDocumentId}
                  onOpen={onOpenDocument}
                />
              </DataTablePanel>
            ))
          ) : (
            <EmptyPanel text="K zakázce nejsou přímo nahrané dokumenty ani fotografie." />
          )}
        </div>

        <DataTablePanel title={`Fotografie z info (${data.infoPhotos.length})`}>
          {data.infoPhotos.length > 0 ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {data.infoPhotos.map((photo) => (
                <a
                  key={photo.id}
                  href={photo.signedUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!photo.signedUrl}
                  className="group overflow-hidden rounded-2xl border border-slate-200/75 bg-slate-50/70 transition hover:-translate-y-px hover:border-[#73a6ce] [html[data-theme='dark']_&]:border-white/[0.08] [html[data-theme='dark']_&]:bg-white/[0.03]"
                >
                  <div className="flex aspect-[16/9] items-center justify-center overflow-hidden bg-slate-100 [html[data-theme='dark']_&]:bg-slate-950/50">
                    {photo.signedUrl &&
                    photo.mimeType.toLowerCase().startsWith('image/') ? (
                      // Storage URLs are temporary and can point to any configured Supabase host.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={photo.signedUrl}
                        alt={photo.fileName}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]"
                      />
                    ) : (
                      <FileImage className="h-8 w-8 text-slate-400" />
                    )}
                  </div>
                  <div className="p-3">
                    <p className={`truncate text-xs font-semibold ${VALUE_TEXT_CLASS}`}>
                      {photo.fileName}
                    </p>
                    <p className={`mt-1 text-[11px] ${SUBTLE_TEXT_CLASS}`}>
                      {formatFileSize(photo.sizeBytes)} ·{' '}
                      {formatDateTime(photo.createdAt)}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <EmptyBlock text="V informační poznámce nejsou uložené fotografie." />
          )}
        </DataTablePanel>
      </div>
    </Section>
  )
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-3 flex items-start gap-3 px-1">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-[#83add0]/45 bg-[#e9f3fa]/75 text-[#347cad] shadow-sm [html[data-theme='dark']_&]:border-[#4f92cb]/25 [html[data-theme='dark']_&]:bg-[#4f92cb]/10 [html[data-theme='dark']_&]:text-[#83b9e0]">
          {icon}
        </span>
        <div>
          <h3 className={`text-base font-semibold sm:text-lg ${VALUE_TEXT_CLASS}`}>
            {title}
          </h3>
          <p className={`mt-0.5 text-xs ${SUBTLE_TEXT_CLASS}`}>{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function InfoField({
  icon,
  label,
  value,
}: {
  icon: React.ReactElement
  label: string
  value: string | null | undefined
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 text-[#4b8cbd] [&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </span>
      <div className="min-w-0">
        <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${SUBTLE_TEXT_CLASS}`}>
          {label}
        </p>
        <p className={`mt-1 break-words text-sm font-medium ${VALUE_TEXT_CLASS}`}>
          {displayValue(value)}
        </p>
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
}: {
  label: string
  value: string | number | null | undefined
}) {
  return (
    <div className="min-w-0">
      <p className={`text-[10px] font-semibold uppercase tracking-[0.13em] ${SUBTLE_TEXT_CLASS}`}>
        {label}
      </p>
      <p className={`mt-1 break-words text-sm font-medium ${VALUE_TEXT_CLASS}`}>
        {displayValue(value)}
      </p>
    </div>
  )
}

function MetricCard({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | null
  tone?: 'default' | 'blue' | 'green' | 'red'
}) {
  const toneClass =
    tone === 'blue'
      ? 'text-[#2f78b1] [html[data-theme="dark"]_&]:text-[#82bde8]'
      : tone === 'green'
        ? 'text-emerald-700 [html[data-theme="dark"]_&]:text-emerald-400'
        : tone === 'red'
          ? 'text-red-600 [html[data-theme="dark"]_&]:text-red-400'
          : VALUE_TEXT_CLASS

  return (
    <div className={`${PANEL_CLASS} min-w-0 p-4`}>
      <p className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${SUBTLE_TEXT_CLASS}`}>
        {label}
      </p>
      <p className={`mt-2 truncate text-base font-semibold ${toneClass}`} title={value ?? '—'}>
        {displayValue(value)}
      </p>
    </div>
  )
}

function StatusBadge({
  label,
  tone = 'default',
}: {
  label: string
  tone?: 'default' | 'blue' | 'green' | 'amber'
}) {
  const toneClass =
    tone === 'blue'
      ? 'border-[#78abd0]/45 bg-[#e7f2fa]/75 text-[#2f78b1] [html[data-theme="dark"]_&]:border-[#4f92cb]/28 [html[data-theme="dark"]_&]:bg-[#4f92cb]/10 [html[data-theme="dark"]_&]:text-[#8ac1e8]'
      : tone === 'green'
        ? 'border-emerald-300/60 bg-emerald-50/80 text-emerald-700 [html[data-theme="dark"]_&]:border-emerald-500/20 [html[data-theme="dark"]_&]:bg-emerald-500/10 [html[data-theme="dark"]_&]:text-emerald-400'
        : tone === 'amber'
          ? 'border-amber-300/60 bg-amber-50/80 text-amber-700 [html[data-theme="dark"]_&]:border-amber-500/20 [html[data-theme="dark"]_&]:bg-amber-500/10 [html[data-theme="dark"]_&]:text-amber-300'
          : 'border-slate-200/80 bg-slate-50/80 text-slate-600 [html[data-theme="dark"]_&]:border-white/[0.08] [html[data-theme="dark"]_&]:bg-white/[0.04] [html[data-theme="dark"]_&]:text-slate-300'

  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${toneClass}`}
    >
      {label}
    </span>
  )
}

function BlockHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h4 className={`text-sm font-semibold ${VALUE_TEXT_CLASS}`}>{title}</h4>
      {note ? <p className={`mt-0.5 text-xs ${SUBTLE_TEXT_CLASS}`}>{note}</p> : null}
    </div>
  )
}

function DataTablePanel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={`${PANEL_CLASS} min-w-0 overflow-hidden`}>
      <div className="border-b border-slate-200/70 px-4 py-3 [html[data-theme='dark']_&]:border-white/[0.07]">
        <h4 className={`text-sm font-semibold ${VALUE_TEXT_CLASS}`}>{title}</h4>
      </div>
      {children}
    </div>
  )
}

function FileList({
  files,
  openingDocumentId,
  onOpen,
}: {
  files: Array<{ id: string; name: string; detail: string }>
  openingDocumentId: string | null
  onOpen: (id: string) => void
}) {
  return (
    <div className="divide-y divide-slate-200/60 [html[data-theme='dark']_&]:divide-white/[0.06]">
      {files.map((file) => (
        <div
          key={file.id}
          className="flex min-w-0 items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 [html[data-theme='dark']_&]:bg-white/[0.05] [html[data-theme='dark']_&]:text-slate-400">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className={`truncate text-sm font-medium ${VALUE_TEXT_CLASS}`} title={file.name}>
                {file.name}
              </p>
              <p className={`mt-0.5 truncate text-[11px] ${SUBTLE_TEXT_CLASS}`} title={file.detail}>
                {file.detail}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onOpen(file.id)}
            disabled={openingDocumentId === file.id}
            className={`${LINK_BUTTON_CLASS} shrink-0 disabled:cursor-wait disabled:opacity-60`}
          >
            {openingDocumentId === file.id ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Otevřít
          </button>
        </div>
      ))}
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return <p className={`px-4 py-6 text-center text-sm ${SUBTLE_TEXT_CLASS}`}>{text}</p>
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className={`${PANEL_CLASS} p-7 text-center`}>
      <p className={`text-sm ${SUBTLE_TEXT_CLASS}`}>{text}</p>
    </div>
  )
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '—'
  }
  return String(value)
}

function statusLabel(labels: Record<string, string>, value: string | null) {
  if (!value) return 'Neuvedeno'
  return labels[value] ?? value
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(date)
}

function formatDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeZone: 'Europe/Prague',
  }).format(date)
}

function formatMoney(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number | string) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
  }).format(number)
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
