'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { buildNordFjellaSpdQrPayload } from '@/lib/nord-fjella/payment-qr'
import { getNordFjellaProviderSettingsIssues } from '@/lib/nord-fjella/settings-validation'
import { buildNordFjellaSettlementSummary } from '@/lib/nord-fjella/settlement'
import type {
  NordFjellaReservationItemRow,
  NordFjellaReservationRow,
  NordFjellaSettingsRow,
} from '@/lib/nord-fjella/types'

type SettlementPreviewButtonProps = {
  reservation: NordFjellaReservationRow
  reservationItems: NordFjellaReservationItemRow[]
  settings: NordFjellaSettingsRow | null
}

const NORD_FJELLA_LIGHT_THEME_LOGO = '/nord-fjella-logo-light.png'
const NORD_FJELLA_DARK_THEME_LOGO = '/nord-fjella-logo-dark.png'

function formatCurrency(value: number | null | undefined) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0))
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00Z`))
}

function getGuestLabel(row: NordFjellaReservationRow) {
  if (row.guest_company_name?.trim()) return row.guest_company_name
  if (row.guest_full_name?.trim()) return row.guest_full_name
  return 'Bez hosta'
}

export function SettlementPreviewButton({
  reservation,
  reservationItems,
  settings,
}: SettlementPreviewButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const providerSettingsIssues = getNordFjellaProviderSettingsIssues(settings)
  const canOpenSettlement = providerSettingsIssues.length === 0

  if (reservation.record_type !== 'reservation') {
    return null
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (canOpenSettlement) {
            setIsOpen(true)
          }
        }}
        disabled={!canOpenSettlement}
        title={
          canOpenSettlement
            ? undefined
            : `Doplň v nastavení poskytovatele: ${providerSettingsIssues.join(', ')}`
        }
        className={`inline-flex h-9 items-center justify-center rounded-xl border px-3 text-xs font-medium uppercase tracking-[0.04em] transition duration-200 ${
          canOpenSettlement
            ? 'border-[#8dbfe0]/85 bg-[linear-gradient(155deg,#f3f9fd_0%,#dceef9_100%)] text-[#1f5f8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(35,111,159,0.12)] hover:-translate-y-[1px] [html[data-theme=\'dark\']_&]:border-slate-400/18 [html[data-theme=\'dark\']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.92)_100%)] [html[data-theme=\'dark\']_&]:text-slate-100 [html[data-theme=\'dark\']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_10px_22px_rgba(0,0,0,0.22)]'
            : 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400 shadow-none [html[data-theme=\'dark\']_&]:border-slate-400/14 [html[data-theme=\'dark\']_&]:bg-slate-800/60 [html[data-theme=\'dark\']_&]:text-slate-500'
        }`}
      >
        Vyúčtování
      </button>

      {isOpen ? (
        <SettlementPreviewModal
          reservation={reservation}
          reservationItems={reservationItems}
          settings={settings}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function SettlementPreviewModal({
  reservation,
  reservationItems,
  settings,
  onClose,
}: SettlementPreviewButtonProps & { onClose: () => void }) {
  useBodyScrollLock(true)

  const summary = buildNordFjellaSettlementSummary(reservation, reservationItems)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null)

  const qrPayload = buildNordFjellaSpdQrPayload({
    accountNumber: settings?.provider_bank_account,
    iban: settings?.provider_iban,
    amount: Math.max(summary.remainingToPay, 0),
    variableSymbol: reservation.variable_symbol,
    message: `${settings?.object_name?.trim() || 'Nord Fjella'} ${reservation.reservation_number}`,
    recipientName: settings?.provider_company_name,
  })

  useEffect(() => {
    let isCancelled = false

    async function generateQrCode() {
      if (!qrPayload) {
        setQrCodeDataUrl(null)
        return
      }

      const [{ default: QRCode }] = await Promise.all([import('qrcode')])
      const dataUrl = await QRCode.toDataURL(qrPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 220,
      })

      if (!isCancelled) {
        setQrCodeDataUrl(dataUrl)
      }
    }

    void generateQrCode()

    return () => {
      isCancelled = true
    }
  }, [qrPayload])

  const modalContent = (
    <div
      className="fixed inset-0 z-[110] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-[calc(100dvh-2rem)] items-start justify-center py-2 sm:min-h-full sm:items-center sm:py-4">
        <div className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-6xl flex-col overflow-hidden rounded-3xl sm:h-auto sm:max-h-[calc(100dvh-2rem)]">
          <div className="clients-modal__header flex shrink-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="clients-modal__title text-lg font-semibold tracking-tight sm:text-xl">
                Vyúčtování pobytu
              </h2>
              <p className="clients-modal__subtitle mt-1 text-sm">
                {reservation.reservation_number} • {getGuestLabel(reservation)}
              </p>
            </div>

            <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
              <a
                href={`/nord-fjella/${reservation.id}/settlement-pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="clients-modal__submit inline-flex h-9 items-center justify-center rounded-xl px-3 text-xs font-medium uppercase tracking-[0.04em] transition duration-200 hover:-translate-y-[1px]"
              >
                Stáhnout PDF
              </a>
              <button
                type="button"
                onClick={onClose}
                className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-medium"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="clients-modal__body nord-fjella-modal-body min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
              <section className="min-w-0 space-y-5">
                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-3">
                      <div className="relative h-14 w-40 overflow-hidden p-2">
                        <Image
                          src={NORD_FJELLA_LIGHT_THEME_LOGO}
                          alt={settings?.object_name || 'Nord Fjella'}
                          fill
                          sizes="160px"
                          className="object-contain p-2 [html[data-theme='dark']_&]:hidden"
                        />
                        <Image
                          src={NORD_FJELLA_DARK_THEME_LOGO}
                          alt={settings?.object_name || 'Nord Fjella'}
                          fill
                          sizes="160px"
                          className="hidden object-contain p-2 [html[data-theme='dark']_&]:block"
                        />
                      </div>
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                          Objekt
                        </div>
                        <div className="mt-1 text-2xl font-semibold text-gray-900">
                          {settings?.object_name?.trim() || 'Nord Fjella'}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm text-gray-700 md:text-right">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                          Poskytovatel
                        </div>
                        <div className="mt-1 font-semibold text-gray-900">
                          {settings?.provider_company_name?.trim() || 'Nenastaveno'}
                        </div>
                        <div>{settings?.provider_street?.trim() || ''}</div>
                        <div>
                          {[settings?.provider_postal_code, settings?.provider_city].filter(Boolean).join(' ')}
                        </div>
                        <div>{settings?.provider_country?.trim() || ''}</div>
                      </div>
                      <div>
                        <div>IČO: {settings?.provider_company_id_number?.trim() || '—'}</div>
                        <div>DIČ: {settings?.provider_vat_number?.trim() || '—'}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="nord-fjella-modal-subtle-card rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                      Objednatel
                    </div>
                    <div className="mt-2 text-base font-semibold text-gray-900">{getGuestLabel(reservation)}</div>
                    {reservation.guest_contact_name ? (
                      <div className="mt-1 text-sm text-gray-600">{reservation.guest_contact_name}</div>
                    ) : null}
                    <div className="mt-2 text-sm text-gray-600">
                      {[reservation.guest_street, reservation.guest_postal_code, reservation.guest_city]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    <div className="mt-1 text-sm text-gray-600">{reservation.guest_country || ''}</div>
                    <div className="mt-2 text-sm text-gray-600">{reservation.guest_email || '—'}</div>
                    <div className="mt-1 text-sm text-gray-600">{reservation.guest_phone || '—'}</div>
                  </div>

                  <div className="nord-fjella-modal-subtle-card rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                      Pobyt
                    </div>
                    <div className="mt-2 grid gap-2 text-sm text-gray-700">
                      <div>Příjezd: <span className="font-semibold text-gray-900">{formatDate(reservation.stay_start_date)}</span></div>
                      <div>Odjezd: <span className="font-semibold text-gray-900">{formatDate(reservation.stay_end_date)}</span></div>
                      <div>Nocí: <span className="font-semibold text-gray-900">{summary.nights}</span></div>
                      <div>Osoby: <span className="font-semibold text-gray-900">{reservation.adult_count} dosp. / {reservation.child_count} dětí</span></div>
                      <div>VS: <span className="font-semibold text-gray-900">{reservation.variable_symbol}</span></div>
                    </div>
                  </div>
                </div>

                <div className="nord-fjella-modal-card overflow-hidden rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="border-b border-zinc-100 px-5 py-4 [html[data-theme='dark']_&]:border-slate-400/12">
                    <h3 className="text-base font-semibold text-gray-900">Položky vyúčtování</h3>
                  </div>
                  <div className="grid gap-3 p-4 sm:hidden">
                    {summary.lines.map((line) => (
                      <div
                        key={line.key}
                        className="nord-fjella-modal-subtle-card rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-medium text-gray-900">{line.label}</div>
                            {line.note ? <div className="mt-1 text-xs text-gray-500">{line.note}</div> : null}
                          </div>
                          <div className="shrink-0 text-right text-sm font-semibold text-gray-900">
                            {formatCurrency(line.total)}
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-700">
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                              Množství
                            </div>
                            <div className="mt-1">{line.quantity.toLocaleString('cs-CZ')}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                              Jedn.
                            </div>
                            <div className="mt-1">{line.unit}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                              Cena
                            </div>
                            <div className="mt-1">{formatCurrency(line.unitPrice)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                              DPH
                            </div>
                            <div className="mt-1">
                              {line.vatMode === 'vat_12'
                                ? '12 %'
                                : line.vatMode === 'vat_21'
                                  ? '21 %'
                                  : '0 %'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto sm:block">
                    <table className="min-w-full">
                      <thead className="bg-zinc-50/80 text-left text-xs font-semibold uppercase tracking-[0.12em] text-gray-500 [html[data-theme='dark']_&]:bg-slate-950/28 [html[data-theme='dark']_&]:text-slate-400">
                        <tr>
                          <th className="px-5 py-3">Položka</th>
                          <th className="px-5 py-3 text-right">Množství</th>
                          <th className="px-5 py-3">Jedn.</th>
                          <th className="px-5 py-3 text-right">Cena</th>
                          <th className="px-5 py-3">DPH</th>
                          <th className="px-5 py-3 text-right">Celkem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.lines.map((line) => (
                          <tr
                            key={line.key}
                            className="border-t border-zinc-100 align-top text-sm text-gray-700 [html[data-theme='dark']_&]:border-slate-400/10"
                          >
                            <td className="px-5 py-3">
                              <div className="font-medium text-gray-900">{line.label}</div>
                              {line.note ? <div className="mt-1 text-xs text-gray-500">{line.note}</div> : null}
                            </td>
                            <td className="px-5 py-3 text-right">{line.quantity.toLocaleString('cs-CZ')}</td>
                            <td className="px-5 py-3">{line.unit}</td>
                            <td className="px-5 py-3 text-right">{formatCurrency(line.unitPrice)}</td>
                            <td className="px-5 py-3">
                              {line.vatMode === 'vat_12'
                                ? '12 %'
                                : line.vatMode === 'vat_21'
                                  ? '21 %'
                                  : '0 %'}
                            </td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-900">
                              {formatCurrency(line.total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              <aside className="min-w-0 space-y-4">
                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <h3 className="text-base font-semibold text-gray-900">Souhrn úhrad</h3>
                  <div className="mt-4 space-y-3 text-sm text-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <span>Vyúčtování pobytu</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.subtotalExcludingDeposit)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Uhrazeno celkem</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.paidTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Zbývá doplatit</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.remainingToPay)}</span>
                    </div>
                    <div className="h-px bg-zinc-100 [html[data-theme='dark']_&]:bg-slate-400/12" />
                    <div className="flex items-center justify-between gap-3">
                      <span>Požadovaná záloha</span>
                      <span>{formatCurrency(summary.requestedDepositAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Přijatá kauce</span>
                      <span>{formatCurrency(summary.depositReceivedAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Vrácená kauce</span>
                      <span>{formatCurrency(summary.depositRefundAmount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Zadržená kauce</span>
                      <span>{formatCurrency(summary.depositWithheldAmount)}</span>
                    </div>
                    {reservation.security_deposit_withheld_reason ? (
                      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 [html[data-theme='dark']_&]:border-amber-400/24 [html[data-theme='dark']_&]:bg-amber-500/12 [html[data-theme='dark']_&]:text-amber-200">
                        {reservation.security_deposit_withheld_reason}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <h3 className="text-base font-semibold text-gray-900">DPH a režimy</h3>
                  <div className="mt-4 space-y-3 text-sm text-gray-700">
                    <div className="flex items-center justify-between gap-3">
                      <span>Položky v 12 %</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.vat12Total)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Položky v 21 %</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.vat21Total)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span>Osvobozené položky</span>
                      <span className="font-semibold text-gray-900">{formatCurrency(summary.vatExemptTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <h3 className="text-base font-semibold text-gray-900">Platební údaje</h3>
                  <div className="mt-4 space-y-2 text-sm text-gray-700">
                    <div>Účet: <span className="font-semibold text-gray-900">{settings?.provider_bank_account?.trim() || 'Nenastaveno'}</span></div>
                    <div>VS: <span className="font-semibold text-gray-900">{reservation.variable_symbol}</span></div>
                    <div>IBAN: <span className="font-semibold text-gray-900">{settings?.provider_iban?.trim() || '—'}</span></div>
                    <div>SWIFT: <span className="font-semibold text-gray-900">{settings?.provider_swift?.trim() || '—'}</span></div>
                  </div>

                  {qrCodeDataUrl ? (
                    <div className="nord-fjella-modal-subtle-card mt-5 rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-400">
                        QR platba
                      </div>
                      <div className="mt-3 flex items-center justify-center">
                        <div className="relative h-[170px] w-[170px] overflow-hidden rounded-2xl border border-zinc-100 bg-white p-2">
                          <Image
                            src={qrCodeDataUrl}
                            alt="QR platba Nord Fjella"
                            fill
                            sizes="170px"
                            className="object-contain p-2"
                            unoptimized
                          />
                        </div>
                      </div>
                      <div className="mt-3 text-center text-xs text-gray-500">
                        Pro doplatek {formatCurrency(Math.max(summary.remainingToPay, 0))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {reservation.public_note?.trim() ? (
                  <div className="nord-fjella-modal-card rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    <h3 className="text-base font-semibold text-gray-900">Poznámka pro hosta</h3>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                      {reservation.public_note}
                    </p>
                  </div>
                ) : null}
              </aside>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(modalContent, document.body)
}
