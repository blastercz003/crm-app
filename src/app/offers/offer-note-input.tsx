'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { updateOfferInternalNote } from '@/app/offers/actions'

type OfferNoteInputProps = {
  offerId: string
  initialValue: string
}

export function OfferNoteInput({ offerId, initialValue }: OfferNoteInputProps) {
  const [value, setValue] = useState(initialValue)
  const [savedValue, setSavedValue] = useState(initialValue)
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditing) return

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const save = () => {
    if (value.trim() === savedValue.trim()) return

    const formData = new FormData()
    formData.set('internal_note', value)

    startTransition(async () => {
      await updateOfferInternalNote(offerId, formData)
      setSavedValue(value)
      setIsEditing(false)
    })
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        title={savedValue || 'Přidat poznámku'}
        className={[
          'block h-8 w-full truncate rounded-xl border border-white/45 bg-[linear-gradient(160deg,rgba(255,255,255,0.52)_0%,rgba(236,246,253,0.34)_100%)] px-2.5 py-1 text-left text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(148,163,184,0.14)] transition duration-200 ease-out',
          savedValue ? 'text-gray-700 hover:text-gray-900' : 'text-gray-400 hover:text-gray-600',
        ].join(' ')}
      >
        {isPending ? 'Ukládám...' : savedValue || 'Přidat poznámku'}
      </button>
    )
  }

  return (
      <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setValue(savedValue)
          setIsEditing(false)
          return
        }

        if (event.key !== 'Enter') return

        event.currentTarget.blur()
      }}
      placeholder={isPending ? 'Ukládám...' : 'Vlastní poznámka'}
      className="h-8 w-full rounded-xl border border-white/45 bg-[linear-gradient(160deg,rgba(255,255,255,0.52)_0%,rgba(236,246,253,0.34)_100%)] px-2.5 text-[12px] text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.74),inset_0_-1px_0_rgba(148,163,184,0.14)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
    />
  )
}
