import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPowerOutageHealth } from './health'
import { getPowerOutageRuntimeContext } from './access'
import type {
  PowerOutageFilterOptions,
  PowerOutageDetail,
  PowerOutageListItem,
  PowerOutageMatchStatus,
  PowerOutageNotificationPreferences,
  PowerOutageSource,
  PowerOutageStoreCoverage,
  PowerOutageWorkspace,
} from './types'

type OutageRelationRow = {
  id: string
  source: PowerOutageSource
  source_status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  title: string | null
  description: string | null
  starts_at: string
  ends_at: string
  archived_at: string | null
  municipality: string | null
  district: string | null
  region: string | null
  source_url: string | null
  announcement_url: string | null
  source_updated_at: string | null
  first_seen_at: string
  last_seen_at: string
}

type MatchRelationRow = {
  id: string
  outage_id: string
  store_id: string | null
  match_status: PowerOutageMatchStatus
  confidence: number | string
  match_reasons: unknown
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  outage: OutageRelationRow | OutageRelationRow[]
}

type InformedRow = {
  match_id: string
  informed: boolean
  created_at: string
}

type JobLinkRow = {
  match_id: string
  job_id: string
  job_number: string
}

type ViewedMatchRow = {
  match_id: string
}

type RegistryRow = {
  distributor: 'cez' | 'egd' | 'unknown'
  verification_status: 'pending' | 'verified' | 'probable' | 'needs_review' | 'not_found' | 'error'
  needs_refresh: boolean
  is_active: boolean
}

type PreferenceRow = {
  notifications_enabled: boolean
  reminder_24h_enabled: boolean
  updated_at: string
}

const MATCH_COLUMNS = `
  id,
  outage_id,
  store_id,
  match_status,
  confidence,
  match_reasons,
  store_chain_name,
  store_number,
  store_city,
  store_address,
  outage:power_outages!inner(
    id,
    source,
    source_status,
    title,
    description,
    starts_at,
    ends_at,
    archived_at,
    municipality,
    district,
    region,
    source_url,
    announcement_url,
    source_updated_at,
    first_seen_at,
    last_seen_at
  )
`

function relationOne<T>(value: T | T[]) {
  return Array.isArray(value) ? value[0] : value
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function compareCurrent(left: PowerOutageListItem, right: PowerOutageListItem) {
  return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
}

function compareArchive(left: PowerOutageListItem, right: PowerOutageListItem) {
  return new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime()
}

function filterOptions(items: PowerOutageListItem[]): PowerOutageFilterOptions {
  return {
    sources: [...new Set(items.map((item) => item.source))].sort(),
    chains: [...new Set(items.map((item) => item.store.chainName).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'cs')),
    cities: [...new Set(items.map((item) => item.store.city).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right, 'cs')),
    matchStatuses: [...new Set(items.map((item) => item.matchStatus))].sort(),
  }
}

function storeCoverage(
  rows: RegistryRow[],
  catalog: { revision: number; last_changed_at: string },
): PowerOutageStoreCoverage {
  const active = rows.filter((row) => row.is_active)
  const ready = active.filter((row) => (
    !row.needs_refresh
    && (row.verification_status === 'verified' || row.verification_status === 'probable')
  )).length
  const pending = active.filter((row) => (
    row.needs_refresh || row.verification_status === 'pending'
  )).length
  const review = active.filter((row) => row.verification_status === 'needs_review').length
  const notFound = active.filter((row) => row.verification_status === 'not_found').length
  const error = active.filter((row) => row.verification_status === 'error').length

  return {
    totalStoreCount: active.length,
    readyStoreCount: ready,
    pendingStoreCount: pending,
    reviewStoreCount: review,
    notFoundStoreCount: notFound,
    errorStoreCount: error,
    coveragePercent: active.length > 0 ? Math.round((ready / active.length) * 1_000) / 10 : 0,
    cezStoreCount: active.filter((row) => row.distributor === 'cez').length,
    egdStoreCount: active.filter((row) => row.distributor === 'egd').length,
    unknownDistributorCount: active.filter((row) => row.distributor === 'unknown').length,
    catalogRevision: catalog.revision,
    catalogLastChangedAt: catalog.last_changed_at,
  }
}

async function loadStoreRegistry(client: SupabaseClient) {
  const rows: RegistryRow[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('power_outage_store_registry')
      .select('distributor,verification_status,needs_refresh,is_active')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) {
      throw new Error(`Pokrytí databáze Prodejen se nepodařilo načíst: ${error.message}`)
    }
    rows.push(...((data ?? []) as RegistryRow[]))
    if ((data?.length ?? 0) < pageSize) break
  }
  return rows
}

