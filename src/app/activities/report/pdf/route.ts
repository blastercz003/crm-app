import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement as h } from 'react'
import { NextRequest, NextResponse } from 'next/server'
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
import { getActivityAdminReport } from '@/lib/activities/service'
import type { ActivityAdminReport, ActivityListItem } from '@/lib/activities/types'

export const runtime = 'nodejs'

const logoPath = path.join(process.cwd(), 'public', 'logo2.png')
const logoDataUri = `data:image/png;base64,${readFileSync(logoPath).toString('base64')}`

Font.register({
  family: 'ActivitiesArial',
  fonts: [
    { src: path.join(process.cwd(), 'public', 'fonts', 'Arial.ttf'), fontWeight: 400 },
    { src: path.join(process.cwd(), 'public', 'fonts', 'Arial-Bold.ttf'), fontWeight: 700 },
  ],
})

const styles = StyleSheet.create({
  page: { paddingTop: 70, paddingRight: 26, paddingBottom: 32, paddingLeft: 26, backgroundColor: '#ffffff', color: '#243247', fontFamily: 'ActivitiesArial', fontSize: 7.2 },
  header: { position: 'absolute', top: 16, right: 26, left: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1.2, borderBottomColor: '#2f77af', paddingBottom: 7 },
  headerSide: { width: '38%' },
  eyebrow: { color: '#2f77af', fontSize: 6, fontWeight: 700, letterSpacing: 1.5 },
  title: { marginTop: 2, color: '#172033', fontSize: 15, fontWeight: 700 },
  logo: { width: 82, height: 23, objectFit: 'contain' },
  headerMeta: { width: '38%', textAlign: 'right', color: '#667085', fontSize: 6.5, lineHeight: 1.35 },
  metrics: { flexDirection: 'row', gap: 7, marginBottom: 10 },
  metric: { flexGrow: 1, flexBasis: 0, borderWidth: 0.7, borderColor: '#d9e3ec', borderRadius: 6, backgroundColor: '#f7fafc', padding: 8 },
  metricLabel: { color: '#667085', fontSize: 5.8, fontWeight: 700, letterSpacing: 0.8 },
  metricValue: { marginTop: 3, color: '#172033', fontSize: 15, fontWeight: 700 },
  metricNote: { marginTop: 2, color: '#7b8798', fontSize: 5.8 },
  sectionTitle: { marginTop: 2, marginBottom: 5, color: '#172033', fontSize: 9, fontWeight: 700 },
  sourceBar: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  sourcePill: { borderRadius: 9, backgroundColor: '#eaf4fb', paddingVertical: 4, paddingHorizontal: 8, color: '#236f9f', fontSize: 6.4, fontWeight: 700 },
  table: { borderWidth: 0.7, borderColor: '#d8e1ea', borderRadius: 5, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#edf3f8', borderBottomWidth: 0.7, borderBottomColor: '#cfd9e4', paddingVertical: 5, paddingHorizontal: 5 },
  tableHeaderText: { color: '#526072', fontSize: 5.6, fontWeight: 700, textTransform: 'uppercase' },
  row: { flexDirection: 'row', borderBottomWidth: 0.45, borderBottomColor: '#e5eaf0', paddingVertical: 4.5, paddingHorizontal: 5, minHeight: 23 },
  rowAlt: { backgroundColor: '#fafcfd' },
  cell: { paddingRight: 5, lineHeight: 1.25 },
  userRow: { flexDirection: 'row', borderBottomWidth: 0.45, borderBottomColor: '#e5eaf0', paddingVertical: 4, paddingHorizontal: 5 },
  footer: { position: 'absolute', right: 26, bottom: 14, left: 26, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.6, borderTopColor: '#d8e1ea', paddingTop: 5, color: '#7b8798', fontSize: 5.8 },
  empty: { borderWidth: 0.7, borderColor: '#d8e1ea', borderRadius: 6, padding: 18, textAlign: 'center', color: '#667085' },
})

function formatDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(value))
}

