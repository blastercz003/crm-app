import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import {
  getRentForMonth,
  type RentalRentHistoryRow,
} from '@/lib/majetek/rental-settlements'
import { AssetsPageClient } from './assets-page-client'

export const metadata: Metadata = {
  title: 'Majetek',
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetCategoryRow = {
  id: string
  name: string
  color: string
  icon_key: string
  sort_order: number
  tabs_config: unknown
}

type AssetRow = {
  id: string
  category_id: string
  name: string
  status: 'active' | 'sold'
  purchase_date: string | null
  sale_date: string | null
  purchase_price: string | number | null
  created_at: string
  updated_at: string
  vin?: string | null
  insurance_provider_name?: string | null
  insurance_total?: number | null
  insurance_policy_number?: string | null
  rental_monthly_rent?: number | null
  stk_expires_on?: string | null
}

type AssetDocumentSearchRow = {
  asset_id: string
  title: string
  file_name: string
}

type AssetPhotoSearchRow = {
  asset_id: string
  title: string
  file_name: string
}

type AssetNoteSearchRow = {
  asset_id: string
  body: string
}

type AssetElectricitySearchRow = {
  asset_id: string
  billing_year: number
  provider_name: string | null
  ean: string | null
  meter_number: string | null
  note: string | null
}

type AssetRentalSearchRow = {
  id: string
  asset_id: string
  tenant_name: string | null
  tenant_contact: string | null
  monthly_rent: string | number | null
  start_date: string | null
  created_at: string
  note: string | null
}

type AssetVehicleSearchRow = {
  asset_id: string
  vin: string | null
  stk_expires_on: string | null
}

type AssetInsuranceSearchRow = {
  asset_id: string
  provider_name: string | null
  policy_number: string | null
  annual_premium: string | number | null
  start_date: string | null
  end_date: string | null
  created_at: string
}

type AssetsPageProps = {
  searchParams?: Promise<{
    q?: string
    categoryId?: string
  }>
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function buildSearchableText(values: Array<string | null | undefined>) {
  return normalizeSearchText(values.filter(Boolean).join(' '))
}

export default async function AssetsPage({ searchParams }: AssetsPageProps) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const query = resolvedSearchParams?.q?.trim() ?? ''

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

  const [categoriesResult, assetsResult, documentsResult, photosResult, notesResult, electricityResult, rentalsResult, rentHistoryResult, vehiclesResult, insuranceResult] = await Promise.all([
    supabase
      .from('asset_categories')
      .select('id, name, color, icon_key, sort_order, tabs_config')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase
      .from('assets')
      .select('id, category_id, name, status, purchase_date, sale_date, purchase_price, created_at, updated_at')
      .order('updated_at', { ascending: false }),
    supabase
      .from('asset_documents')
      .select('asset_id, title, file_name')
      .order('created_at', { ascending: false }),
    supabase
      .from('asset_photos')
      .select('asset_id, title, file_name')
      .order('created_at', { ascending: false }),
    supabase
      .from('asset_notes')
      .select('asset_id, body')
      .order('created_at', { ascending: false }),
    supabase
      .from('asset_electricity_details')
      .select('asset_id, billing_year, provider_name, ean, meter_number, note'),
    supabase
      .from('asset_rentals')
      .select('id, asset_id, tenant_name, tenant_contact, monthly_rent, start_date, created_at, note'),
    supabase
      .from('asset_rental_rent_history')
      .select('id, rental_id, effective_from, monthly_rent, note, created_at, updated_at')
      .order('effective_from', { ascending: false }),
    supabase
      .from('asset_vehicle_details')
      .select('asset_id, vin, stk_expires_on'),
    supabase
      .from('asset_insurance_details')
      .select('asset_id, provider_name, policy_number, annual_premium, start_date, end_date, created_at'),
  ])

  if (categoriesResult.error) {
    throw new Error('Nepodařilo se načíst kategorie majetku.')
  }

  if (assetsResult.error) {
    throw new Error('Nepodařilo se načíst majetek.')
  }

  if (documentsResult.error) {
    throw new Error('Nepodařilo se načíst dokumenty majetku.')
  }

  if (photosResult.error) {
    throw new Error('Nepodařilo se načíst fotky majetku.')
  }

  if (notesResult.error) {
    throw new Error('Nepodařilo se načíst poznámky majetku.')
  }

  if (electricityResult.error) {
    throw new Error('Nepodařilo se načíst vyúčtování elektřiny.')
  }

  if (rentalsResult.error) {
    throw new Error('Nepodařilo se načíst pronájmy majetku.')
  }

  if (rentHistoryResult.error) {
    throw new Error('Nepodařilo se načíst historii nájemného.')
  }

  if (vehiclesResult.error) {
    throw new Error('Nepodařilo se načíst vozidlové údaje majetku.')
  }

  if (insuranceResult.error) {
    throw new Error('Nepodařilo se načíst pojištění majetku.')
  }

  const categories = (categoriesResult.data ?? []) as AssetCategoryRow[]
  const assets = (assetsResult.data ?? []) as AssetRow[]
  const documents = (documentsResult.data ?? []) as AssetDocumentSearchRow[]
  const photos = (photosResult.data ?? []) as AssetPhotoSearchRow[]
  const notes = (notesResult.data ?? []) as AssetNoteSearchRow[]
  const electricity = (electricityResult.data ?? []) as AssetElectricitySearchRow[]
  const rentals = (rentalsResult.data ?? []) as AssetRentalSearchRow[]
  const rentHistory = (rentHistoryResult.data ?? []) as RentalRentHistoryRow[]
  const vehicles = (vehiclesResult.data ?? []) as AssetVehicleSearchRow[]
  const insuranceRows = (insuranceResult.data ?? []) as AssetInsuranceSearchRow[]
  const defaultCategoryId =
    categories.find((category) => category.name.toLowerCase() === 'osobní vozy')?.id ??
    categories[0]?.id ??
    ''
  const requestedCategoryId = resolvedSearchParams?.categoryId?.trim() ?? ''

  const categoryById = new Map(categories.map((category) => [category.id, category]))
  const notesByAssetId = new Map<string, string[]>()
  for (const note of notes) {
    const list = notesByAssetId.get(note.asset_id) ?? []
    list.push(note.body)
    notesByAssetId.set(note.asset_id, list)
  }

  const documentsByAssetId = new Map<string, Array<{ title: string; file_name: string }>>()
  for (const document of documents) {
    const list = documentsByAssetId.get(document.asset_id) ?? []
    list.push({ title: document.title, file_name: document.file_name })
    documentsByAssetId.set(document.asset_id, list)
  }

  const photosByAssetId = new Map<string, Array<{ title: string; file_name: string }>>()
  for (const photo of photos) {
    const list = photosByAssetId.get(photo.asset_id) ?? []
    list.push({ title: photo.title, file_name: photo.file_name })
    photosByAssetId.set(photo.asset_id, list)
  }

  const electricityByAssetId = new Map<
    string,
    Array<{ billing_year: number; provider_name: string | null; ean: string | null; meter_number: string | null; note: string | null }>
  >()
  for (const record of electricity) {
    const list = electricityByAssetId.get(record.asset_id) ?? []
    list.push({
      billing_year: record.billing_year,
      provider_name: record.provider_name,
      ean: record.ean,
      meter_number: record.meter_number,
      note: record.note,
    })
    electricityByAssetId.set(record.asset_id, list)
  }

  const rentalsByAssetId = new Map<
    string,
    AssetRentalSearchRow[]
  >()
  for (const rental of rentals) {
    const list = rentalsByAssetId.get(rental.asset_id) ?? []
    list.push({
      id: rental.id,
      asset_id: rental.asset_id,
      tenant_name: rental.tenant_name,
      tenant_contact: rental.tenant_contact,
      note: rental.note,
      monthly_rent: rental.monthly_rent,
      start_date: rental.start_date,
      created_at: rental.created_at,
    })
    rentalsByAssetId.set(rental.asset_id, list)
  }

  const rentHistoryByRentalId = rentHistory.reduce<Record<string, RentalRentHistoryRow[]>>(
    (accumulator, entry) => {
      if (!accumulator[entry.rental_id]) accumulator[entry.rental_id] = []
      accumulator[entry.rental_id].push(entry)
      return accumulator
    },
    {},
  )

  const vehicleByAssetId = new Map<string, AssetVehicleSearchRow>()
  for (const vehicle of vehicles) {
    vehicleByAssetId.set(vehicle.asset_id, vehicle)
  }

  const insuranceTotalByAssetId = new Map<string, number>()
  const insuranceByAssetId = new Map<
    string,
    Array<{
      provider_name: string | null
      policy_number: string | null
      annual_premium: string | number | null
      start_date: string | null
      end_date: string | null
      created_at: string
    }>
  >()
  for (const insurance of insuranceRows) {
    const parsed = typeof insurance.annual_premium === 'number' ? insurance.annual_premium : Number(insurance.annual_premium)
    if (!Number.isFinite(parsed)) continue
    insuranceTotalByAssetId.set(
      insurance.asset_id,
      (insuranceTotalByAssetId.get(insurance.asset_id) ?? 0) + parsed
    )

    const list = insuranceByAssetId.get(insurance.asset_id) ?? []
    list.push({
      provider_name: insurance.provider_name,
      policy_number: insurance.policy_number,
      annual_premium: insurance.annual_premium,
      start_date: insurance.start_date,
      end_date: insurance.end_date,
      created_at: insurance.created_at,
    })
    insuranceByAssetId.set(insurance.asset_id, list)
  }

  function getActiveInsurance(assetId: string) {
    const records = insuranceByAssetId.get(assetId) ?? []
    if (records.length === 0) return null

    const now = new Date()

    const active = [...records].find((insurance) => {
      if (!insurance.end_date) return true
      const endDate = new Date(insurance.end_date)
      return Number.isFinite(endDate.getTime()) && endDate >= now
    })

    const fallback =
      active ??
      [...records].sort((left, right) => {
        const leftStart = left.start_date ? new Date(left.start_date).getTime() : 0
        const rightStart = right.start_date ? new Date(right.start_date).getTime() : 0

        if (rightStart !== leftStart) {
          return rightStart - leftStart
        }

        return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      })[0] ??
      null

    return fallback
  }

  const assetsWithSearchText = assets.map((asset) => {
    const category = categoryById.get(asset.category_id)
    const vehicle = vehicleByAssetId.get(asset.id) ?? null
    const insuranceTotal = insuranceTotalByAssetId.get(asset.id) ?? null
    const activeInsurance = getActiveInsurance(asset.id)
    const insurancePolicyNumber = activeInsurance?.policy_number ?? null
    const insuranceProviderName = activeInsurance?.provider_name ?? null
    const latestRental = [...(rentalsByAssetId.get(asset.id) ?? [])].sort((left, right) => {
      const leftStart = left.start_date ? new Date(left.start_date).getTime() : 0
      const rightStart = right.start_date ? new Date(right.start_date).getTime() : 0

      if (rightStart !== leftStart) {
        return rightStart - leftStart
      }

      return new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    })[0] ?? null
    const historicalMonthlyRent = latestRental
      ? getRentForMonth({
          history: rentHistoryByRentalId[latestRental.id] ?? [],
          month: new Date().toISOString().slice(0, 7),
        })
      : null
    const rentalMonthlyRent =
      historicalMonthlyRent ??
      (latestRental?.monthly_rent !== null && latestRental?.monthly_rent !== undefined
        ? Number(latestRental.monthly_rent)
        : null)
    return {
      ...asset,
      vin: vehicle?.vin ?? null,
      insurance_provider_name: insuranceProviderName,
      insurance_total: insuranceTotal,
      insurance_policy_number: insurancePolicyNumber,
      rental_monthly_rent: Number.isFinite(rentalMonthlyRent ?? NaN) ? rentalMonthlyRent : null,
      stk_expires_on: vehicle?.stk_expires_on ?? null,
      search_text: buildSearchableText([
        asset.name,
        category?.name,
        asset.status,
        asset.purchase_date,
        asset.sale_date,
        String(asset.purchase_price ?? ''),
        vehicle?.vin,
        vehicle?.stk_expires_on,
        insuranceProviderName,
        insurancePolicyNumber,
        insuranceTotal !== null ? String(insuranceTotal) : null,
        rentalMonthlyRent !== null && Number.isFinite(rentalMonthlyRent) ? String(rentalMonthlyRent) : null,
        ...(notesByAssetId.get(asset.id) ?? []),
        ...(documentsByAssetId.get(asset.id) ?? []).flatMap((document) => [document.title, document.file_name]),
        ...(photosByAssetId.get(asset.id) ?? []).flatMap((photo) => [photo.title, photo.file_name]),
        ...(electricityByAssetId.get(asset.id) ?? []).flatMap((record) => [
          String(record.billing_year),
          record.provider_name,
          record.ean,
          record.meter_number,
          record.note,
        ]),
        ...(rentalsByAssetId.get(asset.id) ?? []).flatMap((rental) => [
          rental.tenant_name,
          rental.tenant_contact,
          rental.note,
        ]),
      ]),
    }
  })

  return (
    <AssetsPageClient
      categories={categories}
      assets={assetsWithSearchText}
      initialQuery={query}
      initialCategoryId={requestedCategoryId}
      defaultCategoryId={defaultCategoryId}
    />
  )
}
