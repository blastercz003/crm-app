'use client'

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

export type ActivitiesHelpTabId =
  | 'agenda'
  | 'events'
  | 'sticky-notes'
  | 'tasks'
  | 'meetings'
  | 'offers'
  | 'jobs'

type HelpTab = {
  id: ActivitiesHelpTabId
  label: string
  content: ReactNode
}

function HelpBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_22px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-slate-700/55 [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(18,29,48,0.96)_0%,rgba(10,18,31,0.96)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_26px_rgba(0,0,0,0.22)] sm:p-5">
      <h3 className="text-sm font-semibold text-zinc-950 [html[data-theme='dark']_&]:text-slate-50 sm:text-base">
        {title}
      </h3>
      <div className="mt-2.5 text-sm leading-6 text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
        {children}
      </div>
    </section>
  )
}

function HelpList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-[#2980B9]">{children}</ul>
}

const HELP_TABS: HelpTab[] = [
  {
    id: 'agenda',
    label: 'Pracovní agenda',
    content: (
      <div className="space-y-3">
        <HelpBlock title="K čemu panel slouží">
          <p>Pracovní agenda je hlavní místo pro evidenci vaší vlastní obchodní práce. Zapisujete sem již provedené činnosti a zároveň si plánujete, co chcete udělat později. Na jednom místě tak vidíte například uskutečněné telefonáty, odeslané e-maily, osobní kontakty, obecné pracovní zápisy i další naplánované kroky.</p>
        </HelpBlock>
        <HelpBlock title="Vytvoření nové aktivity">
          <HelpList>
            <li>Klikněte na tlačítko <strong>NOVÁ</strong> v záhlaví panelu nebo na <strong>NOVÁ AKTIVITA</strong> v horní části stránky.</li>
            <li>Vyberte <strong>Zapsat činnost</strong>, pokud už práce proběhla, nebo <strong>Naplánovat aktivitu</strong>, pokud si vytváříte budoucí krok.</li>
            <li>Zvolte typ činnosti: Telefon, E-mail, Kontakt, Zápis nebo Ostatní. Typ pomáhá rychle poznat, o jakou práci se jedná.</li>
            <li>Do hlavního textu stručně a srozumitelně napište, co jste udělali nebo co plánujete udělat.</li>
            <li>Aktivitu můžete propojit s klientem pomocí našeptávače. Pokud se netýká konkrétního klienta, lze ji uložit také bez klienta.</li>
            <li>Do doplňující poznámky můžete zapsat podrobnosti, domluvený postup nebo další informace, které se nevejdou do krátkého názvu.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Otevření celého záznamu v pop-upu">
          <HelpList>
            <li>Klikněte kamkoliv na kartu aktivity mimo samostatná ovládací tlačítka.</li>
            <li>Otevře se přehledný pop-up s celým textem. To je užitečné hlavně tehdy, když je dlouhý text na malé kartě zkrácený.</li>
            <li>V pop-upu uvidíte stav aktivity, její typ, klienta, datum nebo termín, celý hlavní text a doplňující poznámku.</li>
            <li>Naplánovanou aktivitu lze z pop-upu dokončit nebo upravit. U již zapsané činnosti je možné otevřít úpravu záznamu.</li>
            <li>Pop-up zavřete křížkem, kliknutím mimo něj nebo klávesou Escape. Otevřením pop-upu se nepřesouváte na jinou stránku.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Naplánované">
          <HelpList>
            <li>V levé části panelu jsou činnosti, které teprve čekají na provedení. U každé vidíte název, typ, klienta a termín.</li>
            <li>Zvoneček označuje zapnutou notifikaci. Symbol opakování znamená, že se má po dokončení automaticky vytvořit další stejná aktivita.</li>
            <li>Na desktopu jsou přímo na kartě také rychlá tlačítka pro dokončení, úpravu a odstranění. Na mobilu se správa provádí po otevření pop-upu.</li>
            <li>Při dokončení můžete do malého formuláře volitelně zapsat výsledek, například co bylo domluveno.</li>
            <li>Dokončený záznam nezmizí. Přesune se do části <strong>Poslední zápisy</strong>, kde zůstane jako evidence provedené práce.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Notifikace a opakování">
          <HelpList>
            <li>Notifikaci lze zapnout pouze u naplánované aktivity. Upozornění přijde 15 minut před nastaveným termínem do společné sekce Notifikace a při povolených PWA oznámeních také do zařízení.</li>
            <li>Opakování použijte pro pravidelnou činnost, například týdenní kontakt s klientem nebo měsíční kontrolu.</li>
            <li>Po dokončení aktuální aktivity aplikace automaticky vytvoří její další výskyt. Nevznikají tedy všechny budoucí záznamy najednou.</li>
            <li>Nastavit lze denní, týdenní, měsíční nebo vlastní interval. Opakování pokračuje, dokud jej u aktivity neukončíte.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Poslední zápisy">
          <HelpList>
            <li>V pravé části panelu najdete již provedené činnosti a aktivity, které byly původně naplánované a následně dokončené.</li>
            <li>Kliknutím na celou kartu otevřete pop-up s nezkráceným obsahem a všemi dostupnými údaji.</li>
            <li>Vlastní ruční zápis můžete upravit nebo odstranit. Odstranění je chráněné potvrzovacím krokem, aby k němu nedošlo omylem.</li>
            <li>Pokud záznam upravujete, otevře se standardní editační modal a náhledový pop-up se automaticky zavře.</li>
            <li>Běžný uživatel vidí pouze svoji agendu. Administrátor může na desktopu přepnout konkrétního uživatele a zobrazit jeho práci.</li>
          </HelpList>
        </HelpBlock>
      </div>
    ),
  },
  {
    id: 'events',
    label: 'Poslední události',
    content: (
      <HelpBlock title="Automatická historie práce">
        <HelpList>
          <li>Panel automaticky zaznamenává například vytvoření nabídky, změnu jejího stavu, komentář, úkol nebo schůzku.</li>
          <li>U každé události vidíte, kdo ji provedl, co se stalo a kdy.</li>
          <li>Kliknutím na záznam přejdete do související části aplikace.</li>
          <li>Seznam se průběžně aktualizuje a lze v něm scrollovat.</li>
          <li>Tlačítkem <strong>VŠE</strong> otevřete kompletní historii.</li>
          <li>Běžný uživatel vidí své události, administrátor události všech uživatelů.</li>
          <li>Záznamy se zde nepřidávají ani neupravují ručně.</li>
        </HelpList>
      </HelpBlock>
    ),
  },
  {
    id: 'sticky-notes',
    label: 'Lístečky',
    content: (
      <div className="space-y-3">
        <HelpBlock title="K čemu Lístečky slouží">
          <p>Lístečky jsou vaše soukromá pracovní plocha pro rychlé poznámky, připomínky, nápady nebo informace, které si potřebujete dočasně odložit. Hodí se pro věci, ze kterých zatím nechcete vytvářet plnohodnotný úkol ani aktivitu, ale nechcete na ně zapomenout.</p>
        </HelpBlock>
        <HelpBlock title="Vytvoření Lístečku">
          <HelpList>
            <li>Klikněte na <strong>NOVÝ</strong>.</li>
            <li>Zadejte hlavní obsah poznámky. Nadpis je volitelný, ale u většího počtu Lístečků usnadňuje orientaci.</li>
            <li>Lísteček můžete volitelně propojit s klientem pomocí našeptávače. Název klienta se potom zobrazí přímo na kartě.</li>
            <li>Vyberte jednu z nabízených barev. Barva slouží pouze pro lepší vizuální rozlišení a nemění funkci Lístečku.</li>
            <li>Volbou <strong>Připnout</strong> umístíte důležitý Lísteček mezi první zobrazené. Aktivní volbu poznáte podle fajfky a nepřeškrtnutého připínáčku.</li>
            <li>Volbou <strong>Připomenout</strong> nastavíte datum a čas upozornění. Notifikace přijde 15 minut před zvoleným termínem.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Procházení Lístečků">
          <HelpList>
            <li>Připnutý Lísteček je označen připínáčkem, Lísteček se zapnutou notifikací symbolem zvonečku.</li>
            <li>Na desktopu se větší počet Lístečků skládá přes sebe. Najetím myši se vybraný Lísteček zvýrazní a odkryje; mezi Lístečky lze přecházet také šipkami.</li>
            <li>Na mobilu Lístečky posouváte tahem prstu doleva nebo doprava, případně použijete šipky nad pracovní plochou.</li>
            <li>Číslo nad Lístečky ukazuje pořadí právě zobrazeného Lístečku a jejich celkový počet.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Otevření Lístečku v pop-upu">
          <HelpList>
            <li>Klikněte kamkoliv na Lísteček mimo jeho samostatná ovládací tlačítka.</li>
            <li>Otevře se barevný pop-up ve stejné barvě jako Lísteček. Zobrazí celý nadpis, nezkrácený text, klienta a případné připomenutí.</li>
            <li>Ve spodní části pop-upu najdete ovládání pro převod, připnutí nebo odepnutí, úpravu a archivaci. Nemusíte proto pracovat s malými tlačítky přímo na kartě.</li>
            <li>Pop-up zavřete křížkem, kliknutím mimo něj nebo klávesou Escape. Po otevření editačního modalu se náhledový pop-up zavře.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Správa Lístečku">
          <HelpList>
            <li>Lísteček můžete kdykoliv upravit, připnout nebo odepnout, archivovat či přesunout do koše.</li>
            <li>Archiv použijte pro poznámky, které už nepotřebujete na pracovní ploše, ale chcete si je ponechat.</li>
            <li>Koš slouží pro odstraněné Lístečky. Z koše je lze ještě obnovit, než dojde k jejich definitivnímu vymazání.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Převod na úkol nebo aktivitu">
          <HelpList>
            <li>Tlačítkem se symbolem úkolu převedete obsah Lístečku do nového úkolu. Tlačítkem se symbolem zápisu jej převedete do nové ruční aktivity.</li>
            <li>Otevře se příslušný formulář s předvyplněným textem a klientem. Všechny údaje můžete před konečným uložením upravit nebo doplnit.</li>
            <li>Převod pouze připraví nový záznam; úkol nebo aktivita vznikne až po potvrzení příslušného formuláře.</li>
            <li>Původní Lísteček zůstane zachovaný, dokud jej sami nearchivujete nebo nepřesunete do koše.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Všechny Lístečky a soukromí">
          <HelpList>
            <li>Tlačítko <strong>VŠECHNY LÍSTEČKY</strong> otevře samostatný přehled, ve kterém lze přepínat mezi aktivními Lístečky, archivem a košem.</li>
            <li>Lísteček lze z archivu nebo koše obnovit zpět. Obsah koše se automaticky definitivně odstraní po 30 dnech.</li>
            <li>Lístečky jsou vždy soukromé. Nevidí je vaši kolegové ani administrátor.</li>
            <li>Nezahrnují se do administrátorského přehledu ani exportu aktivit.</li>
          </HelpList>
        </HelpBlock>
      </div>
    ),
  },
  {
    id: 'tasks',
    label: 'Úkoly',
    content: (
      <HelpBlock title="Úkoly">
        <HelpList>
          <li>Panel zobrazuje aktuální úkoly uživatele.</li>
          <li>Kliknutím na celou kartu otevřete pop-up, aniž byste opustili stránku Obchodní aktivita.</li>
          <li>V pop-upu uvidíte klienta, termín, přiřazeného uživatele, zadavatele, kontaktní osobu, opakování, datum vytvoření a celé zadání úkolu.</li>
          <li>Z pop-upu lze úkol upravit, dokončit nebo otevřít jeho celý detail v sekci Úkoly.</li>
          <li>Tlačítkem <strong>NOVÝ</strong> vytvoříte úkol přímo ze stránky Obchodní aktivita.</li>
          <li>Tlačítko <strong>VŠECHNY</strong> otevře celou sekci Úkoly.</li>
        </HelpList>
      </HelpBlock>
    ),
  },
  {
    id: 'meetings',
    label: 'Schůzky',
    content: (
      <HelpBlock title="Schůzky">
        <HelpList>
          <li>Panel zobrazuje nejbližší naplánované schůzky.</li>
          <li>Kliknutím na celou kartu otevřete pop-up, aniž byste opustili stránku Obchodní aktivita.</li>
          <li>V pop-upu uvidíte termín, přiřazeného uživatele, klienta, kontaktní osobu, telefon, e-mail, adresu, datum vytvoření a celé poznámky.</li>
          <li>Z pop-upu lze schůzku upravit nebo otevřít její celý detail v sekci Schůzky.</li>
          <li>Tlačítkem <strong>NOVÁ</strong> založíte schůzku přímo ze stránky Obchodní aktivita.</li>
          <li>Tlačítko <strong>VŠECHNY</strong> otevře celou sekci Schůzky.</li>
        </HelpList>
      </HelpBlock>
    ),
  },
  {
    id: 'offers',
    label: 'Nabídky',
    content: (
      <HelpBlock title="Nabídky">
        <HelpList>
          <li>Panel zobrazuje nabídky v aktuálně vybraném stavu.</li>
          <li>Tlačítkem <strong>STAV</strong> přepnete zobrazovaný stav nabídek.</li>
          <li>Kliknutím na celou kartu otevřete pop-up, aniž byste opustili stránku Obchodní aktivita.</li>
          <li>Pop-up zobrazí klienta, autora, typ a verzi nabídky, počet položek, platnost, poslední úpravu, cenu, interní poznámku a u nabídek v řešení poslední vložený komentář.</li>
          <li>Z náhledu lze otevřít PDF nebo celý detail nabídky.</li>
          <li>Tlačítkem <strong>NOVÁ</strong> zahájíte standardní vytvoření nabídky přímo ze stránky Obchodní aktivita.</li>
          <li>Tlačítko <strong>VŠECHNY</strong> otevře celou sekci Nabídky.</li>
        </HelpList>
      </HelpBlock>
    ),
  },
  {
    id: 'jobs',
    label: 'Zakázky',
    content: (
      <div className="space-y-3">
        <HelpBlock title="Zakázky">
          <HelpList>
            <li>Panel zobrazuje zakázky podle vybraného období a stavu.</li>
            <li>Tlačítkem <strong>FILTR</strong> změníte období nebo stav.</li>
            <li>Kliknutím na celou kartu otevřete pop-up, aniž byste opustili stránku Obchodní aktivita.</li>
            <li>V pop-upu uvidíte obchodníka, technika, agregát, kontaktní osobu, začátek a konec, adresu, prodejnu, evidenci, fakturaci a celé informace k zakázce.</li>
            <li>Administrátor může zakázku z náhledu upravit. Běžní uživatelé mají náhled pouze pro čtení.</li>
            <li>Tlačítkem <strong>NOVÁ</strong> založíte zakázku přímo ze stránky Obchodní aktivita.</li>
            <li>Tlačítko <strong>VŠECHNY</strong> otevře celou sekci Zakázky.</li>
          </HelpList>
        </HelpBlock>
        <HelpBlock title="Mobilní zobrazení">
          <p>Na mobilu jsou panely Úkoly, Schůzky, Nabídky a Zakázky spojené do jednoho přepínače. Mezi panely přecházíte výběrem příslušné záložky.</p>
        </HelpBlock>
      </div>
    ),
  },
]

