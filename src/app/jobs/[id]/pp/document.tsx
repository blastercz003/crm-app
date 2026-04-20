import type {
  HandoverProtocolAccessoryInput,
  HandoverProtocolDeviceInput,
  HandoverProtocolPreviewData,
} from '@/app/jobs/handover-protocol-actions'

const BLASTER_COMPANY = {
  name: 'Blaster Services s.r.o.',
  lines: ['Mělnická 109', '250 65 Líbeznice', 'Česká republika'],
}

const DEVICE_PAGE_UNITS = 3
const ACCESSORY_PAGE_UNITS = 1
const PAGE_WITH_SIGNATURE_CAPACITY = 6
const PAGE_WITHOUT_SIGNATURE_CAPACITY = 12

type ProtocolPageItem =
  | { kind: 'device'; data: HandoverProtocolDeviceInput; units: number }
  | {
      kind: 'accessory'
      data: HandoverProtocolAccessoryInput
      units: number
    }

type ProtocolPageChunk = {
  devices: HandoverProtocolDeviceInput[]
  accessories: HandoverProtocolAccessoryInput[]
}

function takePageChunk(items: ProtocolPageItem[], capacity: number) {
  const chunk: ProtocolPageItem[] = []
  let usedUnits = 0

  for (const item of items) {
    if (chunk.length > 0 && usedUnits + item.units > capacity) {
      break
    }

    chunk.push(item)
    usedUnits += item.units
  }

  return {
    chunk,
    rest: items.slice(chunk.length),
  }
}

