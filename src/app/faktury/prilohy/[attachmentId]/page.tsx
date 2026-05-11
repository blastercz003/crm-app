import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AttachmentBackButton } from './back-button'

export const metadata: Metadata = {
  title: 'Náhled přílohy',
}

type ProfileRoleRow = {
  role: string | null
}

type AttachmentPreviewRow = {
  id: string
  display_name: string
  mime_type: string | null
  storage_bucket: string
  storage_path: string
  created_at: string
  job:
    | {
        job_number: string
        company_name: string
      }
    | {
        job_number: string
        company_name: string
      }[]
    | null
}

function isPreviewableImage(mimeType: string | null) {
  return (
    mimeType === 'image/jpeg' ||
    mimeType === 'image/png' ||
    mimeType === 'image/webp' ||
    mimeType === 'image/heic' ||
    mimeType === 'image/heif'
  )
}

function isPreviewablePdf(mimeType: string | null) {
  return mimeType === 'application/pdf'
}

export default async function AttachmentPreviewPage({
  params,
}: {
  params: Promise<{ attachmentId: string }>
}) {
  const { attachmentId } = await params
  const normalizedAttachmentId = String(attachmentId ?? '').trim()

  if (!normalizedAttachmentId) {
    notFound()
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    redirect('/dashboard')
  }

  const { data, error } = await supabase
    .from('job_attachments')
    .select(`
      id,
      display_name,
      mime_type,
      storage_bucket,
      storage_path,
      created_at,
      job:jobs!inner (
        job_number,
        company_name
      )
    `)
    .eq('id', normalizedAttachmentId)
    .single()

  if (error || !data) {
    notFound()
  }

  const attachment = data as AttachmentPreviewRow
  const job = Array.isArray(attachment.job) ? attachment.job[0] : attachment.job

  const { data: signedUrlData, error: signedUrlError } = await supabase.storage
    .from(String(attachment.storage_bucket))
    .createSignedUrl(String(attachment.storage_path), 60 * 10)

  if (signedUrlError || !signedUrlData?.signedUrl) {
    throw new Error('Nepodařilo se vytvořit náhled přílohy.')
  }

  const { data: downloadUrlData, error: downloadUrlError } = await supabase.storage
    .from(String(attachment.storage_bucket))
    .createSignedUrl(String(attachment.storage_path), 60 * 10, {
      download: attachment.display_name,
    })

  if (downloadUrlError || !downloadUrlData?.signedUrl) {
    throw new Error('Nepodařilo se vytvořit odkaz pro stažení přílohy.')
  }

  const previewUrl = signedUrlData.signedUrl
  const downloadUrl = downloadUrlData.signedUrl
  const isImage = isPreviewableImage(attachment.mime_type)
  const isPdf = isPreviewablePdf(attachment.mime_type)

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-gray-900">
                {attachment.display_name}
              </h1>
              <p className="mt-1 text-sm text-gray-600">
                {job?.job_number ? `Zakázka ${job.job_number}` : 'Příloha zakázky'}
                {job?.company_name ? ` · ${job.company_name}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <AttachmentBackButton />
              <Link
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
              >
                ORIGINÁL
              </Link>
              <Link
                href={downloadUrl}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                STÁHNOUT
              </Link>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          {isImage ? (
            <div className="p-3 sm:p-6">
              <object
                data={previewUrl}
                type={attachment.mime_type ?? 'image/*'}
                className="mx-auto max-h-[75vh] w-auto max-w-full rounded-2xl border border-white/75 object-contain shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_24px_rgba(15,23,42,0.12)]"
                aria-label={attachment.display_name}
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={previewUrl}
              title={attachment.display_name}
              className="h-[75vh] w-full rounded-3xl border-0"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <p className="text-sm text-gray-600">
                Tento typ souboru neumíme zobrazit přímo v náhledu.
              </p>
              <Link
                href={previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
              >
                Otevřít soubor
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