export function ActivitiesHelpModal({
  open,
  onClose,
  initialTab = 'agenda',
}: {
  open: boolean
  onClose: () => void
  initialTab?: ActivitiesHelpTabId
}) {
  const [activeTab, setActiveTab] = useState<ActivitiesHelpTabId>(initialTab)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useBodyScrollLock(open)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const frame = window.requestAnimationFrame(() => {
      setActiveTab(initialTab)
      closeButtonRef.current?.focus()
    })

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', closeOnEscape)
      previouslyFocused?.focus()
    }
  }, [initialTab, onClose, open])

  if (!open || typeof document === 'undefined') return null

  const activeIndex = HELP_TABS.findIndex((tab) => tab.id === activeTab)
  const activeContent = HELP_TABS[activeIndex]?.content ?? HELP_TABS[0].content

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (activeIndex + 1) % HELP_TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (activeIndex - 1 + HELP_TABS.length) % HELP_TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = HELP_TABS.length - 1
    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = HELP_TABS[nextIndex]
    setActiveTab(nextTab.id)
    document.getElementById(`activities-help-tab-${nextTab.id}`)?.focus()
  }

  return createPortal(
    <div
      className="activities-help-modal fixed inset-0 z-[150] overflow-hidden overscroll-none bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activities-help-title"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="flex h-full min-h-0 items-center justify-center" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <section className="flex h-full min-h-0 w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_34px_88px_rgba(24,24,27,0.38)] [html[data-theme='dark']_&]:border-slate-700/55 [html[data-theme='dark']_&]:bg-[linear-gradient(168deg,rgba(8,13,23,0.99)_0%,rgba(13,22,37,0.98)_100%)] sm:h-[min(760px,calc(100dvh-2rem))]">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 [html[data-theme='dark']_&]:border-slate-700/45 sm:px-6">
            <ModalHeading id="activities-help-title" section="OBCHODNÍ AKTIVITA" title="Nápověda" />
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Zavřít nápovědu"
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-white/90 text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(15,23,42,0.1)] transition hover:-translate-y-px hover:text-zinc-950 [html[data-theme='dark']_&]:border-slate-700/60 [html[data-theme='dark']_&]:bg-slate-900/90 [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:text-white"
            >
              <X aria-hidden size={18} />
            </button>
          </header>

          <div
            role="tablist"
            aria-label="Části nápovědy"
            className="flex shrink-0 gap-2 overflow-x-auto overscroll-x-contain border-b border-zinc-200/75 px-5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [html[data-theme='dark']_&]:border-slate-700/45 sm:px-6"
          >
            {HELP_TABS.map((tab) => {
              const selected = tab.id === activeTab
              return (
                <button
                  key={tab.id}
                  id={`activities-help-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="activities-help-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={handleTabKeyDown}
                  className={`inline-flex h-9 shrink-0 items-center justify-center rounded-xl border px-3.5 text-[11px] font-semibold transition hover:-translate-y-px ${selected
                    ? 'border-[#2980B9] bg-[#2980B9] text-white shadow-[0_8px_18px_rgba(41,128,185,0.24)] [html[data-theme=dark]_&]:border-[#4f84ad] [html[data-theme=dark]_&]:bg-[#285f89]'
                    : 'border-white/80 bg-white/72 text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] hover:text-zinc-950 [html[data-theme=dark]_&]:border-slate-700/55 [html[data-theme=dark]_&]:bg-slate-900/75 [html[data-theme=dark]_&]:text-slate-300 [html[data-theme=dark]_&]:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div
            id="activities-help-panel"
            role="tabpanel"
            aria-labelledby={`activities-help-tab-${activeTab}`}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable] sm:px-6"
          >
            {activeContent}
          </div>

          <footer className="flex shrink-0 justify-end border-t border-zinc-200/75 px-5 py-3 [html[data-theme='dark']_&]:border-slate-700/45 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="standard-form-modal__primary-action inline-flex items-center justify-center"
            >
              ZAVŘÍT NÁPOVĚDU
            </button>
          </footer>
        </section>
      </div>
    </div>,
    document.body,
  )
}
