import { useEffect, useRef, useState } from 'react';

const SCROLL_SAVE_DEBOUNCE_MS = 1500;

/**
 * Full-screen guide reader overlay.
 *
 * Props:
 *   guideId    — id of guide to load
 *   gameTitle  — shown in header
 *   onClose    — called when user hits back
 */
export default function GuideReader({ guideId, gameTitle, onClose }) {
  const [guide, setGuide] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);
  const saveTimerRef = useRef(null);
  const initialScrollSet = useRef(false);

  // Fetch guide content on mount
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/guides/content/${guideId}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setGuide(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [guideId]);

  // Restore scroll position after content renders
  useEffect(() => {
    if (!guide || !scrollRef.current || initialScrollSet.current) return;
    if (guide.scroll_position > 0) {
      scrollRef.current.scrollTop = guide.scroll_position;
    }
    initialScrollSet.current = true;
  }, [guide]);

  // Save scroll position — debounced so we don't hammer the server
  function handleScroll() {
    if (!scrollRef.current || !guide) return;
    const pos = scrollRef.current.scrollTop;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      fetch(`/api/guides/${guide.id}/scroll`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scrollPosition: Math.round(pos) }),
      }).catch(() => {}); // fire-and-forget
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900 shrink-0">
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-100 transition-colors text-lg leading-none p-1 -ml-1"
          aria-label="Back"
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-slate-500 truncate">{gameTitle}</p>
          <p className="text-sm font-semibold text-slate-100 truncate leading-tight">
            {guide?.title ?? 'Loading…'}
          </p>
        </div>
        {guide?.source_url && (
          <a
            href={guide.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0"
          >
            Open ↗
          </a>
        )}
      </div>

      {/* Parse warning banner */}
      {guide?.parse_warning && (
        <div className="bg-amber-950 border-b border-amber-800 px-4 py-2 text-xs text-amber-300 shrink-0">
          This page couldn't be fully parsed. Content may be incomplete —{' '}
          <a href={guide.source_url} target="_blank" rel="noopener noreferrer" className="underline">
            open original
          </a>{' '}
          for the full guide.
        </div>
      )}

      {/* Content area */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          Loading guide…
        </div>
      )}
      {error && (
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div>
            <p className="text-red-400 text-sm mb-2">{error}</p>
            <button onClick={onClose} className="text-xs text-slate-500 underline">Go back</button>
          </div>
        </div>
      )}
      {guide && !loading && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-4 py-5"
        >
          {guide.content_type === 'text' ? (
            <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
              {guide.content}
            </pre>
          ) : (
            <div
              className="guide-html prose"
              dangerouslySetInnerHTML={{ __html: guide.content }}
            />
          )}
        </div>
      )}
    </div>
  );
}
