import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, type ReactNode } from 'react'
import {
  Document,
  Font,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import type { OperationalProtocolPdfData } from './types'

const ISSUER = {
  name: 'Blaster Services s.r.o.',
  lines: ['Mělnická 109', '250 65 Líbeznice', 'Česká republika'],
  hotline: 'HOTLINE 24/7: 800 412 412',
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const DEVICE_PAGE_UNITS = 3
const ACCESSORY_PAGE_UNITS = 1
const PAGE_WITH_SIGNATURE_CAPACITY = 6
const PAGE_WITHOUT_SIGNATURE_CAPACITY = 12

type PdfDevice = OperationalProtocolPdfData['devices'][number]
type PdfAccessory = OperationalProtocolPdfData['accessories'][number]
type PageItem =
  | { kind: 'device'; data: PdfDevice; units: number }
  | { kind: 'accessory'; data: PdfAccessory; units: number }

type PageChunk = {
  devices: PdfDevice[]
  accessories: PdfAccessory[]
}

const logoPath = path.join(process.cwd(), 'public', 'logo-pp-black.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'OperationalProtocolArial',
  fonts: [
    { src: arialRegularPath, fontWeight: 400 },
    { src: arialBoldPath, fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 20,
    paddingBottom: 14,
    paddingHorizontal: 16,
    fontSize: 10,
    color: '#111827',
    fontFamily: 'OperationalProtocolArial',
  },
  pageShell: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  content: { flexDirection: 'column' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 4,
  },
  logo: { width: 105, height: 18, objectFit: 'contain' },
  title: { fontSize: 16, fontWeight: 700 },
  topGrid: { flexDirection: 'row', gap: 6, marginTop: 10 },
  tripleGrid: { flexDirection: 'row', gap: 6, marginTop: 10 },
  col: { flex: 1 },
  card: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 6,
    backgroundColor: '#f8fafc',
    paddingVertical: 7,
    paddingHorizontal: 8,
    minHeight: 48,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  whiteCard: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 6,
    backgroundColor: '#ffffff',
    paddingVertical: 7,
    paddingHorizontal: 8,
    height: 124,
    flexDirection: 'column',
  },
  cardLabel: {
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#111827',
    fontWeight: 600,
  },
  cardLabelStrong: {
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#111827',
    fontWeight: 700,
  },
  cardValue: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 1.25,
    color: '#111827',
    fontWeight: 400,
  },
  cardValueStrong: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 1.25,
    color: '#111827',
    fontWeight: 700,
  },
  cardValueStrongTight: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 1.1,
    color: '#111827',
    fontWeight: 700,
  },
  companyLines: { marginTop: 4, flexGrow: 1 },
  inlineMetaLabel: {
    marginTop: 8,
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#111827',
    fontWeight: 600,
  },
  inlineMetaValue: {
    fontSize: 10,
    lineHeight: 1.35,
    color: '#111827',
    fontWeight: 400,
  },
  sectionTitle: {
    marginTop: 12,
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: 700,
    color: '#111827',
    paddingLeft: 12,
  },
  tableWrap: {
    marginTop: 5,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 6,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderBottomWidth: 1,
    borderBottomColor: '#d4d4d8',
  },
  tableHeaderCell: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: 600,
    color: '#111827',
  },
  firstCol: { flex: 1 },
  narrowCol: { width: 92 },
  rightText: { textAlign: 'right' },
  row: { flexDirection: 'row' },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#e4e4e7' },
  cell: { paddingVertical: 6, paddingHorizontal: 8, fontSize: 9, lineHeight: 1.35 },
  deviceName: { fontSize: 10, fontWeight: 600 },
  deviceMetaText: { fontSize: 8, lineHeight: 1.2, color: '#111827' },
  deviceValue: { fontSize: 9, lineHeight: 1.2, color: '#111827', textAlign: 'right' },
  deviceMetaRow: {
    height: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceMetaRowLeft: { justifyContent: 'flex-start' },
  deviceMetaRowRight: { justifyContent: 'flex-end' },
  subtenantChoiceRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  subtenantChoice: {
    flex: 1,
    height: 24,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 4,
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  checkbox: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderColor: '#a1a1aa',
    borderRadius: 2,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxMark: { fontSize: 7, lineHeight: 1, fontWeight: 700 },
  subtenantDetail: {
    marginTop: 8,
    minHeight: 42,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d4d4d8',
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  subtenantDetailLine: { fontSize: 8, lineHeight: 1.25, color: '#111827' },
  signatures: { flexDirection: 'row', gap: 8, marginTop: 14 },
  signatureBox: {
    flex: 1,
    minHeight: 150,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  signatureTitle: {
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: 600,
    color: '#111827',
  },
  signatureField: { marginTop: 8 },
  signatureLabel: { fontSize: 8 },
  signatureValue: {
    marginTop: 3,
    minHeight: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#d4d4d8',
    paddingBottom: 3,
    fontSize: 8.5,
    lineHeight: 1.2,
    color: '#111827',
  },
  digitalSignatureValue: { fontSize: 7.5, fontWeight: 700 },
})

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatDateTimeUppercase(value: string) {
  const date = new Date(value)
  const datePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${datePart} V ${timePart}`.toUpperCase()
}

function formatJobDateRange(startAt: string, endAt: string) {
  return `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`
}

function formatRealizationDateTime(value: string) {
  const date = new Date(value)
  const datePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
  }).format(date)
  const timePart = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${datePart} ${timePart}`
}

function formatRealizationDateRange(startAt: string, endAt: string) {
  return `${formatRealizationDateTime(startAt)} - ${formatRealizationDateTime(endAt)}`
}

function formatOptionalNumber(value: string | number | null) {
  if (value === null || value === '') return ''
  return String(value).replace('.', ',')
}

function toPageChunk(items: PageItem[]): PageChunk {
  return {
    devices: items
      .filter((item): item is Extract<PageItem, { kind: 'device' }> => item.kind === 'device')
      .map((item) => item.data),
    accessories: items
      .filter(
        (item): item is Extract<PageItem, { kind: 'accessory' }> =>
          item.kind === 'accessory'
      )
      .map((item) => item.data),
  }
}

function buildPages(data: OperationalProtocolPdfData) {
  const items: PageItem[] = [
    ...data.devices.map((device) => ({
      kind: 'device' as const,
      data: device,
      units: DEVICE_PAGE_UNITS,
    })),
    ...data.accessories.map((item) => ({
      kind: 'accessory' as const,
      data: item,
      units: ACCESSORY_PAGE_UNITS,
    })),
  ]

  const pages: PageChunk[] = []
  let remaining = items
  while (remaining.length > 0) {
    const remainingUnits = remaining.reduce((sum, item) => sum + item.units, 0)
    if (remainingUnits <= PAGE_WITH_SIGNATURE_CAPACITY) {
      pages.push(toPageChunk(remaining))
      return pages
    }

    const pageItems: PageItem[] = []
    let usedUnits = 0

    for (const item of remaining) {
      if (pageItems.length > 0 && usedUnits + item.units > PAGE_WITHOUT_SIGNATURE_CAPACITY) {
        break
      }

      pageItems.push(item)
      usedUnits += item.units

      if (remainingUnits - usedUnits <= PAGE_WITH_SIGNATURE_CAPACITY) break
    }

    pages.push(toPageChunk(pageItems))
    remaining = remaining.slice(pageItems.length)
  }

  return pages.length > 0 ? pages : [{ devices: [], accessories: [] }]
}

function companyBlock(title: string, lines: string[], children?: ReactNode) {
  return h(
    View,
    { style: styles.whiteCard },
    h(Text, { style: styles.cardLabel }, title),
    h(
      View,
      { style: styles.companyLines },
      ...lines.map((line, index) =>
        h(Text, { key: `${title}-${index}`, style: styles.cardValue }, line)
      )
    ),
    children ? h(View, { style: { marginTop: 10 } }, children) : null
  )
}

function subtenantSection(data: OperationalProtocolPdfData) {
  const detailLines = [data.subtenantName, data.subtenantNote].filter(
    (value): value is string => Boolean(value)
  )

  const choice = (label: 'ANO' | 'NE', selected: boolean) =>
    h(
      View,
      { style: styles.subtenantChoice },
      h(
        View,
        { style: styles.checkbox },
        selected ? h(Text, { style: styles.checkboxMark }, 'X') : null
      ),
      h(Text, { style: styles.cardLabelStrong }, label)
    )

  return h(
    View,
    { style: styles.whiteCard },
    h(Text, { style: styles.cardLabel }, 'Napojení podnájemce / potvrzení'),
    h(
      View,
      { style: styles.subtenantChoiceRow },
      choice('ANO', data.subtenantChoice === 'yes'),
      choice('NE', data.subtenantChoice === 'no')
    ),
    h(
      View,
      { style: styles.subtenantDetail },
      ...detailLines.map((line, index) =>
        h(Text, { key: `subtenant-${index}`, style: styles.subtenantDetailLine }, line)
      )
    )
  )
}

function signatureField(label: string, value = '', digital = false) {
  return h(
    View,
    { style: styles.signatureField },
    h(Text, { style: styles.signatureLabel }, label),
    h(
      Text,
      {
        style: digital
          ? [styles.signatureValue, styles.digitalSignatureValue]
          : styles.signatureValue,
      },
      value || ' '
    )
  )
}

function signatures(data: OperationalProtocolPdfData) {
  const digitalSignature = `DIGITÁLNĚ PODEPSÁNO DNE ${formatDateTimeUppercase(data.generatedAt)}: B-ENERGY`

  return h(
    View,
    { wrap: false, style: styles.signatures },
    h(
      View,
      { style: styles.signatureBox },
      h(Text, { style: styles.signatureTitle }, 'Realizace'),
      signatureField(
        'Datum a čas',
        formatRealizationDateRange(data.realizationAt, data.realizationCompletedAt)
      ),
      signatureField('Technik B-ENERGY', data.technicianName),
      signatureField('Podpis technika', digitalSignature, true)
    ),
    h(
      View,
      { style: styles.signatureBox },
      h(Text, { style: styles.signatureTitle }, 'Potvrzení'),
      signatureField('Kontaktní osoba klienta'),
      signatureField('Podpis / razítko klienta')
    )
  )
}

function deviceBlock(device: PdfDevice, index: number) {
  const fuelStart = formatOptionalNumber(device.fuelStartPercent)
  const fuelEnd = formatOptionalNumber(device.fuelEndPercent)

  return h(
    View,
    {
      key: `device-${index}-${device.deviceName}`,
      wrap: false,
      style: [styles.tableWrap, { marginTop: index === 0 ? 5 : 8 }],
    },
    h(
      View,
      { style: styles.tableHeader },
      h(
        View,
        { style: styles.firstCol },
        h(Text, { style: styles.tableHeaderCell }, 'Název / kód zařízení')
      ),
      h(
        View,
        { style: styles.narrowCol },
        h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'MTH start')
      ),
      h(
        View,
        { style: styles.narrowCol },
        h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'MTH konec')
      )
    ),
    h(
      View,
      { style: styles.row },
      h(
        View,
        { style: [styles.firstCol, styles.cell] },
        h(Text, { style: styles.deviceName }, device.deviceName),
        h(
          View,
          { style: [styles.deviceMetaRow, styles.deviceMetaRowLeft, { marginTop: 3 }] },
          h(Text, { style: styles.deviceMetaText }, 'Stav paliva v nádrži')
        )
      ),
      h(
        View,
        { style: [styles.narrowCol, styles.cell] },
        h(Text, { style: styles.deviceValue }, formatOptionalNumber(device.mthStart)),
        h(
          View,
          { style: [styles.deviceMetaRow, styles.deviceMetaRowRight, { marginTop: 3 }] },
          h(Text, { style: styles.deviceMetaText }, fuelStart ? `${fuelStart} %` : '')
        )
      ),
      h(
        View,
        { style: [styles.narrowCol, styles.cell] },
        h(Text, { style: styles.deviceValue }, formatOptionalNumber(device.mthEnd)),
        h(
          View,
          { style: [styles.deviceMetaRow, styles.deviceMetaRowRight, { marginTop: 3 }] },
          h(Text, { style: styles.deviceMetaText }, fuelEnd ? `${fuelEnd} %` : '')
        )
      )
    )
  )
}

