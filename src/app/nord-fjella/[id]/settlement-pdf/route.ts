import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
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
import { canViewNordFjellaSection } from '@/lib/nord-fjella/access'
import { buildNordFjellaSpdQrPayload } from '@/lib/nord-fjella/payment-qr'
import { getNordFjellaProviderSettingsIssues } from '@/lib/nord-fjella/settings-validation'
import { buildNordFjellaSettlementSummary } from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaSettingsRow,
} from '@/lib/nord-fjella/types'
import { createClient } from '@/lib/supabase/server'
import QRCode from 'qrcode'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

type ProfilePermissionRow = {
  role: string | null
  can_view_nord_fjella: boolean | null
}

const arialRegularPath = path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf')
const arialBoldPath = path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf')

Font.register({
  family: 'NordFjellaArial',
  fonts: [
    { src: arialRegularPath, fontWeight: 400 },
    { src: arialBoldPath, fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: {
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 28,
    fontSize: 10,
    color: '#111827',
    fontFamily: 'NordFjellaArial',
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 18,
  },
  logoWrap: {
    width: 148,
    height: 54,
    justifyContent: 'center',
  },
  logo: {
    width: 148,
    height: 54,
    objectFit: 'contain',
  },
  headingBlock: {
    alignItems: 'flex-end',
    flexShrink: 1,
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
  grid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  col: {
    flex: 1,
  },
  card: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  cardTitle: {
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#6b7280',
    fontWeight: 700,
    marginBottom: 6,
  },
  cardLine: {
    fontSize: 10,
    lineHeight: 1.35,
    color: '#111827',
    marginTop: 2,
  },
  cardLineStrong: {
    fontSize: 10,
    lineHeight: 1.35,
    color: '#111827',
    fontWeight: 700,
    marginTop: 2,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f4f4f5',
    borderBottomWidth: 1,
    borderBottomColor: '#d4d4d8',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  cellLabel: {
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#6b7280',
    fontWeight: 700,
  },
  cellText: {
    fontSize: 9,
    color: '#111827',
  },
  cellTextStrong: {
    fontSize: 9,
    color: '#111827',
    fontWeight: 700,
  },
  wName: { width: '34%' },
  wQty: { width: '11%', textAlign: 'right', paddingRight: 8 },
  wUnit: { width: '12%', paddingLeft: 10 },
  wPrice: { width: '15%', textAlign: 'right', paddingRight: 8 },
  wVat: { width: '11%', paddingLeft: 10 },
  wTotal: { width: '18%', textAlign: 'right' },
  summaryWrap: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 12,
  },
  summaryCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    backgroundColor: '#fafafa',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 5,
  },
  summaryLabel: {
    fontSize: 9,
    color: '#4b5563',
  },
  summaryValue: {
    fontSize: 9,
    color: '#111827',
    fontWeight: 700,
  },
  summaryDivider: {
    height: 1,
    backgroundColor: '#e4e4e7',
    marginTop: 8,
    marginBottom: 2,
  },
  noteBox: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    backgroundColor: '#fafafa',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  footer: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e4e4e7',
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerText: {
    fontSize: 8,
    color: '#6b7280',
  },
  qrCard: {
    width: 138,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRadius: 8,
    backgroundColor: '#fafafa',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  qrImageWrap: {
    width: 104,
    height: 104,
    alignSelf: 'center',
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    padding: 6,
  },
  qrImage: {
    width: 92,
    height: 92,
    objectFit: 'contain',
  },
})

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)))
}

