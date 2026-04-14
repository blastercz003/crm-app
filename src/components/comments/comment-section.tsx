import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import CommentForm from './comment-form'
import {
  deleteComment,
  updateComment,
} from './actions'
import type { CommentEntityType } from './actions'

type CommentSectionProps = {
  entityType: CommentEntityType
  entityId: string
  path: string
}

type CommentAuthor =
  | {
      name: string | null
    }
  | {
      name: string | null
    }[]
  | null

type CommentRow = {
  id: string
  content: string
  created_at: string
  user_id: string
  author: CommentAuthor
}

function resolveAuthorName(author: CommentAuthor) {
  if (!author) return 'Uživatel'
  if (Array.isArray(author)) return author[0]?.name ?? 'Uživatel'
  return author.name ?? 'Uživatel'
}

function getCommentCountLabel(count: number) {
  if (count === 1) return '1 komentář'
  if (count >= 2 && count <= 4) return `${count} komentáře`
  return `${count} komentářů`
}

function getRelativeTimeLabel(value: string) {
  const now = Date.now()
  const date = new Date(value).getTime()
  const diffInSeconds = Math.floor((now - date) / 1000)

  if (Number.isNaN(date)) {
    return ''
  }

  if (diffInSeconds < 10) return 'právě teď'
  if (diffInSeconds < 60) return `před ${diffInSeconds} s`

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes === 1) return 'před 1 min'
  if (diffInMinutes >= 2 && diffInMinutes <= 4) return `před ${diffInMinutes} min`
  if (diffInMinutes < 60) return `před ${diffInMinutes} min`

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours === 1) return 'před 1 h'
  if (diffInHours >= 2 && diffInHours <= 24) return `před ${diffInHours} h`

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays === 1) return 'včera'
  if (diffInDays >= 2 && diffInDays <= 4) return `před ${diffInDays} dny`

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default async function CommentSection({
  entityType,
  entityId,
  path,
}: CommentSectionProps) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const currentUserId = user?.id ?? null

  const { data, error } = await supabase
    .from('comments')
    .select(`
      id,
      content,
      created_at,
      user_id,
      author:profiles!comments_user_id_fkey (
        name
      )
    `)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('CommentSection fetch error:', error)
    throw new Error('Nepodařilo se načíst komentáře.')
  }

  const comments = (data ?? []) as CommentRow[]

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Komentáře</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sdílené poznámky, informace a kontext pro celý tým.
          </p>
        </div>

        <div className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          {getCommentCountLabel(comments.length)}
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
        <CommentForm entityType={entityType} entityId={entityId} path={path} />
      </div>

      {comments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-500">
          Zatím zde nejsou žádné komentáře. První poznámku pro tým můžeš přidat výše.
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => {
            const isOwnComment = currentUserId === comment.user_id
            const authorName = resolveAuthorName(comment.author)

            return (
              <article
                key={comment.id}
                className={`rounded-2xl border p-4 transition ${
                  isOwnComment
                    ? 'border-blue-200 bg-blue-50/60'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {authorName}
                      </p>

                      {isOwnComment ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                          Ty
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-xs text-gray-500">
                      {getRelativeTimeLabel(comment.created_at)}
                    </p>
                  </div>

                  {isOwnComment ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <details className="group">
                        <summary className="cursor-pointer list-none rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50">
                          Upravit
                        </summary>

                        <div className="mt-3 w-full min-w-[280px] rounded-2xl border border-gray-200 bg-white p-3 shadow-sm sm:w-[420px]">
                          <form
                            action={async (formData) => {
                              'use server'

                              const commentId = String(formData.get('commentId') ?? '')
                              const content = String(formData.get('content') ?? '')
                              const result = await updateComment({
                                commentId,
                                content,
                                path,
                              })

                              if (!result?.error) {
                                revalidatePath(path)
                              }
                            }}
                            className="space-y-3"
                          >
                            <input
                              type="hidden"
                              name="commentId"
                              value={comment.id}
                            />

                            <textarea
                              name="content"
                              rows={4}
                              defaultValue={comment.content}
                              maxLength={1000}
                              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm leading-6 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-400 focus:ring-0"
                            />

                            <div className="flex justify-end">
                              <button
                                type="submit"
                                className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800"
                              >
                                Uložit úpravu
                              </button>
                            </div>
                          </form>
                        </div>
                      </details>

                      <form
                        action={async (formData) => {
                          'use server'

                          const commentId = String(formData.get('commentId') ?? '')
                          const result = await deleteComment({
                            commentId,
                            path,
                          })

                          if (!result?.error) {
                            revalidatePath(path)
                          }
                        }}
                      >
                        <input
                          type="hidden"
                          name="commentId"
                          value={comment.id}
                        />

                        <button
                          type="submit"
                          className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50"
                        >
                          Smazat
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>

                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-gray-700">
                  {comment.content}
                </p>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}