'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { ModalHeading } from '@/components/ui/modal-heading'
import { SlidingTwoTabSwitch } from '@/components/ui/sliding-two-tab-switch'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { OperationalProtocolDraftInput } from '@/lib/operational-protocols/types'
import {
  createEmptyOperationalProtocolDraft,
  OperationalProtocolForm,
} from './operational-protocol-form'
import { generateOperationalProtocolAction } from './operational-protocol-actions'
import { validateOperationalProtocolDraft } from '@/lib/operational-protocols/validation'
import { OperationalProtocolArchive } from './operational-protocol-archive'

type OperationalProtocolsTab = 'new' | 'archive'

const TABS = [
  { value: 'new', label: 'NOVÝ PROTOKOL' },
  { value: 'archive', label: 'ULOŽENÉ PROTOKOLY' },
] as const

const EMPTY_DRAFT_FINGERPRINT = JSON.stringify(createEmptyOperationalProtocolDraft())

export function OperationalProtocolsModalLauncher() {
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<OperationalProtocolsTab>('new')
  const [draft, setDraft] = useState<OperationalProtocolDraftInput>(
    createEmptyOperationalProtocolDraft
  )
  const [showCloseConfirmation, setShowCloseConfirmation] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [generatedProtocol, setGeneratedProtocol] = useState<{
    fileName: string
    printUrl: string
  } | null>(null)
  const isDraftDirty = useMemo(
    () => JSON.stringify(draft) !== EMPTY_DRAFT_FINGERPRINT,
    [draft]
  )

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isGenerating) return
        if (showCloseConfirmation) {
          setShowCloseConfirmation(false)
        } else if (isDraftDirty) {
          setShowCloseConfirmation(true)
        } else {
          setIsOpen(false)
          setActiveTab('new')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isDraftDirty, isGenerating, isOpen, showCloseConfirmation])

  function openModal() {
    setDraft(createEmptyOperationalProtocolDraft())
    setActiveTab('new')
    setShowCloseConfirmation(false)
    setGenerationError(null)
    setGeneratedProtocol(null)
    setIsOpen(true)
  }

  function requestCloseModal() {
    if (isGenerating) return
    if (isDraftDirty) {
      setShowCloseConfirmation(true)
      return
    }

    closeModal()
  }

  function closeModal() {
    setIsOpen(false)
    setActiveTab('new')
    setShowCloseConfirmation(false)
    setDraft(createEmptyOperationalProtocolDraft())
    setGenerationError(null)
    setGeneratedProtocol(null)
    setIsGenerating(false)
  }

  function updateDraft(nextDraft: OperationalProtocolDraftInput) {
    setDraft(nextDraft)
    setGenerationError(null)
    setGeneratedProtocol(null)
  }

  function copyIntoNewProtocol(nextDraft: OperationalProtocolDraftInput) {
    updateDraft(nextDraft)
    setActiveTab('new')
  }

  async function generateProtocol() {
    if (isGenerating) return

    const validation = validateOperationalProtocolDraft(draft)
    if (!validation.success) {
      setGenerationError(validation.error)
      return
    }

    setGenerationError(null)
    setGeneratedProtocol(null)

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.opener = null
      printWindow.document.title = 'Generuji provozní protokol…'
      printWindow.document.body.style.cssText =
        'margin:0;min-height:100vh;display:grid;place-items:center;background:#111827;color:#fff;font:600 15px system-ui,sans-serif'
      printWindow.document.body.textContent = 'Generuji a ukládám provozní protokol…'
    }

    setIsGenerating(true)
    try {
      const result = await generateOperationalProtocolAction(draft)

      if (!result.success) {
        printWindow?.close()
        setGenerationError(result.error)
        return
      }

      if (printWindow) {
        printWindow.location.replace(result.data.printUrl)
      }

      setGeneratedProtocol({
        fileName: result.data.fileName,
        printUrl: result.data.printUrl,
      })
      setDraft(createEmptyOperationalProtocolDraft())
    } catch {
      printWindow?.close()
      setGenerationError('Protokol se nepodařilo vygenerovat. Zkus akci opakovat.')
    } finally {
      setIsGenerating(false)
    }
  }

  if (!isMounted) return null

  return createPortal(
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="Otevřít provozní protokoly"
        title="Provozní protokoly"
        className="dashboard-floating-action fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+16px)] z-[70] inline-flex h-[60px] w-[60px] items-center justify-center rounded-full border border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_34px_rgba(0,0,0,0.42)] backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#3a3a3a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] active:scale-[0.95] lg:right-7 lg:bottom-7 lg:h-[68px] lg:w-[68px]"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
          <path d="M14 3.5v4h4" />
          <path d="M9 11h6M9 14.5h6M9 18h4" />
        </svg>
      </button>

      {isOpen ? (
        <OperationalProtocolsModal
          activeTab={activeTab}
          onTabChange={setActiveTab}
          draft={draft}
          onDraftChange={updateDraft}
          onClose={requestCloseModal}
          isGenerating={isGenerating}
          generationError={generationError}
          generatedProtocol={generatedProtocol}
          onGenerate={() => void generateProtocol()}
          onCopyDraft={copyIntoNewProtocol}
          showCloseConfirmation={showCloseConfirmation}
          onCancelClose={() => setShowCloseConfirmation(false)}
          onConfirmClose={closeModal}
        />
      ) : null}
    </>,
    document.body
  )
}

