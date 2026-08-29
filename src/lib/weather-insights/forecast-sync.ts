import { createHash } from 'node:crypto'
import { runWeatherFeedSync } from './feed-sync'
import { downloadChmiForecastDataset } from './forecast-source'
import type { WeatherForecastSyncResult } from './types'

const FORECAST_RETENTION_DAYS = 7

type ServiceClient = Parameters<
  Parameters<typeof runWeatherFeedSync>[0]['sync']
>[0]['client']

async function pruneOldForecasts(client: ServiceClient) {
  const cutoff = new Date(
    Date.now() - FORECAST_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString()
  const { error } = await client
    .from('weather_forecast_snapshots')
    .delete()
    .lt('issued_at', cutoff)
  if (error) throw error
}

export async function syncChmiForecastOutlook(): Promise<WeatherForecastSyncResult> {
  return runWeatherFeedSync({
    feedKey: 'forecast',
    ttlSeconds: 540,
    async sync({ client, previousState }) {
      const dataset = await downloadChmiForecastDataset()
      const sourceParts = dataset.downloads
        .map((download) =>
          `${download.candidate.fileName}:${download.payloadSha256}`,
        )
        .sort()
      const payloadSha256 = createHash('sha256')
        .update(sourceParts.join('|'), 'utf8')
        .digest('hex')
      const snapshots = dataset.downloads.flatMap((download) => download.snapshots)
      const issuedAt = snapshots
        .map((snapshot) => snapshot.issuedAt)
        .sort()
        .at(-1)
      if (!issuedAt) throw new Error('ČHMÚ neposkytlo platný čas vydání předpovědi.')
      const age = Date.now() - new Date(issuedAt).getTime()
      if (age > 48 * 60 * 60 * 1_000 || age < -15 * 60_000) {
        throw new Error('Nejnovější předpověď ČHMÚ nemá důvěryhodné časové razítko.')
      }

      const nationalSnapshotCount = snapshots.filter(
        (snapshot) => snapshot.scopeType === 'national',
      ).length
      const regionalSnapshotCount = snapshots.length - nationalSnapshotCount
      const relevantSnapshotCount = snapshots.filter(
        (snapshot) => snapshot.relevantPhenomena.length > 0,
      ).length
      const sourceRef = `${issuedAt}:${dataset.downloads.length}`

      if (previousState.latestPayloadSha256 === payloadSha256) {
        await pruneOldForecasts(client)
        return {
          changed: false,
          sourceRef,
          payloadSha256,
          downloadedFileCount: dataset.downloads.length,
          nationalSnapshotCount,
          regionalSnapshotCount,
          relevantSnapshotCount,
          insertedSnapshotCount: 0,
          issuedAt,
          metadata: {
            issuedAt,
            downloadedFileCount: dataset.downloads.length,
            nationalSnapshotCount,
            regionalSnapshotCount,
            relevantSnapshotCount,
          },
        }
      }

      const rows = snapshots.map((snapshot) => ({
        issued_at: snapshot.issuedAt,
        valid_from: snapshot.validFrom,
        valid_to: snapshot.validTo,
        scope_type: snapshot.scopeType,
        region_code: snapshot.regionCode,
        region_name: snapshot.regionName,
        period_key: snapshot.periodKey,
        headline: snapshot.headline,
        text_weather: snapshot.textWeather,
        text_wind: snapshot.textWind,
        dangerous_phenomena: snapshot.dangerousPhenomena,
        relevant_phenomena: snapshot.relevantPhenomena,
        source_file_name: snapshot.sourceFileName,
        source_url: snapshot.sourceUrl,
        payload_sha256: snapshot.payloadSha256,
        metadata: {
          dataStreamId: snapshot.dataStreamId,
          recordId: snapshot.recordId,
          senderName: snapshot.senderName,
          relevantPhenomenonKeys: snapshot.relevantPhenomena.map(
            (phenomenon) => phenomenon.key,
          ),
        },
      }))
      const { error: upsertError } = await client
        .from('weather_forecast_snapshots')
        .upsert(rows, {
          onConflict: 'payload_sha256,scope_type,region_code,period_key',
        })
      if (upsertError) throw upsertError
      await pruneOldForecasts(client)

      return {
        changed: true,
        sourceRef,
        payloadSha256,
        downloadedFileCount: dataset.downloads.length,
        nationalSnapshotCount,
        regionalSnapshotCount,
        relevantSnapshotCount,
        insertedSnapshotCount: rows.length,
        issuedAt,
        metadata: {
          issuedAt,
          downloadedFileCount: dataset.downloads.length,
          nationalSnapshotCount,
          regionalSnapshotCount,
          relevantSnapshotCount,
          insertedSnapshotCount: rows.length,
        },
      }
    },
  })
}
