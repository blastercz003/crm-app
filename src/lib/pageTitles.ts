export const APP_TITLE = 'B-ENERGY APP'

export function buildPageTitle(title: string) {
  return `${title} | ${APP_TITLE}`
}

export function cleanTitlePart(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function joinTitleParts(...parts: Array<string | null | undefined>) {
  return parts.map(cleanTitlePart).filter(Boolean).join(' - ')
}
