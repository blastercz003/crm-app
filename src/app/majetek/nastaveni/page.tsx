import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'
import { AssetSettingsEditors } from './asset-settings-editors'
import { ASSET_TAB_OPTIONS } from '@/lib/majetek/config'
import { isMissingColumnError } from '@/lib/majetek/detail'

export const metadata: Metadata = {
  title: 'Majetek - Nastavení',
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

type AssetDocumentTypeRow = {
  id: string
  name: string
  sort_order: number
  tabs_config: unknown
}

async function loadAssetDocumentTypes(supabase: Awaited<ReturnType<typeof createClient>>) {
  const withTabs = await supabase
    .from('asset_document_types')
    .select('id, name, sort_order, tabs_config')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (!withTabs.error) {
    return withTabs
  }

  if (!isMissingColumnError(withTabs.error)) {
    return withTabs
  }

  const fallback = await supabase
    .from('asset_document_types')
    .select('id, name, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  return {
    ...fallback,
    data: (fallback.data ?? []).map((documentType) => ({
      ...documentType,
      tabs_config: [],
    })),
  }
}

export default async function AssetsSettingsPage() {
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

  const [categoriesResponse, documentTypesResponse] = await Promise.all([
    supabase
      .from('asset_categories')
      .select('id, name, color, icon_key, sort_order, tabs_config')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    loadAssetDocumentTypes(supabase),
  ])

  if (categoriesResponse.error) {
    throw new Error('Nepodařilo se načíst kategorie majetku.')
  }

  if (documentTypesResponse.error) {
    throw new Error('Nepodařilo se načíst typy dokumentů.')
  }

  const categories = (categoriesResponse.data ?? []) as AssetCategoryRow[]
  const documentTypes = (documentTypesResponse.data ?? []) as AssetDocumentTypeRow[]

  const [categoryCounts, documentTypeCounts] = await Promise.all([
    Promise.all(
      categories.map(async (category) => {
        const { count, error: countError } = await supabase
          .from('assets')
          .select('id', { count: 'exact', head: true })
          .eq('category_id', category.id)

        if (countError) {
          throw new Error('Nepodařilo se načíst počet použití kategorií.')
        }

        return { category_id: category.id, count: count ?? 0 }
      })
    ),
    Promise.all(
      documentTypes.map(async (documentType) => {
        const { count, error: countError } = await supabase
          .from('asset_documents')
          .select('id', { count: 'exact', head: true })
          .eq('document_type_id', documentType.id)

        if (countError) {
          throw new Error('Nepodařilo se načíst počet použití typů dokumentů.')
        }

        return { document_type_id: documentType.id, count: count ?? 0 }
      })
    ),
  ])

  const categoryCountMap = new Map(categoryCounts.map((row: { category_id: string; count: number }) => [
    row.category_id,
    row.count,
  ]))

  const documentTypeCountMap = new Map(
    documentTypeCounts.map((row: { document_type_id: string; count: number }) => [
      row.document_type_id,
      row.count,
    ])
  )

  return (
    <main className="assets-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="assets-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="assets-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="assets-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                NASTAVENÍ SEKCE
              </p>
              <h1 className="assets-page__title mt-2 text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Majetek
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-500">
                Tady spravujeme konfiguraci kategorií a typů dokumentů. Změny se ihned projeví v přehledu i detailu majetku.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <Link
                  href="/majetek"
                  className="clients-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
                >
                  ZPĚT NA MAJETEK
                </Link>
            </div>
          </div>
        </section>

        <section className="assets-page__summary rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="assets-settings-page__stat-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Kategorie</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{categories.length}</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">Včetně vlastního nastavení tabů.</p>
            </div>
            <div className="assets-settings-page__stat-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Typy dokumentů</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{documentTypes.length}</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">Používají se u nahrávání souborů.</p>
            </div>
            <div className="assets-settings-page__stat-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Dostupné taby</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{ASSET_TAB_OPTIONS.length}</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">Každá kategorie si je může kombinovat.</p>
            </div>
            <div className="assets-settings-page__stat-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Ochrana</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">Pouze admin</p>
              <p className="mt-2 text-xs leading-5 text-gray-500">Ověřeno přes `profiles.majetek` i RLS.</p>
            </div>
          </div>
        </section>

        <AssetSettingsEditors
          categories={categories.map((category) => ({
            ...category,
            asset_count: categoryCountMap.get(category.id) ?? 0,
          }))}
          documentTypes={documentTypes.map((documentType) => ({
            ...documentType,
            document_count: documentTypeCountMap.get(documentType.id) ?? 0,
          }))}
        />
      </div>
    </main>
  )
}
