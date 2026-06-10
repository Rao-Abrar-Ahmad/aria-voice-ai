import { useCallback, useRef } from 'react'

export function useAudioPlayer(onEnded: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current = null
  }, [])

  const playSource = useCallback(
    async (source: string) => {
      stop()
      const audio = new Audio(source)
      audioRef.current = audio
      audio.onended = onEnded
      await audio.play()
    },
    [onEnded, stop],
  )

  const play = useCallback(
    async (base64: string, format = 'mp3') => {
      await playSource(`data:audio/${format};base64,${base64}`)
    },
    [playSource],
  )

  const playUrl = useCallback(
    async (url: string) => {
      await playSource(url)
    },
    [playSource],
  )

  return { play, playUrl, stop }
}
