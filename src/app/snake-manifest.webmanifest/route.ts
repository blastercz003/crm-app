import { NextResponse } from 'next/server'

export function GET() {
  return NextResponse.json(
    {
      name: 'B-SNAKE',
      short_name: 'B-SNAKE',
      description: 'B-SNAKE arcade hra',
      start_url: '/snake',
      scope: '/snake',
      display: 'standalone',
      background_color: '#0c1528',
      theme_color: '#0c1528',
      icons: [
        {
          src: '/icon.png',
          sizes: '1024x1024',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: '/icon.png',
          sizes: '1024x1024',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    {
      headers: {
        'Content-Type': 'application/manifest+json; charset=utf-8',
      },
    }
  )
}
