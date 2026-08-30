'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'

export type ClientFormActionState = {
  success: boolean
  error: string | null
  clientName?: string
}

export type CreateClientActionState = ClientFormActionState
export type UpdateClientActionState = ClientFormActionState
export type ClientContactActionState = ClientFormActionState
export type ChangeClientOwnerActionState = {
  success: boolean
  error: string | null
  ownerName?: string
}

type CurrentProfile = {
  id: string
  role: string | null
  name: string | null
}

type ClientAccessProfileRow = {
  id: string
  name: string | null
}

type ManagedClientRow = {
  id: string
  name: string | null
  created_by: string | null
}

const CLIENT_OWNER_FIXED_IDS = {
  MICHAL: '46c40df2-04d7-41e9-ad6d-51cc2ee76019',
  'LÍDA': '735d158c-667a-42c0-8af0-6ee12a9c1f11',
} as const
const CLIENT_OWNER_FIXED_LABELS = {
  MICHAL: 'Michal',
  'LÍDA': 'Lída',
} as const

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDuplicateComparable(value: string) {
  return value.trim().toLocaleLowerCase('cs-CZ')
}

function normalizeIcoComparable(value: string) {
  return value.replaceAll(/\s+/g, '').trim()
}

function escapeLikePattern(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}

function buildFlexibleIcoPattern(value: string) {
  return normalizeIcoComparable(value)
    .split('')
    .map(escapeLikePattern)
    .join('%')
}

type DuplicateCandidateClient = {
  id: string
  name: string
  ico: string | null
  contact_email: string | null
}

async function requireUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return { supabase, user }
}

async function getCurrentProfile(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
}) {
  const { supabase, userId } = params
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, name')
    .eq('id', userId)
    .single<CurrentProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  return profile
}

async function getClientAccessProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  currentProfile: CurrentProfile
) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name')
    .order('name', { ascending: true })

  if (error) {
    throw new Error('Nepodařilo se načíst uživatele pro změnu přístupu ke klientovi.')
  }

  return ((data ?? []) as ClientAccessProfileRow[])
    .map((profile) => {
      if (profile.id === currentProfile.id) {
        return {
          ...profile,
          name: 'Jiří',
        }
      }

      if (profile.id === CLIENT_OWNER_FIXED_IDS.MICHAL) {
        return {
          ...profile,
          name: CLIENT_OWNER_FIXED_LABELS.MICHAL,
        }
      }

      if (profile.id === CLIENT_OWNER_FIXED_IDS['LÍDA']) {
        return {
          ...profile,
          name: CLIENT_OWNER_FIXED_LABELS['LÍDA'],
        }
      }

      return profile
    })
    .sort((a, b) =>
      String(a.name ?? '').localeCompare(String(b.name ?? ''), 'cs', {
        sensitivity: 'base',
      })
    )
}

async function assertCanManageClient(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  clientId: string
}) {
  const { supabase, userId, clientId } = params

  const profile = await getCurrentProfile({ supabase, userId })

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, created_by')
    .eq('id', clientId)
    .maybeSingle<ManagedClientRow>()

  if (error || !client) {
    throw new Error('Klient nebyl nalezen.')
  }

  if (profile.role !== 'admin' && client.created_by !== userId) {
    throw new Error('Tento klient je jen pro čtení.')
  }

  return {
    profile,
    client,
  }
}

