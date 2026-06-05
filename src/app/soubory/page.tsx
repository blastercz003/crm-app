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
    <main className="soubory-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="soubory-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="soubory-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="soubory-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="soubory-page__title text-3xl font-semibold leading-none tracking-tight text-gray-900">
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
                  className="soubory-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />

                <button
                  type="submit"
                  className="soubory-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="clients-page__back-button soubory-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
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
