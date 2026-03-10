import { useState } from 'react';

/**
 * Triggers POST /api/sync and calls onComplete when done.
 */
export default function SyncButton({ onComplete }) {
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setLastResult(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      setLastResult(data.status === 'success' ? 'ok' : 'partial');
      onComplete?.();
    } catch {
      setLastResult('error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <button
      onClick={handleSync}
      disabled={syncing}
      title="Sync Steam library"
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
        ${syncing
          ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
          : 'bg-slate-700 text-slate-200 active:bg-slate-600'
        }
        ${lastResult === 'ok' ? 'text-emerald-400' : ''}
        ${lastResult === 'error' ? 'text-red-400' : ''}
      `}
    >
      <span className={syncing ? 'animate-spin inline-block' : ''}>⟳</span>
      <span>{syncing ? 'Syncing…' : 'Sync'}</span>
    </button>
  );
}
