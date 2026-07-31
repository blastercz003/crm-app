'use client'

import { useState } from 'react'

function getDownloadFileName(response: Response) {
  const disposition = response.headers.get('content-disposition') ?? ''
  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (encodedMatch?.[1]) return decodeURIComponent(encodedMatch[1])

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i)
  return plainMatch?.[1] || 'plan-zakazek.pdf'
}

export function PrintJobsButton({
  href,
  className = '',
}: {
  href?: string
  className?: string
}) {
  const [isDownloading, setIsDownloading] = useState(false)

  async function handleDownload() {
    if (isDownloading) return
    if (!href) {
      window.print()
      return
    }
    setIsDownloading(true)

    try {
      const response = await fetch(href, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error || 'PDF se nepodařilo vytvořit.')
      }

      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = getDownloadFileName(response)
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : 'PDF se nepodařilo vytvořit.'
      )
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isDownloading}
      title={href ? 'Stáhnout plán zakázek v PDF' : 'Tisk / Uložit do PDF'}
      aria-label={
        isDownloading
          ? 'Generuji PDF'
          : href
            ? 'Stáhnout plán zakázek v PDF'
            : 'Tisk / Uložit do PDF'
      }
      className={[
        'inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800 disabled:pointer-events-none disabled:opacity-65',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className={`h-4 w-4 ${isDownloading ? 'animate-spin' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        {isDownloading ? (
          <path strokeLinecap="round" d="M12 3a9 9 0 109 9" />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 9V4h12v5M6 18h12v2H6v-2zm-2-3h16a2 2 0 002-2v-3a2 2 0 00-2-2H4a2 2 0 00-2 2v3a2 2 0 002 2z"
          />
        )}
      </svg>
    </button>
  )
}
