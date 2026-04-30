import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import type {
  OfferClient,
  OfferItemRow,
  OfferProfile,
  OfferRow,
  OfferServiceItemRow,
} from '@/lib/offers/types'
import { BSafe24OfferPdf } from './bsafe24-offer-pdf'
import { ClassicOfferPdf } from './classic-offer-pdf'

type OfferPdfPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ standalone?: string; print?: string }>
}

function sanitizePdfTitlePart(value: string | null | undefined) {
  return (value ?? '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function getOfferPdfTitle(offer: Pick<OfferRow, 'offer_number' | 'title'>) {
  const offerNumber = sanitizePdfTitlePart(offer.offer_number)
  const title = sanitizePdfTitlePart(offer.title)

  return [offerNumber, title].filter(Boolean).join(' - ') || 'Nabidka'
}

export async function generateMetadata({
  params,
}: Pick<OfferPdfPageProps, 'params'>): Promise<Metadata> {
  const { id } = await params
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let offerQuery = supabase
    .from('offers')
    .select('offer_number, title')
    .eq('id', id)

  if (!isAdmin) {
    offerQuery = offerQuery.eq('created_by', profile.id)
  }

  const { data } = await offerQuery.single<Pick<OfferRow, 'offer_number' | 'title'>>()

  return {
    title: data ? getOfferPdfTitle(data) : 'Nabidka',
  }
}

export default async function OfferPdfPage({ params, searchParams }: OfferPdfPageProps) {
  const { id } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const isStandalone = resolvedSearchParams?.standalone === '1'
  const shouldAutoPrint = resolvedSearchParams?.print === '1'
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let offerQuery = supabase.from('offers').select('*').eq('id', id)

  if (!isAdmin) {
    offerQuery = offerQuery.eq('created_by', profile.id)
  }

  const offerResponse = await offerQuery.single<OfferRow>()

  if (offerResponse.error || !offerResponse.data) {
    notFound()
  }

  const offer = offerResponse.data

  const [clientResponse, itemsResponse, serviceItemsResponse, authorResponse] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, ico, contact_person, contact_email, address, created_by')
      .eq('id', offer.client_id)
      .single<OfferClient>(),
    supabase
      .from('offer_items')
      .select('*')
      .eq('offer_id', offer.id)
      .order('position', { ascending: true }),
    supabase
      .from('offer_service_items')
      .select('*')
      .eq('offer_id', offer.id)
      .order('position', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, name, role, can_view_offers, offer_prepared_by_name, offer_prepared_by_phone, offer_prepared_by_email')
      .eq('id', offer.created_by)
      .maybeSingle<OfferProfile>(),
  ])

  if (clientResponse.error || !clientResponse.data) {
    notFound()
  }

  if (itemsResponse.error || serviceItemsResponse.error) {
    throw new Error('Nepodařilo se načíst data nabídky pro PDF.')
  }

  const pdfProps = {
    offer,
    client: clientResponse.data,
    items: (itemsResponse.data ?? []) as OfferItemRow[],
    serviceItems: (serviceItemsResponse.data ?? []) as OfferServiceItemRow[],
    authorProfile: authorResponse.data ?? null,
    isStandalone,
    shouldAutoPrint,
  }

  if (offer.offer_type === 'bsafe24') {
    return <BSafe24OfferPdf {...pdfProps} />
  }

  return <ClassicOfferPdf {...pdfProps} />
}
