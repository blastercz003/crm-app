import 'server-only'

import { createNotification } from '@/lib/notifications/createNotification'
import { sendPushNotificationToUser, type PushNotificationDeliveryResult } from '@/lib/notifications/sendPushNotification'
import { getServiceRoleClient } from '@/lib/supabase/service'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type EventKind = 'new_outage' | 'schedule_changed' | 'cancelled'

type PreferenceRow = {
  user_id: string
  updated_at: string
}

type ProfileRow = {
  id: string
  role: string | null
  can_view_power_outages: boolean | null
}

type RecipientScopeRow = {
  user_id: string
  scope_kind: 'all' | 'albert'
}

type OutageRow = {
  id: string
  source: 'cez' | 'egd' | 'pre'
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
  dryRun: false
  candidateCount: number
  plannedCount: number
  createdCount: number
  deduplicatedDeliveryCount: number
  failedCount: number
  retriedPushCount: number
  deduplicatedCount: number
  skippedCount: number
  samples: Array<{
    eventKind: EventKind
    title: string
    message: string
  }>
}

type DeliveryRow = {
  id: string
  user_id: string
  match_id: string | null
  event_kind: EventKind
  dedupe_key: string
  delivery_status: 'planned' | 'created' | 'deduplicated' | 'failed' | 'skipped'
  notification_id: string | null
  push_delivery: Record<string, unknown>
  attempt_count: number
  next_attempt_at: string | null
}

const LIVE_EVENT_KINDS = new Set<EventKind>(['new_outage'])
const MAX_DELIVERY_ATTEMPTS = 5

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
  const versionSuffix = input.eventKind === 'new_outage'
    ? 'confirmed'
    : input.version?.id ?? outage.starts_at
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

function deliveryPayload(delivery: DeliveryRow) {
  const title = typeof delivery.push_delivery.title === 'string'
    ? delivery.push_delivery.title.trim()
    : ''
  const message = typeof delivery.push_delivery.message === 'string'
    ? delivery.push_delivery.message
    : ''
  const href = typeof delivery.push_delivery.href === 'string'
    ? delivery.push_delivery.href
    : '/power-outages?mode=markets'
  if (!title) throw new Error('Připravené upozornění nemá nadpis.')
  return { title, message, href }
}

function retryAt(attemptCount: number) {
  const delays = [15, 60, 360, 1_440]
  const delayMinutes = delays[Math.min(Math.max(0, attemptCount - 1), delays.length - 1)]
  return new Date(Date.now() + delayMinutes * 60_000).toISOString()
}

function shouldRetryPush(result: PushNotificationDeliveryResult) {
  if (result.success || result.sentCount > 0) return false
  return result.failedCount > 0 || result.reason === 'missing-push-config'
}

async function saveDeliveryFailure(
  client: ServiceClient,
  delivery: DeliveryRow,
  error: unknown,
) {
  const attemptCount = delivery.attempt_count + 1
  const terminal = attemptCount >= MAX_DELIVERY_ATTEMPTS
  const { error: updateError } = await client
    .from('power_outage_notification_deliveries')
    .update({
      delivery_status: 'failed',
      attempt_count: attemptCount,
      last_attempt_at: new Date().toISOString(),
      next_attempt_at: terminal ? null : retryAt(attemptCount),
      error_message: error instanceof Error ? error.message.slice(0, 2_000) : 'Doručení upozornění selhalo.',
    })
    .eq('id', delivery.id)
  if (updateError) throw updateError
}

