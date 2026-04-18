'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type UpdatePortalJobInfoActionState = {
  success: boolean
  error: string | null
}

export async function updatePortalJobInfoAction(
  jobId: string,
  _prevState: UpdatePortalJobInfoActionState,
  formData: FormData
): Promise<UpdatePortalJobInfoActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      error: 'Nejsi přihlášený.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()
  const infoNote = String(formData.get('info_note') ?? '')

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const { error } = await supabase.rpc('update_portal_job_info', {
    p_job_id: normalizedJobId,
    p_info_note: infoNote,
  })

  if (error) {
    return {
      success: false,
      error: error.message || 'Info k zakázce se nepodařilo uložit.',
    }
  }

  revalidatePath('/jobs-portal')

  return {
    success: true,
    error: null,
  }
}
