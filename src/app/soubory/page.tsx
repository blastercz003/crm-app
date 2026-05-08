import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FilesManager } from './files-manager'

export const metadata: Metadata = {
  title: 'Soubory',
}

type ProfileRoleRow = { role: string | null }

type SearchParams = {
  q?: string
}

type AttachmentJoinRow = {
  id: string
  job_id: string
  file_name: string
  display_name: string
  mime_type: string | null
  file_size_bytes: number
  category: 'predavaci_protokol' | 'foto' | 'jine'
  note: string | null
  created_at: string
  job:
    | {
        id: string
        job_number: string
        company_name: string
      }
    | {
        id: string
        job_number: string
        company_name: string
      }[]
    | null
}

export default async function SouboryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const query = String(params?.q ?? '').trim()

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
      job_id,
      file_name,
      display_name,
      mime_type,
      file_size_bytes,
      category,
      note,
      created_at,
      job:jobs!inner (
        id,
        job_number,
        company_name
      )
    `)

  if (error) {
    throw new Error('Nepodařilo se načíst soubory.')
  }

  const rows = ((data ?? []) as AttachmentJoinRow[])
    .map((row) => {
      const job = Array.isArray(row.job) ? row.job[0] : row.job
      if (!job) return null

      return {
        id: String(row.id),
        jobId: String(row.job_id),
        jobNumber: String(job.job_number ?? ''),
        companyName: String(job.company_name ?? ''),
        displayName: String(row.display_name ?? row.file_name ?? ''),
        fileName: String(row.file_name ?? ''),
        mimeType: row.mime_type,
        fileSizeBytes: Number(row.file_size_bytes) || 0,
        category: row.category,
        note: row.note,
        createdAt: String(row.created_at ?? ''),
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const jobs = Array.from(
    new Map(
      rows.map((row) => [
        row.jobId,
        { id: row.jobId, jobNumber: row.jobNumber, companyName: row.companyName },
      ])
    ).values()
  )

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Soubory
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/soubory"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat zakázku, firmu nebo poznámku"
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <FilesManager files={rows} jobs={jobs} initialQuery={query} />
      </div>
    </main>
  )
}
