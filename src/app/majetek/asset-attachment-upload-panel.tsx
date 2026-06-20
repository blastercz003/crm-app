'use client'

import { useActionState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import {
  uploadAssetDocumentsAction,
  uploadAssetPhotosAction,
  type AssetAttachmentUploadActionState,
} from './attachments-actions'

type DocumentTypeOption = {
  id: string
  name: string
}

const initialState: AssetAttachmentUploadActionState = {
  success: false,
  error: null,
}

const inputClassName =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

type AssetAttachmentUploadPanelProps = {
  assetId: string
  kind: 'documents' | 'photos'
  documentTypes?: DocumentTypeOption[]
}

export function AssetAttachmentUploadPanel({
  assetId,
  kind,
  documentTypes = [],
}: AssetAttachmentUploadPanelProps) {
  return kind === 'documents' ? (
    <UploadPanel
      assetId={assetId}
      kind={kind}
      documentTypes={documentTypes}
      title="Nahrát dokumenty"
      description=""
      accept="application/pdf"
      buttonLabel="NAHRÁT PDF"
      multiple
    />
  ) : (
    <UploadPanel
      assetId={assetId}
      kind={kind}
      title="Nahrát fotky"
      description="Více fotek najednou, ideálně ve formátu JPG nebo PNG."
      accept="image/*"
      buttonLabel="NAHRÁT FOTKY"
      multiple
    />
  )
}

function UploadPanel({
  assetId,
  kind,
  documentTypes = [],
  title,
  description,
  accept,
  buttonLabel,
  multiple,
}: {
  assetId: string
  kind: 'documents' | 'photos'
  documentTypes?: DocumentTypeOption[]
  title: string
  description?: string
  accept: string
  buttonLabel: string
  multiple: boolean
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [state, formAction] = useActionState(
    kind === 'documents' ? uploadAssetDocumentsAction : uploadAssetPhotosAction,
    initialState
  )

  useEffect(() => {
    if (!state.success) return
    router.refresh()
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [router, state.success])

  return (
    <section className="assets-page__summary rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        {description ? <p className="text-sm leading-6 text-gray-600">{description}</p> : null}
      </div>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="asset_id" value={assetId} />

        {kind === 'documents' ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <label className="clients-modal__label text-sm font-medium text-gray-900" htmlFor={`document-type-${assetId}`}>
                Typ dokumentu
              </label>
              <select
                id={`document-type-${assetId}`}
                name="document_type_id"
                defaultValue={documentTypes[0]?.id ?? ''}
                className="clients-modal__select h-12 w-full rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              >
                {documentTypes.map((documentType) => (
                  <option key={documentType.id} value={documentType.id}>
                    {documentType.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="clients-modal__label text-sm font-medium text-gray-900" htmlFor={`document-note-${assetId}`}>
                Poznámka
              </label>
              <input
                id={`document-note-${assetId}`}
                name="note"
                type="text"
                placeholder="Volitelná poznámka"
                className={inputClassName}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="clients-modal__label text-sm font-medium text-gray-900" htmlFor={`photo-note-${assetId}`}>
              Poznámka
            </label>
            <input
              id={`photo-note-${assetId}`}
              name="note"
              type="text"
              placeholder="Volitelná poznámka k fotkám"
              className={inputClassName}
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="clients-modal__label text-sm font-medium text-gray-900" htmlFor={`file-${assetId}`}>
            Soubor(y)
          </label>
          <input
            ref={fileInputRef}
            id={`file-${assetId}`}
            name="files"
            type="file"
            accept={accept}
            multiple={multiple}
            className="clients-modal__input w-full rounded-2xl border border-dashed border-gray-300 bg-white/80 px-4 py-3 text-sm text-gray-700 file:mr-4 file:rounded-xl file:border-0 file:bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:opacity-95"
          />
        </div>

        {state.error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </div>
        ) : null}

        {state.success ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            Nahráno {state.uploadedCount ?? 0} souborů.
          </div>
        ) : null}

        <UploadActions buttonLabel={buttonLabel} />
      </form>
    </section>
  )
}

function UploadActions({ buttonLabel }: { buttonLabel: string }) {
  const { pending } = useFormStatus()

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? 'NAHRÁVÁM...' : buttonLabel}
      </button>
    </div>
  )
}
