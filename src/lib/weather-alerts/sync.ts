import { getServiceRoleClient } from '@/lib/supabase/service'
import { discoverLatestChmiCapFile, downloadChmiCapFile } from './chmi-source'
import { hashChmiPayload, parseChmiCapMessage } from './cap-parser'
import {
  CHMI_BULLETIN_TYPE,
  CHMI_SOURCE,
  type NormalizedWeatherSegment,
  type WeatherImportResult,
} from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type SourceState = {
  latest_file_name: string | null
  latest_file_etag: string | null
  latest_file_last_modified_at: string | null
  latest_source_message_id: string | null
  consecutive_failure_count: number | null
}

export class WeatherSyncAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí synchronizace ČHMÚ stále probíhá.')
    this.name = 'WeatherSyncAlreadyRunningError'
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'Neznámá chyba synchronizace ČHMÚ.'
}

function sourceSegmentRow(sourceMessageId: string, segment: NormalizedWeatherSegment) {
  return {
    source_message_id: sourceMessageId,
    segment_index: segment.segmentIndex,
    language: segment.language,
    event_name: segment.eventName,
    primary_event_code: segment.primaryEventCode,
    event_codes: segment.eventCodes,
    hazard_type: segment.hazardType,
    urgency: segment.urgency,
    severity: segment.severity,
    certainty: segment.certainty,
    effective_at: segment.effectiveAt,
    onset_at: segment.onsetAt,
    expires_at: segment.expiresAt,
    event_ending_at: segment.eventEndingAt,
    headline: segment.headline,
    description: segment.description,
    instruction: segment.instruction,
    situation: segment.situation,
    criterion: segment.criterion,
    source_web_url: segment.sourceWebUrl,
    awareness_level: segment.awarenessLevel,
    awareness_type: segment.awarenessType,
    parameters: segment.parameters,
    areas: segment.areas,
    is_relevant_hazard: segment.isRelevantHazard,
    is_active_warning: segment.isActiveWarning,
    segment_sha256: segment.segmentSha256,
  }
}

async function loadSourceState(client: ServiceClient) {
  const { data, error } = await client
    .from('weather_source_state')
    .select(
      'latest_file_name, latest_file_etag, latest_file_last_modified_at, latest_source_message_id, consecutive_failure_count',
    )
    .eq('source', CHMI_SOURCE)
    .maybeSingle<SourceState>()

  if (error) throw error
  return data
}

async function updateSourceFailure(
  client: ServiceClient,
  state: SourceState | null,
  error: unknown,
) {
  const now = new Date().toISOString()
  await client.from('weather_source_state').upsert(
    {
      source: CHMI_SOURCE,
      last_attempt_at: now,
      last_error_at: now,
      last_error_code: 'CHMI_IMPORT_FAILED',
      last_error_message: errorMessage(error).slice(0, 2_000),
      consecutive_failure_count: (state?.consecutive_failure_count ?? 0) + 1,
      updated_at: now,
    },
    { onConflict: 'source' },
  )
}

async function insertSegments(
  client: ServiceClient,
  sourceMessageId: string,
  segments: NormalizedWeatherSegment[],
) {
  const batchSize = 25
  for (let offset = 0; offset < segments.length; offset += batchSize) {
    const rows = segments
      .slice(offset, offset + batchSize)
      .map((segment) => sourceSegmentRow(sourceMessageId, segment))
    const { error } = await client.from('weather_source_segments').insert(rows)
    if (error) throw error
  }
}

async function findExistingMessage(client: ServiceClient, payloadSha256: string) {
  const { data, error } = await client
    .from('weather_source_messages')
    .select('id, processed_at')
    .eq('payload_sha256', payloadSha256)
    .maybeSingle<{ id: string; processed_at: string | null }>()
  if (error) throw error
  return data ?? null
}

