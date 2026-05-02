import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h, type ReactNode } from 'react'
import { NextResponse } from 'next/server'
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
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
}

type JobProtocolRow = {
  id: string
  job_number: string
  site_address: string | null
  company_name: string
  client_id: string | null
  start_at: string | null
  end_at: string | null
}

type ClientDetailsRow = {
  id: string
  name: string | null
  ico: string | null
  address: string | null
}

type HandoverProtocolRow = {
  id: string
  handover_title: string | null
  handover_place: string | null
  contact_person: string | null
  contact_phone: string | null
}

type PreviewData = {
  job: {
    id: string
    job_number: string
    company_name: string
    start_at: string | null
    end_at: string | null
  }
  client: {
    name: string
    ico: string | null
    address: string | null
  }
  protocol: {
    handover_title: string
    handover_place: string
    contact_person: string
    contact_phone: string
    devices: Array<{ device_name: string }>
    accessories: Array<{ item_name: string }>
  }
}

type ProtocolPageItem =
  | { kind: 'device'; data: { device_name: string }; units: number }
  | { kind: 'accessory'; data: { item_name: string }; units: number }

type ProtocolPageChunk = {
  devices: Array<{ device_name: string }>
  accessories: Array<{ item_name: string }>
}

const BLASTER_COMPANY = {
  name: 'Blaster Services s.r.o.',
  lines: ['Mělnická 109', '250 65 Líbeznice', 'Česká republika'],
}

const DEVICE_PAGE_UNITS = 3
const ACCESSORY_PAGE_UNITS = 1
const PAGE_WITH_SIGNATURE_CAPACITY = 6
const PAGE_WITHOUT_SIGNATURE_CAPACITY = 12

const logoPath = path.join(process.cwd(), 'public', 'logo-pp-black.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`
const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'PPArial',
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
    fontFamily: 'PPArial',
  },
  pageShell: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
  },
  content: {
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: 4,
  },
  logo: {
    width: 105,
    height: 18,
    objectFit: 'contain',
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
  },
  topGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
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
    justifyContent: 'flex-start',
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
    fontWeight: 500,
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
  companyLines: {
    marginTop: 4,
    flexGrow: 1,
  },
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
    fontWeight: 500,
  },
  childDivider: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e4e4e7',
  },
  tripleGrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  col: {
    flex: 1,
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
  firstCol: {
    flex: 1,
  },
  narrowCol: {
    width: 92,
  },
  rightText: {
    textAlign: 'right',
  },
  row: {
    flexDirection: 'row',
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  cell: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    fontSize: 9,
    lineHeight: 1.35,
  },
  deviceName: {
    fontSize: 10,
    fontWeight: 600,
  },
  deviceMeta: {
    marginTop: 3,
    fontSize: 8,
    lineHeight: 1.2,
    color: '#111827',
  },
  deviceMetaText: {
    fontSize: 8,
    lineHeight: 1.2,
    color: '#111827',
  },
  deviceMetaRow: {
    height: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceMetaRowLeft: {
    height: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  deviceMetaRowRight: {
    height: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  placeholderTop: {
    height: 15,
  },
  metaHeading: {
    fontSize: 7,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: 600,
    color: '#111827',
    textAlign: 'right',
  },
  accessoryUnit: {
    fontSize: 8,
    color: '#111827',
    textAlign: 'right',
    lineHeight: 1.2,
  },
  subtenantChoiceRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
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
  },
  subtenantStamp: {
    marginTop: 8,
    height: 42,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d4d4d8',
    borderRadius: 4,
  },
  signatures: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  signatureBox: {
    flex: 1,
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
  signatureField: {
    marginTop: 8,
  },
  signatureLabel: {
    fontSize: 8,
  },
  signatureLine: {
    marginTop: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#d4d4d8',
    height: 10,
  },
})

function formatJobDateRange(
  startAt: string | null | undefined,
  endAt: string | null | undefined
) {
  if (!startAt || !endAt) {
    return '—'
  }

  const formatter = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  })

  return `${formatter.format(new Date(startAt))} - ${formatter.format(
    new Date(endAt)
  )}`
}

function takePageChunk(items: ProtocolPageItem[], capacity: number) {
  const chunk: ProtocolPageItem[] = []
  let usedUnits = 0

  for (const item of items) {
    if (chunk.length > 0 && usedUnits + item.units > capacity) break
    chunk.push(item)
    usedUnits += item.units
  }

  return { chunk, rest: items.slice(chunk.length) }
}

