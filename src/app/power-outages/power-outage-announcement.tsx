export type PowerOutageAnnouncementField = {
  label: string
  value: string
}

export type PowerOutageAnnouncementData = {
  fields: PowerOutageAnnouncementField[]
  period: string
}

const TITLE = 'Upozornění na plánovanou odstávku a nabídka náhradního zdroje'
const INTRO = 'Podle zveřejněných informací distributora je na níže uvedené adrese plánována odstávka elektrické energie, která se může týkat Vaší firmy nebo provozovny.'
const OFFER = 'Aby odstávka neomezila provoz Vaší společnosti, můžeme Vám na uvedený termín zajistit vhodný náhradní zdroj elektrické energie, včetně dopravy, zapojení a technického zajištění.'
const FOLLOW_UP = 'V případě zájmu Vám rádi připravíme nezávazný návrh řešení podle požadovaného výkonu a potřeb Vašeho provozu.'
const CONTACT = 'Pro ověření dostupnosti náhradního zdroje nás prosím kontaktujte odpovědí na tuto zprávu.'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function buildPowerOutageAnnouncement(data: PowerOutageAnnouncementData) {
  const fieldText = data.fields.map((field) => `${field.label}: ${field.value}`).join('\n')
  const plainText = `${TITLE}

Dobrý den,

${INTRO}

${fieldText}
Termín: ${data.period}

${OFFER}

${FOLLOW_UP}

${CONTACT}

S pozdravem
B-ENERGY`

  const htmlFields = data.fields
    .map((field) => `<strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(field.value)}`)
    .join('<br>')
  const html = `<p><strong>${escapeHtml(TITLE)}</strong></p><p>Dobrý den,</p><p>${escapeHtml(INTRO)}</p><p>${htmlFields}<br><strong>Termín: ${escapeHtml(data.period)}</strong></p><p><strong>${escapeHtml(OFFER)}</strong></p><p>${escapeHtml(FOLLOW_UP)}</p><p>${escapeHtml(CONTACT)}</p><p>S pozdravem<br><strong>B-ENERGY</strong></p>`

  return { plainText, html }
}

export async function copyPowerOutageAnnouncement(data: PowerOutageAnnouncementData) {
  const announcement = buildPowerOutageAnnouncement(data)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/plain': new Blob([announcement.plainText], { type: 'text/plain' }),
        'text/html': new Blob([announcement.html], { type: 'text/html' }),
      })])
      return
    } catch {
      // Některé cílové aplikace nepovolí HTML clipboard; prostý text zůstává bezpečný fallback.
    }
  }
  await navigator.clipboard.writeText(announcement.plainText)
}

export function PowerOutageAnnouncementPreview({ data }: { data: PowerOutageAnnouncementData }) {
  return <div className="space-y-4 font-sans text-xs leading-6 text-[var(--text-primary)] sm:text-sm">
    <p className="font-bold">{TITLE}</p>
    <p>Dobrý den,</p>
    <p>{INTRO}</p>
    <div>
      {data.fields.map((field) => <p key={field.label}><strong>{field.label}:</strong> {field.value}</p>)}
      <p className="font-bold">Termín: {data.period}</p>
    </div>
    <p className="font-bold">{OFFER}</p>
    <p>{FOLLOW_UP}</p>
    <p>{CONTACT}</p>
    <p>S pozdravem<br /><strong>B-ENERGY</strong></p>
  </div>
}
