import type { OfferType } from '@/lib/offers/types'

export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  classic: 'KLASICKÁ',
  bsafe24: 'B-SAFE 24',
}

export function getOfferTypeBadgeClass(type: OfferType) {
  if (type === 'bsafe24') {
    return 'offers-page__offer-type-badge offers-page__offer-type-badge--bsafe24 border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(24,78,129,0.24)]'
  }

  return 'offers-page__offer-type-badge offers-page__offer-type-badge--classic border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)]'
}
