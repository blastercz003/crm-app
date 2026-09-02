import type { CompletePowerOutageWorkspace } from '@/lib/power-outages/complete-types'
import { CompletePowerOutageRecords } from './complete-power-outage-records'
import { CompletePowerOutageSidebar } from './complete-power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

export function CompletePowerOutagesDashboard({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const cards: PowerOutageSummaryCard[] = [
    { label: 'NALEZENÉ ODSTÁVKY', value: workspace.statistics.currentOutageCount, tone: 'blue' },
    { label: 'NALEZENÉ FIRMY', value: workspace.statistics.currentCompanyCount, tone: 'amber' },
    { label: 'K OVĚŘENÍ', value: workspace.statistics.needsReviewCount, tone: 'violet' },
    { label: 'ZPRACOVANÉ ADRESY', value: workspace.statistics.normalizedAddressCount, tone: 'slate' },
  ]
  return <><PowerOutageSummaryStats cards={cards} /><div className="grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3"><CompletePowerOutageRecords workspace={workspace} /><CompletePowerOutageSidebar workspace={workspace} /></div></>
}