function OperationalProtocolsModal({
  activeTab,
  onTabChange,
  draft,
  onDraftChange,
  onClose,
  isGenerating,
  generationError,
  generatedProtocol,
  onGenerate,
  onCopyDraft,
  showCloseConfirmation,
  onCancelClose,
  onConfirmClose,
}: {
  activeTab: OperationalProtocolsTab
  onTabChange: (tab: OperationalProtocolsTab) => void
  draft: OperationalProtocolDraftInput
  onDraftChange: (draft: OperationalProtocolDraftInput) => void
  onClose: () => void
  isGenerating: boolean
  generationError: string | null
  generatedProtocol: { fileName: string; printUrl: string } | null
  onGenerate: () => void
  onCopyDraft: (draft: OperationalProtocolDraftInput) => void
  showCloseConfirmation: boolean
  onCancelClose: () => void
  onConfirmClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[150] overflow-y-auto bg-zinc-950/42 p-2 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="operational-protocols-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="mx-auto flex min-h-full w-full max-w-[1180px] items-start justify-center py-1 sm:items-center sm:py-0">
        <div className="flex max-h-[calc(100dvh-1rem)] min-h-[min(720px,calc(100dvh-1rem))] w-full min-w-0 flex-col overflow-hidden rounded-[28px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(244,248,252,0.96)_100%)] shadow-[0_36px_84px_rgba(24,24,27,0.3)] sm:max-h-[calc(100dvh-2rem)] sm:min-h-[min(720px,calc(100dvh-2rem))] sm:rounded-[30px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(12,20,34,0.99)_0%,rgba(8,15,27,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[0_36px_84px_rgba(0,0,0,0.5)]">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/75 px-4 py-4 sm:px-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)]">
            <ModalHeading
              section="FAKTURY"
              title="Provozní protokoly"
              id="operational-protocols-modal-title"
            />

            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.92)] [html[data-theme='dark']_&]:text-slate-400 [html[data-theme='dark']_&]:shadow-[0_8px_18px_rgba(0,0,0,0.22)] [html[data-theme='dark']_&:hover]:text-white"
              aria-label="Zavřít provozní protokoly"
            >
              ×
            </button>
          </header>

          <SlidingTwoTabSwitch
            key={activeTab}
            value={activeTab}
            options={TABS}
            onValueChange={onTabChange}
            ariaLabel="Část provozních protokolů"
            className="mx-4 mt-4 shrink-0 rounded-[20px] border border-zinc-200/80 bg-zinc-100/75 p-1 sm:mx-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(5,12,23,0.68)]"
          />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {activeTab === 'new' ? (
              <OperationalProtocolForm value={draft} onChange={onDraftChange} />
            ) : (
              <OperationalProtocolArchive onCopy={onCopyDraft} />
            )}
          </div>

          {activeTab === 'new' ? (
            <footer className="shrink-0 border-t border-zinc-200/75 bg-white/64 px-4 py-3 backdrop-blur-xl sm:px-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.14)] [html[data-theme='dark']_&]:bg-[rgba(6,13,24,0.7)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0" aria-live="polite">
                  {generationError ? (
                    <p className="text-xs font-medium leading-5 text-rose-600 [html[data-theme='dark']_&]:text-rose-300">
                      {generationError}
                    </p>
                  ) : generatedProtocol ? (
                    <div className="text-xs leading-5 text-emerald-700 [html[data-theme='dark']_&]:text-emerald-300">
                      <p className="font-semibold">Protokol byl vygenerován a bezpečně uložen.</p>
                      <a
                        href={generatedProtocol.printUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block max-w-full truncate align-bottom underline decoration-emerald-400/60 underline-offset-2 hover:text-emerald-800 [html[data-theme='dark']_&:hover]:text-emerald-200"
                      >
                        Otevřít tisk znovu · {generatedProtocol.fileName}
                      </a>
                    </div>
                  ) : (
                    <p className="text-[11px] leading-5 text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                      Vytvoří se neměnný záznam a uložené PDF. Tisk se otevře v novém panelu.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={isGenerating}
                  className="inline-flex h-11 min-w-[190px] shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#62a9d6] bg-[linear-gradient(155deg,#4b9bd0_0%,#3487bf_58%,#2875aa_100%)] px-5 text-xs font-semibold tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(33,112,164,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_14px_26px_rgba(33,112,164,0.34)] disabled:cursor-wait disabled:translate-y-0 disabled:opacity-70"
                >
                  {isGenerating ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/45 border-t-white" />
                      GENERUJI…
                    </>
                  ) : (
                    'GENEROVAT PP'
                  )}
                </button>
              </div>
            </footer>
          ) : null}
        </div>
      </div>

      {showCloseConfirmation ? (
        <div
          className="fixed inset-0 z-[170] flex items-center justify-center bg-zinc-950/35 p-4 backdrop-blur-[3px]"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="operational-protocol-close-title"
          aria-describedby="operational-protocol-close-description"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onCancelClose()
          }}
        >
          <div className="w-full max-w-[500px] rounded-[28px] border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.99)_0%,rgba(239,247,252,0.98)_100%)] p-5 shadow-[0_28px_70px_rgba(15,23,42,0.32)] sm:p-6 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,25,42,0.99)_0%,rgba(8,16,29,0.99)_100%)] [html[data-theme='dark']_&]:shadow-[0_30px_74px_rgba(0,0,0,0.58)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#2676a8] [html[data-theme='dark']_&]:text-[#8fd3f7]">
              ROZPRACOVANÝ PROTOKOL
            </p>
            <h2
              id="operational-protocol-close-title"
              className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 [html[data-theme='dark']_&]:text-slate-50"
            >
              Zahodit vyplněné údaje?
            </h2>
            <p
              id="operational-protocol-close-description"
              className="mt-2 text-sm leading-6 text-zinc-600 [html[data-theme='dark']_&]:text-slate-300"
            >
              Protokol zatím není uložený. Zavřením modalu o všechny právě vyplněné údaje
              přijdete.
            </p>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onConfirmClose}
                className="h-11 rounded-2xl border border-rose-600 bg-rose-600 px-5 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(225,29,72,0.2)] transition duration-200 hover:-translate-y-[1px] hover:bg-rose-700 [html[data-theme='dark']_&]:border-rose-500 [html[data-theme='dark']_&]:bg-rose-600 [html[data-theme='dark']_&]:text-white"
              >
                ZAHODIT A ZAVŘÍT
              </button>
              <button
                type="button"
                onClick={onCancelClose}
                autoFocus
                className="h-11 rounded-2xl border border-zinc-200 bg-white/85 px-5 text-xs font-semibold text-zinc-700 shadow-sm transition duration-200 hover:-translate-y-[1px] hover:text-zinc-950 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[rgba(15,25,42,0.9)] [html[data-theme='dark']_&]:text-slate-200 [html[data-theme='dark']_&:hover]:text-white"
              >
                POKRAČOVAT V ÚPRAVÁCH
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
