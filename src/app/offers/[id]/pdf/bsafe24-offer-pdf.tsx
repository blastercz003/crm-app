import {
  formatCurrency,
  getOfferItemNetTotal,
} from '@/lib/offers/calculations'
import { Fragment } from 'react'
import {
  BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL,
  BSAFE24_BACKUP_LOCATION_GROUP_LABEL,
  BSAFE24_DEPOT_PRESETS,
  OFFER_ITEM_SECTION_NOTE_GROUP_LABEL,
} from '@/lib/offers/presets'
import { OFFER_PDF_TEMPLATE } from '@/lib/offers/pdf-template'
import type { OfferItemRow, OfferServiceItemRow } from '@/lib/offers/types'
import { OfferPdfAutoPrint, OfferPdfToolbar } from './print-view'
import type { OfferPdfLayoutProps } from './offer-pdf-layout'

const BSAFE24_BACKGROUND_URL = '/offers/templates/background-nabidka-new.png'
const OFFER_TYPE_LABEL = 'B-SAFE 24'

type ItemSection = {
  key: string
  title: string
  note: string
  items: OfferItemRow[]
}

function formatDate(value: string | null) {
  if (!value) return 'Bez data'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatShortDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  const date = new Date(value)
  const datePart = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
  }).format(date).replace(/\s/g, '')
  const timePart = new Intl.DateTimeFormat('cs-CZ', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)

  return `${datePart} ${timePart}`
}

function formatActivationTerm(
  activationText: string | null,
  startsAt: string | null,
  endsAt: string | null
) {
  if (activationText?.trim()) {
    return `Aktivace produktu od: ${activationText.trim()}`
  }

  if (!startsAt && !endsAt) return 'Aktivace produktu od: Bez termínu'

  return `Aktivace produktu od: ${formatShortDateTime(startsAt ?? endsAt)}`
}

function getVisibleDiscountPercent(item: OfferItemRow) {
  const discount = Number(item.discount_percent) || 0

  return discount > 0 ? discount : null
}

function formatPercent(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 2,
  }).format(value)
}

function getPreparedByName({ offer, authorProfile }: Pick<OfferPdfLayoutProps, 'offer' | 'authorProfile'>) {
  return offer.prepared_by_name ?? authorProfile?.offer_prepared_by_name ?? authorProfile?.name ?? 'Neuvedeno'
}

function getPreparedByContact({ offer, authorProfile }: Pick<OfferPdfLayoutProps, 'offer' | 'authorProfile'>) {
  const phone = offer.prepared_by_phone ?? authorProfile?.offer_prepared_by_phone
  const email = offer.prepared_by_email ?? authorProfile?.offer_prepared_by_email

  return [phone, email].filter(Boolean).join(' / ')
}

function getSectionNoteBySection(serviceItems: OfferServiceItemRow[]) {
  return new Map(
    serviceItems
      .filter((item) => item.specification === OFFER_ITEM_SECTION_NOTE_GROUP_LABEL)
      .map((item) => [item.service_name, item.operation ?? ''])
  )
}

function getBsafeItemSections(items: OfferItemRow[], serviceItems: OfferServiceItemRow[]): ItemSection[] {
  const sectionNoteBySection = getSectionNoteBySection(serviceItems)
  const plannedTripPriceByDescription = new Map(
    items
      .filter((item) => item.item_section === 'bsafe_planned_trip')
      .map((item) => [item.description, item.unit_price_without_vat])
  )
  const tripItems = items
    .filter((item) => item.item_section === 'bsafe_realization')
    .map((item) => (
      item.planned_unit_price_without_vat == null
        ? {
            ...item,
            planned_unit_price_without_vat: plannedTripPriceByDescription.get(item.description) ?? null,
          }
        : item
    ))

  return [
    {
      key: 'bsafe_service',
      title: 'KALKULACE SLUŽBY B-SAFE 24',
      note: sectionNoteBySection.get('bsafe_service') ?? sectionNoteBySection.get('main') ?? '',
      items: items.filter((item) => item.item_section === 'bsafe_service' || item.item_section === 'main'),
    },
    {
      key: 'bsafe_realization',
      title: 'CENÍK VÝJEZDŮ B-SAFE 24',
      note: sectionNoteBySection.get('bsafe_realization') ?? '',
      items: tripItems,
    },
  ]
}

