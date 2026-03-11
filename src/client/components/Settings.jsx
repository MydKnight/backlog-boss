import { useState, useEffect } from 'react';

/**
 * Account settings overlay — shown from the ⚙ button bottom sheet.
 * Lets the user update their display name and Steam credentials.
 */
export default function Settings({ onClose, onSaved }) {
  const [username, setUsername] = useState('');
  const [steamApiKey, setSteamApiKey] = useState('');
  const [steamId, setSteamId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [hadSteam, setHadSteam] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        setUsername(data.username ?? '');
        setHadSteam(data.steamConfigured);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const body = { username: username.trim() };
      if (steamApiKey.trim()) body.steamApiKey = steamApiKey.trim();
      if (steamId.trim()) body.steamId = steamId.trim();

      const res = await fetch('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to save.');

      const credentialsChanged = steamApiKey.trim() || steamId.trim();
      setSuccess(true);
      onSaved?.();

      // If Steam credentials changed, offer to re-sync
      if (credentialsChanged) {
        const doSync = window.confirm('Steam credentials updated. Sync library now?');
        if (doSync) {
          await fetch('/api/sync', { method: 'POST' });
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-slate-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-700 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-100">Account Settings</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-xl leading-none">✕</button>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm py-4">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Display Name</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Steam API Key {hadSteam && <span className="text-slate-500">(leave blank to keep current)</span>}
              </label>
              <input
                type="password"
                value={steamApiKey}
                onChange={e => setSteamApiKey(e.target.value)}
                placeholder={hadSteam ? '••••••••' : 'Enter key'}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>

            <div>
              <label className="block text-sm text-slate-300 mb-1">
                Steam ID {hadSteam && <span className="text-slate-500">(leave blank to keep current)</span>}
              </label>
              <input
                type="text"
                value={steamId}
                onChange={e => setSteamId(e.target.value)}
                placeholder={hadSteam ? '(configured)' : 'e.g. 76561198000000000'}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">Saved.</p>}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-semibold rounded-lg py-2.5 transition-colors"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
