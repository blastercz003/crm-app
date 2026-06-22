'use client'

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, CarFront, Cpu, House } from 'lucide-react'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { AssetAttachmentUploadPanel } from './asset-attachment-upload-panel'
import { AssetElectricitySection, type AssetElectricityRow } from './asset-electricity-form'
import { AssetDocumentDeleteButton } from './asset-document-delete-button'
import { AssetInsuranceSection, type AssetInsuranceRow } from './asset-insurance-form'
import { AssetNoteDeleteButton } from './asset-note-delete-button'
import { AssetNoteForm } from './asset-note-form'
import { AssetRentalSection } from './asset-rental-form'
import {
  AssetRentalServiceSettlementsSection,
} from './asset-rental-service-settlements'
import { EditAssetButton } from './edit-asset-button'
import { EditStructuredDetailsButton } from './edit-structured-details-button'
import {
  ASSET_TAB_LABELS,
  documentTypeMatchesTab,
} from '@/lib/majetek/detail'
import type {
  RentalServiceAdvanceHistoryRow,
  RentalServiceSettlementCustomItemRow,
  RentalServiceSettlementFileRow,
  RentalServiceSettlementRow,
} from '@/lib/majetek/rental-settlements'
import { ASSET_DOCUMENT_TYPE_SEED_TABS_BY_LABEL } from '@/lib/majetek/config'
import type { AssetTabKey } from '@/lib/majetek/types'

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

type AssetRentalServiceAdvanceHistoryRow = RentalServiceAdvanceHistoryRow
type AssetRentalServiceSettlementRow = RentalServiceSettlementRow
type AssetRentalServiceSettlementFileRow = RentalServiceSettlementFileRow & {
  signedUrl: string | null
}

type AssetDocumentViewRow = {
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
  signedUrl: string | null
}

