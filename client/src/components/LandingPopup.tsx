import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog'

interface Props {
  open: boolean
  onContinue: (email?: string) => void
}

export function LandingPopup({ open, onContinue }: Props) {
  const [email, setEmail] = useState('');

  return (
    <Dialog open={open}>
      <DialogContent className="sm:max-w-sm" hideClose>
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold tracking-tight">Voice AI</DialogTitle>
          <DialogDescription className="text-center text-sm text-zinc-500 dark:text-zinc-400">
            Sign in with email or continue as a guest to start voice interaction.
          </DialogDescription>
        </DialogHeader>




        <div className="flex flex-col gap-3 pt-2">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && email && onContinue(email)}
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-gray-950 dark:text-gray-50"
          />
          <button
            onClick={() => email && onContinue(email)}
            disabled={!email}
            className="w-full py-3 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition disabled:opacity-40 shadow-lg shadow-indigo-600/20"
          >
            Sign in with email
          </button>

        </div>

        {/* Create a or line */}
        <div className='relative flex items-center justify-center gap-2 text-sm'>
          <hr className='absolute w-full h-1 bg-gray-200 dark:bg-gray-800' />
          <span className='relative z-10 bg-background dark:bg-background px-2'>Or</span>
        </div>

        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => onContinue(undefined)}
            className="w-full py-3 rounded-xl border border-gray-200 dark:border-gray-800 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 transition"
          >
            Continue as guest
          </button>
        </div>


      </DialogContent>
    </Dialog>
  )
}
