import { NextRequest, NextResponse } from 'next/server'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { OPERATIONAL_PROTOCOLS_BUCKET } from '@/lib/operational-protocols/types'
import { createClient } from '@/lib/supabase/server'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function contentDisposition(fileName: string, download: boolean) {
  const fallback = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/["\\]/g, '-')
  return `${download ? 'attachment' : 'inline'}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ protocolId: string }> }
) {
  const { protocolId } = await context.params
  if (!UUID_PATTERN.test(protocolId)) {
    return NextResponse.json({ error: 'Neplatné ID protokolu.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Nejsi přihlášený.' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if ((profile as { role?: string | null } | null)?.role !== 'admin') {
    return NextResponse.json({ error: 'Nemáš oprávnění.' }, { status: 403 })
  }

  try {
    const { data: protocol, error: protocolError } = await supabase
      .from('operational_protocols')
      .select('pdf_storage_path, pdf_file_name')
      .eq('id', protocolId)
      .eq('generation_status', 'final')
      .single()

    if (protocolError || !protocol) {
      return NextResponse.json({ error: 'PDF protokolu nebylo nalezeno.' }, { status: 404 })
    }

    const row = protocol as { pdf_storage_path: string; pdf_file_name: string }
    const { data: file, error: fileError } = await supabase.storage
      .from(OPERATIONAL_PROTOCOLS_BUCKET)
      .download(row.pdf_storage_path)

    if (fileError || !file) {
      return NextResponse.json({ error: 'PDF protokolu se nepodařilo načíst.' }, { status: 404 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const download = request.nextUrl.searchParams.get('download') === '1'

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': contentDisposition(row.pdf_file_name, download),
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    await reportRouteError({
      error,
      route: '/faktury/provozni-protokoly/[protocolId]/pdf',
      section: 'faktury-operational-protocols',
      errorType: 'OperationalProtocolPdfRouteError',
      userId: user.id,
      context: { protocolId },
    })
    return NextResponse.json({ error: 'PDF protokolu se nepodařilo načíst.' }, { status: 500 })
  }
}
