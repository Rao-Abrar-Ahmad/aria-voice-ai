import { useCallback, useEffect, useRef, useState } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

const VAD_WORKLET_URL = new URL('../vad-assets/vad.worklet.bundle.min.js', import.meta.url).href
const VAD_ASSET_BASE_PATH = VAD_WORKLET_URL.replace(/vad\.worklet\.bundle\.min\.js$/, '')

console.log('useVAD config', {
  VAD_WORKLET_URL,
  VAD_ASSET_BASE_PATH,
})

const _vadAssetUrls = [
  new URL('../vad-assets/ort-wasm-simd-threaded.mjs', import.meta.url).href,
  new URL('../vad-assets/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href,
  new URL('../vad-assets/ort-wasm-simd-threaded.jspi.mjs', import.meta.url).href,
  new URL('../vad-assets/ort-wasm-simd-threaded.wasm', import.meta.url).href,
  new URL('../vad-assets/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href,
  new URL('../vad-assets/ort-wasm-simd-threaded.jspi.wasm', import.meta.url).href,
  new URL('../vad-assets/silero_vad.onnx', import.meta.url).href,
  new URL('../vad-assets/silero_vad_legacy.onnx', import.meta.url).href,
  new URL('../vad-assets/vad.worklet.bundle.js', import.meta.url).href,
  VAD_WORKLET_URL,
]
void _vadAssetUrls

export function useVAD(onSpeechEnd: (audio: Float32Array) => void) {
  const vadRef = useRef<InstanceType<typeof MicVAD> | null>(null)
  const [listening, setListening] = useState(false)
  const [userSpeaking, setUserSpeaking] = useState(false)
  const [errored, setErrored] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const cleanupVad = useCallback(async () => {
    if (!vadRef.current) return

    try {
      await vadRef.current.destroy()
    } catch (error) {
      console.warn('VAD cleanup failed:', error)
    }

    vadRef.current = null
    setListening(false)
    setUserSpeaking(false)
  }, [])

  useEffect(() => {
    return () => {
      void cleanupVad()
    }
  }, [cleanupVad])

  const createVad = useCallback(async () => {
    if (vadRef.current) return vadRef.current

    setLoading(true)
    setErrored(null)

    try {
      const vad = await MicVAD.new({
        startOnLoad: false,
        model: 'legacy',
        baseAssetPath: VAD_ASSET_BASE_PATH,
        onnxWASMBasePath: VAD_ASSET_BASE_PATH,
        workletURL: VAD_WORKLET_URL,
        getStream: async () => {
          return await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              autoGainControl: true,
              noiseSuppression: true,
            },
          })
        },
        pauseStream: async (stream) => {
          stream.getTracks().forEach((track) => track.stop())
        },
        resumeStream: async () => {
          return await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              autoGainControl: true,
              noiseSuppression: true,
            },
          })
        },
        onSpeechStart: () => {
          setUserSpeaking(true)
        },
        onSpeechEnd: (audio: Float32Array) => {
          setUserSpeaking(false)
          console.log('VAD detected speech end', { audioLength: audio.length })
          onSpeechEnd(audio)
        },
      })

      vadRef.current = vad
      return vad
    } catch (error: any) {
      const message = error?.message ?? String(error)
      setErrored(message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [onSpeechEnd])

  const start = useCallback(async () => {
    try {
      const vad = await createVad()
      await vad.start()
      setListening(true)
      console.log('VAD started')
    } catch (error: any) {
      const message = error?.message ?? String(error)
      console.error('VAD start failed:', message)
      setErrored(message)
      throw error
    }
  }, [createVad])

  const pause = useCallback(async () => {
    if (!vadRef.current) return

    try {
      await vadRef.current.pause()
      setListening(false)
      console.log('VAD paused')
    } catch (error: any) {
      const message = error?.message ?? String(error)
      console.error('VAD pause failed:', message)
      setErrored(message)
    }
  }, [])

  return {
    start,
    pause,
    listening,
    userSpeaking,
    errored,
    loading,
  }
}
