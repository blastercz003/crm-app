'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
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

export async function createClientRecord(formData: FormData) {
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

  const { error } = await supabase.from('clients').insert({
    name,
    ico: ico || null,
    contact_person: contactPerson || null,
    contact_phone: contactPhone || null,
    contact_email: contactEmail || null,
    address: address || null,
    note: note || null,
    created_by: user.id,
  })

  if (error) {
    throw new Error('Nepodařilo se vytvořit klienta.')
  }

  revalidatePath('/clients')
  redirect('/clients')
}

export async function updateClientRecord(formData: FormData) {
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
  redirect(`/clients/${id}`)
}

export async function deleteClientRecord(formData: FormData) {
  const { supabase, user } = await requireUser()

  const id = getString(formData, 'id')

  if (!id) {
    throw new Error('Chybí ID klienta.')
  }

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
    .eq('created_by', user.id)

  if (error) {
    throw new Error('Nepodařilo se smazat klienta.')
  }

  revalidatePath('/clients')
  redirect('/clients')
}