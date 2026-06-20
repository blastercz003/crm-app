'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, CarFront, Cpu, House } from 'lucide-react'
import {
  createAssetCategoryAction,
  createAssetDocumentTypeAction,
  deleteAssetCategoryAction,
  deleteAssetDocumentTypeAction,
  updateAssetCategoryAction,
  updateAssetDocumentTypeAction,
  type AssetSettingsActionState,
} from './actions'
import {
  ASSET_DOCUMENT_TYPE_SEED_TABS_BY_LABEL,
  ASSET_DOCUMENT_TYPE_TAB_OPTIONS,
  ASSET_ICON_OPTIONS,
  ASSET_TAB_OPTIONS,
} from '@/lib/majetek/config'
import { normalizeAssetTabs, normalizeDocumentTypeTabs } from '@/lib/majetek/detail'

type AssetCategoryCardData = {
  id: string
  name: string
  color: string
  icon_key: string
  sort_order: number
  tabs_config: unknown
  asset_count: number
}

type AssetDocumentTypeCardData = {
  id: string
  name: string
  sort_order: number
  document_count: number
  tabs_config: unknown
}

type AssetSettingsEditorsProps = {
  categories: AssetCategoryCardData[]
  documentTypes: AssetDocumentTypeCardData[]
}

const initialState: AssetSettingsActionState = {
  success: false,
  error: null,
}

const inputClass =
  'assets-settings-page__input h-11 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const selectClass =
  'assets-settings-page__select h-11 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const primaryButtonClass =
  'assets-settings-page__button inline-flex h-11 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60'

const secondaryButtonClass =
  'assets-settings-page__secondary-button inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60'

const dangerButtonClass =
  'assets-settings-page__danger-button inline-flex h-11 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)] disabled:cursor-not-allowed disabled:opacity-60'

async function noopAction() {
  return initialState
}

function AssetIconPreview({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case 'house':
      return <House className="h-5 w-5" strokeWidth={1.9} />
    case 'building':
      return <Building2 className="h-5 w-5" strokeWidth={1.9} />
    case 'cpu':
      return <Cpu className="h-5 w-5" strokeWidth={1.9} />
    case 'car':
    default:
      return <CarFront className="h-5 w-5" strokeWidth={1.9} />
  }
}

function SettingsSubmitButton({
  label,
  tone = 'primary',
  disabled = false,
}: {
  label: string
  tone?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}) {
  const className =
    tone === 'primary'
      ? primaryButtonClass
      : tone === 'danger'
        ? dangerButtonClass
        : secondaryButtonClass

  return (
    <button type="submit" disabled={disabled} className={className}>
      {label}
    </button>
  )
}

