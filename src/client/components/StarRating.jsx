export default function StarRating({ value, onChange }) {
  return (
    <div className="flex gap-3">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className={`text-4xl transition-colors ${star <= value ? 'text-yellow-400' : 'text-slate-600'}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
