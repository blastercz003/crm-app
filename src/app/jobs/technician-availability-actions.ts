'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { isAdminRole, isTechnikRole } from '@/lib/auth/access'

type ProfileAccessRow = {
  id: string
  name: string | null
  role: string | null
  can_view_jobs: boolean | null
  can_be_assigned_as_technician: boolean | null
}

type WeekendOnCallRow = {
  id: string
  weekend_date: string
  technician_id: string
  created_at: string
  updated_at: string
}

type TechnicianUnavailabilityRow = {
  id: string
  technician_id: string
  starts_on: string
  ends_on: string
  starts_at: string
  ends_at: string
  created_at: string
  updated_at: string
}

export type TechnicianOption = {
  id: string
  name: string
}

export type WeekendOnCallEntry = WeekendOnCallRow & {
  isHistorical: boolean
}

export type TechnicianUnavailabilityEntry = TechnicianUnavailabilityRow & {
  isHistorical: boolean
}

export type TechnicianAvailabilityData = {
  selectedFriday: string
  selectedWeekendDates: readonly [string, string, string]
  canManage: boolean
  isAdmin: boolean
  isTechnician: boolean
  currentUserId: string
  technicians: TechnicianOption[]
  weekendOnCall: WeekendOnCallEntry[]
  unavailability: TechnicianUnavailabilityEntry[]
}

type ActionResult = {
  success: boolean
  error: string | null
}

type AvailabilityContext = {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  canManage: boolean
  isAdmin: boolean
  isTechnician: boolean
}

function getPragueDateTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = formatter.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''

  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  }
}

function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function weekday(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay()
}

function getDefaultFriday() {
  const { date } = getPragueDateTimeParts()
  const day = weekday(date)
  const offset = day <= 4 ? 5 - day : day === 5 ? 0 : day === 6 ? -1 : -2
  return addDays(date, offset)
}

function normalizeFriday(value?: string | null) {
  const normalized = String(value ?? '').trim()
  if (!isDateKey(normalized) || weekday(normalized) !== 5) return getDefaultFriday()
  return normalized
}

function isWeekendOnCallHistorical(dateKey: string) {
  const monday = addDays(dateKey, 3)
  const now = getPragueDateTimeParts()
  return now.date > monday || (now.date === monday && now.minutes >= 6 * 60)
}

function isUnavailabilityHistorical(endsAt: string) {
  return Date.now() >= new Date(endsAt).getTime() + 24 * 60 * 60 * 1000
}

function pragueLocalDateTimeToIso(value: string) {
  const normalized = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return null

  const [datePart, timePart] = normalized.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hour, minute] = timePart.split(':').map(Number)
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const getOffset = (timestamp: number) => {
    const parts = formatter.formatToParts(new Date(timestamp))
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? '0')
    return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute')) - timestamp
  }

  let timestamp = localAsUtc - getOffset(localAsUtc)
  timestamp = localAsUtc - getOffset(timestamp)
  return new Date(timestamp).toISOString()
}

function getPragueDateFromIso(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function normalizeTechnicianIds(values: string[]) {
  return Array.from(
    new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))
  )
}

async function requireTechnicianAvailabilityAccess(): Promise<
  AvailabilityContext | { error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Nejsi přihlášený.' }

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, can_view_jobs, can_be_assigned_as_technician')
    .eq('id', user.id)
    .single()

  if (error || !data) return { error: 'Nepodařilo se ověřit oprávnění uživatele.' }

  const profile = data as ProfileAccessRow
  const isAdmin = isAdminRole(profile.role)
  const isTechnician = isTechnikRole(profile.role)
  const canManage = isAdmin || Boolean(profile.can_view_jobs)

  if (!canManage && !isTechnician) {
    return { error: 'Nemáš oprávnění zobrazit pohotovosti a dostupnost.' }
  }

  return {
    supabase,
    userId: user.id,
    canManage,
    isAdmin,
    isTechnician,
  }
}

async function validateTechnicianIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  technicianIds: string[]
) {
  if (technicianIds.length === 0) return true

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .in('id', technicianIds)
    .eq('can_be_assigned_as_technician', true)

  if (error) throw new Error('Nepodařilo se ověřit vybrané techniky.')
  return (data ?? []).length === technicianIds.length
}

function refreshAvailabilityViews() {
  revalidatePath('/jobs')
  revalidatePath('/dashboard')
}

