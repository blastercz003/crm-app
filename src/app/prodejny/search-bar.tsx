'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

type StoresSearchBarProps = {
  initialQuery: string
}

export function StoresSearchBar({ initialQuery }: StoresSearchBarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(initialQuery)
  const lastSubmittedQueryRef = useRef(initialQuery)

  useEffect(() => {
    const trimmed = query.trim()

    if (trimmed === lastSubmittedQueryRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())

      if (trimmed.length >= 3) {
        params.set('q', trimmed)
      } else {
        params.delete('q')
      }

      const nextQueryString = params.toString()
      const nextHref = nextQueryString ? `${pathname}?${nextQueryString}` : pathname

      lastSubmittedQueryRef.current = trimmed.length >= 3 ? trimmed : ''
      router.replace(nextHref, { scroll: false })
    }, 300)

    return () => window.clearTimeout(timeoutId)
  }, [pathname, query, router, searchParams])

  return (
    <input
      type="text"
      value={query}
      onChange={(event) => setQuery(event.target.value)}
      placeholder="Hledat podle řetězce, čísla prodejny, adresy nebo telefonu"
      className="stores-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-72 lg:w-[28rem]"
    />
  )
}
