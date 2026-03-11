import { useState } from 'react';

/**
 * Full-screen onboarding overlay shown when the user has a CF identity
 * but hasn't configured Steam credentials yet.
 */
export default function Onboarding({ onComplete }) {
  const [username, setUsername] = useState('');
  const [steamApiKey, setSteamApiKey] = useState('');
  const [steamId, setSteamId] = useState('');
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username.trim() || !steamApiKey.trim() || !steamId.trim()) {
      setError('All three fields are required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const patchRes = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), steamApiKey: steamApiKey.trim(), steamId: steamId.trim() }),
      });
      if (!patchRes.ok) throw new Error('Failed to save credentials.');

      setSyncing(true);
      const syncRes = await fetch('/api/sync', { method: 'POST' });
      if (!syncRes.ok) throw new Error('Sync failed — credentials saved, reload to try again.');

      onComplete();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setSyncing(false);
    }
  }

  function handleSkip() {
    onComplete();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold text-slate-100 mb-1">Welcome to Backlog Boss</h1>
        <p className="text-slate-400 mb-6 text-sm">Connect your Steam library to get started.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Display Name</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Your name"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Steam API Key</label>
            <input
              type="password"
              value={steamApiKey}
              onChange={e => setSteamApiKey(e.target.value)}
              placeholder="Get it at steamcommunity.com/dev/apikey"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              <a
                href="https://steamcommunity.com/dev/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                steamcommunity.com/dev/apikey
              </a>
            </p>
          </div>

          <div>
            <label className="block text-sm text-slate-300 mb-1">Steam ID (64-bit)</label>
            <input
              type="text"
              value={steamId}
              onChange={e => setSteamId(e.target.value)}
              placeholder="e.g. 76561198000000000"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              Find yours at{' '}
              <a
                href="https://www.steamidfinder.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                steamidfinder.com
              </a>
            </p>
          </div>

          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving || syncing}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-semibold rounded-lg py-2.5 transition-colors"
          >
            {syncing ? 'Syncing library…' : saving ? 'Saving…' : 'Connect Steam & Sync'}
          </button>

          <button
            type="button"
            onClick={handleSkip}
            className="w-full text-slate-500 hover:text-slate-300 text-sm py-2 transition-colors"
          >
            Skip for now (empty library)
          </button>
        </form>
      </div>
    </div>
  );
}
