'use client'

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  History,
  LoaderCircle,
  LockKeyhole,
  MailCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import type {
  MarketClientEmailAdminWorkspace,
  MarketClientEmailConfiguration,
  MarketClientEmailDelivery,
  MarketClientEmailMode,
  MarketClientEmailRecipient,
} from '@/lib/power-outages/types'
import {
  getMarketClientEmailAdminWorkspaceAction,
  refreshMarketClientEmailShadowAction,
  retryMarketClientEmailDeliveryAction,
  saveMarketClientEmailConfigurationAction,
  sendMarketClientEmailTestAction,
  setMarketClientEmailShadowRuleAction,
  setMarketClientEmailTestModeAction,
  skipMarketClientEmailDeliveryAction,
} from './actions'
import { PowerOutagePopupShell } from './power-outage-popups'

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const MODE_PRESENTATION: Record<MarketClientEmailMode, { label: string; className: string; dot: string }> = {
  disabled: { label: 'VYPNUTO', className: 'border-slate-400/35 bg-slate-400/10 text-[var(--text-secondary)]', dot: 'bg-slate-400' },
  shadow: { label: 'STÍNOVÝ', className: 'border-sky-500/35 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'bg-sky-500' },
  test: { label: 'TEST', className: 'border-violet-500/35 bg-violet-500/10 text-violet-700 [html[data-theme=dark]_&]:text-violet-300', dot: 'bg-violet-500' },
  live: { label: 'AKTIVNÍ', className: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' },
}

const EVENT_LABELS = {
  new_outage: 'Nová potvrzená odstávka',
  schedule_changed: 'Změna termínu',
  cancelled: 'Zrušení odstávky',
  reminder_24h: 'Připomenutí před začátkem',
} as const

const DELIVERY_LABELS: Record<MarketClientEmailDelivery['status'], string> = {
  planned: 'Připraveno',
  queued: 'Ve frontě',
  sending: 'Odesílání',
  sent: 'Odesláno',
  delivered: 'Doručeno',
  bounced: 'Nedoručeno',
  complained: 'Stížnost',
  failed: 'Chyba',
  skipped: 'Přeskočeno',
  cancelled: 'Zrušeno',
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMATTER.format(date)
}

function ModeBadge({ mode }: { mode: MarketClientEmailMode }) {
  const presentation = MODE_PRESENTATION[mode]
  return (
    <span className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-[8px] font-bold leading-none tracking-[0.06em] ${presentation.className}`}>
      <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
      <span>{presentation.label}</span>
    </span>
  )
}

function Toggle({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className={`relative h-7 w-12 shrink-0 rounded-full border transition ${checked ? 'border-sky-500 bg-sky-500' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'} disabled:cursor-not-allowed disabled:opacity-50`}>
      <span className={`absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

function LoadingBlock({ label }: { label: string }) {
  return <div className="flex min-h-[150px] items-center justify-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]"><LoaderCircle aria-hidden size={17} className="animate-spin text-[var(--accent)]" />{label}</div>
}

function ResendSetupStatus({ workspace }: { workspace: MarketClientEmailAdminWorkspace }) {
  const items = [
    { label: 'Omezený API klíč', ready: workspace.resend.apiKeyConfigured, waiting: false, step: null },
    { label: workspace.resend.sendingDomain ?? 'Odesílací doména', ready: Boolean(workspace.resend.sendingDomain), waiting: false, step: null },
    { label: 'SPF a DKIM ověřeno', ready: workspace.resend.domainVerified, waiting: false, step: null },
    { label: 'Webhookový podpis', ready: workspace.resend.webhookSecretConfigured, waiting: !workspace.resend.webhookSecretConfigured, step: 'krok 6' },
    { label: workspace.resend.testRecipientMasked ? `Test: ${workspace.resend.testRecipientMasked}` : 'Testovací příjemce', ready: workspace.resend.testRecipientConfigured, waiting: !workspace.resend.testRecipientConfigured, step: 'krok 7' },
  ]

  return (
    <section className="mb-4 rounded-2xl border border-violet-400/25 bg-violet-500/8 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span>
          <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Poskytovatel e-mailů</span>
          <strong className="mt-1 block text-sm text-[var(--text-primary)]">Resend</strong>
        </span>
        <span className={`rounded-xl border px-3 py-1.5 text-[8px] font-bold uppercase ${workspace.resend.providerReady ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300' : 'border-amber-400/35 bg-amber-500/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'}`}>{workspace.resend.providerReady ? 'Doména připravena' : 'Vyžaduje nastavení'}</span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => <div key={item.label} className="flex min-h-9 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 py-2">{item.ready ? <CheckCircle2 aria-hidden size={14} className="shrink-0 text-emerald-500" /> : item.waiting ? <LockKeyhole aria-hidden size={14} className="shrink-0 text-[var(--text-secondary)]" /> : <XCircle aria-hidden size={14} className="shrink-0 text-amber-500" />}<span className="text-[8px] font-semibold text-[var(--text-primary)]">{item.label}</span>{item.waiting && item.step ? <small className="ml-auto text-[7px] text-[var(--text-secondary)]">{item.step}</small> : null}</div>)}
      </div>
      {workspace.resend.issues.length > 0 ? <div className="mt-3 space-y-1">{workspace.resend.issues.map((issue) => <p key={issue} className="text-[8px] leading-4 text-[var(--text-secondary)]">• {issue}</p>)}</div> : null}
      <p className="mt-3 flex items-start gap-2 text-[8px] leading-4 text-[var(--text-secondary)]"><ShieldCheck aria-hidden size={13} className="mt-0.5 shrink-0 text-emerald-500" /> Tajné hodnoty zůstávají pouze v serverových proměnných Vercelu. Administrace zobrazuje jen jejich platnost.</p>
    </section>
  )
}

function ClientEditor({
  client,
  workspace,
  onWorkspaceChange,
}: {
  client: MarketClientEmailConfiguration
  workspace: MarketClientEmailAdminWorkspace
  onWorkspaceChange: (workspace: MarketClientEmailAdminWorkspace) => void
}) {
  const [mode, setMode] = useState(client.mode)
  const [fromName, setFromName] = useState(client.fromName)
  const [fromEmail, setFromEmail] = useState(client.fromEmail)
  const [replyToEmail, setReplyToEmail] = useState(client.replyToEmail)
  const [recipients, setRecipients] = useState(client.recipients)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    setMode(client.mode)
    setFromName(client.fromName)
    setFromEmail(client.fromEmail)
    setReplyToEmail(client.replyToEmail)
    setRecipients(client.recipients)
  }, [client])

  const updateRecipient = (id: string, patch: Partial<MarketClientEmailRecipient>) => {
    setRecipients((current) => current.map((recipient) => recipient.id === id ? { ...recipient, ...patch } : recipient))
  }

  const addRecipient = () => {
    setRecipients((current) => [
      ...current,
      { id: `draft-${Date.now()}-${current.length}`, kind: 'to', name: '', email: '', isActive: true },
    ])
  }

  const save = () => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await saveMarketClientEmailConfigurationAction({
        clientId: client.clientId,
        mode,
        fromName,
        fromEmail,
        replyToEmail,
        recipients: recipients.map(({ kind, name, email, isActive }) => ({ kind, name, email, isActive })),
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage('Konfigurace byla bezpečně uložena. Odesílání zůstává globálně vypnuté.')
    })
  }

  const mutateDelivery = (deliveryId: string, operation: 'retry' | 'skip') => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = operation === 'retry'
        ? await retryMarketClientEmailDeliveryAction(deliveryId)
        : await skipMarketClientEmailDeliveryAction(deliveryId)
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage(operation === 'retry' ? 'Zpráva byla vrácena do fronty.' : 'Zpráva byla ručně přeskočena.')
    })
  }

  const toggleShadowRule = (
    eventKind: 'new_outage' | 'schedule_changed' | 'cancelled',
    enabled: boolean,
  ) => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await setMarketClientEmailShadowRuleAction({
        clientId: client.clientId,
        eventKind,
        enabled,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage(enabled
        ? 'Stínové pravidlo bylo spuštěno. Sleduje pouze nové události od tohoto okamžiku.'
        : 'Stínové pravidlo bylo zastaveno.')
    })
  }

  const refreshShadow = () => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await refreshMarketClientEmailShadowAction()
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage('Stínové náhledy byly obnoveny. Nebyl odeslán žádný e-mail.')
    })
  }

  const toggleTestMode = () => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const enabling = client.mode !== 'test'
      const result = await setMarketClientEmailTestModeAction({
        clientId: client.clientId,
        enabled: enabling,
      })
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage(enabling
        ? `TEST je aktivní. Veškeré zprávy dostane pouze ${result.workspace.resend.testRecipientMasked ?? 'interní testovací adresa'}.`
        : 'TEST byl ukončen. Neodeslané testovací položky byly zrušeny a odesílání je vypnuté.')
    })
  }

  const sendTestEmail = () => {
    setMessage(null)
    setError(null)
    startTransition(async () => {
      const result = await sendMarketClientEmailTestAction(client.clientId)
      if (!result.success) {
        setError(result.error)
        return
      }
      onWorkspaceChange(result.workspace)
      setMessage(`Kontrolní e-mail byl bezpečně zařazen pro ${result.workspace.resend.testRecipientMasked ?? 'interní testovací adresu'}. Stav odeslání a doručení se doplní z Resendu.`)
    })
  }

  const failedDeliveries = client.deliveries.filter((delivery) => delivery.status === 'failed')

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-sky-500/25 bg-sky-500/8 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Automatická upozornění</span>
            <strong className="mt-1 block text-sm text-[var(--text-primary)]">{mode === 'disabled' ? 'Vypnutá' : mode === 'test' ? 'Bezpečný test na interní adresu' : 'Připravují se ve stínovém režimu'}</strong>
          </div>
          <Toggle checked={mode !== 'disabled'} disabled={pending || !['disabled', 'shadow'].includes(mode)} label="Automatická e-mailová upozornění" onChange={() => setMode((current) => current === 'disabled' ? 'shadow' : 'disabled')} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['disabled', 'shadow', 'test', 'live'] as const).map((option) => {
            const locked = option === 'test' || option === 'live'
            return <button key={option} type="button" disabled={locked || pending} onClick={() => setMode(option)} className={`relative flex h-10 items-center justify-center gap-1.5 rounded-xl border text-[8px] font-bold tracking-[0.05em] transition ${mode === option ? MODE_PRESENTATION[option].className : 'border-[var(--surface-border)] bg-[var(--surface-strong)] text-[var(--text-secondary)]'} disabled:cursor-not-allowed disabled:opacity-55`}><i aria-hidden className={`h-1.5 w-1.5 rounded-full ${MODE_PRESENTATION[option].dot}`} />{MODE_PRESENTATION[option].label}{locked ? <LockKeyhole aria-hidden size={10} /> : null}</button>
          })}
        </div>
        <p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">TEST se aktivuje samostatným bezpečnostním krokem níže. Režim AKTIVNÍ zůstává uzamčený do ostrého pilotu.</p>
      </section>

      <section className="rounded-2xl border border-violet-500/25 bg-violet-500/8 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Bezpečný testovací režim</span>
            <strong className="mt-1 block text-sm text-[var(--text-primary)]">{client.mode === 'test' ? 'TEST je aktivní' : 'TEST není aktivní'}</strong>
          </span>
          <button type="button" onClick={toggleTestMode} disabled={pending || (!workspace.resend.testReady && client.mode !== 'test') || !['shadow', 'test'].includes(client.mode)} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-[8px] font-bold uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${client.mode === 'test' ? 'border-red-400/30 bg-red-500/8 text-red-700 [html[data-theme=dark]_&]:text-red-300' : 'border-violet-500/35 bg-violet-500/10 text-violet-700 [html[data-theme=dark]_&]:text-violet-300'}`}>{pending ? <LoaderCircle aria-hidden size={13} className="animate-spin" /> : client.mode === 'test' ? <Ban aria-hidden size={13} /> : <ShieldCheck aria-hidden size={13} />}{client.mode === 'test' ? 'Ukončit TEST' : 'Spustit TEST'}</button>
        </div>
        <p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">V TESTU se původní TO ani CC nikdy nepoužijí k doručení. Vše dostane pouze {workspace.resend.testRecipientMasked ?? 'serverová adresa RESEND_TEST_RECIPIENT'}. Současně lze testovat jen jednoho klienta.</p>
        {client.mode !== 'test' && client.mode !== 'shadow' ? <p className="mt-2 text-[8px] font-semibold text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Nejprve vyplňte konfiguraci, uložte klienta ve STÍNOVÉM režimu a spusťte pravidlo.</p> : null}
      </section>

      <section>
        <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Odesílatel</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">Zobrazované jméno<input value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Vaše firma · Odstávky" className="mt-1 h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[11px] font-medium normal-case tracking-normal text-[var(--text-primary)] outline-none transition focus:border-sky-400" /></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">Odesílací adresa<input type="email" value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} placeholder="odstavky@firma.cz" className="mt-1 h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[11px] font-medium normal-case tracking-normal text-[var(--text-primary)] outline-none transition focus:border-sky-400" /></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)] sm:col-span-2">Odpovědní adresa (Reply-To)<input type="email" value={replyToEmail} onChange={(event) => setReplyToEmail(event.target.value)} placeholder="kontakt@firma.cz" className="mt-1 h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[11px] font-medium normal-case tracking-normal text-[var(--text-primary)] outline-none transition focus:border-sky-400" /></label>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><Users aria-hidden size={14} /> Výslovně vybraní příjemci</h3><button type="button" onClick={addRecipient} disabled={pending || recipients.length >= 25} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/10 px-3 text-[8px] font-bold uppercase text-sky-700 transition hover:-translate-y-px disabled:opacity-50 [html[data-theme=dark]_&]:text-sky-300"><Plus aria-hidden size={12} /> Přidat</button></div>
        <p className="mt-1 text-[8px] leading-4 text-[var(--text-secondary)]">Kontakty klienta se nepřebírají automaticky. Do notifikací vstupují pouze aktivní adresy uvedené zde.</p>
        <div className="mt-2 space-y-2">
          {recipients.length === 0 ? <div className="rounded-2xl border border-dashed border-[var(--surface-border)] p-4 text-center text-[9px] text-[var(--text-secondary)]">Zatím není vybrán žádný příjemce.</div> : recipients.map((recipient) => (
            <div key={recipient.id} className="grid gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-2.5 sm:grid-cols-[72px_1fr_1.35fr_auto_auto] sm:items-center">
              <select value={recipient.kind} onChange={(event) => updateRecipient(recipient.id, { kind: event.target.value as 'to' | 'cc' })} className="h-9 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[9px] font-bold text-[var(--text-primary)]"><option value="to">TO</option><option value="cc">CC</option></select>
              <input value={recipient.name} onChange={(event) => updateRecipient(recipient.id, { name: event.target.value })} placeholder="Jméno" className="h-9 min-w-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2.5 text-[10px] text-[var(--text-primary)] outline-none focus:border-sky-400" />
              <input type="email" value={recipient.email} onChange={(event) => updateRecipient(recipient.id, { email: event.target.value })} placeholder="email@klient.cz" className="h-9 min-w-0 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2.5 text-[10px] text-[var(--text-primary)] outline-none focus:border-sky-400" />
              <label className="flex items-center justify-center gap-1.5 text-[8px] font-bold uppercase text-[var(--text-secondary)]"><input type="checkbox" checked={recipient.isActive} onChange={(event) => updateRecipient(recipient.id, { isActive: event.target.checked })} className="h-4 w-4 accent-sky-500" /> Aktivní</label>
              <button type="button" onClick={() => setRecipients((current) => current.filter((item) => item.id !== recipient.id))} aria-label="Odstranit příjemce" className="flex h-9 w-9 items-center justify-center rounded-xl border border-red-400/25 bg-red-500/8 text-red-600 transition hover:bg-red-500/15 [html[data-theme=dark]_&]:text-red-300"><Trash2 aria-hidden size={14} /></button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex flex-wrap items-center justify-between gap-2"><span><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Pravidla a podmínky</h3><p className="mt-1 text-[8px] leading-4 text-[var(--text-secondary)]">Aktivace začíná sledovat pouze události vzniklé od daného okamžiku.</p></span><button type="button" onClick={refreshShadow} disabled={pending || workspace.runtimeMode === 'disabled'} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/10 px-3 text-[8px] font-bold uppercase text-sky-700 disabled:opacity-50 [html[data-theme=dark]_&]:text-sky-300"><RefreshCw aria-hidden size={12} className={pending ? 'animate-spin' : ''} /> Obnovit náhledy</button></div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(EVENT_LABELS) as Array<keyof typeof EVENT_LABELS>).map((eventKind) => {
            const rule = client.rules.find((item) => item.eventKind === eventKind)
            const supported = eventKind !== 'reminder_24h'
            return <div key={eventKind} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-start justify-between gap-2"><span><strong className="text-[10px] text-[var(--text-primary)]">{EVENT_LABELS[eventKind]}</strong><small className="mt-1 block text-[7px] text-[var(--text-secondary)]">{rule?.enabled ? `Sleduje se od ${formatDateTime(rule.activatedAt)}` : supported ? 'Zatím se nesleduje' : 'Čas připomínky nastavíme později'}</small></span><button type="button" disabled={pending || !supported || client.mode !== 'shadow'} onClick={() => supported && toggleShadowRule(eventKind, !(rule?.enabled ?? false))} className={`shrink-0 rounded-lg border px-2 py-1 text-[7px] font-bold uppercase transition disabled:cursor-not-allowed disabled:opacity-50 ${rule?.enabled ? 'border-red-400/25 bg-red-500/8 text-red-700 [html[data-theme=dark]_&]:text-red-300' : 'border-sky-400/30 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'}`}>{rule?.enabled ? 'Zastavit' : supported ? 'Spustit stínově' : 'Později'}</button></div></div>
          })}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Historie zpráv</h3><span className="text-[8px] text-[var(--text-secondary)]">{client.deliveries.length} záznamů</span></div>
        {client.deliveries.length === 0 ? <div className="mt-2 rounded-2xl border border-dashed border-[var(--surface-border)] p-4 text-center text-[9px] text-[var(--text-secondary)]">Zatím nevznikla žádná e-mailová zpráva. Po spuštění pravidla se vytvoří pouze pro nové události.</div> : <div className="mt-2 space-y-2">{client.deliveries.slice(0, 20).map((delivery) => <div key={delivery.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><span><strong className="block text-[10px] text-[var(--text-primary)]">{delivery.subject || EVENT_LABELS[delivery.eventKind]}</strong><small className="mt-1 block text-[8px] text-[var(--text-secondary)]">{formatDateTime(delivery.deliveredAt ?? delivery.sentAt ?? delivery.createdAt)} · {delivery.recipients.join(', ') || 'bez příjemce'} · {delivery.stores.length} prodejen</small></span><span className={`rounded-lg px-2 py-1 text-[7px] font-bold uppercase ${delivery.status === 'failed' || delivery.status === 'bounced' || delivery.status === 'complained' ? 'bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300' : 'bg-slate-400/10 text-[var(--text-secondary)]'}`}>{DELIVERY_LABELS[delivery.status]}</span></div>{delivery.text ? <details className="mt-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 py-2"><summary className="cursor-pointer text-[8px] font-bold uppercase text-sky-700 [html[data-theme=dark]_&]:text-sky-300">Zobrazit finální náhled</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-[8px] leading-4 text-[var(--text-secondary)]">{delivery.text}</pre>{delivery.announcementUrl ? <a href={delivery.announcementUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[8px] font-semibold text-sky-700 underline [html[data-theme=dark]_&]:text-sky-300">PDF oznámení</a> : null}</details> : null}{delivery.lastErrorMessage ? <p className="mt-2 rounded-xl border border-red-400/25 bg-red-500/8 px-2.5 py-2 text-[8px] leading-4 text-red-700 [html[data-theme=dark]_&]:text-red-300">{delivery.lastErrorCode ? `${delivery.lastErrorCode}: ` : ''}{delivery.lastErrorMessage}</p> : null}{delivery.status === 'failed' ? <div className="mt-2 flex flex-wrap gap-2"><button type="button" disabled={pending || delivery.attemptCount >= delivery.maxAttemptCount} onClick={() => mutateDelivery(delivery.id, 'retry')} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-400/35 bg-sky-500/10 px-3 text-[8px] font-bold uppercase text-sky-700 disabled:opacity-50 [html[data-theme=dark]_&]:text-sky-300"><RotateCcw aria-hidden size={12} /> Opakovat</button><button type="button" disabled={pending} onClick={() => mutateDelivery(delivery.id, 'skip')} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-red-400/25 bg-red-500/8 px-3 text-[8px] font-bold uppercase text-red-700 disabled:opacity-50 [html[data-theme=dark]_&]:text-red-300"><Ban aria-hidden size={12} /> Přeskočit zprávu</button></div> : null}</div>)}</div>}
        {failedDeliveries.length > 0 ? <p className="mt-2 flex items-center gap-2 text-[8px] font-semibold text-red-600 [html[data-theme=dark]_&]:text-red-300"><AlertTriangle aria-hidden size={13} /> {failedDeliveries.length} zpráv vyžaduje pozornost.</p> : null}
      </section>

      {error ? <p className="rounded-xl border border-red-400/30 bg-red-500/8 px-3 py-2 text-[9px] font-semibold text-red-700 [html[data-theme=dark]_&]:text-red-300">{error}</p> : null}
      {message ? <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/8 px-3 py-2 text-[9px] font-semibold text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">{message}</p> : null}

      <div className="flex flex-col-reverse gap-2 border-t border-[var(--surface-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={sendTestEmail} disabled={pending || client.mode !== 'test' || !workspace.resend.testReady} title={client.mode === 'test' ? 'Odeslat kontrolní zprávu pouze na interní testovací adresu' : 'Nejprve spusťte bezpečný TEST režim'} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 text-[9px] font-bold uppercase text-violet-700 transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 [html[data-theme=dark]_&]:text-violet-300"><Send aria-hidden size={14} /> Odeslat testovací e-mail {client.mode !== 'test' ? <LockKeyhole aria-hidden size={11} /> : null}</button>
        <button type="button" onClick={save} disabled={pending || client.mode === 'test'} title={client.mode === 'test' ? 'Nejprve ukončete TEST režim.' : undefined} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-sky-600 bg-sky-600 px-5 text-[9px] font-bold uppercase text-white shadow-[0_9px_20px_rgba(2,132,199,0.2)] transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-60">{pending ? <LoaderCircle aria-hidden size={14} className="animate-spin" /> : <Save aria-hidden size={14} />} Uložit nastavení</button>
      </div>

      {workspace.lastErrorMessage ? <p className="flex items-start gap-2 rounded-xl border border-red-400/25 bg-red-500/8 px-3 py-2 text-[8px] leading-4 text-red-700 [html[data-theme=dark]_&]:text-red-300"><AlertTriangle aria-hidden size={13} className="mt-0.5 shrink-0" /> {workspace.lastErrorCode ? `${workspace.lastErrorCode}: ` : ''}{workspace.lastErrorMessage}</p> : null}
      <p className="flex items-center gap-2 text-[8px] leading-4 text-[var(--text-secondary)]"><ShieldCheck aria-hidden size={13} className="shrink-0 text-emerald-500" /> Poslední plánování: {formatDateTime(workspace.lastPlannedAt)} · globální odesílání: {workspace.dispatchEnabled ? 'povoleno' : 'vypnuto'}. Poskytovatel: {workspace.provider === 'resend' ? 'Resend (zatím nenapojen)' : workspace.provider}.</p>
    </div>
  )
}

function AdminPopup({ workspace, loading, error, selectedClientId, onSelectClient, onReload, onWorkspaceChange, onClose }: { workspace: MarketClientEmailAdminWorkspace | null; loading: boolean; error: string | null; selectedClientId: string | null; onSelectClient: (clientId: string) => void; onReload: () => void; onWorkspaceChange: (workspace: MarketClientEmailAdminWorkspace) => void; onClose: () => void }) {
  const client = workspace?.clients.find((item) => item.clientId === selectedClientId) ?? workspace?.clients[0] ?? null
  return (
    <PowerOutagePopupShell titleId="market-client-email-admin-title" eyebrow="MARKETY · POUZE PRO ADMINISTRÁTORY" title="E-mailová upozornění" icon={<MailCheck aria-hidden size={21} />} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
        {loading && !workspace ? <LoadingBlock label="Načítám administraci e-mailů…" /> : error && !workspace ? <div className="flex min-h-[260px] flex-col items-center justify-center text-center"><AlertTriangle aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Administraci se nepodařilo načíst</strong><p className="mt-2 max-w-md text-[9px] leading-4 text-[var(--text-secondary)]">{error}</p><button type="button" onClick={onReload} className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 px-4 text-[9px] font-bold uppercase text-sky-700 [html[data-theme=dark]_&]:text-sky-300"><RefreshCw aria-hidden size={13} /> Zkusit znovu</button></div> : workspace && client ? <><ResendSetupStatus workspace={workspace} /><div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{workspace.clients.map((item) => <button key={item.clientId} type="button" onClick={() => onSelectClient(item.clientId)} className={`rounded-2xl border p-3 text-left transition hover:-translate-y-px ${item.clientId === client.clientId ? 'border-sky-400/45 bg-sky-500/10' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'}`}><strong className="block truncate text-[11px] text-[var(--text-primary)]">{item.chainName}</strong><span className="mt-2 inline-flex"><ModeBadge mode={item.mode} /></span><small className="mt-2 block text-[7px] text-[var(--text-secondary)]">{item.recipients.filter((recipient) => recipient.isActive).length} aktivních adres</small></button>)}</div><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><span><span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Nastavení klienta</span><h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{client.clientName}</h3></span><ModeBadge mode={client.mode} /></div><ClientEditor key={`${client.clientId}-${client.updatedAt}`} client={client} workspace={workspace} onWorkspaceChange={onWorkspaceChange} /></> : null}
      </div>
    </PowerOutagePopupShell>
  )
}

