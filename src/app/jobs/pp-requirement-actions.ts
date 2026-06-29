'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  isJobPpRequired,
  setJobPpRequired,
} from '@/lib/jobs/pp-requirements'

type ProfileRoleRow = {
  role: string | null
}

async function requireAdminAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Neautorizovaný přístup.',
    }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění.',
    }
  }

  const typedProfile = profile as ProfileRoleRow | null

  if (typedProfile?.role !== 'admin') {
    return {
      supabase,
      user: null,
      error: 'Tuto změnu může provést pouze admin.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

export async function getJobPpRequirementAction(jobId: string) {
  const { supabase, user, error } = await requireAdminAccess()

  if (!user) {
    return {
      success: false,
      error: error ?? 'Neautorizovaný přístup.',
      ppRequired: true,
    }
  }

  try {
    const ppRequired = await isJobPpRequired(supabase, jobId)
    return {
      success: true,
      error: null,
      ppRequired,
    }
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : 'Neznámá chyba.'

    return {
      success: false,
      error: message,
      ppRequired: true,
    }
  }
}

export async function updateJobPpRequirementAction(
  jobId: string,
  ppRequired: boolean
) {
  const { supabase, user, error } = await requireAdminAccess()

  if (!user) {
    return {
      success: false,
      error: error ?? 'Neautorizovaný přístup.',
      ppRequired: true,
    }
  }

  try {
    await setJobPpRequired(supabase, {
      jobId,
      ppRequired,
      updatedBy: user.id,
    })

    revalidatePath('/jobs')
    revalidatePath('/faktury')
    revalidatePath('/dashboard')
    revalidatePath('/notifications')

    return {
      success: true,
      error: null,
      ppRequired,
    }
  } catch (caughtError) {
    const message =
      caughtError instanceof Error ? caughtError.message : 'Neznámá chyba.'

    return {
      success: false,
      error: message,
      ppRequired: !ppRequired,
    }
  }
}