async function dispatchPlannedNotifications(client: ServiceClient) {
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('power_outage_notification_deliveries')
    .select('id,user_id,match_id,event_kind,dedupe_key,delivery_status,notification_id,push_delivery,attempt_count,next_attempt_at')
    .in('delivery_status', ['planned', 'failed'])
    .eq('event_kind', 'new_outage')
    .lt('attempt_count', MAX_DELIVERY_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(100)
  if (error) throw error

  let createdCount = 0
  let deduplicatedDeliveryCount = 0
  let failedCount = 0
  let retriedPushCount = 0

  for (const delivery of (data ?? []) as DeliveryRow[]) {
    try {
      const payload = deliveryPayload(delivery)
      const attemptedAt = new Date().toISOString()
      const attemptCount = delivery.attempt_count + 1

      if (delivery.notification_id) {
        const pushDelivery = await sendPushNotificationToUser({
          recipientUserId: delivery.user_id,
          title: payload.title,
          message: payload.message,
          href: payload.href,
        })
        retriedPushCount += 1
        if (shouldRetryPush(pushDelivery)) {
          await saveDeliveryFailure(client, delivery, new Error(pushDelivery.reason ?? 'PWA push se nepodařilo doručit.'))
          failedCount += 1
          continue
        }
        const { error: updateError } = await client
          .from('power_outage_notification_deliveries')
          .update({
            delivery_status: 'created',
            push_delivery: pushDelivery,
            attempt_count: attemptCount,
            last_attempt_at: attemptedAt,
            next_attempt_at: null,
            error_message: pushDelivery.success ? null : pushDelivery.reason ?? null,
          })
          .eq('id', delivery.id)
        if (updateError) throw updateError
        createdCount += 1
        continue
      }

      const notification = await createNotification({
        supabase: client,
        recipientUserId: delivery.user_id,
        category: 'power_outages',
        type: `power_outage_${delivery.event_kind}`,
        title: payload.title,
        message: payload.message,
        entityType: 'power_outage_store_match',
        entityId: delivery.match_id,
        href: payload.href,
        priority: 'high',
        dedupeKey: delivery.dedupe_key,
        skipSelfNotification: false,
        returnExistingOnDuplicate: true,
      })
      if (!notification) throw new Error('Interní upozornění se nepodařilo vytvořit.')
      const pushDelivery = notification.deduplicated ? null : notification.pushDelivery
      const retryPush = pushDelivery ? shouldRetryPush(pushDelivery) : false
      const { error: updateError } = await client
        .from('power_outage_notification_deliveries')
        .update({
          delivery_status: retryPush
            ? 'failed'
            : notification.deduplicated ? 'deduplicated' : 'created',
          notification_id: notification.id,
          push_delivery: pushDelivery ?? { deduplicated: true },
          attempt_count: attemptCount,
          last_attempt_at: attemptedAt,
          next_attempt_at: retryPush && attemptCount < MAX_DELIVERY_ATTEMPTS
            ? retryAt(attemptCount)
            : null,
          error_message: retryPush ? pushDelivery?.reason ?? 'PWA push se nepodařilo doručit.' : null,
        })
        .eq('id', delivery.id)
      if (updateError) throw updateError
      if (retryPush) failedCount += 1
      else if (notification.deduplicated) deduplicatedDeliveryCount += 1
      else createdCount += 1
    } catch (dispatchError) {
      await saveDeliveryFailure(client, delivery, dispatchError)
      failedCount += 1
    }
  }

  return { createdCount, deduplicatedDeliveryCount, failedCount, retriedPushCount }
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
    return {
      dryRun: false,
      candidateCount: 0,
      plannedCount: 0,
      createdCount: 0,
      deduplicatedDeliveryCount: 0,
      failedCount: 0,
      retriedPushCount: 0,
      deduplicatedCount: 0,
      skippedCount: 0,
      samples: [],
    }
  }

  const [{ data: profileData, error: profileError }, { data: scopeData, error: scopeError }] = await Promise.all([
    client
    .from('profiles')
    .select('id,role,can_view_power_outages')
    .in('id', preferences.map((preference) => preference.user_id)),
    client
      .from('power_outage_notification_recipient_scopes')
      .select('user_id,scope_kind')
      .eq('is_active', true),
  ])
  if (profileError) throw profileError
  if (scopeError) throw scopeError
  const profiles = new Map(((profileData ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]))
  const configuredScopes = new Map(((scopeData ?? []) as RecipientScopeRow[])
    .map((scope) => [scope.user_id, scope.scope_kind]))

  const { data: matchData, error: matchError } = await client
    .from('power_outage_store_matches')
    .select(`
      id,outage_id,store_chain_name,store_number,store_city,store_address,
      first_matched_at,resolved_at,
      outage:power_outages!inner(id,source,source_status,starts_at,ends_at)
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
    const profile = profiles.get(preference.user_id)
    const notificationScope = profile?.role === 'admin'
      ? 'all'
      : profile?.can_view_power_outages === true
        ? configuredScopes.get(preference.user_id) ?? null
        : null
    if (!notificationScope) {
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
      if (notificationScope === 'albert' && match.store_chain_name.trim().toUpperCase() !== 'ALBERT') {
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
        if (!eventKind || !LIVE_EVENT_KINDS.has(eventKind)) return
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
          live: true,
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

  const dispatched = await dispatchPlannedNotifications(client)

  return {
    dryRun: false,
    candidateCount: uniqueCandidates.length,
    plannedCount,
    ...dispatched,
    deduplicatedCount: uniqueCandidates.length - plannedCount,
    skippedCount,
    samples: uniqueCandidates.slice(0, 8).map((candidate) => ({
      eventKind: candidate.eventKind,
      title: candidate.title,
      message: candidate.message,
    })),
  }
}
