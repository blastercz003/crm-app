'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { NordFjellaSettingsRow } from '@/lib/nord-fjella/types'
import {
  updateNordFjellaSettingsAction,
  type UpdateNordFjellaSettingsActionState,
} from './actions'
import { updateNordFjellaSettingsInitialState } from './action-states'

type SettingsButtonProps = {
  settings: NordFjellaSettingsRow | null
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

export function SettingsButton({ settings }: SettingsButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="nord-fjella-settings-button inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
      >
        NASTAVENÍ
      </button>

      {isOpen ? <SettingsModal settings={settings} onClose={() => setIsOpen(false)} /> : null}
    </>
  )
}

function SettingsModal({
  settings,
  onClose,
}: {
  settings: NordFjellaSettingsRow | null
  onClose: () => void
}) {
  const [state, formAction] = useActionState<UpdateNordFjellaSettingsActionState, FormData>(
    updateNordFjellaSettingsAction,
    updateNordFjellaSettingsInitialState
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] sm:p-4"
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
        <div className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-auto sm:max-h-[calc(100dvh-2rem)]">
          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="clients-modal__title text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Nastavení Nord Fjella
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="clients-modal__body nord-fjella-modal-body min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5">
                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">Objekt</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Název objektu</label>
                      <input
                        name="object_name"
                        defaultValue={settings?.object_name ?? 'Nord Fjella'}
                        required
                        className={inputClassName}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Obec objektu</label>
                      <input
                        name="object_city"
                        defaultValue={settings?.object_city ?? 'Harrachov'}
                        required
                        className={inputClassName}
                      />
                    </div>
                  </div>
                </div>

                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">Poskytovatel pronájmu</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Název firmy</label>
                      <input name="provider_company_name" defaultValue={settings?.provider_company_name ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">IČO</label>
                      <input name="provider_company_id_number" defaultValue={settings?.provider_company_id_number ?? ''} className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">DIČ</label>
                      <input name="provider_vat_number" defaultValue={settings?.provider_vat_number ?? ''} className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">E-mail</label>
                      <input name="provider_email" type="email" defaultValue={settings?.provider_email ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Telefon</label>
                      <input name="provider_phone" defaultValue={settings?.provider_phone ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Ulice a číslo</label>
                      <input name="provider_street" defaultValue={settings?.provider_street ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Město</label>
                      <input name="provider_city" defaultValue={settings?.provider_city ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">PSČ</label>
                      <input name="provider_postal_code" defaultValue={settings?.provider_postal_code ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Země</label>
                      <input name="provider_country" defaultValue={settings?.provider_country ?? 'Česká republika'} required className={inputClassName} />
                    </div>
                  </div>
                </div>

                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="nord-fjella-modal-card-title mb-4 text-sm font-semibold text-gray-900">Platby a výchozí hodnoty</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Číslo účtu</label>
                      <input name="provider_bank_account" defaultValue={settings?.provider_bank_account ?? ''} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">IBAN</label>
                      <input name="provider_iban" defaultValue={settings?.provider_iban ?? ''} className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">SWIFT</label>
                      <input name="provider_swift" defaultValue={settings?.provider_swift ?? ''} className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Výchozí DPH ubytování %</label>
                      <input name="default_accommodation_vat_rate" defaultValue={settings?.default_accommodation_vat_rate ?? 12} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Místní poplatek / osoba / noc</label>
                      <input name="default_city_tax_rate" defaultValue={settings?.default_city_tax_rate ?? 30} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Výchozí úklid bez DPH</label>
                      <input name="default_cleaning_fee" defaultValue={settings?.default_cleaning_fee ?? 0} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Výchozí kauce</label>
                      <input name="default_security_deposit" defaultValue={settings?.default_security_deposit ?? 0} required className={inputClassName} />
                    </div>
                    <div className="space-y-2">
                      <label className="clients-modal__label text-sm font-medium text-gray-900">Výchozí splatnost podkladu (dny)</label>
                      <input name="default_invoice_due_days" defaultValue={settings?.default_invoice_due_days ?? 7} required className={inputClassName} />
                    </div>
                  </div>
                </div>

                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="space-y-2">
                    <label className="clients-modal__label text-sm font-medium text-gray-900">Výchozí veřejná poznámka do PDF</label>
                    <textarea
                      name="public_note_template"
                      rows={5}
                      defaultValue={settings?.public_note_template ?? ''}
                      className={`clients-modal__textarea ${inputClassName} min-h-[140px] py-3`}
                    />
                  </div>
                </div>

                {state.error ? (
                  <div className="nord-fjella-modal-error rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)]">
                    {state.error}
                  </div>
                ) : null}
              </div>
            </div>

            <MobileModalActions
              submitLabel="ULOŽIT NASTAVENÍ"
              pendingSubmitLabel="UKLÁDÁM..."
              onCancel={onClose}
              visualStyle="client-modal"
            />
          </form>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(modalContent, document.body)
}