function sanitizePdfFilenamePart(value: string | null | undefined) {
  return (value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function getPdfContentDisposition(filename: string) {
  const fallbackFilename = filename
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, "'")

  return `attachment; filename="${fallbackFilename}.pdf"; filename*=UTF-8''${encodeURIComponent(`${filename}.pdf`)}`
}

function getGuestLabel(row: NordFjellaReservationRow) {
  if (row.guest_company_name?.trim()) return row.guest_company_name
  if (row.guest_full_name?.trim()) return row.guest_full_name
  return 'Bez hosta'
}

function getVatModeLabel(vatMode: string) {
  switch (vatMode) {
    case 'vat_12':
      return '12 %'
    case 'vat_21':
      return '21 %'
    default:
      return '0 %'
  }
}

function resolveLocalImageDataUri(relativePath: string) {
  const localPath = path.join(process.cwd(), 'public', relativePath.replace(/^\/+/, ''))

  if (!existsSync(localPath)) {
    return null
  }

  const extension = path.extname(localPath).toLowerCase()
  const mimeType =
    extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/png'

  return `data:${mimeType};base64,${readFileSync(localPath).toString('base64')}`
}

function resolveSettlementLogo() {
  return resolveLocalImageDataUri('/nord-fjella-logo-light.png')
}

function SettlementDocument({
  reservation,
  reservationItems,
  settings,
  qrCodeDataUrl,
}: {
  reservation: NordFjellaReservationRow
  reservationItems: NordFjellaReservationItemRow[]
  settings: NordFjellaSettingsRow | null
  qrCodeDataUrl: string | null
}) {
  const summary = buildNordFjellaSettlementSummary(reservation, reservationItems)
  const logoSrc = resolveSettlementLogo()
  const objectName = settings?.object_name?.trim() || 'Nord Fjella'
  const providerName = settings?.provider_company_name?.trim() || 'Nenastaveno'
  const guestLabel = getGuestLabel(reservation)
  const providerAddress = [
    settings?.provider_street?.trim(),
    [settings?.provider_postal_code?.trim(), settings?.provider_city?.trim()].filter(Boolean).join(' '),
    settings?.provider_country?.trim(),
  ].filter(Boolean)

  return h(
    Document,
    {
      title:
        [sanitizePdfFilenamePart(reservation.reservation_number), sanitizePdfFilenamePart(guestLabel)]
          .filter(Boolean)
          .join(' - ') || 'Vyúčtování pobytu',
    },
    h(
      Page,
      { size: 'A4', style: styles.page },
      h(
        View,
        { style: styles.header },
        h(View, { style: styles.logoWrap }, logoSrc ? h(Image, { src: logoSrc, style: styles.logo }) : null),
        h(
          View,
          { style: styles.headingBlock },
          h(Text, { style: styles.title }, 'Vyúčtování pobytu'),
          h(Text, { style: styles.subtitle }, `${objectName} • ${reservation.reservation_number}`),
          h(Text, { style: styles.subtitle }, `Vystaveno z aktuálních dat rezervace dne ${formatDate(new Date().toISOString().slice(0, 10))}`)
        )
      ),
      h(
        View,
        { style: styles.grid },
        h(
          View,
          { style: styles.col },
          h(
            View,
            { style: styles.card },
            h(Text, { style: styles.cardTitle }, 'Poskytovatel'),
            h(Text, { style: styles.cardLineStrong }, providerName),
            ...providerAddress.map((line, index) => h(Text, { key: `provider-${index}`, style: styles.cardLine }, line)),
            h(Text, { style: styles.cardLine }, `IČO: ${settings?.provider_company_id_number?.trim() || '—'}`),
            h(Text, { style: styles.cardLine }, `DIČ: ${settings?.provider_vat_number?.trim() || '—'}`),
            h(Text, { style: styles.cardLine }, `E-mail: ${settings?.provider_email?.trim() || '—'}`),
            h(Text, { style: styles.cardLine }, `Telefon: ${settings?.provider_phone?.trim() || '—'}`)
          )
        ),
        h(
          View,
          { style: styles.col },
          h(
            View,
            { style: styles.card },
            h(Text, { style: styles.cardTitle }, 'Objednatel'),
            h(Text, { style: styles.cardLineStrong }, guestLabel),
            reservation.guest_contact_name
              ? h(Text, { style: styles.cardLine }, reservation.guest_contact_name)
              : null,
            reservation.guest_street ? h(Text, { style: styles.cardLine }, reservation.guest_street) : null,
            h(
              Text,
              { style: styles.cardLine },
              [reservation.guest_postal_code, reservation.guest_city].filter(Boolean).join(' ')
            ),
            reservation.guest_country ? h(Text, { style: styles.cardLine }, reservation.guest_country) : null,
            h(Text, { style: styles.cardLine }, `E-mail: ${reservation.guest_email || '—'}`),
            h(Text, { style: styles.cardLine }, `Telefon: ${reservation.guest_phone || '—'}`)
          )
        )
      ),
      h(
        View,
        { style: styles.grid },
        h(
          View,
          { style: styles.col },
          h(
            View,
            { style: styles.card },
            h(Text, { style: styles.cardTitle }, 'Pobyt'),
            h(Text, { style: styles.cardLine }, `Příjezd: ${formatDate(reservation.stay_start_date)}`),
            h(Text, { style: styles.cardLine }, `Odjezd: ${formatDate(reservation.stay_end_date)}`),
            h(Text, { style: styles.cardLine }, `Počet nocí: ${summary.nights}`),
            h(Text, { style: styles.cardLine }, `Osoby: ${reservation.adult_count} dosp. / ${reservation.child_count} dětí`)
          )
        ),
        h(
          View,
          { style: styles.col },
          h(
            View,
            { style: styles.card },
            h(Text, { style: styles.cardTitle }, 'Platba'),
            h(Text, { style: styles.cardLine }, `Variabilní symbol: ${reservation.variable_symbol}`),
            h(Text, { style: styles.cardLine }, `Účet: ${settings?.provider_bank_account?.trim() || '—'}`),
            h(Text, { style: styles.cardLine }, `IBAN: ${settings?.provider_iban?.trim() || '—'}`),
            h(Text, { style: styles.cardLine }, `SWIFT: ${settings?.provider_swift?.trim() || '—'}`)
          )
        )
      ),
      h(
        View,
        { style: styles.section },
        h(Text, { style: styles.sectionTitle }, 'Položky vyúčtování'),
        h(
          View,
          { style: styles.table },
          h(
            View,
            { style: styles.tableHeader },
            h(Text, { style: [styles.cellLabel, styles.wName] }, 'Položka'),
            h(Text, { style: [styles.cellLabel, styles.wQty] }, 'Množ.'),
            h(Text, { style: [styles.cellLabel, styles.wUnit] }, 'Jedn.'),
            h(Text, { style: [styles.cellLabel, styles.wPrice] }, 'Cena'),
            h(Text, { style: [styles.cellLabel, styles.wVat] }, 'DPH'),
            h(Text, { style: [styles.cellLabel, styles.wTotal] }, 'Celkem')
          ),
          ...summary.lines.map((line, index) =>
            h(
              View,
              {
                key: line.key,
                style: [styles.tableRow, index === summary.lines.length - 1 ? styles.tableRowLast : null],
              },
              h(
                View,
                { style: styles.wName },
                h(Text, { style: styles.cellTextStrong }, line.label),
                line.note ? h(Text, { style: styles.cellText }, line.note) : null
              ),
              h(Text, { style: [styles.cellText, styles.wQty] }, String(line.quantity).replace('.', ',')),
              h(Text, { style: [styles.cellText, styles.wUnit] }, line.unit),
              h(Text, { style: [styles.cellText, styles.wPrice] }, formatCurrency(line.unitPrice)),
              h(Text, { style: [styles.cellText, styles.wVat] }, getVatModeLabel(line.vatMode)),
              h(Text, { style: [styles.cellTextStrong, styles.wTotal] }, formatCurrency(line.total))
            )
          )
        )
      ),
      h(
        View,
        { style: styles.summaryWrap },
        h(
          View,
          { style: styles.summaryCard },
          h(Text, { style: styles.sectionTitle }, 'Souhrn úhrad'),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Vyúčtování pobytu'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.subtotalExcludingDeposit))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Uhrazeno celkem'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.paidTotal))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Zbývá doplatit'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.remainingToPay))
          ),
          h(View, { style: styles.summaryDivider }),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Požadovaná záloha'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.requestedDepositAmount))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Přijatá kauce'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.depositReceivedAmount))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Vrácená kauce'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.depositRefundAmount))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Zadržená kauce'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.depositWithheldAmount))
          )
        ),
        h(
          View,
          { style: styles.summaryCard },
          h(Text, { style: styles.sectionTitle }, 'DPH a režimy'),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Položky v 12 %'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.vat12Total))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Položky v 21 %'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.vat21Total))
          ),
          h(
            View,
            { style: styles.summaryLine },
            h(Text, { style: styles.summaryLabel }, 'Osvobozené položky'),
            h(Text, { style: styles.summaryValue }, formatCurrency(summary.vatExemptTotal))
          )
        ),
        qrCodeDataUrl
          ? h(
              View,
              { style: styles.qrCard },
              h(Text, { style: styles.sectionTitle }, 'QR platba'),
              h(
                View,
                { style: styles.qrImageWrap },
                h(Image, { src: qrCodeDataUrl, style: styles.qrImage })
              ),
              h(
                Text,
                {
                  style: [
                    styles.footerText,
                    { marginTop: 8, textAlign: 'center', color: '#111827' },
                  ],
                },
                formatCurrency(Math.max(summary.remainingToPay, 0))
              )
            )
          : null
      ),
      reservation.public_note?.trim()
        ? h(
            View,
            { style: styles.noteBox },
            h(Text, { style: styles.sectionTitle }, 'Poznámka pro hosta'),
            h(Text, { style: styles.cardLine }, reservation.public_note)
          )
        : null,
      reservation.security_deposit_withheld_reason?.trim()
        ? h(
            View,
            { style: styles.noteBox },
            h(Text, { style: styles.sectionTitle }, 'Důvod zadržení kauce'),
            h(Text, { style: styles.cardLine }, reservation.security_deposit_withheld_reason)
          )
        : null,
      h(
        View,
        { style: styles.footer },
        h(
          View,
          null,
          h(
            Text,
            { style: styles.footerText },
            'Tento doklad je generován z aktuálních dat rezervace Nord Fjella a slouží jako podklad pro fakturaci.'
          )
        ),
        h(
          View,
          null,
          h(Text, { style: styles.footerText }, `Číslo rezervace: ${reservation.reservation_number}`),
          h(Text, { style: styles.footerText }, `Variabilní symbol: ${reservation.variable_symbol}`)
        )
      )
    )
  )
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, can_view_nord_fjella')
      .eq('id', user.id)
      .single<ProfilePermissionRow>()

    if (profileError || !profile || !canViewNordFjellaSection(profile.role, profile)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const [reservationResult, settingsResult, reservationItemsResult] = await Promise.all([
      supabase.from('nord_fjella_reservations').select('*').eq('id', id).single<NordFjellaReservationRow>(),
      supabase
        .from('nord_fjella_settings')
        .select('*')
        .eq('singleton_key', 'primary')
        .maybeSingle<NordFjellaSettingsRow>(),
      supabase
        .from('nord_fjella_reservation_items')
        .select('*')
        .eq('reservation_id', id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
    ])

    if (reservationResult.error || !reservationResult.data) {
      return new NextResponse('Not found', { status: 404 })
    }

    if (reservationResult.data.record_type !== 'reservation') {
      return new NextResponse('Not found', { status: 404 })
    }

    if (settingsResult.error || reservationItemsResult.error) {
      throw new Error('Nepodařilo se načíst podklady pro PDF vyúčtování.')
    }

    const reservation = reservationResult.data
    const settings = settingsResult.data ?? null
    const providerSettingsIssues = getNordFjellaProviderSettingsIssues(settings)

    if (providerSettingsIssues.length > 0) {
      return new NextResponse(
        `Vyúčtování nelze vygenerovat. Doplň v nastavení poskytovatele: ${providerSettingsIssues.join(', ')}.`,
        {
          status: 400,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        }
      )
    }

    const reservationItems = (reservationItemsResult.data ?? []) as NordFjellaReservationItemRow[]
    const qrPayload = buildNordFjellaSpdQrPayload({
      accountNumber: settings?.provider_bank_account,
      iban: settings?.provider_iban,
      amount: Math.max(buildNordFjellaSettlementSummary(reservation, reservationItems).remainingToPay, 0),
      variableSymbol: reservation.variable_symbol,
      message: `${settings?.object_name?.trim() || 'Nord Fjella'} ${reservation.reservation_number}`,
      recipientName: settings?.provider_company_name,
    })
    const qrCodeDataUrl = qrPayload
      ? await QRCode.toDataURL(qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 180,
        })
      : null
    const guestLabel = sanitizePdfFilenamePart(getGuestLabel(reservation))
    const pdfTitle =
      [sanitizePdfFilenamePart(reservation.reservation_number), guestLabel, 'Vyuctovani pobytu']
        .filter(Boolean)
        .join(' - ') || 'Vyuctovani pobytu'

    const buffer = await renderToBuffer(
      SettlementDocument({
        reservation,
        reservationItems,
        settings,
        qrCodeDataUrl,
      })
    )

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': getPdfContentDisposition(pdfTitle),
      },
    })
  } catch {
    return new NextResponse('Nepodařilo se vygenerovat PDF vyúčtování.', { status: 500 })
  }
}
