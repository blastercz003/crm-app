'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type ClientFormActionState = {
  success: boolean
  error: string | null
  clientName?: string
}

export type CreateClientActionState = ClientFormActionState
export type UpdateClientActionState = ClientFormActionState
export type ClientContactActionState = ClientFormActionState

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

  let query = supabase
    .from('clients')
    .select('id, name, ico, contact_email')
    .limit(400)

  if (!isAdmin) {
    query = query.eq('created_by', userId)
  }

  const { data: clients, error } = await query

  if (error) {
    throw new Error('Nepodařilo se ověřit duplicitu klienta.')
  }

  const duplicate = ((clients ?? []) as DuplicateCandidateClient[]).find((client) => {
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

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}

async function updateClientContactValues(formData: FormData) {
  const { supabase } = await requireUser()

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
    .eq('created_by', user.id)

  if (error) {
    throw new Error('Nepodařilo se upravit klienta.')
  }

  revalidatePath('/clients')
  revalidatePath(`/clients/${id}`)

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

export async function deleteClientRecord(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')

  if (!id) {
    throw new Error('Chybí ID klienta.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string | null }>()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  if (profile?.role !== 'admin') {
    throw new Error('Klienta může smazat pouze administrátor.')
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) {
    throw new Error('Nepodařilo se smazat klienta.')
  }

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
  const { supabase } = await requireUser()

  const id = getString(formData, 'id')
  const clientId = getString(formData, 'client_id')

  if (!id || !clientId) {
    throw new Error('Chybí ID kontaktní osoby.')
  }

  const { error } = await supabase
    .from('client_contacts')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)

  if (error) {
    throw new Error('Nepodařilo se smazat kontaktní osobu.')
  }

  await ensurePrimaryContact(clientId)

  revalidatePath('/clients')
  revalidatePath(`/clients/${clientId}`)
}
