import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
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
} from '@/lib/theme/theme-preference'

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
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme="light"
      data-startup-overlay="pending"
      suppressHydrationWarning
    >
      <head>
        <meta name="theme-color" content={THEME_COLORS.light} />
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {`(function () {
  try {
    var themeMode = window.localStorage.getItem(${JSON.stringify('meeting-crm.theme-mode')});
    var overrideMode = window.localStorage.getItem(${JSON.stringify('meeting-crm.theme-auto-override-mode')});
    var overrideUntil = window.localStorage.getItem(${JSON.stringify('meeting-crm.theme-auto-override-until')});
    var now = new Date();
    var theme = themeMode === 'light' || themeMode === 'dark'
      ? themeMode
      : (function () {
          if (
            themeMode === 'auto' &&
            (overrideMode === 'light' || overrideMode === 'dark') &&
            overrideUntil &&
            !Number.isNaN(new Date(overrideUntil).getTime()) &&
            new Date(overrideUntil).getTime() > now.getTime()
          ) {
            return overrideMode;
          }

          var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Europe/Prague',
            hour12: false,
            hour: '2-digit',
          }).formatToParts(now);
          var hour = Number((parts.find(function (part) { return part.type === 'hour'; }) || {}).value || 0);
          return hour >= 20 || hour < 9 ? 'dark' : 'light';
        })();

    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '${THEME_COLORS.dark}' : '${THEME_COLORS.light}');
    }

    var pathname = window.location.pathname;
    var allowedPath = pathname === '/' || pathname === '/dashboard';
    if (!allowedPath) {
      document.documentElement.setAttribute('data-startup-overlay', 'hide');
      return;
    }

    var ua = navigator.userAgent || '';
    var isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    var isStandalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches === true) ||
      ('standalone' in navigator && Boolean(navigator.standalone));

    var shouldShow = sessionStorage.getItem('pwaStartupFinished') !== 'true' &&
      ((isStandalone && isMobile) || (!isStandalone && !isMobile));

    document.documentElement.setAttribute('data-startup-overlay', shouldShow ? 'show' : 'hide');
  } catch (_) {
    document.documentElement.setAttribute('data-startup-overlay', 'hide');
  }
})();`}
        </Script>
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