function getBsafeBackupLocation(serviceItems: OfferServiceItemRow[]) {
  return serviceItems.find((item) => item.specification === BSAFE24_BACKUP_LOCATION_GROUP_LABEL)
    ?.service_name ?? 'NE'
}

function getBsafeBackupLocationCount(serviceItems: OfferServiceItemRow[]) {
  return serviceItems.find((item) => item.specification === BSAFE24_BACKUP_LOCATION_COUNT_GROUP_LABEL)
    ?.service_name ?? '1'
}

export function BSafe24OfferPdf({
  offer,
  client,
  items,
  serviceItems,
  authorProfile,
  isStandalone,
  shouldAutoPrint,
}: OfferPdfLayoutProps) {
  const preparedBy = getPreparedByName({ offer, authorProfile })
  const preparedByContact = getPreparedByContact({ offer, authorProfile })
  const backupLocation = getBsafeBackupLocation(serviceItems)
  const backupLocationCount = getBsafeBackupLocationCount(serviceItems)
  const sections = getBsafeItemSections(items, serviceItems)
  const serviceSection = sections.find((section) => section.key === 'bsafe_service')
  const tripSection = sections.find((section) => section.key === 'bsafe_realization')
  const hasServiceItems = Boolean(serviceSection?.items.length)
  const hasTripItems = Boolean(tripSection?.items.length)

  return (
    <>
      {shouldAutoPrint ? <OfferPdfAutoPrint /> : null}
      <style>
        {`
          @page {
            size: A4;
            margin: 0;
          }

          .bsafe-offer-pdf-document {
            --brand-blue: #0784c3;
            --brand-blue-dark: #02699f;
            --bsafe-outage-column-width: 48px;
            --bsafe-service-price-offset: 28px;
            --bsafe-service-price-width: 74px;
            --bsafe-standby-column-width: 62px;
            --ink: #101828;
            --muted: #667085;
            --glass-bg: rgba(255, 255, 255, 0.72);
            width: ${OFFER_PDF_TEMPLATE.screenWidthPx}px;
            height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            background-image: url("${BSAFE24_BACKGROUND_URL}");
            background-position: top center;
            background-repeat: no-repeat;
            background-size: ${OFFER_PDF_TEMPLATE.screenWidthPx}px ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            color: var(--ink);
            font-family: Arial, sans-serif;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .bsafe-offer-pdf-content {
            height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            padding: 42px 54px 204px;
          }

          .bsafe-pdf-top {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 238px;
            gap: 28px;
            align-items: start;
          }

          .bsafe-pdf-left-start {
            padding-top: 64px;
          }

          .bsafe-pdf-left-stack {
            display: grid;
            gap: 12px;
          }

          .bsafe-pdf-card {
            border: 1px solid rgba(255, 255, 255, 0.82);
            border-radius: 16px;
            background: var(--glass-bg);
            box-shadow: 0 12px 34px rgba(15, 55, 85, 0.08);
            backdrop-filter: blur(8px);
          }

          .bsafe-pdf-card.compact {
            border-radius: 14px;
          }

          .bsafe-pdf-card-title {
            color: var(--brand-blue);
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.16em;
            line-height: 1;
            text-transform: uppercase;
          }

          .bsafe-pdf-card-primary {
            margin-top: 7px;
            font-size: 12px;
            font-weight: 800;
            line-height: 1.22;
          }

          .bsafe-pdf-card-text {
            margin-top: 5px;
            color: var(--muted);
            font-size: 9px;
            line-height: 1.35;
            white-space: pre-wrap;
          }

          .bsafe-pdf-client-card {
            min-height: 104px;
            padding: 14px 16px;
          }

          .bsafe-pdf-meta {
            display: grid;
            gap: 8px;
          }

          .bsafe-pdf-offer-number {
            display: flex;
            min-height: 56px;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
            color: #fff;
            box-shadow: 0 12px 28px rgba(7, 132, 195, 0.22);
            text-align: center;
            text-transform: uppercase;
          }

          .bsafe-pdf-offer-number-label {
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.2em;
          }

          .bsafe-pdf-offer-number-value {
            margin-top: 5px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.12em;
          }

          .bsafe-pdf-type-badge {
            display: flex;
            min-height: 30px;
            align-items: center;
            justify-content: center;
            border: 1px solid #101828;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.9);
            color: var(--ink);
            font-size: 13px;
            font-weight: 800;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }

          .bsafe-pdf-date-lines {
            color: #475467;
            font-size: 6.2px;
            font-weight: 800;
            letter-spacing: 0.08em;
            line-height: 1.45;
            text-align: right;
            text-transform: uppercase;
          }

          .bsafe-pdf-prepared-head {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: start;
          }

          .bsafe-pdf-prepared-card {
            min-height: 58px;
            padding: 9px 14px;
          }

          .bsafe-pdf-intro {
            margin-top: 6px;
            padding-left: 15px;
          }

          .bsafe-pdf-eyebrow {
            color: var(--brand-blue);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.12em;
            line-height: 1.2;
            text-transform: uppercase;
          }

          .bsafe-pdf-project-name,
          .bsafe-pdf-realization-term {
            color: var(--ink);
            font-size: 12px;
            font-weight: 800;
            line-height: 1.22;
          }

          .bsafe-pdf-project-name {
            margin-top: 5px;
            max-width: 470px;
          }

          .bsafe-pdf-realization-term {
            margin-top: 6px;
          }

          .bsafe-pdf-address-card {
            min-height: 48px;
            padding: 11px 15px;
          }

          .bsafe-pdf-address-value {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .bsafe-pdf-info-card {
            min-height: 78px;
            padding: 11px 15px 8px;
          }

          .bsafe-pdf-info-summary {
            display: grid;
            align-content: start;
          }

          .bsafe-pdf-chip-list {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            margin-top: 5px;
          }

          .bsafe-pdf-chip {
            display: inline-flex;
            min-height: 14px;
            align-items: center;
            border: 1px solid rgba(7, 132, 195, 0.18);
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.7);
            padding: 2px 6px;
            color: var(--brand-blue);
            font-size: 6.2px;
            font-weight: 800;
            line-height: 1;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .bsafe-pdf-strong-chip {
            border-color: transparent;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
            color: #fff;
          }

          .bsafe-pdf-info-block + .bsafe-pdf-info-block {
            margin-top: 8px;
          }

          .bsafe-pdf-items-section {
            margin-top: 16px;
          }

          .bsafe-pdf-items-section + .bsafe-pdf-items-section {
            margin-top: 16px;
          }

          .bsafe-pdf-items-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-radius: 16px 16px 0 0;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
            padding: 5px 14px;
            color: #fff;
          }

          .bsafe-pdf-items-header.trip {
            display: grid;
            grid-template-columns: 25% 38% 8% 14% 15%;
            gap: 0;
          }

          .bsafe-pdf-items-header.service {
            display: grid;
            grid-template-columns: 25% 24% 14% 8% 7% 7% 15%;
            gap: 0;
          }

          .bsafe-pdf-items-header.service .bsafe-pdf-items-title {
            grid-column: 1 / 7;
          }

          .bsafe-pdf-items-header.trip .bsafe-pdf-items-title {
            grid-column: 1 / 4;
          }

          .bsafe-pdf-trip-header-label {
            color: #fff;
            font-size: 7.4px;
            font-weight: 800;
            letter-spacing: 0.16em;
            line-height: 1.2;
            text-align: right;
            text-transform: uppercase;
            transform: translateX(18px);
          }

          .bsafe-pdf-items-header.service .bsafe-pdf-trip-header-label {
            width: var(--bsafe-outage-column-width);
            justify-self: start;
          }

          .bsafe-pdf-items-header.trip .bsafe-pdf-trip-header-label {
            justify-self: start;
          }

          .bsafe-pdf-items-header.trip .bsafe-pdf-trip-header-label:nth-of-type(1) {
            width: var(--bsafe-standby-column-width);
          }

          .bsafe-pdf-items-header.trip .bsafe-pdf-trip-header-label:nth-of-type(2) {
            width: var(--bsafe-outage-column-width);
          }

          .bsafe-pdf-items-title,
          .bsafe-pdf-items-note {
            margin: 0;
            color: #fff;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }

          .bsafe-pdf-items-table {
            width: 100%;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.78);
            font-size: 8.4px;
            table-layout: fixed;
          }

          .bsafe-pdf-items-table td {
            height: 27px;
            border-bottom: 1px solid rgba(7, 132, 195, 0.12);
            padding: 4px 6px;
            vertical-align: middle;
          }

          .bsafe-pdf-items-table td:first-child {
            padding-left: 15px;
          }

          .bsafe-pdf-items-table tr.no-border-after td {
            border-bottom: 0;
          }

          .bsafe-pdf-items-table .number {
            text-align: right;
          }

          .bsafe-pdf-items-table .center {
            text-align: center;
          }

          .bsafe-pdf-section-row td {
            height: auto;
            border-bottom: 0;
            background: rgba(7, 132, 195, 0.09);
            padding: 7px 15px;
            color: var(--brand-blue);
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .bsafe-pdf-section-row.compact td {
            padding: 5px 15px;
          }

          .bsafe-pdf-section-note {
            display: inline-block;
            color: #475467;
            font-size: 6.4px;
            font-weight: 700;
            line-height: 1.2;
            white-space: pre-wrap;
          }

          .bsafe-pdf-section-note-row td {
            height: auto;
            background: rgba(255, 255, 255, 0.34);
            border-bottom: 0;
            padding: 1px 15px 2px;
          }

          .bsafe-pdf-item-name {
            font-weight: 800;
            line-height: 1.22;
          }

          .bsafe-pdf-specification {
            color: var(--muted);
            line-height: 1.22;
            white-space: pre-wrap;
          }

          .bsafe-pdf-service-table .bsafe-pdf-specification {
            color: inherit;
            font-weight: 800;
          }

          .bsafe-pdf-price-cell {
            position: relative;
            display: grid;
            grid-template-columns: 0 var(--bsafe-service-price-width);
            align-items: center;
            transform: translateX(var(--bsafe-service-price-offset));
            white-space: nowrap;
          }

          .bsafe-pdf-price-cell.no-discount {
            grid-template-columns: 0 var(--bsafe-service-price-width);
          }

          .bsafe-pdf-discount {
            position: absolute;
            left: 0;
            top: 50%;
            display: inline-flex;
            width: 58px;
            min-height: 15px;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            background: var(--brand-blue);
            padding: 3px 5px;
            color: #fff;
            font-size: 6.4px;
            font-weight: 800;
            letter-spacing: 0.04em;
            line-height: 1;
            text-transform: uppercase;
            transform: translate(calc(-50% - var(--bsafe-service-price-offset)), -50%);
          }

          .bsafe-pdf-price-value {
            grid-column: 2;
            justify-self: start;
            width: var(--bsafe-service-price-width);
            color: var(--brand-blue);
            font-size: 10.6px;
            font-weight: 900;
            text-align: right;
          }

          .bsafe-pdf-trip-table td {
            height: 23px;
          }

          .bsafe-pdf-trip-table td:nth-child(4),
          .bsafe-pdf-trip-table td:nth-child(5) {
            padding-left: 0;
            padding-right: 6px;
            text-align: left;
          }

          .bsafe-pdf-trip-price {
            display: inline-block;
            color: var(--ink);
            font-weight: 800;
            text-align: right;
            white-space: nowrap;
          }

          .bsafe-pdf-trip-table td:nth-child(4) .bsafe-pdf-trip-price {
            width: var(--bsafe-standby-column-width);
          }

          .bsafe-pdf-trip-table td:nth-child(5) .bsafe-pdf-trip-price {
            width: var(--bsafe-outage-column-width);
          }

          .bsafe-pdf-table-end {
            height: 10px;
            border-radius: 0 0 16px 16px;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
          }

          .bsafe-pdf-bottom {
            max-width: 520px;
            margin-top: 14px;
          }

          .bsafe-pdf-terms {
            padding: 4px 0 0 15px;
            color: #475467;
            font-size: 7.2px;
            line-height: 1.3;
          }

          .bsafe-pdf-terms-title {
            margin-bottom: 4px;
            color: var(--brand-blue);
            font-size: 7.4px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          @media print {
            body {
              background: #fff !important;
            }

            .bsafe-offer-pdf-document {
              width: ${OFFER_PDF_TEMPLATE.printWidthMm}mm;
              height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              background-size: ${OFFER_PDF_TEMPLATE.printWidthMm}mm ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              overflow: hidden;
            }

            .bsafe-offer-pdf-content {
              height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              padding: 11mm 14mm 54mm;
            }
          }
        `}
      </style>

      {!isStandalone ? (
        <div className="mx-auto max-w-[860px] pt-6">
          <OfferPdfToolbar
            backHref={`/offers/${offer.id}`}
            printHref={`/offers/${offer.id}/pdf?standalone=1&print=1`}
          />
        </div>
      ) : null}

      <main className={isStandalone ? 'bg-white text-gray-950' : 'min-h-screen bg-zinc-100 px-4 py-6 text-gray-950 print:bg-white print:px-0 print:py-0'}>
        <article className="bsafe-offer-pdf-document mx-auto shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:shadow-none">
          <div className="bsafe-offer-pdf-content">
            <section className="bsafe-pdf-top">
              <div className="bsafe-pdf-left-start">
                <div className="bsafe-pdf-left-stack">
                  <div className="bsafe-pdf-card bsafe-pdf-client-card">
                    <div className="bsafe-pdf-card-title">Klient</div>
                    <div className="bsafe-pdf-card-primary">{client.name}</div>
                    {client.ico ? <div className="bsafe-pdf-card-text">IČO: {client.ico}</div> : null}
                    {client.address ? <div className="bsafe-pdf-card-text">{client.address}</div> : null}
                    {offer.contact_person ? (
                      <div className="bsafe-pdf-card-text">Kontaktní osoba: {offer.contact_person}</div>
                    ) : null}
                  </div>

                  <div className="bsafe-pdf-card bsafe-pdf-address-card">
                    <div className="bsafe-pdf-card-title">Zálohované lokality</div>
                    <div className="bsafe-pdf-card-primary bsafe-pdf-address-value">
                      {offer.realization_address || 'Adresa není vyplněná'}
                    </div>
                  </div>

                  <header className="bsafe-pdf-intro">
                    <div className="bsafe-pdf-eyebrow">
                      B-SAFE 24: Garance dojezdu elektrocentrál na zavolání
                    </div>
                    <h1 className="bsafe-pdf-project-name">{offer.title}</h1>
                    <div className="bsafe-pdf-realization-term">
                      {formatActivationTerm(
                        offer.project_name,
                        offer.realization_starts_at,
                        offer.realization_ends_at
                      )}
                    </div>
                  </header>
                </div>
              </div>

              <aside className="bsafe-pdf-meta">
                <div className="bsafe-pdf-offer-number">
                  <span className="bsafe-pdf-offer-number-label">Číslo nabídky</span>
                  <span className="bsafe-pdf-offer-number-value">{offer.offer_number}</span>
                </div>
                <div className="bsafe-pdf-type-badge">{OFFER_TYPE_LABEL}</div>
                <div className="bsafe-pdf-card compact bsafe-pdf-prepared-card">
                  <div className="bsafe-pdf-prepared-head">
                    <div className="bsafe-pdf-card-title">Zpracoval</div>
                    <div className="bsafe-pdf-date-lines">
                      <div>Vystaveno {formatDate(offer.created_at)}</div>
                      <div>Platnost do {formatDate(offer.valid_until)}</div>
                    </div>
                  </div>
                  <div className="bsafe-pdf-card-primary">{preparedBy}</div>
                  {preparedByContact ? <div className="bsafe-pdf-card-text">{preparedByContact}</div> : null}
                </div>
                <div className="bsafe-pdf-card bsafe-pdf-info-card bsafe-pdf-info-summary">
                  <div className="bsafe-pdf-info-block">
                    <div className="bsafe-pdf-card-title">Současná záloha lokalit</div>
                    <div className="bsafe-pdf-chip-list">
                      <span className="bsafe-pdf-chip bsafe-pdf-strong-chip">{backupLocation}</span>
                      {backupLocation === 'ANO' ? (
                        <span className="bsafe-pdf-chip">Počet lokalit: {backupLocationCount}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="bsafe-pdf-info-block">
                    <div className="bsafe-pdf-card-title">Depo</div>
                    <div className="bsafe-pdf-chip-list">
                      <span className="bsafe-pdf-chip bsafe-pdf-strong-chip">{BSAFE24_DEPOT_PRESETS[0]}</span>
                    </div>
                  </div>
                </div>
              </aside>
            </section>

            <section className="bsafe-pdf-items-section">
              <div className="bsafe-pdf-items-header service">
                <h2 className="bsafe-pdf-items-title">Kalkulace služby B-SAFE 24</h2>
                <div className="bsafe-pdf-trip-header-label">Měsíčně</div>
              </div>

              <table className="bsafe-pdf-items-table bsafe-pdf-service-table">
                <colgroup>
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '7%' }} />
                  <col style={{ width: '22%' }} />
                </colgroup>
                <tbody>
                  {hasServiceItems && serviceSection ? (
                    serviceSection.items.map((item, itemIndex) => {
                      const visibleDiscountPercent = getVisibleDiscountPercent(item)
                      const isLastItemBeforeNote = Boolean(serviceSection.note) && itemIndex === serviceSection.items.length - 1

                      return (
                        <Fragment key={item.id}>
                          <tr className={isLastItemBeforeNote ? 'no-border-after' : undefined}>
                            <td className="bsafe-pdf-item-name">{item.description}</td>
                            <td className="bsafe-pdf-specification">{item.specification ?? ''}</td>
                            <td className="number">{formatCurrency(Number(item.unit_price_without_vat), offer.currency)}</td>
                            <td className="center">{item.unit}</td>
                            <td className="number" />
                            <td>
                              <div className={`bsafe-pdf-price-cell${visibleDiscountPercent === null ? ' no-discount' : ''}`}>
                                {visibleDiscountPercent !== null ? (
                                  <span className="bsafe-pdf-discount">
                                    SLEVA {formatPercent(visibleDiscountPercent)}%
                                  </span>
                                ) : null}
                                <span className="bsafe-pdf-price-value">
                                  {formatCurrency(getOfferItemNetTotal(item), offer.currency)}
                                </span>
                              </div>
                            </td>
                          </tr>
                          {isLastItemBeforeNote ? (
                            <tr className="bsafe-pdf-section-note-row">
                              <td colSpan={6}>
                                <span className="bsafe-pdf-section-note">{serviceSection.note}</span>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#667085' }}>
                        Nabídka zatím nemá položky.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="bsafe-pdf-table-end" />
            </section>

            <section className="bsafe-pdf-items-section">
              <div className="bsafe-pdf-items-header trip">
                <h2 className="bsafe-pdf-items-title">Ceník výjezdů B-SAFE 24</h2>
                <div className="bsafe-pdf-trip-header-label">Pohotovost</div>
                <div className="bsafe-pdf-trip-header-label">Odstávka</div>
              </div>

              <table className="bsafe-pdf-items-table bsafe-pdf-trip-table">
                <colgroup>
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '38%' }} />
                  <col style={{ width: '8%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <tbody>
                  {hasTripItems && tripSection ? (
                    tripSection.items.map((item, itemIndex) => {
                      const isLastItemBeforeNote = Boolean(tripSection.note) && itemIndex === tripSection.items.length - 1

                      return (
                        <Fragment key={item.id}>
                          <tr className={isLastItemBeforeNote ? 'no-border-after' : undefined}>
                            <td className="bsafe-pdf-item-name">{item.description}</td>
                            <td className="bsafe-pdf-specification">{item.specification ?? ''}</td>
                            <td className="center">{item.unit}</td>
                            <td className="number">
                              <div className="bsafe-pdf-trip-price">
                                {formatCurrency(Number(item.unit_price_without_vat), offer.currency)}
                              </div>
                            </td>
                            <td className="number">
                              <div className="bsafe-pdf-trip-price">
                                {formatCurrency(Number(item.planned_unit_price_without_vat) || 0, offer.currency)}
                              </div>
                            </td>
                          </tr>
                          {isLastItemBeforeNote ? (
                            <tr className="bsafe-pdf-section-note-row">
                              <td colSpan={5}>
                                <span className="bsafe-pdf-section-note">{tripSection.note}</span>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#667085' }}>
                        Nabídka zatím nemá položky.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="bsafe-pdf-table-end" />
            </section>

            <section className="bsafe-pdf-bottom">
              <div className="bsafe-pdf-terms">
                <div className="bsafe-pdf-terms-title">Obchodní podmínky</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{offer.terms_note ?? ''}</div>
              </div>
            </section>
          </div>
        </article>
      </main>
    </>
  )
}
