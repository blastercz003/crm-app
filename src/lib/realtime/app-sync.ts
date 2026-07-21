export const APP_DATA_CHANGED_EVENT = 'benergy:app-data-changed'

export type AppDataChangeSource = 'broadcast' | 'version_check'

export type AppDataChangedDetail = {
  scope: string
  version: number
  source: AppDataChangeSource
}

type AppDataChangedListener = (detail: AppDataChangedDetail) => void

export function parseAppDataChangedPayload(
  payload: unknown
): Pick<AppDataChangedDetail, 'scope' | 'version'> | null {
  if (!payload || typeof payload !== 'object') return null

  const candidate = payload as Record<string, unknown>
  const scope = candidate.scope
  const version = candidate.version

  if (
    typeof scope !== 'string' ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(scope) ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1
  ) {
    return null
  }

  return { scope, version }
}

export function dispatchAppDataChanged(detail: AppDataChangedDetail) {
  window.dispatchEvent(
    new CustomEvent<AppDataChangedDetail>(APP_DATA_CHANGED_EVENT, { detail })
  )
}

export function subscribeToAppDataChanges(listener: AppDataChangedListener) {
  function handleChange(event: Event) {
    listener((event as CustomEvent<AppDataChangedDetail>).detail)
  }

  window.addEventListener(APP_DATA_CHANGED_EVENT, handleChange)
  return () => window.removeEventListener(APP_DATA_CHANGED_EVENT, handleChange)
}
