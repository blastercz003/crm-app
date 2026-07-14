import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, type ReactElement } from 'react'
import { NextResponse } from 'next/server'
import {
  Document,
  type DocumentProps,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import {
  getProvizePayoutDraftPreviewAction,
  type ProvizePayoutDraftData,
} from '@/app/provize/payout-actions'

export const runtime = 'nodejs'

const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'ProvizeArialDraft',
  fonts: [
    { src: arialRegularPath, fontWeight: 400 },
    { src: arialBoldPath, fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 24,
    fontSize: 10,
    color: '#111827',
    fontFamily: 'ProvizeArialDraft',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  logo: {
    width: 120,
    height: 24,
    objectFit: 'contain',
  },
  titleWrap: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 10,
    color: '#4b5563',
  },
  summaryBox: {
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#f8fbfe',
    marginBottom: 14,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  summaryMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexGrow: 1,
    width: '60%',
    rowGap: 8,
    columnGap: 8,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 8,
  },
  summaryItem: {
    width: '48%',
    minHeight: 54,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  label: {
    fontSize: 6.4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: '#6b7280',
  },
  value: {
    marginTop: 3,
    fontSize: 10,
    fontWeight: 700,
    color: '#111827',
  },
  summaryPrimary: {
    width: '40%',
    borderRadius: 10,
    backgroundColor: '#e8f1fb',
    borderWidth: 1,
    borderColor: '#bfd5ea',
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
    minHeight: 116,
  },
  summaryPrimaryLabel: {
    fontSize: 7.2,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#225f8a',
    fontWeight: 700,
  },
  summaryPrimaryValue: {
    marginTop: 6,
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
  },
  summaryPrimaryHint: {
    marginTop: 4,
    fontSize: 7.4,
    color: '#4b5563',
  },
  section: {
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    color: '#225f8a',
  },
  adjustmentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingVertical: 5,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#eef5fb',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderBottomWidth: 0,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontSize: 8,
    textTransform: 'uppercase',
    color: '#4b5563',
    fontWeight: 700,
  },
  tableRow: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#dbe4ee',
    borderTopWidth: 0,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  colJob: { width: '14%' },
  colCompany: { width: '38%' },
  colInvoice: { width: '14%' },
  colProfit: { width: '16%', textAlign: 'right' },
  colCommission: { width: '18%', textAlign: 'right' },
  rowText: {
    fontSize: 9,
    color: '#111827',
  },
  footerNote: {
    marginTop: 16,
    fontSize: 8,
    color: '#6b7280',
    textAlign: 'right',
  },
})

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Prague',
  }).format(new Date(value))
}

function buildFileName(salesOwner: string, updatedAt: string) {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(updatedAt))

  const ownerPart = salesOwner
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

  return `provize-nahled-${ownerPart || 'obchodnik'}-${datePart}.pdf`
}

function chunkItems(draft: ProvizePayoutDraftData, size: number) {
  const chunks: typeof draft.items[] = []
  for (let index = 0; index < draft.items.length; index += size) {
    chunks.push(draft.items.slice(index, index + size))
  }
  return chunks
}