function typeLabel(item: ActivityListItem) {
  if (item.activity_type === 'phone_call') return 'Telefonát'
  if (item.activity_type === 'email') return 'E-mail'
  if (item.activity_type === 'work_log') return 'Pracovní zápis'
  if (item.activity_type === 'in_person_meeting') return 'Osobní kontakt'
  if (item.activity_type.startsWith('meeting_')) return 'Schůzka'
  if (item.activity_type.startsWith('task_')) return 'Úkol'
  if (item.activity_type === 'offer_comment_added') return 'Komentář'
  if (item.activity_type.startsWith('offer_')) return 'Nabídka'
  return 'Ostatní'
}

function originFilterLabel(originFilter: ActivityAdminReport['originFilter']) {
  if (originFilter === 'manual') return 'Pouze ruční'
  if (originFilter === 'automatic') return 'Pouze automatické'
  return 'Všechny aktivity'
}

function stateLabel(item: ActivityListItem) {
  if (item.deleted_at) return 'SMAZÁNO'
  if (item.status === 'completed' || item.completed_at) return 'Dokončeno'
  if (item.status === 'planned') return 'Naplánováno'
  if (item.status === 'cancelled') return 'Zrušeno'
  return 'Zapsáno'
}

function cell(
  width: string,
  value: string,
  extra: { textAlign?: 'right'; fontWeight?: 700 } = {},
) {
  return h(Text, { style: [styles.cell, { width }, extra] }, value)
}

