import { useRef, useEffect } from 'react'
import { useWaveform, type WaveformState } from '../hooks/useWaveform'

interface Props {
  state: WaveformState
  analyserNode: AnalyserNode | null
}

export function WaveformCanvas({ state, analyserNode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const analyserRef = useRef<AnalyserNode | null>(analyserNode)

  useEffect(() => {
    analyserRef.current = analyserNode
  }, [analyserNode])

  useWaveform(canvasRef, analyserRef, state)

  return (
    <canvas
      ref={canvasRef}
      width={640}
      height={160}
      className={`w-full h-40 rounded-2xl bg-black/5 dark:bg-white/5 waveform-glow ${state} border border-indigo-500/10 dark:border-white/5 transition-all duration-300`}
    />
  )
}
