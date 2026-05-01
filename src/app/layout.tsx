import { Suspense } from 'react'
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { NavigationOverlay } from '../components/navigation/navigation-overlay'
import { ServiceWorkerRegistration } from '../components/pwa/service-worker-registration'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'B-ENERGY CRM',
  applicationName: 'B-ENERGY',
  description: 'CRM aplikace pro správu klientů, schůzek a úkolů',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'B-ENERGY',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icon.png',
    shortcut: '/icon.png',
    apple: '/icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#2980B9',
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
