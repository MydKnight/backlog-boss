import { useState } from 'react';
import StarRating from './StarRating.jsx';

const POSITIVE_TAGS = [
  { id: 'great_story',    label: 'Great story' },
  { id: 'loved_gameplay', label: 'Loved the gameplay' },
  { id: 'hidden_gem',     label: 'Hidden gem' },
  { id: 'overhyped',      label: 'Overhyped' },
  { id: 'would_replay',   label: 'Would replay' },
  { id: 'recommend',      label: 'Recommend to others' },
];

const NEGATIVE_TAGS = [
  { id: 'felt_repetitive', label: 'Felt repetitive' },
  { id: 'too_difficult',   label: 'Too difficult' },
  { id: 'lost_interest',   label: 'Lost interest' },
  { id: 'life_got_busy',   label: 'Life got busy' },
  { id: 'not_my_genre',    label: 'Not my genre' },
  { id: 'other',           label: 'Other' },
];

/**
 * Exit interview sheet for beaten or retired flows.
 * type: 'beaten' | 'retired'
 * onSubmit: async (payload) => void
 */
export default function ExitInterview({ game, type, onSubmit, onClose }) {
  const [starRating, setStarRating] = useState(0);
  const [positiveTags, setPositiveTags] = useState([]);
  const [negativeTags, setNegativeTags] = useState([]);
  const [freeText, setFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isBeaten = type === 'beaten';
  const canSubmit = isBeaten ? starRating > 0 : true;

  function toggleTag(list, setList, id) {
    setList(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({ starRating, positiveTags, negativeTags, freeText: freeText.trim() || null });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 rounded-t-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-800 shrink-0">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">
              {isBeaten ? 'Mark Beaten' : 'Mark Retired'}
            </p>
            <p className="font-semibold text-slate-100 line-clamp-1">{game.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 text-xl px-2">✕</button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-4 py-4 flex flex-col gap-5">

          {/* Star rating — beaten only */}
          {isBeaten && (
            <div>
              <p className="text-sm font-medium text-slate-300 mb-3">
                How would you rate it? <span className="text-red-400">*</span>
              </p>
              <StarRating value={starRating} onChange={setStarRating} />
            </div>
          )}

          {/* Positive tags — beaten only */}
          {isBeaten && (
            <div>
              <p className="text-sm font-medium text-slate-300 mb-2">What stood out? <span className="text-slate-500">(optional)</span></p>
              <TagPills tags={POSITIVE_TAGS} selected={positiveTags} onToggle={id => toggleTag(positiveTags, setPositiveTags, id)} />
            </div>
          )}

          {/* Negative / reason tags */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">
              {isBeaten ? 'Any downsides?' : 'Why are you stepping away?'}
              {' '}<span className="text-slate-500">(optional)</span>
            </p>
            <TagPills tags={NEGATIVE_TAGS} selected={negativeTags} onToggle={id => toggleTag(negativeTags, setNegativeTags, id)} />
          </div>

          {/* Free text */}
          <div>
            <p className="text-sm font-medium text-slate-300 mb-2">Anything else? <span className="text-slate-500">(optional)</span></p>
            <textarea
              value={freeText}
              onChange={e => setFreeText(e.target.value)}
              placeholder={isBeaten ? 'Thoughts, memories, recommendations…' : 'What happened?'}
              rows={3}
              className="w-full bg-slate-800 text-slate-100 placeholder-slate-600 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="h-2" />
        </div>

        {/* Footer */}
        <div className="px-4 pb-6 pt-3 border-t border-slate-800 shrink-0">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-colors
              ${canSubmit && !submitting
                ? isBeaten
                  ? 'bg-indigo-600 text-white active:bg-indigo-700'
                  : 'bg-red-700 text-white active:bg-red-800'
                : 'bg-slate-800 text-slate-600 cursor-not-allowed'
              }`}
          >
            {submitting ? 'Saving…' : isBeaten ? 'Mark as Beaten' : 'Mark as Retired'}
          </button>
          {isBeaten && starRating === 0 && (
            <p className="text-center text-xs text-slate-600 mt-2">A star rating is required</p>
          )}
        </div>

      </div>
    </div>
  );
}

function TagPills({ tags, selected, onToggle }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map(tag => (
        <button
          key={tag.id}
          type="button"
          onClick={() => onToggle(tag.id)}
          className={`px-3 py-1.5 rounded-full text-sm border transition-colors
            ${selected.includes(tag.id)
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'border-slate-600 text-slate-400 active:border-slate-400'
            }`}
        >
          {tag.label}
        </button>
      ))}
    </div>
  );
}
