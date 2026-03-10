import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { useDebounce } from '../hooks/useDebounce.js';
import GameCover from '../components/GameCover.jsx';
import ActionSheet from '../components/ActionSheet.jsx';
import ExitInterview from '../components/ExitInterview.jsx';
import CurrentlyPlayingSheet from '../components/CurrentlyPlayingSheet.jsx';
import { formatEventDate } from '../utils/format.js';

export default function History() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null); // { game: igdbResult, mode: 'actions'|'history'|'playing' }
  const [historyRefresh, setHistoryRefresh] = useState(0);

  const debouncedQuery = useDebounce(query, 400);
  const searchUrl = debouncedQuery.length >= 2
    ? `/api/igdb/search?q=${encodeURIComponent(debouncedQuery)}`
    : null;

  const { data: searchData, loading: searchLoading } = useApi(searchUrl);
  const { data: historyData } = useApi(`/api/games/history?_=${historyRefresh}`);

  const results = searchData?.results ?? [];
  const historyGames = historyData?.games ?? [];

  function openActions(game) { setSelected({ game, mode: 'actions' }); }
  function close() { setSelected(null); }

  async function submitHistory(payload) {
    await fetch('/api/games/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ igdbData: selected.game, ...payload }),
    });
    close();
    setQuery('');
    setHistoryRefresh(k => k + 1);
  }

  async function submitPlaying({ ownershipType, playtimeMinutes }) {
    await fetch('/api/games/currently-playing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ igdbData: selected.game, ownershipType, playtimeMinutes }),
    });
    close();
    setQuery('');
  }

  const showResults = debouncedQuery.length >= 2;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-0.5">History</h1>
      <p className="text-slate-400 text-sm mb-4">Every game you've played — the taste engine's foundation.</p>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search any game…"
          className="w-full bg-slate-800 text-slate-100 placeholder-slate-500 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Search results */}
      {showResults && (
        <div className="mb-6">
          {searchLoading && <p className="text-slate-500 text-sm">Searching…</p>}
          {!searchLoading && results.length === 0 && (
            <p className="text-slate-500 text-sm">No results for "{debouncedQuery}"</p>
          )}
          <ul className="space-y-2">
            {results.map(game => (
              <SearchResult key={game.igdbId} game={game} onTap={() => openActions(game)} />
            ))}
          </ul>
        </div>
      )}

      {/* History list */}
      {!showResults && (
        <>
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Logged — {historyGames.length}
          </h2>
          {historyGames.length === 0 && (
            <div className="text-center text-slate-600 text-sm mt-8">
              Search for a game above to start logging your history.
            </div>
          )}
          <ul className="space-y-3">
            {historyGames.map(game => (
              <HistoryCard key={`${game.igdb_id}-${game.event_date}`} game={game} />
            ))}
          </ul>
        </>
      )}

      {/* Action sheet — choose log or currently playing */}
      {selected?.mode === 'actions' && (
        <ActionSheet
          title={selected.game.title}
          onClose={close}
          actions={[
            {
              label: 'Log to History',
              description: 'Already played or finished — adds a rating and memories',
              onClick: () => setSelected(s => ({ ...s, mode: 'history' })),
            },
            {
              label: 'Currently Playing',
              description: 'Playing now on another system — adds to your Now view',
              onClick: () => setSelected(s => ({ ...s, mode: 'playing' })),
            },
          ]}
        />
      )}

      {selected?.mode === 'history' && (
        <ExitInterview
          game={selected.game}
          type="history"
          onSubmit={submitHistory}
          onClose={close}
        />
      )}

      {selected?.mode === 'playing' && (
        <CurrentlyPlayingSheet
          game={selected.game}
          onSubmit={submitPlaying}
          onClose={close}
        />
      )}
    </div>
  );
}

function SearchResult({ game, onTap }) {
  const year = game.releaseDate ?? null;
  const platforms = game.platforms?.slice(0, 2).join(', ') ?? null;

  return (
    <li>
      <button
        onClick={onTap}
        className="w-full flex gap-3 bg-slate-900 rounded-xl p-3 text-left active:bg-slate-800 transition-colors"
      >
        <GameCover
          coverUrl={game.coverUrl}
          title={game.title}
          className="w-10 h-14 rounded-md shrink-0"
        />
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <p className="font-medium text-sm line-clamp-2">{game.title}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {[year, platforms].filter(Boolean).join(' · ')}
          </p>
        </div>
      </button>
    </li>
  );
}

const EVENT_TYPE_LABELS = {
  completed: { label: 'Beaten', className: 'text-green-400 bg-green-950' },
  retired:   { label: 'Retired', className: 'text-red-400 bg-red-950' },
  historical: { label: 'History', className: 'text-slate-400 bg-slate-800' },
};

function HistoryCard({ game }) {
  const positiveTags = game.positive_tags ?? [];
  const negativeTags = game.negative_tags ?? [];
  const badge = EVENT_TYPE_LABELS[game.event_type] ?? EVENT_TYPE_LABELS.historical;

  return (
    <li className="flex gap-3 bg-slate-900 rounded-xl p-3">
      <GameCover
        coverUrl={game.cover_url}
        title={game.title}
        className="w-10 h-14 rounded-md shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="font-medium text-sm line-clamp-2">{game.title}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.className}`}>{badge.label}</span>
        </div>
        {game.star_rating ? (
          <div className="flex gap-0.5 mb-1">
            {[1,2,3,4,5].map(s => (
              <span key={s} className={`text-sm ${s <= game.star_rating ? 'text-yellow-400' : 'text-slate-700'}`}>★</span>
            ))}
          </div>
        ) : null}
        {positiveTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {positiveTags.map(tag => (
              <span key={tag} className="text-xs text-indigo-400 bg-indigo-950 px-2 py-0.5 rounded-full">
                {TAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        )}
        {negativeTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {negativeTags.map(tag => (
              <span key={tag} className="text-xs text-red-400 bg-red-950 px-2 py-0.5 rounded-full">
                {TAG_LABELS[tag] ?? tag}
              </span>
            ))}
          </div>
        )}
        {game.free_text && (
          <p className="text-xs text-slate-500 italic line-clamp-2">"{game.free_text}"</p>
        )}
        <p className="text-xs text-slate-600 mt-1">{formatEventDate(game.event_date)}</p>
      </div>
    </li>
  );
}

const TAG_LABELS = {
  great_story:     'Great story',
  loved_gameplay:  'Loved the gameplay',
  hidden_gem:      'Hidden gem',
  overhyped:       'Overhyped',
  would_replay:    'Would replay',
  recommend:       'Recommend to others',
  felt_repetitive: 'Felt repetitive',
  too_difficult:   'Too difficult',
  lost_interest:   'Lost interest',
  life_got_busy:   'Life got busy',
  not_my_genre:    'Not my genre',
  other:           'Other',
};
