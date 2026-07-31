'use client'

import { useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type VehicleSelectorOption = {
  id: string
  assetName: string
  brand: string | null
  model: string | null
  registrationPlate: string
}

const LAST_VEHICLE_STORAGE_KEY = 'vehicle-logbook:last-vehicle-id'

function getVehicleLabel(vehicle: VehicleSelectorOption) {
  const detailName = [vehicle.brand, vehicle.model].filter(Boolean).join(' ').trim()
  return detailName || vehicle.assetName
}

export function VehicleSelector({
  vehicles,
  selectedVehicleId,
  selectionWasExplicit,
}: {
  vehicles: VehicleSelectorOption[]
  selectedVehicleId: string
  selectionWasExplicit: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const validIds = new Set(vehicles.map((vehicle) => vehicle.id))

    if (selectionWasExplicit) {
      window.localStorage.setItem(LAST_VEHICLE_STORAGE_KEY, selectedVehicleId)
      return
    }

    const storedVehicleId = window.localStorage.getItem(LAST_VEHICLE_STORAGE_KEY)
    if (
      storedVehicleId &&
      storedVehicleId !== selectedVehicleId &&
      validIds.has(storedVehicleId)
    ) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('vehicle', storedVehicleId)
      params.delete('page')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
      return
    }

    window.localStorage.setItem(LAST_VEHICLE_STORAGE_KEY, selectedVehicleId)
  }, [
    pathname,
    router,
    searchParams,
    selectedVehicleId,
    selectionWasExplicit,
    vehicles,
  ])

  function selectVehicle(vehicleId: string) {
    if (vehicleId === selectedVehicleId) return

    window.localStorage.setItem(LAST_VEHICLE_STORAGE_KEY, vehicleId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('vehicle', vehicleId)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <>
      <div
        className="vehicle-logbook-page__vehicle-tabs hidden gap-2 md:grid"
      >
        {vehicles.map((vehicle) => {
          const selected = vehicle.id === selectedVehicleId

          return (
            <button
              key={vehicle.id}
              type="button"
              data-selected={selected ? 'true' : 'false'}
              onClick={() => selectVehicle(vehicle.id)}
              className="vehicle-logbook-page__vehicle-tab min-w-0 rounded-2xl border px-4 py-3 text-left transition duration-200 hover:-translate-y-[1px]"
            >
              <span className="block truncate text-sm font-semibold">
                {getVehicleLabel(vehicle)}
              </span>
              <span className="mt-1 block truncate text-[11px] font-medium uppercase tracking-[0.08em] opacity-70">
                {vehicle.registrationPlate}
              </span>
            </button>
          )
        })}
      </div>

      <div className="md:hidden">
        <label
          htmlFor="vehicle-logbook-mobile-vehicle"
          className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500"
        >
          VOZIDLO
        </label>
        <select
          id="vehicle-logbook-mobile-vehicle"
          value={selectedVehicleId}
          onChange={(event) => selectVehicle(event.target.value)}
          className="vehicle-logbook-page__input h-11 w-full rounded-2xl border border-white/75 bg-white/90 px-4 text-sm font-medium text-gray-900 outline-none"
        >
          {vehicles.map((vehicle) => (
            <option key={vehicle.id} value={vehicle.id}>
              {getVehicleLabel(vehicle)} · {vehicle.registrationPlate}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
