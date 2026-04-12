'use client'

import { useRef, useState, useTransition } from 'react'
import { addComment } from './actions'

type CommentFormProps = {
  entityType: string
  entityId: string
  path: string
}

export default function CommentForm({
  entityType,
  entityId,
  path,
}: CommentFormProps) {
  const formRef = useRef<HTMLFormElement>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')

    startTransition(async () => {
      const result = await addComment({
        entityType,
        entityId,
        content,
        path,
      })

      if (result?.error) {
        setError(result.error)
        return
      }

      setContent('')
      formRef.current?.reset()
    })
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor={`comment-${entityType}-${entityId}`}
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          Přidat komentář
        </label>

        <textarea
          id={`comment-${entityType}-${entityId}`}
          name="content"
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Napište poznámku nebo informaci pro tým..."
          className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400"
        />
      </div>

      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Ukládám...' : 'Přidat komentář'}
        </button>
      </div>
    </form>
  )
}