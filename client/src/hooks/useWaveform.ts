import { useEffect, useRef } from 'react'

export type WaveformState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

const STATE_COLORS: Record<WaveformState, string> = {
  idle: '#6b7280',
  listening: '#6366f1',    // indigo — user speaking
  transcribing: '#9ca3af',
  thinking: '#9ca3af',
  speaking: '#10b981',     // emerald — AI speaking
}

export function useWaveform(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  analyserRef: React.RefObject<AnalyserNode | null>,
  state: WaveformState
) {
  const animFrameRef = useRef<number>()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const color = STATE_COLORS[state]
    const isLive = state === 'listening' || state === 'speaking'
    const isBreathing = state === 'transcribing' || state === 'thinking'
    let phase = 0

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw)
      const W = canvas.width
      const H = canvas.height
      ctx.clearRect(0, 0, W, H)
      ctx.beginPath()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'

      if (isLive && analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount
        const dataArray = new Float32Array(bufferLength)
        analyserRef.current.getFloatTimeDomainData(dataArray)
        const sliceWidth = W / bufferLength
        let x = 0
        for (let i = 0; i < bufferLength; i++) {
          // Calculate average or scale the float time domain data
          const y = (dataArray[i] * H * 1.5) + H / 2
          if (i === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
          x += sliceWidth
        }
      } else if (isBreathing) {
        phase += 0.04
        for (let x = 0; x <= W; x += 2) {
          const y = H / 2 + Math.sin((x / W) * Math.PI * 4 + phase) * (8 + Math.sin(phase * 0.5) * 4)
          if (x === 0) {
            ctx.moveTo(x, y)
          } else {
            ctx.lineTo(x, y)
          }
        }
      } else {
        ctx.moveTo(0, H / 2)
        ctx.lineTo(W, H / 2)
      }

      ctx.stroke()
    }

    draw()
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [state, canvasRef, analyserRef])
}
