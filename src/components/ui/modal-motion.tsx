'use client'

import { useCallback } from 'react'

export type ModalMotionProfile = 'standard' | 'confirmation'

const EXIT_DURATION: Record<ModalMotionProfile, number> = {
  standard: 180,
  confirmation: 145,
}

export function requestModalMotionClose(
  onClose: () => void,
  profile: ModalMotionProfile = 'standard'
) {
  if (
    typeof window === 'undefined' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    onClose()
    return
  }

  const roots = document.querySelectorAll<HTMLElement>('[data-modal-motion-root]')
  const root = roots.item(roots.length - 1)

  if (!root) {
    onClose()
    return
  }

  if (root.dataset.modalMotionState === 'closing') return

  root.dataset.modalMotionState = 'closing'
  root.style.pointerEvents = 'none'
  window.setTimeout(onClose, EXIT_DURATION[profile])
}

export function useModalMotionClose(
  onClose: () => void,
  profile: ModalMotionProfile = 'standard'
) {
  return useCallback(
    () => requestModalMotionClose(onClose, profile),
    [onClose, profile]
  )
}