function paginateProtocolItems(
  devices: HandoverProtocolDeviceInput[],
  accessories: HandoverProtocolAccessoryInput[]
) {
  const items: ProtocolPageItem[] = [
    ...devices.map((device) => ({
      kind: 'device' as const,
      data: device,
      units: DEVICE_PAGE_UNITS,
    })),
    ...accessories.map((item) => ({
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
        (
          item
        ): item is Extract<ProtocolPageItem, { kind: 'accessory' }> =>
          item.kind === 'accessory'
      )
      .map((item) => item.data),
  })

  if (totalUnits <= PAGE_WITH_SIGNATURE_CAPACITY) {
    return [toChunk(items)]
  }

  let remainingItems = items
  while (remainingItems.length > 0) {
    const page = takePageChunk(remainingItems, PAGE_WITHOUT_SIGNATURE_CAPACITY)
    pages.push(toChunk(page.chunk))
    remainingItems = page.rest
  }

  return [...pages, { devices: [], accessories: [] }]
}

export function ProtocolPrintStyles() {
  return (
    <style>{`
      @page {
        size: A4 portrait;
        margin: 7mm;
      }

      @media print {
        html, body {
          width: 210mm;
          height: auto;
          background: #fff !important;
          color: #000 !important;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        [data-pp-document] {
          background: #fff !important;
          color: #000 !important;
          box-shadow: none !important;
          width: 196mm !important;
          height: 283mm !important;
          min-height: 283mm !important;
          box-sizing: border-box !important;
          display: flex !important;
          flex-direction: column !important;
          margin: 0 auto !important;
        }

        [data-pp-document],
        [data-pp-document] * {
          color: #000 !important;
          text-shadow: none !important;
        }

        [data-pp-document] .border-zinc-200,
        [data-pp-document] .border-zinc-300,
        [data-pp-document] .border-zinc-100 {
          border-color: #bdbdbd !important;
        }

        [data-pp-document] .bg-zinc-50 {
          background: #f8fafc !important;
        }

        [data-pp-document] .bg-zinc-100 {
          background: #f1f5f9 !important;
        }

        [data-pp-document] .bg-white {
          background: #fff !important;
        }
      }
    `}</style>
  )
}

function ValuePair({
  label,
  value,
  emphasized = false,
  className = '',
}: {
  label: string
  value: string | null | undefined
  emphasized?: boolean
  className?: string
}) {
  return (
    <div
      className={`flex min-h-[60px] flex-col justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 ${className}`}
    >
      <div
        className={`text-[9px] uppercase tracking-[0.12em] ${
          emphasized ? 'font-bold text-zinc-950' : 'font-semibold text-zinc-950'
        }`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-[13px] leading-5 text-zinc-950 ${
          emphasized ? 'font-bold' : 'font-medium'
        } ${label === 'Termín realizace' ? 'whitespace-nowrap' : ''}`}
      >
        {value?.trim() || '—'}
      </div>
    </div>
  )
}

function CompanyBlock({
  title,
  lines,
  children,
  childSeparated = true,
}: {
  title: string
  lines: string[]
  children?: React.ReactNode
  childSeparated?: boolean
}) {
  return (
    <section className="flex h-[136px] flex-col rounded-lg border border-zinc-200 bg-white px-3 py-3 print:h-[122px] print:px-2.5 print:py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950">
        {title}
      </div>
      <div className="mt-1.5 flex-1 space-y-0.5 text-[13px] leading-5 text-zinc-950">
        {lines.map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
      {children ? (
        <div
          className={`mt-3 print:mt-2 ${childSeparated ? 'border-t border-zinc-200 pt-2.5 print:pt-2' : ''}`}
        >
          {children}
        </div>
      ) : null}
    </section>
  )
}

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

function DeviceDescription() {
  return (
    <div className="mt-1.5 grid grid-rows-[16px_16px] text-[11px] leading-4 text-zinc-950">
      <div className="flex items-center">Stav paliva v nádrži</div>
      <div className="flex items-center">Připojovací kabel (sada)</div>
    </div>
  )
}

function DeviceValueColumn({
  firstRow,
  secondRow,
}: {
  firstRow?: string
  secondRow?: string
}) {
  return (
    <div className="mt-1.5 grid grid-rows-[16px_16px] text-right text-[11px] leading-4 text-zinc-950">
      <div className="flex items-center justify-end" />
      <div className="flex items-center justify-end" />
    </div>
  )
}

function AccessoryValueCell() {
  return <div className="text-[11px] leading-4 text-zinc-950">ks</div>
}

function ProtocolTableSection({
  title,
  headers,
  rows,
  rightAlignedColumns = [],
  renderCell,
}: {
  title: string
  headers: string[]
  rows: string[][]
  rightAlignedColumns?: number[]
  renderCell?: (params: {
    rowIndex: number
    cellIndex: number
    value: string
    row: string[]
  }) => React.ReactNode
}) {
  return (
    <section className="mt-4 print:mt-3">
      <h2 className="pl-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:pl-3">
        {title}
      </h2>

      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 print:mt-1.5">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
          </colgroup>
          <thead>
            <tr className="bg-zinc-100 text-left">
              {headers.map((header, headerIndex) => (
                <th
                  key={header}
                  className={`border-b border-zinc-200 px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:px-2.5 print:py-1.5 ${
                    rightAlignedColumns.includes(headerIndex) ? 'text-right' : ''
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.length > 0 ? (
              rows.map((row, rowIndex) => (
                <tr key={`${title}-${rowIndex}`} className="align-top">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${title}-${rowIndex}-${cellIndex}`}
                      className={`px-3 py-2 text-[13px] leading-5 text-zinc-900 print:px-2.5 print:py-1.5 print:text-[12px] print:leading-4 ${
                        rowIndex < rows.length - 1 ? 'border-b border-zinc-100' : ''
                      } ${rightAlignedColumns.includes(cellIndex) ? 'text-right' : ''}`}
                    >
                      {renderCell
                        ? renderCell({ rowIndex, cellIndex, value: cell, row })
                        : cell?.trim()
                          ? cell
                          : '\u00A0'}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-3 py-3 text-[13px] text-zinc-500"
                >
                  Bez záznamu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SubtenantSection() {
  return (
    <section className="flex h-[136px] flex-col rounded-lg border border-zinc-200 bg-white px-3 py-3 print:h-[122px] print:px-2.5 print:py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950">
        Podnájemce
      </div>
      <div className="mt-2 text-[13px] text-zinc-950">
        Napojení podnájemce / potvrzení
      </div>
      <div className="mt-2 flex gap-2">
        <div className="inline-flex h-[34px] flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-[12px] font-medium text-zinc-950">
          <span className="inline-block h-3.5 w-3.5 rounded-[3px] border border-zinc-400 bg-white" />
          <span>ANO</span>
        </div>
        <div className="inline-flex h-[34px] flex-1 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-zinc-50 px-2.5 py-1.5 text-[12px] font-medium text-zinc-950">
          <span className="inline-block h-3.5 w-3.5 rounded-[3px] border border-zinc-400 bg-white" />
          <span>NE</span>
        </div>
      </div>
      <div className="mt-3 h-12 rounded-md border border-dashed border-zinc-300 bg-white print:mt-2 print:h-11" />
    </section>
  )
}

function SignatureBlock({
  title,
  rows,
}: {
  title: string
  rows: string[]
}) {
  return (
    <div className="flex min-h-[158px] flex-1 flex-col rounded-lg border border-zinc-200 px-3 py-3 print:min-h-[142px] print:px-2.5 print:py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950">
        {title}
      </div>
      <div className="mt-3 flex-1 space-y-3 print:mt-2 print:space-y-2">
        {rows.map((row) => (
          <div key={row}>
            <div className="text-[11px] text-zinc-950">{row}</div>
            <div className="mt-1.5 border-b border-zinc-300 pb-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

function SignatureSection() {
  return (
    <section className="mt-6 break-inside-avoid-page break-inside-avoid grid gap-4 md:grid-cols-2 print:mt-4 print:gap-3">
      <SignatureBlock
        title="Realizace"
        rows={['Datum a čas', 'Technik B-ENERGY', 'Podpis technika']}
      />
      <SignatureBlock
        title="Potvrzení"
        rows={['Kontaktní osoba klienta', 'Podpis / razítko klienta']}
      />
    </section>
  )
}

function DeviceBlock({ device }: { device: HandoverProtocolDeviceInput }) {
  return (
    <section className="mt-2 overflow-hidden rounded-lg border border-zinc-200 first:mt-0">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
        </colgroup>
        <thead>
          <tr className="bg-zinc-100 text-left">
            <th className="border-b border-zinc-200 px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:px-2.5 print:py-1.5">
              Název / kód zařízení
            </th>
            <th className="border-b border-zinc-200 px-3 py-2 text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:px-2.5 print:py-1.5">
              MTH start
            </th>
            <th className="border-b border-zinc-200 px-3 py-2 text-right text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:px-2.5 print:py-1.5">
              MTH konec
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <td className="px-3 py-2 text-[13px] leading-5 text-zinc-950 print:px-2.5 print:py-1.5 print:text-[12px] print:leading-4">
              <div className="font-medium text-zinc-950">
                {device.device_name?.trim() || '—'}
              </div>
              <DeviceDescription />
            </td>
            <td className="px-3 py-2 text-right text-[13px] leading-5 text-zinc-950 print:px-2.5 print:py-1.5 print:text-[12px] print:leading-4">
              <DeviceValueColumn firstRow="%" />
            </td>
            <td className="px-3 py-2 text-right text-[13px] leading-5 text-zinc-950 print:px-2.5 print:py-1.5 print:text-[12px] print:leading-4">
              <DeviceValueColumn secondRow="ks" />
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function ProtocolHeader() {
  return (
    <section className="flex items-start justify-between gap-5 pb-2">
      <div className="shrink-0">
        <img src="/logo.png" alt="B-ENERGY" className="h-5 w-auto" />
      </div>

      <div className="text-right">
        <div className="text-xl font-semibold tracking-tight text-zinc-950">Předávací protokol</div>
      </div>
    </section>
  )
}

export function HandoverProtocolDocument({
  data,
  standalone = false,
}: {
  data: HandoverProtocolPreviewData
  standalone?: boolean
}) {
  const { job, client, protocol } = data
  const pages = paginateProtocolItems(protocol.devices, protocol.accessories)

  const clientLines = [
    client.name,
    client.address,
    client.ico ? `IČO: ${client.ico}` : null,
  ].filter((line): line is string => Boolean(line && line.trim()))

  const contactDetails =
    [protocol.contact_person?.trim(), protocol.contact_phone?.trim()]
      .filter((value): value is string => Boolean(value))
      .join(' / ') || '—'
  const jobDateRange = formatJobDateRange(job.start_at, job.end_at)

  const mainClassName = standalone
    ? 'min-h-screen bg-white px-0 py-0 text-zinc-900 print:bg-white print:px-0 print:py-0'
    : 'min-h-screen bg-zinc-100 px-4 py-6 text-zinc-900 print:bg-white print:px-0 print:py-0'

  return (
    <main className={mainClassName}>
      <ProtocolPrintStyles />
      <div className="mx-auto" style={{ maxWidth: '860px' }}>
        <div className="space-y-6 print:space-y-0">
          {pages.map((page, pageIndex) => {
            const isFirstPage = pageIndex === 0
            const isLastPage = pageIndex === pages.length - 1

            return (
              <article
                data-pp-document="true"
                className={`mx-auto flex min-h-[1122px] flex-col bg-white px-8 py-7 shadow-[0_18px_60px_rgba(15,23,42,0.12)] print:min-h-0 print:max-w-none print:px-4 print:pt-4 print:pb-2 print:shadow-none ${
                  pageIndex > 0 ? 'print:break-before-page' : ''
                }`}
                style={{ width: '794px', maxWidth: '100%' }}
                key={`pp-page-${pageIndex}`}
              >
                {isFirstPage ? <ProtocolHeader /> : null}

                <div className="flex flex-1 flex-col justify-between">
                  <div>
                    {isFirstPage ? (
                      <>
                        <section className="mt-4 grid grid-cols-6 gap-2">
                          <ValuePair
                            label="Název zakázky"
                            value={protocol.handover_title}
                            emphasized
                            className="col-span-2"
                          />
                          <ValuePair
                            label="Termín realizace"
                            value={jobDateRange}
                            emphasized
                            className="col-span-3"
                          />
                          <ValuePair
                            label="Číslo zakázky"
                            value={job.job_number}
                            emphasized
                            className="col-span-1"
                          />
                        </section>

                        <section className="mt-4 grid gap-3 md:grid-cols-3">
                          <CompanyBlock
                            title="Předávající"
                            lines={[BLASTER_COMPANY.name, ...BLASTER_COMPANY.lines]}
                            childSeparated={false}
                          >
                            <div className="mt-0.5 text-[13px] leading-5 text-zinc-950">
                              HOTLINE 24/7: 800 412 412
                            </div>
                          </CompanyBlock>
                          <CompanyBlock
                            title="Přejímající"
                            lines={clientLines}
                            childSeparated={false}
                          >
                            <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-950">
                              Kontaktní osoba / Telefon
                            </div>
                            <div className="mt-1 text-[13px] leading-5 text-zinc-950">
                              {contactDetails}
                            </div>
                          </CompanyBlock>
                          <SubtenantSection />
                        </section>

                        <section className="mt-4 grid gap-2 md:grid-cols-3">
                          <div className="hidden md:block" />
                          <div className="hidden md:block" />
                          <ValuePair
                            label="Místo realizace"
                            value={protocol.handover_place}
                          />
                        </section>
                      </>
                    ) : null}

                    {page.devices.length > 0 ? (
                      <section className="mt-4 print:mt-3">
                        <h2 className="pl-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-950 print:pl-2.5">
                          Zařízení
                        </h2>
                        <div className="mt-2 space-y-2 print:mt-1.5">
                          {page.devices.map((device, index) => (
                            <DeviceBlock key={`${device.device_name}-${index}`} device={device} />
                          ))}
                        </div>
                      </section>
                    ) : null}

                    {page.accessories.length > 0 ? (
                      <ProtocolTableSection
                        title="Příslušenství"
                        headers={['Název / kód příslušenství', 'Převzato', 'Vráceno']}
                        rows={page.accessories.map((item) => [
                          item.item_name,
                          '',
                          '',
                        ])}
                        rightAlignedColumns={[1, 2]}
                        renderCell={({ cellIndex, value }) => {
                          if (cellIndex === 1 || cellIndex === 2) {
                            return <AccessoryValueCell />
                          }

                          return value?.trim() || '—'
                        }}
                      />
                    ) : null}
                  </div>

                  {isLastPage ? (
                    <div className="pt-4">
                      <SignatureSection />
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </main>
  )
}
