export function powerOutageErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>
    const message = typeof value.message === 'string' ? value.message.trim() : ''
    const details = typeof value.details === 'string' ? value.details.trim() : ''
    const hint = typeof value.hint === 'string' ? value.hint.trim() : ''
    const code = typeof value.code === 'string' ? value.code.trim() : ''
    const parts = [message, details, hint].filter(Boolean)
    if (parts.length > 0) {
      return `${code ? `[${code}] ` : ''}${parts.join(' — ')}`
    }
  }
  return fallback
}
