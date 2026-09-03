import 'server-only'

import { normalizeCompletePowerOutageAddresses } from './complete-address-normalization'
import { discoverCompletePowerOutageCompanies } from './complete-company-discovery'
import {
  providerConfigured,
  type CompleteDiscoveryProvider,
} from './complete-company-providers'
import { reconcileCompletePowerOutageCompanies } from './complete-company-reconciliation'
import { powerOutageErrorMessage } from './error-message'

type PipelineStep = {
  step: string
  ok: boolean
  skipped?: boolean
  result?: unknown
  error?: string
}

async function runStep(step: string, operation: () => Promise<unknown>): Promise<PipelineStep> {
  try {
    const result = await operation()
    const status = result && typeof result === 'object'
      ? (result as Record<string, unknown>).status
      : null
    if (status === 'partial' || status === 'failed') {
      return {
        step,
        ok: false,
        result,
        error: `Krok ${step} skončil stavem ${status}.`,
      }
    }
    return { step, ok: true, result }
  } catch (error) {
    return {
      step,
      ok: false,
      error: powerOutageErrorMessage(error, `Krok ${step} selhal.`),
    }
  }
}

async function runProvider(provider: CompleteDiscoveryProvider, limit: number): Promise<PipelineStep> {
  if (!providerConfigured(provider)) {
    return {
      step: `discover_${provider}`,
      ok: true,
      skipped: true,
      result: { status: 'disabled', reason: 'provider_not_configured' },
    }
  }
  return runStep(
    `discover_${provider}`,
    () => discoverCompletePowerOutageCompanies(provider, limit),
  )
}

/**
 * Zpracuje pouze již uložený katalog odstávek. Tato pipeline nikdy nevolá
 * rozhraní ČEZ, EG.D ani PRE; externí požadavky směřují jen na dohledávací
 * zdroje a podléhají jejich databázovým limitům a cache.
 */
export async function runCompletePowerOutageRuntimePipeline() {
  const startedAt = new Date().toISOString()
  const steps: PipelineStep[] = []

  // Menší dávka drží běh bezpečně pod limitem serverless funkce i u adres,
  // které vytvářejí větší počet číselných cílů.
  steps.push(await runStep(
    'normalize_addresses',
    () => normalizeCompletePowerOutageAddresses(300),
  ))

  // Zdroje běží postupně. Skutečný minutový, denní a u Mapy.com také společný
  // měsíční kreditní limit atomicky hlídá databáze.
  steps.push(await runProvider('ares', 100))
  steps.push(await runProvider('mapy', 7))
  steps.push(await runProvider('google', 2))

  steps.push(await runStep(
    'reconcile_companies',
    () => reconcileCompletePowerOutageCompanies(250),
  ))

  const failedSteps = steps.filter((step) => !step.ok)
  return {
    ok: failedSteps.length === 0,
    partial: failedSteps.length > 0 && failedSteps.length < steps.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  }
}
