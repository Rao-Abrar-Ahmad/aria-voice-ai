import { useCallback, useRef } from 'react'

export function useAudioPlayer(onEnded: () => void) {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stop = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current = null
  }, [])

  const play = useCallback(
    async (base64: string, format = 'mp3') => {
      stop()
      const audio = new Audio(`data:audio/${format};base64,${base64}`)
      audioRef.current = audio
      audio.onended = onEnded
      await audio.play()
    },
    [onEnded, stop],
  )

  return { play, stop }
}
