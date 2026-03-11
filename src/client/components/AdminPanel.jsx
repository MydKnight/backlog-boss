import { useState, useEffect } from 'react';
import GameCover from './GameCover.jsx';

// ---------------------------------------------------------------------------
// HLTB fix sheet
// ---------------------------------------------------------------------------

function HltbFixSheet({ game, onFixed, onClose }) {
  const [query, setQuery] = useState(game.title);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function search(e) {
    e?.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/hltb-search?title=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function pin(result) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/hltb-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: game.id,
          hltbId: result.hltb_id,
          main: result.main,
          mainExtras: result.main_extras,
          completionist: result.completionist,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onFixed();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  // Auto-search on open
  useEffect(() => { search(); }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg p-1 -ml-1">←</button>
        <div>
          <p className="text-xs text-slate-500">Fix HLTB match</p>
          <p className="text-sm font-semibold truncate">{game.title}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <form onSubmit={search} className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Search HLTB…"
          />
          <button
            type="submit"
            disabled={searching}
            className="text-sm px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {results.length === 0 && !searching && (
          <p className="text-slate-500 text-sm text-center mt-8">No results — try a different title.</p>
        )}

        <ul className="space-y-2">
          {results.map(r => (
            <li key={r.hltb_id}>
              <button
                onClick={() => pin(r)}
                disabled={saving}
                className="w-full text-left bg-slate-800 hover:bg-slate-700 rounded-xl p-3 transition-colors disabled:opacity-40"
              >
                <p className="font-medium text-sm mb-1">{r.title}</p>
                <div className="flex gap-3 text-xs text-slate-400">
                  {r.main != null && <span>Main: {r.main}h</span>}
                  {r.main_extras != null && <span>+Extras: {r.main_extras}h</span>}
                  {r.completionist != null && <span>100%: {r.completionist}h</span>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// IGDB fix sheet
// ---------------------------------------------------------------------------

function IgdbFixSheet({ game, onFixed, onClose }) {
  const [query, setQuery] = useState(game.title);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function search(e) {
    e?.preventDefault();
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/igdb-search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.results ?? []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function relink(result) {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/igdb-relink', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          steamAppId: game.steam_app_id,
          igdbData: {
            igdbId: result.igdbId,
            title: result.title,
            coverUrl: result.coverUrl,
            genres: result.genres,
            themes: result.themes,
            similarIgdbIds: [],
          },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      onFixed();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  useEffect(() => { search(); }, []);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg p-1 -ml-1">←</button>
        <div>
          <p className="text-xs text-slate-500">Fix IGDB match</p>
          <p className="text-sm font-semibold truncate">{game.title}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <form onSubmit={search} className="flex gap-2 mb-4">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 text-sm bg-slate-800 rounded-lg px-3 py-2 text-slate-100 placeholder-slate-600 outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Search IGDB…"
          />
          <button
            type="submit"
            disabled={searching}
            className="text-sm px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 transition-colors"
          >
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {results.length === 0 && !searching && (
          <p className="text-slate-500 text-sm text-center mt-8">No results — try a different title.</p>
        )}

        <ul className="space-y-2">
          {results.map(r => (
            <li key={r.igdbId}>
              <button
                onClick={() => relink(r)}
                disabled={saving}
                className="w-full text-left bg-slate-800 hover:bg-slate-700 rounded-xl p-3 flex gap-3 transition-colors disabled:opacity-40"
              >
                <GameCover
                  coverUrl={r.coverUrl}
                  title={r.title}
                  className="w-10 h-14 rounded-md shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-tight mb-1">{r.title}</p>
                  <p className="text-xs text-slate-400">
                    {r.releaseDate ?? '—'}
                    {r.genres?.length > 0 && ` · ${r.genres.slice(0, 2).join(', ')}`}
                  </p>
                  {r.platforms?.length > 0 && (
                    <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                      {r.platforms.slice(0, 4).join(', ')}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main admin panel
// ---------------------------------------------------------------------------

export default function AdminPanel({ onClose }) {
  const [tab, setTab] = useState('hltb');         // 'hltb' | 'igdb'
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fixTarget, setFixTarget] = useState(null); // { type: 'hltb'|'igdb', game }
  const [ignoring, setIgnoring] = useState(null);   // gameId being ignored

  async function loadUnmatched() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/unmatched');
      const json = await res.json();
      setData(json);
    } catch {
      setData({ noHltb: [], noIgdb: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUnmatched(); }, []);

  function handleFixed() {
    setFixTarget(null);
    loadUnmatched();
  }

  async function handleIgnore(gameId) {
    setIgnoring(gameId);
    try {
      await fetch('/api/admin/igdb-ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId }),
      });
      loadUnmatched();
    } finally {
      setIgnoring(null);
    }
  }

  const noHltb = data?.noHltb ?? [];
  const noIgdb = data?.noIgdb ?? [];

  // Show fix sheet on top when active
  if (fixTarget?.type === 'hltb') {
    return (
      <HltbFixSheet
        game={fixTarget.game}
        onFixed={handleFixed}
        onClose={() => setFixTarget(null)}
      />
    );
  }
  if (fixTarget?.type === 'igdb') {
    return (
      <IgdbFixSheet
        game={fixTarget.game}
        onFixed={handleFixed}
        onClose={() => setFixTarget(null)}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <button onClick={onClose} className="text-slate-400 hover:text-slate-100 text-lg p-1 -ml-1">←</button>
        <h2 className="font-semibold text-slate-100">Data Quality</h2>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 shrink-0">
        {[
          { id: 'hltb', label: `Missing HLTB${data ? ` (${noHltb.length})` : ''}` },
          { id: 'igdb', label: `Missing IGDB${data ? ` (${noIgdb.length})` : ''}` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'text-indigo-400 border-b-2 border-indigo-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-slate-500 text-sm p-4">Loading…</p>
        )}

        {!loading && tab === 'hltb' && (
          <>
            {noHltb.length === 0 ? (
              <div className="text-center p-8">
                <p className="text-slate-400 text-sm">All games have HLTB data.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500 px-4 pt-3 pb-2">
                  {noHltb.length} game{noHltb.length !== 1 ? 's' : ''} with no completion time data.
                  Tap a game to search HLTB with a corrected title.
                </p>
                <ul>
                  {noHltb.map(game => (
                    <li key={game.id} className="border-b border-slate-800 last:border-0">
                      <button
                        onClick={() => setFixTarget({ type: 'hltb', game })}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-900 transition-colors"
                      >
                        <GameCover
                          coverUrl={game.cover_url}
                          title={game.title}
                          className="w-8 h-11 rounded shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{game.title}</p>
                          <p className="text-xs text-slate-500">
                            {game.hltb_tried ? 'Searched — no match found' : 'Not yet searched'}
                          </p>
                        </div>
                        <span className="text-slate-600 text-sm shrink-0">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {!loading && tab === 'igdb' && (
          <>
            {noIgdb.length === 0 ? (
              <div className="text-center p-8">
                <p className="text-slate-400 text-sm">All games matched to IGDB.</p>
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500 px-4 pt-3 pb-2">
                  {noIgdb.length} game{noIgdb.length !== 1 ? 's' : ''} with no IGDB match.
                  Tap to search IGDB and link manually.
                </p>
                <ul>
                  {noIgdb.map(game => (
                    <li key={game.id} className="border-b border-slate-800 last:border-0 flex items-center">
                      <button
                        onClick={() => setFixTarget({ type: 'igdb', game })}
                        className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-900 transition-colors min-w-0"
                      >
                        <div className="w-8 h-11 rounded bg-slate-800 flex items-center justify-center text-slate-500 text-xs font-bold shrink-0">
                          ?
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{game.title}</p>
                          <p className="text-xs text-slate-500">Steam ID {game.steam_app_id}</p>
                        </div>
                        <span className="text-slate-600 text-sm shrink-0">›</span>
                      </button>
                      <button
                        onClick={() => handleIgnore(game.id)}
                        disabled={ignoring === game.id}
                        className="px-4 py-3 text-xs text-slate-600 hover:text-slate-400 disabled:opacity-40 transition-colors shrink-0"
                        title="Ignore — remove from this list permanently"
                      >
                        {ignoring === game.id ? '…' : 'Ignore'}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