function buildPages(data: PreviewData) {
  const items: ProtocolPageItem[] = [
    ...data.protocol.devices.map((device) => ({
      kind: 'device' as const,
      data: device,
      units: DEVICE_PAGE_UNITS,
    })),
    ...data.protocol.accessories.map((item) => ({
      kind: 'accessory' as const,
      data: item,
      units: ACCESSORY_PAGE_UNITS,
    })),
  ]

  const totalUnits = items.reduce((sum, item) => sum + item.units, 0)
  const pages: ProtocolPageChunk[] = []

  const toChunk = (chunkItems: ProtocolPageItem[]): ProtocolPageChunk => ({
    devices: chunkItems
      .filter(
        (item): item is Extract<ProtocolPageItem, { kind: 'device' }> =>
          item.kind === 'device'
      )
      .map((item) => item.data),
    accessories: chunkItems
      .filter(
        (item): item is Extract<ProtocolPageItem, { kind: 'accessory' }> =>
          item.kind === 'accessory'
      )
      .map((item) => item.data),
  })

  if (totalUnits <= PAGE_WITH_SIGNATURE_CAPACITY) return [toChunk(items)]

  let remainingItems = items
  while (remainingItems.length > 0) {
    const page = takePageChunk(remainingItems, PAGE_WITHOUT_SIGNATURE_CAPACITY)
    pages.push(toChunk(page.chunk))
    remainingItems = page.rest
  }

  return [...pages, { devices: [], accessories: [] }]
}

function companyBlock(
  title: string,
  lines: string[],
  children?: ReactNode,
  childSeparated = true
) {
  return h(
    View,
    { style: styles.whiteCard },
    h(Text, { style: styles.cardLabel }, title),
    h(
      View,
      { style: styles.companyLines },
      ...lines.map((line) =>
        h(Text, { key: `${title}-${line}`, style: styles.cardValue }, line)
      )
    ),
    children
      ? h(View, { style: childSeparated ? styles.childDivider : { marginTop: 10 } }, children)
      : null
  )
}

function subtenantSection() {
  return h(
    View,
    { style: styles.whiteCard },
    h(Text, { style: styles.cardLabel }, 'Napojení podnájemce / potvrzení'),
    h(
      View,
      { style: styles.subtenantChoiceRow },
      h(
        View,
        { style: styles.subtenantChoice },
        h(View, { style: styles.checkbox }),
        h(Text, { style: styles.cardLabelStrong }, 'ANO')
      ),
      h(
        View,
        { style: styles.subtenantChoice },
        h(View, { style: styles.checkbox }),
        h(Text, { style: styles.cardLabelStrong }, 'NE')
      )
    ),
    h(View, { style: styles.subtenantStamp })
  )
}

function signatureBlock(title: string, rows: string[]) {
  return h(
    View,
    { style: [styles.signatureBox, { minHeight: 150 }] },
    h(Text, { style: styles.signatureTitle }, title),
    ...rows.map((row) =>
      h(
        View,
        { key: `${title}-${row}`, style: styles.signatureField },
        h(Text, { style: styles.signatureLabel }, row),
        h(View, { style: styles.signatureLine })
      )
    )
  )
}

function deviceBlock(device: { device_name: string }, index: number) {
  return h(
    View,
    {
      key: `device-wrap-${index}-${device.device_name}`,
      style: [styles.tableWrap, { marginTop: index === 0 ? 5 : 8 }],
    },
    h(
      View,
      { style: styles.tableHeader },
      h(View, { style: styles.firstCol }, h(Text, { style: styles.tableHeaderCell }, 'Název / kód zařízení')),
      h(View, { style: styles.narrowCol }, h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'MTH start')),
      h(View, { style: styles.narrowCol }, h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'MTH konec'))
    ),
    h(
      View,
      { style: styles.row },
      h(
        View,
        { style: [styles.firstCol, styles.cell] },
        h(Text, { style: styles.deviceName }, device.device_name || '—'),
        h(
          View,
          { style: styles.deviceMeta },
          h(
            View,
            { style: styles.deviceMetaRowLeft },
            h(Text, { style: styles.deviceMetaText }, 'Stav paliva v nádrži')
          ),
          h(
            View,
            { style: styles.deviceMetaRowLeft },
            h(Text, { style: styles.deviceMetaText }, 'Připojovací kabel (sada)')
          )
        )
      ),
      h(
        View,
        { style: [styles.narrowCol, styles.cell] },
        h(
          View,
          { style: [styles.deviceMeta, { marginTop: 0 }] },
          h(View, { style: styles.deviceMetaRowRight }, h(Text, { style: styles.deviceMetaText }, '')),
          h(View, { style: styles.deviceMetaRowRight }, h(Text, { style: styles.deviceMetaText }, ''))
        )
      ),
      h(
        View,
        { style: [styles.narrowCol, styles.cell] },
        h(
          View,
          { style: [styles.deviceMeta, { marginTop: 0 }] },
          h(View, { style: styles.deviceMetaRowRight }, h(Text, { style: styles.deviceMetaText }, '')),
          h(View, { style: styles.deviceMetaRowRight }, h(Text, { style: styles.deviceMetaText }, ''))
        )
      )
    )
  )
}