export async function importLatestChmiCap(): Promise<WeatherImportResult> {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí serverové připojení Supabase pro import ČHMÚ.')
  }

  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 4 * 60 * 1_000).toISOString()

  const { error: staleRunError } = await client
    .from('weather_sync_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_code: 'WEATHER_SYNC_STALE',
      error_message: 'Synchronizační běh překročil bezpečnostní limit čtyř minut.',
    })
    .eq('source', CHMI_SOURCE)
    .eq('status', 'running')
    .lt('started_at', staleBefore)
  if (staleRunError) throw staleRunError

  const { data: run, error: runError } = await client
    .from('weather_sync_runs')
    .insert({ source: CHMI_SOURCE, started_at: startedAt, status: 'running' })
    .select('id')
    .single<{ id: string }>()
  if (runError?.code === '23505') throw new WeatherSyncAlreadyRunningError()
  if (runError) throw runError

  const runId = run.id
  let sourceState: SourceState | null = null

  try {
    sourceState = await loadSourceState(client)
    const discovery = await discoverLatestChmiCapFile()
    const candidate = discovery.latest

    await client
      .from('weather_sync_runs')
      .update({
        candidate_file_name: candidate.fileName,
        candidate_file_url: candidate.url,
        candidate_last_modified_at: candidate.lastModifiedAt,
        directory_http_status: discovery.httpStatus,
        discovered_file_count: discovery.discoveredFileCount,
      })
      .eq('id', runId)

    const isSameCandidate = sourceState?.latest_file_name === candidate.fileName
    const download = await downloadChmiCapFile({
      candidate,
      previousEtag: isSameCandidate ? sourceState?.latest_file_etag : null,
      previousLastModifiedAt: isSameCandidate
        ? sourceState?.latest_file_last_modified_at
        : null,
    })

    const completedAt = new Date().toISOString()
    if (download.unchanged) {
      const { error: stateError } = await client.from('weather_source_state').upsert(
        {
          source: CHMI_SOURCE,
          last_attempt_at: completedAt,
          last_success_at: completedAt,
          consecutive_failure_count: 0,
          last_error_at: null,
          last_error_code: null,
          last_error_message: null,
          updated_at: completedAt,
        },
        { onConflict: 'source' },
      )
      if (stateError) throw stateError

      const { error: finishError } = await client
        .from('weather_sync_runs')
        .update({
          finished_at: completedAt,
          status: 'no_change',
          candidate_etag: download.etag,
          file_http_status: download.httpStatus,
          downloaded: false,
        })
        .eq('id', runId)
      if (finishError) throw finishError

      return {
        status: 'unchanged',
        syncRunId: runId,
        candidateFileName: candidate.fileName,
        sourceMessageId: sourceState?.latest_source_message_id ?? null,
        discoveredFileCount: discovery.discoveredFileCount,
        processedSegmentCount: 0,
        relevantSegmentCount: 0,
        activeRelevantSegmentCount: 0,
        downloaded: false,
      }
    }

    const xml = download.xml
    const payloadSha256 = hashChmiPayload(xml)
    const parsed = parseChmiCapMessage(xml)
    let existingMessage = await findExistingMessage(client, payloadSha256)
    let sourceMessageId = existingMessage?.id ?? null
    let insertedNewMessage = false

    if (!sourceMessageId) {
      const { data: sourceMessage, error: sourceMessageError } = await client
        .from('weather_source_messages')
        .insert({
          source: CHMI_SOURCE,
          bulletin_type: CHMI_BULLETIN_TYPE,
          source_identifier: parsed.identifier,
          source_file_name: candidate.fileName,
          source_url: candidate.url,
          source_file_etag: download.etag,
          source_file_last_modified_at: download.lastModifiedAt,
          sender: parsed.sender,
          sent_at: parsed.sentAt,
          message_status: parsed.status,
          message_type: parsed.messageType,
          message_scope: parsed.scope,
          references_text: parsed.referencesText,
          source_codes: parsed.sourceCodes,
          payload_sha256: payloadSha256,
          raw_xml: xml,
        })
        .select('id')
        .single<{ id: string }>()

      if (sourceMessageError) {
        if (sourceMessageError.code !== '23505') throw sourceMessageError
        existingMessage = await findExistingMessage(client, payloadSha256)
        sourceMessageId = existingMessage?.id ?? null
        if (!sourceMessageId) throw sourceMessageError
      } else {
        sourceMessageId = sourceMessage.id
        insertedNewMessage = true
      }
    }

    if (insertedNewMessage || !existingMessage?.processed_at) {
      try {
        if (!insertedNewMessage) {
          const { error: cleanupError } = await client
            .from('weather_source_segments')
            .delete()
            .eq('source_message_id', sourceMessageId)
          if (cleanupError) throw cleanupError
        }
        await insertSegments(client, sourceMessageId, parsed.segments)
        const { error: processError } = await client
          .from('weather_source_messages')
          .update({ processed_at: completedAt, processing_error: null })
          .eq('id', sourceMessageId)
        if (processError) throw processError
      } catch (error) {
        await client
          .from('weather_source_messages')
          .update({ processing_error: errorMessage(error).slice(0, 2_000) })
          .eq('id', sourceMessageId)
        throw error
      }
    }

    const relevantSegmentCount = parsed.segments.filter(
      (segment) => segment.isRelevantHazard,
    ).length
    const activeRelevantSegmentCount = parsed.segments.filter(
      (segment) => segment.isActiveWarning,
    ).length

    const { error: stateError } = await client.from('weather_source_state').upsert(
      {
        source: CHMI_SOURCE,
        latest_file_name: candidate.fileName,
        latest_file_url: candidate.url,
        latest_file_etag: download.etag,
        latest_file_last_modified_at: download.lastModifiedAt,
        latest_source_identifier: parsed.identifier,
        latest_source_sent_at: parsed.sentAt,
        latest_source_message_id: sourceMessageId,
        last_attempt_at: completedAt,
        last_success_at: completedAt,
        consecutive_failure_count: 0,
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
        updated_at: completedAt,
      },
      { onConflict: 'source' },
    )
    if (stateError) throw stateError

    const { error: finishError } = await client
      .from('weather_sync_runs')
      .update({
        finished_at: completedAt,
        status: 'succeeded',
        candidate_etag: download.etag,
        candidate_last_modified_at: download.lastModifiedAt,
        source_message_id: sourceMessageId,
        file_http_status: download.httpStatus,
        downloaded: true,
        processed_segment_count: parsed.segments.length,
        active_event_count: activeRelevantSegmentCount,
        metadata: {
          payloadSha256,
          relevantSegmentCount,
          insertedNewMessage,
        },
      })
      .eq('id', runId)
    if (finishError) throw finishError

    return {
      status: 'success',
      syncRunId: runId,
      candidateFileName: candidate.fileName,
      sourceMessageId,
      discoveredFileCount: discovery.discoveredFileCount,
      processedSegmentCount: parsed.segments.length,
      relevantSegmentCount,
      activeRelevantSegmentCount,
      downloaded: true,
    }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    await Promise.allSettled([
      updateSourceFailure(client, sourceState, error),
      client
        .from('weather_sync_runs')
        .update({
          finished_at: finishedAt,
          status: 'failed',
          error_code: 'CHMI_IMPORT_FAILED',
          error_message: errorMessage(error).slice(0, 2_000),
        })
        .eq('id', runId),
    ])
    throw error
  }
}
