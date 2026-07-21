'use client'

import { useEffect } from 'react'

type OfferUnsavedChangesGuardProps = {
  formId: string
  message: string
}

let isOfferFormDirty = false

export function isOfferDirty() {
  return isOfferFormDirty
}

export function clearOfferDirtyState() {
  isOfferFormDirty = false
}

export function confirmOfferNavigation(message: string) {
  if (!isOfferFormDirty) return true

  window.alert(message)
  return false
}

export function OfferUnsavedChangesGuard({ formId, message }: OfferUnsavedChangesGuardProps) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null
    const guardedLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('[data-offer-unsaved-guard="true"]')
    )

    if (!form) return

    const markDirty = () => {
      isOfferFormDirty = true
      form.dataset.realtimeRefreshBlock = 'true'
    }

    const markClean = () => {
      isOfferFormDirty = false
      delete form.dataset.realtimeRefreshBlock
    }

    markClean()

    const handleGuardedClick = (event: MouseEvent) => {
      if (!isOfferFormDirty) return

      event.preventDefault()
      event.stopImmediatePropagation()
      window.alert(message)
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isOfferFormDirty) return

      event.preventDefault()
      event.returnValue = message
    }

    form.addEventListener('input', markDirty)
    form.addEventListener('change', markDirty)
    form.addEventListener('submit', markClean)
    window.addEventListener('beforeunload', handleBeforeUnload)
    guardedLinks.forEach((link) => link.addEventListener('click', handleGuardedClick))

    return () => {
      delete form.dataset.realtimeRefreshBlock
      form.removeEventListener('input', markDirty)
      form.removeEventListener('change', markDirty)
      form.removeEventListener('submit', markClean)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      guardedLinks.forEach((link) => link.removeEventListener('click', handleGuardedClick))
    }
  }, [formId, message])

  return null
}
