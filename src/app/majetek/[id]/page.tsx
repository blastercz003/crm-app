import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { Building2, CarFront, Cpu, House } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import { ASSET_CATEGORY_SEEDS } from '@/lib/majetek/config'
import { AssetAttachmentUploadPanel } from '../asset-attachment-upload-panel'
import { AssetInsuranceSection, type AssetInsuranceRow } from '../asset-insurance-form'
import { AssetNoteForm } from '../asset-note-form'
import { EditAssetButton } from '../edit-asset-button'
import { EditStructuredDetailsButton } from '../edit-structured-details-button'
import { AssetDetailClient } from '../asset-detail-client'
import {
  ASSET_TAB_LABELS,
  ASSET_TAB_ORDER,
  buildAssetDetailHref,
  isMissingColumnError,
  normalizeAssetTabs,
  isAssetTabKey,
} from '@/lib/majetek/detail'
import type { AssetTabKey } from '@/lib/majetek/types'

export const metadata: Metadata = {
  title: 'Majetek - Detail',
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetDetailPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{
    tab?: string
  }>
}

type AssetRow = {
  id: string
  category_id: string
  name: string
  status: 'active' | 'sold'
  purchase_date: string | null
  sale_date: string | null
  purchase_price: string | number | null
  notes: string | null
  created_at: string
  updated_at: string
}

type AssetCategoryRow = {
  id: string
  name: string
  color: string
  icon_key: string
  sort_order: number
  tabs_config: unknown
}

type AssetVehicleRow = {
  asset_id: string
  registration_plate: string
  vin: string | null
  brand: string | null
  model: string | null
  year_of_manufacture: number | null
  mileage_km: number | null
  stk_expires_on: string | null
  created_at: string
  updated_at: string
}

type AssetRealEstateRow = {
  asset_id: string
  address: string | null
  cadastral_area: string | null
  land_registry_number: string | null
  parcel_number: string | null
  unit_number: string | null
  floor_area_sqm: string | number | null
  created_at: string
  updated_at: string
}

type AssetElectronicsRow = {
  asset_id: string
  serial_number: string | null
  inventory_number: string | null
  brand: string | null
  model: string | null
  warranty_until: string | null
  location: string | null
  created_at: string
  updated_at: string
}

type AssetRentalRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
  start_date: string | null
  end_date: string | null
  monthly_rent: string | number | null
  deposit_amount: string | number | null
  note: string | null
  created_at: string
  updated_at: string
}

type AssetElectricityRow = {
  id: string
  asset_id: string
  billing_year: number
  provider_name: string | null
  ean: string | null
  meter_number: string | null
  period_start: string | null
  period_end: string | null
  consumption_kwh: string | number | null
  total_amount: string | number | null
  advance_payments: string | number | null
  balance_amount: string | number | null
  billed_on: string | null
  due_date: string | null
  paid_on: string | null
  note: string | null
  created_at: string
  updated_at: string
}

type AssetDocumentRow = {
  id: string
  asset_id: string
  document_type_id: string
  title: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  note: string | null
  created_at: string
}

type AssetDocumentViewRow = AssetDocumentRow & {
  signedUrl: string | null
}

type AssetPhotoRow = {
  id: string
  asset_id: string
  title: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  note: string | null
  created_at: string
}

type AssetPhotoViewRow = AssetPhotoRow & {
  signedUrl: string | null
}

type AssetNoteRow = {
  id: string
  asset_id: string
  body: string
  created_by: string | null
  created_at: string
  updated_at: string
}

type AssetDocumentTypeRow = {
  id: string
  name: string
  tabs_config: unknown
}

async function loadAssetDocumentTypes(supabase: Awaited<ReturnType<typeof createClient>>) {
  const withTabs = await supabase
    .from('asset_document_types')
    .select('id, name, tabs_config')
    .order('sort_order', { ascending: true })

  if (!withTabs.error) {
    return withTabs
  }

  if (!isMissingColumnError(withTabs.error)) {
    return withTabs
  }

  const fallback = await supabase
    .from('asset_document_types')
    .select('id, name')
    .order('sort_order', { ascending: true })

  return {
    ...fallback,
    data: (fallback.data ?? []).map((documentType) => ({
      ...documentType,
      tabs_config: [],
    })),
  }
}

function AssetCategoryIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case 'car':
      return <CarFront className="h-6 w-6" strokeWidth={1.85} />
    case 'house':
      return <House className="h-6 w-6" strokeWidth={1.85} />
    case 'building':
      return <Building2 className="h-6 w-6" strokeWidth={1.85} />
    case 'cpu':
      return <Cpu className="h-6 w-6" strokeWidth={1.85} />
    default:
      return <CarFront className="h-6 w-6" strokeWidth={1.85} />
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
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

function formatCurrency(value: string | number | null) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return '—'

  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(parsed)
}

function formatBytes(bytes: number | null) {
  if (!bytes || bytes <= 0) return '—'

  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const rounded = unitIndex === 0 ? Math.round(size) : size.toFixed(size >= 10 ? 0 : 1)
  return `${rounded} ${units[unitIndex]}`
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

function statusLabel(status: AssetRow['status']) {
  return status === 'sold' ? 'Prodáno' : 'Aktivní'
}

function statusTone(status: AssetRow['status']) {
  return status === 'sold'
    ? 'border border-amber-200/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.92)_0%,rgba(254,243,199,0.84)_100%)] text-amber-800'
    : 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
}

function getAssetTabs(
  categoryTabs: unknown,
  categoryName: string,
): AssetTabKey[] {
  const normalized = normalizeAssetTabs(categoryTabs)

  if (normalized.length > 0) {
    return ASSET_TAB_ORDER.filter((tab) => normalized.includes(tab))
  }

  const fallbackSeed = ASSET_CATEGORY_SEEDS.find((category) => category.label === categoryName)
  const fallbackTabs = fallbackSeed?.tabs ?? ['overview', 'documents', 'photos']
  return ASSET_TAB_ORDER.filter((tab) => fallbackTabs.includes(tab))
}

function TabCard({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="flex h-full min-h-[92px] flex-col justify-between rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-gray-500">{note}</p> : null}
    </div>
  )
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="assets-page__category overflow-hidden rounded-[28px] border border-white/72 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(248,250,252,0.93)_48%,rgba(241,245,249,0.89)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="border-b border-white/70 px-5 py-4 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      </div>

      <div className="p-5 sm:p-6">{children}</div>
    </section>
  )
}

