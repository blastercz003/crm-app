import { randomUUID } from 'node:crypto'
import { getServiceRoleClient } from '@/lib/supabase/service'
import type {
  WeatherFeedState,
  WeatherFeedSyncSuccess,
  WeatherInsightFeedKey,
} from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type FeedStateRow = {
  feed_key: WeatherInsightFeedKey
  last_attempt_at: string | null
  last_success_at: string | null
  last_change_at: string | null
  latest_source_ref: string | null
  latest_payload_sha256: string | null
  consecutive_failure_count: number | null
  data_version: number | null
  metadata: Record<string, unknown> | null
}

export class WeatherFeedAlreadyRunningError extends Error {
  readonly feedKey: WeatherInsightFeedKey

  constructor(feedKey: WeatherInsightFeedKey) {
    super(`Synchronizace kanálu ${feedKey} již probíhá.`)
    this.name = 'WeatherFeedAlreadyRunningError'
    this.feedKey = feedKey
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
  return 'Neznámá chyba synchronizace.'
}

function errorCode(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code
  }
  return 'WEATHER_FEED_SYNC_FAILED'
}

function serviceClient() {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí serverové připojení pro synchronizaci dat ČHMÚ.')
  }
  return client
}

async function claimFeedLock(
  client: ServiceClient,
  feedKey: WeatherInsightFeedKey,
  lockToken: string,
  ttlSeconds: number,
) {
  const { data, error } = await client.rpc('claim_weather_feed_sync', {
    p_feed_key: feedKey,
    p_lock_token: lockToken,
    p_ttl_seconds: ttlSeconds,
  })
  if (error) throw error
  if (data !== true) throw new WeatherFeedAlreadyRunningError(feedKey)
}

async function completeFeedLock(params: {
  client: ServiceClient
  feedKey: WeatherInsightFeedKey
  lockToken: string
  succeeded: boolean
  changed?: boolean
  sourceRef?: string | null
  payloadSha256?: string | null
  error?: unknown
  metadata?: Record<string, unknown>
}) {
  const { data, error } = await params.client.rpc('complete_weather_feed_sync', {
    p_feed_key: params.feedKey,
    p_lock_token: params.lockToken,
    p_succeeded: params.succeeded,
    p_changed: params.changed ?? false,
    p_source_ref: params.sourceRef ?? null,
    p_payload_sha256: params.payloadSha256 ?? null,
    p_error_code: params.succeeded ? null : errorCode(params.error),
    p_error_message: params.succeeded ? null : errorMessage(params.error).slice(0, 2_000),
    p_metadata: params.metadata ?? {},
  })
  if (error) throw error
  if (data !== true) {
    throw new Error(`Synchronizační zámek kanálu ${params.feedKey} již není platný.`)
  }
}

export async function runWeatherFeedSync<T extends WeatherFeedSyncSuccess>(params: {
  feedKey: WeatherInsightFeedKey
  ttlSeconds?: number
  sync: (context: {
    client: ServiceClient
    previousState: WeatherFeedState
  }) => Promise<T>
}) {
  const client = serviceClient()
  const lockToken = randomUUID()
  await claimFeedLock(client, params.feedKey, lockToken, params.ttlSeconds ?? 240)

  const { data: stateRow, error: stateError } = await client
    .from('weather_feed_state')
    .select(
      'feed_key,last_attempt_at,last_success_at,last_change_at,latest_source_ref,latest_payload_sha256,consecutive_failure_count,data_version,metadata',
    )
    .eq('feed_key', params.feedKey)
    .single<FeedStateRow>()

  if (stateError) {
    await completeFeedLock({
      client,
      feedKey: params.feedKey,
      lockToken,
      succeeded: false,
      error: stateError,
    })
    throw stateError
  }

  const previousState: WeatherFeedState = {
    feedKey: stateRow.feed_key,
    lastAttemptAt: stateRow.last_attempt_at,
    lastSuccessAt: stateRow.last_success_at,
    lastChangeAt: stateRow.last_change_at,
    latestSourceRef: stateRow.latest_source_ref,
    latestPayloadSha256: stateRow.latest_payload_sha256,
    consecutiveFailureCount: stateRow.consecutive_failure_count ?? 0,
    dataVersion: stateRow.data_version ?? 0,
    metadata: stateRow.metadata ?? {},
  }

  try {
    const result = await params.sync({ client, previousState })
    await completeFeedLock({
      client,
      feedKey: params.feedKey,
      lockToken,
      succeeded: true,
      changed: result.changed,
      sourceRef: result.sourceRef,
      payloadSha256: result.payloadSha256,
      metadata: result.metadata,
    })
    return result
  } catch (error) {
    try {
      await completeFeedLock({
        client,
        feedKey: params.feedKey,
        lockToken,
        succeeded: false,
        error,
      })
    } catch (completionError) {
      console.error('Nepodařilo se zapsat chybu synchronizace dat ČHMÚ.', completionError)
    }
    throw error
  }
}
