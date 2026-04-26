import {
  formatCurrency,
  getOfferItemNetTotal,
  getOfferTotals,
} from '@/lib/offers/calculations'
import {
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_SERVICE_PRESET_ALIASES,
  OFFER_SERVICE_PRESETS,
  OFFER_SERVICE_GROUP_LABEL,
} from '@/lib/offers/presets'
import { OFFER_PDF_TEMPLATE } from '@/lib/offers/pdf-template'
import type { OfferItemRow } from '@/lib/offers/types'
import { OfferPdfAutoPrint, OfferPdfToolbar } from './print-view'
import type { OfferPdfLayoutProps } from './offer-pdf-layout'

function formatDate(value: string | null) {
  if (!value) return 'Bez data'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
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

export function ClassicOfferPdf({
  offer,
  client,
  items,
  serviceItems,
  authorProfile,
  isStandalone,
  shouldAutoPrint,
}: OfferPdfLayoutProps) {
  const totals = getOfferTotals(items)
  const services = serviceItems.filter((item) => item.specification === OFFER_SERVICE_GROUP_LABEL)
  const depots = serviceItems.filter((item) => item.specification === OFFER_DEPOT_GROUP_LABEL)
  const selectedServices = new Set(
    services.map((item) => OFFER_SERVICE_PRESET_ALIASES[item.service_name] ?? item.service_name)
  )
  const preparedBy = offer.prepared_by_name ?? authorProfile?.name ?? 'Neuvedeno'

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
            width: ${OFFER_PDF_TEMPLATE.screenWidthPx}px;
            min-height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            background-image: url("${OFFER_PDF_TEMPLATE.backgroundUrl}");
            background-position: top center;
            background-repeat: repeat-y;
            background-size: ${OFFER_PDF_TEMPLATE.screenWidthPx}px ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            color: #111827;
            font-family: "Montserrat", Arial, sans-serif;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .classic-offer-pdf-content {
            min-height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            padding: 58px 56px 332px;
          }

          .classic-pdf-meta {
            display: flex;
            justify-content: flex-end;
          }

          .classic-pdf-meta-inner {
            width: 232px;
          }

          .classic-pdf-badge {
            display: flex;
            min-height: 58px;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            background: #2980b9;
            color: #fff;
            box-shadow: 0 10px 26px rgba(41, 128, 185, 0.18);
            text-align: center;
            text-transform: uppercase;
          }

          .classic-pdf-badge-label {
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.22em;
            line-height: 1;
          }

          .classic-pdf-badge-number {
            margin-top: 5px;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.16em;
            line-height: 1;
          }

          .classic-pdf-dates {
            margin-top: 8px;
            padding-right: 10px;
            text-align: right;
            font-size: 8.5px;
            font-weight: 700;
            letter-spacing: 0.1em;
            line-height: 1.65;
            color: #4b5563;
            text-transform: uppercase;
          }

          .classic-pdf-card {
            border: 1px solid rgba(41, 128, 185, 0.2);
            border-radius: 18px;
            background: #fff;
            box-shadow: 0 8px 22px rgba(41, 128, 185, 0.05);
          }

          .classic-pdf-prepared {
            margin-top: 8px;
            padding: 11px 13px;
          }

          .classic-pdf-section-label {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 8.5px;
            font-weight: 800;
            letter-spacing: 0.16em;
            line-height: 1;
            color: #2980b9;
            text-transform: uppercase;
          }

          .classic-pdf-dot {
            width: 8px;
            height: 8px;
            flex: 0 0 auto;
            border-radius: 999px;
            background: #2980b9;
          }

          .classic-pdf-title {
            margin-top: 42px;
            max-width: 610px;
            font-size: 10px;
            font-weight: 800;
            line-height: 1.25;
            color: #111827;
          }

          .classic-pdf-realization-term {
            display: inline-flex;
            margin-top: 16px;
            border-radius: 999px;
            background: #2980b9;
            padding: 10px 22px;
            color: #fff;
            font-size: 10px;
            font-weight: 800;
            box-shadow: 0 8px 20px rgba(41, 128, 185, 0.18);
          }

          .classic-pdf-info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 24px;
          }

          .classic-pdf-left-column,
          .classic-pdf-right-column {
            display: grid;
            gap: 12px;
          }

          .classic-pdf-info-card {
            padding: 14px;
          }

          .classic-pdf-card-primary {
            margin-top: 8px;
            font-size: 12px;
            font-weight: 800;
            line-height: 1.25;
            color: #111827;
          }

          .classic-pdf-card-text {
            margin-top: 6px;
            font-size: 10px;
            line-height: 1.45;
            color: #4b5563;
            white-space: pre-wrap;
          }

          .classic-pdf-service-card {
            min-height: 106px;
          }

          .classic-pdf-depot-card {
            min-height: 70px;
          }

          .classic-pdf-service-list {
            display: grid;
            gap: 4px;
            margin-top: 11px;
          }

          .classic-pdf-service-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            font-size: 8.2px;
            font-weight: 800;
            letter-spacing: 0.06em;
            line-height: 1;
            text-transform: uppercase;
          }

          .classic-pdf-service-switch {
            display: grid;
            grid-template-columns: 28px 28px;
            gap: 3px;
            flex: 0 0 auto;
          }

          .classic-pdf-service-switch-option {
            display: inline-flex;
            height: 16px;
            align-items: center;
            justify-content: center;
            border: 1px solid #e5e7eb;
            border-radius: 999px;
            background: #f3f4f6;
            color: #6b7280;
            font-size: 6.8px;
            font-weight: 800;
            line-height: 1;
          }

          .classic-pdf-service-switch-option.active {
            border-color: #2980b9;
            background: #2980b9;
            color: #fff;
          }

          .classic-pdf-items-section {
            margin-top: 28px;
          }

          .classic-pdf-items-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            border-radius: 18px 18px 0 0;
            background: #2980b9;
            padding: 12px 16px;
            color: #fff;
          }

          .classic-pdf-items-title {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.18em;
            line-height: 1;
            text-transform: uppercase;
          }

          .classic-pdf-items-prices {
            width: 142px;
            text-align: left;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: 0.1em;
            line-height: 1;
            color: rgba(255, 255, 255, 0.75);
            text-transform: uppercase;
          }

          .classic-pdf-items-table {
            width: 100%;
            border-collapse: collapse;
            background: #fff;
            font-size: 11px;
          }

          .classic-pdf-items-table th {
            border-right: 1px solid rgba(41, 128, 185, 0.15);
            border-bottom: 1px solid rgba(41, 128, 185, 0.15);
            background: rgba(41, 128, 185, 0.08);
            padding: 9px 8px;
            color: #2980b9;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: 0.12em;
            text-align: left;
            text-transform: uppercase;
          }

          .classic-pdf-items-table td {
            border-right: 1px solid rgba(41, 128, 185, 0.1);
            border-bottom: 1px solid rgba(41, 128, 185, 0.1);
            padding: 11px 8px;
            vertical-align: top;
          }

          .classic-pdf-items-table th:first-child,
          .classic-pdf-items-table td:first-child {
            border-left: 1px solid rgba(41, 128, 185, 0.1);
            padding-left: 16px;
          }

          .classic-pdf-items-table .number {
            text-align: right;
          }

          .classic-pdf-items-table .center {
            text-align: center;
          }

          .classic-pdf-item-name {
            font-weight: 800;
            color: #111827;
          }

          .classic-pdf-item-total {
            color: #2980b9;
            font-weight: 800;
            text-align: right;
          }

          .classic-pdf-bottom-grid {
            display: grid;
            grid-template-columns: 1fr 245px;
            gap: 20px;
            margin-top: 18px;
          }

          .classic-pdf-terms {
            max-width: 410px;
            color: #4b5563;
            font-size: 7.8px;
            line-height: 1.35;
          }

          .classic-pdf-terms-title {
            color: #374151;
            font-size: 7.5px;
            font-weight: 800;
            letter-spacing: 0.14em;
            text-transform: uppercase;
          }

          .classic-pdf-summary {
            border-color: #2980b9;
            padding: 16px;
            box-shadow: 0 14px 32px rgba(41, 128, 185, 0.14);
          }

          .classic-pdf-summary-title {
            color: #2980b9;
            font-size: 10px;
            font-weight: 800;
            letter-spacing: 0.18em;
            text-transform: uppercase;
          }

          .classic-pdf-summary-lines {
            margin-top: 12px;
            display: grid;
            gap: 8px;
            font-size: 12px;
          }

          .classic-pdf-summary-line {
            display: flex;
            justify-content: space-between;
            gap: 16px;
          }

          .classic-pdf-summary-line span:first-child {
            color: #6b7280;
          }

          .classic-pdf-summary-line span:last-child {
            font-weight: 800;
          }

          .classic-pdf-summary-total {
            margin-top: 4px;
            border-top: 1px solid rgba(41, 128, 185, 0.25);
            padding-top: 12px;
            color: #2980b9;
            font-size: 14px;
            font-weight: 800;
          }

          @media print {
            body {
              background: #fff !important;
            }

            .classic-offer-pdf-document {
              width: ${OFFER_PDF_TEMPLATE.printWidthMm}mm;
              min-height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              background-size: ${OFFER_PDF_TEMPLATE.printWidthMm}mm ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
            }

            .classic-offer-pdf-content {
              min-height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              padding: 15mm 15mm 88mm;
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
        <article className="classic-offer-pdf-document mx-auto shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:shadow-none">
          <div className="classic-offer-pdf-content">
            <div className="classic-pdf-meta">
              <div className="classic-pdf-meta-inner">
                <div className="classic-pdf-badge">
                  <span className="classic-pdf-badge-label">Cenová nabídka</span>
                  <span className="classic-pdf-badge-number">{offer.offer_number}</span>
                </div>
                <div className="classic-pdf-dates">
                  <div>Vystaveno {formatDate(offer.created_at)}</div>
                  <div>Platnost do {formatDate(offer.valid_until)}</div>
                </div>
                <div className="classic-pdf-card classic-pdf-prepared">
                  <div className="classic-pdf-section-label">Zpracoval</div>
                  <div className="classic-pdf-card-primary">{preparedBy}</div>
                  <div className="classic-pdf-card-text">
                    {offer.prepared_by_phone ? <span>{offer.prepared_by_phone}</span> : null}
                    {offer.prepared_by_phone && offer.prepared_by_email ? <span> / </span> : null}
                    {offer.prepared_by_email ? <span>{offer.prepared_by_email}</span> : null}
                  </div>
                </div>
              </div>
            </div>

            <header>
              <h1 className="classic-pdf-title">
                Cenová kalkulace zajištění záložního napájení {offer.title ? `(${offer.title})` : ''}
              </h1>
              <div className="classic-pdf-realization-term">
                Termín realizace: {formatDateTime(offer.realization_starts_at)}, {formatDateTime(offer.realization_ends_at)}
              </div>
            </header>

            <section className="classic-pdf-info-grid">
              <div className="classic-pdf-left-column">
                <div className="classic-pdf-card classic-pdf-info-card">
                  <div className="classic-pdf-section-label">
                    <span className="classic-pdf-dot" />
                    Klient
                  </div>
                  <div className="classic-pdf-card-primary">{client.name}</div>
                  {client.ico ? <div className="classic-pdf-card-text">IČO: {client.ico}</div> : null}
                  {client.address ? <div className="classic-pdf-card-text">{client.address}</div> : null}
                  {offer.contact_person ? (
                    <div className="classic-pdf-card-text">Kontaktní osoba: {offer.contact_person}</div>
                  ) : null}
                </div>

                <div className="classic-pdf-card classic-pdf-info-card">
                  <div className="classic-pdf-section-label">
                    <span className="classic-pdf-dot" />
                    Adresa realizace
                  </div>
                  <div className="classic-pdf-card-primary">
                    {offer.realization_address || 'Adresa není vyplněná'}
                  </div>
                </div>
              </div>

              <aside className="classic-pdf-right-column">
                <div className="classic-pdf-card classic-pdf-info-card classic-pdf-service-card">
                  <div className="classic-pdf-section-label">
                    <span className="classic-pdf-dot" />
                    Objednané služby
                  </div>
                  <div className="classic-pdf-service-list">
                    {OFFER_SERVICE_PRESETS.map((service) => {
                      const isActive = selectedServices.has(service)

                      return (
                        <div key={service} className="classic-pdf-service-row">
                          <span>{service}</span>
                          <span className="classic-pdf-service-switch">
                            <span className={`classic-pdf-service-switch-option${isActive ? ' active' : ''}`}>
                              ANO
                            </span>
                            <span className="classic-pdf-service-switch-option">NE</span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="classic-pdf-card classic-pdf-info-card classic-pdf-depot-card">
                  <div className="classic-pdf-section-label">
                    <span className="classic-pdf-dot" />
                    Depo
                  </div>
                  <div className="classic-pdf-card-primary">
                    {depots.length > 0 ? depots.map((item) => item.service_name).join(' / ') : 'Bez vybraného depa'}
                  </div>
                </div>
              </aside>
            </section>

            <section className="classic-pdf-items-section">
              <div className="classic-pdf-items-head">
                <h2 className="classic-pdf-items-title">Kalkulace služby</h2>
                <div className="classic-pdf-items-prices">Ceny bez DPH</div>
              </div>

              <table className="classic-pdf-items-table">
                <thead>
                  <tr>
                    <th style={{ width: '38%' }}>Položka</th>
                    <th className="number" style={{ width: '16%' }}>Jedn. cena</th>
                    <th className="center" style={{ width: '10%' }}>Jedn.</th>
                    <th className="number" style={{ width: '12%' }}>Množství</th>
                    <th className="number" style={{ width: '10%' }}>Sleva</th>
                    <th className="number" style={{ width: '14%' }}>Celkem</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length > 0 ? (
                    items.map((item) => {
                      const visibleDiscountPercent = getVisibleDiscountPercent(item)

                      return (
                        <tr key={item.id}>
                          <td className="classic-pdf-item-name">{item.description}</td>
                          <td className="number">{formatCurrency(Number(item.unit_price_without_vat), offer.currency)}</td>
                          <td className="center">{item.unit}</td>
                          <td className="number">{Number(item.quantity).toLocaleString('cs-CZ')}</td>
                          <td className="number">
                            {visibleDiscountPercent !== null ? `${formatPercent(visibleDiscountPercent)} %` : ''}
                          </td>
                          <td className="classic-pdf-item-total">
                            {formatCurrency(getOfferItemNetTotal(item), offer.currency)}
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>
                        Nabídka zatím nemá položky.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="classic-pdf-bottom-grid">
              {offer.terms_note ? (
                <div className="classic-pdf-terms">
                  <div className="classic-pdf-terms-title">Obchodní podmínky</div>
                  <p style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{offer.terms_note}</p>
                </div>
              ) : (
                <div />
              )}

              <div className="classic-pdf-card classic-pdf-summary">
                <div className="classic-pdf-summary-title">Souhrn cenové nabídky</div>
                <div className="classic-pdf-summary-lines">
                  <div className="classic-pdf-summary-line">
                    <span>Bez DPH</span>
                    <span>{formatCurrency(totals.subtotalWithoutVat, offer.currency)}</span>
                  </div>
                  <div className="classic-pdf-summary-line">
                    <span>DPH</span>
                    <span>{formatCurrency(totals.vatTotal, offer.currency)}</span>
                  </div>
                  <div className="classic-pdf-summary-line classic-pdf-summary-total">
                    <span>Celkem</span>
                    <span>{formatCurrency(totals.totalWithVat, offer.currency)}</span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </article>
      </main>
    </>
  )
} 
