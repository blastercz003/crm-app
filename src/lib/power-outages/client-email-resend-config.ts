import 'server-only'

export type ResendConfigurationStatus = {
  apiKeyConfigured: boolean
  sendingDomain: string | null
  domainVerified: boolean
  webhookSecretConfigured: boolean
  providerReady: boolean
  webhookReady: boolean
  issues: string[]
}

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{16,}$/
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{16,}$/

export function getResendConfigurationStatus(): ResendConfigurationStatus {
  const apiKey = process.env.RESEND_API_KEY?.trim() ?? ''
  const rawDomain = process.env.RESEND_SENDING_DOMAIN?.trim().toLowerCase() ?? ''
  const domain = DOMAIN_PATTERN.test(rawDomain) ? rawDomain : null
  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED?.trim().toLowerCase() === 'true'
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? ''

  const apiKeyConfigured = API_KEY_PATTERN.test(apiKey)
  const webhookSecretConfigured = WEBHOOK_SECRET_PATTERN.test(webhookSecret)
  const issues: string[] = []

  if (!apiKeyConfigured) issues.push('Ve Vercelu chybí platný RESEND_API_KEY.')
  if (!domain) issues.push('Ve Vercelu chybí platná RESEND_SENDING_DOMAIN.')
  if (domain && !domainVerified) {
    issues.push('Ověření SPF a DKIM ještě není potvrzeno pomocí RESEND_DOMAIN_VERIFIED=true.')
  }
  if (!webhookSecretConfigured) {
    issues.push('RESEND_WEBHOOK_SECRET bude doplněn po vytvoření webhooku v kroku 6.')
  }

  return {
    apiKeyConfigured,
    sendingDomain: domain,
    domainVerified: Boolean(domain && domainVerified),
    webhookSecretConfigured,
    providerReady: apiKeyConfigured && Boolean(domain) && domainVerified,
    webhookReady: webhookSecretConfigured,
    issues,
  }
}
