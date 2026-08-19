import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getHandoverProtocolPreviewData } from '@/app/jobs/handover-protocol-actions'
import { joinTitleParts } from '@/lib/pageTitles'
import { HandoverProtocolDocument } from './document'
import { HandoverProtocolAutoPrint, HandoverProtocolMobilePreviewControls, HandoverProtocolPrintToolbar } from './print-view'

type HandoverProtocolPreviewPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ standalone?: string; print?: string; mobilePreview?: string; returnTo?: string }>
}

export async function generateMetadata({
  params,
}: Pick<HandoverProtocolPreviewPageProps, 'params'>): Promise<Metadata> {
  const { id } = await params
  const result = await getHandoverProtocolPreviewData(id)
  const jobTitle = result.success
    ? joinTitleParts(
        result.data?.job.job_number,
        result.data?.protocol.handover_title
      )
    : ''

  return {
    title: {
      absolute: jobTitle || 'Předávací protokol',
    },
  }
}

export default async function HandoverProtocolPreviewPage({
  params,
  searchParams,
}: HandoverProtocolPreviewPageProps) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const isStandalone = resolvedSearchParams?.standalone === '1'
  const shouldAutoPrint = resolvedSearchParams?.print === '1'
  const mobilePreview = resolvedSearchParams?.mobilePreview === '1'
  const mobileBackHref = resolvedSearchParams?.returnTo === 'technician-jobs' ? '/zakazky-techniku' : '/jobs'

  const result = await getHandoverProtocolPreviewData(id)

  if (!result.success || !result.data) {
    notFound()
  }

  return (
    <>
      {shouldAutoPrint ? <HandoverProtocolAutoPrint /> : null}
      {mobilePreview ? <HandoverProtocolMobilePreviewControls backHref={mobileBackHref} /> : null}
      {!isStandalone ? (
        <div className="mx-auto max-w-[860px] pt-6">
          <HandoverProtocolPrintToolbar
            backHref="/jobs"
            printHref={`/jobs/${id}/pp?standalone=1&print=1`}
          />
        </div>
      ) : null}
      <HandoverProtocolDocument data={result.data} standalone={isStandalone} mobilePreview={mobilePreview} />
    </>
  )
}
