import { createHash } from 'node:crypto'
import { runWeatherFeedSync } from './feed-sync'
import {
  downloadChmiObservationDataset,
  MONITORED_CHMI_STATION_CODES,
  type ChmiObservation,
  type ChmiStationMeasurements,
  type ChmiStationMetadata,
} from './observation-source'
import type {
  WeatherObservationMetricKey,
  WeatherObservationSyncResult,
} from './types'

const EXTREME_RANK_COUNT = 3
const OBSERVATION_RETENTION_DAYS = 7

type ServiceClient = Parameters<
  Parameters<typeof runWeatherFeedSync>[0]['sync']
>[0]['client']

type ExtremeCandidate = {
  metricKey: WeatherObservationMetricKey
  extremumKind: 'maximum' | 'minimum'
  station: ChmiStationMetadata
  observation: ChmiObservation
  source: ChmiStationMeasurements
  unit: string
}

function latestTimestamp(measurements: ChmiStationMeasurements[]) {
  let latest = 0
  for (const measurement of measurements) {
    for (const observation of measurement.observations) {
      latest = Math.max(latest, new Date(observation.observedAt).getTime())
    }
  }
  if (!latest) throw new Error('ČHMÚ neposkytlo žádné aktuální měření.')
  return latest
}

function latestPerStation(params: {
  measurements: ChmiStationMeasurements[]
  element: string
  frequency: '10m' | '1h'
  notBefore: number
}) {
  const latest = new Map<
    string,
    { observation: ChmiObservation; source: ChmiStationMeasurements }
  >()
  for (const source of params.measurements) {
    if (source.candidate.frequency !== params.frequency) continue
    for (const observation of source.observations) {
      if (
        observation.element !== params.element ||
        new Date(observation.observedAt).getTime() < params.notBefore
      ) {
        continue
      }
      const previous = latest.get(observation.stationCode)
      if (
        !previous ||
        new Date(observation.observedAt).getTime() >
          new Date(previous.observation.observedAt).getTime()
      ) {
        latest.set(observation.stationCode, { observation, source })
      }
    }
  }
  return latest
}

function maximumInWindow(params: {
  measurements: ChmiStationMeasurements[]
  element: string
  frequency: '10m' | '1h'
  notBefore: number
}) {
  const maxima = new Map<
    string,
    { observation: ChmiObservation; source: ChmiStationMeasurements }
  >()
  for (const source of params.measurements) {
    if (source.candidate.frequency !== params.frequency) continue
    for (const observation of source.observations) {
      if (
        observation.element !== params.element ||
        new Date(observation.observedAt).getTime() < params.notBefore
      ) {
        continue
      }
      const previous = maxima.get(observation.stationCode)
      if (!previous || observation.value > previous.observation.value) {
        maxima.set(observation.stationCode, { observation, source })
      }
    }
  }
  return maxima
}

function filterValues(
  values: Map<
    string,
    { observation: ChmiObservation; source: ChmiStationMeasurements }
  >,
  predicate: (value: number) => boolean,
) {
  return new Map(
    [...values].filter(([, item]) => predicate(item.observation.value)),
  )
}

function rankedExtremes(params: {
  values: Map<
    string,
    { observation: ChmiObservation; source: ChmiStationMeasurements }
  >
  stations: Map<string, ChmiStationMetadata>
  metricKey: WeatherObservationMetricKey
  extremumKind: 'maximum' | 'minimum'
  unit: string
}) {
  const candidates: ExtremeCandidate[] = []
  for (const [stationCode, value] of params.values) {
    const station = params.stations.get(stationCode)
    if (!station) continue
    candidates.push({
      metricKey: params.metricKey,
      extremumKind: params.extremumKind,
      station,
      observation: value.observation,
      source: value.source,
      unit: params.unit,
    })
  }
  candidates.sort((left, right) => {
    const difference = left.observation.value - right.observation.value
    return params.extremumKind === 'minimum' ? difference : -difference
  })
  return candidates.slice(0, EXTREME_RANK_COUNT)
}

