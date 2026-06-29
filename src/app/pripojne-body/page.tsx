import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewConnectionPointsSection } from '@/lib/auth/access'
import { FoldersOverviewClient } from './folders-overview-client'

export const metadata: Metadata = {
  title: 'Přípojné body',
}

type SearchParams = {
  q?: string
}

type ProfilePermissionRow = {
  role: string | null
  can_view_connection_points: boolean | null
}

type ConnectionPointFolderRow = {
  id: string
  name: string
  created_at: string
  updated_at: string
}

type FolderPhotoCountRow = {
  folder_id: string
}

type FolderCommentRow = {
  folder_id: string
}

function normalizeQuery(value: string) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function getSearchTokens(query: string) {
  return normalizeQuery(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

export default async function PripojneBodyPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = searchParams ? await searchParams : undefined
  const query = String(params?.q ?? '').trim()
  const searchTokens = getSearchTokens(query)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_connection_points')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  if (!canViewConnectionPointsSection(typedProfile?.role ?? null, typedProfile)) {
    redirect('/dashboard')
  }

  let foldersQuery = supabase
    .from('connection_point_folders')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false })

  for (const token of searchTokens) {
    const escapedToken = token.replaceAll('%', '\\%').replaceAll('_', '\\_')
    foldersQuery = foldersQuery.ilike('search_text', `%${escapedToken}%`)
  }

  const { data: foldersData, error: foldersError } = await foldersQuery

  if (foldersError) {
    throw new Error('Nepodařilo se načíst složky.')
  }

  const folders = ((foldersData ?? []) as ConnectionPointFolderRow[]).map((folder) => ({
    id: String(folder.id),
    name: String(folder.name ?? ''),
    createdAt: String(folder.created_at ?? ''),
    updatedAt: String(folder.updated_at ?? ''),
  }))

  const folderIds = folders.map((folder) => folder.id)

  let photoRowsData: FolderPhotoCountRow[] | null = []
  let commentRowsData: FolderCommentRow[] | null = []
  let photoRowsError: { message: string } | null = null
  let commentRowsError: { message: string } | null = null

  if (folderIds.length > 0) {
    const photoResponse = await supabase
      .from('connection_point_folder_photos')
      .select('folder_id')
      .in('folder_id', folderIds)

    photoRowsData = (photoResponse.data ?? []) as FolderPhotoCountRow[]
    photoRowsError = photoResponse.error

    const commentResponse = await supabase
      .from('connection_point_folder_comments')
      .select('folder_id')
      .in('folder_id', folderIds)

    commentRowsData = (commentResponse.data ?? []) as FolderCommentRow[]
    commentRowsError = commentResponse.error
  }

  if (photoRowsError) {
    throw new Error('Nepodařilo se načíst fotky ke složkám.')
  }

  if (commentRowsError) {
    throw new Error('Nepodařilo se načíst komentáře ke složkám.')
  }

  const photoCounts = new Map<string, number>()
  for (const row of (photoRowsData ?? []) as FolderPhotoCountRow[]) {
    const folderId = String(row.folder_id ?? '')
    if (!folderId) continue
    photoCounts.set(folderId, (photoCounts.get(folderId) ?? 0) + 1)
  }

  const commentCounts = new Map<string, number>()

  for (const row of (commentRowsData ?? []) as FolderCommentRow[]) {
    const folderId = String(row.folder_id ?? '')
    if (!folderId) continue

    commentCounts.set(folderId, (commentCounts.get(folderId) ?? 0) + 1)
  }

  const overviewFolders = folders.map((folder) => ({
    ...folder,
    photoCount: photoCounts.get(folder.id) ?? 0,
    commentCount: commentCounts.get(folder.id) ?? 0,
  }))

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
                Přípojné body
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form action="/pripojne-body" method="get" className="flex w-full gap-3 sm:w-auto">
                <input
                  type="text"
                  name="q"
                  defaultValue={query}
                  placeholder="Hledat název složky nebo komentář"
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

        <FoldersOverviewClient folders={overviewFolders} />
      </div>
    </main>
  )
}