export function MarketClientEmailAdminPanel() {
  const [workspace, setWorkspace] = useState<MarketClientEmailAdminWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    const result = await getMarketClientEmailAdminWorkspaceAction()
    if (result.success) {
      setWorkspace(result.workspace)
      setSelectedClientId((current) => current ?? result.workspace.clients[0]?.clientId ?? null)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    void getMarketClientEmailAdminWorkspaceAction().then((result) => {
      if (cancelled) return
      if (result.success) {
        setWorkspace(result.workspace)
        setSelectedClientId(result.workspace.clients[0]?.clientId ?? null)
      } else {
        setError(result.error)
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  const activeCount = useMemo(() => workspace?.clients.filter((client) => client.mode !== 'disabled').length ?? 0, [workspace])
  const recipientCount = useMemo(() => workspace?.clients.reduce((sum, client) => sum + client.recipients.filter((recipient) => recipient.isActive).length, 0) ?? 0, [workspace])
  const errorCount = useMemo(() => workspace?.clients.reduce((sum, client) => sum + client.deliveries.filter((delivery) => ['failed', 'bounced', 'complained'].includes(delivery.status)).length, 0) ?? 0, [workspace])

  return (
    <>
      <section className="activities-page__panel flex h-[360px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto">
        <button type="button" onClick={() => setOpen(true)} className="flex items-start justify-between gap-3 text-left">
          <span className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 [html[data-theme=dark]_&]:text-violet-300"><MailCheck aria-hidden size={18} /></span><span className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Klientské notifikace</span><h2 className="truncate text-base font-semibold text-[var(--text-primary)]">E-mailová upozornění</h2></span></span>
          <ChevronRight aria-hidden size={17} className="mt-3 shrink-0 text-[var(--text-secondary)]" />
        </button>
        {loading && !workspace ? <LoadingBlock label="Načítám nastavení…" /> : error && !workspace ? <button type="button" onClick={() => { setOpen(true); void load() }} className="mt-4 flex flex-1 flex-col items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/8 p-4 text-center"><AlertTriangle aria-hidden size={20} className="text-red-500" /><strong className="mt-2 text-[10px] text-[var(--text-primary)]">Nastavení se nepodařilo načíst</strong><span className="mt-1 text-[8px] text-[var(--text-secondary)]">Otevřít detail a opakovat</span></button> : workspace ? <button type="button" onClick={() => setOpen(true)} className="mt-4 min-h-0 flex-1 text-left"><div className="grid grid-cols-2 gap-2">{workspace.clients.map((client) => <div key={client.clientId} className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-2.5"><div className="flex items-center justify-between gap-2"><strong className="truncate text-[10px] text-[var(--text-primary)]">{client.chainName}</strong><i aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${MODE_PRESENTATION[client.mode].dot}`} /></div><small className="mt-1 block text-[7px] font-bold uppercase text-[var(--text-secondary)]">{MODE_PRESENTATION[client.mode].label}</small></div>)}</div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><span className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-2"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Nastaveno</small><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{activeCount}/4</strong></span><span className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-2"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Příjemci</small><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{recipientCount}</strong></span><span className={`rounded-xl border p-2 ${errorCount > 0 ? 'border-red-400/30 bg-red-500/8' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'}`}><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Chyby</small><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{errorCount}</strong></span></div></button> : null}
        <p className="mt-auto flex items-center justify-center gap-2 pt-3 text-center text-[8px] leading-4 text-[var(--text-secondary)]"><ShieldCheck aria-hidden size={13} className="shrink-0 text-emerald-500" /> Pouze pro administrátory · Resend {workspace?.resend.providerReady ? 'připraven' : 'čeká na nastavení'} · {workspace?.runtimeMode === 'test' && workspace.dispatchEnabled ? 'bezpečný TEST aktivní' : 'odesílání vypnuto'}</p>
      </section>
      {open && typeof document !== 'undefined' ? createPortal(<AdminPopup workspace={workspace} loading={loading} error={error} selectedClientId={selectedClientId} onSelectClient={setSelectedClientId} onReload={() => void load()} onWorkspaceChange={(next) => { setWorkspace(next); setError(null) }} onClose={() => setOpen(false)} />, document.body) : null}
    </>
  )
}
