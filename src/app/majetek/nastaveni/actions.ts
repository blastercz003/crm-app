'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import { ASSET_ICON_OPTIONS, ASSET_TAB_OPTIONS } from '@/lib/majetek/config'
import {
  isAssetTabKey,
  isMissingColumnError,
  normalizeDocumentTypeTabs,
} from '@/lib/majetek/detail'

export type AssetSettingsActionState = {
  success: boolean
  error: string | null
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

const allowedIconKeys = new Set(ASSET_ICON_OPTIONS.map((option) => option.key))

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeColor(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return /^#[0-9a-fA-F]{6}$/.test(text) ? text : '#2f77af'
}

function normalizeIconKey(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return allowedIconKeys.has(text) ? text : 'car'
}

function normalizeSortOrder(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(normalizeText(value), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeCategoryTabs(formData: FormData) {
  const selected = formData
    .getAll('tabs')
    .map((value) => String(value))
    .filter((value) => isAssetTabKey(value))

  const tabs = new Set(selected)
  tabs.add('overview')

  return ASSET_TAB_OPTIONS.filter((option) => tabs.has(option.key)).map((option) => option.key)
}

function normalizeDocumentTabs(formData: FormData) {
  return normalizeDocumentTypeTabs(
    formData
      .getAll('tabs')
      .map((value) => String(value))
  )
}

async function requireAssetsAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, error: 'Nejsi přihlášený.' as const }
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
    return { supabase, error: 'Nemáš oprávnění spravovat nastavení majetku.' as const }
  }

  return { supabase, userId: user.id, error: null }
}

function buildFailure(error: string): AssetSettingsActionState {
  return { success: false, error }
}

function buildSuccess(): AssetSettingsActionState {
  return { success: true, error: null }
}

async function insertDocumentType(
  supabase: Awaited<ReturnType<typeof createClient>>,
  payload: Record<string, unknown>
) {
  const result = await supabase.from('asset_document_types').insert(payload)
  if (!result.error) return result

  if (!isMissingColumnError(result.error) || !('tabs_config' in payload)) {
    return result
  }

  const { tabs_config, ...fallbackPayload } = payload
  void tabs_config
  return supabase.from('asset_document_types').insert(fallbackPayload)
}

async function updateDocumentType(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentTypeId: string,
  payload: Record<string, unknown>
) {
  const result = await supabase
    .from('asset_document_types')
    .update(payload)
    .eq('id', documentTypeId)

  if (!result.error) return result

  if (!isMissingColumnError(result.error) || !('tabs_config' in payload)) {
    return result
  }

  const { tabs_config, ...fallbackPayload } = payload
  void tabs_config
  return supabase
    .from('asset_document_types')
    .update(fallbackPayload)
    .eq('id', documentTypeId)
}

export async function createAssetCategoryAction(
  _prevState: AssetSettingsActionState,
  formData: FormData
): Promise<AssetSettingsActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const name = normalizeText(formData.get('name'))
  if (!name) return buildFailure('Název kategorie je povinný.')

  const { error } = await auth.supabase.from('asset_categories').insert({
    name,
    color: normalizeColor(formData.get('color')),
    icon_key: normalizeIconKey(formData.get('icon_key')),
    sort_order: normalizeSortOrder(formData.get('sort_order')),
    tabs_config: normalizeCategoryTabs(formData),
  })

  if (error) {
    return buildFailure('Kategorii se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}

export async function updateAssetCategoryAction(
  categoryId: string,
  _prevState: AssetSettingsActionState,
  formData: FormData
): Promise<AssetSettingsActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const normalizedCategoryId = normalizeText(categoryId)
  if (!normalizedCategoryId) return buildFailure('Chybí ID kategorie.')

  const name = normalizeText(formData.get('name'))
  if (!name) return buildFailure('Název kategorie je povinný.')

  const { error } = await auth.supabase
    .from('asset_categories')
    .update({
      name,
      color: normalizeColor(formData.get('color')),
      icon_key: normalizeIconKey(formData.get('icon_key')),
      sort_order: normalizeSortOrder(formData.get('sort_order')),
      tabs_config: normalizeCategoryTabs(formData),
    })
    .eq('id', normalizedCategoryId)

  if (error) {
    return buildFailure('Kategorii se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}

export async function deleteAssetCategoryAction(
  categoryId: string,
  _prevState: AssetSettingsActionState
): Promise<AssetSettingsActionState> {
  void _prevState
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const normalizedCategoryId = normalizeText(categoryId)
  if (!normalizedCategoryId) return buildFailure('Chybí ID kategorie.')

  const { count, error: countError } = await auth.supabase
    .from('assets')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', normalizedCategoryId)

  if (countError) {
    return buildFailure('Nepodařilo se ověřit použití kategorie.')
  }

  if ((count ?? 0) > 0) {
    return buildFailure('Kategorie se nedá smazat, protože už je použitá u majetku.')
  }

  const { error } = await auth.supabase
    .from('asset_categories')
    .delete()
    .eq('id', normalizedCategoryId)

  if (error) {
    return buildFailure('Kategorie se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}

export async function createAssetDocumentTypeAction(
  _prevState: AssetSettingsActionState,
  formData: FormData
): Promise<AssetSettingsActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const name = normalizeText(formData.get('name'))
  if (!name) return buildFailure('Název typu dokumentu je povinný.')

  const { error } = await insertDocumentType(auth.supabase, {
    name,
    sort_order: normalizeSortOrder(formData.get('sort_order')),
    tabs_config: normalizeDocumentTabs(formData),
  })

  if (error) {
    return buildFailure('Typ dokumentu se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}

export async function updateAssetDocumentTypeAction(
  documentTypeId: string,
  _prevState: AssetSettingsActionState,
  formData: FormData
): Promise<AssetSettingsActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const normalizedDocumentTypeId = normalizeText(documentTypeId)
  if (!normalizedDocumentTypeId) return buildFailure('Chybí ID typu dokumentu.')

  const name = normalizeText(formData.get('name'))
  if (!name) return buildFailure('Název typu dokumentu je povinný.')

  const { error } = await updateDocumentType(auth.supabase, normalizedDocumentTypeId, {
      name,
      sort_order: normalizeSortOrder(formData.get('sort_order')),
      tabs_config: normalizeDocumentTabs(formData),
    })

  if (error) {
    return buildFailure('Typ dokumentu se nepodařilo uložit.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}

export async function deleteAssetDocumentTypeAction(
  documentTypeId: string,
  _prevState: AssetSettingsActionState
): Promise<AssetSettingsActionState> {
  void _prevState
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const normalizedDocumentTypeId = normalizeText(documentTypeId)
  if (!normalizedDocumentTypeId) return buildFailure('Chybí ID typu dokumentu.')

  const { count, error: countError } = await auth.supabase
    .from('asset_documents')
    .select('id', { count: 'exact', head: true })
    .eq('document_type_id', normalizedDocumentTypeId)

  if (countError) {
    return buildFailure('Nepodařilo se ověřit použití typu dokumentu.')
  }

  if ((count ?? 0) > 0) {
    return buildFailure('Typ dokumentu se nedá smazat, protože už je použitý u dokumentů.')
  }

  const { error } = await auth.supabase
    .from('asset_document_types')
    .delete()
    .eq('id', normalizedDocumentTypeId)

  if (error) {
    return buildFailure('Typ dokumentu se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath('/majetek/nastaveni')

  return buildSuccess()
}