export async function getTechnicianAvailabilityDataAction(
  selectedFriday?: string | null
): Promise<{ success: true; data: TechnicianAvailabilityData } | { success: false; error: string }> {
  const access = await requireTechnicianAvailabilityAccess()
  if ('error' in access) return { success: false, error: access.error }

  const friday = normalizeFriday(selectedFriday)
  const weekendDates = [friday, addDays(friday, 1), addDays(friday, 2)] as const
  const onCallQuery = access.supabase
    .from('technician_weekend_on_call')
    .select('id, weekend_date, technician_id, created_at, updated_at')
    .order('weekend_date', { ascending: false })

  const unavailabilityQuery = access.supabase
    .from('technician_unavailability')
    .select('id, technician_id, starts_on, ends_on, starts_at, ends_at, created_at, updated_at')
    .order('starts_at', { ascending: false })

  if (!access.canManage) {
    unavailabilityQuery.eq('technician_id', access.userId)
  }

  const techniciansQuery = access.supabase
    .from('profiles')
    .select('id, name')
    .eq('can_be_assigned_as_technician', true)
    .order('name', { ascending: true })

  const [onCallResponse, unavailabilityResponse, techniciansResponse] = await Promise.all([
    onCallQuery,
    unavailabilityQuery,
    techniciansQuery,
  ])

  if (onCallResponse.error || unavailabilityResponse.error || techniciansResponse.error) {
    return { success: false, error: 'Nepodařilo se načíst pohotovosti a dostupnost techniků.' }
  }

  return {
    success: true,
    data: {
      selectedFriday: friday,
      selectedWeekendDates: weekendDates,
      canManage: access.canManage,
      isAdmin: access.isAdmin,
      isTechnician: access.isTechnician,
      currentUserId: access.userId,
      technicians: ((techniciansResponse.data ?? []) as Array<{ id: string; name: string | null }>)
        .map((technician) => ({ id: technician.id, name: technician.name?.trim() || 'Bez jména' })),
      weekendOnCall: ((onCallResponse.data ?? []) as WeekendOnCallRow[]).map((entry) => ({
        ...entry,
        isHistorical: isWeekendOnCallHistorical(entry.weekend_date),
      })),
      unavailability: ((unavailabilityResponse.data ?? []) as TechnicianUnavailabilityRow[]).map((entry) => ({
        ...entry,
        isHistorical: isUnavailabilityHistorical(entry.ends_at),
      })),
    },
  }
}

export async function saveWeekendOnCallAction(input: {
  weekendDate: string
  technicianIds: string[]
}): Promise<ActionResult> {
  const access = await requireTechnicianAvailabilityAccess()
  if ('error' in access) return { success: false, error: access.error }
  if (!access.canManage) return { success: false, error: 'Pohotovosti může upravovat pouze uživatel s přístupem do Zakázek.' }

  const weekendDate = String(input.weekendDate ?? '').trim()
  if (!isDateKey(weekendDate) || ![0, 5, 6].includes(weekday(weekendDate))) {
    return { success: false, error: 'Pohotovost lze uložit pouze pro pátek, sobotu nebo neděli.' }
  }
  if (isWeekendOnCallHistorical(weekendDate) && !access.isAdmin) {
    return { success: false, error: 'Historickou pohotovost může upravit pouze admin.' }
  }

  const technicianIds = normalizeTechnicianIds(input.technicianIds ?? [])
  try {
    if (!(await validateTechnicianIds(access.supabase, technicianIds))) {
      return { success: false, error: 'Jeden nebo více vybraných uživatelů není technik.' }
    }

    const { data: existing, error: existingError } = await access.supabase
      .from('technician_weekend_on_call')
      .select('id, technician_id')
      .eq('weekend_date', weekendDate)

    if (existingError) throw new Error('Nepodařilo se načíst uložené pohotovosti.')

    const existingRows = (existing ?? []) as Array<{ id: string; technician_id: string }>
    const existingIds = new Set(existingRows.map((entry) => entry.technician_id))
    const addedIds = technicianIds.filter((technicianId) => !existingIds.has(technicianId))
    const removedRowIds = existingRows
      .filter((entry) => !technicianIds.includes(entry.technician_id))
      .map((entry) => entry.id)

    if (addedIds.length > 0) {
      const { error } = await access.supabase.from('technician_weekend_on_call').insert(
        addedIds.map((technicianId) => ({
          weekend_date: weekendDate,
          technician_id: technicianId,
          created_by: access.userId,
          updated_by: access.userId,
        }))
      )
      if (error) throw new Error('Nepodařilo se uložit pohotovost.')
    }

    if (removedRowIds.length > 0) {
      const { error } = await access.supabase
        .from('technician_weekend_on_call')
        .delete()
        .in('id', removedRowIds)
      if (error) throw new Error('Nepodařilo se upravit pohotovost.')
    }

    refreshAvailabilityViews()
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Pohotovost se nepodařilo uložit.',
    }
  }
}

