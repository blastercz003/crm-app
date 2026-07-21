import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getOfferRuntimeContext } from '@/lib/offers/permissions'
import { joinTitleParts } from '@/lib/pageTitles'
import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'
import type {
  OfferClient,
  OfferClientContact,
  OfferItemRow,
  OfferProgressNoteRow,
  OfferProfile,
  OfferRow,
  OfferServiceItemRow,
} from '@/lib/offers/types'
import { BSafe24OfferDetail } from './bsafe24-offer-detail'
import { ClassicOfferDetail } from './classic-offer-detail'

type OfferDetailPageProps = {
  params: Promise<{ id: string }>
  searchParams?: Promise<{ saved?: string; submitted?: string }>
}

export async function generateMetadata({
  params,
}: Pick<OfferDetailPageProps, 'params'>): Promise<Metadata> {
  const { id } = await params
  const { supabase, profile, isAdmin } = await getOfferRuntimeContext()

  let offerQuery = supabase
    .from('offers')
    .select('offer_number, title')
    .eq('id', id)

  if (!isAdmin) {
    offerQuery = offerQuery.eq('created_by', profile.id)
  }

  const { data } = await offerQuery.maybeSingle<Pick<OfferRow, 'offer_number' | 'title'>>()
  const offerTitle = joinTitleParts(data?.offer_number, data?.title)

  return {
    title: offerTitle ? `Nabídka - ${offerTitle}` : 'Detail nabídky',
  }
}

export default async function OfferDetailPage({ params, searchParams }: OfferDetailPageProps) {
  const { id } = await params
  const resolvedSearchParams = await searchParams
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

  const [
    clientResponse,
    contactsResponse,
    itemsResponse,
    serviceItemsResponse,
    progressNotesResponse,
    profilesResponse,
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('id, name, ico, contact_person, contact_email, address, created_by')
      .eq('id', offer.client_id)
      .single<OfferClient>(),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .eq('client_id', offer.client_id)
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
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
      .from('offer_progress_notes')
      .select('*')
      .eq('offer_id', offer.id)
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, name, role, can_view_offers, offer_prepared_by_name, offer_prepared_by_phone, offer_prepared_by_email'),
  ])

  if (clientResponse.error || !clientResponse.data) {
    throw new Error('Nepodařilo se načíst klienta nabídky.')
  }

  if (contactsResponse.error) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klienta.')
  }

  if (itemsResponse.error) {
    throw new Error('Nepodařilo se načíst položky nabídky.')
  }

  if (serviceItemsResponse.error) {
    throw new Error('Nepodařilo se načíst rozsah služby.')
  }

  if (progressNotesResponse.error) {
    throw new Error('Nepodařilo se načíst průběžné komentáře nabídky.')
  }

  if (profilesResponse.error) {
    throw new Error('Nepodařilo se načíst uživatele.')
  }

  const detailProps = {
    offer,
    client: clientResponse.data,
    contacts: (contactsResponse.data ?? []) as OfferClientContact[],
    items: (itemsResponse.data ?? []) as OfferItemRow[],
    serviceItems: (serviceItemsResponse.data ?? []) as OfferServiceItemRow[],
    progressNotes: (progressNotesResponse.data ?? []) as OfferProgressNoteRow[],
    profiles: (profilesResponse.data ?? []) as OfferProfile[],
    profile,
    isAdmin,
    saved: resolvedSearchParams?.saved === '1',
    submitted: resolvedSearchParams?.submitted === '1',
  }

  if (offer.offer_type === 'bsafe24') {
    return (
      <>
        <SafeRealtimeRefresh scopes={['offers']} />
        <BSafe24OfferDetail {...detailProps} />
      </>
    )
  }

  return (
    <>
      <SafeRealtimeRefresh scopes={['offers']} />
      <ClassicOfferDetail {...detailProps} />
    </>
  )
}
