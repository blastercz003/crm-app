import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { reportRouteError } from '@/lib/errors/reportRouteError'
import { probeCezSource } from '@/lib/power-outages/cez-source'
import { probeEgdSource } from '@/lib/power-outages/egd-source'
import { isPowerOutageRequestAuthorized } from '@/lib/power-outages/request-access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
} as const

function errorMessage(error: unknown) {
  if (error instanceof ZodError) {
    const issue = error.issues[0]
    return `Zdroj změnil očekávanou strukturu dat${issue ? ` (${issue.path.join('.') || 'kořen'}: ${issue.message})` : ''}.`
  }
  return error instanceof Error ? error.message : 'Diagnostika zdroje selhala.'
}

export async function GET(request: Request) {
  if (!(await isPowerOutageRequestAuthorized(request, { adminOnly: true }))) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized' },
      { status: 401, headers: RESPONSE_HEADERS },
    )
  }

  const url = new URL(request.url)
  const source = url.searchParams.get('source') ?? 'all'
  if (!['all', 'cez', 'egd'].includes(source)) {
    return NextResponse.json(
      { ok: false, error: 'Parametr source musí být all, cez nebo egd.' },
      { status: 400, headers: RESPONSE_HEADERS },
    )
  }

  const cezQuery = url.searchParams.get('cezQuery')?.trim()
    || 'Liberecká 528, Jiříkov'
  const cezAddressIdValue = url.searchParams.get('cezAddressId')
  const cezAddressId = cezAddressIdValue ? Number(cezAddressIdValue) : null
  const egdCity = url.searchParams.get('egdCity')?.trim() || ''
  const daysValue = Number(url.searchParams.get('days') ?? 30)
  const daysAhead = Number.isFinite(daysValue) ? daysValue : 30

  const checkedAt = new Date().toISOString()
  const probes = await Promise.all(
    [
      source === 'all' || source === 'cez'
        ? probeCezSource({ query: cezQuery, addressId: cezAddressId })
            .catch((error: unknown) => ({
              source: 'cez' as const,
              ok: false as const,
              error: errorMessage(error),
            }))
        : null,
      source === 'all' || source === 'egd'
        ? probeEgdSource({ city: egdCity, daysAhead })
            .catch((error: unknown) => ({
              source: 'egd' as const,
              ok: false as const,
              error: errorMessage(error),
            }))
        : null,
    ].filter((probe): probe is NonNullable<typeof probe> => probe !== null),
  )

  const ok = probes.every((probe) => probe.ok)
  if (!ok) {
    await reportRouteError({
      error: new Error(`Diagnostika zdrojů odstávek selhala: ${JSON.stringify(probes)}`),
      route: '/api/power-outages/probe',
      section: 'power-outages',
      errorType: 'PowerOutageSourceProbeError',
    })
  }

  return NextResponse.json(
    { ok, checkedAt, readOnly: true, probes },
    { status: ok ? 200 : 502, headers: RESPONSE_HEADERS },
  )
}
