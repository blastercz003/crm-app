import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { Download, Paperclip } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import { isMissingColumnError } from '@/lib/majetek/detail'
import {
  calculateAdvancePaymentsForPeriod,
  buildSettlementLineItems,
  type RentalServiceAdvanceHistoryRow,
  type RentalServiceSettlementCustomItemRow,
  type RentalServiceSettlementFileRow,
  type RentalServiceSettlementRow,
} from '@/lib/majetek/rental-settlements'
import { SettlementDeleteButton, SettlementReconciliationForm } from '@/app/majetek/asset-rental-service-settlements'

export const metadata: Metadata = {
  title: 'Majetek - Vyúčtování služeb',
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetRow = {
  id: string
  name: string
  category_id: string
}

type RentalRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
}

type ProfileRow = {
  id: string
  name: string | null
}

type SettlementQueryError = {
  code?: string
  message?: string
}

type SettlementQueryResponse = {
  data: RentalServiceSettlementRow | null
  error: SettlementQueryError | null
}

async function loadSettlementWithFallback(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
  settlementId: string,
) : Promise<SettlementQueryResponse> {
  const withReconciliation = (await supabase
    .from('asset_rental_service_settlements')
    .select('id, asset_id, rental_id, settlement_code, period_from, period_to, tenant_name_snapshot, tenant_contact_snapshot, status, electricity_amount, hot_water_heating_amount, space_heating_amount, common_area_cleaning_amount, cold_water_sewer_amount, hot_water_sewer_amount, advance_payments_total_amount, service_total_amount, balance_amount, settled_on, settled_by, settled_note, note, closed_at, closed_by, created_by, created_at, updated_at')
    .eq('id', settlementId)
    .eq('asset_id', assetId)
    .maybeSingle<RentalServiceSettlementRow>()) as SettlementQueryResponse

  if (!withReconciliation.error) {
    return withReconciliation
  }

  if (!isMissingColumnError(withReconciliation.error)) {
    return withReconciliation
  }

  const fallback = (await supabase
    .from('asset_rental_service_settlements')
    .select('id, asset_id, rental_id, settlement_code, period_from, period_to, tenant_name_snapshot, tenant_contact_snapshot, status, electricity_amount, hot_water_heating_amount, space_heating_amount, common_area_cleaning_amount, cold_water_sewer_amount, hot_water_sewer_amount, advance_payments_total_amount, service_total_amount, balance_amount, note, closed_at, closed_by, created_by, created_at, updated_at')
    .eq('id', settlementId)
    .eq('asset_id', assetId)
    .maybeSingle<{
      id: string
      asset_id: string
      rental_id: string
      settlement_code: string
      period_from: string
      period_to: string
      tenant_name_snapshot: string
      tenant_contact_snapshot: string | null
      status: 'draft' | 'closed'
      electricity_amount: number
      hot_water_heating_amount: number
      space_heating_amount: number
      common_area_cleaning_amount: number
      cold_water_sewer_amount: number
      hot_water_sewer_amount: number
      advance_payments_total_amount: number
      service_total_amount: number
      balance_amount: number
      note: string | null
      closed_at: string | null
      closed_by: string | null
      created_by: string | null
      created_at: string
      updated_at: string
    }>()) as {
      data: {
        id: string
        asset_id: string
        rental_id: string
        settlement_code: string
        period_from: string
        period_to: string
        tenant_name_snapshot: string
        tenant_contact_snapshot: string | null
        status: 'draft' | 'closed'
        electricity_amount: number
        hot_water_heating_amount: number
        space_heating_amount: number
        common_area_cleaning_amount: number
        cold_water_sewer_amount: number
        hot_water_sewer_amount: number
        advance_payments_total_amount: number
        service_total_amount: number
        balance_amount: number
        note: string | null
        closed_at: string | null
        closed_by: string | null
        created_by: string | null
        created_at: string
        updated_at: string
      } | null
      error: SettlementQueryError | null
    }

  if (fallback.data) {
    return {
      ...fallback,
      data: {
        ...fallback.data,
        settled_on: null,
        settled_by: null,
        settled_note: null,
      } as RentalServiceSettlementRow,
    }
  }

  return {
    data: null,
    error: fallback.error,
  }
}

