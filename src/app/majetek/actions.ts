'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'

export type CreateAssetActionState = {
  success: boolean
  error: string | null
  assetId?: string
  assetName?: string
}

export type UpdateAssetActionState = {
  success: boolean
  error: string | null
  assetId?: string
  assetName?: string
}

export type AssetStructuredDetailsKind = 'vehicle' | 'real_estate' | 'electronics'

export type UpdateAssetStructuredDetailsActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type UpdateAssetInsuranceActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type DeleteAssetInsuranceActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type UpdateAssetElectricityActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type DeleteAssetElectricityActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type UpdateAssetRentalActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type DeleteAssetRentalActionState = {
  success: boolean
  error: string | null
  assetId?: string
}

export type CreateAssetNoteActionState = {
  success: boolean
  error: string | null
}

export type DeleteAssetNoteActionState = {
  success: boolean
  error: string | null
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetCategoryRow = {
  id: string
  name: string
}

type AssetRow = {
  id: string
  category_id: string
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text.length > 0 ? text : null
}

function normalizeStatus(value: FormDataEntryValue | null) {
  return String(value ?? 'active') === 'sold' ? 'sold' : 'active'
}

function normalizeDate(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function normalizeCurrency(value: FormDataEntryValue | null) {
  const text = normalizeText(value).replaceAll(/\s+/g, '').replace(',', '.')

  if (!text) return null

  const parsed = Number(text)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function normalizeSignedFloat(value: FormDataEntryValue | null) {
  const text = normalizeText(value).replaceAll(/\s+/g, '').replace(',', '.')

  if (!text) return null

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function buildFailure(error: string): CreateAssetActionState {
  return { success: false, error }
}

function buildSuccess(params: { assetId: string; assetName: string }): CreateAssetActionState {
  return {
    success: true,
    error: null,
    assetId: params.assetId,
    assetName: params.assetName,
  }
}

function buildUpdateSuccess(params: {
  assetId: string
  assetName: string
}): UpdateAssetActionState {
  return {
    success: true,
    error: null,
    assetId: params.assetId,
    assetName: params.assetName,
  }
}

function buildUpdateFailure(error: string): UpdateAssetActionState {
  return { success: false, error }
}

function buildStructuredFailure(error: string): UpdateAssetStructuredDetailsActionState {
  return { success: false, error }
}

function buildStructuredSuccess(assetId: string): UpdateAssetStructuredDetailsActionState {
  return { success: true, error: null, assetId }
}

function buildInsuranceFailure(error: string): UpdateAssetInsuranceActionState {
  return { success: false, error }
}

function buildInsuranceSuccess(assetId: string): UpdateAssetInsuranceActionState {
  return { success: true, error: null, assetId }
}

function buildDeleteInsuranceFailure(error: string): DeleteAssetInsuranceActionState {
  return { success: false, error }
}

function buildDeleteInsuranceSuccess(assetId: string): DeleteAssetInsuranceActionState {
  return { success: true, error: null, assetId }
}

function buildElectricityFailure(error: string): UpdateAssetElectricityActionState {
  return { success: false, error }
}

function buildElectricitySuccess(assetId: string): UpdateAssetElectricityActionState {
  return { success: true, error: null, assetId }
}

function buildDeleteElectricityFailure(error: string): DeleteAssetElectricityActionState {
  return { success: false, error }
}

function buildDeleteElectricitySuccess(assetId: string): DeleteAssetElectricityActionState {
  return { success: true, error: null, assetId }
}

function buildRentalFailure(error: string): UpdateAssetRentalActionState {
  return { success: false, error }
}

function buildRentalSuccess(assetId: string): UpdateAssetRentalActionState {
  return { success: true, error: null, assetId }
}

function buildDeleteRentalFailure(error: string): DeleteAssetRentalActionState {
  return { success: false, error }
}

function buildDeleteRentalSuccess(assetId: string): DeleteAssetRentalActionState {
  return { success: true, error: null, assetId }
}

function buildNoteFailure(error: string): CreateAssetNoteActionState {
  return { success: false, error }
}

function buildNoteSuccess(): CreateAssetNoteActionState {
  return { success: true, error: null }
}

function buildDeleteNoteFailure(error: string): DeleteAssetNoteActionState {
  return { success: false, error }
}

function buildDeleteNoteSuccess(): DeleteAssetNoteActionState {
  return { success: true, error: null }
}

async function requireAssetsAdmin() {
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

  if (error || !profile) {
    return { supabase, error: 'Nepodařilo se ověřit oprávnění uživatele.' as const }
  }

  const typedProfile = profile as ProfilePermissionRow
  if (!canViewAssetsSection(typedProfile.role, typedProfile)) {
    return { supabase, error: 'Nemáš oprávnění vytvářet majetek.' as const }
  }

  return { supabase, userId: user.id, error: null }
}

async function requireAssetCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string,
) {
  const { data, error } = await supabase
    .from('asset_categories')
    .select('id, name')
    .eq('id', categoryId)
    .maybeSingle<AssetCategoryRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit kategorii majetku.')
  }

  if (!data) {
    throw new Error('Vybraná kategorie majetku neexistuje.')
  }

  return data
}

async function requireAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
) {
  const { data, error } = await supabase
    .from('assets')
    .select('id, category_id')
    .eq('id', assetId)
    .maybeSingle<AssetRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit majetek.')
  }

  if (!data) {
    throw new Error('Vybraný majetek neexistuje.')
  }

  return data
}

