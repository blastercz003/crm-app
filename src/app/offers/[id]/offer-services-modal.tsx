'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toggleOfferPresetItem } from '@/app/offers/actions'
import { OFFER_SERVICE_GROUP_LABEL } from '@/lib/offers/presets'

type OfferServicesModalProps = {
  offerId: string
  services: readonly string[]
  selectedServices: string[]
}

function serviceChoiceButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm font-semibold uppercase transition',
    isActive
      ? 'border-[#2980B9] bg-[#2980B9] text-white shadow-sm'
      : 'border-gray-200 bg-gray-100 text-gray-700 hover:border-gray-300 hover:bg-gray-200',
  ].join(' ')
}

function ServiceChoiceButton({
  isActive,
  disabled,
  children,
}: {
  isActive: boolean
  disabled: boolean
  children: string
}) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={`${serviceChoiceButtonClassName(isActive)} ${
        pending ? 'cursor-wait opacity-65' : disabled ? 'cursor-default' : ''
      }`}
    >
      {pending ? '...' : children}
    </button>
  )
}

export function OfferServicesModal({
  offerId,
  services,
  selectedServices,
}: OfferServicesModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const selectedServiceSet = new Set(selectedServices)

  return (
    <>
      <section className="min-w-0 overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">
              SLUŽBY
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Vyber služby pro klienta
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-black px-4 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
          >
            Upravit služby
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {services.map((service) => {
            const isActive = selectedServiceSet.has(service)

            return (
              <span
                key={service}
                className={[
                  'inline-flex h-8 w-[150px] items-center justify-center rounded-xl border px-2 text-center text-[11px] font-semibold uppercase tracking-[0.04em]',
                  isActive
                    ? 'border-[#2980B9] bg-[#2980B9] text-white'
                    : 'border-gray-200 bg-gray-100 text-gray-900',
                ].join(' ')}
              >
                {service}
              </span>
            )
          })}
        </div>
      </section>

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
          aria-modal="true"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false)
            }
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
            <div className="flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]">
              <div className="flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
                <div>
                  <h2 className="text-lg font-semibold uppercase text-gray-900">
                    Upravit služby
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Aktivní služby se propíšou do nabídky i PDF.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-lg text-gray-500 transition hover:bg-gray-50"
                  aria-label="Zavřít modal"
                >
                  ×
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
                <div className="grid gap-2">
                  {services.map((service) => {
                    const isActive = selectedServiceSet.has(service)

                    return (
                      <div
                        key={service}
                        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-2"
                      >
                        <div className="min-w-0 text-sm font-semibold uppercase text-gray-900">
                          {service}
                        </div>
                        <div className="grid w-[220px] shrink-0 grid-cols-2 gap-2 rounded-2xl bg-white p-1 shadow-sm">
                          <form action={isActive ? undefined : toggleOfferPresetItem.bind(null, offerId)}>
                            <input type="hidden" name="group" value={OFFER_SERVICE_GROUP_LABEL} />
                            <input type="hidden" name="value" value={service} />
                            <ServiceChoiceButton isActive={isActive} disabled={isActive}>
                              ANO
                            </ServiceChoiceButton>
                          </form>
                          <form action={isActive ? toggleOfferPresetItem.bind(null, offerId) : undefined}>
                            <input type="hidden" name="group" value={OFFER_SERVICE_GROUP_LABEL} />
                            <input type="hidden" name="value" value={service} />
                            <ServiceChoiceButton isActive={false} disabled={!isActive}>
                              NE
                            </ServiceChoiceButton>
                          </form>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="border-t border-gray-200 px-4 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-gray-900 px-5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
                >
                  Zavřít
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
