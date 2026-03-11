import { useState, useEffect } from 'react';

const SITE_LABELS = {
  steam: 'Steam Community Guides',
};

// ---------------------------------------------------------------------------
// Search mode
// ---------------------------------------------------------------------------

function SearchMode({ igdbId, gameTitle, onAdded }) {
  const [results, setResults] = useState(null);   // null = not searched yet
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);
  const [noSteamId, setNoSteamId] = useState(false);
  // Track import state per URL: null | 'importing' | 'done' | 'error'
  const [importState, setImportState] = useState({});

  async function handleSearch() {
    setSearching(true);
    setError(null);
    setResults(null);
    setNoSteamId(false);
    setImportState({});
    try {
      const res = await fetch(`/api/guides/search?igdbId=${igdbId}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.reason === 'no_steam_id') {
        setNoSteamId(true);
      } else {
        setResults(data.results ?? []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(result) {
    setImportState(s => ({ ...s, [result.url]: 'importing' }));
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ igdbId, url: result.url }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setImportState(s => ({ ...s, [result.url]: 'done' }));
      onAdded(data.guide);
    } catch (err) {
      setImportState(s => ({ ...s, [result.url]: `error: ${err.message}` }));
    }
  }

  // Group results by site
  const grouped = {};
  if (results) {
    for (const r of results) {
      if (!grouped[r.site]) grouped[r.site] = [];
      grouped[r.site].push(r);
    }
  }

  // Auto-search on open
  useEffect(() => { handleSearch(); }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="overflow-y-auto flex-1 px-4">
        {searching && (
          <p className="text-slate-500 text-sm text-center mt-8">Searching Steam guides…</p>
        )}

        {error && <p className="text-red-400 text-xs mt-3">{error}</p>}

        {noSteamId && (
          <p className="text-slate-500 text-sm text-center mt-8">
            This game has no Steam ID — use Paste URL or Paste Content instead.
          </p>
        )}

        {results !== null && Object.keys(grouped).length === 0 && !noSteamId && (
          <p className="text-slate-500 text-sm text-center mt-8">No Steam guides found for this game.</p>
        )}

        {Object.entries(grouped).map(([site, siteResults]) => (
          <div key={site} className="mt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              {SITE_LABELS[site] ?? site}
            </p>
            <ul className="space-y-1.5">
              {siteResults.map(r => {
                const state = importState[r.url];
                const isDone = state === 'done';
                const isImporting = state === 'importing';
                const isError = state?.startsWith('error:');
                return (
                  <li key={r.url} className="bg-slate-800 rounded-xl p-3">
                    <p className="text-sm font-medium text-slate-100 leading-snug mb-2">{r.title}</p>
                    {isError && (
                      <p className="text-xs text-red-400 mb-1">{state.replace('error: ', '')}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleImport(r)}
                        disabled={isDone || isImporting}
                        className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                          isDone
                            ? 'bg-emerald-700 text-emerald-200 cursor-default'
                            : 'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40'
                        }`}
                      >
                        {isDone ? 'Saved' : isImporting ? '…' : 'Import'}
                      </button>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        Preview ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste URL mode
// ---------------------------------------------------------------------------

function PasteUrlMode({ igdbId, onAdded }) {
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!url.trim()) return;
    setFetching(true);
    setError(null);
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ igdbId, url: url.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onAdded(data.guide);
      setUrl('');
    } catch (err) {
      setError(err.message);
    } finally {
      setFetching(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <p className="text-xs text-slate-400 mb-3">
        Paste a URL — the app fetches and stores the guide content for offline reading.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://…"
          autoFocus
          disabled={fetching}
          className="w-full text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={fetching || !url.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {fetching ? 'Fetching…' : 'Fetch & Save'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paste content mode
// ---------------------------------------------------------------------------

function PasteContentMode({ igdbId, onAdded }) {
  const [title, setTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          igdbId,
          pastedContent: content.trim(),
          title: title.trim(),
          sourceUrl: sourceUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onAdded(data.guide);
      setTitle('');
      setSourceUrl('');
      setContent('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-4 flex flex-col gap-3">
      <div>
        <p className="text-xs text-slate-400 mb-2">
          Open the guide in your browser, press{' '}
          <span className="font-mono bg-slate-800 px-1 rounded">Ctrl+U</span> (View Source),
          then <span className="font-mono bg-slate-800 px-1 rounded">Ctrl+A</span>{' '}
          <span className="font-mono bg-slate-800 px-1 rounded">Ctrl+C</span> and paste below.
          Works for any site — the app strips navigation and ads automatically.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Guide title (required)"
          disabled={saving}
          className="w-full text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <input
          type="url"
          value={sourceUrl}
          onChange={e => setSourceUrl(e.target.value)}
          placeholder="Source URL (optional — enables open in browser)"
          disabled={saving}
          className="w-full text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Paste page source here…"
          disabled={saving}
          rows={6}
          className="w-full text-xs bg-slate-800 rounded-lg px-3 py-2 text-slate-300 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500 font-mono resize-none"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={saving || !title.trim() || !content.trim()}
          className="text-sm px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Processing…' : 'Save Guide'}
        </button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main GuideSheet
// ---------------------------------------------------------------------------

/**
 * Bottom-sheet overlay for managing guides attached to a game.
 *
 * Props:
 *   igdbId       — game identifier
 *   gameTitle    — shown in header
 *   onClose      — close this sheet
 *   onOpenReader — called with (guideId) to open the full reader
 */
export default function GuideSheet({ igdbId, gameTitle, onClose, onOpenReader }) {
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  // addMode: null | 'search' | 'url' | 'paste'
  const [addMode, setAddMode] = useState(null);

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

  function handleAdded(guide) {
    setGuides(prev => [guide, ...prev]);
    setAddMode(null);
  }

  async function handleDelete(guideId) {
    await fetch(`/api/guides/${guideId}`, { method: 'DELETE' });
    setGuides(prev => prev.filter(g => g.id !== guideId));
  }

  const dateLabel = iso =>
    iso
      ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';

  const ADD_MODE_LABELS = { search: 'Search', url: 'Paste URL', paste: 'Paste Content' };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={addMode ? undefined : onClose} />

      {/* Sheet */}
      <div className="relative bg-slate-900 rounded-t-2xl overflow-hidden max-h-[85vh] flex flex-col">

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
          {addMode ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAddMode(null)}
                className="text-slate-400 hover:text-slate-100 p-1 -ml-1 text-lg"
              >
                ←
              </button>
              <p className="text-sm font-semibold text-slate-100">{ADD_MODE_LABELS[addMode]}</p>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Guides</p>
                <p className="text-sm font-semibold text-slate-100 line-clamp-1">{gameTitle}</p>
              </div>
              {/* Add mode picker */}
              <div className="flex gap-1.5">
                <button
                  onClick={() => setAddMode('search')}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Search
                </button>
                <button
                  onClick={() => setAddMode('url')}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  + URL
                </button>
                <button
                  onClick={() => setAddMode('paste')}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  + Paste
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Content area */}
        {addMode === 'search' && (
          <SearchMode igdbId={igdbId} onAdded={handleAdded} />
        )}

        {addMode === 'url' && (
          <div className="overflow-y-auto flex-1">
            <PasteUrlMode igdbId={igdbId} onAdded={handleAdded} />
          </div>
        )}

        {addMode === 'paste' && (
          <div className="overflow-y-auto flex-1">
            <PasteContentMode igdbId={igdbId} onAdded={handleAdded} />
          </div>
        )}

        {!addMode && (
          <>
            {/* Guide list */}
            <div className="overflow-y-auto flex-1">
              {loading && (
                <p className="text-slate-500 text-sm px-4 py-4">Loading…</p>
              )}

              {!loading && guides.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-slate-500 text-sm">No guides saved yet.</p>
                  <p className="text-slate-600 text-xs mt-1">
                    Use Search to find guides, or add a URL or pasted content above.
                  </p>
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
                      {guide.parse_warning ? (
                        <span className="text-amber-400">· partial</span>
                      ) : null}
                    </p>
                  </button>

                  {guide.source_url && (
                    <a
                      href={guide.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 px-1"
                      onClick={e => e.stopPropagation()}
                    >
                      ↗
                    </a>
                  )}

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

            {/* Close */}
            <button
              onClick={onClose}
              className="w-full py-4 text-slate-400 text-sm font-medium border-t border-slate-800 active:bg-slate-800 shrink-0"
            >
              Close
            </button>
            <div className="h-safe" />
          </>
        )}
      </div>
    </div>
  );
}