function deviceTable(devices: Array<{ device_name: string }>) {
  return [
    h(Text, { key: 'devices-title', style: styles.sectionTitle }, 'Zařízení'),
    ...devices.map((device, index) => deviceBlock(device, index)),
  ]
}

function accessoriesTable(accessories: Array<{ item_name: string }>) {
  return [
    h(Text, { key: 'accessories-title', style: styles.sectionTitle }, 'Příslušenství'),
    h(
      View,
      { key: 'accessories-table', style: styles.tableWrap },
      h(
        View,
        { style: styles.tableHeader },
        h(View, { style: styles.firstCol }, h(Text, { style: styles.tableHeaderCell }, 'Název / kód příslušenství')),
        h(View, { style: styles.narrowCol }, h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'Převzato')),
        h(View, { style: styles.narrowCol }, h(Text, { style: [styles.tableHeaderCell, styles.rightText] }, 'Vráceno'))
      ),
      ...accessories.map((item, index) =>
        h(
          View,
          {
            key: `accessory-${index}-${item.item_name}`,
            style:
              index < accessories.length - 1 ? [styles.row, styles.rowBorder] : styles.row,
          },
          h(View, { style: [styles.firstCol, styles.cell] }, h(Text, null, item.item_name || '—')),
          h(View, { style: [styles.narrowCol, styles.cell] }, h(Text, { style: styles.accessoryUnit }, 'ks')),
          h(View, { style: [styles.narrowCol, styles.cell] }, h(Text, { style: styles.accessoryUnit }, 'ks'))
        )
      )
    ),
  ]
}

function sanitizePdfFilenamePart(value: string | null | undefined) {
  return (value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPpPdfTitle(data: Pick<PreviewData, 'job' | 'protocol'>) {
  const jobNumber = sanitizePdfFilenamePart(data.job.job_number)
  const jobName = sanitizePdfFilenamePart(data.protocol.handover_title)

  return [jobNumber, jobName].filter(Boolean).join(' - ') || 'Předávací protokol'
}

function getPdfContentDisposition(filename: string) {
  const fallbackFilename = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, "'")

  return `inline; filename="${fallbackFilename}.pdf"; filename*=UTF-8''${encodeURIComponent(`${filename}.pdf`)}`
}

function PPDocument({ data }: { data: PreviewData }) {
  const pages = buildPages(data)
  const clientLines = [
    data.client.name,
    data.client.address,
    data.client.ico ? `IČO: ${data.client.ico}` : null,
  ].filter(Boolean) as string[]

  const contactDetails = [data.protocol.contact_person.trim(), data.protocol.contact_phone.trim()]
    .filter(Boolean)
    .join(' / ')
  const jobDateRange = formatJobDateRange(data.job.start_at, data.job.end_at)

  return h(
    Document,
    { title: getPpPdfTitle(data) },
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
                      h(Text, { style: styles.cardValueStrong }, data.protocol.handover_title || '—')
                    ),
                    h(
                      View,
                      { style: [styles.card, { flex: 3 }] },
                      h(Text, { style: styles.cardLabelStrong }, 'Termín realizace'),
                      h(Text, { style: styles.cardValueStrongTight }, jobDateRange)
                    ),
                    h(
                      View,
                      { style: [styles.card, { flex: 1 }] },
                      h(Text, { style: styles.cardLabelStrong }, 'Číslo zakázky'),
                      h(Text, { style: styles.cardValueStrong }, data.job.job_number)
                    ),
                  ),
                  h(
                    View,
                    { key: 'triple-grid', style: styles.tripleGrid },
                    h(
                      View,
                      { style: styles.col },
                      companyBlock(
                        'Předávající',
                        [BLASTER_COMPANY.name, ...BLASTER_COMPANY.lines],
                        h(
                          View,
                          null,
                          h(
                            Text,
                            { style: [styles.inlineMetaValue, { marginTop: 2 }] },
                            'HOTLINE 24/7: 800 412 412'
                          )
                        ),
                        false
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
                          h(
                            Text,
                            { style: [styles.inlineMetaValue, { marginTop: 4 }] },
                            contactDetails || '—'
                          )
                        ),
                        false
                      )
                    ),
                    h(View, { style: styles.col }, subtenantSection())
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
                        h(Text, { style: styles.cardValue }, data.protocol.handover_place || '—')
                      )
                    )
                  ),
                ]
              : []),
            ...(page.devices.length > 0 ? deviceTable(page.devices) : []),
            ...(page.accessories.length > 0 ? accessoriesTable(page.accessories) : [])
          ),
          ...(isLastPage
            ? [
                h(
                  View,
                  {
                    key: 'signatures-block',
                    wrap: false,
                    style: { marginTop: 14 },
                  },
                  h(
                    View,
                    { style: styles.signatures },
                    signatureBlock('Realizace', [
                      'Datum a čas',
                      'Technik B-ENERGY',
                      'Podpis technika',
                    ]),
                    signatureBlock('Potvrzení', [
                      'Kontaktní osoba klienta',
                      'Podpis / razítko klienta',
                    ])
                  )
                ),
              ]
            : [])
        )
      )
    })
  )
}

