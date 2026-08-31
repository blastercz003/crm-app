import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type EventKind = 'new_outage' | 'schedule_changed' | 'cancelled'

type PreferenceRow = {
  user_id: string
  updated_at: string
}

type OutageRow = {
  id: string
  source_status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  starts_at: string
  ends_at: string
}

type MatchRow = {
  id: string
  outage_id: string
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  first_matched_at: string
  resolved_at: string | null
  outage: OutageRow | OutageRow[]
}

type VersionRow = {
  id: string
  outage_id: string
  version_number: number
  change_reasons: string[] | null
  snapshot: Record<string, unknown>
  created_at: string
}

type PlannedCandidate = {
  userId: string
  outageId: string
  outageVersionId: string | null
  matchId: string
  eventKind: EventKind
  dedupeKey: string
  title: string
  message: string
  href: string
}

export type PowerOutageNotificationPlanResult = {
  dryRun: true
  candidateCount: number
  plannedCount: number
  deduplicatedCount: number
  skippedCount: number
  samples: Array<{
    eventKind: EventKind
    title: string
    message: string
  }>
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
function relationOne<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NaN
  return new Date(value).getTime()
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function localDateKey(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function formatPeriod(startsAt: string, endsAt: string) {
  if (localDateKey(startsAt) === localDateKey(endsAt)) {
    const date = new Intl.DateTimeFormat('cs-CZ', {
      timeZone: PRAGUE_TIME_ZONE,
      day: 'numeric',
      month: 'numeric',
    }).format(new Date(startsAt))
    const timeFormatter = new Intl.DateTimeFormat('cs-CZ', {
      timeZone: PRAGUE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
    })
    return `${date} ${timeFormatter.format(new Date(startsAt))}–${timeFormatter.format(new Date(endsAt))}`
  }
  return `${formatDateTime(startsAt)}–${formatDateTime(endsAt)}`
}

function storeLabel(match: MatchRow) {
  return [
    match.store_chain_name.trim(),
    match.store_number.trim() ? `prodejna ${match.store_number.trim()}` : '',
    [match.store_address.trim(), match.store_city.trim()].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ')
}

function snapshotString(snapshot: Record<string, unknown>, key: string) {
  const value = snapshot[key]
  return typeof value === 'string' && value ? value : null
}

function latestVersion(versions: VersionRow[]) {
  return versions.at(-1) ?? null
}

function buildCandidate(input: {
  preference: PreferenceRow
  match: MatchRow
  version: VersionRow | null
  eventKind: EventKind
  previousVersion?: VersionRow | null
}) {
  const outage = relationOne(input.match.outage)
  if (!outage) return null
  const label = storeLabel(input.match)
  const versionSuffix = input.version?.id ?? outage.starts_at
  const dedupeKey = [
    'power-outage',
    input.preference.user_id,
    input.eventKind,
    input.match.id,
    versionSuffix,
  ].join(':')

  if (input.eventKind === 'new_outage') {
    return {
      userId: input.preference.user_id,
      outageId: outage.id,
      outageVersionId: input.version?.id ?? null,
      matchId: input.match.id,
      eventKind: input.eventKind,
      dedupeKey,
      title: 'Nová potvrzená odstávka',
      message: `${label} · ${formatPeriod(outage.starts_at, outage.ends_at)}.`,
      href: `/power-outages?match=${input.match.id}`,
    } satisfies PlannedCandidate
  }

  if (input.eventKind === 'schedule_changed') {
    const previousStart = input.previousVersion
      ? snapshotString(input.previousVersion.snapshot, 'starts_at')
      : null
    const previousEnd = input.previousVersion
      ? snapshotString(input.previousVersion.snapshot, 'ends_at')
      : null
    const previous = previousStart && previousEnd
      ? ` Původně ${formatPeriod(previousStart, previousEnd)}.`
      : ''
    return {
      userId: input.preference.user_id,
      outageId: outage.id,
      outageVersionId: input.version?.id ?? null,
      matchId: input.match.id,
      eventKind: input.eventKind,
      dedupeKey,
      title: 'Změna termínu odstávky',
      message: `${label} · nový termín ${formatPeriod(outage.starts_at, outage.ends_at)}.${previous}`,
      href: `/power-outages?match=${input.match.id}`,
    } satisfies PlannedCandidate
  }

  if (input.eventKind === 'cancelled') {
    const previousStart = input.previousVersion
      ? snapshotString(input.previousVersion.snapshot, 'starts_at')
      : outage.starts_at
    const previousEnd = input.previousVersion
      ? snapshotString(input.previousVersion.snapshot, 'ends_at')
      : outage.ends_at
    return {
      userId: input.preference.user_id,
      outageId: outage.id,
      outageVersionId: input.version?.id ?? null,
      matchId: input.match.id,
      eventKind: input.eventKind,
      dedupeKey,
      title: 'Potvrzená odstávka byla zrušena',
      message: `${label} · původní termín ${formatPeriod(previousStart ?? outage.starts_at, previousEnd ?? outage.ends_at)}.`,
      href: `/power-outages?match=${input.match.id}`,
    } satisfies PlannedCandidate
  }

  return null
}

async function loadVersions(client: ServiceClient, outageIds: string[]) {
  const rows: VersionRow[] = []
  for (const ids of chunks(outageIds, 80)) {
    const { data, error } = await client
      .from('power_outage_versions')
      .select('id,outage_id,version_number,change_reasons,snapshot,created_at')
      .in('outage_id', ids)
      .order('version_number', { ascending: true })
    if (error) throw error
    rows.push(...((data ?? []) as VersionRow[]))
  }
  return rows
}

async function existingDedupeKeys(client: ServiceClient, keys: string[]) {
  const existing = new Set<string>()
  for (const values of chunks(keys, 75)) {
    const { data, error } = await client
      .from('power_outage_notification_deliveries')
      .select('dedupe_key')
      .in('dedupe_key', values)
    if (error) throw error
    for (const row of data ?? []) existing.add(String(row.dedupe_key))
  }
  return existing
}

export async function planPowerOutageNotifications(): Promise<PowerOutageNotificationPlanResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro plánování upozornění na odstávky.')

  const { data: preferenceData, error: preferenceError } = await client
    .from('power_outage_notification_preferences')
    .select('user_id,updated_at')
    .eq('notifications_enabled', true)
  if (preferenceError) throw preferenceError
  const preferences = (preferenceData ?? []) as PreferenceRow[]
  if (preferences.length === 0) {
    return { dryRun: true, candidateCount: 0, plannedCount: 0, deduplicatedCount: 0, skippedCount: 0, samples: [] }
  }

  const { data: profileData, error: profileError } = await client
    .from('profiles')
    .select('id,role,can_view_power_outages')
    .in('id', preferences.map((preference) => preference.user_id))
  if (profileError) throw profileError
  const allowedUsers = new Set((profileData ?? [])
    .filter((profile) => profile.role === 'admin' || profile.can_view_power_outages === true)
    .map((profile) => String(profile.id)))

  const { data: matchData, error: matchError } = await client
    .from('power_outage_store_matches')
    .select(`
      id,outage_id,store_chain_name,store_number,store_city,store_address,
      first_matched_at,resolved_at,
      outage:power_outages!inner(id,source_status,starts_at,ends_at)
    `)
    .eq('match_status', 'confirmed')
  if (matchError) throw matchError
  const matches = (matchData ?? []) as unknown as MatchRow[]
  const outageIds = [...new Set(matches.map((match) => match.outage_id))]
  const versions = await loadVersions(client, outageIds)
  const versionsByOutage = new Map<string, VersionRow[]>()
  for (const version of versions) {
    const rows = versionsByOutage.get(version.outage_id) ?? []
    rows.push(version)
    versionsByOutage.set(version.outage_id, rows)
  }

  const candidates: PlannedCandidate[] = []
  let skippedCount = 0
  for (const preference of preferences) {
    if (!allowedUsers.has(preference.user_id)) {
      skippedCount += matches.length
      continue
    }
    const preferenceTime = timestamp(preference.updated_at)
    for (const match of matches) {
      const outage = relationOne(match.outage)
      if (!outage) {
        skippedCount += 1
        continue
      }
      const outageVersions = versionsByOutage.get(match.outage_id) ?? []
      const currentVersion = latestVersion(outageVersions)
      const confirmedAt = timestamp(match.resolved_at ?? match.first_matched_at)

      if (
        confirmedAt >= preferenceTime
        && outage.source_status !== 'cancelled'
        && outage.source_status !== 'completed'
      ) {
        const candidate = buildCandidate({
          preference,
          match,
          version: currentVersion,
          eventKind: 'new_outage',
        })
        if (candidate) candidates.push(candidate)
      }

      outageVersions.forEach((version, index) => {
        const versionTime = timestamp(version.created_at)
        if (versionTime < preferenceTime || versionTime <= confirmedAt) return
        const reasons = new Set(version.change_reasons ?? [])
        const eventKind: EventKind | null = reasons.has('cancelled')
          ? 'cancelled'
          : reasons.has('schedule_changed')
            ? 'schedule_changed'
            : null
        if (!eventKind) return
        const candidate = buildCandidate({
          preference,
          match,
          version,
          previousVersion: outageVersions[index - 1] ?? null,
          eventKind,
        })
        if (candidate) candidates.push(candidate)
      })
    }
  }

  const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.dedupeKey, candidate])).values()]
  const existing = await existingDedupeKeys(client, uniqueCandidates.map((candidate) => candidate.dedupeKey))
  const missing = uniqueCandidates.filter((candidate) => !existing.has(candidate.dedupeKey))

  let plannedCount = 0
  for (const batch of chunks(missing, 200)) {
    const { data, error } = await client
      .from('power_outage_notification_deliveries')
      .upsert(batch.map((candidate) => ({
        user_id: candidate.userId,
        outage_id: candidate.outageId,
        outage_version_id: candidate.outageVersionId,
        match_id: candidate.matchId,
        event_kind: candidate.eventKind,
        dedupe_key: candidate.dedupeKey,
        delivery_status: 'planned',
        notification_id: null,
        push_delivery: {
          dryRun: true,
          title: candidate.title,
          message: candidate.message,
          href: candidate.href,
        },
        error_message: null,
      })), { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    plannedCount += data?.length ?? 0
  }

  return {
    dryRun: true,
    candidateCount: uniqueCandidates.length,
    plannedCount,
    deduplicatedCount: uniqueCandidates.length - plannedCount,
    skippedCount,
    samples: uniqueCandidates.slice(0, 8).map((candidate) => ({
      eventKind: candidate.eventKind,
      title: candidate.title,
      message: candidate.message,
    })),
  }
}