function formatCurrency(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(parsed)
}

function formatMonthLabel(value: string | null) {
  if (!value) return '—'

  const [year, month] = value.slice(0, 7).split('-')
  if (!year || !month) return value.slice(0, 7)

  return `${month}/${year}`
}

function formatPeriod(from: string, to: string) {
  return `${formatMonthLabel(from)} - ${formatMonthLabel(to)}`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatBalance(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  if (parsed > 0) return `Přeplatek ${formatCurrency(parsed)}`
  if (parsed < 0) return `Nedoplatek ${formatCurrency(Math.abs(parsed))}`
  return 'Vyrovnáno'
}

function statClassName() {
  return 'rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]'
}

function emptyGlassStateClassName() {
  return 'rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-8 text-sm text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]'
}

async function createSignedUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storagePath: string,
  expiresInSeconds: number,
) {
  const { data, error } = await supabase.storage
    .from('asset-files')
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error || !data?.signedUrl) {
    return null
  }

  return data.signedUrl
}

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string; settlementId: string }>
}) {
  const { id: assetId, settlementId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, majetek')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  if (!canViewAssetsSection(typedProfile?.role ?? null, typedProfile)) {
    redirect('/dashboard')
  }

  const { data: asset, error: assetError } = await supabase
    .from('assets')
    .select('id, name, category_id')
    .eq('id', assetId)
    .maybeSingle<AssetRow>()

  if (assetError) {
    throw new Error('Nepodařilo se načíst majetek.')
  }

  const { data: settlement, error: settlementError } = await loadSettlementWithFallback(supabase, assetId, settlementId)

  if (settlementError) {
    throw new Error('Nepodařilo se načíst vyúčtování.')
  }

  if (!asset || !settlement) {
    notFound()
  }

  const { data: rental, error: rentalError } = await supabase
    .from('asset_rentals')
    .select('id, asset_id, tenant_name, tenant_contact')
    .eq('id', settlement.rental_id)
    .eq('asset_id', asset.id)
    .maybeSingle<RentalRow>()

  const { data: settledByProfile } = settlement.settled_by
    ? await supabase
        .from('profiles')
        .select('id, name')
        .eq('id', settlement.settled_by)
        .maybeSingle<ProfileRow>()
    : { data: null }

  if (rentalError || !rental) {
    notFound()
  }

  const { data: historyRows, error: historyError } = await supabase
    .from('asset_rental_service_advance_history')
    .select('id, rental_id, effective_from, monthly_advance, note, created_at, updated_at')
    .eq('rental_id', rental.id)
    .order('effective_from', { ascending: true })
    .order('created_at', { ascending: true })

  if (historyError) {
    throw new Error('Nepodařilo se načíst historii záloh.')
  }

  const { data: customItemRows, error: customItemError } = await supabase
    .from('asset_rental_service_settlement_custom_items')
    .select('id, settlement_id, title, amount, sort_order, created_by, created_at, updated_at')
    .eq('settlement_id', settlement.id)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (customItemError) {
    throw new Error('Nepodařilo se načíst vlastní položky.')
  }

  const { data: fileRows, error: fileError } = await supabase
    .from('asset_rental_service_settlement_files')
    .select('id, settlement_id, title, file_name, storage_bucket, storage_path, mime_type, file_size_bytes, uploaded_by, created_at, updated_at')
    .eq('settlement_id', settlement.id)
    .order('created_at', { ascending: true })

  if (fileError) {
    throw new Error('Nepodařilo se načíst přílohy.')
  }

  const history = (historyRows ?? []) as RentalServiceAdvanceHistoryRow[]
  const files = (fileRows ?? []) as RentalServiceSettlementFileRow[]
  const customItems = (customItemRows ?? []) as RentalServiceSettlementCustomItemRow[]
  const filesWithUrls = await Promise.all(
    files.map(async (file) => ({
      ...file,
      signedUrl: await createSignedUrl(supabase, file.storage_path, 60 * 10),
    }))
  )
  const lineItems = buildSettlementLineItems({
    settlement,
    customItems,
  })
  const fixedLineItems = lineItems.filter((item) => item.kind === 'fixed')
  const customLineItems = lineItems.filter((item) => item.kind === 'custom')

  const advanceCalculation = calculateAdvancePaymentsForPeriod({
    history,
    periodFrom: settlement.period_from,
    periodTo: settlement.period_to,
  })

  return (
    <main className="assets-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-white/75 bg-white/80 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
                    {asset.name}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] ${
                    settlement.status === 'closed'
                      ? 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
                      : 'border border-amber-200/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.92)_0%,rgba(254,243,199,0.84)_100%)] text-amber-800'
                  }`}>
                    {settlement.status === 'closed' ? 'Uzavřené' : 'Koncept'}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] ${
                    settlement.settled_on
                      ? 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
                      : 'border border-zinc-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(244,244,245,0.84)_100%)] text-zinc-700'
                  }`}>
                    {settlement.settled_on ? 'Vypořádáno' : 'Nevypořádáno'}
                  </span>
                </div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-900">
                  {settlement.settlement_code}
                </h1>
                <p className="mt-2 text-sm text-zinc-500">
                  {settlement.tenant_name_snapshot}
                  {settlement.tenant_contact_snapshot ? ` • ${settlement.tenant_contact_snapshot}` : ''}
                </p>
                <p className="mt-2 text-sm text-zinc-500">
                  Období {formatPeriod(settlement.period_from, settlement.period_to)}
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <SettlementDeleteButton
                  assetId={asset.id}
                  settlementId={settlement.id}
                  successRedirectHref={`/majetek/${asset.id}?tab=rent`}
                  variant="button"
                  className="w-full sm:w-auto"
                />
                <a
                  href={`/majetek/${asset.id}/vyuctovani/${settlement.id}/export`}
                  download
                  className="inline-flex w-full items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] sm:w-auto"
                >
                  <Download className="mr-2 h-4 w-4" />
                  XLS EXPORT
                </a>
                <Link
                  href={`/majetek/${asset.id}?tab=rent`}
                  className="clients-page__back-button inline-flex w-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 sm:w-auto"
                >
                  ZPĚT NA PRONÁJEM
                </Link>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className={statClassName()}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Zálohy celkem</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(settlement.advance_payments_total_amount)}</p>
              </div>
              <div className={statClassName()}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Služby celkem</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(settlement.service_total_amount)}</p>
              </div>
              <div className={statClassName()}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Výsledek</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{formatBalance(settlement.balance_amount)}</p>
              </div>
              <div className={statClassName()}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Přílohy</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{filesWithUrls.length} souborů</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
          <div className="space-y-5">
            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-gray-900">Rozpis položek</h2>
                  <p className="text-sm text-zinc-500">Jednotlivé služby v samostatných sloupcích.</p>
                </div>
                <span className="text-sm font-medium text-zinc-500">{settlement.status === 'closed' ? 'Uzavřeno' : 'Rozpracováno'}</span>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/75">
                <table className="w-full table-fixed border-separate border-spacing-0">
                  <thead className="bg-white/75">
                    <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                      <th className="px-4 py-3">Položka</th>
                      <th className="px-4 py-3 text-right">Částka</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fixedLineItems.map((entry) => (
                      <tr key={entry.key} className="border-t border-white/70 bg-white/50">
                        <td className="px-4 py-3 text-sm text-gray-700">{entry.title}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(entry.amount)}</td>
                      </tr>
                    ))}

                    {customLineItems.length > 0 ? (
                      <>
                        <tr className="border-t border-white/70 bg-[linear-gradient(155deg,rgba(245,248,252,0.98)_0%,rgba(238,244,250,0.92)_100%)]">
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900" colSpan={2}>
                            Vlastní položky
                          </td>
                        </tr>
                        {customLineItems.map((entry) => (
                          <tr key={entry.key} className="border-t border-white/70 bg-white/50">
                            <td className="px-4 py-3 text-sm text-gray-700">{entry.title}</td>
                            <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(entry.amount)}</td>
                          </tr>
                        ))}
                      </>
                    ) : null}
                    {customLineItems.length === 0 ? (
                      <tr className="border-t border-white/70 bg-white/50">
                        <td className="px-4 py-3 text-sm text-gray-500" colSpan={2}>
                          Bez vlastních položek.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-gray-900">Rozpad záloh po měsících</h2>
                  <p className="text-sm text-zinc-500">Přepočet záloh podle historie k jednotlivým měsícům období.</p>
                </div>
                <span className="text-sm font-medium text-zinc-500">{advanceCalculation.monthBreakdown.length} měsíců</span>
              </div>

              <div className="mt-5 overflow-hidden rounded-2xl border border-white/75">
                <table className="w-full table-fixed border-separate border-spacing-0">
                  <thead className="bg-white/75">
                    <tr className="text-left text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                      <th className="px-4 py-3">Měsíc</th>
                      <th className="px-4 py-3 text-right">Záloha</th>
                      <th className="px-4 py-3">Zdroj</th>
                    </tr>
                  </thead>
                  <tbody>
                    {advanceCalculation.monthBreakdown.map((entry) => (
                      <tr key={entry.month} className="border-t border-white/70 bg-white/50">
                        <td className="px-4 py-3 text-sm text-gray-700">{entry.month}</td>
                        <td className="px-4 py-3 text-right text-sm font-medium text-gray-900">{formatCurrency(entry.monthlyAdvance)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{entry.sourceAdvanceId ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-gray-900">Shrnutí</h2>
                <p className="text-sm text-zinc-500">Nájemce, období a interní stav vyúčtování.</p>
              </div>

              <div className="mt-5 grid gap-3">
                <div className={statClassName()}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Nájemce</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{settlement.tenant_name_snapshot}</p>
                  <p className="mt-1 text-xs text-gray-500">{settlement.tenant_contact_snapshot || '—'}</p>
                </div>
                <div className={statClassName()}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Období</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatPeriod(settlement.period_from, settlement.period_to)}</p>
                </div>
                <div className={statClassName()}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Vytvořeno</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDateTime(settlement.created_at)}</p>
                </div>
                <div className={statClassName()}>
                  <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Uzavřeno</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDateTime(settlement.closed_at)}</p>
                </div>
              </div>

              <div className="mt-5">
                <SettlementReconciliationForm settlement={settlement} settledByName={settledByProfile?.name ?? null} />
              </div>

              {settlement.note ? (
                <div className="mt-5 rounded-2xl border border-white/75 bg-white/75 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Poznámka</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{settlement.note}</p>
                </div>
              ) : null}
            </section>

            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight text-gray-900">Přílohy</h2>
                  <p className="text-sm text-zinc-500">PDF a obrázky přiložené k vyúčtování.</p>
                </div>
                <Paperclip className="h-4 w-4 text-gray-500" />
              </div>

              <div className="mt-5 space-y-3">
                {filesWithUrls.length > 0 ? (
                  filesWithUrls.map((file) => (
                    file.signedUrl ? (
                      <a
                        key={file.id}
                        href={file.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
                      >
                        <p className="truncate text-sm font-semibold text-gray-900">{file.title || file.file_name}</p>
                        <p className="mt-1 text-xs text-gray-500">{file.file_name}</p>
                      </a>
                    ) : (
                      <div
                        key={file.id}
                        className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]"
                      >
                        <p className="truncate text-sm font-semibold text-gray-900">{file.title || file.file_name}</p>
                        <p className="mt-1 text-xs text-gray-500">{file.file_name}</p>
                      </div>
                    )
                  ))
                ) : (
                  <div className={emptyGlassStateClassName()}>
                    Zatím nejsou nahrané žádné přílohy.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.94)_48%,rgba(241,245,249,0.9)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_18px_36px_rgba(15,23,42,0.1)] sm:p-6">
              <div>
                <h2 className="text-lg font-semibold tracking-tight text-gray-900">Návrat k úpravě</h2>
                <p className="text-sm text-zinc-500">Úpravy se dělají z tabulky Pronájem v detailu majetku.</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/majetek/${asset.id}?tab=rent#settlement-${settlement.id}`}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
                >
                  Otevřít v pronájmu
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  )
}
