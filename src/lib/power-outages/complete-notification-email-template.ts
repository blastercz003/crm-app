export const COMPLETE_NOTIFICATION_EMAIL_TEMPLATE_VERSION = 'complete-notification-email-template-v1'
export const COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID = 'b-energy-logo'

type AddressSnapshot = {
  municipality?: unknown
  street?: unknown
  houseNumber?: unknown
  orientationNumber?: unknown
  postalCode?: unknown
  rawAddress?: unknown
}

export type CompleteNotificationEmailTemplateInput = {
  companyName: string
  startsAt: string
  endsAt: string
  source: string
  municipality?: string | null
  addresses: unknown[]
  announcementUrl?: string | null
  sourceUrl?: string | null
  unsubscribeUrl?: string | null
  testMode?: boolean
}

export type CompleteNotificationEmailTemplate = {
  subject: string
  html: string
  text: string
  templateVersion: typeof COMPLETE_NOTIFICATION_EMAIL_TEMPLATE_VERSION
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  weekday: 'long',
})

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function safeHttpsUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function dateValue(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Odstávka nemá platný termín.')
  return date
}

function formatCompactDate(value: Date) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('day')}.${part('month')}.${part('year')}`
}

function formatCompactTime(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${Number(part('hour'))}:${part('minute')}`
}

function formatPeriod(startsAt: string, endsAt: string) {
  const start = dateValue(startsAt)
  const end = dateValue(endsAt)
  const startDate = formatCompactDate(start)
  const endDate = formatCompactDate(end)
  const startLabel = `${WEEKDAY_FORMATTER.format(start)} ${startDate} od ${formatCompactTime(start)}`
  return startDate === endDate
    ? `${startLabel} do ${formatCompactTime(end)}`
    : `${startLabel} do ${WEEKDAY_FORMATTER.format(end)} ${endDate} ${formatCompactTime(end)}`
}

function addressLabel(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const address = value as AddressSnapshot
  const rawAddress = stringValue(address.rawAddress)
  if (rawAddress) return rawAddress
  const number = [stringValue(address.houseNumber), stringValue(address.orientationNumber)]
    .filter(Boolean)
    .join('/')
  const streetLine = [stringValue(address.street), number].filter(Boolean).join(' ')
  const municipalityLine = [stringValue(address.postalCode), stringValue(address.municipality)]
    .filter(Boolean)
    .join(' ')
  return [streetLine, municipalityLine].filter(Boolean).join(', ') || null
}

function uniqueAddresses(addresses: unknown[], municipality: string | null | undefined) {
  const labels = addresses.map(addressLabel).filter((value): value is string => Boolean(value))
  if (labels.length === 0 && municipality?.trim()) labels.push(municipality.trim())
  return [...new Set(labels)]
}

export function buildCompleteNotificationUnsubscribeUrl(publicBaseUrl: string, token: string) {
  const baseUrl = safeHttpsUrl(publicBaseUrl)
  if (!baseUrl) throw new Error('Veřejná adresa aplikace pro odhlášení musí používat HTTPS.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    throw new Error('Odhlašovací token nemá platný formát UUID.')
  }
  return new URL(
    `/api/power-outages/complete/notification-emails/unsubscribe/${encodeURIComponent(token)}`,
    baseUrl,
  ).toString()
}