function DraftPreviewPdfDocument({ draft }: { draft: ProvizePayoutDraftData }) {
  const pages = chunkItems(draft, 14)

  return h(
    Document,
    null,
    ...pages.map((items, pageIndex) =>
      h(
        Page,
        { key: `${draft.batchId}-${pageIndex + 1}`, size: 'A4', style: styles.page },
        h(
          View,
          null,
          h(
            View,
            { style: styles.header },
            h(Image, { src: logoDataUri, style: styles.logo }),
            h(
              View,
              { style: styles.titleWrap },
              h(Text, { style: styles.title }, 'Náhled vyúčtování provizí'),
              h(
                Text,
                { style: styles.subtitle },
                `Obchodník: ${draft.salesOwner} | Aktualizováno: ${formatDateTime(draft.updatedAt)}`
              )
            )
          ),
          pageIndex === 0
            ? h(
                View,
                { style: styles.summaryBox },
                h(
                  View,
                  { style: styles.summaryTopRow },
                  h(
                    View,
                    { style: styles.summaryMetaGrid },
                    h(
                      View,
                      { style: styles.summaryGrid },
                      h(
                        View,
                        { style: styles.summaryItem },
                        h(Text, { style: styles.label }, 'Obchodník'),
                        h(Text, { style: styles.value }, draft.salesOwner)
                      ),
                      h(
                        View,
                        { style: styles.summaryItem },
                        h(Text, { style: styles.label }, 'Počet zakázek'),
                        h(Text, { style: styles.value }, String(draft.items.length))
                      ),
                      h(
                        View,
                        { style: styles.summaryItem },
                        h(Text, { style: styles.label }, 'Provize ze zakázek'),
                        h(Text, { style: styles.value }, formatCurrency(draft.commissionSubtotal))
                      ),
                      h(
                        View,
                        { style: styles.summaryItem },
                        h(Text, { style: styles.label }, 'Bonusy a odpočty'),
                        h(Text, { style: styles.value }, formatCurrency(draft.adjustmentTotal))
                      )
                    )
                  ),
                  h(
                    View,
                    { style: styles.summaryPrimary },
                    h(Text, { style: styles.summaryPrimaryLabel }, 'K finální výplatě'),
                    h(Text, { style: styles.summaryPrimaryValue }, formatCurrency(draft.payoutTotal)),
                    h(Text, { style: styles.summaryPrimaryHint }, 'Předpokládaná částka dle aktuálního draftu.')
                  )
                )
              )
            : null,
          pageIndex === 0
            ? h(
                View,
                { style: styles.section },
                h(Text, { style: styles.sectionTitle }, 'Bonusy a odpočty'),
                draft.adjustments.length === 0
                  ? h(Text, { style: styles.rowText }, 'Tento draft nemá žádné bonusy ani odpočty.')
                  : draft.adjustments.map((item) =>
                      h(
                        View,
                        { key: item.id, style: styles.adjustmentRow },
                        h(
                          Text,
                          { style: styles.rowText },
                          `${item.itemType === 'bonus' ? 'Bonus' : 'Odpočet'}: ${item.label}`
                        ),
                        h(
                          Text,
                          { style: styles.rowText },
                          `${item.itemType === 'bonus' ? '+' : '-'}${formatCurrency(item.amount)}`
                        )
                      )
                    )
              )
            : null,
          h(
            View,
            { style: styles.section },
            h(
              Text,
              { style: styles.sectionTitle },
              `Zakázky v dávce${pages.length > 1 ? ` - strana ${pageIndex + 1}/${pages.length}` : ''}`
            ),
            h(
              View,
              { style: styles.tableHeader },
              h(Text, { style: styles.colJob }, 'Zakázka'),
              h(Text, { style: styles.colCompany }, 'Firma'),
              h(Text, { style: styles.colInvoice }, 'Faktura'),
              h(Text, { style: styles.colProfit }, 'Zisk'),
              h(Text, { style: styles.colCommission }, 'Provize')
            ),
            ...items.map((item) =>
              h(
                View,
                { key: item.provizeRecordId, style: styles.tableRow },
                h(Text, { style: [styles.colJob, styles.rowText] }, item.jobNumber),
                h(Text, { style: [styles.colCompany, styles.rowText] }, item.companyName),
                h(Text, { style: [styles.colInvoice, styles.rowText] }, item.invoiceNumber),
                h(Text, { style: [styles.colProfit, styles.rowText] }, formatCurrency(item.profitAmount)),
                h(
                  Text,
                  { style: [styles.colCommission, styles.rowText] },
                  formatCurrency(item.commissionAmount)
                )
              )
            )
          ),
          h(
            Text,
            { style: styles.footerNote },
            `Náhled vygenerován ${formatDateTime(new Date().toISOString())}`
          )
        )
      )
    )
  )
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await context.params

  try {
    const result = await getProvizePayoutDraftPreviewAction(batchId)

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 403 })
    }

    const document = h(DraftPreviewPdfDocument, { draft: result.draft }) as ReactElement<DocumentProps>
    const buffer = await renderToBuffer(document)

    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${buildFileName(result.draft.salesOwner, result.draft.updatedAt)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/app/provize/drafty/[batchId]/pdf',
      section: 'provize',
      errorType: 'ProvizeDraftPreviewPdfError',
      userId: null,
      context: { batchId },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Draft PDF náhled se nepodařilo vygenerovat.' },
      { status: 500 }
    )
  }
}
