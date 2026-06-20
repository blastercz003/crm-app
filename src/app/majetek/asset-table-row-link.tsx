'use client'

import { useRouter } from 'next/navigation'
import type { KeyboardEvent } from 'react'
import { NAVIGATION_OVERLAY_START_EVENT } from '@/components/navigation/navigation-overlay'

type AssetTableRowLinkProps = {
  href: string
  name: string
  statusLabel: string
  purchaseDateLabel?: string
  purchasePriceLabel?: string
  createdAtLabel?: string
  vinLabel?: string
  insurancePolicyLabel?: string
  insuranceProviderLabel?: string
  insuranceLabel?: string
  rentalLabel?: string
  stkExpiresLabel?: string
  variant?: 'default' | 'vehicle' | 'real_estate'
}

export function AssetTableRowLink({
  href,
  name,
  statusLabel,
  purchaseDateLabel,
  purchasePriceLabel,
  createdAtLabel,
  vinLabel,
  insurancePolicyLabel,
  insuranceProviderLabel,
  insuranceLabel,
  rentalLabel,
  stkExpiresLabel,
  variant = 'default',
}: AssetTableRowLinkProps) {
  const router = useRouter()

  function triggerNavigationOverlay() {
    window.dispatchEvent(new Event(NAVIGATION_OVERLAY_START_EVENT))
  }

  function handleClick() {
    triggerNavigationOverlay()
    router.push(href)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      triggerNavigationOverlay()
      router.push(href)
    }
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="assets-page__row-link cursor-pointer border-t border-white/60 transition duration-150 hover:bg-white/70 focus:outline-none focus:ring-2 focus:ring-[#9dc7e5]"
    >
      <td className="px-5 py-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-gray-900">{name}</p>
          {createdAtLabel ? (
            <p className="text-xs text-zinc-500">Vytvořeno {createdAtLabel}</p>
          ) : null}
        </div>
      </td>
      <td className="px-5 py-4 text-sm text-gray-700">{statusLabel}</td>
      {variant === 'vehicle' ? (
        <>
          <td className="px-5 py-4 text-sm text-gray-700">{vinLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insurancePolicyLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insuranceProviderLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insuranceLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{stkExpiresLabel ?? '—'}</td>
          <td className="px-5 py-4 text-right">
            <span className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">
              OTEVŘÍT
            </span>
          </td>
        </>
      ) : variant === 'real_estate' ? (
        <>
          <td className="px-5 py-4 text-sm text-gray-700">{rentalLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insurancePolicyLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insuranceProviderLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{insuranceLabel ?? '—'}</td>
          <td className="px-5 py-4 text-right">
            <span className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">
              OTEVŘÍT
            </span>
          </td>
        </>
      ) : (
        <>
          <td className="px-5 py-4 text-sm text-gray-700">{purchaseDateLabel ?? '—'}</td>
          <td className="px-5 py-4 text-sm text-gray-700">{purchasePriceLabel ?? '—'}</td>
          <td className="px-5 py-4 text-right">
            <span className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">
              OTEVŘÍT
            </span>
          </td>
        </>
      )}
    </tr>
  )
}