export function renderCompleteNotificationEmail(
  input: CompleteNotificationEmailTemplateInput,
): CompleteNotificationEmailTemplate {
  const companyName = input.companyName.trim()
  if (!companyName) throw new Error('Pro e-mail chybí název firmy.')
  const period = formatPeriod(input.startsAt, input.endsAt)
  const subject = `Plánovaná odstávka elektřiny na ${formatCompactDate(dateValue(input.startsAt))}.`
  const addresses = uniqueAddresses(input.addresses, input.municipality)
  const addressLines = addresses.length > 0 ? addresses : ['Adresa není v oznámení uvedena']
  const announcementUrl = safeHttpsUrl(input.announcementUrl)
  const sourceUrl = safeHttpsUrl(input.sourceUrl)
  const actionUrl = announcementUrl ?? sourceUrl
  const unsubscribeUrl = input.testMode ? null : safeHttpsUrl(input.unsubscribeUrl)
  if (!input.testMode && !unsubscribeUrl) {
    throw new Error('Ostrá šablona musí obsahovat platný HTTPS odhlašovací odkaz.')
  }

  const addressHtml = addressLines
    .map((address) => `<div style="margin-top:5px;color:#475569;font-size:14px;line-height:1.55">${escapeHtml(address)}</div>`)
    .join('')
  const testBanner = input.testMode
    ? '<tr><td style="padding:16px 34px;background:#f5f3ff;border-bottom:1px solid #ddd6fe;color:#5b21b6;font-size:12px;line-height:1.5"><strong>TEST KOMPLETNÍ · FIRMA NIC NEOBDRŽÍ</strong><br>Toto je interní náhled finální šablony.</td></tr>'
    : ''
  const actionHtml = actionUrl
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:26px;border-collapse:collapse"><tr><td><a href="${escapeHtml(actionUrl)}" style="display:block;padding:14px 18px;border-radius:10px;background:#0788c1;color:#ffffff;text-align:center;text-decoration:none;font-size:14px;font-weight:700">${announcementUrl ? 'Otevřít oznámení distributora' : 'Otevřít zdroj odstávky'}</a></td></tr></table>`
    : ''
  const secondaryLinkHtml = announcementUrl && sourceUrl
    ? `<p style="margin:12px 0 0;text-align:center"><a href="${escapeHtml(sourceUrl)}" style="color:#64748b;font-size:12px">Otevřít zdroj odstávky</a></p>`
    : ''
  const unsubscribeHtml = input.testMode
    ? '<span style="color:#94a3b8;text-decoration:underline">kdykoliv jednorázově odhlásit z jejich odběru</span><br><span style="font-size:10px;color:#94a3b8">V TEST režimu není odhlašovací odkaz aktivní.</span>'
    : `<a href="${escapeHtml(unsubscribeUrl!)}" style="color:#64748b;text-decoration:underline">kdykoliv jednorázově odhlásit z jejich odběru</a>`

  const introHtml = `<p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#475569">Dobrý den,<br>podle veřejně dostupných údajů distributora je na níže uvedené adrese, kterou může být dotčena společnost <strong>${escapeHtml(companyName)}</strong>, plánována odstávka elektrické energie.</p>`
  const addressBlockHtml = `<div style="margin:16px 0 0;padding:15px 17px;border-radius:12px;background:#f8fafc"><strong style="display:block;color:#18212f;font-size:15px">${escapeHtml(companyName)}</strong>${addressHtml}</div>`
  const impactHtml = '<p style="margin:18px 0 0;font-size:15px;line-height:1.7;color:#475569">Informaci Vám zasíláme, abyste mohli včas ověřit její případný dopad na provoz společnosti a přijmout potřebná opatření.</p>'
  const periodHtml = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:24px;border-collapse:collapse;border-top:1px solid #e8edf2"><tr><td style="padding:17px 0;border-bottom:1px solid #e8edf2;color:#64748b;font-size:13px">Termín</td><td align="right" style="padding:17px 0;border-bottom:1px solid #e8edf2;font-size:15px;font-weight:700;color:#111827">${escapeHtml(period)}</td></tr></table>`
  const offerHtml = '<div style="margin:26px 0 0;padding:19px 20px;border:1px solid #bae6fd;border-radius:14px;background:#f0f9ff;color:#334155;font-size:15px;line-height:1.7"><p style="margin:0"><strong style="color:#0f172a">V případě potřeby Vám můžeme zajistit náhradní napájení pomocí záložního zdroje elektrické energie.</strong></p><p style="margin:16px 0 0">Zajišťujeme <strong>pronájem elektrocentrál včetně kompletní služby na klíč</strong> – od návrhu vhodného výkonu, dopravy, instalaci a uvedení agregátu do provozu, nepřetržité obsluhy a jeho následný odvoz.</p><p style="margin:16px 0 0">Pokud potřebujete zajistit provoz společnosti i během plánované odstávky, <strong style="color:#0f172a">stačí odpovědět na tento e-mail.</strong> Prověříme možnosti řešení pro konkrétní místo a termín.</p></div>'
  const explanationHtml = `Víme, že firemní schránky dostávají velké množství zpráv. Toto upozornění Vám proto zasíláme pouze v souvislosti s veřejně oznámenou plánovanou odstávkou elektrické energie na adrese Vaší společnosti a věříme, že pro Vás může být praktickou informací.<br><br>Zpráva byla odeslána na veřejně dostupný firemní kontakt. Nejedná se o potvrzení objednávky, zakázky ani jiného smluvního vztahu.<br><br>Pokud podobná provozní upozornění nechcete dostávat, můžete se ${unsubscribeHtml}.`

  const headerHtml = `<tr><td style="padding:30px 34px 26px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse"><tr><td valign="middle"><img src="cid:${COMPLETE_NOTIFICATION_EMAIL_LOGO_CONTENT_ID}" width="136" alt="B-ENERGY" style="display:block;width:136px;max-width:100%;height:auto;border:0"></td><td align="right" valign="middle"><span style="display:inline-block;padding:7px 11px;border:1px solid #bae6fd;border-radius:999px;background:#f0f9ff;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:.04em">PROVOZNÍ OZNÁMENÍ</span></td></tr></table></td></tr><tr><td style="padding:0 34px"><div style="height:1px;background:#e8edf2"></div></td></tr>`
  const contentHtml = `<tr><td style="padding:34px 34px 32px"><div style="margin-bottom:11px;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Plánovaná odstávka elektřiny</div><h1 style="margin:0;font-size:28px;line-height:1.28;letter-spacing:-.02em;color:#111827">Upozornění pro ${escapeHtml(companyName)}</h1>${introHtml}${addressBlockHtml}${impactHtml}${periodHtml}${offerHtml}${actionHtml}${secondaryLinkHtml}<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#18212f">S pozdravem<br><strong>B-ENERGY</strong></p></td></tr>`
  const footerHtml = `<tr><td style="padding:20px 34px;background:#fafbfc;border-top:1px solid #e8edf2;color:#7c8798;font-size:11px;line-height:1.65"><strong style="color:#64748b">Proč Vám píšeme?</strong><br>${explanationHtml}</td></tr>`
  const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#18212f"><div style="display:none;max-height:0;overflow:hidden;color:transparent">Provozní upozornění na plánovanou odstávku elektřiny ${escapeHtml(period)}.</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#f4f6f8"><tr><td align="center" style="padding:40px 16px"><table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;border-collapse:separate;background:#ffffff;border:1px solid #e4e9ef;border-radius:18px;overflow:hidden">${testBanner}${headerHtml}${contentHtml}${footerHtml}</table></td></tr></table></body></html>`

  const text = [
    'PLÁNOVANÁ ODSTÁVKA ELEKTŘINY',
    `Upozornění pro ${companyName}`,
    '',
    'Dobrý den,',
    `podle veřejně dostupných údajů distributora je na níže uvedené adrese, kterou může být dotčena společnost ${companyName}, plánována odstávka elektrické energie.`,
    '',
    companyName,
    ...addressLines,
    '',
    'Informaci Vám zasíláme, abyste mohli včas ověřit její případný dopad na provoz společnosti a přijmout potřebná opatření.',
    '',
    `Termín: ${period}`,
    '',
    'V případě potřeby Vám můžeme zajistit náhradní napájení pomocí záložního zdroje elektrické energie.',
    'Zajišťujeme pronájem elektrocentrál včetně kompletní služby na klíč – od návrhu vhodného výkonu, dopravy, instalaci a uvedení agregátu do provozu, nepřetržité obsluhy a jeho následný odvoz.',
    '',
    'Pokud potřebujete zajistit provoz společnosti i během plánované odstávky, stačí odpovědět na tento e-mail. Prověříme možnosti řešení pro konkrétní místo a termín.',
    ...(announcementUrl ? ['', `Oznámení distributora: ${announcementUrl}`] : []),
    ...(sourceUrl ? [`Zdroj odstávky: ${sourceUrl}`] : []),
    '',
    'S pozdravem',
    'B-ENERGY',
    '',
    'Proč Vám píšeme?',
    'Víme, že firemní schránky dostávají velké množství zpráv. Toto upozornění Vám proto zasíláme pouze v souvislosti s veřejně oznámenou plánovanou odstávkou elektrické energie na adrese Vaší společnosti a věříme, že pro Vás může být praktickou informací.',
    '',
    'Zpráva byla odeslána na veřejně dostupný firemní kontakt. Nejedná se o potvrzení objednávky, zakázky ani jiného smluvního vztahu.',
    '',
    input.testMode
      ? 'Pokud podobná provozní upozornění nechcete dostávat, můžete se kdykoliv jednorázově odhlásit z jejich odběru. V TEST režimu není odhlašovací odkaz aktivní.'
      : `Pokud podobná provozní upozornění nechcete dostávat, můžete se kdykoliv jednorázově odhlásit z jejich odběru: ${unsubscribeUrl}`,
  ].join('\n')

  return { subject, html, text, templateVersion: COMPLETE_NOTIFICATION_EMAIL_TEMPLATE_VERSION }
}
