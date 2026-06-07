import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'

interface Props {
  open: boolean
  onClose: () => void
  guestId: string
}

export function SettingsPopup({ open, onClose, guestId }: Props) {
  const [userName, setUserName] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !guestId) return

    const loadConfig = async () => {
      try {
        const res = await fetch(`/api/config?guest_id=${guestId}`)
        if (res.ok) {
          const data = await res.json()
          setUserName(data.user_name || '')
          setCustomInstructions(data.custom_instructions || '')
        }
      } catch (err) {
        console.error('Failed to load configuration:', err)
      }
    }

    loadConfig()
  }, [open, guestId])

  const handleSave = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_id: guestId,
          user_name: userName,
          custom_instructions: customInstructions,
        }),
      })
      if (res.ok) onClose()
    } catch (err) {
      console.error('Failed to save configuration:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">Voice Preferences</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your Name</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-950 dark:text-gray-50 font-medium"
              placeholder="Rao"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Instructions for AI</label>
            <textarea
              value={customInstructions}
              rows={4}
              onChange={(e) => setCustomInstructions(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-950 dark:text-gray-50 leading-relaxed resize-none"
              placeholder="Tell the assistant how to respond to you..."
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 transition font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition shadow-lg shadow-indigo-600/20 disabled:opacity-40"
          >
            {loading ? 'Saving...' : 'Save Preferences'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
