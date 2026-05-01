type NavigatorWithBadging = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

export async function setAppBadgeCount(count: number) {
  const navigatorWithBadging = navigator as NavigatorWithBadging

  if (!navigatorWithBadging.setAppBadge) return

  const normalizedCount = Math.max(0, Math.floor(count))

  if (normalizedCount > 0) {
    await navigatorWithBadging.setAppBadge(normalizedCount)
    return
  }

  if (navigatorWithBadging.clearAppBadge) {
    await navigatorWithBadging.clearAppBadge()
    return
  }

  await navigatorWithBadging.setAppBadge(0)
}