function ReportDocument({ report, generatedAt }: { report: ActivityAdminReport; generatedAt: Date }) {
  const metrics = [
    ['CELKEM', report.total, 'evidovaných událostí'],
    ['RUČNĚ', report.manualCount, 'vlastních zápisů'],
    ['AUTOMATICKY', report.automaticCount, 'událostí ze sekcí'],
    ['AKTIVNÍ DNY', report.activeDays, `průměr ${report.averagePerActiveDay} / den`],
  ] as const

  return h(Document, null,
    h(Page, { size: 'A4', orientation: 'landscape', style: styles.page },
      h(View, { fixed: true, style: styles.header },
        h(View, { style: styles.headerSide }, h(Text, { style: styles.eyebrow }, 'OBCHODNÍ ČINNOST'), h(Text, { style: styles.title }, 'Přehled aktivit')),
        h(Image, { src: logoDataUri, style: styles.logo }),
        h(Text, { style: styles.headerMeta }, `${report.selectedUserName ?? 'Celý tým'}\nObdobí ${report.dateFrom} až ${report.dateTo}\n${originFilterLabel(report.originFilter)} · ${report.includeDeleted ? 'včetně měkce smazaných' : 'bez smazaných aktivit'}\nVygenerováno ${formatDate(generatedAt.toISOString())}`),
      ),
      h(View, { style: styles.metrics }, ...metrics.map(([label, value, note]) => h(View, { key: label, style: styles.metric }, h(Text, { style: styles.metricLabel }, label), h(Text, { style: styles.metricValue }, String(value)), h(Text, { style: styles.metricNote }, note)))),
      h(View, { style: styles.sourceBar },
        h(Text, { style: styles.sourcePill }, `Schůzky ${report.meetingCount}`),
        h(Text, { style: styles.sourcePill }, `Úkoly ${report.taskCount}`),
        h(Text, { style: styles.sourcePill }, `Nabídky ${report.offerCount}`),
        h(Text, { style: styles.sourcePill }, `Ruční bez zdroje ${report.withoutSourceCount}`),
        h(Text, { style: styles.sourcePill }, `Dokončeno ${report.completedCount}`),
        h(Text, { style: styles.sourcePill }, `Výsledky ${report.withResultCount}`),
        report.includeDeleted ? h(Text, { style: [styles.sourcePill, { backgroundColor: '#fdecec', color: '#a63a46' }] }, `Smazáno ${report.deletedCount}`) : null,
      ),
      report.userSummaries.length > 1 ? h(View, { wrap: false, style: { marginBottom: 10 } },
        h(Text, { style: styles.sectionTitle }, 'Souhrn uživatelů'),
        h(View, { style: styles.table },
          h(View, { style: styles.tableHeader }, cell('28%', 'Uživatel'), cell('12%', 'Celkem', { textAlign: 'right' }), cell('12%', 'Ručně', { textAlign: 'right' }), cell('12%', 'Automaticky', { textAlign: 'right' }), cell('14%', 'Aktivní dny', { textAlign: 'right' }), cell('22%', 'Poslední aktivita', { textAlign: 'right' })),
          ...report.userSummaries.map((user) => h(View, { key: user.userId, style: styles.userRow }, cell('28%', user.userName, { fontWeight: 700 }), cell('12%', String(user.total), { textAlign: 'right' }), cell('12%', String(user.manual), { textAlign: 'right' }), cell('12%', String(user.automatic), { textAlign: 'right' }), cell('14%', String(user.activeDays), { textAlign: 'right' }), cell('22%', user.lastActivityAt ? formatDate(user.lastActivityAt) : '—', { textAlign: 'right' }))),
        ),
      ) : null,
      h(Text, { style: styles.sectionTitle }, 'Seznam aktivit'),
      report.items.length ? h(View, { style: styles.table },
        h(View, { fixed: true, style: styles.tableHeader }, cell('12%', 'Datum'), cell('9%', 'Uživatel'), cell('11%', 'Typ / původ'), cell('14%', 'Klient'), cell('25%', 'Aktivita'), cell('10%', 'Stav'), cell('19%', 'Výsledek')),
        ...report.items.map((item, index) => h(View, { key: item.id, wrap: false, style: [styles.row, index % 2 ? styles.rowAlt : {}, item.deleted_at ? { backgroundColor: '#fff1f2', color: '#8f3540' } : {}] }, cell('12%', formatDate(item.occurred_at)), cell('9%', item.user_name ?? '—'), cell('11%', `${typeLabel(item)} · ${item.origin === 'manual' ? 'Ručně' : 'Auto'}`), cell('14%', item.client_name ?? 'Bez klienta'), cell('25%', item.title), cell('10%', stateLabel(item), { fontWeight: 700 }), cell('19%', item.completion_result?.trim() || '—'))),
      ) : h(Text, { style: styles.empty }, 'Ve zvoleném období nejsou žádné aktivity.'),
      h(View, { fixed: true, style: styles.footer }, h(Text, null, 'B-ENERGY APP · interní přehled aktivit'), h(Text, { render: ({ pageNumber, totalPages }) => `Strana ${pageNumber} z ${totalPages}` })),
    ),
  )
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get('user')
  const dateFrom = request.nextUrl.searchParams.get('from') ?? ''
  const dateTo = request.nextUrl.searchParams.get('to') ?? ''
  const includeDeleted = request.nextUrl.searchParams.get('deleted') === '1'
  const originParam = request.nextUrl.searchParams.get('origin')
  const originFilter = originParam === 'manual' || originParam === 'automatic' ? originParam : 'all'

  try {
    const report = await getActivityAdminReport({ userId, dateFrom, dateTo, includeDeleted, originFilter })
    const buffer = await renderToBuffer(ReportDocument({ report, generatedAt: new Date() }))
    const disposition = request.nextUrl.searchParams.get('preview') === '1' ? 'inline' : 'attachment'
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="aktivity-${originFilter === 'all' ? 'vsechny' : originFilter === 'manual' ? 'rucni' : 'automaticke'}-${dateFrom}-${dateTo}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'PDF report se nepodařilo vytvořit.' }, { status: 400 })
  }
}
