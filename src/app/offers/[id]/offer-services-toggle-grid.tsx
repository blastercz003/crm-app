'use client'

import { useState } from 'react'
import { toggleOfferPresetItem } from '@/app/offers/actions'
import { OFFER_SERVICE_GROUP_LABEL } from '@/lib/offers/presets'

type OfferServicesToggleGridProps = {
  offerId: string
  services: readonly string[]
  selectedServices: readonly string[]
}

function offerPresetButtonClassName(isActive: boolean, isDisabled = false) {
  return [
    'offers-detail-page__service-toggle inline-flex h-8 w-full items-center justify-center rounded-xl border px-1.5 text-center text-[10px] uppercase tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 sm:w-[150px] sm:px-2 sm:text-[11px] sm:tracking-[0.04em]',
    isActive
      ? 'offers-detail-page__service-toggle--active border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] font-semibold text-white hover:-translate-y-[1px]'
      : isDisabled
        ? 'offers-detail-page__service-toggle--inactive cursor-not-allowed border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-400 opacity-60'
      : 'offers-detail-page__service-toggle--inactive border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] font-normal text-gray-900 hover:-translate-y-[1px]',
  ].join(' ')
}

export function OfferServicesToggleGrid({
  offerId,
  services,
  selectedServices,
}: OfferServicesToggleGridProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(selectedServices))
  const [pendingServices, setPendingServices] = useState<Set<string>>(() => new Set())

  async function handleToggle(service: string) {
    if (pendingServices.has(service)) return

    const wasActive = selected.has(service)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(service)) {
        next.delete(service)
      } else {
        next.add(service)
      }
      return next
    })
    setPendingServices((prev) => new Set(prev).add(service))

    try {
      const formData = new FormData()
      formData.set('group', OFFER_SERVICE_GROUP_LABEL)
      formData.set('value', service)
      await toggleOfferPresetItem(offerId, formData)
    } catch (error) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (wasActive) {
          next.add(service)
        } else {
          next.delete(service)
        }
        return next
      })

      const message =
        error instanceof Error ? error.message : 'Nepodařilo se změnit službu. Zkus to prosím znovu.'
      alert(message)
    } finally {
      setPendingServices((prev) => {
        const next = new Set(prev)
        next.delete(service)
        return next
      })
    }
  }

  return (
    <div className="offers-detail-page__services-toggle-grid grid grid-cols-3 justify-items-center gap-2 sm:flex sm:flex-wrap sm:justify-center">
      {services.map((service) => {
        const isActive = selected.has(service)
        const isPending = pendingServices.has(service)

        return (
          <button
            key={service}
            type="button"
            onClick={() => {
              void handleToggle(service)
            }}
            disabled={isPending}
            className={offerPresetButtonClassName(isActive, isPending)}
          >
            {service}
          </button>
        )
      })}
    </div>
  )
}
