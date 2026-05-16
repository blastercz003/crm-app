import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  manifest: '/snake-manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'B-SNAKE',
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#0c1528',
  colorScheme: 'dark',
}

export default function SnakeLayout({ children }: { children: ReactNode }) {
  return children
}
