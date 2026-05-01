self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}

  if (event.data) {
    try {
      data = event.data.json()
    } catch {
      data = {
        title: 'B-ENERGY',
        body: event.data.text(),
      }
    }
  }

  const title = data.title || 'B-ENERGY'
  const badgeCount =
    typeof data.badgeCount === 'number' && Number.isFinite(data.badgeCount)
      ? data.badgeCount
      : null
  const options = {
    body: data.body || data.message || '',
    icon: data.icon || '/icon.png',
    badge: data.badge || '/icon.png',
    data: {
      url: data.url || data.href || '/',
    },
  }

  const notificationPromise = self.registration.showNotification(title, options)
  const badgePromise =
    badgeCount === null || !self.navigator?.setAppBadge
      ? Promise.resolve()
      : badgeCount > 0
        ? self.navigator.setAppBadge(badgeCount)
        : self.navigator.clearAppBadge
          ? self.navigator.clearAppBadge()
          : self.navigator.setAppBadge(0)

  event.waitUntil(Promise.all([notificationPromise, badgePromise]))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin)
    .href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus()
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }

      return undefined
    })
  )
})
