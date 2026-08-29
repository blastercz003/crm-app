import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { runWeatherFeedSync } from './feed-sync'
import {
  discoverChmiRadarTimeline,
  downloadChmiRadarForecast,
  downloadChmiRadarObservation,
  type ChmiRadarCandidate,
  type ChmiRadarForecastFrame,
} from './radar-source'
import type {
  WeatherRadarFrameKind,
  WeatherRadarSyncResult,
} from './types'

const RADAR_BUCKET = 'weather-radar'
const RADAR_PRODUCT = 'pseudocappi_2km'
const RADAR_RETENTION_MS = 2 * 60 * 60 * 1_000

const RADAR_BOUNDS = {
  west: 11.267,
  south: 48.047,
  east: 20.77,
  north: 52.167,
  projection: 'EPSG:3857',
} as const

type ServiceClient = Parameters<
  Parameters<typeof runWeatherFeedSync>[0]['sync']
>[0]['client']

type RadarFrameInput = {
  frameKind: WeatherRadarFrameKind
  fileName: string
  sourceUrl: string
  sourceTimestamp: string
  validAt: string
  leadMinutes: number
  bytes: Uint8Array
  payloadSha256: string
  metadata: Record<string, unknown>
}

function pngDimensions(bytes: Uint8Array) {
  if (bytes.byteLength < 24) throw new Error('Radarový PNG snímek je neúplný.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width <= 0 || height <= 0 || width > 10_000 || height > 10_000) {
    throw new Error('Radarový PNG snímek má neplatné rozměry.')
  }
  return { width, height }
}

