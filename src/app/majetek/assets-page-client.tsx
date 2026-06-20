'use client'

import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { Search, Building2, CarFront, Cpu, House } from 'lucide-react'
import Link from 'next/link'
import { NewAssetButton } from './new-asset-button'
import { AssetTableRowLink } from './asset-table-row-link'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'

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
  insurance_total?: number | null
  rental_monthly_rent?: number | null
  stk_expires_on?: string | null
  search_text: string
}

type AssetsPageClientProps = {
  categories: AssetCategoryRow[]
  assets: AssetRow[]
  initialQuery: string
  initialCategoryId: string
  defaultCategoryId: string
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function formatDate(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
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

export function AssetsPageClient({
  categories,
  assets,
  initialQuery,
  initialCategoryId,
  defaultCategoryId,
}: AssetsPageClientProps) {
  const [query, setQuery] = useState(initialQuery)
  const [activeCategoryId, setActiveCategoryId] = useState(
    initialCategoryId || defaultCategoryId
  )

  useEffect(() => {
    const syncFromUrl = () => {
      const url = new URL(window.location.href)
      const nextQuery = url.searchParams.get('q')?.trim() ?? ''
      const nextCategoryId = url.searchParams.get('categoryId')?.trim() ?? ''

      setQuery(nextQuery)
      setActiveCategoryId(nextCategoryId || defaultCategoryId)
    }

    syncFromUrl()
    window.addEventListener('popstate', syncFromUrl)
    return () => window.removeEventListener('popstate', syncFromUrl)
  }, [defaultCategoryId])

  useEffect(() => {
    const url = new URL(window.location.href)
    if (query.trim()) {
      url.searchParams.set('q', query.trim())
    } else {
      url.searchParams.delete('q')
    }

    if (activeCategoryId.trim()) {
      url.searchParams.set('categoryId', activeCategoryId.trim())
    } else {
      url.searchParams.delete('categoryId')
    }

    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
  }, [activeCategoryId, query])

  const normalizedQuery = normalizeSearchText(query)
  const activeCategory =
    categories.find((category) => category.id === activeCategoryId) ??
    categories.find((category) => category.id === defaultCategoryId) ??
    categories[0] ??
    null
  const showVehicleColumns = activeCategory?.icon_key === 'car'
  const showRealEstateColumns = activeCategory?.icon_key === 'house' || activeCategory?.icon_key === 'building'

  const visibleAssets = activeCategory
    ? [...assets]
        .filter((asset) => {
          if (asset.category_id !== activeCategory.id) {
            return false
          }

          if (!normalizedQuery) {
            return true
          }

          return asset.search_text.includes(normalizedQuery)
        })
        .sort((left, right) =>
          left.name.localeCompare(right.name, 'cs', {
            sensitivity: 'base',
            numeric: true,
          })
        )
    : []

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
  }

  function updateCategory(categoryId: string) {
    setActiveCategoryId(categoryId)
  }

  return (
    <main className="assets-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <PresenceSectionTracker section="Majetek" route="/majetek" />
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
            <div className="flex items-end">
              <h1 className="assets-page__title text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Majetek
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/majetek"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
                onSubmit={handleSearchSubmit}
              >
                {activeCategoryId ? (
                  <input type="hidden" name="categoryId" value={activeCategoryId} />
                ) : null}

                <div className="relative flex-1 sm:w-56 lg:w-[320px] lg:flex-none">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    name="q"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Hledat majetek, dokument nebo poznámku"
                    className="assets-page__search-input w-full rounded-2xl border border-gray-200 bg-white/96 py-3 pl-10 pr-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  />
                </div>

                <button
                  type="submit"
                  className="assets-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-3 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
                <Link
                  href="/dashboard"
                  className="clients-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
                >
                  ZPĚT NA DASHBOARD
                </Link>

                {categories.length > 0 ? (
                  <NewAssetButton
                    categories={categories}
                    defaultCategoryId={activeCategoryId || categories[0]?.id || null}
                    className="clients-page__new-button"
                    label="NOVÝ MAJETEK"
                  />
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="assets-page__filters rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6">
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-center">
            <div className="flex flex-wrap justify-center gap-2 lg:col-start-2">
              {categories.map((category) => {
                const isActive = activeCategoryId === category.id

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => updateCategory(category.id)}
                    className={[
                      'assets-page__pill assets-page__pill--filter inline-flex items-center justify-start gap-2 rounded-full px-4 py-2 text-sm font-medium leading-none transition duration-200',
                      isActive
                        ? 'border text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_14px_28px_rgba(24,78,129,0.22)]'
                        : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:text-zinc-900',
                    ].join(' ')}
                    style={
                      isActive
                        ? {
                            background: `linear-gradient(155deg, ${category.color} 0%, ${category.color} 100%)`,
                            borderColor: category.color,
                          }
                        : {
                            borderColor: `${category.color}33`,
                          }
                    }
                  >
                    <span
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-full bg-white/18"
                      aria-hidden="true"
                    >
                      <AssetCategoryIcon iconKey={category.icon_key} />
                    </span>
                    {category.name}
                  </button>
                )
              })}
            </div>

            <div className="lg:col-start-3 lg:justify-self-end">
              <Link
                href="/majetek/nastaveni"
                className="assets-page__settings-button inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900"
              >
                NASTAVENÍ
              </Link>
            </div>
          </div>
        </section>

        <section className="assets-page__categories space-y-5">
          {categories.length === 0 ? (
            <section className="assets-page__empty rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <p className="text-sm text-zinc-500">
                Pro zadaný filtr nebyla nalezena žádná kategorie.
              </p>
            </section>
          ) : activeCategory ? (
            <section
              key={activeCategory.id}
              className="assets-page__category overflow-hidden rounded-[28px] border border-white/72 bg-[linear-gradient(155deg,rgba(255,255,255,0.97)_0%,rgba(248,250,252,0.93)_48%,rgba(241,245,249,0.89)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]"
              style={{
                boxShadow: `inset 0 1px 0 rgba(255,255,255,0.92), 0 20px 44px rgba(15,23,42,0.12), 0 0 0 1px ${activeCategory.color}22`,
              }}
            >
              <div className="assets-page__category-header flex flex-col gap-3 border-b border-white/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_18px_rgba(15,23,42,0.14)]"
                    style={{ background: activeCategory.color }}
                  >
                    <AssetCategoryIcon iconKey={activeCategory.icon_key} />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                      {activeCategory.name}
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="assets-page__category-count inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-1.5 text-xs font-medium text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]">
                    {visibleAssets.length} záznamů
                  </span>
                </div>
              </div>

              <div className="assets-page__table-shell overflow-x-auto">
                <table className="min-w-full">
                  <thead className="assets-page__table-head bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(246,249,252,0.94)_100%)]">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                      <th className="px-5 py-4">Název</th>
                      <th className="px-5 py-4">Stav</th>
                      {showVehicleColumns ? (
                        <>
                          <th className="px-5 py-4">VIN</th>
                          <th className="px-5 py-4">Pojistné</th>
                          <th className="px-5 py-4">STK expirace</th>
                          <th className="px-5 py-4">Detail</th>
                        </>
                      ) : showRealEstateColumns ? (
                        <>
                          <th className="px-5 py-4">Nájemné</th>
                          <th className="px-5 py-4">Pojistné</th>
                          <th className="px-5 py-4">Detail</th>
                        </>
                      ) : (
                        <>
                          <th className="px-5 py-4">Pořízení</th>
                          <th className="px-5 py-4">Cena</th>
                          <th className="px-5 py-4">Detail</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="assets-page__table-body">
                    {visibleAssets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={showVehicleColumns ? 6 : showRealEstateColumns ? 5 : 5}
                          className="px-5 py-8 text-center text-sm text-zinc-500"
                        >
                          Zatím zde nejsou žádné záznamy.
                        </td>
                      </tr>
                    ) : (
                      visibleAssets.map((asset) => (
                        <AssetTableRowLink
                          key={asset.id}
                          href={`/majetek/${asset.id}`}
                          name={asset.name}
                          statusLabel={asset.status === 'sold' ? 'Prodáno' : 'Aktivní'}
                          purchaseDateLabel={formatDate(asset.purchase_date)}
                          purchasePriceLabel={formatCurrency(asset.purchase_price)}
                          createdAtLabel={formatDate(asset.created_at)}
                          vinLabel={asset.vin ?? '—'}
                          insuranceLabel={formatCurrency(asset.insurance_total ?? null)}
                          rentalLabel={formatCurrency(asset.rental_monthly_rent ?? null)}
                          stkExpiresLabel={formatDate(asset.stk_expires_on ?? null)}
                          variant={showVehicleColumns ? 'vehicle' : showRealEstateColumns ? 'real_estate' : 'default'}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </section>
      </div>
    </main>
  )
}