async function assertNoDuplicateClientOnCreate(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  name: string
  ico: string
  contactEmail: string
}) {
  const { supabase, userId, name, ico, contactEmail } = params

  const normalizedName = normalizeDuplicateComparable(name)
  const normalizedIco = normalizeIcoComparable(ico)
  const normalizedEmail = normalizeDuplicateComparable(contactEmail)

  if (!normalizedName && !normalizedIco && !normalizedEmail) return

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single<{ role: string | null }>()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const isAdmin = profile?.role === 'admin'

  function restrictToOwner<Query extends { eq: (column: string, value: string) => Query }>(
    query: Query
  ) {
    return isAdmin ? query : query.eq('created_by', userId)
  }

  const emptyResult = Promise.resolve({
    data: [] as DuplicateCandidateClient[],
    error: null,
  })
  const [nameResponse, icoResponse, emailResponse] = await Promise.all([
    normalizedName
      ? restrictToOwner(
          supabase
            .from('clients')
            .select('id, name, ico, contact_email')
            .ilike('name', escapeLikePattern(name))
            .limit(1)
        )
      : emptyResult,
    normalizedIco
      ? restrictToOwner(
          supabase
            .from('clients')
            .select('id, name, ico, contact_email')
            .ilike('ico', buildFlexibleIcoPattern(ico))
            .limit(1)
        )
      : emptyResult,
    normalizedEmail
      ? restrictToOwner(
          supabase
            .from('clients')
            .select('id, name, ico, contact_email')
            .ilike('contact_email', escapeLikePattern(contactEmail))
            .limit(1)
        )
      : emptyResult,
  ])

  if (nameResponse.error || icoResponse.error || emailResponse.error) {
    throw new Error('Nepodařilo se ověřit duplicitu klienta.')
  }

  const candidates = [
    ...(nameResponse.data ?? []),
    ...(icoResponse.data ?? []),
    ...(emailResponse.data ?? []),
  ] as DuplicateCandidateClient[]
  const duplicate = candidates.find((client) => {
    const sameName =
      normalizedName.length > 0 &&
      normalizeDuplicateComparable(client.name) === normalizedName
    const sameIco =
      normalizedIco.length > 0 &&
      normalizeIcoComparable(client.ico ?? '') === normalizedIco
    const sameEmail =
      normalizedEmail.length > 0 &&
      normalizeDuplicateComparable(client.contact_email ?? '') === normalizedEmail

    return sameName || sameIco || sameEmail
  })

  if (!duplicate) return

  if (
    normalizedIco.length > 0 &&
    normalizeIcoComparable(duplicate.ico ?? '') === normalizedIco
  ) {
    throw new Error(`Klient s IČO ${ico} už existuje.`)
  }

  if (
    normalizedEmail.length > 0 &&
    normalizeDuplicateComparable(duplicate.contact_email ?? '') === normalizedEmail
  ) {
    throw new Error(`Klient s e-mailem ${contactEmail} už existuje.`)
  }

  throw new Error(`Klient s názvem ${name} už existuje.`)
}

async function syncPrimaryContactSnapshot(clientId: string) {
  const { supabase } = await requireUser()

  const { data: primaryContact, error: primaryError } = await supabase
    .from('client_contacts')
    .select('name, phone, email')
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .maybeSingle<{
      name: string
      phone: string | null
      email: string | null
    }>()

  if (primaryError) {
    throw new Error('Nepodařilo se načíst hlavní kontakt klienta.')
  }

  const { error } = await supabase
    .from('clients')
    .update({
      contact_person: primaryContact?.name ?? null,
      contact_phone: primaryContact?.phone ?? null,
      contact_email: primaryContact?.email ?? null,
    })
    .eq('id', clientId)

  if (error) {
    throw new Error('Nepodařilo se synchronizovat hlavní kontakt klienta.')
  }
}

async function ensurePrimaryContact(clientId: string) {
  const { supabase } = await requireUser()

  const { data: primaryContact, error: primaryError } = await supabase
    .from('client_contacts')
    .select('id')
    .eq('client_id', clientId)
    .eq('is_primary', true)
    .maybeSingle<{ id: string }>()

  if (primaryError) {
    throw new Error('Nepodařilo se ověřit hlavní kontakt klienta.')
  }

  if (primaryContact) return

  const { data: firstContact, error: firstError } = await supabase
    .from('client_contacts')
    .select('id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (firstError) {
    throw new Error('Nepodařilo se vybrat náhradní hlavní kontakt.')
  }

  if (!firstContact) {
    await syncPrimaryContactSnapshot(clientId)
    return
  }

  const { error } = await supabase
    .from('client_contacts')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', firstContact.id)
    .eq('client_id', clientId)

  if (error) {
    throw new Error('Nepodařilo se nastavit náhradní hlavní kontakt.')
  }

  await syncPrimaryContactSnapshot(clientId)
}

