type SupabaseBatchError = {
  message: string
}

type SupabaseBatchResult<Row> = {
  data: Row[] | null
  error: SupabaseBatchError | null
}

type QueryBatch<Row> = (
  values: string[]
) => PromiseLike<SupabaseBatchResult<Row>>

const DEFAULT_BATCH_SIZE = 100
const TRANSIENT_RETRY_DELAY_MS = 250

function splitIntoBatches<T>(items: T[], batchSize: number) {
  const batches: T[][] = []

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize))
  }

  return batches
}

function isTransientFetchError(error: SupabaseBatchError | null) {
  return /fetch failed|network|econnreset|socket/i.test(error?.message ?? '')
}

function wait(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

export async function querySupabaseInBatches<Row>({
  values,
  queryBatch,
  batchSize = DEFAULT_BATCH_SIZE,
}: {
  values: string[]
  queryBatch: QueryBatch<Row>
  batchSize?: number
}): Promise<SupabaseBatchResult<Row>> {
  const rows: Row[] = []

  for (const batch of splitIntoBatches(values, batchSize)) {
    let response = await queryBatch(batch)

    if (response.error && isTransientFetchError(response.error)) {
      await wait(TRANSIENT_RETRY_DELAY_MS)
      response = await queryBatch(batch)
    }

    if (response.error) {
      return { data: null, error: response.error }
    }

    rows.push(...(response.data ?? []))
  }

  return { data: rows, error: null }
}
