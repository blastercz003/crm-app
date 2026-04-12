import { createClient } from '@/lib/supabase/server'
import CommentForm from './comment-form'

type CommentSectionProps = {
  entityType: string
  entityId: string
  path: string
}

type CommentRow = {
  id: string
  content: string
  created_at: string
  author:
    | {
        name: string | null
      }
    | {
        name: string | null
      }[]
    | null
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function resolveAuthorName(
  author:
    | {
        name: string | null
      }
    | {
        name: string | null
      }[]
    | null
) {
  if (!author) return 'Uživatel'
  if (Array.isArray(author)) return author[0]?.name ?? 'Uživatel'
  return author.name ?? 'Uživatel'
}

export default async function CommentSection({
  entityType,
  entityId,
  path,
}: CommentSectionProps) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('comments')
    .select(`
      id,
      content,
      created_at,
      author:profiles!comments_user_id_fkey (
        name
      )
    `)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error('Nepodařilo se načíst komentáře.')
  }

  const comments = (data ?? []) as CommentRow[]

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Komentáře</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sdílené poznámky a informace pro tým.
          </p>
        </div>

        <div className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
          {comments.length} {comments.length === 1 ? 'komentář' : comments.length >= 2 && comments.length <= 4 ? 'komentáře' : 'komentářů'}
        </div>
      </div>

      <div className="mb-6">
        <CommentForm entityType={entityType} entityId={entityId} path={path} />
      </div>

      {comments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
          Zatím zde nejsou žádné komentáře.
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment) => (
            <article
              key={comment.id}
              className="rounded-2xl border border-gray-200 bg-gray-50 p-4"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm font-medium text-gray-900">
                  {resolveAuthorName(comment.author)}
                </p>

                <p className="text-xs text-gray-500">
                  {formatDateTime(comment.created_at)}
                </p>
              </div>

              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                {comment.content}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}