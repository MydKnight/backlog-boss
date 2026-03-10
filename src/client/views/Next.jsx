import { useState, useEffect, useRef } from 'react';
import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';
import ActionSheet from '../components/ActionSheet.jsx';

const PAGE_SIZE = 50;

export default function Next({ refreshKey = 0, onGameAction }) {
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

  // Infinite scroll — load next page when sentinel comes into view
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
      <h1 className="text-2xl font-bold mb-0.5">Up Next</h1>
      <p className="text-slate-400 text-sm mb-4">
        {total} game{total !== 1 ? 's' : ''} in backlog · taste ranking in Phase 4
      </p>

      {total === 0 && (
        <div className="text-center text-slate-600 text-sm mt-12">
          No unplayed games — run a sync to import your library.
        </div>
      )}

      <ul className="space-y-2">
        {games.map(game => (
          <NextRow
            key={game.igdb_id ?? game.id}
            game={game}
            onTap={game.status === 'backburner' ? () => setSelected(game) : undefined}
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
              label: 'Move to Now',
              description: 'Resume this game — moves it back to your Now view',
              onClick: () => restoreToNow(selected.igdb_id),
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
