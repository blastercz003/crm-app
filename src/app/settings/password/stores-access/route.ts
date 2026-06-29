import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type StoresAccessProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_stores: boolean | null
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      supabase,
      user: null,
      error: NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 }),
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string | null }>()

  if (profileError || profile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: NextResponse.json(
        { error: 'Tato akce je dostupná jen pro admina.' },
        { status: 403 }
      ),
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

export async function GET() {
  const access = await requireAdmin()

  if (access.error) {
    return access.error
  }

  const { data, error } = await access.supabase
    .from('profiles')
    .select('id, name, role, can_view_stores')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst přístupy pro Prodejny.' },
      { status: 500 }
    )
  }

  const profiles = ((data ?? []) as StoresAccessProfile[]).map((profile) => ({
    id: profile.id,
    name: profile.name?.trim() || 'Bez jména',
    role: profile.role,
    can_view_stores: Boolean(profile.can_view_stores),
  }))

  return NextResponse.json({ profiles })
}

export async function PATCH(request: Request) {
  const access = await requireAdmin()

  if (access.error) {
    return access.error
  }

  const body = (await request.json().catch(() => null)) as
    | {
        userId?: string
        canViewStores?: boolean
      }
    | null

  const userId = String(body?.userId ?? '').trim()
  const canViewStores = body?.canViewStores

  if (!userId || typeof canViewStores !== 'boolean') {
    return NextResponse.json(
      { error: 'Neplatná data pro uložení oprávnění.' },
      { status: 400 }
    )
  }

  const { error } = await access.supabase
    .from('profiles')
    .update({ can_view_stores: canViewStores })
    .eq('id', userId)

  if (error) {
    return NextResponse.json(
      { error: 'Nepodařilo se uložit oprávnění Prodejny.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true })
}
