'use client'

import type { PowerOutageWorkspace } from '@/lib/power-outages/types'
import { PowerOutageRecords } from './power-outage-records'
import { PowerOutageSidebar } from './power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

export function PowerOutagesDashboard({ workspace }: { workspace: PowerOutageWorkspace }) {
  const summaryCards: PowerOutageSummaryCard[] = [
    { label: 'ANALYZOVÁNO', value: workspace.statistics.analyzedOutageCount, tone: 'blue' },
    { label: 'NALEZENÉ ODSTÁVKY', value: workspace.statistics.currentMatchCount, tone: 'amber' },
    { label: 'K OVĚŘENÍ', value: workspace.statistics.needsReviewCount, tone: 'violet' },
    { label: 'ARCHIVOVÁNO', value: workspace.statistics.archivedMatchCount, tone: 'slate' },
  ]

  return (
    <>
      <PowerOutageSummaryStats cards={summaryCards} />

      <div className="grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3">
        <PowerOutageRecords workspace={workspace} />

        <PowerOutageSidebar
          preferences={workspace.preferences}
          sources={workspace.sources}
          storeCoverage={workspace.storeCoverage}
        />
      </div>
    </>
  )
}
