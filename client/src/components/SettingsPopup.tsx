import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { saveConfig } from '../lib/api'
import { useVoiceStore } from '../store/voiceStore'

interface Props {
  open: boolean
  onClose: () => void
}

export function SettingsPopup({ open, onClose }: Props) {
  const config = useVoiceStore((state) => state.config)
  const setConfig = useVoiceStore((state) => state.setConfig)
  const [aiName, setAiName] = useState(config.ai_name)
  const [systemPrompt, setSystemPrompt] = useState(config.system_prompt)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setAiName(config.ai_name)
    setSystemPrompt(config.system_prompt)
  }, [config.ai_name, config.system_prompt, open])

  const handleSave = async () => {
    setLoading(true)
    try {
      const updated = await saveConfig({ ai_name: aiName, system_prompt: systemPrompt })
      setConfig(updated)
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">Voice Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">AI Name</label>
            <input
              type="text"
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-transparent px-4 py-3 text-sm text-zinc-950 outline-none focus:ring-2 focus:ring-teal-500 dark:border-zinc-800 dark:text-zinc-50"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">System Prompt</label>
            <textarea
              value={systemPrompt}
              rows={7}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full resize-none rounded-lg border border-zinc-200 bg-transparent px-4 py-3 text-sm leading-relaxed text-zinc-950 outline-none focus:ring-2 focus:ring-teal-500 dark:border-zinc-800 dark:text-zinc-50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-teal-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-40"
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