async function createClientContactValues(formData: FormData) {
  const { supabase, user } = await requireUser()

  const clientId = getString(formData, 'client_id')
  const name = getString(formData, 'name')
  const phone = getString(formData, 'phone')
  const email = getString(formData, 'email')
  const role = getString(formData, 'role')
  const note = getString(formData, 'note')
  const requestedPrimary = formData.get('is_primary') === 'on'

  if (!clientId) {
    throw new Error('Chybí ID klienta.')
  }

  if (!name) {
    throw new Error('Jméno kontaktní osoby je povinné.')
  }

  await assertCanManageClient({
    supabase,
    userId: user.id,
    clientId,
  })

  const { count, error: countError } = await supabase
    .from('client_contacts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)

  if (countError) {
    throw new Error('Nepodařilo se ověřit kontakty klienta.')
  }

  const isPrimary = requestedPrimary || (count ?? 0) === 0

  if (isPrimary) {
    const { error } = await supabase
      .from('client_contacts')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)

    if (error) {
      throw new Error('Nepodařilo se připravit hlavní kontakt.')
    }
  }

  const { error } = await supabase.from('client_contacts').insert({
    client_id: clientId,
    name,
    phone: phone || null,
    email: email || null,
    role: role || null,
    note: note || null,
    is_primary: isPrimary,
    created_by: user.id,
  })

  if (error) {
    throw new Error('Nepodařilo se vytvořit kontaktní osobu.')
  }

  await ensurePrimaryContact(clientId)
  await syncPrimaryContactSnapshot(clientId)

  await logUserActivity({
    action: `Vytvořil kontaktní osobu klienta: ${name}`,
    section: 'Klienti',
    route: `/clients/${clientId}`,
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}

async function updateClientContactValues(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')
  const clientId = getString(formData, 'client_id')
  const name = getString(formData, 'name')
  const phone = getString(formData, 'phone')
  const email = getString(formData, 'email')
  const role = getString(formData, 'role')
  const note = getString(formData, 'note')
  const isPrimary = formData.get('is_primary') === 'on'

  if (!id || !clientId) {
    throw new Error('Chybí ID kontaktní osoby.')
  }

  if (!name) {
    throw new Error('Jméno kontaktní osoby je povinné.')
  }

  await assertCanManageClient({
    supabase,
    userId: user.id,
    clientId,
  })

  if (isPrimary) {
    const { error } = await supabase
      .from('client_contacts')
      .update({ is_primary: false, updated_at: new Date().toISOString() })
      .eq('client_id', clientId)

    if (error) {
      throw new Error('Nepodařilo se připravit hlavní kontakt.')
    }
  }

  const { error } = await supabase
    .from('client_contacts')
    .update({
      name,
      phone: phone || null,
      email: email || null,
      role: role || null,
      note: note || null,
      is_primary: isPrimary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    throw new Error('Nepodařilo se upravit kontaktní osobu.')
  }

  await ensurePrimaryContact(clientId)
  await syncPrimaryContactSnapshot(clientId)

  await logUserActivity({
    action: `Upravil kontaktní osobu klienta: ${name}`,
    section: 'Klienti',
    route: `/clients/${clientId}`,
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}

async function insertClientRecord(formData: FormData) {
  const { supabase, user } = await requireUser()

  const name = getString(formData, 'name')
  const ico = getString(formData, 'ico')
  const contactPerson = getString(formData, 'contact_person')
  const contactPhone = getString(formData, 'contact_phone')
  const contactEmail = getString(formData, 'contact_email')
  const address = getString(formData, 'address')
  const note = getString(formData, 'note')

  if (!name) {
    throw new Error('Název klienta je povinný.')
  }

  await assertNoDuplicateClientOnCreate({
    supabase,
    userId: user.id,
    name,
    ico,
    contactEmail,
  })

  const { data: createdClient, error } = await supabase
    .from('clients')
    .insert({
      name,
      ico: ico || null,
      contact_person: contactPerson || null,
      contact_phone: contactPhone || null,
      contact_email: contactEmail || null,
      address: address || null,
      note: note || null,
      created_by: user.id,
    })
    .select('id')
    .single<{ id: string }>()

  if (error || !createdClient) {
    throw new Error('Nepodařilo se vytvořit klienta.')
  }

  if (contactPerson) {
    const { error: contactInsertError } = await supabase
      .from('client_contacts')
      .insert({
        client_id: createdClient.id,
        name: contactPerson,
        phone: contactPhone || null,
        email: contactEmail || null,
        is_primary: true,
        created_by: user.id,
      })

    if (contactInsertError) {
      throw new Error('Nepodařilo se vytvořit hlavní kontaktní osobu.')
    }
  }

  await logUserActivity({
    action: `Vytvořil klienta: ${name}`,
    section: 'Klienti',
    route: '/clients',
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')

  return {
    clientName: name,
  }
}

async function updateClientValues(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')
  const name = getString(formData, 'name')
  const ico = getString(formData, 'ico')
  const contactPerson = getString(formData, 'contact_person')
  const contactPhone = getString(formData, 'contact_phone')
  const contactEmail = getString(formData, 'contact_email')
  const address = getString(formData, 'address')
  const note = getString(formData, 'note')

  if (!id) {
    throw new Error('Chybí ID klienta.')
  }

  if (!name) {
    throw new Error('Název klienta je povinný.')
  }

  await assertCanManageClient({
    supabase,
    userId: user.id,
    clientId: id,
  })

  const { error } = await supabase
    .from('clients')
    .update({
      name,
      ico: ico || null,
      contact_person: contactPerson || null,
      contact_phone: contactPhone || null,
      contact_email: contactEmail || null,
      address: address || null,
      note: note || null,
    })
    .eq('id', id)

  if (error) {
    throw new Error('Nepodařilo se upravit klienta.')
  }

  await logUserActivity({
    action: `Upravil klienta: ${name}`,
    section: 'Klienti',
    route: `/clients/${id}`,
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)
  revalidatePath('/jobs')
  revalidatePath('/tasks')
  revalidatePath('/meetings')
  revalidatePath('/calendar')
  revalidatePath('/activities')
  revalidatePath('/dashboard')

  return { id }
}

export async function createClientRecord(formData: FormData) {
  await insertClientRecord(formData)
  redirect('/clients')
}

export async function createClientModalAction(
  _prevState: CreateClientActionState,
  formData: FormData
): Promise<CreateClientActionState> {
  try {
    const result = await insertClientRecord(formData)

    return {
      success: true,
      error: null,
      clientName: result.clientName,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se vytvořit klienta.',
    }
  }
}

export async function updateClientRecord(formData: FormData) {
  const { id } = await updateClientValues(formData)
  redirect(`/clients/${id}`)
}

export async function updateClientModalAction(
  _prevState: UpdateClientActionState,
  formData: FormData
): Promise<UpdateClientActionState> {
  try {
    await updateClientValues(formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se upravit klienta.',
    }
  }
}

export async function changeClientOwnerAction(
  _prevState: ChangeClientOwnerActionState,
  formData: FormData
): Promise<ChangeClientOwnerActionState> {
  try {
    const { supabase, user } = await requireUser()
    const profile = await getCurrentProfile({ supabase, userId: user.id })

    if (profile.role !== 'admin') {
      throw new Error('Majitele klienta může měnit pouze administrátor.')
    }

    const clientId = getString(formData, 'client_id')
    const nextOwnerId = getString(formData, 'owner_user_id')
    const nextSharedUserIds = Array.from(
      new Set(
        formData
          .getAll('shared_user_ids')
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter(Boolean)
      )
    )

    if (!clientId || !nextOwnerId) {
      throw new Error('Chybí klient nebo nový majitel.')
    }

    const allowedOwners = await getClientAccessProfiles(supabase, profile)
    const nextOwner = allowedOwners.find((owner) => owner.id === nextOwnerId)

    if (!nextOwner) {
      throw new Error('Vybraný uživatel nemůže být majitelem klienta.')
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name, created_by')
      .eq('id', clientId)
      .maybeSingle<{ id: string; name: string | null; created_by: string | null }>()

    if (clientError || !client) {
      throw new Error('Klient nebyl nalezen.')
    }

    const { error: visibilityError } = await supabase.rpc('set_client_visibility', {
      p_client_id: clientId,
      p_owner_user_id: nextOwnerId,
      p_shared_user_ids: nextSharedUserIds,
    })

    if (visibilityError) {
      throw new Error('Nepodařilo se změnit přístup ke klientovi.')
    }

    await logUserActivity({
      action: `Změnil přístup ke klientovi ${client.name?.trim() || clientId}. Majitel: ${nextOwner.name?.trim() || nextOwnerId}. Sdílení: ${nextSharedUserIds.length} uživatelů.`,
      section: 'Klienti',
      route: `/clients/${clientId}`,
      userId: user.id,
    }, supabase)

    revalidatePath('/clients')
    revalidatePath(`/clients/${clientId}`)
    revalidatePath('/jobs')
    revalidatePath('/offers')

    return {
      success: true,
      error: null,
      ownerName: nextOwner.name?.trim() || 'Neuvedeno',
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se změnit majitele klienta.',
    }
  }
}

export async function deleteClientRecord(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')

  if (!id) {
    throw new Error('Chybí ID klienta.')
  }

  const profile = await getCurrentProfile({ supabase, userId: user.id })

  if (profile?.role !== 'admin') {
    throw new Error('Klienta může smazat pouze administrátor.')
  }

  const { data: clientForLog } = await supabase
    .from('clients')
    .select('name')
    .eq('id', id)
    .maybeSingle()

  const clientNameForLog = String(
    (clientForLog as { name?: string | null } | null)?.name ?? ''
  ).trim()

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error('Nepodařilo se smazat klienta.')
  }

  await logUserActivity({
    action: `Smazal klienta: ${clientNameForLog || id}`,
    section: 'Klienti',
    route: '/clients',
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')
  redirect('/clients')
}

export async function createClientContactModalAction(
  _prevState: ClientContactActionState,
  formData: FormData
): Promise<ClientContactActionState> {
  try {
    await createClientContactValues(formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se vytvořit kontaktní osobu.',
    }
  }
}

export async function updateClientContactModalAction(
  _prevState: ClientContactActionState,
  formData: FormData
): Promise<ClientContactActionState> {
  try {
    await updateClientContactValues(formData)

    return {
      success: true,
      error: null,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se upravit kontaktní osobu.',
    }
  }
}

export async function setPrimaryClientContact(formData: FormData) {
  const { supabase } = await requireUser()

  const id = getString(formData, 'id')
  const clientId = getString(formData, 'client_id')

  if (!id || !clientId) {
    throw new Error('Chybí ID kontaktní osoby.')
  }

  const now = new Date().toISOString()

  const { error: resetError } = await supabase
    .from('client_contacts')
    .update({ is_primary: false, updated_at: now })
    .eq('client_id', clientId)

  if (resetError) {
    throw new Error('Nepodařilo se připravit hlavní kontakt.')
  }

  const { error } = await supabase
    .from('client_contacts')
    .update({ is_primary: true, updated_at: now })
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    throw new Error('Nepodařilo se nastavit hlavní kontakt.')
  }

  await syncPrimaryContactSnapshot(clientId)

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}

export async function deleteClientContact(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')
  const clientId = getString(formData, 'client_id')

  if (!id || !clientId) {
    throw new Error('Chybí ID kontaktní osoby.')
  }

  const { data: contactForLog } = await supabase
    .from('client_contacts')
    .select('name')
    .eq('id', id)
    .eq('client_id', clientId)
    .maybeSingle()

  const contactNameForLog = String(
    (contactForLog as { name?: string | null } | null)?.name ?? ''
  ).trim()

  const { error } = await supabase
    .from('client_contacts')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    throw new Error('Nepodařilo se smazat kontaktní osobu.')
  }

  await ensurePrimaryContact(clientId)

  await logUserActivity({
    action: `Smazal kontaktní osobu klienta ${clientId}: ${contactNameForLog || id}`,
    section: 'Klienti',
    route: `/clients/${clientId}`,
    userId: user.id,
  }, supabase)

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}
