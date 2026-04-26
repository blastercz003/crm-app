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
          'block h-8 w-full truncate rounded-lg px-1 py-1 text-left text-[12px] transition hover:bg-black/[0.025]',
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
      className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
    />
  )
}
