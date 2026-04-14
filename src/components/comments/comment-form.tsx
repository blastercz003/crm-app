'use client'

import { useMemo, useState, useTransition } from 'react'
import { addComment } from './actions'
import type { CommentEntityType } from './actions'

type CommentFormProps = {
  entityType: CommentEntityType
  entityId: string
  path: string
}

const MAX_COMMENT_LENGTH = 1000

export default function CommentForm({
  entityType,
  entityId,
  path,
}: CommentFormProps) {
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isPending, startTransition] = useTransition()

  const trimmedContent = content.trim()
  const contentLength = content.length
  const isTooLong = contentLength > MAX_COMMENT_LENGTH

  const submitDisabled = useMemo(() => {
    return isPending || !trimmedContent || isTooLong
  }, [isPending, trimmedContent, isTooLong])

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setContent(event.target.value)

    if (error) {
      setError('')
    }

    if (successMessage) {
      setSuccessMessage('')
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setError('')
    setSuccessMessage('')

    if (!trimmedContent) {
      setError('Komentář nemůže být prázdný.')
      return
    }

    if (isTooLong) {
      setError(`Komentář může mít maximálně ${MAX_COMMENT_LENGTH} znaků.`)
      return
    }

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
      setSuccessMessage('Komentář byl přidán.')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor={`comment-${entityType}-${entityId}`}
          className="mb-2 block text-sm font-medium text-gray-800"
        >
          Přidat komentář
        </label>

        <textarea
          id={`comment-${entityType}-${entityId}`}
          name="content"
          rows={4}
          value={content}
          onChange={handleChange}
          placeholder="Napište poznámku, důležitou informaci nebo update pro tým..."
          maxLength={MAX_COMMENT_LENGTH}
          className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-0"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Komentáře slouží jako sdílené interní poznámky pro tým.
          </p>

          <p className="shrink-0 text-xs font-medium text-gray-400">
            {contentLength} / {MAX_COMMENT_LENGTH}
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!error && successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {successMessage}
        </div>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitDisabled}
          className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Ukládám...' : 'Přidat komentář'}
        </button>
      </div>
    </form>
  )
}