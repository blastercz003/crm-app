import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type BSafe24AccessProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_bsafe24: boolean | null
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
    .select('id, name, role, can_view_bsafe24')
    .order('name', { ascending: true })

  if (error) {
    return NextResponse.json(
      { error: 'Nepodařilo se načíst přístupy pro B-SAFE 24.' },
      { status: 500 }
    )
  }

  const profiles = ((data ?? []) as BSafe24AccessProfile[]).map((profile) => ({
    id: profile.id,
    name: profile.name?.trim() || 'Bez jména',
    role: profile.role,
    can_view_bsafe24: Boolean(profile.can_view_bsafe24),
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
        canViewBSafe24?: boolean
      }
    | null

  const userId = String(body?.userId ?? '').trim()
  const canViewBSafe24 = body?.canViewBSafe24

  if (!userId || typeof canViewBSafe24 !== 'boolean') {
    return NextResponse.json(
      { error: 'Neplatná data pro uložení oprávnění.' },
      { status: 400 }
    )
  }

  const { data, error } = await access.supabase
    .from('profiles')
    .update({ can_view_bsafe24: canViewBSafe24 })
    .eq('id', userId)
    .select('id, can_view_bsafe24')
    .single<Pick<BSafe24AccessProfile, 'id' | 'can_view_bsafe24'>>()

  if (error) {
    return NextResponse.json(
      { error: 'Nepodařilo se uložit oprávnění B-SAFE 24.' },
      { status: 500 }
    )
  }

  if (!data || data.id !== userId) {
    return NextResponse.json(
      { error: 'Uložení oprávnění B-SAFE 24 se nepotvrdilo v databázi.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    success: true,
    profile: {
      id: data.id,
      can_view_bsafe24: Boolean(data.can_view_bsafe24),
    },
  })
}
