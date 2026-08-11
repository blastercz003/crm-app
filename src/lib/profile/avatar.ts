export const PROFILE_AVATARS_BUCKET = 'profile-avatars'
export const PROFILE_AVATAR_PATH_SUFFIX = '/avatar.webp'

export function getProfileInitials(value: string) {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 0) return 'U'

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase('cs-CZ'))
    .join('')
}
