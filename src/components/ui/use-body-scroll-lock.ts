'use client'

import { useEffect } from 'react'

const LOCK_COUNT_KEY = 'codexBodyScrollLockCount'
const PREVIOUS_OVERFLOW_KEY = 'codexBodyPreviousOverflow'

function readLockCount(body: HTMLElement) {
  const raw = body.dataset[LOCK_COUNT_KEY]
  const parsed = raw ? Number(raw) : 0

  return Number.isFinite(parsed) ? parsed : 0
}

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return

    const { body } = document
    const currentCount = readLockCount(body)

    if (currentCount === 0) {
      body.dataset[PREVIOUS_OVERFLOW_KEY] = body.style.overflow
      body.style.overflow = 'hidden'
    }

    body.dataset[LOCK_COUNT_KEY] = String(currentCount + 1)

    return () => {
      const nextCount = Math.max(0, readLockCount(body) - 1)

      if (nextCount === 0) {
        body.style.overflow = body.dataset[PREVIOUS_OVERFLOW_KEY] ?? ''
        delete body.dataset[PREVIOUS_OVERFLOW_KEY]
        delete body.dataset[LOCK_COUNT_KEY]
        return
      }

      body.dataset[LOCK_COUNT_KEY] = String(nextCount)
    }
  }, [active])
}
