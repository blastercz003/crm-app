import type { CompletePowerOutageWorkspace } from '@/lib/power-outages/complete-types'
import { CompletePowerOutageRecords } from './complete-power-outage-records'
import { CompletePowerOutageSidebar } from './complete-power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

export function CompletePowerOutagesDashboard({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const confirmedMatchCount = Math.max(
    0,
    workspace.statistics.currentCompanyCount - workspace.statistics.needsReviewCount,
  )
  const cards: PowerOutageSummaryCard[] = [
    { label: 'AKTUÁLNÍ ODSTÁVKY', value: workspace.statistics.currentOutageCount, tone: 'blue' },
    { label: 'NALEZENÉ SHODY', value: workspace.statistics.currentCompanyCount, tone: 'violet' },
    { label: 'POTVRZENÉ SHODY', value: confirmedMatchCount, tone: 'emerald', icon: 'check' },
    { label: 'K OVĚŘENÍ', value: workspace.statistics.needsReviewCount, tone: 'amber', icon: 'review' },
  ]
  return <><PowerOutageSummaryStats cards={cards} /><div className="grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3"><CompletePowerOutageRecords workspace={workspace} /><CompletePowerOutageSidebar workspace={workspace} /></div></>
}