function DocumentSidebar({
  title,
  description,
  documents,
  documentTypeMap,
  emptyMessage,
}: {
  title: string
  description?: string
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
  emptyMessage: string
}) {
  return (
    <SectionShell title={title} description={description}>
      {documents.length > 0 ? (
        <div className="space-y-3">
          {documents.map((document) => (
            <a
              key={document.id}
              href={document.signedUrl ?? '#'}
              target={document.signedUrl ? '_blank' : undefined}
              rel={document.signedUrl ? 'noreferrer' : undefined}
              aria-disabled={!document.signedUrl}
              onClick={(event) => {
                if (!document.signedUrl) {
                  event.preventDefault()
                }
              }}
              className="block rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_22px_rgba(15,23,42,0.12)]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {documentTypeMap.get(document.document_type_id) ?? 'Dokument'}
                  </p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-gray-900">{document.title}</h3>
                  <p className="mt-1 truncate text-xs text-gray-500">{document.file_name}</p>
                </div>

                <div className="grid gap-2 text-xs text-gray-600 md:text-right">
                  <p>{formatBytes(document.file_size_bytes)}</p>
                  <p>{formatDateTime(document.created_at)}</p>
                  <p className="font-medium text-[#2f77af]">
                    {document.signedUrl ? 'Otevřít dokument' : 'Odkaz není k dispozici'}
                  </p>
                </div>
              </div>

              {document.note ? <p className="mt-3 text-sm leading-6 text-gray-600">{document.note}</p> : null}
            </a>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
          {emptyMessage}
        </div>
      )}
    </SectionShell>
  )
}

function renderOverviewTab({
  asset,
  category,
}: {
  asset: AssetRow
  category: AssetCategoryRow
}) {
  return (
    <SectionShell title="Základní přehled">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TabCard title="Název" value={asset.name} />
          <TabCard title="Kategorie" value={category.name} />
          <TabCard title="Stav" value={statusLabel(asset.status)} />
          <TabCard title="Datum nákupu" value={formatDate(asset.purchase_date)} />
          <TabCard title="Pořizovací cena" value={formatCurrency(asset.purchase_price)} />
          <TabCard title="Datum prodeje" value={formatDate(asset.sale_date)} />
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <TabCard
            title="Vytvořeno"
            value={formatDateTime(asset.created_at)}
          />
          <TabCard
            title="Aktualizováno"
            value={formatDateTime(asset.updated_at)}
          />
          <TabCard
            title="Kategorie"
            value={category.name}
          />
        </div>
      </div>
    </SectionShell>
  )
}

function renderDocumentsTab({
  assetId,
  documents,
  documentTypes,
  documentTypeMap,
}: {
  assetId: string
  documents: AssetDocumentViewRow[]
  documentTypes: Array<{ id: string; name: string }>
  documentTypeMap: Map<string, string>
}) {
  if (documents.length === 0) {
    return (
      <SectionShell title="Dokumenty" description="PDF soubory a další přílohy majetku.">
        <div className="space-y-5">
          <AssetAttachmentUploadPanel
            assetId={assetId}
            kind="documents"
            documentTypes={documentTypes}
          />
          <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
            Zatím zde nejsou žádné dokumenty.
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Dokumenty" description="Seznam nahraných souborů podle typu dokumentu.">
      <div className="space-y-5">
        <AssetAttachmentUploadPanel
          assetId={assetId}
          kind="documents"
          documentTypes={documentTypes}
        />

        <div className="space-y-3">
          {documents.map((document) => (
            <a
              key={document.id}
              href={document.signedUrl ?? '#'}
              target={document.signedUrl ? '_blank' : undefined}
              rel={document.signedUrl ? 'noreferrer' : undefined}
              aria-disabled={!document.signedUrl}
              onClick={(event) => {
                if (!document.signedUrl) {
                  event.preventDefault()
                }
              }}
              className="block rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_22px_rgba(15,23,42,0.12)]"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    {documentTypeMap.get(document.document_type_id) ?? 'Dokument'}
                  </p>
                  <h3 className="mt-1 truncate text-sm font-semibold text-gray-900">{document.title}</h3>
                  <p className="mt-1 truncate text-xs text-gray-500">{document.file_name}</p>
                </div>

                <div className="grid gap-2 text-xs text-gray-600 md:text-right">
                  <p>{formatBytes(document.file_size_bytes)}</p>
                  <p>{formatDateTime(document.created_at)}</p>
                  <p className="font-medium text-[#2f77af]">
                    {document.signedUrl ? 'Otevřít dokument' : 'Odkaz není k dispozici'}
                  </p>
                </div>
              </div>

              {document.note ? <p className="mt-3 text-sm leading-6 text-gray-600">{document.note}</p> : null}
            </a>
          ))}
        </div>
      </div>
    </SectionShell>
  )
}

function renderPhotosTab({ assetId, photos }: { assetId: string; photos: AssetPhotoViewRow[] }) {
  if (photos.length === 0) {
    return (
      <SectionShell title="Fotky" description="Fotodokumentace majetku.">
        <div className="space-y-5">
          <AssetAttachmentUploadPanel assetId={assetId} kind="photos" />
          <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
            Zatím zde nejsou žádné fotky.
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Fotky">
      <div className="space-y-5">
        <AssetAttachmentUploadPanel assetId={assetId} kind="photos" />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {photos.map((photo) => (
            <a
              key={photo.id}
              href={photo.signedUrl ?? '#'}
              target={photo.signedUrl ? '_blank' : undefined}
              rel={photo.signedUrl ? 'noreferrer' : undefined}
              aria-disabled={!photo.signedUrl}
              onClick={(event) => {
                if (!photo.signedUrl) {
                  event.preventDefault()
                }
              }}
              className="group overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_22px_rgba(15,23,42,0.12)]"
            >
              <div className="mb-3 aspect-[4/3] overflow-hidden rounded-xl border border-white/70 bg-[rgba(255,255,255,0.54)]">
                {photo.signedUrl ? (
                  <div
                    role="img"
                    aria-label={photo.title}
                    className="h-full w-full bg-cover bg-center transition duration-300 group-hover:scale-[1.02]"
                    style={{ backgroundImage: `url(${photo.signedUrl})` }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-gray-500">
                    Náhled není k dispozici
                  </div>
                )}
              </div>
              <p className="text-sm font-semibold text-gray-900">{photo.title}</p>
              <p className="mt-1 text-xs text-gray-500">{photo.file_name}</p>
              <p className="mt-3 text-xs text-gray-500">{formatDateTime(photo.created_at)}</p>
              <p className="mt-2 text-xs font-medium text-[#2f77af]">
                {photo.signedUrl ? 'Otevřít fotku' : 'Odkaz není k dispozici'}
              </p>
            </a>
          ))}
        </div>
      </div>
    </SectionShell>
  )
}

function renderInsuranceTab({
  assetId,
  insurances,
  documents,
  documentTypeMap,
}: {
  assetId: string
  insurances: AssetInsuranceRow[]
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <AssetInsuranceSection assetId={assetId} insurances={insurances} />

      <DocumentSidebar
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K pojištění zatím nejsou navázané žádné dokumenty."
      />
    </div>
  )
}

function renderStkTab({ vehicle }: { vehicle: AssetVehicleRow | null }) {
  return (
    <SectionShell title="STK">
      {vehicle ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TabCard
            title="STK končí"
            value={formatDate(vehicle.stk_expires_on)}
            note="Termín technické kontroly."
          />
          <TabCard
            title="SPZ"
            value={vehicle.registration_plate}
          />
          <TabCard
            title="Nájezd"
            value={vehicle.mileage_km !== null ? `${vehicle.mileage_km.toLocaleString('cs-CZ')} km` : '—'}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
          STK údaje zde nejsou vyplněné.
        </div>
      )}
    </SectionShell>
  )
}

function renderServiceTab({ vehicle }: { vehicle: AssetVehicleRow | null }) {
  return (
    <SectionShell title="Servis">
      {vehicle ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TabCard
            title="Značka"
            value={`${vehicle.brand || '—'} ${vehicle.model || ''}`.trim()}
          />
          <TabCard
            title="Rok výroby"
            value={vehicle.year_of_manufacture !== null ? String(vehicle.year_of_manufacture) : '—'}
          />
          <TabCard
            title="Najeto"
            value={vehicle.mileage_km !== null ? `${vehicle.mileage_km.toLocaleString('cs-CZ')} km` : '—'}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
          Servisní data zatím nejsou k dispozici.
        </div>
      )}
    </SectionShell>
  )
}

function renderRentTab({
  realEstate,
  rentals,
}: {
  realEstate: AssetRealEstateRow | null
  rentals: AssetRentalRow[]
}) {
  return (
    <SectionShell title="Pronájem" description="Nájemní vztah, smlouvy a průběh pronájmu.">
      {realEstate ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TabCard title="Adresa" value={realEstate.address || '—'} />
            <TabCard title="Katastrální území" value={realEstate.cadastral_area || '—'} />
            <TabCard title="Plocha" value={realEstate.floor_area_sqm !== null ? `${realEstate.floor_area_sqm} m²` : '—'} />
          </div>

          {rentals.length > 0 ? (
            <div className="space-y-3">
              {rentals.map((rental) => (
                <article
                  key={rental.id}
                  className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">
                      {rental.tenant_name || 'Nezadáno'}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {formatDate(rental.start_date)} - {formatDate(rental.end_date)}
                    </p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <p className="text-sm text-gray-700">
                      Kontakt: <span className="font-medium text-gray-900">{rental.tenant_contact || '—'}</span>
                    </p>
                    <p className="text-sm text-gray-700">
                      Měsíční nájem: <span className="font-medium text-gray-900">{formatCurrency(rental.monthly_rent)}</span>
                    </p>
                  </div>
                  {rental.note ? <p className="mt-3 text-sm leading-6 text-gray-600">{rental.note}</p> : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
              Zatím zde není žádný pronájem.
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
          Pronájem je určený pro domy a byty.
        </div>
      )}
    </SectionShell>
  )
}

function renderRepairsTab({ assetId, notes }: { assetId: string; notes: AssetNoteRow[] }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <SectionShell title="Přidat poznámku">
        <div className="space-y-5">
          <AssetNoteForm assetId={assetId} />
        </div>
      </SectionShell>

      <SectionShell title="Uložené poznámky">
        {notes.length > 0 ? (
          <div className="space-y-3">
            {notes.map((note) => (
              <article
                key={note.id}
                className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]"
              >
                <p className="text-xs text-gray-500">{formatDateTime(note.created_at)}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#d8e4ef] bg-[rgba(255,255,255,0.56)] p-6 text-sm text-gray-500">
            Zatím zde nejsou žádné poznámky.
          </div>
        )}
      </SectionShell>
    </div>
  )
}

export default async function AssetDetailPage({ params, searchParams }: AssetDetailPageProps) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const requestedTab = resolvedSearchParams?.tab ?? 'overview'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, majetek')
    .eq('id', user.id)
    .single()

  if (error) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null

  if (!canViewAssetsSection(typedProfile?.role ?? null, typedProfile)) {
    redirect('/dashboard')
  }

  const assetResponse = await supabase
    .from('assets')
    .select('id, category_id, name, status, purchase_date, sale_date, purchase_price, notes, created_at, updated_at')
    .eq('id', id)
    .single<AssetRow>()

  if (assetResponse.error || !assetResponse.data) {
    notFound()
  }

  const asset = assetResponse.data

  const [
    categoriesResponse,
    vehicleResponse,
  realEstateResponse,
    electronicsResponse,
    insuranceResponse,
    electricityResponse,
    rentalsResponse,
    documentsResponse,
    photosResponse,
    notesResponse,
    documentTypesResponse,
  ] = await Promise.all([
    supabase
      .from('asset_categories')
      .select('id, name, color, icon_key, sort_order, tabs_config')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('asset_vehicle_details')
      .select('asset_id, registration_plate, vin, brand, model, year_of_manufacture, mileage_km, stk_expires_on, created_at, updated_at')
      .eq('asset_id', asset.id)
      .maybeSingle<AssetVehicleRow>(),
    supabase
      .from('asset_real_estate_details')
      .select('asset_id, address, cadastral_area, land_registry_number, parcel_number, unit_number, floor_area_sqm, created_at, updated_at')
      .eq('asset_id', asset.id)
      .maybeSingle<AssetRealEstateRow>(),
    supabase
      .from('asset_electronics_details')
      .select('asset_id, serial_number, inventory_number, brand, model, warranty_until, location, created_at, updated_at')
      .eq('asset_id', asset.id)
      .maybeSingle<AssetElectronicsRow>(),
    supabase
      .from('asset_insurance_details')
      .select('id, asset_id, insurance_type, provider_name, policy_number, start_date, end_date, annual_premium, deductible, insured_amount, note, created_at, updated_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('asset_electricity_details')
      .select('id, asset_id, billing_year, provider_name, ean, meter_number, period_start, period_end, consumption_kwh, total_amount, advance_payments, balance_amount, billed_on, due_date, paid_on, note, created_at, updated_at')
      .eq('asset_id', asset.id)
      .order('billing_year', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('asset_rentals')
      .select('id, asset_id, tenant_name, tenant_contact, start_date, end_date, monthly_rent, deposit_amount, note, created_at, updated_at')
      .eq('asset_id', asset.id)
      .order('start_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('asset_documents')
      .select('id, asset_id, document_type_id, title, file_name, storage_path, mime_type, file_size_bytes, note, created_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('asset_photos')
      .select('id, asset_id, title, file_name, storage_path, mime_type, file_size_bytes, note, created_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(12),
    supabase
      .from('asset_notes')
      .select('id, asset_id, body, created_by, created_at, updated_at')
      .eq('asset_id', asset.id)
      .order('created_at', { ascending: false })
      .limit(8),
    loadAssetDocumentTypes(supabase),
  ])

  if (categoriesResponse.error) {
    throw new Error('Nepodařilo se načíst kategorie majetku.')
  }

  if (rentalsResponse.error) {
    throw new Error('Nepodařilo se načíst pronájmy majetku.')
  }

  if (documentsResponse.error) {
    throw new Error('Nepodařilo se načíst dokumenty majetku.')
  }

  if (photosResponse.error) {
    throw new Error('Nepodařilo se načíst fotky majetku.')
  }

  if (insuranceResponse.error) {
    throw new Error('Nepodařilo se načíst pojištění majetku.')
  }

  if (electricityResponse.error) {
    throw new Error('Nepodařilo se načíst vyúčtování elektřiny.')
  }

  if (notesResponse.error) {
    throw new Error('Nepodařilo se načíst poznámky majetku.')
  }

  if (documentTypesResponse.error) {
    throw new Error('Nepodařilo se načíst typy dokumentů.')
  }

  const categories = (categoriesResponse.data ?? []) as AssetCategoryRow[]
  const category = categories.find((entry) => entry.id === asset.category_id)

  if (!category) {
    throw new Error('Nepodařilo se načíst kategorii majetku.')
  }

  const availableTabs = getAssetTabs(category.tabs_config, category.name)
  const activeTab = isAssetTabKey(requestedTab) && availableTabs.includes(requestedTab)
    ? requestedTab
    : availableTabs[0] ?? 'overview'

  const documentTypeMap = new Map(
    (documentTypesResponse.data ?? []).map((documentType: AssetDocumentTypeRow) => [
      documentType.id,
      documentType.name,
    ]),
  )
  const documentTypes = (documentTypesResponse.data ?? []) as AssetDocumentTypeRow[]

  const rentals = (rentalsResponse.data ?? []) as AssetRentalRow[]
  const documents = (documentsResponse.data ?? []) as AssetDocumentRow[]
  const photos = (photosResponse.data ?? []) as AssetPhotoRow[]
  const notes = (notesResponse.data ?? []) as AssetNoteRow[]
  const vehicle = (vehicleResponse.data ?? null) as AssetVehicleRow | null
  const realEstate = (realEstateResponse.data ?? null) as AssetRealEstateRow | null
  const electronics = (electronicsResponse.data ?? null) as AssetElectronicsRow | null
  const insurances = (insuranceResponse.data ?? []) as AssetInsuranceRow[]
  const electricity = (electricityResponse.data ?? []) as AssetElectricityRow[]
  const [documentsWithUrls, photosWithUrls] = await Promise.all([
    Promise.all(
      documents.map(async (document) => ({
        ...document,
        signedUrl: await createSignedUrl(supabase, document.storage_path, 60 * 10),
      })),
    ),
    Promise.all(
      photos.map(async (photo) => ({
        ...photo,
        signedUrl: await createSignedUrl(supabase, photo.storage_path, 60 * 60),
      })),
    ),
  ])
  const structuredDetailsKind =
    category.icon_key === 'car'
      ? 'vehicle'
      : category.icon_key === 'cpu'
        ? 'electronics'
        : category.icon_key === 'house' || category.icon_key === 'building'
          ? 'real_estate'
          : null

  return (
    <AssetDetailClient
      asset={asset}
      category={category}
      categories={categories}
      availableTabs={availableTabs}
      initialTab={activeTab}
      vehicle={vehicle}
      realEstate={realEstate}
      electronics={electronics}
      insurances={insurances}
      electricity={electricity}
      rentals={rentals}
      documents={documentsWithUrls}
      photos={photosWithUrls}
      notes={notes}
      documentTypes={documentTypes}
    />
  )
}
