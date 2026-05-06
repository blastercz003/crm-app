import type { CreateClientActionState } from '@/app/clients/actions'
import type { CreateMeetingActionState } from '@/app/meetings/actions'
import type { CreateJobActionState } from '@/app/jobs/actions'
import type { CreateTaskActionState } from '@/app/tasks/actions'
import type { ActionFeedbackToastValue } from '@/components/ui/action-feedback-toast'

function formatMeetingDateTime(value: string | undefined) {
  if (!value) return 'bez uvedeného termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function buildClientCreatedToast(
  state: CreateClientActionState
): ActionFeedbackToastValue {
  return {
    title: 'KLIENT ULOŽEN',
    message: `Klient „${state.clientName ?? 'Nový klient'}“ byl úspěšně vytvořen.`,
    tone: 'success',
  }
}

export function buildTaskCreatedToast(
  state: CreateTaskActionState
): ActionFeedbackToastValue {
  return {
    title: 'ÚKOL ULOŽEN',
    message: `Úkol „${state.taskTitle ?? 'Nový úkol'}“ byl úspěšně vytvořen.`,
    tone: 'success',
  }
}

export function buildMeetingCreatedToast(
  state: CreateMeetingActionState
): ActionFeedbackToastValue {
  return {
    title: 'SCHŮZKA ULOŽENA',
    message: `Schůzka v „${state.companyName ?? 'Nová firma'}“ na ${formatMeetingDateTime(
      state.meetingDateTime
    )} byla vytvořena.`,
    tone: 'success',
  }
}

export function buildJobCreatedToast(
  state: CreateJobActionState
): ActionFeedbackToastValue {
  return {
    title: 'ZAKÁZKA ULOŽENA',
    message: `Zakázka ${state.jobNumber ?? 'bez čísla'} pro „${
      state.companyName ?? 'Nová firma'
    }“ byla vytvořena.`,
    tone: 'success',
  }
}

export function buildErrorToast(message: string): ActionFeedbackToastValue {
  return {
    title: 'CHYBA',
    message,
    tone: 'error',
  }
}