export function AssetSettingsEditors({
  categories,
  documentTypes,
}: AssetSettingsEditorsProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.95fr)]">
      <section className="assets-page__summary rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6">
        <div className="mb-5 flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Kategorie majetku</h2>
          <p className="text-sm leading-6 text-gray-600">
            Každá kategorie může mít vlastní název, barvu, ikonu, pořadí a sestavu tabů.
          </p>
        </div>

        <div className="space-y-4">
          <CategoryEditorCard key="new-category" mode="create" />
          {categories.map((category) => (
            <CategoryEditorCard
              key={category.id}
              mode="edit"
              category={category}
            />
          ))}
        </div>
      </section>

      <section className="assets-page__summary rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6">
        <div className="mb-5 flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight text-gray-900">Typy dokumentů</h2>
          <p className="text-sm leading-6 text-gray-600">
            Typy dokumentů používáme při nahrávání PDF souborů a lze je průběžně upravovat.
          </p>
        </div>

        <div className="space-y-4">
          <DocumentTypeEditorCard key="new-document-type" mode="create" />
          {documentTypes.map((documentType) => (
            <DocumentTypeEditorCard
              key={documentType.id}
              mode="edit"
              documentType={documentType}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

function CategoryEditorCard({
  mode,
  category,
}: {
  mode: 'create' | 'edit'
  category?: AssetCategoryCardData
}) {
  const router = useRouter()
  const initialTabs = category?.tabs_config
    ? normalizeAssetTabs(category.tabs_config)
    : ['overview', 'documents', 'photos']
  const [saveState, saveFormAction, savePending] = useActionState(
    mode === 'edit' && category
      ? updateAssetCategoryAction.bind(null, category.id)
      : createAssetCategoryAction,
    initialState
  )
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    mode === 'edit' && category ? deleteAssetCategoryAction.bind(null, category.id) : noopAction,
    initialState
  )

  useEffect(() => {
    if (!saveState.success) return
    router.refresh()
  }, [router, saveState.success])

  useEffect(() => {
    if (mode !== 'edit' || !deleteState.success) return
    router.refresh()
  }, [deleteState.success, mode, router])

  const title = mode === 'create' ? 'Nová kategorie' : category?.name ?? 'Kategorie'
  const submitLabel = mode === 'create' ? 'ULOŽIT KATEGORII' : 'ULOŽIT ZMĚNY'

  return (
    <div className="assets-settings-page__card rounded-[24px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.1)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {mode === 'create' ? 'Přidání' : 'Úprava'}
            </p>
          <h3 className="truncate text-base font-semibold text-gray-900">{title}</h3>
        </div>
        {category ? (
          <span className="assets-settings-page__count-badge inline-flex items-center gap-2 rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1.5 text-xs font-medium text-gray-600">
            <AssetIconPreview iconKey={category.icon_key} />
            {category.asset_count}x
          </span>
        ) : null}
      </div>

      <form
        key={`${mode}-${category?.id ?? 'new'}-${saveState.success ? 'saved' : 'idle'}`}
        action={saveFormAction}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Název</span>
            <input
              name="name"
              defaultValue={category?.name ?? ''}
              required
              className={inputClass}
              placeholder="Např. Osobní vozy"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Pořadí</span>
            <input
              name="sort_order"
              type="number"
              defaultValue={category?.sort_order ?? 0}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,0.6fr)_minmax(0,0.8fr)]">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Barva</span>
            <input
              name="color"
              type="color"
              defaultValue={category?.color ?? '#2f77af'}
              className="h-11 w-full rounded-2xl border border-white/75 bg-transparent px-2 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Ikona</span>
            <select name="icon_key" defaultValue={category?.icon_key ?? 'car'} className={selectClass}>
              {ASSET_ICON_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">Taby</span>
            <span className="text-xs text-gray-500">Přehled je vždy povinný</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ASSET_TAB_OPTIONS.map((tab) => {
              const isOverview = tab.key === 'overview'
              const checked = isOverview || initialTabs.includes(tab.key)

              return (
                <label
                  key={tab.key}
                  className="assets-settings-page__tab-option flex items-center gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-2.5 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                >
                  <input
                    type="checkbox"
                    name="tabs"
                    value={tab.key}
                    defaultChecked={checked}
                    disabled={isOverview}
                  />
                  <span>{tab.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-6">
            {saveState.error ? <p className="text-sm text-red-700">{saveState.error}</p> : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            {mode === 'edit' ? (
              <button
                type="submit"
                formAction={deleteFormAction}
                disabled={deletePending}
                className={dangerButtonClass}
              >
                SMAZAT
              </button>
            ) : null}
            <SettingsSubmitButton label={submitLabel} disabled={savePending} />
          </div>
        </div>
      </form>

      {mode === 'edit' ? (
        <div className="mt-3 min-h-6">
          {deleteState.error ? <p className="text-sm text-red-700">{deleteState.error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}

function DocumentTypeEditorCard({
  mode,
  documentType,
}: {
  mode: 'create' | 'edit'
  documentType?: AssetDocumentTypeCardData
}) {
  const router = useRouter()
  const initialTabs = documentType?.tabs_config
    ? normalizeDocumentTypeTabs(documentType.tabs_config)
    : ASSET_DOCUMENT_TYPE_SEED_TABS_BY_LABEL.get(documentType?.name ?? '') ?? []
  const [saveState, saveFormAction, savePending] = useActionState(
    mode === 'edit' && documentType
      ? updateAssetDocumentTypeAction.bind(null, documentType.id)
      : createAssetDocumentTypeAction,
    initialState
  )
  const [deleteState, deleteFormAction, deletePending] = useActionState(
    mode === 'edit' && documentType ? deleteAssetDocumentTypeAction.bind(null, documentType.id) : noopAction,
    initialState
  )

  useEffect(() => {
    if (!saveState.success) return
    router.refresh()
  }, [router, saveState.success])

  useEffect(() => {
    if (mode !== 'edit' || !deleteState.success) return
    router.refresh()
  }, [deleteState.success, mode, router])

  return (
    <div className="assets-settings-page__card rounded-[24px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.1)]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {mode === 'create' ? 'Přidání' : 'Úprava'}
            </p>
          <h3 className="truncate text-base font-semibold text-gray-900">
            {mode === 'create' ? 'Nový typ dokumentu' : documentType?.name ?? 'Typ dokumentu'}
          </h3>
        </div>
        {documentType ? (
          <span className="assets-settings-page__count-badge inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1.5 text-xs font-medium text-gray-600">
            {documentType.document_count}x
          </span>
        ) : null}
      </div>

      <form
        key={`${mode}-${documentType?.id ?? 'new'}-${saveState.success ? 'saved' : 'idle'}`}
        action={saveFormAction}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_160px]">
          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Název</span>
            <input
              name="name"
              defaultValue={documentType?.name ?? ''}
              required
              className={inputClass}
              placeholder="Např. Kupní smlouva"
            />
          </label>

          <label className="space-y-1.5">
            <span className="text-sm font-medium text-gray-900">Pořadí</span>
            <input
              name="sort_order"
              type="number"
              defaultValue={documentType?.sort_order ?? 0}
              className={inputClass}
              />
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-900">Zobrazovat také v tabech</span>
            <span className="text-xs text-gray-500">V tabu Dokumenty se zobrazí vždy</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {ASSET_DOCUMENT_TYPE_TAB_OPTIONS.map((tab) => {
              const checked = initialTabs.includes(tab.key)

              return (
                <label
                  key={tab.key}
                  className="assets-settings-page__tab-option flex items-center gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-2.5 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                >
                  <input
                    type="checkbox"
                    name="tabs"
                    value={tab.key}
                    defaultChecked={checked}
                  />
                  <span>{tab.label}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-h-6">
            {saveState.error ? <p className="text-sm text-red-700">{saveState.error}</p> : null}
          </div>
          <div className="flex gap-3">
            {mode === 'edit' ? (
              <button
                type="submit"
                formAction={deleteFormAction}
                disabled={deletePending}
                className={dangerButtonClass}
              >
                SMAZAT
              </button>
            ) : null}
            <SettingsSubmitButton label={mode === 'create' ? 'ULOŽIT TYP' : 'ULOŽIT ZMĚNY'} disabled={savePending} />
          </div>
        </div>
      </form>

      {mode === 'edit' ? (
        <div className="mt-3 min-h-6">
          {deleteState.error ? <p className="text-sm text-red-700">{deleteState.error}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
