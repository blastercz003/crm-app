import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import { APP_TITLE } from '@/lib/pageTitles'

export const metadata: Metadata = {
  title: {
    absolute: APP_TITLE,
  },
}

export default async function HomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  redirect('/dashboard')
}
