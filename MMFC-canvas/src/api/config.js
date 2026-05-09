/**
 * Canvas Server Config API
 * Fetches the active provider + default model info from the Next.js backend.
 * No API keys are returned — only provider identifiers.
 */

export const fetchCanvasConfig = async () => {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const res = await fetch(`${origin}/api/canvas/config`, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