function normalizeInteger(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  if (!text) return null

  const parsed = Number.parseInt(text, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeFloat(value: FormDataEntryValue | null) {
  const text = normalizeText(value).replaceAll(/\s+/g, '').replace(',', '.')
  if (!text) return null

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

export async function createAssetAction(
  _prevState: CreateAssetActionState,
  formData: FormData
): Promise<CreateAssetActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const assetName = normalizeText(formData.get('name'))
  if (!assetName) {
    return buildFailure('Název majetku je povinný.')
  }

  const categoryId = normalizeText(formData.get('category_id'))
  if (!categoryId) {
    return buildFailure('Kategorie majetku je povinná.')
  }

  try {
    await requireAssetCategory(auth.supabase, categoryId)
  } catch (error) {
    return buildFailure(error instanceof Error ? error.message : 'Kategorie majetku není dostupná.')
  }

  const { data, error } = await auth.supabase
    .from('assets')
    .insert({
      category_id: categoryId,
      name: assetName,
      status: normalizeStatus(formData.get('status')),
      purchase_date: normalizeDate(formData.get('purchase_date')),
      sale_date: normalizeDate(formData.get('sale_date')),
      purchase_price: normalizeCurrency(formData.get('purchase_price')),
    })
    .select('id')
    .single<{ id: string }>()

  if (error || !data) {
    return buildFailure('Majetek se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')
  revalidatePath(`/majetek/${data.id}`)

  return buildSuccess({ assetId: data.id, assetName })
}

export async function updateAssetAction(
  _prevState: UpdateAssetActionState,
  formData: FormData
): Promise<UpdateAssetActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildUpdateFailure(auth.error)

  const assetId = normalizeText(formData.get('id'))
  if (!assetId) {
    return buildUpdateFailure('Chybí ID majetku.')
  }

  const assetName = normalizeText(formData.get('name'))
  if (!assetName) {
    return buildUpdateFailure('Název majetku je povinný.')
  }

  const categoryId = normalizeText(formData.get('category_id'))
  if (!categoryId) {
    return buildUpdateFailure('Kategorie majetku je povinná.')
  }

  try {
    await requireAssetCategory(auth.supabase, categoryId)
  } catch (error) {
    return buildUpdateFailure(error instanceof Error ? error.message : 'Kategorie majetku není dostupná.')
  }

  const { error } = await auth.supabase
    .from('assets')
    .update({
      category_id: categoryId,
      name: assetName,
      status: normalizeStatus(formData.get('status')),
      purchase_date: normalizeDate(formData.get('purchase_date')),
      sale_date: normalizeDate(formData.get('sale_date')),
      purchase_price: normalizeCurrency(formData.get('purchase_price')),
    })
    .eq('id', assetId)

  if (error) {
    return buildUpdateFailure('Majetek se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')
  revalidatePath(`/majetek/${assetId}`)

  return buildUpdateSuccess({ assetId, assetName })
}

export async function updateAssetStructuredDetailsAction(
  _prevState: UpdateAssetStructuredDetailsActionState,
  formData: FormData
): Promise<UpdateAssetStructuredDetailsActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildStructuredFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildStructuredFailure('Chybí ID majetku.')

  const detailKind = normalizeText(formData.get('detail_kind')) as AssetStructuredDetailsKind
  if (!['vehicle', 'real_estate', 'electronics'].includes(detailKind)) {
    return buildStructuredFailure('Neplatný typ detailu.')
  }

  let asset: AssetRow
  try {
    asset = await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildStructuredFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const category = await auth.supabase
    .from('asset_categories')
    .select('id, name, icon_key')
    .eq('id', asset.category_id)
    .single<{ id: string; name: string; icon_key: string }>()

  if (category.error || !category.data) {
    return buildStructuredFailure('Nepodařilo se ověřit kategorii majetku.')
  }

  const categoryIcon = category.data.icon_key
  if (detailKind === 'vehicle' && categoryIcon !== 'car') {
    return buildStructuredFailure('Tento detail je dostupný jen pro vozidla.')
  }

  if (detailKind === 'real_estate' && categoryIcon === 'car') {
    return buildStructuredFailure('Tento detail je určený pro domy a byty.')
  }

  if (detailKind === 'electronics' && categoryIcon !== 'cpu') {
    return buildStructuredFailure('Tento detail je dostupný jen pro elektroniku.')
  }

  if (detailKind === 'vehicle') {
    const registrationPlate = normalizeText(formData.get('registration_plate'))
    if (!registrationPlate) {
      return buildStructuredFailure('SPZ je povinná.')
    }

    const { error } = await auth.supabase.from('asset_vehicle_details').upsert(
      {
        asset_id: assetId,
        registration_plate: registrationPlate,
        vin: normalizeOptionalText(formData.get('vin')),
        brand: normalizeOptionalText(formData.get('brand')),
        model: normalizeOptionalText(formData.get('model')),
        year_of_manufacture: normalizeInteger(formData.get('year_of_manufacture')),
        mileage_km: normalizeInteger(formData.get('mileage_km')),
        stk_expires_on: normalizeDate(formData.get('stk_expires_on')),
      },
      { onConflict: 'asset_id' }
    )

    if (error) {
      return buildStructuredFailure('Vozidlové údaje se nepodařilo uložit.')
    }
  }

  if (detailKind === 'real_estate') {
    const { error } = await auth.supabase.from('asset_real_estate_details').upsert(
      {
        asset_id: assetId,
        address: normalizeOptionalText(formData.get('address')),
        cadastral_area: normalizeOptionalText(formData.get('cadastral_area')),
        land_registry_number: normalizeOptionalText(formData.get('land_registry_number')),
        parcel_number: normalizeOptionalText(formData.get('parcel_number')),
        unit_number: normalizeOptionalText(formData.get('unit_number')),
        floor_area_sqm: normalizeFloat(formData.get('floor_area_sqm')),
      },
      { onConflict: 'asset_id' }
    )

    if (error) {
      return buildStructuredFailure('Údaje o nemovitosti se nepodařilo uložit.')
    }
  }

  if (detailKind === 'electronics') {
    const { error } = await auth.supabase.from('asset_electronics_details').upsert(
      {
        asset_id: assetId,
        serial_number: normalizeOptionalText(formData.get('serial_number')),
        inventory_number: normalizeOptionalText(formData.get('inventory_number')),
        brand: normalizeOptionalText(formData.get('brand')),
        model: normalizeOptionalText(formData.get('model')),
        warranty_until: normalizeDate(formData.get('warranty_until')),
        location: normalizeOptionalText(formData.get('location')),
      },
      { onConflict: 'asset_id' }
    )

    if (error) {
      return buildStructuredFailure('Údaje o elektronice se nepodařilo uložit.')
    }
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildStructuredSuccess(assetId)
}

export async function upsertAssetInsuranceAction(
  _prevState: UpdateAssetInsuranceActionState,
  formData: FormData
): Promise<UpdateAssetInsuranceActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildInsuranceFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildInsuranceFailure('Chybí ID majetku.')

  const insuranceId = normalizeOptionalText(formData.get('insurance_id'))

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildInsuranceFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const insuranceType = normalizeOptionalText(formData.get('insurance_type'))
  const providerName = normalizeOptionalText(formData.get('provider_name'))
  const policyNumber = normalizeOptionalText(formData.get('policy_number'))
  const startDate = normalizeDate(formData.get('start_date'))
  const endDate = normalizeDate(formData.get('end_date'))
  const annualPremium = normalizeCurrency(formData.get('annual_premium'))
  const deductible = normalizeCurrency(formData.get('deductible'))
  const insuredAmount = normalizeCurrency(formData.get('insured_amount'))
  const note = normalizeOptionalText(formData.get('note'))

  const hasAnyValue = [
    insuranceType,
    providerName,
    policyNumber,
    startDate,
    endDate,
    annualPremium,
    deductible,
    insuredAmount,
    note,
  ].some((value) => value !== null && value !== undefined && String(value).trim() !== '')

  if (!hasAnyValue) {
    return buildInsuranceFailure('Vyplň alespoň jeden údaj pojištění.')
  }

  const { error } = insuranceId
    ? await auth.supabase
        .from('asset_insurance_details')
        .update({
          asset_id: assetId,
          insurance_type: insuranceType,
          provider_name: providerName,
          policy_number: policyNumber,
          start_date: startDate,
          end_date: endDate,
          annual_premium: annualPremium,
          deductible,
          insured_amount: insuredAmount,
          note,
        })
        .eq('id', insuranceId)
        .eq('asset_id', assetId)
    : await auth.supabase.from('asset_insurance_details').insert({
        asset_id: assetId,
        insurance_type: insuranceType,
        provider_name: providerName,
        policy_number: policyNumber,
        start_date: startDate,
        end_date: endDate,
        annual_premium: annualPremium,
        deductible,
        insured_amount: insuredAmount,
        note,
      })

  if (error) {
    return buildInsuranceFailure('Pojištění se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')
  revalidatePath(`/majetek/${assetId}`)

  return buildInsuranceSuccess(assetId)
}

export async function deleteAssetInsuranceAction(
  _prevState: DeleteAssetInsuranceActionState,
  formData: FormData
): Promise<DeleteAssetInsuranceActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteInsuranceFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildDeleteInsuranceFailure('Chybí ID majetku.')

  const insuranceId = normalizeText(formData.get('insurance_id'))
  if (!insuranceId) return buildDeleteInsuranceFailure('Chybí ID pojištění.')

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildDeleteInsuranceFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { error } = await auth.supabase
    .from('asset_insurance_details')
    .delete()
    .eq('id', insuranceId)
    .eq('asset_id', assetId)

  if (error) {
    return buildDeleteInsuranceFailure('Pojištění se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')
  revalidatePath(`/majetek/${assetId}`)

  return buildDeleteInsuranceSuccess(assetId)
}

export async function upsertAssetElectricityAction(
  _prevState: UpdateAssetElectricityActionState,
  formData: FormData
): Promise<UpdateAssetElectricityActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildElectricityFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildElectricityFailure('Chybí ID majetku.')

  const electricityId = normalizeOptionalText(formData.get('electricity_id'))

  if (electricityId) {
    const { data: electricityRow, error: electricityError } = await auth.supabase
      .from('asset_electricity_details')
      .select('id, asset_id')
      .eq('id', electricityId)
      .eq('asset_id', assetId)
      .maybeSingle<{ id: string; asset_id: string }>()

    if (electricityError) {
      return buildElectricityFailure('Nepodařilo se ověřit vyúčtování.')
    }

    if (!electricityRow) {
      return buildElectricityFailure('Vyúčtování nebylo nalezeno.')
    }
  }

  let asset: AssetRow
  try {
    asset = await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildElectricityFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const category = await auth.supabase
    .from('asset_categories')
    .select('id, name, icon_key')
    .eq('id', asset.category_id)
    .single<{ id: string; name: string; icon_key: string }>()

  if (category.error || !category.data) {
    return buildElectricityFailure('Nepodařilo se ověřit kategorii majetku.')
  }

  if (category.data.icon_key !== 'house' && category.data.icon_key !== 'building') {
    return buildElectricityFailure('Elektřina je dostupná jen pro domy a byty.')
  }

  const billingYear = Number.parseInt(normalizeText(formData.get('billing_year')), 10)
  if (!Number.isFinite(billingYear) || billingYear < 1900) {
    return buildElectricityFailure('Rok vyúčtování je povinný.')
  }

  const electricityPayload = {
    asset_id: assetId,
    billing_year: billingYear,
    provider_name: normalizeOptionalText(formData.get('provider_name')),
    ean: normalizeOptionalText(formData.get('ean')),
    meter_number: normalizeOptionalText(formData.get('meter_number')),
    period_start: normalizeDate(formData.get('period_start')),
    period_end: normalizeDate(formData.get('period_end')),
    consumption_kwh: normalizeFloat(formData.get('consumption_kwh')),
    total_amount: normalizeCurrency(formData.get('total_amount')),
    advance_payments: normalizeCurrency(formData.get('advance_payments')),
    balance_amount: normalizeSignedFloat(formData.get('balance_amount')),
    billed_on: normalizeDate(formData.get('billed_on')),
    due_date: normalizeDate(formData.get('due_date')),
    paid_on: normalizeDate(formData.get('paid_on')),
    note: normalizeOptionalText(formData.get('note')),
  }

  const { error } = electricityId
    ? await auth.supabase
        .from('asset_electricity_details')
        .update(electricityPayload)
        .eq('id', electricityId)
        .eq('asset_id', assetId)
    : await auth.supabase
        .from('asset_electricity_details')
        .insert(electricityPayload)

  if (error) {
    return buildElectricityFailure('Vyúčtování se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildElectricitySuccess(assetId)
}

export async function deleteAssetElectricityAction(
  _prevState: DeleteAssetElectricityActionState,
  formData: FormData
): Promise<DeleteAssetElectricityActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteElectricityFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildDeleteElectricityFailure('Chybí ID majetku.')

  const electricityId = normalizeText(formData.get('electricity_id'))
  if (!electricityId) return buildDeleteElectricityFailure('Chybí ID vyúčtování.')

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildDeleteElectricityFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { data: electricityRow, error: rowError } = await auth.supabase
    .from('asset_electricity_details')
    .select('id, asset_id')
    .eq('id', electricityId)
    .eq('asset_id', assetId)
    .maybeSingle<{ id: string; asset_id: string }>()

  if (rowError) {
    return buildDeleteElectricityFailure('Nepodařilo se ověřit vyúčtování.')
  }

  if (!electricityRow) {
    return buildDeleteElectricityFailure('Vyúčtování nebylo nalezeno.')
  }

  const { error } = await auth.supabase
    .from('asset_electricity_details')
    .delete()
    .eq('id', electricityId)
    .eq('asset_id', assetId)

  if (error) {
    return buildDeleteElectricityFailure('Vyúčtování se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildDeleteElectricitySuccess(assetId)
}

export async function upsertAssetRentalAction(
  _prevState: UpdateAssetRentalActionState,
  formData: FormData
): Promise<UpdateAssetRentalActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildRentalFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildRentalFailure('Chybí ID majetku.')

  const rentalId = normalizeOptionalText(formData.get('rental_id'))

  if (rentalId) {
    const { data: rentalRow, error: rentalError } = await auth.supabase
      .from('asset_rentals')
      .select('id, asset_id')
      .eq('id', rentalId)
      .eq('asset_id', assetId)
      .maybeSingle<{ id: string; asset_id: string }>()

    if (rentalError) {
      return buildRentalFailure('Nepodařilo se ověřit pronájem.')
    }

    if (!rentalRow) {
      return buildRentalFailure('Pronájem nebyl nalezen.')
    }
  }

  let asset: AssetRow
  try {
    asset = await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildRentalFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const category = await auth.supabase
    .from('asset_categories')
    .select('id, name, icon_key')
    .eq('id', asset.category_id)
    .single<{ id: string; name: string; icon_key: string }>()

  if (category.error || !category.data) {
    return buildRentalFailure('Nepodařilo se ověřit kategorii majetku.')
  }

  if (category.data.icon_key !== 'house' && category.data.icon_key !== 'building') {
    return buildRentalFailure('Pronájem je dostupný jen pro domy a byty.')
  }

  const tenantName = normalizeText(formData.get('tenant_name'))
  if (!tenantName) {
    return buildRentalFailure('Nájemce je povinný.')
  }

  const startDate = normalizeDate(formData.get('start_date'))
  if (!startDate) {
    return buildRentalFailure('Datum začátku je povinné.')
  }

  const endDate = normalizeDate(formData.get('end_date'))
  if (startDate && endDate && new Date(endDate) < new Date(startDate)) {
    return buildRentalFailure('Datum konce nemůže být dřív než datum začátku.')
  }

  const payload = {
    asset_id: assetId,
    tenant_name: tenantName,
    tenant_contact: normalizeOptionalText(formData.get('tenant_contact')),
    start_date: startDate,
    end_date: endDate,
    monthly_rent: normalizeCurrency(formData.get('monthly_rent')),
    deposit_amount: normalizeCurrency(formData.get('deposit_amount')),
    note: normalizeOptionalText(formData.get('note')),
  }

  const { error } = rentalId
    ? await auth.supabase
        .from('asset_rentals')
        .update(payload)
        .eq('id', rentalId)
        .eq('asset_id', assetId)
    : await auth.supabase
        .from('asset_rentals')
        .insert(payload)

  if (error) {
    return buildRentalFailure('Pronájem se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildRentalSuccess(assetId)
}

export async function deleteAssetRentalAction(
  _prevState: DeleteAssetRentalActionState,
  formData: FormData
): Promise<DeleteAssetRentalActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteRentalFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildDeleteRentalFailure('Chybí ID majetku.')

  const rentalId = normalizeText(formData.get('rental_id'))
  if (!rentalId) return buildDeleteRentalFailure('Chybí ID pronájmu.')

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildDeleteRentalFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { data: rentalRow, error: rentalError } = await auth.supabase
    .from('asset_rentals')
    .select('id, asset_id')
    .eq('id', rentalId)
    .eq('asset_id', assetId)
    .maybeSingle<{ id: string; asset_id: string }>()

  if (rentalError) {
    return buildDeleteRentalFailure('Nepodařilo se ověřit pronájem.')
  }

  if (!rentalRow) {
    return buildDeleteRentalFailure('Pronájem nebyl nalezen.')
  }

  const { error } = await auth.supabase
    .from('asset_rentals')
    .delete()
    .eq('id', rentalId)
    .eq('asset_id', assetId)

  if (error) {
    return buildDeleteRentalFailure('Pronájem se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildDeleteRentalSuccess(assetId)
}

export async function createAssetNoteAction(
  _prevState: CreateAssetNoteActionState,
  formData: FormData
): Promise<CreateAssetNoteActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildNoteFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildNoteFailure('Chybí ID majetku.')

  const body = normalizeText(formData.get('body'))
  if (!body) {
    return buildNoteFailure('Poznámka nesmí být prázdná.')
  }

  if (body.length > 4000) {
    return buildNoteFailure('Poznámka je příliš dlouhá.')
  }

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildNoteFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { error } = await auth.supabase.from('asset_notes').insert({
    asset_id: assetId,
    body,
    created_by: auth.userId,
  })

  if (error) {
    return buildNoteFailure('Poznámku se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildNoteSuccess()
}

export async function deleteAssetNoteAction(
  _prevState: DeleteAssetNoteActionState,
  formData: FormData
): Promise<DeleteAssetNoteActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteNoteFailure(auth.error)

  const noteId = normalizeText(formData.get('note_id'))
  if (!noteId) return buildDeleteNoteFailure('Chybí ID poznámky.')

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildDeleteNoteFailure('Chybí ID majetku.')

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildDeleteNoteFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { error } = await auth.supabase.from('asset_notes').delete().eq('id', noteId).eq('asset_id', assetId)

  if (error) {
    return buildDeleteNoteFailure('Poznámku se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildDeleteNoteSuccess()
}
