import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({
        success: false,
        error: 'Uživatel není přihlášen.',
        content: '',
        updatedAt: null,
      })
    }

    const { data, error } = await supabase
      .from('dashboard_quick_notes')
      .select('content, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    if (error) {
      return NextResponse.json({
        success: false,
        error: 'Poznámku se nepodařilo načíst.',
        content: '',
        updatedAt: null,
      })
    }

    return NextResponse.json({
      success: true,
      error: null,
      content: String(data?.content ?? ''),
      updatedAt: data?.updated_at ?? null,
    })
  } catch {
    return NextResponse.json({
      success: false,
      error: 'Poznámku se nepodařilo načíst.',
      content: '',
      updatedAt: null,
    })
  }
}
