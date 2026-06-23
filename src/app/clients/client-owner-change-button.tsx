'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { changeClientOwnerAction, type ChangeClientOwnerActionState } from './actions'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'

type ClientOwnerOption = {
  id: string
  name: string
}

type ClientAccessOption = {
  id: string
  name: string
}

type ClientOwnerChangeButtonProps = {
  clientId: string
  currentOwnerId: string
  currentOwnerName: string
  ownerOptions: ClientOwnerOption[]
  sharedUserOptions: ClientAccessOption[]
  selectedSharedUserIds: string[]
}

const initialState: ChangeClientOwnerActionState = {
  success: false,
  error: null,
}

const glassSelectClass =
  'clients-modal__select h-11 w-full rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

export function ClientOwnerChangeButton({
  clientId,
  currentOwnerId,
  currentOwnerName,
  ownerOptions,
  sharedUserOptions,
  selectedSharedUserIds,
}: ClientOwnerChangeButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const { toast, isVisible, showToast } = useAnimatedActionToast()

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}

      <button
        type="button"
        onClick={openModal}
        className="clients-page__owner-button inline-flex h-9 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.3)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.34)]"
      >
        ZMĚNA
      </button>

      {isOpen ? (
        <ClientOwnerChangeModal
          key={formKey}
          clientId={clientId}
          currentOwnerId={currentOwnerId}
          currentOwnerName={currentOwnerName}
          ownerOptions={ownerOptions}
          sharedUserOptions={sharedUserOptions}
          selectedSharedUserIds={selectedSharedUserIds}
          onClose={() => setIsOpen(false)}
          onSuccess={(ownerName) => {
            setIsOpen(false)
            showToast({
              title: 'Majitel změněn',
              message: `Klient byl nově přiřazen uživateli ${ownerName}.`,
              tone: 'success',
            })
          }}
        />
      ) : null}
    </>
  )
}

function ClientOwnerChangeModal({
  clientId,
  currentOwnerId,
  currentOwnerName,
  ownerOptions,
  sharedUserOptions,
  selectedSharedUserIds,
  onClose,
  onSuccess,
}: {
  clientId: string
  currentOwnerId: string
  currentOwnerName: string
  ownerOptions: ClientOwnerOption[]
  sharedUserOptions: ClientAccessOption[]
  selectedSharedUserIds: string[]
  onClose: () => void
  onSuccess: (ownerName: string) => void
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(changeClientOwnerAction, initialState)
  const [selectedOwnerId, setSelectedOwnerId] = useState(
    currentOwnerId || ownerOptions[0]?.id || ''
  )
  const [selectedSharedIds, setSelectedSharedIds] = useState<string[]>(
    selectedSharedUserIds.filter((id) => id !== currentOwnerId)
  )

  useEffect(() => {
    if (!state.success) return

    onSuccess(state.ownerName ?? 'Neuvedeno')
    router.refresh()
  }, [onSuccess, router, state.ownerName, state.success])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const modalContent = (
    <div
      className="clients-modal fixed inset-0 z-[140] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="clients-modal__shell relative w-full max-w-lg overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div className="clients-modal__header flex items-center justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-5 py-4">
            <div>
              <h2 className="clients-modal__title text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Změna majitele a sdílení klienta
              </h2>
              <p className="clients-modal__subtitle mt-1 text-sm text-gray-500">
                Aktuálně: <span className="font-semibold text-gray-900">{currentOwnerName}</span>
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex flex-col">
            <input type="hidden" name="client_id" value={clientId} />

            <div className="clients-modal__body px-5 py-4">
              <div className="grid gap-4">
                <div>
                  <label
                    htmlFor={`client-owner-${clientId}`}
                    className="clients-modal__label mb-2 block text-sm font-medium text-gray-900"
                  >
                    Majitel klienta
                  </label>
                  <select
                    id={`client-owner-${clientId}`}
                    name="owner_user_id"
                    value={selectedOwnerId}
                    onChange={(event) => {
                      const nextOwnerId = event.target.value

                      setSelectedOwnerId(nextOwnerId)
                      setSelectedSharedIds((current) =>
                        current.filter((id) => id !== nextOwnerId)
                      )
                    }}
                    className={glassSelectClass}
                  >
                    {ownerOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="clients-modal__label mb-2 block text-sm font-medium text-gray-900">
                    Další uživatelé s přístupem
                  </p>

                  <div className="clients-modal__shared-users-panel max-h-56 overflow-auto rounded-[28px] p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {sharedUserOptions
                        .filter((option) => option.id !== selectedOwnerId)
                        .map((option) => {
                          const checked = selectedSharedIds.includes(option.id)

                          return (
                            <label
                              key={option.id}
                              className="clients-modal__shared-users-option flex items-center gap-3 rounded-xl px-3 py-2 text-sm shadow-none transition"
                            >
                              <input
                                type="checkbox"
                                name="shared_user_ids"
                                value={option.id}
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedSharedIds((current) => {
                                    if (event.target.checked) {
                                      return Array.from(new Set([...current, option.id]))
                                    }

                                    return current.filter((id) => id !== option.id)
                                  })
                                }}
                                className="h-4 w-4 accent-[#2980B9]"
                              />
                              <span className="min-w-0 truncate">
                                {option.name}
                              </span>
                            </label>
                          )
                        })}
                    </div>
                  </div>
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="clients-modal__actions flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                className="clients-modal__cancel inline-flex h-10 items-center justify-center rounded-2xl border border-red-400/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(185,28,28,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_22px_rgba(185,28,28,0.3)]"
              >
                ZRUŠIT
              </button>

              <button
                type="submit"
                className="clients-modal__submit inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                ULOŽIT
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
