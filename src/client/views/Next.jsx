import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';

const PAGE_SIZE = 50;

export default function Next({ refreshKey = 0 }) {
  const { data, loading, error } = useApi(`/api/games/next?_=${refreshKey}`);
  const [page, setPage] = useState(1);

  const allGames = data?.games ?? [];
  const total = data?.total ?? 0;
  const games = allGames.slice(0, page * PAGE_SIZE);
  const hasMore = games.length < allGames.length;

  if (loading) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (error)   return <div className="p-4 text-red-400 text-sm">Error: {error}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-0.5">Up Next</h1>
      <p className="text-slate-400 text-sm mb-4">
        {total} unplayed game{total !== 1 ? 's' : ''} · taste ranking in Phase 3
      </p>

      {total === 0 && (
        <div className="text-center text-slate-600 text-sm mt-12">
          No unplayed games — run a sync to import your library.
        </div>
      )}

      <ul className="space-y-2">
        {games.map(game => (
          <NextRow key={game.igdb_id ?? game.id} game={game} />
        ))}
      </ul>

      {hasMore && (
        <button
          onClick={() => setPage(p => p + 1)}
          className="w-full mt-4 py-2.5 text-sm text-slate-400 bg-slate-800 rounded-xl active:bg-slate-700"
        >
          Show more ({allGames.length - games.length} remaining)
        </button>
      )}
    </div>
  );
}

function NextRow({ game }) {
  const bench = game.hltb_main_extras ?? game.hltb_main;
  const topGenres = game.genres?.slice(0, 2) ?? [];

  return (
    <li className="flex gap-3 bg-slate-900 rounded-xl p-3 items-center">
      <GameCover
        coverUrl={game.cover_url}
        title={game.title}
        className="w-10 h-14 rounded-md shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm leading-tight line-clamp-2 mb-1">
          {game.title}
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {topGenres.length > 0 && (
            <span>{topGenres.join(' · ')}</span>
          )}
          {bench != null && (
            <>
              {topGenres.length > 0 && <span>·</span>}
              <span>~{bench}h</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