function storagePath(frame: RadarFrameInput) {
  const date = new Date(frame.validAt)
  const year = String(date.getUTCFullYear())
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${RADAR_PRODUCT}/${frame.frameKind}/${year}/${month}/${day}/${frame.fileName}`
}

async function existingFrameNames(client: ServiceClient, fileNames: string[]) {
  if (fileNames.length === 0) return new Set<string>()
  const { data, error } = await client
    .from('weather_radar_frames')
    .select('source_file_name')
    .eq('product_key', RADAR_PRODUCT)
    .in('source_file_name', fileNames)
  if (error) throw error
  return new Set(
    (data ?? []).map((row) => String((row as { source_file_name: string }).source_file_name)),
  )
}

async function storeFrame(client: ServiceClient, frame: RadarFrameInput) {
  const path = storagePath(frame)
  const dimensions = pngDimensions(frame.bytes)
  const { error: uploadError } = await client.storage
    .from(RADAR_BUCKET)
    .upload(path, Buffer.from(frame.bytes), {
      cacheControl: '300',
      contentType: 'image/png',
      upsert: true,
    })
  if (uploadError) throw uploadError

  const { error: insertError } = await client.from('weather_radar_frames').upsert(
    {
      product_key: RADAR_PRODUCT,
      frame_kind: frame.frameKind,
      source_file_name: frame.fileName,
      source_url: frame.sourceUrl,
      source_timestamp: frame.sourceTimestamp,
      valid_at: frame.validAt,
      lead_minutes: frame.leadMinutes,
      storage_bucket: RADAR_BUCKET,
      storage_path: path,
      content_type: 'image/png',
      payload_sha256: frame.payloadSha256,
      byte_size: frame.bytes.byteLength,
      width_px: dimensions.width,
      height_px: dimensions.height,
      projection: 'EPSG:3857',
      bounds: RADAR_BOUNDS,
      metadata: frame.metadata,
    },
    { onConflict: 'product_key,source_file_name', ignoreDuplicates: true },
  )
  if (insertError) {
    await client.storage.from(RADAR_BUCKET).remove([path])
    throw insertError
  }
  return path
}

async function pruneOldRadarFrames(client: ServiceClient) {
  const cutoff = new Date(Date.now() - RADAR_RETENTION_MS).toISOString()
  const { data, error } = await client
    .from('weather_radar_frames')
    .select('id,storage_path')
    .eq('product_key', RADAR_PRODUCT)
    .lt('valid_at', cutoff)
    .limit(500)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>
  if (rows.length === 0) return 0

  const { error: deleteError } = await client
    .from('weather_radar_frames')
    .delete()
    .in('id', rows.map((row) => row.id))
  if (deleteError) throw deleteError
  const { error: storageError } = await client.storage
    .from(RADAR_BUCKET)
    .remove(rows.map((row) => row.storage_path))
  if (storageError) throw storageError
  return rows.length
}

async function pruneSupersededForecasts(
  client: ServiceClient,
  latestForecastRunAt: string,
) {
  const { data, error } = await client
    .from('weather_radar_frames')
    .select('id,storage_path')
    .eq('product_key', RADAR_PRODUCT)
    .eq('frame_kind', 'forecast')
    .lt('source_timestamp', latestForecastRunAt)
    .limit(500)
  if (error) throw error
  const rows = (data ?? []) as Array<{ id: string; storage_path: string }>
  if (rows.length === 0) return 0

  const { error: deleteError } = await client
    .from('weather_radar_frames')
    .delete()
    .in('id', rows.map((row) => row.id))
  if (deleteError) throw deleteError
  const { error: storageError } = await client.storage
    .from(RADAR_BUCKET)
    .remove(rows.map((row) => row.storage_path))
  if (storageError) throw storageError
  return rows.length
}

function observationInput(frame: Awaited<ReturnType<typeof downloadChmiRadarObservation>>) {
  return {
    frameKind: 'observation' as const,
    fileName: frame.fileName,
    sourceUrl: frame.url,
    sourceTimestamp: frame.timestamp,
    validAt: frame.timestamp,
    leadMinutes: 0,
    bytes: frame.bytes,
    payloadSha256: frame.payloadSha256,
    metadata: { sourceProduct: 'PseudoCAPPI_2km' },
  }
}

function forecastInput(frame: ChmiRadarForecastFrame, run: ChmiRadarCandidate) {
  return {
    frameKind: 'forecast' as const,
    fileName: frame.fileName,
    sourceUrl: frame.archiveUrl,
    sourceTimestamp: run.timestamp,
    validAt: frame.timestamp,
    leadMinutes: frame.leadMinutes,
    bytes: frame.bytes,
    payloadSha256: frame.payloadSha256,
    metadata: {
      sourceProduct: 'FCT_PseudoCAPPI_2km',
      archiveFileName: frame.archiveFileName,
      archivePayloadSha256: frame.archivePayloadSha256,
    },
  }
}

function forecastFileName(runTimestamp: string, leadMinutes: number) {
  const validAt = new Date(new Date(runTimestamp).getTime() + leadMinutes * 60_000)
  const date = [
    validAt.getUTCFullYear(),
    String(validAt.getUTCMonth() + 1).padStart(2, '0'),
    String(validAt.getUTCDate()).padStart(2, '0'),
  ].join('')
  const time = [
    String(validAt.getUTCHours()).padStart(2, '0'),
    String(validAt.getUTCMinutes()).padStart(2, '0'),
  ].join('')
  return `pacz2gmaps3.fct_z_cappi020.${date}.${time}.${leadMinutes}.png`
}

export async function syncChmiRadar(): Promise<WeatherRadarSyncResult> {
  return runWeatherFeedSync({
    feedKey: 'radar',
    ttlSeconds: 240,
    async sync({ client }) {
      const timeline = await discoverChmiRadarTimeline()
      const allSourceNames = [
        ...timeline.observations.map((frame) => frame.fileName),
        ...[10, 20, 30, 40, 50, 60].map((lead) =>
          forecastFileName(timeline.forecastArchive.timestamp, lead),
        ),
      ]
      const existingNames = await existingFrameNames(client, allSourceNames)
      const missingObservations = timeline.observations.filter(
        (frame) => !existingNames.has(frame.fileName),
      )
      const forecastMissing = allSourceNames
        .slice(timeline.observations.length)
        .some((fileName) => !existingNames.has(fileName))

      const observations = await Promise.all(
        missingObservations.map(downloadChmiRadarObservation),
      )
      const forecasts = forecastMissing
        ? await downloadChmiRadarForecast(timeline.forecastArchive)
        : []
      const frames: RadarFrameInput[] = [
        ...observations.map(observationInput),
        ...forecasts
          .filter((frame) => !existingNames.has(frame.fileName))
          .map((frame) => forecastInput(frame, timeline.forecastArchive)),
      ]

      const uploadedPaths: string[] = []
      try {
        for (const frame of frames) {
          uploadedPaths.push(await storeFrame(client, frame))
        }
      } catch (error) {
        if (uploadedPaths.length > 0) {
          await client.storage.from(RADAR_BUCKET).remove(uploadedPaths)
          await client
            .from('weather_radar_frames')
            .delete()
            .in('storage_path', uploadedPaths)
        }
        throw error
      }

      const removedFrameCount =
        (await pruneSupersededForecasts(
          client,
          timeline.forecastArchive.timestamp,
        )) + (await pruneOldRadarFrames(client))
      const { count: retainedFrameCount, error: countError } = await client
        .from('weather_radar_frames')
        .select('*', { count: 'exact', head: true })
        .eq('product_key', RADAR_PRODUCT)
      if (countError) throw countError

      const sourceRef = [
        timeline.observations[0].fileName,
        timeline.forecastArchive.fileName,
      ].join('|')
      const payloadSha256 = createHash('sha256')
        .update(sourceRef, 'utf8')
        .digest('hex')

      return {
        changed: frames.length > 0 || removedFrameCount > 0,
        sourceRef,
        payloadSha256,
        observationFrameCount: timeline.observations.length,
        forecastFrameCount: 6,
        insertedFrameCount: frames.length,
        retainedFrameCount: retainedFrameCount ?? 0,
        removedFrameCount,
        metadata: {
          latestObservationAt: timeline.observations[0].timestamp,
          latestForecastRunAt: timeline.forecastArchive.timestamp,
          observationFrameCount: timeline.observations.length,
          forecastFrameCount: 6,
          retainedFrameCount: retainedFrameCount ?? 0,
        },
      }
    },
  })
}
