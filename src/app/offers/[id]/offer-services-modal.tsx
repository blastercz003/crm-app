'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { toggleOfferPresetItem } from '@/app/offers/actions'
import { OFFER_SERVICE_GROUP_LABEL } from '@/lib/offers/presets'
import { ModalHeading } from '@/components/ui/modal-heading'

type OfferServicesModalProps = {
  offerId: string
  services: readonly string[]
  selectedServices: string[]
}

function serviceChoiceButtonClassName(isActive: boolean) {
  return [
    'inline-flex h-11 w-full items-center justify-center rounded-xl border text-sm font-semibold uppercase transition duration-200',
    isActive
      ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_10px_22px_rgba(24,78,129,0.3)] hover:-translate-y-[1px]'
      : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px]',
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
      <section className="offers-detail-page__services-section min-w-0 overflow-hidden rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">
              SLUŽBY
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
          >
            Upravit služby
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {services.map((service) => {
            const isActive = selectedServiceSet.has(service)

            return (
              <span
                key={service}
                className={[
                  'inline-flex h-8 w-full items-center justify-center rounded-xl border px-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.08)] sm:w-[150px] sm:px-2 sm:text-[11px] sm:tracking-[0.04em]',
                  isActive
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white'
                    : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-900',
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
          className="offers-detail-page__services-modal-overlay fixed inset-0 z-[100] bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
          aria-modal="true"
          role="dialog"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setIsOpen(false)
            }
          }}
        >
          <div className="mx-auto flex h-full w-full max-w-3xl items-center justify-center">
            <div className="offers-detail-page__services-modal-shell flex max-h-[calc(100vh-2rem)] w-full flex-col overflow-hidden rounded-[30px] border border-zinc-200/86 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(249,252,255,0.82)_50%,rgba(245,250,255,0.74)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_30px_72px_rgba(24,24,27,0.28)] sm:max-h-[calc(100vh-3rem)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_36px_84px_rgba(24,24,27,0.32)]">
              <div className="offers-detail-page__services-modal-header flex items-start justify-between gap-4 px-4 py-4 sm:px-6">
                <div>
                  <ModalHeading section="NABÍDKY" title="Upravit služby" />
                  <p className="mt-1 text-sm text-gray-500">
                    Aktivní služby se propíšou do nabídky i PDF.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-lg text-gray-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)]"
                  aria-label="Zavřít modal"
                >
              ✕
                </button>
              </div>

              <div className="offers-detail-page__services-modal-body flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
                <div className="grid gap-2">
                  {services.map((service) => {
                    const isActive = selectedServiceSet.has(service)

                    return (
                      <div
                        key={service}
                        className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                      >
                        <div className="min-w-0 text-sm font-semibold uppercase text-gray-900">
                          {service}
                        </div>
                        <div className="grid w-[220px] shrink-0 grid-cols-2 gap-2 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)]">
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

              <div className="offers-detail-page__services-modal-footer border-t border-[#d8e4ef] px-4 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
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
