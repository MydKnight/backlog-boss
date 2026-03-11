import { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';
import ActionSheet from '../components/ActionSheet.jsx';
import SuggestionCard from '../components/SuggestionCard.jsx';

const PAGE_SIZE = 50;
const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Suggestions section
// ---------------------------------------------------------------------------

function SuggestionsSection({ onSnoozed, onStartPlaying }) {
  const [snapshot, setSnapshot] = useState(null);       // { generated_at, suggestions }
  const [inferenceStatus, setInferenceStatus] = useState('idle'); // idle | generating | ready | failed
  const [embedStatus, setEmbedStatus] = useState(null); // null | { status, percentComplete, ... }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);         // initial fetch only
  const [snoozedIds, setSnoozedIds] = useState(new Set());
  const [selected, setSelected] = useState(null);       // suggestion tapped in carousel
  const pollRef = useRef(null);
  const carouselRef = useRef(null);

  // ------- helpers -------

  async function fetchSnapshot() {
    try {
      const res = await fetch('/api/taste/snapshot');
      const data = await res.json();
      if (data.snapshot) setSnapshot(data.snapshot);
    } catch { /* ignore — snapshot stays stale */ }
  }

  async function fetchInferenceStatus() {
    try {
      const res = await fetch('/api/taste/status');
      const data = await res.json();
      setInferenceStatus(data.status ?? 'idle');
      if (data.error) setError(data.error);
      return data.status;
    } catch {
      return 'idle';
    }
  }

  async function fetchEmbedStatus() {
    try {
      const res = await fetch('/api/taste/embed-status');
      const data = await res.json();
      setEmbedStatus(data);
      return data;
    } catch {
      return null;
    }
  }

  // ------- polling -------

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const status = await fetchInferenceStatus();
      if (status === 'running') await fetchEmbedStatus();
      if (status === 'ready') {
        stopPolling();
        await fetchSnapshot();
      }
      if (status === 'failed') stopPolling();
    }, POLL_INTERVAL_MS);
  }

  // ------- initial load -------

  useEffect(() => {
    async function init() {
      setLoading(true);
      await Promise.all([fetchSnapshot(), fetchInferenceStatus(), fetchEmbedStatus()]);
      setLoading(false);
    }
    init();
    return stopPolling;
  }, []);

  // Start polling if a job is already running when the view mounts
  useEffect(() => {
    if (inferenceStatus === 'generating' || embedStatus?.status === 'running') {
      startPolling();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------- actions -------

  async function handleRefresh() {
    setError(null);
    const res = await fetch('/api/taste/refresh', { method: 'POST' });
    const data = await res.json();
    if (data.status === 'ready' && data.snapshot) {
      // Returned from cache — no need to poll
      setSnapshot(data.snapshot);
      setInferenceStatus('ready');
    } else if (data.status === 'generating') {
      setInferenceStatus('generating');
      startPolling();
    } else if (data.error) {
      setError(data.error);
    }
  }

  async function handleSnooze(igdbId) {
    setSelected(null);
    setSnoozedIds(prev => new Set([...prev, igdbId]));
    try {
      await fetch(`/api/taste/snooze/${igdbId}`, { method: 'POST' });
      onSnoozed?.();
    } catch {
      // Optimistic — keep it hidden even if request fails
    }
  }

  async function handleStartPlaying(igdbId) {
    setSelected(null);
    await fetch(`/api/games/${igdbId}/restore-to-now`, { method: 'POST' });
    onStartPlaying?.();
  }

  // ------- render helpers -------

  const isEmbedRunning = embedStatus?.status === 'running';
  const isGenerating = inferenceStatus === 'generating';
  const isBusy = isEmbedRunning || isGenerating;

  const suggestions = (snapshot?.suggestions ?? []).filter(s => !snoozedIds.has(s.igdb_id));

  function renderStatus() {
    if (isEmbedRunning) {
      const pct = embedStatus.percentComplete;
      return (
        <p className="text-xs text-slate-400">
          Embedding library… {pct != null ? `${pct}%` : ''}
        </p>
      );
    }
    if (isGenerating) {
      return <p className="text-xs text-slate-400 animate-pulse">Generating suggestions…</p>;
    }
    if (error) {
      return <p className="text-xs text-red-400">{error}</p>;
    }
    if (snapshot?.generated_at) {
      const date = new Date(snapshot.generated_at).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
      });
      return <p className="text-xs text-slate-500">Updated {date}</p>;
    }
    return null;
  }

  if (loading) {
    return <div className="text-slate-500 text-sm">Loading suggestions…</div>;
  }

  return (
    <section className="mb-8">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-lg font-semibold">Suggested for You</h2>
          {renderStatus()}
        </div>
        <button
          onClick={handleRefresh}
          disabled={isBusy}
          className="text-xs font-medium px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isBusy ? '…' : 'Refresh'}
        </button>
      </div>

      {/* No snapshot yet */}
      {!snapshot && !isBusy && (
        <div className="bg-slate-800/50 rounded-2xl p-5 text-center">
          <p className="text-slate-400 text-sm mb-1">No suggestions yet.</p>
          <p className="text-slate-500 text-xs">
            Make sure embeddings are generated, then hit Refresh.
          </p>
        </div>
      )}

      {/* Carousel */}
      {suggestions.length > 0 && (
        <div className="relative">
          {/* Left arrow */}
          <button
            onClick={() => carouselRef.current?.scrollBy({ left: -300, behavior: 'smooth' })}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 shadow-lg transition-colors"
            aria-label="Scroll left"
          >
            ‹
          </button>

          <div
            ref={carouselRef}
            className="-mx-4 px-4 flex gap-3 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 scrollbar-none"
          >
            {suggestions.map(s => (
              <SuggestionCard
                key={s.igdb_id}
                suggestion={s}
                onTap={setSelected}
              />
            ))}
            {/* Trailing spacer so last card doesn't sit flush against edge */}
            <div className="shrink-0 w-2" />
          </div>

          {/* Right arrow */}
          <button
            onClick={() => carouselRef.current?.scrollBy({ left: 300, behavior: 'smooth' })}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 shadow-lg transition-colors"
            aria-label="Scroll right"
          >
            ›
          </button>
        </div>
      )}

      {/* All snoozed */}
      {snapshot && suggestions.length === 0 && !isBusy && (
        <div className="bg-slate-800/50 rounded-2xl p-5 text-center">
          <p className="text-slate-400 text-sm">All suggestions dismissed.</p>
          <p className="text-slate-500 text-xs mt-1">Hit Refresh to generate a new set.</p>
        </div>
      )}

      {/* Tap-to-act sheet */}
      {selected && (
        <ActionSheet
          title={selected.title}
          onClose={() => setSelected(null)}
          actions={[
            {
              label: 'Start Playing',
              description: 'Move this game to your Now view',
              onClick: () => handleStartPlaying(selected.igdb_id),
            },
            {
              label: 'Not Now',
              description: 'Hide this suggestion for 30 days',
              onClick: () => handleSnooze(selected.igdb_id),
            },
          ]}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Full library list
// ---------------------------------------------------------------------------

export default function Next({ refreshKey = 0, onGameAction, onOpenGuide }) {
  const { data, loading, error } = useApi(`/api/games/next?_=${refreshKey}`);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const sentinelRef = useRef(null);
  const [staleGames, setStaleGames] = useState([]);

  useEffect(() => {
    if (data?.games) setStaleGames(data.games);
  }, [data]);

  const allGames = data?.games ?? staleGames;
  const total = data?.total ?? allGames.length;
  const isInitialLoad = loading && staleGames.length === 0;
  const games = allGames.slice(0, page * PAGE_SIZE);
  const hasMore = games.length < allGames.length;

  function close() { setSelected(null); }

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setPage(p => p + 1); },
      { rootMargin: '200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [allGames.length]);

  async function restoreToNow(igdbId) {
    await fetch(`/api/games/${igdbId}/restore-to-now`, { method: 'POST' });
    close();
    onGameAction?.();
  }

  if (isInitialLoad) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (error)   return <div className="p-4 text-red-400 text-sm">Error: {error}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Up Next</h1>

      {/* Taste engine suggestions — sits above the full list */}
      <SuggestionsSection onSnoozed={onGameAction} onStartPlaying={onGameAction} />

      {/* Divider + full backlog */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-base font-semibold text-slate-300 shrink-0">Full Backlog</h2>
        <div className="h-px flex-1 bg-slate-700" />
        <span className="text-xs text-slate-500 shrink-0">{total} game{total !== 1 ? 's' : ''}</span>
      </div>

      {total === 0 && (
        <div className="text-center text-slate-600 text-sm mt-6">
          No unplayed games — run a sync to import your library.
        </div>
      )}

      <ul className="space-y-2">
        {games.map(game => (
          <NextRow
            key={game.igdb_id ?? game.id}
            game={game}
            onTap={() => setSelected(game)}
          />
        ))}
      </ul>

      {hasMore && <div ref={sentinelRef} className="h-8" />}

      {selected && (
        <ActionSheet
          title={selected.title}
          onClose={close}
          actions={[
            {
              label: 'Start Playing',
              description: 'Move this game to your Now view',
              onClick: () => restoreToNow(selected.igdb_id),
            },
            {
              label: 'Guide',
              description: 'View or add a walkthrough guide',
              onClick: () => { close(); onOpenGuide?.(selected.igdb_id, selected.title); },
            },
          ]}
        />
      )}
    </div>
  );
}

function NextRow({ game, onTap }) {
  const bench = game.hltb_main_extras ?? game.hltb_main;
  const topGenres = game.genres?.slice(0, 2) ?? [];
  const isBackburner = game.status === 'backburner';

  return (
    <li>
      <div
        className={`flex gap-3 rounded-xl p-3 items-center ${isBackburner ? 'bg-slate-800/60' : 'bg-slate-900'} ${onTap ? 'cursor-pointer active:bg-slate-700 transition-colors' : ''}`}
        onClick={onTap}
      >
        <GameCover
          coverUrl={game.cover_url}
          title={game.title}
          className="w-10 h-14 rounded-md shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm leading-tight line-clamp-2">{game.title}</span>
            {isBackburner && (
              <span className="text-xs text-amber-400 bg-amber-950 px-2 py-0.5 rounded-full shrink-0">
                Backburner
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {topGenres.length > 0 && <span>{topGenres.join(' · ')}</span>}
            {bench != null && (
              <>
                {topGenres.length > 0 && <span>·</span>}
                <span>~{bench}h</span>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
