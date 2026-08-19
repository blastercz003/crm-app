import {
  formatCurrency,
  getOfferItemNetTotal,
  getOfferTotals,
} from '@/lib/offers/calculations'
import { Fragment } from 'react'
import {
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_ITEM_SECTION_NOTE_GROUP_LABEL,
  OFFER_SERVICE_GROUP_LABEL,
} from '@/lib/offers/presets'
import { OFFER_PDF_TEMPLATE } from '@/lib/offers/pdf-template'
import type { OfferItemRow, OfferServiceItemRow } from '@/lib/offers/types'
import { OfferPdfAutoPrint, OfferPdfMobilePreviewControls, OfferPdfToolbar } from './print-view'
import type { OfferPdfLayoutProps } from './offer-pdf-layout'

const CLASSIC_BACKGROUND_URL = '/offers/templates/background-nabidka-new.png'
const OFFER_TYPE_LABEL = 'KLASICKÁ'
const SINGLE_PAGE_VISUAL_ROW_LIMIT = 15
const FIRST_PAGE_CONTINUED_VISUAL_ROW_LIMIT = 16
const CONTINUATION_PAGE_VISUAL_ROW_LIMIT = 21
const LAST_PAGE_WITH_SUMMARY_VISUAL_ROW_LIMIT = 21

type ItemSection = {
  key: string
  title: string
  note: string
  items: OfferItemRow[]
}

type TableGroup =
  | {
      key: string
      type: 'section'
      title: string
      visualRows: number
    }
  | {
      key: string
      type: 'item'
      item: OfferItemRow
      note: string
      visualRows: number
    }

