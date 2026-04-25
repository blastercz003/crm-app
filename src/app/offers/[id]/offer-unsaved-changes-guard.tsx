'use client'

import { useEffect } from 'react'

type OfferUnsavedChangesGuardProps = {
  formId: string
  message: string
}

export function OfferUnsavedChangesGuard({ formId, message }: OfferUnsavedChangesGuardProps) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null
    const guardedLinks = Array.from(
      document.querySelectorAll<HTMLAnchorElement>('[data-offer-unsaved-guard="true"]')
    )

    if (!form || guardedLinks.length === 0) return

    let isDirty = false

    const markDirty = () => {
      isDirty = true
    }

    const markClean = () => {
      isDirty = false
    }

    const handleGuardedClick = (event: MouseEvent) => {
      if (!isDirty) return

      event.preventDefault()
      window.alert(message)
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return

      event.preventDefault()
      event.returnValue = message
    }

    form.addEventListener('input', markDirty)
    form.addEventListener('change', markDirty)
    form.addEventListener('submit', markClean)
    window.addEventListener('beforeunload', handleBeforeUnload)
    guardedLinks.forEach((link) => link.addEventListener('click', handleGuardedClick))

    return () => {
      form.removeEventListener('input', markDirty)
      form.removeEventListener('change', markDirty)
      form.removeEventListener('submit', markClean)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      guardedLinks.forEach((link) => link.removeEventListener('click', handleGuardedClick))
    }
  }, [formId, message])

  return null
}
