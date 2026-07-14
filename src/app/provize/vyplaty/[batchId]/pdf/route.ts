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
  getProvizeHistoryBatchById,
  requireProvizeHistoryAccess,
  type ProvizeHistoryBatch,
} from '@/lib/provize/history'

export const runtime = 'nodejs'

const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'ProvizeArial',
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
    fontFamily: 'ProvizeArial',
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
    padding: 12,
    backgroundColor: '#f8fbfe',
    marginBottom: 14,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  summaryItem: {
    width: '31%',
  },
  label: {
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#6b7280',
  },
  value: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: 700,
    color: '#111827',
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
  colJob: { width: '12%' },
  colCompany: { width: '28%' },
  colInvoice: { width: '14%' },
  colProfit: { width: '14%', textAlign: 'right' },
  colCommission: { width: '14%', textAlign: 'right' },
  colWhen: { width: '18%' },
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

function buildFileName(salesOwner: string, confirmedAt: string) {
  const datePart = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(confirmedAt))

  const ownerPart = salesOwner
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')

  return `provize-${ownerPart || 'obchodnik'}-${datePart}.pdf`
}

function chunkItems(batch: ProvizeHistoryBatch, size: number) {
  const chunks: typeof batch.items[] = []
  for (let index = 0; index < batch.items.length; index += size) {
    chunks.push(batch.items.slice(index, index + size))
  }
  return chunks
}

function ProvizeBatchPdfDocument({ batch }: { batch: ProvizeHistoryBatch }) {
  const pages = chunkItems(batch, 14)

  return h(
    Document,
    null,
    ...pages.map((items, pageIndex) =>
      h(
        Page,
        { key: `${batch.id}-${pageIndex + 1}`, size: 'A4', style: styles.page },
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
              h(Text, { style: styles.title }, 'Vyuctovani provizi'),
              h(
                Text,
                { style: styles.subtitle },
                `Obchodnik: ${batch.salesOwner} | Potvrzeno: ${formatDateTime(batch.confirmedAt)}`
              )
            )
          ),
          pageIndex === 0
            ? h(
                View,
                { style: styles.summaryBox },
                h(
                  View,
                  { style: styles.summaryGrid },
                  h(
                    View,
                    { style: styles.summaryItem },
                    h(Text, { style: styles.label }, 'Obchodnik'),
                    h(Text, { style: styles.value }, batch.salesOwner)
                  ),
                  h(
                    View,
                    { style: styles.summaryItem },
                    h(Text, { style: styles.label }, 'Pocet zakazek'),
                    h(Text, { style: styles.value }, String(batch.itemCount))
                  ),
                  h(
                    View,
                    { style: styles.summaryItem },
                    h(Text, { style: styles.label }, 'Provize ze zakazek'),
                    h(Text, { style: styles.value }, formatCurrency(batch.commissionSubtotal))
                  ),
                  h(
                    View,
                    { style: styles.summaryItem },
                    h(Text, { style: styles.label }, 'Bonusy a odpocty'),
                    h(Text, { style: styles.value }, formatCurrency(batch.adjustmentTotal))
                  ),
                  h(
                    View,
                    { style: styles.summaryItem },
                    h(Text, { style: styles.label }, 'Celkem vyplaceno'),
                    h(Text, { style: styles.value }, formatCurrency(batch.payoutTotal))
                  )
                )
              )
            : null,
          pageIndex === 0
            ? h(
                View,
                { style: styles.section },
                h(Text, { style: styles.sectionTitle }, 'Bonusy a odpocty'),
                batch.adjustments.length === 0
                  ? h(Text, { style: styles.rowText }, 'Tato davka nema zadne bonusy ani odpocty.')
                  : batch.adjustments.map((item) =>
                      h(
                        View,
                        { key: item.id, style: styles.adjustmentRow },
                        h(
                          Text,
                          { style: styles.rowText },
                          `${item.itemType === 'bonus' ? 'Bonus' : 'Odpocet'}: ${item.label}`
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
            h(Text, { style: styles.sectionTitle }, `Zakazky v davce${pages.length > 1 ? ` - strana ${pageIndex + 1}/${pages.length}` : ''}`),
            h(
              View,
              { style: styles.tableHeader },
              h(Text, { style: styles.colJob }, 'Zakazka'),
              h(Text, { style: styles.colCompany }, 'Firma'),
              h(Text, { style: styles.colInvoice }, 'Faktura'),
              h(Text, { style: styles.colProfit }, 'Zisk'),
              h(Text, { style: styles.colCommission }, 'Provize'),
              h(Text, { style: styles.colWhen }, 'Termin')
            ),
            ...items.map((item) =>
              h(
                View,
                { key: item.id, style: styles.tableRow },
                h(Text, { style: [styles.colJob, styles.rowText] }, item.jobNumber),
                h(Text, { style: [styles.colCompany, styles.rowText] }, item.companyName),
                h(Text, { style: [styles.colInvoice, styles.rowText] }, item.invoiceNumber),
                h(Text, { style: [styles.colProfit, styles.rowText] }, formatCurrency(item.profitAmount)),
                h(
                  Text,
                  { style: [styles.colCommission, styles.rowText] },
                  formatCurrency(item.commissionAmount)
                ),
                h(
                  Text,
                  { style: [styles.colWhen, styles.rowText] },
                  `${formatDateTime(item.startAt)} - ${formatDateTime(item.endAt)}`
                )
              )
            )
          ),
          h(
            Text,
            { style: styles.footerNote },
            `Vygenerovano ${formatDateTime(new Date().toISOString())}`
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
    const access = await requireProvizeHistoryAccess()

    if (!access.success) {
      return NextResponse.json({ error: access.error }, { status: 403 })
    }

    const batch = await getProvizeHistoryBatchById(access, batchId)
    const document = h(ProvizeBatchPdfDocument, { batch }) as ReactElement<DocumentProps>
    const buffer = await renderToBuffer(document)

    return new NextResponse(buffer as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${buildFileName(batch.salesOwner, batch.confirmedAt)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const access = await requireProvizeHistoryAccess().catch(() => null)
    await reportRouteError({
      error,
      route: '/app/provize/vyplaty/[batchId]/pdf',
      section: 'provize',
      errorType: 'ProvizeBatchPdfError',
      userId: access && access.success ? access.userId : null,
      context: { batchId },
    })

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'PDF dávky se nepodařilo vygenerovat.' },
      { status: 500 }
    )
  }
}
