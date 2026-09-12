import 'server-only'

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const API_KEY_PATTERN = /^re_[A-Za-z0-9_-]{16,}$/
const WEBHOOK_SECRET_PATTERN = /^whsec_\S{16,}$/
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function maskEmail(value: string) {
  return value.replace(/^(.)([^@]*)(@.*)$/, (_match, first: string, middle: string, domain: string) =>
    `${first}${middle ? '***' : ''}${domain}`)
}

export function getCompleteNotificationResendConfiguration() {
  const apiKey = process.env.COMPLETE_RESEND_API_KEY?.trim() ?? ''
  const rawDomain = process.env.COMPLETE_RESEND_SENDING_DOMAIN?.trim().toLowerCase() ?? ''
  const sendingDomain = DOMAIN_PATTERN.test(rawDomain) ? rawDomain : null
  const domainVerified = process.env.COMPLETE_RESEND_DOMAIN_VERIFIED?.trim().toLowerCase() === 'true'
  const webhookSecret = process.env.COMPLETE_RESEND_WEBHOOK_SECRET?.trim() ?? ''
  const testRecipient = process.env.COMPLETE_RESEND_TEST_RECIPIENT?.trim().toLowerCase() ?? ''
  const fromEmail = process.env.COMPLETE_RESEND_FROM_EMAIL?.trim().toLowerCase() ?? ''
  const fromName = process.env.COMPLETE_RESEND_FROM_NAME?.trim() || 'B-Energy · plánované odstávky'
  const replyToEmail = process.env.COMPLETE_RESEND_REPLY_TO_EMAIL?.trim().toLowerCase() ?? ''

  const apiKeyConfigured = API_KEY_PATTERN.test(apiKey)
  const webhookSecretPresent = webhookSecret.length > 0
  const webhookSecretConfigured = WEBHOOK_SECRET_PATTERN.test(webhookSecret)
  const testRecipientConfigured = EMAIL_PATTERN.test(testRecipient)
  const fromEmailConfigured = EMAIL_PATTERN.test(fromEmail)
  const fromDomainMatches = Boolean(sendingDomain && fromEmailConfigured && fromEmail.split('@')[1] === sendingDomain)
  const replyToConfigured = !replyToEmail || EMAIL_PATTERN.test(replyToEmail)
  const issues: string[] = []

  if (!apiKeyConfigured) issues.push('Chybí samostatný COMPLETE_RESEND_API_KEY.')
  if (!sendingDomain) issues.push('Chybí platná COMPLETE_RESEND_SENDING_DOMAIN.')
  if (sendingDomain && !domainVerified) issues.push('Doména KOMPLETNI ještě není označena jako ověřená.')
  if (!webhookSecretPresent) issues.push('Chybí samostatný COMPLETE_RESEND_WEBHOOK_SECRET.')
  else if (!webhookSecretConfigured) issues.push('COMPLETE_RESEND_WEBHOOK_SECRET nemá očekávaný formát whsec_...')
  if (!testRecipientConfigured) issues.push('Chybí platná interní COMPLETE_RESEND_TEST_RECIPIENT.')
  if (!fromEmailConfigured) issues.push('Chybí platná COMPLETE_RESEND_FROM_EMAIL.')
  if (fromEmailConfigured && !fromDomainMatches) issues.push('Odesílatel nepatří do domény KOMPLETNI.')
  if (!replyToConfigured) issues.push('COMPLETE_RESEND_REPLY_TO_EMAIL není platný e-mail.')

  return {
    apiKey,
    webhookSecret,
    testRecipient,
    fromEmail,
    fromName,
    replyToEmail: replyToEmail || null,
    apiKeyConfigured,
    sendingDomain,
    domainVerified: Boolean(sendingDomain && domainVerified),
    webhookSecretPresent,
    webhookSecretConfigured,
    testRecipientConfigured,
    testRecipientMasked: testRecipientConfigured ? maskEmail(testRecipient) : null,
    fromEmailConfigured,
    fromDomainMatches,
    replyToConfigured,
    testReady: apiKeyConfigured && Boolean(sendingDomain) && domainVerified
      && webhookSecretConfigured && testRecipientConfigured
      && fromEmailConfigured && fromDomainMatches && replyToConfigured,
    issues,
  }
}
