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
          'block h-8 w-full truncate rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-2.5 py-1 text-left text-[12px] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_18px_rgba(15,23,42,0.12)]',
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
      className="h-8 w-full rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-2.5 text-[12px] text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
    />
  )
}
