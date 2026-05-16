import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NavigationOverlay } from '../components/navigation/navigation-overlay'
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration'
import { APP_TITLE } from '@/lib/pageTitles'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

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
    { media: '(prefers-color-scheme: light)', color: '#eef3f8' },
    { media: '(prefers-color-scheme: dark)', color: '#eef3f8' },
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegistration />
        {children}
        <Suspense fallback={null}>
          <NavigationOverlay />
        </Suspense>
      </body>
    </html>
  )
}
