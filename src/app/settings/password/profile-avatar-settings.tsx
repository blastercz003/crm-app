'use client'

import {
  type ChangeEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase/client'
import {
  getProfileInitials,
  PROFILE_AVATAR_PATH_SUFFIX,
  PROFILE_AVATARS_BUCKET,
} from '@/lib/profile/avatar'

const PROFILE_AVATAR_MAX_INPUT_BYTES = 15 * 1024 * 1024
const PROFILE_AVATAR_MAX_SIZE = 512
const PROFILE_AVATAR_WEBP_QUALITY = 0.82
const PROFILE_AVATAR_CHANGED_EVENT = 'profile-avatar-changed'

type ProfileRow = {
  name: string | null
  avatar_path: string | null
}

type AvatarCrop = {
  centerX: number
  centerY: number
  size: number
}

type PendingAvatar = AvatarCrop & {
  file: File
  url: string
  width: number
  height: number
  zoom: number
}

function constrainCrop(
  centerX: number,
  centerY: number,
  width: number,
  height: number,
  size: number,
): AvatarCrop {
  const halfSize = size / 2

  return {
    centerX: Math.min(Math.max(centerX, halfSize), width - halfSize),
    centerY: Math.min(Math.max(centerY, halfSize), height - halfSize),
    size,
  }
}

function createAvatarFile(file: File, crop: AvatarCrop): Promise<File> {
  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight) {
          reject(new Error('Fotografii se nepodařilo načíst.'))
          return
        }

        const sourceSize = Math.min(crop.size, image.naturalWidth, image.naturalHeight)
        const outputSize = Math.min(PROFILE_AVATAR_MAX_SIZE, Math.round(sourceSize))
        const sourceX = Math.max(0, Math.min(crop.centerX - sourceSize / 2, image.naturalWidth - sourceSize))
        const sourceY = Math.max(0, Math.min(crop.centerY - sourceSize / 2, image.naturalHeight - sourceSize))
        const canvas = document.createElement('canvas')
        canvas.width = outputSize
        canvas.height = outputSize

        const context = canvas.getContext('2d')

        if (!context) {
          reject(new Error('Přípravu fotografie se nepodařilo spustit.'))
          return
        }

        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceSize,
          sourceSize,
          0,
          0,
          outputSize,
          outputSize,
        )

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Fotografii se nepodařilo zkomprimovat.'))
              return
            }

            resolve(
              new File([blob], 'avatar.webp', {
                type: 'image/webp',
              }),
            )
          },
          'image/webp',
          PROFILE_AVATAR_WEBP_QUALITY,
        )
      } finally {
        URL.revokeObjectURL(imageUrl)
      }
    }

    image.onerror = () => {
      URL.revokeObjectURL(imageUrl)
      reject(new Error('Fotografii se nepodařilo načíst.'))
    }

    image.src = imageUrl
  })
}

