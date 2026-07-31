import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const VEHICLE_LOGBOOK_FILES_BUCKET = 'vehicle-logbook-files'

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> }
) {
  const { attachmentId } = await context.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null }>()

  if (profile?.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const { data: attachment, error } = await supabase
    .from('vehicle_logbook_fuel_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .is('deleted_at', null)
    .maybeSingle<{ storage_path: string }>()

  if (error || !attachment) {
    return new NextResponse('Doklad nebyl nalezen.', { status: 404 })
  }

  const { data: signedUrl, error: signedUrlError } = await supabase.storage
    .from(VEHICLE_LOGBOOK_FILES_BUCKET)
    .createSignedUrl(attachment.storage_path, 60 * 5)

  if (signedUrlError || !signedUrl?.signedUrl) {
    return new NextResponse('Doklad se nepodařilo načíst.', { status: 500 })
  }

  return NextResponse.redirect(signedUrl.signedUrl)
}
