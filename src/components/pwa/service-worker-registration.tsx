'use client'

import { useEffect } from 'react'

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    const isLocalHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '::1'

    if (process.env.NODE_ENV !== 'production' || isLocalHost) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(registrations.map((registration) => registration.unregister()))
        )
        .catch((error) => {
          console.error('Nepodařilo se odregistrovat service worker v developmentu.', error)
        })
      return
    }

    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Nepodařilo se zaregistrovat service worker.', error)
    })
  }, [])

  return null
}
