import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import './globals.css'
import { NavigationOverlay } from '../components/navigation/navigation-overlay'
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration'
import {
  PwaStartupScreenController,
  PwaStartupScreenShell,
} from '../components/pwa/pwa-startup-screen'
import { ThemePreferenceSync } from '@/components/theme/theme-preference-sync'
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

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const themePreferences = await getServerThemePreferences()
  const initialTheme = resolveThemeAppearanceMode(themePreferences)

  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme={initialTheme}
      data-startup-overlay="pending"
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content={THEME_COLORS[initialTheme]} />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        <PwaStartupScreenShell />
        <PwaStartupScreenController />
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