function devicesSection(devices: PdfDevice[]) {
  return [
    h(Text, { key: 'devices-title', style: styles.sectionTitle }, 'Zařízení'),
    ...devices.map(deviceBlock),
  ]
}

function accessoriesSection(accessories: PdfAccessory[]) {
  return [
    h(Text, { key: 'accessories-title', style: styles.sectionTitle }, 'Příslušenství'),
    h(
      View,
      { key: 'accessories-table', style: styles.tableWrap },
      h(
        View,
        { style: styles.tableHeader },
        h(
          View,
          { style: styles.firstCol },
          h(Text, { style: styles.tableHeaderCell }, 'Název / kód příslušenství')
        ),
        h(
          View,
          { style: styles.narrowCol },
          h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'Převzato')
        ),
        h(
          View,
          { style: styles.narrowCol },
          h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'Vráceno')
        )
      ),
      ...accessories.map((item, index) =>
        h(
          View,
          {
            key: `accessory-${index}-${item.itemName}`,
            wrap: false,
            style: index < accessories.length - 1 ? [styles.row, styles.rowBorder] : styles.row,
          },
          h(
            View,
            { style: [styles.firstCol, styles.cell] },
            h(Text, null, item.itemName)
          ),
          h(View, { style: [styles.narrowCol, styles.cell] }, h(Text, null, ' ')),
          h(View, { style: [styles.narrowCol, styles.cell] }, h(Text, null, ' '))
        )
      )
    ),
  ]
}

