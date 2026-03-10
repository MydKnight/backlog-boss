import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';
import { relativeDate, hoursLabel } from '../utils/format.js';

export default function Now({ refreshKey = 0 }) {
  const { data, loading, error } = useApi(`/api/games/now?_=${refreshKey}`);
  const games = data?.games ?? [];

  if (loading) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (error)   return <div className="p-4 text-red-400 text-sm">Error: {error}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-0.5">Now Playing</h1>
      <p className="text-slate-400 text-sm mb-4">
        {games.length} game{games.length !== 1 ? 's' : ''} in progress
      </p>

      {games.length === 0 && (
        <div className="text-center text-slate-600 text-sm mt-12">
          No games in progress — start something from Next.
        </div>
      )}

      <ul className="space-y-3">
        {games.map(game => (
          <NowCard key={game.igdb_id ?? game.id} game={game} />
        ))}
      </ul>
    </div>
  );
}

function NowCard({ game }) {
  const bench = game.hltb_main_extras ?? game.hltb_main;
  const ratio = bench ? Math.min(1, game.playtime_minutes / (bench * 60)) : null;
  const played = hoursLabel(game.playtime_minutes);
  const lastPlayed = relativeDate(game.last_played_at);

  return (
    <li className="flex gap-3 bg-slate-900 rounded-xl p-3">
      <GameCover
        coverUrl={game.cover_url}
        title={game.title}
        className="w-12 h-16 rounded-lg shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="mb-1.5">
          <span className="font-semibold text-sm leading-tight line-clamp-2">{game.title}</span>
        </div>

        {ratio != null && (
          <div className="w-full h-1.5 bg-slate-700 rounded-full mb-1.5" title="Time invested vs. HLTB average">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all"
              style={{ width: `${ratio * 100}%` }}
            />
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{played} played</span>
          {bench != null && <><span>·</span><span>~{bench}h HLTB</span></>}
          {lastPlayed && <><span>·</span><span>{lastPlayed}</span></>}
        </div>
      </div>
    </li>
  );
}