async function loadLatestInformedRows(client: SupabaseClient, matchIds: string[]) {
  const rows: InformedRow[] = []
  const batchSize = 75

  for (let from = 0; from < matchIds.length; from += batchSize) {
    const batch = matchIds.slice(from, from + batchSize)
    const { data, error } = await client
      .from('power_outage_informed_audit')
      .select('match_id,informed,created_at')
      .in('match_id', batch)
      .order('created_at', { ascending: false })
    if (error) {
      throw new Error(`Stav informování zákazníků se nepodařilo načíst: ${error.message}`)
    }
    rows.push(...((data ?? []) as InformedRow[]))
  }

  return rows
}

async function loadJobLinks(client: SupabaseClient, matchIds: string[]) {
  const rows: JobLinkRow[] = []
  const batchSize = 75

  for (let from = 0; from < matchIds.length; from += batchSize) {
    const batch = matchIds.slice(from, from + batchSize)
    const { data, error } = await client
      .from('power_outage_job_links')
      .select('match_id,job_id,job_number')
      .in('match_id', batch)
      .order('job_number', { ascending: false })

    // Umožní bezpečně nasadit aplikaci ještě před spuštěním databázové migrace.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return []
    if (error) {
      throw new Error(`Vazby odstávek na zakázky se nepodařilo načíst: ${error.message}`)
    }
    rows.push(...((data ?? []) as JobLinkRow[]))
  }

  return rows
}

async function loadViewedMatchIds(
  client: SupabaseClient,
  userId: string,
  matchIds: string[],
) {
  const viewedMatchIds = new Set<string>()
  const batchSize = 75

  for (let from = 0; from < matchIds.length; from += batchSize) {
    const batch = matchIds.slice(from, from + batchSize)
    const { data, error } = await client
      .from('power_outage_match_views')
      .select('match_id')
      .eq('user_id', userId)
      .in('match_id', batch)

    // Umožní bezpečně nasadit aplikaci ještě před spuštěním databázové migrace.
    if (error?.code === '42P01' || error?.code === 'PGRST205') return new Set<string>()
    if (error) {
      throw new Error(`Stav zobrazení odstávek se nepodařilo načíst: ${error.message}`)
    }

    for (const row of (data ?? []) as ViewedMatchRow[]) {
      viewedMatchIds.add(row.match_id)
    }
  }

  return viewedMatchIds
}