type TablePage = {
  key: string
  groups: TableGroup[]
  showTop: boolean
  showBottom: boolean
  showTableEnd: boolean
  isContinuation: boolean
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

function formatRealizationTerm(startsAt: string | null, endsAt: string | null) {
  if (!startsAt && !endsAt) return 'Termín realizace: Bez termínu'

  return `Termín realizace: ${formatShortDateTime(startsAt)} - ${formatShortDateTime(endsAt)}`
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

function getServiceNames(serviceItems: OfferServiceItemRow[], groupLabel: string) {
  return serviceItems
    .filter((item) => item.specification === groupLabel)
    .map((item) => item.service_name)
}

function getSectionNoteBySection(serviceItems: OfferServiceItemRow[]) {
  return new Map(
    serviceItems
      .filter((item) => item.specification === OFFER_ITEM_SECTION_NOTE_GROUP_LABEL)
      .map((item) => [item.service_name, item.operation ?? ''])
  )
}

function getClassicItemSections(items: OfferItemRow[], serviceItems: OfferServiceItemRow[]): ItemSection[] {
  const sectionNoteBySection = getSectionNoteBySection(serviceItems)

  return [
    {
      key: 'classic_generators',
      title: 'ELEKTROCENTRÁLY',
      note: sectionNoteBySection.get('classic_generators') ?? sectionNoteBySection.get('main') ?? '',
      items: items.filter((item) => item.item_section === 'classic_generators' || item.item_section === 'main'),
    },
    {
      key: 'classic_accessories',
      title: 'PŘÍSLUŠENSTVÍ',
      note: sectionNoteBySection.get('classic_accessories') ?? '',
      items: items.filter((item) => item.item_section === 'classic_accessories'),
    },
    {
      key: 'classic_services',
      title: 'SLUŽBY',
      note: sectionNoteBySection.get('classic_services') ?? '',
      items: items.filter((item) => item.item_section === 'classic_services'),
    },
  ]
}

function getTableGroups(sections: ItemSection[]) {
  return sections.flatMap((section) => {
    if (section.items.length === 0) return []

    const itemGroups = section.items.map((item, index) => {
      const note = index === section.items.length - 1 ? section.note : ''

      return {
        key: item.id,
        type: 'item' as const,
        item,
        note,
        visualRows: note ? 2 : 1,
      }
    })

    return [
      {
        key: `${section.key}-title`,
        type: 'section' as const,
        title: section.title,
        visualRows: 1,
      },
      ...itemGroups,
    ]
  })
}

function getVisualRowCount(groups: TableGroup[]) {
  return groups.reduce((sum, group) => sum + group.visualRows, 0)
}

function takeTableGroups(groups: TableGroup[], limit: number) {
  const pageGroups: TableGroup[] = []
  let usedRows = 0
  let index = 0

  while (index < groups.length) {
    const group = groups[index]
    const nextGroup = groups[index + 1]
    const requiredRows = group.type === 'section' && nextGroup
      ? group.visualRows + nextGroup.visualRows
      : group.visualRows

    if (pageGroups.length > 0 && usedRows + requiredRows > limit) {
      break
    }

    pageGroups.push(group)
    usedRows += group.visualRows
    index += 1
  }

  return {
    pageGroups,
    remainingGroups: groups.slice(index),
  }
}

function getTablePages(groups: TableGroup[]): TablePage[] {
  const totalRows = getVisualRowCount(groups)

  if (totalRows <= SINGLE_PAGE_VISUAL_ROW_LIMIT) {
    return [
      {
        key: 'page-1',
        groups,
        showTop: true,
        showBottom: true,
        showTableEnd: true,
        isContinuation: false,
      },
    ]
  }

  const pages: TablePage[] = []
  let remainingGroups = groups
  let firstPage = takeTableGroups(remainingGroups, FIRST_PAGE_CONTINUED_VISUAL_ROW_LIMIT)

  if (firstPage.remainingGroups.length === 0) {
    firstPage = takeTableGroups(remainingGroups, SINGLE_PAGE_VISUAL_ROW_LIMIT)
  }

  pages.push({
    key: 'page-1',
    groups: firstPage.pageGroups,
    showTop: true,
    showBottom: false,
    showTableEnd: false,
    isContinuation: false,
  })

  remainingGroups = firstPage.remainingGroups

  while (remainingGroups.length > 0) {
    const remainingRows = getVisualRowCount(remainingGroups)
    const isLastPage = remainingRows <= LAST_PAGE_WITH_SUMMARY_VISUAL_ROW_LIMIT
    const limit = isLastPage
      ? LAST_PAGE_WITH_SUMMARY_VISUAL_ROW_LIMIT
      : CONTINUATION_PAGE_VISUAL_ROW_LIMIT
    const page = takeTableGroups(remainingGroups, limit)
    const nextRemainingGroups = page.remainingGroups
    const willBeLastPage = nextRemainingGroups.length === 0

    pages.push({
      key: `page-${pages.length + 1}`,
      groups: page.pageGroups,
      showTop: false,
      showBottom: willBeLastPage,
      showTableEnd: willBeLastPage,
      isContinuation: true,
    })

    remainingGroups = nextRemainingGroups
  }

  return pages
}

export function ClassicOfferPdf({
  offer,
  client,
  items,
  serviceItems,
  authorProfile,
  isStandalone,
  shouldAutoPrint,
  mobilePreview = false,
  mobileBackHref,
}: OfferPdfLayoutProps) {
  const totals = getOfferTotals(items)
  const preparedBy = getPreparedByName({ offer, authorProfile })
  const preparedByContact = getPreparedByContact({ offer, authorProfile })
  const services = getServiceNames(serviceItems, OFFER_SERVICE_GROUP_LABEL)
  const depots = getServiceNames(serviceItems, OFFER_DEPOT_GROUP_LABEL)
  const sections = getClassicItemSections(items, serviceItems)
  const tableGroups = getTableGroups(sections)
  const tablePages = getTablePages(tableGroups)

  return (
    <>
      {shouldAutoPrint ? <OfferPdfAutoPrint /> : null}
      <style>
        {`
          @page {
            size: A4;
            margin: 0;
          }

          .classic-offer-pdf-document {
            --brand-blue: #0784c3;
            --brand-blue-dark: #02699f;
            --ink: #101828;
            --muted: #667085;
            --line: rgba(7, 132, 195, 0.18);
            --glass-bg: rgba(255, 255, 255, 0.72);
            --glass-strong: rgba(255, 255, 255, 0.86);
            --content-left-align: 15px;
            width: ${OFFER_PDF_TEMPLATE.screenWidthPx}px;
            height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            background-image: url("${CLASSIC_BACKGROUND_URL}");
            background-position: top center;
            background-repeat: repeat-y;
            background-size: ${OFFER_PDF_TEMPLATE.screenWidthPx}px ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            color: var(--ink);
            font-family: Arial, sans-serif;
            break-after: page;
            page-break-after: always;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .classic-offer-pdf-document:last-child {
            break-after: auto;
            page-break-after: auto;
          }

          @media screen and (max-width: 767px) {
            .offer-pdf-mobile-preview .classic-offer-pdf-document {
              zoom: var(--offer-mobile-pdf-scale, 0.45);
            }
          }

          .classic-offer-pdf-content {
            height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            padding: 42px 54px 204px;
          }

          .classic-offer-pdf-content.continuation {
            padding-top: 106px;
          }

          .classic-pdf-top {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 238px;
            gap: 28px;
            align-items: start;
          }

          .classic-pdf-left-start {
            padding-top: 64px;
          }

          .classic-pdf-left-stack {
            display: grid;
            gap: 12px;
          }

          .classic-pdf-card {
            border: 1px solid rgba(255, 255, 255, 0.82);
            border-radius: 16px;
            background: var(--glass-bg);
            box-shadow: 0 12px 34px rgba(15, 55, 85, 0.08);
            backdrop-filter: blur(8px);
          }

          .classic-pdf-card.compact {
            border-radius: 14px;
          }

          .classic-pdf-card-title {
            color: var(--brand-blue);
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.16em;
            line-height: 1;
            text-transform: uppercase;
          }

          .classic-pdf-card-primary {
            margin-top: 7px;
            font-size: 12px;
            font-weight: 800;
            line-height: 1.22;
          }

          .classic-pdf-card-text {
            margin-top: 5px;
            color: var(--muted);
            font-size: 9px;
            line-height: 1.35;
            white-space: pre-wrap;
          }

          .classic-pdf-client-card {
            min-height: 104px;
            padding: 14px 16px;
          }

          .classic-pdf-meta {
            display: grid;
            gap: 8px;
          }

          .classic-pdf-offer-number {
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

          .classic-pdf-offer-number-label {
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.2em;
          }

          .classic-pdf-offer-number-value {
            margin-top: 5px;
            font-size: 12px;
            font-weight: 800;
            letter-spacing: 0.12em;
          }

          .classic-pdf-type-badge {
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

          .classic-pdf-date-lines {
            color: #475467;
            font-size: 6.2px;
            font-weight: 800;
            letter-spacing: 0.08em;
            line-height: 1.45;
            text-align: right;
            text-transform: uppercase;
          }

          .classic-pdf-prepared-head {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            align-items: start;
          }

          .classic-pdf-prepared-card {
            min-height: 58px;
            padding: 9px 14px;
          }

          .classic-pdf-intro {
            margin-top: 6px;
            padding-left: 15px;
          }

          .classic-pdf-eyebrow {
            color: var(--brand-blue);
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.12em;
            line-height: 1.2;
            text-transform: uppercase;
          }

          .classic-pdf-project-name {
            margin-top: 5px;
            max-width: 470px;
            color: var(--ink);
            font-size: 12px;
            font-weight: 800;
            line-height: 1.22;
          }

          .classic-pdf-realization-term {
            margin-top: 6px;
            color: var(--ink);
            font-size: 12px;
            font-weight: 800;
            line-height: 1.22;
          }

          .classic-pdf-info-card {
            min-height: 78px;
            padding: 13px 15px;
          }

          .classic-pdf-address-card {
            min-height: 48px;
            padding: 11px 15px;
          }

          .classic-pdf-address-value {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .classic-pdf-service-summary {
            display: grid;
            gap: 6px;
            align-content: start;
          }

          .classic-pdf-service-card {
            min-height: 78px;
            padding: 11px 15px;
          }

          .classic-pdf-chip-list {
            display: flex;
            flex-wrap: wrap;
            gap: 3px;
            margin-top: 5px;
          }

          .classic-pdf-chip {
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

          .classic-pdf-depot-chip {
            border-color: transparent;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
            color: #fff;
          }

          .classic-pdf-empty-text {
            margin-top: 5px;
            color: var(--muted);
            font-size: 7px;
            line-height: 1.2;
          }

          .classic-pdf-service-block + .classic-pdf-service-block {
            margin-top: 1px;
          }

          .classic-pdf-service-block .classic-pdf-card-title {
            font-size: 8px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .classic-pdf-items-section {
            margin-top: 16px;
          }

          .classic-pdf-items-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-radius: 16px 16px 0 0;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
            padding: 5px var(--content-left-align);
            color: #fff;
          }

          .classic-pdf-items-title {
            margin: 0;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }

          .classic-pdf-items-note {
            color: #fff;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.18em;
            opacity: 1;
            text-transform: uppercase;
          }

          .classic-pdf-items-table {
            width: 100%;
            border-collapse: collapse;
            background: rgba(255, 255, 255, 0.78);
            font-size: 8.4px;
            table-layout: fixed;
          }

          .classic-pdf-items-table td {
            height: 30px;
            border-bottom: 1px solid rgba(7, 132, 195, 0.12);
            padding: 5px 6px;
            vertical-align: middle;
          }

          .classic-pdf-items-table td:first-child {
            padding-left: var(--content-left-align);
          }

          .classic-pdf-items-table td:last-child {
            padding-right: var(--content-left-align);
          }

          .classic-pdf-items-table tr.no-border-after td {
            border-bottom: 0;
          }

          .classic-pdf-items-table .number {
            text-align: right;
          }

          .classic-pdf-items-table .center {
            text-align: center;
          }

          .classic-pdf-section-row td {
            height: auto;
            border-bottom: 0;
            background: rgba(7, 132, 195, 0.09);
            padding: 7px var(--content-left-align);
            color: var(--brand-blue);
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .classic-pdf-section-title {
            display: block;
          }

          .classic-pdf-section-note {
            display: inline-block;
            margin: 0 0 0 8px;
            color: #475467;
            font-size: 6.4px;
            font-weight: 700;
            letter-spacing: 0;
            line-height: 1.2;
            text-transform: none;
            white-space: pre-wrap;
          }

          .classic-pdf-section-note-row td {
            height: auto;
            background: rgba(255, 255, 255, 0.34);
            border-bottom: 0;
            padding: 1px var(--content-left-align) 2px;
          }

          .classic-pdf-section-note-row .classic-pdf-section-note {
            margin-left: 0;
          }

          .classic-pdf-item-name {
            font-weight: 800;
            line-height: 1.22;
          }

          .classic-pdf-specification {
            color: var(--muted);
            line-height: 1.22;
            white-space: pre-wrap;
          }

          .classic-pdf-price-cell {
            display: grid;
            grid-template-columns: 68px minmax(0, 1fr);
            align-items: center;
            gap: 8px;
            white-space: nowrap;
          }

          .classic-pdf-price-cell.no-discount {
            grid-template-columns: minmax(0, 1fr);
          }

          .classic-pdf-discount {
            display: inline-flex;
            min-height: 16px;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            background: var(--brand-blue);
            padding: 3px 6px;
            color: #fff;
            font-size: 6.8px;
            font-weight: 800;
            letter-spacing: 0.04em;
            line-height: 1;
            text-transform: uppercase;
          }

          .classic-pdf-price-value {
            color: var(--ink);
            font-weight: 800;
            text-align: right;
          }

          .classic-pdf-table-end {
            height: 10px;
            border-radius: 0 0 16px 16px;
            background: linear-gradient(135deg, var(--brand-blue), var(--brand-blue-dark));
          }

          .classic-pdf-bottom {
            display: grid;
            grid-template-columns: minmax(0, 1fr) 238px;
            gap: 18px;
            margin-top: 14px;
            align-items: start;
          }

          .classic-pdf-terms {
            padding: 4px 0 0 var(--content-left-align);
            color: #475467;
            font-size: 7.2px;
            line-height: 1.3;
          }

          .classic-pdf-terms-title {
            margin-bottom: 4px;
            color: var(--brand-blue);
            font-size: 7.4px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .classic-pdf-summary {
            padding: 12px 14px;
            background: var(--glass-strong);
          }

          .classic-pdf-summary-title {
            color: var(--brand-blue);
            font-size: 8px;
            font-weight: 800;
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .classic-pdf-summary-lines {
            display: grid;
            gap: 5px;
            margin-top: 8px;
            font-size: 10px;
          }

          .classic-pdf-summary-line {
            display: flex;
            justify-content: space-between;
            gap: 14px;
          }

          .classic-pdf-summary-line span:first-child {
            color: #000;
          }

          .classic-pdf-summary-line span:last-child {
            font-weight: 800;
          }

          .classic-pdf-summary-total {
            margin-top: 2px;
            border-top: 1px solid rgba(7, 132, 195, 0.22);
            padding-top: 7px;
            color: var(--ink);
            font-size: 12px;
            font-weight: 800;
          }

          @media print {
            body {
              background: #fff !important;
            }

            .classic-offer-pdf-document {
              width: ${OFFER_PDF_TEMPLATE.printWidthMm}mm;
              height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              background-size: ${OFFER_PDF_TEMPLATE.printWidthMm}mm ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              overflow: hidden;
            }

            .classic-offer-pdf-content {
              height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              padding: 11mm 14mm 54mm;
            }

            .classic-offer-pdf-content.continuation {
              padding-top: 28mm;
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

      {mobilePreview ? <OfferPdfMobilePreviewControls backHref={mobileBackHref ?? `/offers/${offer.id}`} /> : null}

      <main className={mobilePreview ? 'offer-pdf-mobile-preview bg-zinc-100 px-3 pb-5 pt-20 text-gray-950 print:bg-white print:p-0' : isStandalone ? 'bg-white text-gray-950' : 'min-h-screen bg-zinc-100 px-4 py-6 text-gray-950 print:bg-white print:px-0 print:py-0'}>
        {tablePages.map((page) => (
          <article
            key={page.key}
            className="classic-offer-pdf-document mx-auto shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:shadow-none"
          >
            <div className={`classic-offer-pdf-content${page.isContinuation ? ' continuation' : ''}`}>
              {page.showTop ? (
                <section className="classic-pdf-top">
                  <div className="classic-pdf-left-start">
                    <div className="classic-pdf-left-stack">
                      <div className="classic-pdf-card classic-pdf-client-card">
                        <div className="classic-pdf-card-title">Klient</div>
                        <div className="classic-pdf-card-primary">{client.name}</div>
                        {client.ico ? <div className="classic-pdf-card-text">IČO: {client.ico}</div> : null}
                        {client.address ? <div className="classic-pdf-card-text">{client.address}</div> : null}
                        {offer.contact_person ? (
                          <div className="classic-pdf-card-text">Kontaktní osoba: {offer.contact_person}</div>
                        ) : null}
                      </div>

                      <div className="classic-pdf-card classic-pdf-address-card">
                        <div className="classic-pdf-card-title">Adresa realizace</div>
                        <div className="classic-pdf-card-primary classic-pdf-address-value">
                          {offer.realization_address || 'Adresa není vyplněná'}
                        </div>
                      </div>

                      <header className="classic-pdf-intro">
                        <div className="classic-pdf-eyebrow">
                          Cenová kalkulace zajištění záložního napájení pro projekt:
                        </div>
                        <h1 className="classic-pdf-project-name">{offer.title}</h1>
                        <div className="classic-pdf-realization-term">
                          {formatRealizationTerm(offer.realization_starts_at, offer.realization_ends_at)}
                        </div>
                      </header>
                    </div>
                  </div>

                  <aside className="classic-pdf-meta">
                    <div className="classic-pdf-offer-number">
                      <span className="classic-pdf-offer-number-label">Číslo nabídky</span>
                      <span className="classic-pdf-offer-number-value">{offer.offer_number}</span>
                    </div>
                    <div className="classic-pdf-type-badge">{OFFER_TYPE_LABEL}</div>
                    <div className="classic-pdf-card compact classic-pdf-prepared-card">
                      <div className="classic-pdf-prepared-head">
                        <div className="classic-pdf-card-title">Zpracoval</div>
                        <div className="classic-pdf-date-lines">
                          <div>Vystaveno {formatDate(offer.created_at)}</div>
                          <div>Platnost do {formatDate(offer.valid_until)}</div>
                        </div>
                      </div>
                      <div className="classic-pdf-card-primary">{preparedBy}</div>
                      {preparedByContact ? <div className="classic-pdf-card-text">{preparedByContact}</div> : null}
                    </div>
                    <div className="classic-pdf-card classic-pdf-service-card classic-pdf-service-summary">
                      <div className="classic-pdf-service-block">
                        <div className="classic-pdf-card-title">Objednané služby</div>
                        {services.length > 0 ? (
                          <div className="classic-pdf-chip-list">
                            {services.map((service) => (
                              <span key={service} className="classic-pdf-chip">{service}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="classic-pdf-empty-text">Bez vybraných služeb</div>
                        )}
                      </div>
                      <div className="classic-pdf-service-block">
                        <div className="classic-pdf-card-title">Depo</div>
                        {depots.length > 0 ? (
                          <div className="classic-pdf-chip-list">
                            {depots.map((depot) => (
                              <span key={depot} className="classic-pdf-chip classic-pdf-depot-chip">{depot}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="classic-pdf-empty-text">Bez vybraného depa</div>
                        )}
                      </div>
                    </div>
                  </aside>
                </section>
              ) : null}

              <section className="classic-pdf-items-section">
                <div className="classic-pdf-items-header">
                  <h2 className="classic-pdf-items-title">Kalkulace služby</h2>
                  <div className="classic-pdf-items-note">Ceny bez DPH</div>
                </div>

                <table className="classic-pdf-items-table">
                  <colgroup>
                    <col style={{ width: '25%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '7%' }} />
                    <col style={{ width: '22%' }} />
                  </colgroup>
                  <tbody>
                    {page.groups.length > 0 ? (
                      page.groups.map((group) => {
                        if (group.type === 'section') {
                          return (
                            <tr key={group.key} className="classic-pdf-section-row">
                              <td colSpan={6}>
                                <span className="classic-pdf-section-title">{group.title}</span>
                              </td>
                            </tr>
                          )
                        }

                        const visibleDiscountPercent = getVisibleDiscountPercent(group.item)

                        return (
                          <Fragment key={group.key}>
                            <tr className={group.note ? 'no-border-after' : undefined}>
                              <td className="classic-pdf-item-name">{group.item.description}</td>
                              <td className="classic-pdf-specification">{group.item.specification ?? ''}</td>
                              <td className="number">{formatCurrency(Number(group.item.unit_price_without_vat), offer.currency)}</td>
                              <td className="center">{group.item.unit}</td>
                              <td className="number">{Number(group.item.quantity).toLocaleString('cs-CZ')}</td>
                              <td>
                                <div className={`classic-pdf-price-cell${visibleDiscountPercent === null ? ' no-discount' : ''}`}>
                                  {visibleDiscountPercent !== null ? (
                                    <span className="classic-pdf-discount">
                                      SLEVA {formatPercent(visibleDiscountPercent)}%
                                    </span>
                                  ) : null}
                                  <span className="classic-pdf-price-value">
                                    {formatCurrency(getOfferItemNetTotal(group.item), offer.currency)}
                                  </span>
                                </div>
                              </td>
                            </tr>
                            {group.note ? (
                              <tr className="classic-pdf-section-note-row">
                                <td colSpan={6}>
                                  <span className="classic-pdf-section-note">{group.note}</span>
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
                {page.showTableEnd ? <div className="classic-pdf-table-end" /> : null}
              </section>

              {page.showBottom ? (
                <section className="classic-pdf-bottom">
                  <div className="classic-pdf-terms">
                    <div className="classic-pdf-terms-title">Obchodní podmínky</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{offer.terms_note ?? ''}</div>
                  </div>

                  <div className="classic-pdf-card classic-pdf-summary">
                    <div className="classic-pdf-summary-title">Cenový souhrn</div>
                    <div className="classic-pdf-summary-lines">
                      <div className="classic-pdf-summary-line">
                        <span>CENA BEZ DPH</span>
                        <span>{formatCurrency(totals.subtotalWithoutVat, offer.currency)}</span>
                      </div>
                      <div className="classic-pdf-summary-line">
                        <span>DPH 21%</span>
                        <span>{formatCurrency(totals.vatTotal, offer.currency)}</span>
                      </div>
                      <div className="classic-pdf-summary-line classic-pdf-summary-total">
                        <span>CELKEM S DPH</span>
                        <span>{formatCurrency(totals.totalWithVat, offer.currency)}</span>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>
          </article>
        ))}
      </main>
    </>
  )
}
