type SupabaseLike = {
  from: (table: string) => unknown
}

type JobPpRequirementRow = {
  job_id: string | null
  pp_required: boolean | null
}

type SelectManyResult<T> = Promise<{
  data: T[] | null
  error: { message: string } | null
}>

type SelectMaybeSingleResult<T> = Promise<{
  data: T | null
  error: { message: string } | null
}>

type DeleteResult = Promise<{
  error: { message: string } | null
}>

type UpsertResult = Promise<{
  error: { message: string } | null
}>

export async function getJobPpNotRequiredSet(
  supabase: SupabaseLike,
  jobIds: string[]
) {
  const normalizedJobIds = Array.from(
    new Set(
      jobIds
        .map((jobId) => String(jobId ?? '').trim())
        .filter((jobId) => Boolean(jobId))
    )
  )

  if (normalizedJobIds.length === 0) {
    return new Set<string>()
  }

  const table = supabase.from('job_pp_requirements') as {
    select: (columns: string) => {
      in: (column: string, values: string[]) => SelectManyResult<JobPpRequirementRow>
    }
  }

  const { data, error } = await table
    .select('job_id, pp_required')
    .in('job_id', normalizedJobIds)

  if (error) {
    throw new Error(`Nepodařilo se načíst nastavení PP: ${error.message}`)
  }

  return new Set(
    (data ?? [])
      .filter((row) => row.pp_required === false)
      .map((row) => String(row.job_id ?? '').trim())
      .filter((jobId) => Boolean(jobId))
  )
}

export async function isJobPpRequired(supabase: SupabaseLike, jobId: string) {
  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return true
  }

  const table = supabase.from('job_pp_requirements') as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => SelectMaybeSingleResult<{ pp_required?: boolean | null }>
      }
    }
  }

  const { data, error } = await table
    .select('pp_required')
    .eq('job_id', normalizedJobId)
    .maybeSingle()

  if (error) {
    throw new Error(`Nepodařilo se načíst stav PP: ${error.message}`)
  }

  return data?.pp_required !== false
}

export async function setJobPpRequired(
  supabase: SupabaseLike,
  {
    jobId,
    ppRequired,
    updatedBy,
  }: {
    jobId: string
    ppRequired: boolean
    updatedBy?: string | null
  }
) {
  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    throw new Error('Chybí ID zakázky.')
  }

  if (ppRequired) {
    const table = supabase.from('job_pp_requirements') as {
      delete: () => {
        eq: (column: string, value: string) => DeleteResult
      }
    }

    const { error } = await table.delete().eq('job_id', normalizedJobId)

    if (error) {
      throw new Error(`Nepodařilo se obnovit povinný PP: ${error.message}`)
    }

    return
  }

  const table = supabase.from('job_pp_requirements') as {
    upsert: (
      values: {
        job_id: string
        pp_required: boolean
        updated_by: string | null
        updated_at: string
      },
      options: {
        onConflict: string
      }
    ) => UpsertResult
  }

  const { error } = await table.upsert(
    {
      job_id: normalizedJobId,
      pp_required: false,
      updated_by: updatedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: 'job_id',
    }
  )

  if (error) {
    throw new Error(`Nepodařilo se uložit stav PP: ${error.message}`)
  }
}