type AssetPhotoViewRow = {
  id: string
  asset_id: string
  title: string
  file_name: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  note: string | null
  created_at: string
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

type AssetDetailClientProps = {
  asset: AssetRow
  category: AssetCategoryRow
  categories: AssetCategoryRow[]
  availableTabs: AssetTabKey[]
  initialTab: AssetTabKey
  vehicle: AssetVehicleRow | null
  realEstate: AssetRealEstateRow | null
  electronics: AssetElectronicsRow | null
  insurances: AssetInsuranceRow[]
  electricity: AssetElectricityRow[]
  rentals: AssetRentalRow[]
  rentalServiceAdvanceHistory: AssetRentalServiceAdvanceHistoryRow[]
  rentalServiceSettlements: AssetRentalServiceSettlementRow[]
  rentalServiceSettlementFiles: AssetRentalServiceSettlementFileRow[]
  rentalServiceSettlementCustomItems: RentalServiceSettlementCustomItemRow[]
  documents: AssetDocumentViewRow[]
  photos: AssetPhotoViewRow[]
  notes: AssetNoteRow[]
  documentTypes: AssetDocumentTypeRow[]
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

function getLatestRental(records: AssetRentalRow[]) {
  return [...records].sort((left, right) => {
    const leftStart = left.start_date ? new Date(left.start_date).getTime() : 0
    const rightStart = right.start_date ? new Date(right.start_date).getTime() : 0

    if (rightStart !== leftStart) {
      return rightStart - leftStart
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  })[0] ?? null
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

function statusLabel(status: AssetRow['status']) {
  return status === 'sold' ? 'Prodáno' : 'Aktivní'
}

function statusTone(status: AssetRow['status']) {
  return status === 'sold'
    ? 'border border-amber-200/90 bg-[linear-gradient(155deg,rgba(255,247,237,0.92)_0%,rgba(254,243,199,0.84)_100%)] text-amber-800'
    : 'border border-emerald-200/90 bg-[linear-gradient(155deg,rgba(236,253,245,0.92)_0%,rgba(220,252,231,0.84)_100%)] text-emerald-800'
}

function CompactStat({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="assets-detail-page__compact-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{title}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-gray-500">{note}</p> : null}
    </div>
  )
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
  return <CompactStat title={title} value={value} note={note} />
}

function OverviewCard({
  title,
  value,
  note,
}: {
  title: string
  value: string
  note?: string
}) {
  return (
    <div className="assets-detail-page__overview-card flex h-full min-h-[62px] items-center justify-between gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
      <p className="text-[11px] font-medium uppercase tracking-wide leading-none text-gray-500">{title}</p>
      <p className="text-sm font-semibold leading-none text-right text-gray-900 whitespace-nowrap">{value}</p>
      {note ? <p className="mt-1 text-xs leading-5 text-gray-500">{note}</p> : null}
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
      <div className="assets-detail-page__section-header border-b border-white/70 px-5 py-4 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-zinc-500">{description}</p> : null}
      </div>

      <div className="p-5 sm:p-6">{children}</div>
    </section>
  )
}

const emptyStateClassName =
  'assets-detail-page__empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] p-6 text-sm text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[8px]'

function getActiveInsurance(insurances: AssetInsuranceRow[]) {
  const now = new Date()

  return [...insurances].find((insurance) => {
    if (!insurance.end_date) return true
    const endDate = new Date(insurance.end_date)
    return Number.isFinite(endDate.getTime()) && endDate >= now
  }) ?? null
}

function DocumentList({
  assetId,
  documents,
  documentTypeMap,
  emptyMessage,
}: {
  assetId: string
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
  emptyMessage: string
}) {
  if (documents.length === 0) {
    return (
      <div className={emptyStateClassName}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {documents.map((document) => (
        <div
          key={document.id}
          className="assets-detail-page__document-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_22px_rgba(15,23,42,0.12)]"
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <a
                href={document.signedUrl ?? '#'}
                target={document.signedUrl ? '_blank' : undefined}
                rel={document.signedUrl ? 'noreferrer' : undefined}
                aria-disabled={!document.signedUrl}
                onClick={(event) => {
                  if (!document.signedUrl) {
                    event.preventDefault()
                  }
                }}
                className="min-w-0 flex-1"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  {documentTypeMap.get(document.document_type_id) ?? 'Dokument'}
                </p>
                <h3 className="mt-1 truncate text-sm font-semibold text-gray-900">{document.title}</h3>
                <p className="mt-1 truncate text-xs text-gray-500">{document.file_name}</p>
              </a>

              <div className="assets-detail-page__document-meta grid gap-2 text-xs text-gray-600 md:text-right">
                <p>{formatBytes(document.file_size_bytes)}</p>
                <p>{formatDateTime(document.created_at)}</p>
                <p className="assets-detail-page__document-link font-medium text-[#2f77af]">
                  {document.signedUrl ? 'Otevřít dokument' : 'Odkaz není k dispozici'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              {document.note ? <p className="assets-detail-page__document-note text-sm leading-6 text-gray-600">{document.note}</p> : <span />}
              <AssetDocumentDeleteButton assetId={assetId} documentId={document.id} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DocumentSidebar({
  assetId,
  title,
  description,
  documents,
  documentTypeMap,
  emptyMessage,
}: {
  assetId: string
  title: string
  description?: string
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
  emptyMessage: string
}) {
  return (
    <SectionShell title={title} description={description}>
      <DocumentList
        assetId={assetId}
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage={emptyMessage}
      />
    </SectionShell>
  )
}

function renderOverviewTab({
  asset,
  category,
  vehicle,
  rentals,
  insurances,
  documentsCount,
  photosCount,
  notesCount,
}: {
  asset: AssetRow
  category: AssetCategoryRow
  vehicle: AssetVehicleRow | null
  rentals: AssetRentalRow[]
  insurances: AssetInsuranceRow[]
  documentsCount: number
  photosCount: number
  notesCount: number
}) {
  const activeInsurance = getActiveInsurance(insurances)
  const showVinCard = category.name === 'Osobní vozy'
  const showRentalCard = category.icon_key === 'house' || category.icon_key === 'building'
  const latestRental = getLatestRental(rentals)

  return (
    <SectionShell title="Základní přehled">
      <div className="assets-page__summary space-y-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <OverviewCard title="Název" value={asset.name} />
          <OverviewCard title="Kategorie" value={category.name} />
          <OverviewCard title="Stav" value={statusLabel(asset.status)} />
          <OverviewCard title="Pořizovací cena" value={formatCurrency(asset.purchase_price)} />
          <OverviewCard
            title={showVinCard ? 'VIN vozidla' : 'Aktivní pojistka'}
            value={showVinCard ? vehicle?.vin ?? '—' : activeInsurance ? 'Ano' : 'Ne'}
          />
          <OverviewCard
            title={showRentalCard ? 'NÁJEMNÉ' : 'Pojistné'}
            value={
              showRentalCard
                ? latestRental
                  ? formatCurrency(latestRental.monthly_rent)
                  : '—'
                : activeInsurance
                  ? formatCurrency(activeInsurance.annual_premium)
                  : '—'
            }
          />
          {!showRentalCard ? (
            <OverviewCard
              title="STK expirace"
              value={vehicle?.stk_expires_on ? formatDate(vehicle.stk_expires_on) : '—'}
            />
          ) : null}
          <OverviewCard title="Vytvořeno" value={formatDateTime(asset.created_at)} />
          <OverviewCard title="Aktualizováno" value={formatDateTime(asset.updated_at)} />
          <OverviewCard title="Dokumenty" value={String(documentsCount)} />
          <OverviewCard title="Fotky" value={String(photosCount)} />
          <OverviewCard title="Poznámky" value={String(notesCount)} />
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
  documentTypes: AssetDocumentTypeRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <AssetAttachmentUploadPanel assetId={assetId} kind="documents" documentTypes={documentTypes} />

      <DocumentSidebar
        assetId={assetId}
        title="Dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="Zatím zde nejsou žádné dokumenty."
      />
    </div>
  )
}

function renderPhotosTab({
  assetId,
  photos,
  documents,
  documentTypeMap,
}: {
  assetId: string
  photos: AssetPhotoViewRow[]
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <SectionShell title="Fotky">
        <div className="space-y-5">
          <AssetAttachmentUploadPanel assetId={assetId} kind="photos" />

          {photos.length > 0 ? (
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
          ) : (
            <div className={emptyStateClassName}>
              Zatím zde nejsou žádné fotky.
            </div>
          )}
        </div>
      </SectionShell>

      <DocumentSidebar
        assetId={assetId}
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K tomuto tabu zatím nejsou navázané žádné dokumenty."
      />
    </div>
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
        assetId={assetId}
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K pojištění zatím nejsou navázané žádné dokumenty."
      />
    </div>
  )
}

function renderStkTab({
  assetId,
  vehicle,
  documents,
  documentTypeMap,
}: {
  assetId: string
  vehicle: AssetVehicleRow | null
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <SectionShell title="STK">
        {vehicle ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TabCard
              title="STK končí"
              value={formatDate(vehicle.stk_expires_on)}
              note="Termín technické kontroly."
            />
            <TabCard title="SPZ" value={vehicle.registration_plate} />
            <TabCard
              title="Nájezd"
              value={vehicle.mileage_km !== null ? `${vehicle.mileage_km.toLocaleString('cs-CZ')} km` : '—'}
            />
          </div>
        ) : (
          <div className={emptyStateClassName}>
            STK údaje zde nejsou vyplněné.
          </div>
        )}
      </SectionShell>

      <DocumentSidebar
        assetId={assetId}
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K STK zatím nejsou navázané žádné dokumenty."
      />
    </div>
  )
}

function renderServiceTab({
  assetId,
  vehicle,
  documents,
  documentTypeMap,
}: {
  assetId: string
  vehicle: AssetVehicleRow | null
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
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
          <div className={emptyStateClassName}>
            Servisní data zatím nejsou k dispozici.
          </div>
        )}
      </SectionShell>

      <DocumentSidebar
        assetId={assetId}
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K servisu zatím nejsou navázané žádné dokumenty."
      />
    </div>
  )
}

function renderRentTab({
  assetId,
  rentals,
  rentalServiceAdvanceHistory,
  rentalServiceSettlements,
  rentalServiceSettlementFiles,
  rentalServiceSettlementCustomItems,
  documents,
  documentTypeMap,
}: {
  assetId: string
  rentals: AssetRentalRow[]
  rentalServiceAdvanceHistory: AssetRentalServiceAdvanceHistoryRow[]
  rentalServiceSettlements: AssetRentalServiceSettlementRow[]
  rentalServiceSettlementFiles: AssetRentalServiceSettlementFileRow[]
  rentalServiceSettlementCustomItems: RentalServiceSettlementCustomItemRow[]
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  const advanceHistoryByRentalId = rentalServiceAdvanceHistory.reduce<Record<string, AssetRentalServiceAdvanceHistoryRow[]>>(
    (accumulator, entry) => {
      if (!accumulator[entry.rental_id]) {
        accumulator[entry.rental_id] = []
      }

      accumulator[entry.rental_id].push(entry)
      return accumulator
    },
    {},
  )

  const settlementFilesBySettlementId = rentalServiceSettlementFiles.reduce<Record<string, AssetRentalServiceSettlementFileRow[]>>(
    (accumulator, entry) => {
      if (!accumulator[entry.settlement_id]) {
        accumulator[entry.settlement_id] = []
      }

      accumulator[entry.settlement_id].push(entry)
      return accumulator
    },
    {},
  )

  const settlementCustomItemsBySettlementId = rentalServiceSettlementCustomItems.reduce<Record<string, RentalServiceSettlementCustomItemRow[]>>(
    (accumulator, entry) => {
      if (!accumulator[entry.settlement_id]) {
        accumulator[entry.settlement_id] = []
      }

      accumulator[entry.settlement_id].push(entry)
      return accumulator
    },
    {},
  )

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="space-y-5">
        <AssetRentalSection
          assetId={assetId}
          rentals={rentals}
          advanceHistoryByRentalId={advanceHistoryByRentalId}
        />

        <AssetRentalServiceSettlementsSection
          assetId={assetId}
          rentals={rentals}
          settlements={rentalServiceSettlements}
          settlementFilesBySettlementId={settlementFilesBySettlementId}
          settlementCustomItemsBySettlementId={settlementCustomItemsBySettlementId}
        />
      </div>

      <div className="space-y-5">
        <DocumentSidebar
          assetId={assetId}
          title="Související dokumenty"
          documents={documents}
          documentTypeMap={documentTypeMap}
          emptyMessage="K pronájmu zatím nejsou navázané žádné dokumenty."
        />

      </div>
    </div>
  )
}

function renderElectricityTab({
  assetId,
  electricityRecords,
  documents,
  documentTypeMap,
}: {
  assetId: string
  electricityRecords: AssetElectricityRow[]
  documents: AssetDocumentViewRow[]
  documentTypeMap: Map<string, string>
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)]">
      <AssetElectricitySection assetId={assetId} electricityRecords={electricityRecords} />

      <DocumentSidebar
        assetId={assetId}
        title="Související dokumenty"
        documents={documents}
        documentTypeMap={documentTypeMap}
        emptyMessage="K elektřině zatím nejsou navázané žádné dokumenty."
      />
    </div>
  )
}

function renderRepairsTab({
  assetId,
  notes,
}: {
  assetId: string
  notes: AssetNoteRow[]
}) {
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
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs text-gray-500">{formatDateTime(note.created_at)}</p>
                  <AssetNoteDeleteButton assetId={assetId} noteId={note.id} />
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{note.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className={emptyStateClassName}>
            Zatím zde nejsou žádné poznámky.
          </div>
        )}
      </SectionShell>
    </div>
  )
}

export function AssetDetailClient({
  asset,
  category,
  categories,
  availableTabs,
  initialTab,
  vehicle,
  realEstate,
  electronics,
  insurances,
  electricity,
  rentals,
  rentalServiceAdvanceHistory,
  rentalServiceSettlements,
  rentalServiceSettlementFiles,
  rentalServiceSettlementCustomItems,
  documents,
  photos,
  notes,
  documentTypes,
}: AssetDetailClientProps) {
  const [activeTab, setActiveTab] = useState<AssetTabKey>(initialTab)

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href)
      const requestedTab = url.searchParams.get('tab')
      if (requestedTab && availableTabs.includes(requestedTab as AssetTabKey)) {
        setActiveTab(requestedTab as AssetTabKey)
      } else {
        setActiveTab(initialTab)
      }
    }

    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [availableTabs, initialTab])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (activeTab === 'overview') {
      url.searchParams.delete('tab')
    } else {
      url.searchParams.set('tab', activeTab)
    }
    window.history.pushState({}, '', `${url.pathname}${url.search}`)
  }, [activeTab])

  const documentTypeMap = new Map(documentTypes.map((documentType) => [documentType.id, documentType.name]))
  const documentTypeTabsMap = new Map(
    documentTypes.map((documentType) => [
      documentType.id,
      Array.isArray(documentType.tabs_config) && documentType.tabs_config.length > 0
        ? documentType.tabs_config
        : ASSET_DOCUMENT_TYPE_SEED_TABS_BY_LABEL.get(documentType.name) ?? [],
    ])
  )
  const linkedDocumentsForActiveTab =
    activeTab === 'documents'
      ? documents
      : documents.filter((document) => {
          return documentTypeMatchesTab(documentTypeTabsMap.get(document.document_type_id), activeTab)
        })

  const structuredDetailsKind =
    category.icon_key === 'car'
      ? 'vehicle'
      : category.icon_key === 'cpu'
        ? 'electronics'
        : category.icon_key === 'house' || category.icon_key === 'building'
          ? 'real_estate'
          : null

  return (
    <main className="assets-page assets-detail-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Majetek detail" route={`/majetek/${asset.id}`} />
      <div
        aria-hidden
        className="assets-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="assets-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1720px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="assets-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_18px_rgba(15,23,42,0.14)]"
                  style={{ background: category.color }}
                >
                  <AssetCategoryIcon iconKey={category.icon_key} />
                </div>
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                    {asset.name}
                  </h1>
                  <p className="mt-2 text-sm text-zinc-500">
                    Detail záznamu majetku s kategoriemi, dokumenty, fotkami a poznámkami.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
                <EditAssetButton
                  asset={{
                    id: asset.id,
                    category_id: asset.category_id,
                    name: asset.name,
                    status: asset.status,
                    purchase_date: asset.purchase_date,
                    sale_date: asset.sale_date,
                    purchase_price: asset.purchase_price,
                  }}
                  categories={categories}
                  className="w-full sm:w-auto"
                />

                {structuredDetailsKind ? (
                  <EditStructuredDetailsButton
                    assetId={asset.id}
                    kind={structuredDetailsKind}
                    currentValues={
                      structuredDetailsKind === 'vehicle'
                          ? {
                              registration_plate: vehicle?.registration_plate ?? '',
                              vin: vehicle?.vin ?? '',
                              brand: vehicle?.brand ?? '',
                              model: vehicle?.model ?? '',
                              year_of_manufacture: vehicle?.year_of_manufacture ?? null,
                              mileage_km: vehicle?.mileage_km ?? null,
                              stk_expires_on: vehicle?.stk_expires_on ?? '',
                            }
                        : structuredDetailsKind === 'real_estate'
                          ? {
                              address: realEstate?.address ?? '',
                              cadastral_area: realEstate?.cadastral_area ?? '',
                              land_registry_number: realEstate?.land_registry_number ?? '',
                              parcel_number: realEstate?.parcel_number ?? '',
                              unit_number: realEstate?.unit_number ?? '',
                              floor_area_sqm: realEstate?.floor_area_sqm ?? null,
                            }
                          : {
                              serial_number: electronics?.serial_number ?? '',
                              inventory_number: electronics?.inventory_number ?? '',
                              brand: electronics?.brand ?? '',
                              model: electronics?.model ?? '',
                              warranty_until: electronics?.warranty_until ?? '',
                              location: electronics?.location ?? '',
                          }
                    }
                    className="w-full sm:w-auto"
                  />
                ) : null}

                <Link
                  href="/majetek"
                  className="clients-page__back-button inline-flex w-full items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800 sm:w-auto"
                >
                  ZPĚT NA MAJETEK
                </Link>

              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="assets-detail-page__meta-pill inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
                {category.name}
              </span>
              <span className={`assets-detail-page__meta-pill assets-detail-page__status-pill assets-detail-page__status-pill--${asset.status === 'sold' ? 'sold' : 'active'} inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] ${statusTone(asset.status)}`}>
                {statusLabel(asset.status)}
              </span>
            </div>
          </div>
        </section>

        <section className="assets-detail-page__tabs-shell rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
          <div className="assets-detail-page__tabs grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-2">
            {availableTabs.map((tab) => {
              const isActive = tab === activeTab

              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  data-active={isActive ? 'true' : 'false'}
                  style={
                    {
                      '--asset-tab-accent': category.color,
                      borderColor: isActive ? category.color : `${category.color}33`,
                    } as CSSProperties
                  }
                  className="assets-detail-page__tab inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-2xl border px-4 py-2.5 text-xs font-medium transition duration-200 sm:w-auto sm:text-sm"
                >
                  <span>{ASSET_TAB_LABELS[tab]}</span>
                </button>
              )
            })}
          </div>
        </section>

        {activeTab === 'overview' ? (
          <div className="min-w-0">
            {renderOverviewTab({
              asset,
              category,
              vehicle,
              rentals,
              insurances,
              documentsCount: documents.length,
              photosCount: photos.length,
              notesCount: notes.length,
            })}
          </div>
        ) : (
          <div className="min-w-0">
            {activeTab === 'documents'
              ? renderDocumentsTab({
                  assetId: asset.id,
                  documents,
                  documentTypes,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'photos'
              ? renderPhotosTab({
                  assetId: asset.id,
                  photos,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'insurance'
              ? renderInsuranceTab({
                  assetId: asset.id,
                  insurances,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'stk'
              ? renderStkTab({
                  assetId: asset.id,
                  vehicle,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'service'
              ? renderServiceTab({
                  assetId: asset.id,
                  vehicle,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'rent'
              ? renderRentTab({
                  assetId: asset.id,
                  rentals,
                  rentalServiceAdvanceHistory,
                  rentalServiceSettlements,
                  rentalServiceSettlementFiles,
                  rentalServiceSettlementCustomItems,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
              })
              : null}
            {activeTab === 'electricity'
              ? renderElectricityTab({
                  assetId: asset.id,
                  electricityRecords: electricity,
                  documents: linkedDocumentsForActiveTab,
                  documentTypeMap,
                })
              : null}
            {activeTab === 'repairs'
              ? renderRepairsTab({
                  assetId: asset.id,
                  notes,
                })
              : null}
          </div>
        )}
      </div>
    </main>
  )
}
