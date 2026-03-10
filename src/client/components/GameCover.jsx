/**
 * Game cover image with a styled fallback when no cover_url is available.
 */
export default function GameCover({ coverUrl, title, className = '' }) {
  if (coverUrl) {
    return (
      <img
        src={coverUrl}
        alt={title}
        className={`object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  return (
    <div className={`flex items-center justify-center bg-slate-700 text-slate-400 font-bold text-lg ${className}`}>
      {title?.charAt(0)?.toUpperCase() ?? '?'}
    </div>
  );
}