export function ProfileAvatarSettings({ children }: { children: ReactNode }) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragStartRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [avatarMessage, setAvatarMessage] = useState('')
  const [pendingAvatar, setPendingAvatar] = useState<PendingAvatar | null>(null)

  const displayName = name?.trim() || email || 'Uživatel'
  const initials = useMemo(() => getProfileInitials(displayName), [displayName])

  useEffect(() => {
    let cancelled = false

    async function loadProfile() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        if (!cancelled) setIsLoading(false)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('name, avatar_path')
        .eq('id', user.id)
        .single<ProfileRow>()

      let nextAvatarUrl: string | null = null
      const avatarPath = data?.avatar_path?.trim()

      if (avatarPath) {
        const { data: signedUrl } = await supabase.storage
          .from(PROFILE_AVATARS_BUCKET)
          .createSignedUrl(avatarPath, 60 * 60)

        nextAvatarUrl = signedUrl?.signedUrl ?? null
      }

      if (!cancelled) {
        setName(data?.name ?? null)
        setEmail(user.email ?? '')
        setAvatarUrl(nextAvatarUrl)
        setIsLoading(false)
      }
    }

    void loadProfile()

    return () => {
      cancelled = true
    }
  }, [])

  async function uploadAvatar(file: File, crop: AvatarCrop) {
    setAvatarMessage('')
    setIsUploading(true)

    try {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('Pro změnu fotografie je potřeba být přihlášený.')
      }

      const preparedAvatar = await createAvatarFile(file, crop)
      const avatarPath = `${user.id}${PROFILE_AVATAR_PATH_SUFFIX}`
      const { error: uploadError } = await supabase.storage
        .from(PROFILE_AVATARS_BUCKET)
        .upload(avatarPath, preparedAvatar, {
          cacheControl: '3600',
          contentType: 'image/webp',
          upsert: true,
        })

      if (uploadError) throw uploadError

      const updatedAt = new Date().toISOString()
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          avatar_path: avatarPath,
          avatar_updated_at: updatedAt,
        })
        .eq('id', user.id)

      if (profileError) throw profileError

      const { data: signedUrl, error: signedUrlError } = await supabase.storage
        .from(PROFILE_AVATARS_BUCKET)
        .createSignedUrl(avatarPath, 60 * 60)

      if (signedUrlError || !signedUrl?.signedUrl) {
        throw signedUrlError ?? new Error('Náhled fotografie se nepodařilo načíst.')
      }

      setAvatarUrl(`${signedUrl.signedUrl}&v=${encodeURIComponent(updatedAt)}`)
      setAvatarMessage('Profilová fotografie byla uložena.')
      closeCropEditor()
      window.dispatchEvent(new Event(PROFILE_AVATAR_CHANGED_EVENT))
    } catch (error) {
      setAvatarMessage(
        error instanceof Error ? error.message : 'Fotografii se nepodařilo uložit.',
      )
    } finally {
      setIsUploading(false)
    }
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) return

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setAvatarMessage('Vyber fotografii ve formátu JPG, PNG nebo WebP.')
      return
    }

    if (file.size > PROFILE_AVATAR_MAX_INPUT_BYTES) {
      setAvatarMessage('Vyber fotografii menší než 15 MB.')
      return
    }

    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      const size = Math.min(image.naturalWidth, image.naturalHeight)

      if (!size) {
        URL.revokeObjectURL(url)
        setAvatarMessage('Fotografii se nepodařilo načíst.')
        return
      }

      setAvatarMessage('')
      setPendingAvatar({
        file,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        centerX: image.naturalWidth / 2,
        centerY: image.naturalHeight / 2,
        size,
        zoom: 1,
      })
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      setAvatarMessage('Fotografii se nepodařilo načíst.')
    }

    image.src = url
  }

  function closeCropEditor() {
    setPendingAvatar((current) => {
      if (current) URL.revokeObjectURL(current.url)
      return null
    })
    dragStartRef.current = null
  }

  function updatePendingAvatar(updater: (current: PendingAvatar) => PendingAvatar) {
    setPendingAvatar((current) => (current ? updater(current) : null))
  }

  function handleZoomChange(zoom: number) {
    updatePendingAvatar((current) => {
      const size = Math.min(current.width, current.height) / zoom
      const crop = constrainCrop(current.centerX, current.centerY, current.width, current.height, size)
      return { ...current, ...crop, zoom }
    })
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!pendingAvatar) return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      centerX: pendingAvatar.centerX,
      centerY: pendingAvatar.centerY,
    }
  }

  function handleCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pendingAvatar || !dragStartRef.current) return

    const scale = event.currentTarget.getBoundingClientRect().width / pendingAvatar.size
    const crop = constrainCrop(
      dragStartRef.current.centerX - (event.clientX - dragStartRef.current.x) / scale,
      dragStartRef.current.centerY - (event.clientY - dragStartRef.current.y) / scale,
      pendingAvatar.width,
      pendingAvatar.height,
      pendingAvatar.size,
    )

    updatePendingAvatar((current) => ({ ...current, ...crop }))
  }

  function handleCropPointerEnd() {
    dragStartRef.current = null
  }

  return (
    <section className="password-page__panel flex h-full flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] md:p-5">
      <div className="password-page__eyebrow text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        Můj profil
      </div>

      <div className="flex flex-col items-center px-3 pb-5 pt-6 text-center">
        <div className="relative">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-[#9dc7e5] bg-[linear-gradient(145deg,#eff8ff_0%,#cfe6f7_100%)] text-xl font-semibold tracking-[0.04em] text-[#276b9a] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_12px_24px_rgba(38,112,159,0.18)]">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={`Profilová fotografie: ${displayName}`} className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <span className="absolute bottom-0 right-0 h-5 w-5 rounded-full border-2 border-white bg-[#4d90c5] shadow-[0_2px_8px_rgba(41,128,185,0.24)]" />
        </div>

        <p className="password-page__profile-name mt-3 max-w-full truncate text-base font-semibold text-zinc-900">
          {isLoading ? 'Načítám profil…' : displayName}
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          onChange={handleAvatarChange}
        />
        <button
          type="button"
          disabled={isLoading || isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="password-page__profile-avatar-button mt-3 inline-flex items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-2 text-[11px] font-semibold tracking-[0.01em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(41,128,185,0.3)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {isUploading
            ? 'UKLÁDÁM FOTOGRAFII...'
            : avatarUrl
              ? 'ZMĚNIT PROFILOVKU'
              : 'NAHRÁT PROFILOVKU'}
        </button>
        {avatarMessage ? (
          <p className="password-page__text mt-2 max-w-[18rem] text-xs text-zinc-500">{avatarMessage}</p>
        ) : null}
      </div>

      <div className="border-t border-[#d5e2ec] pt-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)]">
        {children}
      </div>

      {pendingAvatar ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="avatar-crop-title"
          className="password-page__avatar-crop-overlay fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
        >
          <div className="password-page__avatar-crop-dialog w-full max-w-sm rounded-[28px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.98)_0%,rgba(241,247,252,0.96)_100%)] p-5 shadow-[0_24px_64px_rgba(15,23,42,0.28)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.18)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(15,23,42,0.99)_0%,rgba(10,17,30,0.98)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_28px_70px_rgba(0,0,0,0.48)]">
            <div className="mb-4 text-center">
              <h2 id="avatar-crop-title" className="password-page__avatar-crop-title text-lg font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-[#f8fbff]">
                Upravit výřez
              </h2>
              <p className="password-page__avatar-crop-text mt-1 text-sm text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">Přetáhni fotku tak, aby byl obličej uprostřed.</p>
            </div>

            <div
              className="relative mx-auto aspect-square w-[min(72vw,280px)] touch-none overflow-hidden rounded-full border-[3px] border-white bg-slate-100 shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerEnd}
              onPointerCancel={handleCropPointerEnd}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pendingAvatar.url}
                alt="Výřez profilové fotografie"
                draggable={false}
                className="pointer-events-none absolute max-w-none select-none"
                style={{
                  width: `${(pendingAvatar.width / pendingAvatar.size) * 100}%`,
                  height: `${(pendingAvatar.height / pendingAvatar.size) * 100}%`,
                  left: `calc(50% - ${(pendingAvatar.centerX / pendingAvatar.size) * 100}%)`,
                  top: `calc(50% - ${(pendingAvatar.centerY / pendingAvatar.size) * 100}%)`,
                }}
              />
            </div>

            <label className="mt-5 block">
              <span className="password-page__avatar-crop-label mb-2 block text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">Přiblížení</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={pendingAvatar.zoom}
                onChange={(event) => handleZoomChange(Number(event.target.value))}
                className="password-page__avatar-crop-range w-full accent-[#3c83b8]"
              />
            </label>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={closeCropEditor}
                disabled={isUploading}
                className="password-page__avatar-crop-cancel rounded-xl border border-[#bfd4e5] bg-white/75 px-3 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.2)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.8)] [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:bg-[rgba(30,41,59,0.9)]"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={() => void uploadAvatar(pendingAvatar.file, pendingAvatar)}
                disabled={isUploading}
                className="rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-2.5 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(41,128,185,0.22)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploading ? 'Ukládám…' : 'Uložit profilovku'}
              </button>
            </div>
          </div>
        </div>
      , document.body) : null}
    </section>
  )
}
