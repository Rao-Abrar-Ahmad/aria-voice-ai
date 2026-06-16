import { useEffect, useRef } from 'react'
import SpeechRecognition, { useSpeechRecognition as useBrowserSpeechRecognition } from 'react-speech-recognition'
import { useVoiceStore } from '../store/voiceStore'

export function useSpeechInput(enabled: boolean, onFinalTranscript: (text: string) => void) {
  const setInterimText = useVoiceStore((state) => state.setInterimText)
  const finalTranscriptRef = useRef('')
  const { interimTranscript, finalTranscript, browserSupportsSpeechRecognition, isMicrophoneAvailable, resetTranscript } =
    useBrowserSpeechRecognition()

  useEffect(() => {
    setInterimText(interimTranscript);
    //console.log('interim transcript', interimTranscript);
  }, [interimTranscript, setInterimText])

  useEffect(() => {
    const text = finalTranscript.trim()
    //console.log('final transcript', finalTranscript);
    if (!enabled || !text || text === finalTranscriptRef.current) return
    finalTranscriptRef.current = text
    onFinalTranscript(text)
    resetTranscript()
  }, [enabled, finalTranscript, onFinalTranscript, resetTranscript])

  useEffect(() => {
    if (!enabled) {
      SpeechRecognition.stopListening()
      return
    }

    SpeechRecognition.startListening({ continuous: true, language: 'en-US' })
    return () => {
      SpeechRecognition.stopListening()
    }
  }, [enabled])

  return {
    supported: browserSupportsSpeechRecognition,
    microphoneAvailable: isMicrophoneAvailable,
  }
}