export async function getPowerOutageWorkspace(): Promise<PowerOutageWorkspace> {
  const { supabase, user } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })

  const [
    currentResult,
    archiveResult,
    currentDismissedResult,
    archiveDismissedResult,
    analyzedResult,
    currentCountResult,
    archiveCountResult,
    reviewCountResult,
    registryRows,
    catalogResult,
    preferenceResult,
    health,
  ] = await Promise.all([
    supabase
      .from('power_outage_store_matches')
      .select(MATCH_COLUMNS)
      .neq('match_status', 'dismissed')
      .is('power_outages.archived_at', null)
      .order('starts_at', { referencedTable: 'power_outages', ascending: true })
      .limit(500),
    supabase
      .from('power_outage_store_matches')
      .select(MATCH_COLUMNS)
      .neq('match_status', 'dismissed')
      .not('power_outages.archived_at', 'is', null)
      .order('ends_at', { referencedTable: 'power_outages', ascending: false })
      .limit(200),
    supabase
      .from('power_outage_store_matches')
      .select(MATCH_COLUMNS)
      .eq('match_status', 'dismissed')
      .is('power_outages.archived_at', null)
      .order('starts_at', { referencedTable: 'power_outages', ascending: true })
      .limit(200),
    supabase
      .from('power_outage_store_matches')
      .select(MATCH_COLUMNS)
      .eq('match_status', 'dismissed')
      .not('power_outages.archived_at', 'is', null)
      .order('ends_at', { referencedTable: 'power_outages', ascending: false })
      .limit(200),
    supabase.from('power_outages').select('id', { count: 'exact', head: true }),
    supabase
      .from('power_outage_store_matches')
      .select('id,power_outages!inner(id)', { count: 'exact', head: true })
      .neq('match_status', 'dismissed')
      .is('power_outages.archived_at', null),
    supabase
      .from('power_outage_store_matches')
      .select('id,power_outages!inner(id)', { count: 'exact', head: true })
      .neq('match_status', 'dismissed')
      .not('power_outages.archived_at', 'is', null),
    supabase
      .from('power_outage_store_matches')
      .select('id,power_outages!inner(id)', { count: 'exact', head: true })
      .eq('match_status', 'needs_review')
      .is('power_outages.archived_at', null),
    loadStoreRegistry(supabase),
    supabase
      .from('power_outage_store_catalog_state')
      .select('revision,last_changed_at')
      .eq('singleton', true)
      .single<{ revision: number; last_changed_at: string }>(),
    supabase
      .from('power_outage_notification_preferences')
      .select('notifications_enabled,reminder_24h_enabled,updated_at')
      .eq('user_id', user.id)
      .maybeSingle<PreferenceRow>(),
    getPowerOutageHealth(),
  ])

  const firstError = [
    currentResult.error,
    archiveResult.error,
    currentDismissedResult.error,
    archiveDismissedResult.error,
    analyzedResult.error,
    currentCountResult.error,
    archiveCountResult.error,
    reviewCountResult.error,
    catalogResult.error,
    preferenceResult.error,
  ].find(Boolean)
  if (firstError) {
    throw new Error(`Data plánovaných odstávek se nepodařilo načíst: ${firstError.message}`)
  }
  if (!catalogResult.data) {
    throw new Error('Stav katalogu Prodejen není dostupný.')
  }

  const currentRows = [
    ...(currentResult.data ?? []),
    ...(currentDismissedResult.data ?? []),
  ] as unknown as MatchRelationRow[]
  const archiveRows = [
    ...(archiveResult.data ?? []),
    ...(archiveDismissedResult.data ?? []),
  ] as unknown as MatchRelationRow[]
  const matchIds = [...new Set([...currentRows, ...archiveRows].map((row) => row.id))]
  const informedByMatch = new Map<string, InformedRow>()
  const jobLinksByMatch = new Map<string, JobLinkRow[]>()
  let viewedMatchIds = new Set<string>()

  if (matchIds.length > 0) {
    const [informedData, jobLinkData, viewedIds] = await Promise.all([
      loadLatestInformedRows(supabase, matchIds),
      loadJobLinks(supabase, matchIds),
      loadViewedMatchIds(supabase, user.id, matchIds),
    ])
    viewedMatchIds = viewedIds
    for (const row of informedData) {
      if (!informedByMatch.has(row.match_id)) informedByMatch.set(row.match_id, row)
    }
    for (const row of jobLinkData) {
      const existing = jobLinksByMatch.get(row.match_id) ?? []
      existing.push(row)
      jobLinksByMatch.set(row.match_id, existing)
    }
  }

  const mapMatch = (row: MatchRelationRow): PowerOutageListItem | null => {
    const outage = relationOne(row.outage)
    if (!outage) return null
    const informed = informedByMatch.get(row.id)
    const linkedJobs = jobLinksByMatch.get(row.id) ?? []
    const linkedJob = linkedJobs[0]
    return {
      matchId: row.id,
      outageId: row.outage_id,
      source: outage.source,
      sourceStatus: outage.source_status,
      title: outage.title?.trim() || 'Plánovaná odstávka elektřiny',
      description: outage.description,
      startsAt: outage.starts_at,
      endsAt: outage.ends_at,
      archivedAt: outage.archived_at,
      municipality: outage.municipality,
      district: outage.district,
      region: outage.region,
      sourceUrl: outage.source_url,
      announcementUrl: outage.announcement_url,
      sourceUpdatedAt: outage.source_updated_at,
      firstSeenAt: outage.first_seen_at,
      lastSeenAt: outage.last_seen_at,
      isNew: !viewedMatchIds.has(row.id),
      matchStatus: row.match_status,
      confidence: Number(row.confidence),
      matchReasons: stringArray(row.match_reasons),
      store: {
        id: row.store_id,
        chainName: row.store_chain_name,
        storeNumber: row.store_number,
        city: row.store_city,
        address: row.store_address,
      },
      informed: informed?.informed ?? false,
      informedAt: informed?.created_at ?? null,
      linkedJob: linkedJob
        ? {
            id: linkedJob.job_id,
            jobNumber: linkedJob.job_number,
            matchCount: linkedJobs.length,
          }
        : null,
    }
  }

  const currentOutages = currentRows
    .map(mapMatch)
    .filter((item): item is PowerOutageListItem => Boolean(item))
    .sort(compareCurrent)
  const archivedOutages = archiveRows
    .map(mapMatch)
    .filter((item): item is PowerOutageListItem => Boolean(item))
    .sort(compareArchive)
  const preferences: PowerOutageNotificationPreferences = {
    notificationsEnabled: preferenceResult.data?.notifications_enabled ?? false,
    reminder24hEnabled: false,
    updatedAt: preferenceResult.data?.updated_at ?? null,
  }

  return {
    generatedAt: new Date().toISOString(),
    statistics: {
      analyzedOutageCount: analyzedResult.count ?? 0,
      currentMatchCount: currentCountResult.count ?? 0,
      archivedMatchCount: archiveCountResult.count ?? 0,
      needsReviewCount: reviewCountResult.count ?? 0,
    },
    currentOutages,
    archivedOutages,
    filters: filterOptions([...currentOutages, ...archivedOutages]),
    sources: health.sources,
    sourceHealth: health.status,
    storeCoverage: storeCoverage(
      registryRows,
      catalogResult.data,
    ),
    preferences,
  }
}

