import type { ReactNode } from 'react'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Snake',
  },
}

export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0c1528' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1528' },
  ],
}

export default function SnakeLayout({ children }: { children: ReactNode }) {
  return children
}
