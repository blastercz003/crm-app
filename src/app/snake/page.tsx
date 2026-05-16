import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SnakeGame } from '@/components/snake/SnakeGame'

export const metadata: Metadata = {
  title: 'Snake',
}

export default async function SnakePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name')
    .eq('id', user.id)
    .single()

  const displayName = profile?.name?.trim() || 'Hráč'

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_12%_6%,#16243f_0%,#0c1528_38%,#090f1d_100%)] px-4 py-4 sm:px-6 lg:h-screen lg:overflow-hidden lg:px-8 lg:py-3">
      <div className="mx-auto w-full max-w-7xl lg:h-full">
        <SnakeGame isAuthenticated defaultDisplayName={displayName} />
      </div>
    </main>
  )
}
