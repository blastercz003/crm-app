'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteAssetDocumentAction, type DeleteAssetDocumentActionState } from './attachments-actions'

const initialState: DeleteAssetDocumentActionState = {
  success: false,
  error: null,
}

type AssetDocumentDeleteButtonProps = {
  assetId: string
  documentId: string
}

export function AssetDocumentDeleteButton({ assetId, documentId }: AssetDocumentDeleteButtonProps) {
  const router = useRouter()
  const [isConfirming, setIsConfirming] = useState(false)
  const [state, formAction] = useActionState(deleteAssetDocumentAction, initialState)

  useEffect(() => {
    if (!state.success) return

    router.refresh()
  }, [router, state.success])

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="asset_id" value={assetId} />
      <input type="hidden" name="document_id" value={documentId} />

      {isConfirming ? (
        <>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition duration-200 hover:-translate-y-[1px] hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
          >
            Smazat
          </button>
          <button
            type="button"
            onClick={() => setIsConfirming(false)}
            className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 transition duration-200 hover:-translate-y-[1px] hover:text-gray-900"
          >
            Zrušit
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className="inline-flex items-center justify-center rounded-2xl border border-white/75 bg-white/80 px-3 py-2 text-xs font-medium text-red-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-red-700"
          aria-label="Smazat dokument"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}

      {state.error ? <p className="text-xs text-red-600">{state.error}</p> : null}
    </form>
  )
}