type DetailMatchRow = {
  id: string
  outage_id: string
  outage_address_id: string | null
  store_id: string | null
  match_status: PowerOutageMatchStatus
  match_method: 'city_street' | 'manual'
  confidence: number | string
  match_reasons: unknown
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  store_revision: number | string
  first_matched_at: string
  last_verified_at: string
  resolved_at: string | null
  outage: Array<OutageRelationRow & {
    external_id: string
    archive_at: string
    municipality_code: string | null
  }> | (OutageRelationRow & {
    external_id: string
    archive_at: string
    municipality_code: string | null
  })
}

export async function getPowerOutageDetail(matchId: string): Promise<PowerOutageDetail> {
  const cleanMatchId = matchId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cleanMatchId)) {
    throw new Error('Neplatné technické ID shody odstávky.')
  }

  const { supabase } = await getPowerOutageRuntimeContext()
  const { data: matchData, error: matchError } = await supabase
    .from('power_outage_store_matches')
    .select(`
      id,outage_id,outage_address_id,store_id,match_status,match_method,confidence,match_reasons,
      store_chain_name,store_number,store_city,store_address,store_revision,
      first_matched_at,last_verified_at,resolved_at,
      outage:power_outages!inner(
        id,external_id,source,source_status,title,description,starts_at,ends_at,archive_at,archived_at,
        municipality,municipality_code,district,region,source_url,announcement_url,source_updated_at,
        first_seen_at,last_seen_at
      )
    `)
    .eq('id', cleanMatchId)
    .maybeSingle()
  if (matchError) throw new Error(`Detail odstávky se nepodařilo načíst: ${matchError.message}`)
  if (!matchData) throw new Error('Požadovaný záznam odstávky nebyl nalezen.')

  const match = matchData as unknown as DetailMatchRow
  const outage = relationOne(match.outage)
  if (!outage) throw new Error('Zdrojová odstávka není dostupná.')

  const [addressesResult, versionsResult, matchAuditResult, informedResult] = await Promise.all([
    supabase
      .from('power_outage_addresses')
      .select('id,raw_address,municipality,town_part,street,house_number,orientation_number,postal_code')
      .eq('outage_id', outage.id)
      .order('municipality')
      .order('street'),
    supabase
      .from('power_outage_versions')
      .select('id,version_number,change_reasons,created_at')
      .eq('outage_id', outage.id)
      .order('version_number', { ascending: false }),
    supabase
      .from('power_outage_match_audit')
      .select('id,previous_status,next_status,note,actor_user_id,created_at')
      .eq('match_id', cleanMatchId)
      .order('created_at', { ascending: false }),
    supabase
      .from('power_outage_informed_audit')
      .select('id,informed,note,actor_user_id,created_at')
      .eq('match_id', cleanMatchId)
      .order('created_at', { ascending: false }),
  ])
  const detailError = [addressesResult.error, versionsResult.error, matchAuditResult.error, informedResult.error].find(Boolean)
  if (detailError) throw new Error(`Historii odstávky se nepodařilo načíst: ${detailError.message}`)

  return {
    matchId: match.id,
    outageId: outage.id,
    storeId: match.store_id,
    outageAddressId: match.outage_address_id,
    externalId: outage.external_id,
    source: outage.source,
    sourceStatus: outage.source_status,
    title: outage.title?.trim() || 'Plánovaná odstávka elektřiny',
    description: outage.description,
    startsAt: outage.starts_at,
    endsAt: outage.ends_at,
    archiveAt: outage.archive_at,
    archivedAt: outage.archived_at,
    municipality: outage.municipality,
    municipalityCode: outage.municipality_code,
    district: outage.district,
    region: outage.region,
    sourceUrl: outage.source_url,
    announcementUrl: outage.announcement_url,
    sourceUpdatedAt: outage.source_updated_at,
    firstSeenAt: outage.first_seen_at,
    lastSeenAt: outage.last_seen_at,
    matchStatus: match.match_status,
    matchMethod: match.match_method,
    confidence: Number(match.confidence),
    matchReasons: stringArray(match.match_reasons),
    storeRevision: Number(match.store_revision),
    firstMatchedAt: match.first_matched_at,
    lastVerifiedAt: match.last_verified_at,
    resolvedAt: match.resolved_at,
    store: {
      id: match.store_id,
      chainName: match.store_chain_name,
      storeNumber: match.store_number,
      city: match.store_city,
      address: match.store_address,
    },
    addresses: (addressesResult.data ?? []).map((row) => ({
      id: row.id,
      rawAddress: row.raw_address,
      municipality: row.municipality,
      townPart: row.town_part,
      street: row.street,
      houseNumber: row.house_number,
      orientationNumber: row.orientation_number,
      postalCode: row.postal_code,
    })),
    versions: (versionsResult.data ?? []).map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      changeReasons: stringArray(row.change_reasons),
      createdAt: row.created_at,
    })),
    matchAudit: (matchAuditResult.data ?? []).map((row) => ({
      id: row.id,
      previousStatus: row.previous_status,
      nextStatus: row.next_status,
      note: row.note,
      actorUserId: row.actor_user_id,
      createdAt: row.created_at,
    })),
    informedHistory: (informedResult.data ?? []).map((row) => ({
      id: row.id,
      informed: row.informed,
      note: row.note,
      actorUserId: row.actor_user_id,
      createdAt: row.created_at,
    })),
  }
}
