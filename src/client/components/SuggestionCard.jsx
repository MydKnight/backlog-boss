import GameCover from './GameCover.jsx';

/**
 * Portrait card for the suggestion carousel.
 * Tapping opens an ActionSheet — no inline dismiss button.
 *
 * Props:
 *   suggestion  — { igdb_id, title, rank, explanation, cover_url, genres, hltb_hours }
 *   onTap       — called with the suggestion object when card is tapped
 */
export default function SuggestionCard({ suggestion, onTap }) {
  const { title, rank, explanation, cover_url, genres, hltb_hours } = suggestion;
  const topGenres = (genres ?? []).slice(0, 2);

  return (
    <div
      className="snap-start shrink-0 w-[72vw] max-w-[280px] bg-slate-800 rounded-2xl overflow-hidden cursor-pointer active:scale-[0.97] transition-transform select-none"
      onClick={() => onTap?.(suggestion)}
    >
      {/* Cover art — tall portrait ratio */}
      <div className="relative w-full aspect-[3/4] bg-slate-700">
        <GameCover
          coverUrl={cover_url}
          title={title}
          className="w-full h-full"
        />
        {/* Rank badge */}
        <span className="absolute top-2 left-2 text-xs font-bold text-white bg-black/60 px-2 py-0.5 rounded-full">
          #{rank}
        </span>
      </div>

      {/* Text content */}
      <div className="p-3">
        <h3 className="font-semibold text-sm leading-tight line-clamp-2 mb-1">{title}</h3>

        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2">
          {topGenres.length > 0 && <span>{topGenres.join(' · ')}</span>}
          {hltb_hours != null && (
            <>
              {topGenres.length > 0 && <span>·</span>}
              <span>~{hltb_hours}h</span>
            </>
          )}
        </div>

        {explanation ? (
          <p className="text-xs text-slate-300 leading-snug line-clamp-4">{explanation}</p>
        ) : (
          <p className="text-xs text-slate-600 italic">No explanation available.</p>
        )}
      </div>
    </div>
  );
}
