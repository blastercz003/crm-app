import { notFound } from 'next/navigation'
import { getHandoverProtocolPreviewData } from '@/app/jobs/handover-protocol-actions'
import { HandoverProtocolDocument } from './document'
import { HandoverProtocolPrintToolbar } from './print-view'

export default async function HandoverProtocolPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ standalone?: string }>
}) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const isStandalone = resolvedSearchParams?.standalone === '1'

  const result = await getHandoverProtocolPreviewData(id)

  if (!result.success || !result.data) {
    notFound()
  }

  return (
    <>
      {!isStandalone ? (
        <div className="mx-auto max-w-[860px] pt-6">
          <HandoverProtocolPrintToolbar
            backHref="/jobs"
            printHref={`/jobs/${id}/pp/pdf`}
          />
        </div>
      ) : null}
      <HandoverProtocolDocument data={result.data} standalone={isStandalone} />
    </>
  )
}
