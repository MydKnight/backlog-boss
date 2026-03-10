import { useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';
import ActionSheet from '../components/ActionSheet.jsx';
import ExitInterview from '../components/ExitInterview.jsx';
import { relativeDate, hoursLabel } from '../utils/format.js';

export default function Now({ refreshKey = 0, onGameAction }) {
  const { data, loading, error } = useApi(`/api/games/now?_=${refreshKey}`);
  const [selected, setSelected] = useState(null); // { game, mode: 'sheet'|'beaten'|'retired', isOngoing? }
  const [staleGames, setStaleGames] = useState([]);
  const [staleOngoing, setStaleOngoing] = useState([]);

  useEffect(() => {
    if (data?.games)   setStaleGames(data.games);
    if (data?.ongoing) setStaleOngoing(data.ongoing);
  }, [data]);

  const games   = data?.games   ?? staleGames;
  const ongoing = data?.ongoing ?? staleOngoing;
  const isInitialLoad = loading && staleGames.length === 0 && staleOngoing.length === 0;

  function openSheet(game, isOngoing = false) { setSelected({ game, mode: 'sheet', isOngoing }); }
  function close() { setSelected(null); }

  async function submitBeaten(payload) {
    await fetch(`/api/games/${selected.game.igdb_id}/beaten`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    close();
    onGameAction?.();
  }

  async function submitRetired(payload) {
    await fetch(`/api/games/${selected.game.igdb_id}/retired`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    close();
    onGameAction?.();
  }

  async function setBackburner(igdbId) {
    await fetch(`/api/games/${igdbId}/set-backburner`, { method: 'POST' });
    onGameAction?.();
  }

  async function setOngoing(igdbId) {
    await fetch(`/api/games/${igdbId}/set-ongoing`, { method: 'POST' });
    close();
    onGameAction?.();
  }

  if (isInitialLoad) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (error)         return <div className="p-4 text-red-400 text-sm">Error: {error}</div>;

  const totalCount = games.length + ongoing.length;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-0.5">Now Playing</h1>
      <p className="text-slate-400 text-sm mb-4">
        {totalCount} game{totalCount !== 1 ? 's' : ''} in rotation
      </p>

      {totalCount === 0 && (
        <div className="text-center text-slate-600 text-sm mt-12">
          No games in progress — start something from Next.
        </div>
      )}

      {/* In-progress games */}
      {games.length > 0 && (
        <ul className="space-y-3 mb-6">
          {games.map(game => (
            <NowCard
              key={game.igdb_id ?? game.id}
              game={game}
              onTap={() => openSheet(game)}
              onBackburner={() => setBackburner(game.igdb_id)}
            />
          ))}
        </ul>
      )}

      {/* Always On section */}
      {ongoing.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Always On
          </h2>
          <ul className="space-y-3">
            {ongoing.map(game => (
              <OngoingCard
                key={game.igdb_id ?? game.id}
                game={game}
                onTap={() => openSheet(game, true)}
              />
            ))}
          </ul>
        </>
      )}

      {/* Action sheet — in-progress game */}
      {selected?.mode === 'sheet' && !selected.isOngoing && (
        <ActionSheet
          title={selected.game.title}
          onClose={close}
          actions={[
            {
              label: 'Mark Beaten',
              description: 'Record completion with a rating and debrief',
              onClick: () => setSelected(s => ({ ...s, mode: 'beaten' })),
            },
            {
              label: 'Mark as Ongoing',
              description: 'No completion state — live service, sandbox, board game',
              onClick: () => setOngoing(selected.game.igdb_id),
            },
            {
              label: 'Mark Retired',
              description: "Stepping away — won't show in Next",
              onClick: () => setSelected(s => ({ ...s, mode: 'retired' })),
              danger: true,
            },
          ]}
        />
      )}

      {/* Action sheet — ongoing game */}
      {selected?.mode === 'sheet' && selected.isOngoing && (
        <ActionSheet
          title={selected.game.title}
          onClose={close}
          actions={[
            {
              label: 'Mark Retired',
              description: 'Step away from this one for good',
              onClick: () => setSelected(s => ({ ...s, mode: 'retired' })),
              danger: true,
            },
          ]}
        />
      )}

      {selected?.mode === 'beaten' && (
        <ExitInterview
          game={selected.game}
          type="beaten"
          onSubmit={submitBeaten}
          onClose={close}
        />
      )}

      {selected?.mode === 'retired' && (
        <ExitInterview
          game={selected.game}
          type="retired"
          onSubmit={submitRetired}
          onClose={close}
        />
      )}
    </div>
  );
}

function NowCard({ game, onTap, onBackburner }) {
  const bench = game.hltb_main_extras ?? game.hltb_main;
  const ratio = bench ? Math.min(1, game.playtime_minutes / (bench * 60)) : null;
  const played = hoursLabel(game.playtime_minutes);
  const lastPlayed = relativeDate(game.last_played_at);

  function handleBackburner(e) {
    e.stopPropagation();
    onBackburner();
  }

  return (
    <li>
      <div className="flex gap-3 bg-slate-900 rounded-xl p-3">
        <button onClick={onTap} className="flex gap-3 flex-1 min-w-0 text-left active:opacity-70 transition-opacity">
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
                  className="h-full bg-indigo-500 rounded-full"
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
        </button>

        {/* → Next pill */}
        <button
          onClick={handleBackburner}
          className="self-center shrink-0 text-xs text-slate-400 border border-slate-700 rounded-full px-2.5 py-1 active:bg-slate-700 transition-colors ml-1"
          title="Move to backburner"
        >
          → Next
        </button>
      </div>
    </li>
  );
}

function OngoingCard({ game, onTap }) {
  const played = hoursLabel(game.playtime_minutes);
  const lastPlayed = relativeDate(game.last_played_at);

  return (
    <li>
      <button
        onClick={onTap}
        className="w-full flex gap-3 bg-slate-900 rounded-xl p-3 text-left active:bg-slate-800 transition-colors"
      >
        <GameCover
          coverUrl={game.cover_url}
          title={game.title}
          className="w-12 h-16 rounded-lg shrink-0"
        />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-sm leading-tight line-clamp-1">{game.title}</span>
            <span className="text-xs text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full shrink-0">Ongoing</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{played} played</span>
            {lastPlayed && <><span>·</span><span>{lastPlayed}</span></>}
          </div>
        </div>
      </button>
    </li>
  );
}