export function OperationalProtocolPdfDocument({
  data,
}: {
  data: OperationalProtocolPdfData
}) {
  const pages = buildPages(data)
  const clientLines = [
    data.clientName,
    data.clientAddress,
    data.clientIco ? `IČO: ${data.clientIco}` : null,
  ].filter((value): value is string => Boolean(value))
  const contactDetails = [data.clientContactPerson, data.clientContactPhone]
    .filter((value): value is string => Boolean(value))
    .join(' / ')

  return h(
    Document,
    { title: getOperationalProtocolPdfTitle(data) },
    ...pages.map((page, pageIndex) => {
      const isFirstPage = pageIndex === 0
      const isLastPage = pageIndex === pages.length - 1

      return h(
        Page,
        { key: `page-${pageIndex}`, size: 'A4', style: styles.page },
        h(
          View,
          { style: styles.pageShell },
          h(
            View,
            { style: styles.content },
            ...(isFirstPage
              ? [
                  h(
                    View,
                    { key: 'header', style: styles.header },
                    h(Image, { src: logoDataUri, style: styles.logo }),
                    h(Text, { style: styles.title }, 'Předávací protokol')
                  ),
                  h(
                    View,
                    { key: 'top-grid', style: styles.topGrid },
                    h(
                      View,
                      { style: [styles.card, { flex: 2 }] },
                      h(Text, { style: styles.cardLabelStrong }, 'Název zakázky'),
                      h(Text, { style: styles.cardValueStrong }, data.jobTitle)
                    ),
                    h(
                      View,
                      { style: [styles.card, { flex: 3 }] },
                      h(Text, { style: styles.cardLabelStrong }, 'Termín realizace'),
                      h(
                        Text,
                        { style: styles.cardValueStrongTight },
                        formatJobDateRange(data.realizationStartAt, data.realizationEndAt)
                      )
                    ),
                    h(
                      View,
                      { style: [styles.card, { flex: 1 }] },
                      h(Text, { style: styles.cardLabelStrong }, 'Číslo zakázky'),
                      h(Text, { style: styles.cardValueStrong }, data.jobNumber || ' ')
                    )
                  ),
                  h(
                    View,
                    { key: 'triple-grid', style: styles.tripleGrid },
                    h(
                      View,
                      { style: styles.col },
                      companyBlock(
                        'Předávající',
                        [ISSUER.name, ...ISSUER.lines],
                        h(Text, { style: styles.inlineMetaValue }, ISSUER.hotline)
                      )
                    ),
                    h(
                      View,
                      { style: styles.col },
                      companyBlock(
                        'Přejímající',
                        clientLines,
                        h(
                          View,
                          null,
                          h(Text, { style: styles.inlineMetaLabel }, 'Kontaktní osoba / Telefon'),
                          h(Text, { style: styles.inlineMetaValue }, contactDetails || ' ')
                        )
                      )
                    ),
                    h(View, { style: styles.col }, subtenantSection(data))
                  ),
                  h(
                    View,
                    { key: 'place-row', style: styles.topGrid },
                    h(View, { style: { flex: 1 } }),
                    h(View, { style: { flex: 1 } }),
                    h(
                      View,
                      { style: { flex: 1 } },
                      h(
                        View,
                        { style: styles.card },
                        h(Text, { style: styles.cardLabel }, 'Místo realizace'),
                        h(Text, { style: styles.cardValue }, data.handoverPlace)
                      )
                    )
                  ),
                ]
              : []),
            ...(page.devices.length > 0 ? devicesSection(page.devices) : []),
            ...(page.accessories.length > 0 ? accessoriesSection(page.accessories) : [])
          ),
          ...(isLastPage ? [signatures(data)] : [])
        )
      )
    })
  )
}

export async function renderOperationalProtocolPdf(data: OperationalProtocolPdfData) {
  return renderToBuffer(OperationalProtocolPdfDocument({ data }))
}

function sanitizeFilenamePart(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatFilenameDate(value: string) {
  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function getOperationalProtocolPdfTitle(
  data: Pick<OperationalProtocolPdfData, 'jobNumber' | 'clientName' | 'generatedAt'>
) {
  const jobNumber = sanitizeFilenamePart(data.jobNumber)
  const clientName = sanitizeFilenamePart(data.clientName)
  const fallbackDate = formatFilenameDate(data.generatedAt)
  const identifier = jobNumber
    ? [jobNumber, clientName].filter(Boolean).join('-')
    : [clientName, fallbackDate].filter(Boolean).join('-')
  return `Predavaci-protokol-${identifier || fallbackDate}`
}

export function getOperationalProtocolPdfFileName(
  data: Pick<OperationalProtocolPdfData, 'jobNumber' | 'clientName' | 'generatedAt'>
) {
  return `${getOperationalProtocolPdfTitle(data)}.pdf`
}
