import { useState, useEffect } from 'react';

/**
 * Bottom-sheet overlay for managing guides attached to a game.
 *
 * Props:
 *   igdbId     — game identifier
 *   gameTitle  — shown in header
 *   onClose    — close this sheet
 *   onOpenReader — called with (guideId) to open the full reader
 */
export default function GuideSheet({ igdbId, gameTitle, onClose, onOpenReader }) {
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);     // show URL input form
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false); // guide fetch in progress
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    loadGuides();
  }, [igdbId]);

  async function loadGuides() {
    setLoading(true);
    try {
      const res = await fetch(`/api/guides/${igdbId}`);
      const data = await res.json();
      setGuides(data.guides ?? []);
    } catch {
      setGuides([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!url.trim()) return;

    setFetching(true);
    setFetchError(null);
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ igdbId, url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setGuides(prev => [data.guide, ...prev]);
      setUrl('');
      setAdding(false);
    } catch (err) {
      setFetchError(err.message);
    } finally {
      setFetching(false);
    }
  }

  async function handleDelete(guideId) {
    await fetch(`/api/guides/${guideId}`, { method: 'DELETE' });
    setGuides(prev => prev.filter(g => g.id !== guideId));
  }

  const dateLabel = iso => iso
    ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-slate-900 rounded-t-2xl overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-slate-500">Guides</p>
            <p className="text-sm font-semibold text-slate-100 line-clamp-1">{gameTitle}</p>
          </div>
          <button
            onClick={() => { setAdding(true); setFetchError(null); }}
            className="text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            + Add
          </button>
        </div>

        {/* Add URL form */}
        {adding && (
          <form onSubmit={handleAdd} className="px-4 py-3 border-b border-slate-800 shrink-0">
            <p className="text-xs text-slate-400 mb-2">Paste a guide URL (GameFAQs, wiki, etc.)</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://gamefaqs.gamespot.com/…"
                className="flex-1 text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
                autoFocus
                disabled={fetching}
              />
              <button
                type="submit"
                disabled={fetching || !url.trim()}
                className="text-sm px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {fetching ? '…' : 'Fetch'}
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setUrl(''); setFetchError(null); }}
                className="text-sm px-3 py-2 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors"
                disabled={fetching}
              >
                Cancel
              </button>
            </div>
            {fetchError && (
              <p className="text-xs text-red-400 mt-2">{fetchError}</p>
            )}
          </form>
        )}

        {/* Guide list */}
        <div className="overflow-y-auto flex-1">
          {loading && (
            <p className="text-slate-500 text-sm px-4 py-4">Loading…</p>
          )}

          {!loading && guides.length === 0 && !adding && (
            <div className="px-4 py-6 text-center">
              <p className="text-slate-500 text-sm">No guides saved yet.</p>
              <p className="text-slate-600 text-xs mt-1">Hit + Add to attach a walkthrough URL.</p>
            </div>
          )}

          {guides.map(guide => (
            <div
              key={guide.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 last:border-0"
            >
              <button
                className="flex-1 text-left min-w-0"
                onClick={() => onOpenReader(guide.id)}
              >
                <p className="text-sm font-medium text-slate-100 line-clamp-1 leading-snug">
                  {guide.title || guide.source_url}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                  <span className="uppercase font-mono">{guide.content_type}</span>
                  <span>·</span>
                  <span>{dateLabel(guide.fetched_at)}</span>
                  {guide.parse_warning ? <span className="text-amber-400">· ⚠ partial</span> : null}
                </p>
              </button>

              <a
                href={guide.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 px-1"
                onClick={e => e.stopPropagation()}
              >
                ↗
              </a>

              <button
                onClick={() => handleDelete(guide.id)}
                className="text-slate-600 hover:text-red-400 transition-colors shrink-0 text-sm px-1"
                aria-label="Delete guide"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Cancel */}
        <button
          onClick={onClose}
          className="w-full py-4 text-slate-400 text-sm font-medium border-t border-slate-800 active:bg-slate-800 shrink-0"
        >
          Close
        </button>
        <div className="h-safe" />
      </div>
    </div>
  );
}
