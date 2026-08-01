'use client'

import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ModalHeading } from '@/components/ui/modal-heading'
import { ChangesButton } from './changes-button'
import {
  getJobsChangesModalDataAction,
  saveJobChangesModalAction,
  type ChangesNewJobItem,
  type ChangesUpdatedJobItem,
} from './changes-actions'
import { updateJobEvidenceStatusAction } from './actions'

type ChangesLauncherProps = {
  initialCount: number
  className?: string
}

type ChangesModalData = {
  newJobs: ChangesNewJobItem[]
  updatedJobs: ChangesUpdatedJobItem[]
  badgeCount: number
}

const INITIAL_DATA: ChangesModalData = {
  newJobs: [],
  updatedJobs: [],
  badgeCount: 0,
}

function changeKey(item: Pick<ChangesUpdatedJobItem, 'jobId' | 'updatedAt'>) {
  return `${item.jobId}:${item.updatedAt}`
}

export function ChangesLauncher({ initialCount, className }: ChangesLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving] = useTransition()
  const [data, setData] = useState<ChangesModalData>({
    ...INITIAL_DATA,
    badgeCount: initialCount,
  })
  const [markedChanges, setMarkedChanges] = useState<Record<string, ChangesUpdatedJobItem>>({})
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function reloadData() {
    try {
      const result = await getJobsChangesModalDataAction()
      if (!result.success || !result.data) {
        setError(result.error ?? 'Nepodařilo se načíst změny.')
        return false
      }

      setData(result.data)
      setError(null)
      return true
    } catch (requestError) {
      console.error('Nepodařilo se načíst data změn.', requestError)
      setError('Nepodařilo se načíst data modalu změn.')
      return false
    }
  }

  function openModal() {
    if (isLoading) return
    startLoading(async () => {
      await reloadData()
      setIsConfirmOpen(false)
      setIsHelpOpen(false)
      setConfirmError(null)
      setIsOpen(true)
    })
  }

  function closeModal() {
    setMarkedChanges({})
    setIsConfirmOpen(false)
    setIsHelpOpen(false)
    setConfirmError(null)
    setIsOpen(false)
  }

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  function handleEvidenceToggle(job: ChangesNewJobItem) {
    startSaving(async () => {
      const nextStatus = job.evidenceStatus === 'nove' ? 'zapsano' : 'nove'
      const formData = new FormData()
      formData.set('evidence_status', nextStatus)
      const result = await updateJobEvidenceStatusAction(
        job.jobId,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        setError(result.error ?? 'Stav evidence se nepodařilo uložit.')
        return
      }

      await reloadData()
    })
  }

  function toggleChangedJob(item: ChangesUpdatedJobItem) {
    const key = changeKey(item)
    setMarkedChanges((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = item
      return next
    })
  }

  function handleSave() {
    startSaving(async () => {
      setConfirmError(null)
      const result = await saveJobChangesModalAction({
        acknowledgedNewJobIds: data.newJobs
          .filter((job) => job.evidenceStatus === 'zapsano')
          .map((job) => job.jobId),
        acknowledgedUpdatedJobs: Object.values(markedChanges).map((item) => ({
          jobId: item.jobId,
          updatedAt: item.updatedAt,
        })),
      })

      if (!result.success) {
        const message = result.error ?? 'Stav modalu se nepodařilo uložit.'
        setError(message)
        setConfirmError(message)
        return
      }

      setMarkedChanges({})
      setIsConfirmOpen(false)
      await reloadData()
      setIsOpen(false)
    })
  }

  const pending = isLoading || isSaving
  const hasItems = data.newJobs.length > 0 || data.updatedJobs.length > 0
  const hasSaveableItems =
    data.newJobs.some((job) => job.evidenceStatus === 'zapsano') ||
    Object.keys(markedChanges).length > 0

  const modalContent = isOpen ? (
    <div
      className="fixed inset-0 z-[160] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal()
      }}
    >
      <div
        className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          className="jobs-page__modal-shell jobs-page__changes-modal relative flex w-full max-w-[1200px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)] xl:h-[min(640px,calc(100dvh-4rem))]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <ModalHeading
                section="ZAKÁZKY"
                title="Sledování změn zakázek"
              />
              <div className="mt-1.5">
                <div
                  className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold tracking-[0.08em] text-white ${
                    hasItems || pending
                      ? 'border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(249,115,22,0.24)]'
                      : 'border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]'
                  }`}
                >
                  {hasItems || pending ? `POČET: ${data.badgeCount}` : 'VŠE ZAPSÁNO'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={closeModal}
              className="jobs-page__changes-close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900"
              aria-label="Zavřít bez uložení označených změn"
            >
              ✕
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4 xl:overflow-hidden">
            <div className="grid gap-4 xl:h-full xl:min-h-0 xl:grid-cols-2">
              <ChangesSection title="NOVÉ ZAKÁZKY" emptyText="Žádné nové zakázky.">
                {data.newJobs.map((job) => (
                  <div
                    key={job.jobId}
                    className="jobs-page__changes-row grid grid-cols-[minmax(0,1fr)_96px] items-center gap-2 rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                  >
                    <div className="min-w-0 text-[11px] leading-4 text-gray-700 sm:text-xs">
                      <div className="truncate text-gray-900" title={`${job.jobNumber} · ${formatDateRange(job.startAt, job.endAt)} · ${job.companyName}`}>
                        <strong>{job.jobNumber}</strong> · <strong>{formatDateRange(job.startAt, job.endAt)}</strong> · {job.companyName}
                      </div>
                      <div className="truncate" title={`${getCityFromAddress(job.siteAddress)} · ${job.technicianName} · ${job.generatorName}`}>
                        {getCityFromAddress(job.siteAddress)} · {job.technicianName} · {job.generatorName}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleEvidenceToggle(job)}
                      data-status={job.evidenceStatus}
                      className={`jobs-page__job-evidence-button inline-flex h-8 min-w-[96px] max-w-full items-center justify-center rounded-xl px-2 text-[11px] font-bold uppercase transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 ${
                        job.evidenceStatus === 'nove'
                          ? 'border border-[#7fb2d6] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_12px_rgba(41,128,185,0.16)]'
                          : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)]'
                      }`}
                    >
                      <span className="truncate">
                        {job.evidenceStatus === 'nove' ? 'ZAPSAT' : 'ZAPSÁNO'}
                      </span>
                    </button>
                  </div>
                ))}
              </ChangesSection>

              <ChangesSection title="PROVEDENÉ ZMĚNY" emptyText="Žádné provedené změny.">
                {data.updatedJobs.map((item) => {
                  const marked = Boolean(markedChanges[changeKey(item)])
                  return (
                    <div
                      key={changeKey(item)}
                      className={`jobs-page__changes-row grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-xl border px-2.5 py-2 text-[11px] leading-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition-colors sm:text-xs ${
                        marked
                          ? 'jobs-page__changes-row--marked border-emerald-300/90 bg-emerald-50/90 text-emerald-950'
                          : 'border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] text-gray-900'
                      }`}
                    >
                      <div className="min-w-0">
                        <strong>{item.jobNumber}</strong> · Změny:{' '}
                        {item.legacyDescription ? item.legacyDescription : null}
                        {item.changes.map((change, index) => (
                          <span key={change.field}>
                            {index > 0 ? ' · ' : ''}
                            {change.label}:{' '}
                            {change.hasPreviousValue ? (
                              <>
                                {change.previousValue} →{' '}
                                <strong>{change.nextValue}</strong>
                              </>
                            ) : (
                              <strong>{change.nextValue}</strong>
                            )}
                          </span>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => toggleChangedJob(item)}
                        aria-label={marked ? `Vrátit změny zakázky ${item.jobNumber}` : `Označit změny zakázky ${item.jobNumber} jako vyřízené`}
                        className={`jobs-page__changes-dismiss inline-flex h-8 w-8 items-center justify-center rounded-xl border text-sm font-bold transition duration-200 hover:-translate-y-[1px] disabled:opacity-60 ${
                          marked
                            ? 'jobs-page__changes-dismiss--marked border-emerald-400 bg-emerald-600 text-white'
                            : 'border-zinc-200 bg-white/80 text-zinc-500 hover:border-emerald-300 hover:text-emerald-700'
                        }`}
                      >
                        ✕
                      </button>
                    </div>
                  )
                })}
              </ChangesSection>
            </div>

            {error ? (
              <div className="jobs-page__changes-error mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </div>

          <footer className="jobs-page__changes-footer flex shrink-0 flex-col items-stretch gap-3 border-t border-[rgba(148,163,184,0.14)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsHelpOpen(true)}
                title="Jak funguje sledování změn zakázek"
                aria-label="Otevřít nápovědu ke sledování změn zakázek"
                className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-sky-300/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(224,242,254,0.9)_100%)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-sky-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_7px_16px_rgba(24,78,129,0.12)] transition duration-200 hover:-translate-y-[1px] hover:border-sky-400 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_20px_rgba(24,78,129,0.18)] [html[data-theme='dark']_&]:border-sky-300/18 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.96)_0%,rgba(12,28,46,0.94)_100%)] [html[data-theme='dark']_&]:text-sky-200 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_18px_rgba(0,0,0,0.22)]"
              >
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current/35 text-[11px] font-bold leading-none">
                  ?
                </span>
                <span className="hidden sm:inline">Nápověda</span>
              </button>
              <p className="max-w-4xl min-w-0 text-left text-[9px] leading-[1.35] text-gray-500 sm:text-[10px]">
                <span className="block">Kliknutím na X u konkrétní změny ji označíte zeleně jako vyřízenou. ULOŽIT odebere z přehledu pouze takto označené změny a zakázky se stavem ZAPSÁNO.</span>
                <span className="block">Zavřením modalu křížkem vpravo nahoře se označení změn zruší, stav ZAPSÁNO u potvrzených zakázek zůstane zachován.</span>
              </p>
            </div>
            <button
              type="button"
              disabled={pending || !hasSaveableItems}
              onClick={() => {
                setConfirmError(null)
                setIsConfirmOpen(true)
              }}
              className="jobs-page__changes-modal-confirm inline-flex h-10 w-full shrink-0 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[132px]"
            >
              {pending ? 'UKLÁDÁM…' : 'ULOŽIT'}
            </button>
          </footer>

          {isHelpOpen && typeof document !== 'undefined' ? createPortal(
            <div className="fixed inset-0 z-[170] flex items-center justify-center bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]">
              <div className="clients-modal__shell flex max-h-[min(80dvh,720px)] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-sky-200/80 bg-[linear-gradient(168deg,rgba(255,255,255,0.97)_0%,rgba(245,250,255,0.95)_52%,rgba(224,242,254,0.9)_100%)] shadow-[0_28px_64px_rgba(24,78,129,0.24)] [html[data-theme='dark']_&]:border-sky-300/16 [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(15,23,42,0.99)_0%,rgba(13,25,42,0.97)_52%,rgba(15,36,55,0.95)_100%)] [html[data-theme='dark']_&]:shadow-[0_28px_64px_rgba(0,0,0,0.44)]">
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-sky-100/90 px-5 py-4 [html[data-theme='dark']_&]:border-sky-300/10 sm:px-6 sm:py-5">
                  <ModalHeading
                    section="ZAKÁZKY"
                    title="Jak funguje sledování změn zakázek"
                  />
                  <button
                    type="button"
                    onClick={() => setIsHelpOpen(false)}
                    aria-label="Zavřít nápovědu"
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white/85 text-sm font-semibold text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme='dark']_&]:border-slate-400/18 [html[data-theme='dark']_&]:bg-slate-950/70 [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:text-white"
                  >
                    ✕
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-sm leading-6 text-zinc-700 [html[data-theme='dark']_&]:text-slate-300 sm:px-6 sm:py-5">
                  <p>
                    Tento modal slouží jako společný pracovní přehled nových zakázek a důležitých změn, které je potřeba zapsat nebo zkontrolovat.
                  </p>

                  <HelpSection title="Počet položek">
                    Oranžové číslo nahoře ukazuje celkový počet nových zakázek a provedených změn, které jsou aktuálně v přehledu.
                  </HelpSection>

                  <HelpSection title="Nové zakázky">
                    <p>V levém sloupci jsou zakázky, které ještě čekají na zapsání.</p>
                    <p>Jakmile máte zakázku zapsanou, klikněte u ní na tlačítko <strong>ZAPSAT</strong>. Tlačítko se změní na <strong>ZAPSÁNO</strong> a tento stav se ihned uloží.</p>
                    <p>Zakázka zatím v přehledu zůstane. Odstraní se z něj až po stisknutí tlačítka <strong>ULOŽIT</strong> a následném potvrzení.</p>
                    <p>Pokud modal zavřete křížkem vpravo nahoře, stav <strong>ZAPSÁNO</strong> zůstane zachovaný.</p>
                    <p>Zakázky označené jako <strong>Marný výjezd</strong> se v tomto přehledu nezobrazují.</p>
                  </HelpSection>

                  <HelpSection title="Provedené změny">
                    <p>V pravém sloupci jsou změny u již zapsaných zakázek.</p>
                    <p>U každé položky vidíte číslo zakázky, změněné pole, původní hodnotu a novou hodnotu. Nová hodnota je zvýrazněná tučně.</p>
                    <div className="rounded-xl border border-sky-200/80 bg-sky-50/75 px-3 py-2 text-sky-950 [html[data-theme='dark']_&]:border-sky-300/12 [html[data-theme='dark']_&]:bg-sky-400/8 [html[data-theme='dark']_&]:text-sky-100">
                      <strong>Začátek:</strong> 5. 8. 06:00 → <strong>5. 8. 07:00</strong>
                    </div>
                    <p>Jakmile máte změnu zapsanou nebo zkontrolovanou, klikněte na tlačítko <strong>X na konci jejího řádku</strong>. Celý řádek se označí zeleně jako vyřízený.</p>
                    <p>Tím se změna ještě neodstraní. Opětovným kliknutím na stejné X můžete zelené označení zrušit.</p>
                  </HelpSection>

                  <HelpSection title="Uložení vyřízených položek">
                    <p>Tlačítko <strong>ULOŽIT</strong> otevře ještě potvrzovací okno.</p>
                    <p>Po potvrzení se z přehledu odeberou pouze zeleně označené provedené změny a nové zakázky se stavem <strong>ZAPSÁNO</strong>.</p>
                    <p>Neoznačené změny a zakázky se stavem <strong>ZAPSAT</strong> v přehledu zůstanou.</p>
                    <p>Tímto krokem se nemažou samotné zakázky ani jejich údaje. Položky se odstraní pouze z tohoto pracovního přehledu.</p>
                  </HelpSection>

                  <HelpSection title="Zavření bez uložení">
                    <p>Křížek v pravém horním rohu zavře celý modal.</p>
                    <p>Pokud modal takto zavřete, zelené označení provedených změn se zruší a změny zůstanou v přehledu. Stav <strong>ZAPSÁNO</strong> u nových zakázek zůstane uložený.</p>
                    <div className="rounded-xl border border-amber-200/90 bg-amber-50/80 px-3 py-2 text-amber-950 [html[data-theme='dark']_&]:border-amber-300/14 [html[data-theme='dark']_&]:bg-amber-400/8 [html[data-theme='dark']_&]:text-amber-100">
                      <strong>Pozor:</strong> X u konkrétní změny ji označuje zeleně. X v pravém horním rohu zavírá celý modal.
                    </div>
                  </HelpSection>

                  <HelpSection title="Společný přehled">
                    <p>Přehled je společný pro všechny uživatele, kteří k němu mají přístup. Když jeden uživatel položky potvrdí a uloží, ostatní je po příštím načtení už neuvidí.</p>
                    <p>Pokud si nejste jistí, zda je položka skutečně zapsaná, ponechte ji v přehledu a neoznačujte ji jako vyřízenou.</p>
                  </HelpSection>
                </div>
              </div>
            </div>,
            document.body
          ) : null}

          {isConfirmOpen && typeof document !== 'undefined' ? createPortal(
            <div className="fixed inset-0 z-[170] flex items-center justify-center bg-zinc-950/38 p-4 backdrop-blur-[5px] lg:backdrop-blur-[6px]">
              <div className="clients-modal__shell w-full max-w-md rounded-[28px] border border-sky-200/80 bg-[linear-gradient(168deg,rgba(255,255,255,0.97)_0%,rgba(239,248,255,0.94)_56%,rgba(224,242,254,0.9)_100%)] p-5 shadow-[0_28px_64px_rgba(24,78,129,0.24)] [html[data-theme='dark']_&]:border-sky-300/16 [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(15,23,42,0.99)_0%,rgba(13,25,42,0.97)_52%,rgba(15,36,55,0.95)_100%)] [html[data-theme='dark']_&]:shadow-[0_28px_64px_rgba(0,0,0,0.44)]">
                <div className="space-y-2">
                  <ModalHeading
                    section="ZAKÁZKY"
                    title="Máte označené položky skutečně zapsané?"
                    variant="compact"
                  />
                  <p className="text-sm leading-6 text-zinc-700 [html[data-theme='dark']_&]:text-slate-300">
                    Z přehledu budou odebrány zeleně označené změny a nové zakázky se stavem ZAPSÁNO. Ostatní položky v přehledu zůstanou.
                  </p>
                </div>

                {confirmError ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 [html[data-theme='dark']_&]:border-red-400/20 [html[data-theme='dark']_&]:bg-red-500/10 [html[data-theme='dark']_&]:text-red-200">
                    {confirmError}
                  </div>
                ) : null}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (isSaving) return
                      setIsConfirmOpen(false)
                      setConfirmError(null)
                    }}
                    disabled={isSaving}
                    className="inline-flex items-center justify-center rounded-2xl border border-red-500/90 bg-[linear-gradient(155deg,rgba(239,68,68,0.96)_0%,rgba(220,38,38,0.96)_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(185,28,28,0.24)] transition duration-200 hover:-translate-y-[1px] hover:border-red-400 hover:bg-[linear-gradient(155deg,rgba(248,86,86,0.98)_0%,rgba(230,45,45,0.98)_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_13px_26px_rgba(185,28,28,0.3)] [html[data-theme='dark']_&]:border-red-400/24 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(62,19,27,0.84)_0%,rgba(50,14,24,0.9)_100%)] [html[data-theme='dark']_&]:text-red-200 [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_22px_rgba(0,0,0,0.24)] disabled:pointer-events-none disabled:opacity-60"
                  >
                    ZRUŠIT
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="jobs-page__changes-modal-confirm inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:pointer-events-none disabled:opacity-60"
                  >
                    {isSaving ? 'UKLÁDÁM…' : 'POTVRDIT A ULOŽIT'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          ) : null}
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <ChangesButton
        count={data.badgeCount}
        className={className}
        isLoading={isLoading}
        onClick={openModal}
      />
      {modalContent && typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : null}
    </>
  )
}

function ChangesSection({
  title,
  emptyText,
  children,
}: {
  title: string
  emptyText: string
  children: ReactNode
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)

  return (
    <section className="jobs-page__changes-section flex min-h-0 flex-col rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(15,23,42,0.08)]">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.04em] text-gray-900">
        {title}
      </h3>
      {hasChildren ? (
        <div className="jobs-page__changes-list min-h-0 space-y-1.5 xl:flex-1 xl:overflow-y-auto xl:pr-1">
          {children}
        </div>
      ) : (
        <div className="flex min-h-[120px] flex-1 items-center justify-center px-4 py-8 text-center">
          <p className="text-sm text-gray-500">{emptyText}</p>
        </div>
      )}
    </section>
  )
}

function HelpSection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="mt-5 border-t border-sky-100/90 pt-4 [html[data-theme='dark']_&]:border-sky-300/10">
      <h4 className="mb-2 text-sm font-semibold uppercase tracking-[0.05em] text-zinc-950 [html[data-theme='dark']_&]:text-slate-50">
        {title}
      </h4>
      <div className="space-y-2.5">{children}</div>
    </section>
  )
}

function formatDateRange(startAt: string | null, endAt: string | null) {
  if (!startAt) return '—'
  const start = new Date(startAt)
  if (Number.isNaN(start.getTime())) return '—'
  const startDay = getDayMonth(start)
  if (!endAt) return startDay
  const end = new Date(endAt)
  if (Number.isNaN(end.getTime())) return startDay
  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()
  return sameDay ? startDay : `${getDayOnly(start)} - ${getDayMonth(end)}`
}

function getCityFromAddress(address: string | null) {
  const value = String(address ?? '').trim()
  if (!value) return '—'
  return value.split(',')[0]?.trim() || value
}

function getDayMonth(value: Date) {
  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(value)
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  return day && month ? `${day}.${month}.` : '—'
}

function getDayOnly(value: Date) {
  const day = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
  })
    .formatToParts(value)
    .find((part) => part.type === 'day')?.value
  return day ? `${day}.` : '—'
}
