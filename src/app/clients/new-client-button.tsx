'use client'

import { useActionState, useEffect, useState } from 'react'
import { createClientModalAction, type CreateClientActionState } from './actions'

type NewClientButtonProps = {
  className?: string
  label?: string
}

const initialCreateState: CreateClientActionState = {
  success: false,
  error: null,
}

export function NewClientButton({
  className,
  label = 'NOVÝ KLIENT',
}: NewClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium uppercase text-white transition hover:bg-[#236f9f]'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={resolvedClassName}
      >
        {label}
      </button>

      {isOpen ? <CreateClientModal key={formKey} onClose={closeModal} /> : null}
    </>
  )
}

function CreateClientModal({ onClose }: { onClose: () => void }) {
  const [state, formAction] = useActionState(
    createClientModalAction,
    initialCreateState
  )

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Nový klient
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Přidej novou firmu do databáze klientů.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium text-gray-900"
                  >
                    Název firmy *
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    placeholder="Např. ABC Stavby s.r.o."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="ico"
                    className="text-sm font-medium text-gray-900"
                  >
                    IČO
                  </label>
                  <input
                    id="ico"
                    name="ico"
                    type="text"
                    placeholder="Např. 12345678"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_person"
                    className="text-sm font-medium text-gray-900"
                  >
                    Kontaktní osoba
                  </label>
                  <input
                    id="contact_person"
                    name="contact_person"
                    type="text"
                    placeholder="Např. Jan Novák"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_phone"
                    className="text-sm font-medium text-gray-900"
                  >
                    Telefon
                  </label>
                  <input
                    id="contact_phone"
                    name="contact_phone"
                    type="text"
                    placeholder="Např. +420 777 123 456"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_email"
                    className="text-sm font-medium text-gray-900"
                  >
                    E-mail
                  </label>
                  <input
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    placeholder="Např. novak@firma.cz"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="address"
                    className="text-sm font-medium text-gray-900"
                  >
                    Adresa
                  </label>
                  <input
                    id="address"
                    name="address"
                    type="text"
                    placeholder="Např. Ulice 123, 110 00 Praha"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="note"
                    className="text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id="note"
                    name="note"
                    rows={5}
                    placeholder="Doplňující informace o klientovi, preferencích nebo spolupráci."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-5 sm:py-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                ZRUŠIT
              </button>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ULOŽIT KLIENTA
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
