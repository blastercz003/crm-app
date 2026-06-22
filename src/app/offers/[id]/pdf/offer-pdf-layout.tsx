import {
  formatCurrency,
  getOfferItemNetTotal,
  getOfferTotals,
} from '@/lib/offers/calculations'
import {
  OFFER_DEPOT_GROUP_LABEL,
  OFFER_SERVICE_GROUP_LABEL,
} from '@/lib/offers/presets'
import { OFFER_PDF_TEMPLATE } from '@/lib/offers/pdf-template'
import type {
  OfferClient,
  OfferItemRow,
  OfferProfile,
  OfferRow,
  OfferServiceItemRow,
} from '@/lib/offers/types'
import { OfferPdfAutoPrint, OfferPdfToolbar } from './print-view'

type OfferPdfPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ standalone?: string; print?: string }>
}

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

export type OfferPdfLayoutProps = {
  offer: OfferRow
  client: OfferClient
  items: OfferItemRow[]
  serviceItems: OfferServiceItemRow[]
  authorProfile: OfferProfile | null
  isStandalone: boolean
  shouldAutoPrint: boolean
}

export function OfferPdfLayout({
  offer,
  client,
  items,
  serviceItems,
  authorProfile,
  isStandalone,
  shouldAutoPrint,
}: OfferPdfLayoutProps) {
  const author = authorProfile ?? null
  const totals = getOfferTotals(items)
  const services = serviceItems.filter((item) => item.specification === OFFER_SERVICE_GROUP_LABEL)
  const depots = serviceItems.filter((item) => item.specification === OFFER_DEPOT_GROUP_LABEL)
  const hideStartupOverlayScript = `
    document.documentElement.setAttribute('data-startup-overlay', 'hide');
    try {
      sessionStorage.setItem('pwaStartupFinished', 'true');
      sessionStorage.setItem('pwaStartupActive', 'false');
    } catch (error) {}
  `

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: hideStartupOverlayScript }} />
      {shouldAutoPrint ? <OfferPdfAutoPrint /> : null}
      <style>
        {`
          @page {
            size: A4;
            margin: 0;
          }

          .offer-pdf-document {
            width: ${OFFER_PDF_TEMPLATE.screenWidthPx}px;
            min-height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            background-image: url("${OFFER_PDF_TEMPLATE.backgroundUrl}");
            background-position: top center;
            background-repeat: repeat-y;
            background-size: ${OFFER_PDF_TEMPLATE.screenWidthPx}px ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          .offer-pdf-content {
            min-height: ${OFFER_PDF_TEMPLATE.screenHeightPx}px;
            padding: ${OFFER_PDF_TEMPLATE.screenPadding};
          }

          @media print {
            body {
              background: #fff !important;
            }

            .offer-pdf-document {
              width: ${OFFER_PDF_TEMPLATE.printWidthMm}mm;
              min-height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              background-size: ${OFFER_PDF_TEMPLATE.printWidthMm}mm ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
            }

            .offer-pdf-content {
              min-height: ${OFFER_PDF_TEMPLATE.printHeightMm}mm;
              padding: ${OFFER_PDF_TEMPLATE.printPadding};
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
      <main className={isStandalone ? 'bg-white text-zinc-950' : 'min-h-screen bg-zinc-100 px-4 py-6 text-zinc-950 print:bg-white print:px-0 print:py-0'}>
        <article className="offer-pdf-document mx-auto shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:shadow-none">
          <div className="offer-pdf-content">
          <header className="flex items-start justify-between gap-6 border-b border-zinc-950 pb-5">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                Cenová nabídka
              </div>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                {offer.offer_number}
              </h1>
              <p className="mt-2 text-sm text-zinc-700">{offer.title}</p>
            </div>
            <div className="text-right text-xs leading-5 text-zinc-700">
              <div>Datum: {formatDate(offer.created_at)}</div>
              <div>Platnost: {formatDate(offer.valid_until)}</div>
              <div>Zpracoval: {offer.prepared_by_name ?? author?.name ?? 'Neuvedeno'}</div>
            </div>
          </header>

          <section className="mt-6 grid gap-4 text-sm md:grid-cols-2 print:grid-cols-2">
            <div className="rounded-lg border border-zinc-950 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Klient
              </div>
              <div className="mt-2 font-semibold">{client.name}</div>
              {client.ico ? <div className="mt-1 text-zinc-700">IČO: {client.ico}</div> : null}
              {client.address ? <div className="mt-1 whitespace-pre-wrap text-zinc-700">{client.address}</div> : null}
              {offer.contact_person ? <div className="mt-1 text-zinc-700">Kontakt: {offer.contact_person}</div> : null}
            </div>
            <div className="rounded-lg border border-zinc-950 p-4">
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Realizace
              </div>
              <div className="mt-2 whitespace-pre-wrap font-semibold">
                {offer.realization_address || 'Adresa není vyplněná'}
              </div>
              <div className="mt-2 text-zinc-700">Od: {formatDateTime(offer.realization_starts_at)}</div>
              <div className="text-zinc-700">Do: {formatDateTime(offer.realization_ends_at)}</div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em]">Služby a depo</h2>
            <div className="mt-2 grid gap-3 md:grid-cols-2 print:grid-cols-2">
              <div className="rounded-lg border border-zinc-300 p-3 text-sm">
                <div className="font-semibold">Služby</div>
                <div className="mt-2 text-zinc-700">
                  {services.length > 0 ? services.map((item) => item.service_name).join(', ') : 'Bez vybraných služeb'}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-300 p-3 text-sm">
                <div className="font-semibold">Depo</div>
                <div className="mt-2 text-zinc-700">
                  {depots.length > 0 ? depots.map((item) => item.service_name).join(', ') : 'Bez vybraného depa'}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em]">Položky nabídky</h2>
            <div className="mt-2 overflow-hidden rounded-lg border border-zinc-950">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-zinc-100 text-left text-[10px] font-bold uppercase tracking-[0.12em]">
                    <th className="px-3 py-2">Položka</th>
                    <th className="px-3 py-2">Specifikace</th>
                    <th className="px-3 py-2 text-right">Jedn. cena</th>
                    <th className="px-3 py-2 text-center">Jedn.</th>
                    <th className="px-3 py-2 text-right">Množství</th>
                    <th className="px-3 py-2 text-right">Cena bez DPH</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length > 0 ? (
                    items.map((item) => {
                      const visibleDiscountPercent = getVisibleDiscountPercent(item)

                      return (
                        <tr key={item.id} className="border-t border-zinc-300">
                          <td className="px-3 py-2 font-medium">{item.description}</td>
                          <td className="px-3 py-2 text-zinc-700">{item.specification ?? ''}</td>
                          <td className="px-3 py-2 text-right">
                            <div>{formatCurrency(Number(item.unit_price_without_vat), offer.currency)}</div>
                            {visibleDiscountPercent !== null ? (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-600">
                                Sleva {formatPercent(visibleDiscountPercent)} %
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-center">{item.unit}</td>
                          <td className="px-3 py-2 text-right">{Number(item.quantity).toLocaleString('cs-CZ')}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatCurrency(getOfferItemNetTotal(item), offer.currency)}</td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr className="border-t border-zinc-300">
                      <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                        Nabídka zatím nemá položky.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ml-auto mt-6 w-full max-w-[300px] rounded-lg border border-zinc-950 p-4 text-sm">
            <div className="flex justify-between gap-4">
              <span>Bez DPH</span>
              <span className="font-semibold">{formatCurrency(totals.subtotalWithoutVat, offer.currency)}</span>
            </div>
            <div className="mt-2 flex justify-between gap-4">
              <span>DPH</span>
              <span className="font-semibold">{formatCurrency(totals.vatTotal, offer.currency)}</span>
            </div>
            <div className="mt-3 flex justify-between gap-4 border-t border-zinc-950 pt-3 text-base font-bold">
              <span>Celkem</span>
              <span>{formatCurrency(totals.totalWithVat, offer.currency)}</span>
            </div>
          </section>

          {offer.terms_note ? (
            <section className="mt-6 text-xs leading-5 text-zinc-700">
              <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-zinc-950">
                Obchodní podmínky / poznámky
              </h2>
              <p className="mt-2 whitespace-pre-wrap">{offer.terms_note}</p>
            </section>
          ) : null}
          </div>
        </article>
      </main>
    </>
  )
}
