'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import { createAssetNoteAction, type CreateAssetNoteActionState } from './actions'

const initialState: CreateAssetNoteActionState = {
  success: false,
  error: null,
}

const textareaClassName =
  'clients-modal__textarea min-h-[120px] w-full resize-y rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

type AssetNoteFormProps = {
  assetId: string
}

export function AssetNoteForm({ assetId }: AssetNoteFormProps) {
  const router = useRouter()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [state, formAction] = useActionState(createAssetNoteAction, initialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
    if (textareaRef.current) {
      textareaRef.current.value = ''
    }
  }, [router, state.success])

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="asset_id" value={assetId} />

      <div className="space-y-2">
        <textarea
          ref={textareaRef}
          id={`asset-note-${assetId}`}
          name="body"
          placeholder="Zapiš krátkou poznámku k majetku."
          className={textareaClassName}
        />
      </div>

      {state.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      ) : null}

      {state.success ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Poznámka byla uložena.
        </div>
      ) : null}

      <NoteActions />
    </form>
  )
}

function NoteActions() {
  const { pending } = useFormStatus()

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'UKLÁDÁM...' : 'ULOŽIT POZNÁMKU'}
      </button>
    </div>
  )
}
