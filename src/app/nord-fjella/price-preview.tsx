'use client'

function numberValue(value: string) {
  const parsed = Number(value.replace(/\s+/g, '').replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(value)
}

export function PricePreview({
  stayStartDate,
  stayEndDate,
  accommodationNightRate,
  accommodationVatRate,
  cleaningFee,
  cleaningVatRate,
}: {
  stayStartDate: string
  stayEndDate: string
  accommodationNightRate: string
  accommodationVatRate: string
  cleaningFee: string
  cleaningVatRate: string
}) {
  const nights =
    stayStartDate && stayEndDate
      ? Math.max(
          0,
          Math.round(
            (new Date(`${stayEndDate}T12:00:00Z`).getTime() -
              new Date(`${stayStartDate}T12:00:00Z`).getTime()) /
              86_400_000
          )
        )
      : 0
  const accommodationNet = nights * numberValue(accommodationNightRate)
  const cleaningNet = numberValue(cleaningFee)
  const net = accommodationNet + cleaningNet
  const vat =
    accommodationNet * (numberValue(accommodationVatRate) / 100) +
    cleaningNet * (numberValue(cleaningVatRate) / 100)
  const gross = net + vat

  return (
    <div className="nord-fjella-modal-subtle-card grid gap-2 rounded-2xl border border-white/75 bg-white/75 p-3 sm:grid-cols-4">
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          Nocí
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{nights}</div>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          Základ bez DPH
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(net)}</div>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          DPH
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(vat)}</div>
      </div>
      <div>
        <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400">
          Základní cena s DPH
        </div>
        <div className="mt-1 text-sm font-semibold text-[#236f9f] [html[data-theme='dark']_&]:text-sky-200">
          {formatCurrency(gross)}
        </div>
      </div>
    </div>
  )
}