export async function saveTechnicianUnavailabilityAction(input: {
  id?: string | null
  technicianId: string
  startsAt: string
  endsAt: string
}): Promise<ActionResult> {
  const access = await requireTechnicianAvailabilityAccess()
  if ('error' in access) return { success: false, error: access.error }

  const technicianId = String(input.technicianId ?? '').trim()
  const startsAt = pragueLocalDateTimeToIso(input.startsAt)
  const endsAt = pragueLocalDateTimeToIso(input.endsAt)
  const recordId = String(input.id ?? '').trim()

  if (!technicianId || !startsAt || !endsAt || new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    return { success: false, error: 'Zadej platný začátek a konec nedostupnosti.' }
  }
  if (!access.canManage && (!access.isTechnician || technicianId !== access.userId)) {
    return { success: false, error: 'Můžeš upravovat pouze svou vlastní nedostupnost.' }
  }

  try {
    if (!(await validateTechnicianIds(access.supabase, [technicianId]))) {
      return { success: false, error: 'Vybraný uživatel není technik.' }
    }

    if (recordId) {
      const { data: existing, error: existingError } = await access.supabase
        .from('technician_unavailability')
        .select('id, technician_id, ends_at')
        .eq('id', recordId)
        .maybeSingle()

      if (existingError || !existing) return { success: false, error: 'Záznam nedostupnosti se nepodařilo najít.' }

      const row = existing as { technician_id: string; ends_at: string }
      if (!access.canManage && row.technician_id !== access.userId) {
        return { success: false, error: 'Můžeš upravovat pouze svou vlastní nedostupnost.' }
      }
      if ((isUnavailabilityHistorical(row.ends_at) || isUnavailabilityHistorical(endsAt)) && !access.isAdmin) {
        return { success: false, error: 'Historický záznam může upravit pouze admin.' }
      }

      const { error } = await access.supabase
        .from('technician_unavailability')
        .update({
          technician_id: technicianId,
          starts_on: getPragueDateFromIso(startsAt),
          ends_on: getPragueDateFromIso(endsAt),
          starts_at: startsAt,
          ends_at: endsAt,
          updated_by: access.userId,
        })
        .eq('id', recordId)

      if (error) throw new Error('Nedostupnost se nepodařilo upravit.')
    } else {
      if (isUnavailabilityHistorical(endsAt) && !access.isAdmin) {
        return { success: false, error: 'Historický záznam může vytvořit pouze admin.' }
      }

      const { error } = await access.supabase.from('technician_unavailability').insert({
        technician_id: technicianId,
        starts_on: getPragueDateFromIso(startsAt),
        ends_on: getPragueDateFromIso(endsAt),
        starts_at: startsAt,
        ends_at: endsAt,
        created_by: access.userId,
        updated_by: access.userId,
      })
      if (error) throw new Error('Nedostupnost se nepodařilo uložit.')
    }

    refreshAvailabilityViews()
    return { success: true, error: null }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Nedostupnost se nepodařilo uložit.',
    }
  }
}

export async function deleteTechnicianUnavailabilityAction(id: string): Promise<ActionResult> {
  const access = await requireTechnicianAvailabilityAccess()
  if ('error' in access) return { success: false, error: access.error }

  const recordId = String(id ?? '').trim()
  if (!recordId) return { success: false, error: 'Chybí záznam nedostupnosti.' }

  const { data, error } = await access.supabase
    .from('technician_unavailability')
    .select('technician_id, ends_at')
    .eq('id', recordId)
    .maybeSingle()

  if (error || !data) return { success: false, error: 'Záznam nedostupnosti se nepodařilo najít.' }

  const record = data as { technician_id: string; ends_at: string }
  if (!access.canManage && (!access.isTechnician || record.technician_id !== access.userId)) {
    return { success: false, error: 'Můžeš smazat pouze svou vlastní nedostupnost.' }
  }
  if (isUnavailabilityHistorical(record.ends_at) && !access.isAdmin) {
    return { success: false, error: 'Historický záznam může smazat pouze admin.' }
  }

  const { error: deleteError } = await access.supabase
    .from('technician_unavailability')
    .delete()
    .eq('id', recordId)

  if (deleteError) return { success: false, error: 'Nedostupnost se nepodařilo smazat.' }

  refreshAvailabilityViews()
  return { success: true, error: null }
}
