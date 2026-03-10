/**
 * Bottom sheet with a list of labelled actions.
 * actions: [{ label, description?, onClick, danger? }]
 */
export default function ActionSheet({ title, actions, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-slate-900 rounded-t-2xl overflow-hidden">
        {title && (
          <div className="px-4 pt-4 pb-2 border-b border-slate-800">
            <p className="text-sm font-semibold text-slate-100 line-clamp-1">{title}</p>
          </div>
        )}
        <ul>
          {actions.map((action, i) => (
            <li key={i}>
              <button
                onClick={() => { action.onClick(); }}
                className={`w-full text-left px-4 py-4 flex flex-col gap-0.5 active:bg-slate-800 transition-colors
                  ${action.danger ? 'text-red-400' : 'text-slate-100'}`}
              >
                <span className="font-medium">{action.label}</span>
                {action.description && (
                  <span className="text-xs text-slate-500">{action.description}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={onClose}
          className="w-full py-4 text-slate-400 text-sm font-medium border-t border-slate-800 active:bg-slate-800"
        >
          Cancel
        </button>
        <div className="h-safe" />
      </div>
    </div>
  );
}
