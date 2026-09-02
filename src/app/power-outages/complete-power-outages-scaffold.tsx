import { Building2, Database, MapPinned, SearchCheck } from 'lucide-react'

const SUMMARY = [
  { label: 'NALEZENÉ ODSTÁVKY', icon: Database, tone: 'blue' },
  { label: 'NALEZENÉ FIRMY', icon: Building2, tone: 'amber' },
  { label: 'K OVĚŘENÍ', icon: SearchCheck, tone: 'violet' },
  { label: 'ZPRACOVANÉ ADRESY', icon: MapPinned, tone: 'slate' },
] as const

export function CompletePowerOutagesScaffold() {
  return (
    <div aria-label="Kompletní vyhledávání odstávek">
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Připravovaný souhrn kompletních odstávek">
        {SUMMARY.map(({ label, icon: Icon, tone }) => (
          <article
            key={label}
            data-tone={tone}
            className="activities-page__panel activities-workspace__kpi relative min-h-[92px] overflow-hidden rounded-[22px] border p-[14px] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.08)] sm:min-h-[88px] sm:p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="block min-h-6 text-[9px] font-semibold uppercase leading-3 tracking-[0.045em] text-[var(--text-secondary)] sm:min-h-0 sm:text-[10px] sm:tracking-[0.08em]">{label}</span>
                <strong className="mt-1.5 block text-[26px] font-semibold leading-none text-[var(--text-primary)] sm:text-[28px]">—</strong>
              </div>
              <span className="activities-page__summary-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" data-tone={tone}>
                <Icon aria-hidden size={17} />
              </span>
            </div>
          </article>
        ))}
      </section>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3">
        <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] sm:p-5 xl:col-span-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[var(--text-secondary)]">Databáze distributorů</span>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">Přehled kompletních odstávek</h2>
          <div className="mt-5 flex min-h-[420px] items-center justify-center rounded-[22px] border border-dashed border-[var(--surface-border)] bg-[var(--surface-muted)] px-6 text-center">
            <div className="max-w-md">
              <Database aria-hidden className="mx-auto text-[#2980b9]" size={28} />
              <strong className="mt-3 block text-sm text-[var(--text-primary)]">Samostatná datová vrstva je připravena k napojení</strong>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">V dalších krocích sem připojíme kompletní sběr odstávek a vyhledávání firem z oddělených zdrojů.</p>
            </div>
          </div>
        </section>

        <aside className="grid min-w-0 gap-4" aria-label="Připravované provozní panely">
          {['STAV DISTRIBUTORŮ', 'VYHLEDÁVÁNÍ FIREM', 'POKRYTÍ ADRES'].map((label) => (
            <section key={label} className="activities-page__panel min-h-[148px] rounded-[24px] border border-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(15,23,42,0.08)]">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{label}</span>
              <div className="mt-4 h-2 w-3/4 rounded-full bg-[var(--surface-muted)]" />
              <div className="mt-3 h-2 w-1/2 rounded-full bg-[var(--surface-muted)]" />
            </section>
          ))}
        </aside>
      </div>
    </div>
  )
}