async function pruneOldSnapshots(client: ServiceClient, currentSnapshotAt: string) {
  const retentionCutoff = new Date(
    Date.now() - OBSERVATION_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString()
  const { error } = await client
    .from('weather_observation_extremes')
    .delete()
    .lt('snapshot_at', retentionCutoff)
    .neq('snapshot_at', currentSnapshotAt)
  if (error) throw error
}

export async function syncChmiObservationExtremes(): Promise<WeatherObservationSyncResult> {
  return runWeatherFeedSync({
    feedKey: 'observations',
    ttlSeconds: 240,
    async sync({ client, previousState }) {
      const dataset = await downloadChmiObservationDataset()
      const sourceParts = [
        dataset.metadataPayloadSha256,
        ...dataset.measurements
          .map((item) => `${item.candidate.fileName}:${item.payloadSha256}`)
          .sort(),
      ]
      const payloadSha256 = createHash('sha256')
        .update(sourceParts.join('|'), 'utf8')
        .digest('hex')
      const snapshotTimestamp = latestTimestamp(dataset.measurements)
      const snapshotAt = new Date(snapshotTimestamp).toISOString()
      const snapshotAge = Date.now() - snapshotTimestamp
      if (snapshotAge > 3 * 60 * 60 * 1_000 || snapshotAge < -15 * 60_000) {
        throw new Error('Nejnovější měření ČHMÚ nemá důvěryhodné časové razítko.')
      }
      const sourceRef = dataset.measurements
        .map((item) => item.candidate.dateKey)
        .sort()
        .at(-1) ?? snapshotAt.slice(0, 10).replaceAll('-', '')

      if (previousState.latestPayloadSha256 === payloadSha256) {
        await pruneOldSnapshots(client, snapshotAt)
        return {
          changed: false,
          sourceRef,
          payloadSha256,
          monitoredStationCount: MONITORED_CHMI_STATION_CODES.length,
          reportingStationCount: dataset.stations.size,
          insertedExtremeCount: 0,
          snapshotAt,
          metadata: { snapshotAt, monitoredStationCount: dataset.stations.size },
        }
      }

      const temperatureValues = filterValues(
        latestPerStation({
          measurements: dataset.measurements,
          element: 'T',
          frequency: '10m',
          notBefore: snapshotTimestamp - 90 * 60_000,
        }),
        (value) => value >= -80 && value <= 60,
      )
      const gustValues = filterValues(
        maximumInWindow({
          measurements: dataset.measurements,
          element: 'Fmax',
          frequency: '10m',
          notBefore: snapshotTimestamp - 70 * 60_000,
        }),
        (value) => value >= 0 && value <= 150,
      )
      const precipitationValues = filterValues(
        latestPerStation({
          measurements: dataset.measurements,
          element: 'SRA1H',
          frequency: '1h',
          notBefore: snapshotTimestamp - 150 * 60_000,
        }),
        (value) => value >= 0 && value <= 500,
      )

      const groups = [
        rankedExtremes({
          values: temperatureValues,
          stations: dataset.stations,
          metricKey: 'temperature_max',
          extremumKind: 'maximum',
          unit: '°C',
        }),
        rankedExtremes({
          values: temperatureValues,
          stations: dataset.stations,
          metricKey: 'temperature_min',
          extremumKind: 'minimum',
          unit: '°C',
        }),
        rankedExtremes({
          values: gustValues,
          stations: dataset.stations,
          metricKey: 'wind_gust_max',
          extremumKind: 'maximum',
          unit: 'm/s',
        }),
        rankedExtremes({
          values: precipitationValues,
          stations: dataset.stations,
          metricKey: 'precipitation_max',
          extremumKind: 'maximum',
          unit: 'mm',
        }),
      ]
      if (groups.some((group) => group.length === 0)) {
        throw new Error('ČHMÚ neposkytlo dostatek platných dat pro všechny extrémy.')
      }
      const reportingStationCount = new Set([
        ...temperatureValues.keys(),
        ...gustValues.keys(),
        ...precipitationValues.keys(),
      ]).size

      const rows = groups.flatMap((group) =>
        group.map((item, index) => ({
          snapshot_at: snapshotAt,
          period_start_at: new Date(snapshotTimestamp - 150 * 60_000).toISOString(),
          period_end_at: snapshotAt,
          metric_key: item.metricKey,
          extremum_kind: item.extremumKind,
          rank_position: index + 1,
          station_code: item.station.stationCode,
          station_name: item.station.name,
          region_name: null,
          latitude: item.station.latitude,
          longitude: item.station.longitude,
          value: item.observation.value,
          unit: item.unit,
          source_file_name: item.source.candidate.fileName,
          source_url: item.source.candidate.url,
          payload_sha256: item.source.payloadSha256,
          metadata: {
            observedAt: item.observation.observedAt,
            elevation: item.station.elevation,
            quality: item.observation.quality,
            flag: item.observation.flag,
            monitoredStationCount: dataset.stations.size,
          },
        })),
      )

      const { error: upsertError } = await client
        .from('weather_observation_extremes')
        .upsert(rows, {
          onConflict: 'snapshot_at,metric_key,extremum_kind,rank_position',
        })
      if (upsertError) throw upsertError
      await pruneOldSnapshots(client, snapshotAt)

      return {
        changed: true,
        sourceRef,
        payloadSha256,
        monitoredStationCount: MONITORED_CHMI_STATION_CODES.length,
        reportingStationCount,
        insertedExtremeCount: rows.length,
        snapshotAt,
        metadata: {
          snapshotAt,
          monitoredStationCount: dataset.stations.size,
          reportingStationCount,
          extremeRowCount: rows.length,
        },
      }
    },
  })
}
