import { useState } from 'react';

const PLATFORMS = [
  { value: 'owned_ps5',    label: 'PlayStation 5' },
  { value: 'owned_switch', label: 'Nintendo Switch' },
  { value: 'owned_other',  label: 'Other' },
];

/**
 * Bottom sheet for adding a non-Steam game to the Now view.
 * Collects platform (ownership_type) and optional hours played.
 */
export default function CurrentlyPlayingSheet({ game, onSubmit, onClose }) {
  const [platform, setPlatform] = useState('');
  const [hours, setHours] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = platform !== '' && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const playtimeMinutes = hours ? Math.round(parseFloat(hours) * 60) : 0;
      await onSubmit({ ownershipType: platform, playtimeMinutes });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 rounded-t-2xl">

        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Currently Playing</p>
            <p className="font-semibold text-slate-100 line-clamp-1">{game.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 text-xl px-2">✕</button>
        </div>

        <div className="px-4 py-4 flex flex-col gap-4">

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">
              Platform <span className="text-red-400">*</span>
            </p>
            <div className="flex flex-col gap-2">
              {PLATFORMS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPlatform(p.value)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors
                    ${platform === p.value
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-700 text-slate-300 active:bg-slate-800'
                    }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">
              Hours played <span className="text-slate-500">(optional)</span>
            </p>
            <input
              type="number"
              min="0"
              step="0.5"
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder="e.g. 12"
              className="w-full bg-slate-800 text-slate-100 placeholder-slate-600 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

        </div>

        <div className="px-4 pb-8 pt-2">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-colors
              ${canSubmit
                ? 'bg-indigo-600 text-white active:bg-indigo-700'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
          >
            {submitting ? 'Adding…' : 'Add to Now'}
          </button>
        </div>

      </div>
    </div>
  );
}
