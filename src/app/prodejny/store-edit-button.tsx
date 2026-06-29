'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { updateStoreAction, type UpdateStoreFormState } from './actions'

type StoreEditButtonProps = {
  store: {
    id: string
    chain_name: string
    store_number: string
    city: string
    address: string
    phone_1: string
    phone_2: string | null
    phone_3: string | null
  }
}

const initialState: UpdateStoreFormState = {
  success: false,
  error: null,
}

export function StoreEditButton({ store }: StoreEditButtonProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [state, setState] = useState<UpdateStoreFormState>(initialState)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await updateStoreAction(initialState, formData)
      setState(result)

      if (!result.success) {
        return
      }

      setIsOpen(false)
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState(initialState)
          setIsOpen(true)
        }}
        className="inline-flex items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_18px_rgba(24,78,129,0.24)] transition duration-200 ease-out hover:-translate-y-[1px]"
      >
        UPRAVIT
      </button>

      {isOpen ? (
        <StoreEditModal
          store={store}
          state={state}
          onSubmit={handleSubmit}
          isPending={isPending}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function StoreEditModal({
  store,
  state,
  onSubmit,
  isPending,
  onClose,
}: {
  store: StoreEditButtonProps['store']
  state: UpdateStoreFormState
  onSubmit: (payload: FormData) => void
  isPending: boolean
  onClose: () => void
}) {
  useBodyScrollLock(true)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) {
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPending, onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      aria-modal="true"
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose()
        }
      }}
    >
      <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
        <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-[760px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/72 bg-[linear-gradient(168deg,rgba(255,255,255,0.86)_0%,rgba(249,250,251,0.76)_42%,rgba(244,244,245,0.68)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.24)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.28)]">
          <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Upravit prodejnu</h2>
              <p className="mt-2 text-sm text-gray-500">
                {store.chain_name} / prodejna {store.store_number}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Zavřít"
            >
              ×
            </button>
          </div>

          <form
            className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6 sm:pb-6"
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit(new FormData(event.currentTarget))
            }}
          >
            <input type="hidden" name="store_id" value={store.id} />

            <div className="grid gap-4">
              <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                <div className="grid gap-4 md:grid-cols-2">
                  <ReadOnlyField label="Řetězec" value={store.chain_name} />
                  <ReadOnlyField label="Číslo prodejny" value={store.store_number} />
                </div>
              </div>

              <EditableField
                label="Město"
                name="city"
                defaultValue={store.city}
                required
              />
              <EditableField
                label="Adresa"
                name="address"
                defaultValue={store.address}
                required
              />
              <EditableField
                label="Telefon 1"
                name="phone_1"
                defaultValue={store.phone_1}
                required
              />
              <EditableField
                label="Telefon 2"
                name="phone_2"
                defaultValue={store.phone_2 ?? ''}
              />
              <EditableField
                label="Telefon 3"
                name="phone_3"
                defaultValue={store.phone_3 ?? ''}
              />
            </div>

            {state.error ? (
              <div className="mt-4 rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
                {state.error}
              </div>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
              >
                ZRUŠIT
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'UKLÁDÁM...' : 'ULOŽIT ZMĚNY'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        {label}
      </div>
      <div className="flex min-h-11 items-center rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
        {value}
      </div>
    </div>
  )
}

function EditableField({
  label,
  name,
  defaultValue,
  required = false,
}: {
  label: string
  name: string
  defaultValue: string
  required?: boolean
}) {
  return (
    <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
      <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
        {label}
      </label>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="h-11 w-full rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
      />
    </div>
  )
}
