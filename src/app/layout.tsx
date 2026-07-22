import { cache, Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import './globals.css'
import { NavigationOverlay } from '../components/navigation/navigation-overlay'
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration'
import { PushSubscriptionGuard } from '../components/pwa/push-subscription-guard'
import {
  PwaStartupScreenController,
  PwaStartupScreenShell,
} from '../components/pwa/pwa-startup-screen'
import { ThemePreferenceSync } from '@/components/theme/theme-preference-sync'
import { AppRealtimeCoordinator } from '@/components/realtime/app-realtime-coordinator'
import { NotificationRealtimeSync } from '@/components/realtime/notification-realtime-sync'
import { APP_TITLE } from '@/lib/pageTitles'
import {
  THEME_COLORS,
  resolveThemeAppearanceMode,
} from '@/lib/theme/theme-preference'
import {
  getServerThemePreferences,
} from '@/lib/theme/theme-preference.server'

export const metadata: Metadata = {
  title: {
    default: APP_TITLE,
    template: `%s | ${APP_TITLE}`,
  },
  applicationName: 'B-ENERGY',
  description: 'CRM aplikace pro správu klientů, schůzek a úkolů',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'B-ENERGY',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icon.png', sizes: '1024x1024', type: 'image/png' },
    ],
    shortcut: ['/favicon.ico'],
    apple: '/icon.png',
  },
}

const getCachedThemePreferences = cache(getServerThemePreferences)

export async function generateViewport(): Promise<Viewport> {
  const themePreferences = await getCachedThemePreferences()
  const initialTheme = resolveThemeAppearanceMode(themePreferences)

  return {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    viewportFit: 'cover',
    themeColor: THEME_COLORS[initialTheme],
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const themePreferences = await getCachedThemePreferences()
  const initialTheme = resolveThemeAppearanceMode(themePreferences)
  const requestHeaders = await headers()
  const shouldRenderStartupScreen = requestHeaders.get('x-benergy-skip-startup-screen') !== '1'
    && (requestHeaders.get('x-matched-path') === '/' || requestHeaders.get('x-matched-path') === '/dashboard')

  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme={initialTheme}
      data-startup-overlay={shouldRenderStartupScreen ? 'pending' : 'hide'}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <PushSubscriptionGuard />
        <AppRealtimeCoordinator />
        <NotificationRealtimeSync />
        {shouldRenderStartupScreen ? <PwaStartupScreenShell /> : null}
        {shouldRenderStartupScreen ? <PwaStartupScreenController /> : null}
        <ThemePreferenceSync />
        <div id="app-shell" className="flex min-h-full flex-1 flex-col">
          {children}
          <Suspense fallback={null}>
            <NavigationOverlay />
          </Suspense>
        </div>
      </body>
    </html>
  )
}
