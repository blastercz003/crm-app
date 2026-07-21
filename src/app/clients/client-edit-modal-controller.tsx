'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  EditClientModal,
  type ClientForEditing,
} from './edit-client-button'

export function ClientEditModalController({
  clients,
  canDeleteClient,
}: {
  clients: ClientForEditing[]
  canDeleteClient: boolean
}) {
  const [selectedClient, setSelectedClient] = useState<ClientForEditing | null>(null)
  const clientsById = useMemo(
    () => new Map(clients.map((client) => [client.id, client])),
    [clients]
  )

  useEffect(() => {
    function handleEditClick(event: MouseEvent) {
      if (!(event.target instanceof Element)) return

      const button = event.target.closest<HTMLButtonElement>('[data-client-edit-id]')
      if (!button || button.disabled) return

      const client = clientsById.get(button.dataset.clientEditId ?? '')
      if (client) setSelectedClient(client)
    }

    document.addEventListener('click', handleEditClick)
    return () => document.removeEventListener('click', handleEditClick)
  }, [clientsById])

  if (!selectedClient) return null

  return (
    <EditClientModal
      key={selectedClient.id}
      client={selectedClient}
      canDeleteClient={canDeleteClient}
      onClose={() => setSelectedClient(null)}
    />
  )
}
