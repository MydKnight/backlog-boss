import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import GameCover from '../components/GameCover.jsx';
import ActionSheet from '../components/ActionSheet.jsx';
import { formatEventDate } from '../utils/format.js';

export default function Done({ refreshKey = 0 }) {
  const { data, loading, error } = useApi(`/api/games/done?_=${refreshKey}`);
  const [selected, setSelected] = useState(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const games = data?.games ?? [];

  async function handleRevert() {
    await fetch(`/api/games/${selected.igdb_id}/revert`, { method: 'POST' });
    setSelected(null);
    setLocalRefresh(k => k + 1);
  }

  if (loading && localRefresh === 0) return <div className="p-4 text-slate-500 text-sm">Loading…</div>;
  if (error)   return <div className="p-4 text-red-400 text-sm">Error: {error}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-0.5">Done</h1>
      <p className="text-slate-400 text-sm mb-4">
        {games.length} game{games.length !== 1 ? 's' : ''} beaten
      </p>

      {games.length === 0 && (
        <div className="text-center text-slate-600 text-sm mt-12">
          No completed games yet — mark something beaten from the Now view.
        </div>
      )}

      <ul className="space-y-3">
        {games.map(game => (
          <DoneCard key={game.event_id ?? game.igdb_id} game={game} onTap={() => setSelected(game)} />
        ))}
      </ul>

      {selected && (
        <ActionSheet
          title={selected.title}
          onClose={() => setSelected(null)}
          actions={[
            {
              label: 'Move Back to Now',
              description: 'Returns to in-progress — completion history is kept',
              onClick: handleRevert,
            },
          ]}
        />
      )}
    </div>
  );
}

function DoneCard({ game, onTap }) {
  return (
    <li>
    <button onClick={onTap} className="w-full flex gap-3 bg-slate-900 rounded-xl p-3 text-left active:bg-slate-800 transition-colors">
      <GameCover
        coverUrl={game.cover_url}
        title={game.title}
        className="w-12 h-16 rounded-lg shrink-0"
      />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm leading-tight line-clamp-2 mb-1.5">{game.title}</p>

        <StarDisplay rating={game.star_rating} />

        <div className="flex flex-wrap gap-x-2 gap-y-1 mt-1.5">
          {game.positive_tags?.map(tag => (
            <span key={tag} className="text-xs text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded-full">
              {tagLabel(tag)}
            </span>
          ))}
        </div>

        {game.free_text && (
          <p className="text-xs text-slate-500 mt-1.5 line-clamp-2 italic">"{game.free_text}"</p>
        )}

        <p className="text-xs text-slate-600 mt-1.5">{formatEventDate(game.event_date)}</p>
      </div>
    </button>
    </li>
  );
}

function StarDisplay({ rating }) {
  if (!rating) return null;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} className={`text-sm ${s <= rating ? 'text-yellow-400' : 'text-slate-700'}`}>★</span>
      ))}
    </div>
  );
}

const TAG_LABELS = {
  great_story:    'Great story',
  loved_gameplay: 'Loved the gameplay',
  hidden_gem:     'Hidden gem',
  overhyped:      'Overhyped',
  would_replay:   'Would replay',
  recommend:      'Recommend to others',
};

function tagLabel(id) {
  return TAG_LABELS[id] ?? id;
}
