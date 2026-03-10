export default function TabBar({ tabs, active, onChange }) {
  return (
    <nav className="flex border-t border-slate-800 bg-slate-900 pb-safe">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 flex flex-col items-center py-3 gap-0.5 text-xs transition-colors
            ${active === tab.id ? 'text-indigo-400' : 'text-slate-500 active:text-slate-300'}`}
        >
          <span className="text-xl leading-none">{tab.icon}</span>
          <span className="tracking-wide">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
