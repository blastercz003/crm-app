import type {
  CreateNordFjellaReservationActionState,
  UpdateNordFjellaReservationActionState,
  UpdateNordFjellaSettingsActionState,
} from './actions'

export const createNordFjellaReservationInitialState: CreateNordFjellaReservationActionState = {
  success: false,
  error: null,
}

export const updateNordFjellaReservationInitialState: UpdateNordFjellaReservationActionState = {
  success: false,
  error: null,
}

export const updateNordFjellaSettingsInitialState: UpdateNordFjellaSettingsActionState = {
  success: false,
  error: null,
}
