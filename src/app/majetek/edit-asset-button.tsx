'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { Pencil } from 'lucide-react'
import { updateAssetAction, type UpdateAssetActionState } from './actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { ModalHeading } from '@/components/ui/modal-heading'
import { MoneyInput } from '@/components/ui/money-input'

type AssetCategoryOption = {
  id: string
  name: string
  color: string
  icon_key: string
}

type AssetToEdit = {
  id: string
  category_id: string
  name: string
  status: 'active' | 'sold'
  purchase_date: string | null
  sale_date: string | null
  purchase_price: string | number | null
}

type EditAssetButtonProps = {
  asset: AssetToEdit
  categories: AssetCategoryOption[]
  className?: string
  label?: string
}

const initialUpdateState: UpdateAssetActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

function formatDateForInput(value: string | null) {
  if (!value) return ''
  return value.slice(0, 10)
}

export function EditAssetButton({
  asset,
  categories,
  className,
  label = 'UPRAVIT',
}: EditAssetButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isMounted] = useState(() => typeof window !== 'undefined')
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    [
      'assets-page__edit-button inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-2.5 text-sm font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900',
      className,
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>
        <Pencil className="mr-2 h-4 w-4" strokeWidth={2.2} />
        {label}
      </button>

      {isOpen && isMounted
        ? createPortal(
            <EditAssetModal
              key={formKey}
              asset={asset}
              categories={categories}
              onClose={closeModal}
            />,
            document.body
          )
        : null}
    </>
  )
}

function EditAssetModal({
  asset,
  categories,
  onClose,
}: {
  asset: AssetToEdit
  categories: AssetCategoryOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(updateAssetAction, initialUpdateState)
  const router = useRouter()

  useBodyScrollLock(true)

  useEffect(() => {
    if (!state.success) return
    router.refresh()
    onClose()
  }, [onClose, router, state.success])

  return (
    <div
      className="clients-modal fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-[calc(100dvh-2rem)] items-start justify-center py-2 sm:min-h-full sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-auto sm:max-h-[calc(100dvh-2rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
        >
          <span
            aria-hidden="true"
            className="clients-modal__shell-frame pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <span
            aria-hidden="true"
            className="clients-modal__shell-sheen pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />
          <span
            aria-hidden="true"
            className="clients-modal__shell-halo pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]"
          />

          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <ModalHeading section="MAJETEK" title="Upravit majetek" />
              <p className="mt-1 text-sm text-gray-500">
                V detailu měníš základní údaje záznamu, dokumenty a další obsah zůstává na své straně.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="id" value={asset.id} />
            <PendingFormLock message="Ukládám změny, čekej prosím..." />

            <div className="clients-modal__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [-webkit-overflow-scrolling:touch] sm:px-5 sm:py-4">
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor={`asset-name-${asset.id}`} className="clients-modal__label text-sm font-medium text-gray-900">
                    Název *
                  </label>
                  <input
                    id={`asset-name-${asset.id}`}
                    name="name"
                    type="text"
                    required
                    defaultValue={asset.name}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor={`asset-category-${asset.id}`} className="clients-modal__label text-sm font-medium text-gray-900">
                    Kategorie *
                  </label>
                  <select
                    id={`asset-category-${asset.id}`}
                    name="category_id"
                    required
                    defaultValue={asset.category_id}
                    className="clients-modal__select h-12 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label htmlFor={`asset-status-${asset.id}`} className="clients-modal__label text-sm font-medium text-gray-900">
                    Stav
                  </label>
                  <select
                    id={`asset-status-${asset.id}`}
                    name="status"
                    defaultValue={asset.status}
                    className="clients-modal__select h-12 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  >
                    <option value="active">Aktivní</option>
                    <option value="sold">Prodáno</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`asset-purchase-date-${asset.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
                  >
                    Datum nákupu
                  </label>
                  <input
                    id={`asset-purchase-date-${asset.id}`}
                    name="purchase_date"
                    type="date"
                    defaultValue={formatDateForInput(asset.purchase_date)}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`asset-purchase-price-${asset.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
                  >
                    Pořizovací cena
                  </label>
                  <MoneyInput
                    id={`asset-purchase-price-${asset.id}`}
                    name="purchase_price"
                    defaultValue={asset.purchase_price}
                    className={inputClassName}
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`asset-sale-date-${asset.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
                  >
                    Datum prodeje
                  </label>
                  <input
                    id={`asset-sale-date-${asset.id}`}
                    name="sale_date"
                    type="date"
                    defaultValue={formatDateForInput(asset.sale_date)}
                    className={inputClassName}
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            <MobileModalActions
              onCancel={onClose}
              submitLabel="ULOŽIT ZMĚNY"
              pendingSubmitLabel="UKLÁDÁM..."
              visualStyle="client-modal"
            />
          </form>
        </div>
      </div>
    </div>
  )
}

function PendingFormLock({ message }: { message: string }) {
  const { pending } = useFormStatus()

  if (!pending) return null

  return (
    <div className="clients-modal__lock mx-4 mt-3 rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(24,95,145,0.14)] sm:mx-5 sm:mt-4">
      {message}
    </div>
  )
}