async function getPreviewData(jobId: string): Promise<PreviewData | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs')
    .eq('id', user.id)
    .single()

  if (profileError || !(profile as ProfilePermissionRow | null)?.can_view_jobs) {
    return null
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, job_number, site_address, company_name, client_id, start_at, end_at')
    .eq('id', jobId)
    .single()

  if (jobError || !job) return null

  const typedJob = job as JobProtocolRow

  const { data: protocol } = await supabase
    .from('handover_protocols')
    .select('id, handover_title, handover_place, contact_person, contact_phone')
    .eq('job_id', typedJob.id)
    .maybeSingle()

  const typedProtocol = (protocol ?? null) as HandoverProtocolRow | null
  const protocolId = typedProtocol?.id ?? null

  const [devicesResponse, accessoriesResponse, clientResponse] = await Promise.all([
    protocolId
      ? supabase
          .from('handover_protocol_devices')
          .select('device_name')
          .eq('handover_protocol_id', protocolId)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    protocolId
      ? supabase
          .from('handover_protocol_accessories')
          .select('item_name')
          .eq('handover_protocol_id', protocolId)
          .order('sort_order', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    typedJob.client_id
      ? supabase
          .from('clients')
          .select('id, name, ico, address')
          .eq('id', typedJob.client_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (devicesResponse.error || accessoriesResponse.error || clientResponse.error) {
    return null
  }

  const client = (clientResponse.data ?? null) as ClientDetailsRow | null

  return {
    job: {
      id: typedJob.id,
      job_number: typedJob.job_number,
      company_name: typedJob.company_name,
      start_at: typedJob.start_at,
      end_at: typedJob.end_at,
    },
    client: {
      name: client?.name ?? typedJob.company_name,
      ico: client?.ico ?? null,
      address: client?.address ?? typedJob.site_address ?? null,
    },
    protocol: {
      handover_title: typedProtocol?.handover_title ?? '',
      handover_place: typedProtocol?.handover_place ?? typedJob.site_address ?? '',
      contact_person: typedProtocol?.contact_person ?? '',
      contact_phone: typedProtocol?.contact_phone ?? '',
      devices: ((devicesResponse.data ?? []) as Array<{ device_name: string | null }>).map(
        (item) => ({
          device_name: item.device_name ?? '',
        })
      ),
      accessories: ((accessoriesResponse.data ?? []) as Array<{ item_name: string | null }>).map(
        (item) => ({
          item_name: item.item_name ?? '',
        })
      ),
    },
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const previewData = await getPreviewData(id)

  if (!previewData) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst data předávacího protokolu.' },
      { status: 404 }
    )
  }

  try {
    const pdfTitle = getPpPdfTitle(previewData)
    const buffer = await renderToBuffer(PPDocument({ data: previewData }))
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': getPdfContentDisposition(pdfTitle),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('PP PDF generation failed', error)
    return NextResponse.json(
      { error: 'Nepodařilo se vygenerovat PDF předávacího protokolu.' },
      { status: 500 }
    )
  }
}
