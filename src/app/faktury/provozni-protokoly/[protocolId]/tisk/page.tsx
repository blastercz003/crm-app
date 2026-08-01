import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getOperationalProtocolDetailAction } from '../../../operational-protocol-actions'
import { OperationalProtocolPrintView } from './print-view'

function getPrintTitle(fileName: string) {
  return fileName.replace(/\.pdf$/i, '') || 'Provozní protokol'
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ protocolId: string }>
}): Promise<Metadata> {
  const { protocolId } = await params
  const result = await getOperationalProtocolDetailAction(protocolId)

  return {
    title: {
      absolute: result.success
        ? getPrintTitle(result.data.pdfFileName)
        : 'Provozní protokol',
    },
  }
}

export default async function OperationalProtocolPrintPage({
  params,
}: {
  params: Promise<{ protocolId: string }>
}) {
  const { protocolId } = await params
  const result = await getOperationalProtocolDetailAction(protocolId)

  if (!result.success) notFound()

  return (
    <OperationalProtocolPrintView
      protocolId={result.data.id}
      fileName={result.data.pdfFileName}
    />
  )
}
