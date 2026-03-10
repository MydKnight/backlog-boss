import { useState } from 'react';
import TabBar from './components/TabBar.jsx';
import SyncButton from './components/SyncButton.jsx';
import Now from './views/Now.jsx';
import Next from './views/Next.jsx';
import Done from './views/Done.jsx';
import History from './views/History.jsx';

const TABS = [
  { id: 'now',     label: 'Now',     icon: '▶' },
  { id: 'next',    label: 'Next',    icon: '⏭' },
  { id: 'done',    label: 'Done',    icon: '✓' },
  { id: 'history', label: 'History', icon: '◷' },
];

export default function App() {
  const [tab, setTab] = useState('now');
  const [refreshKey, setRefreshKey] = useState(0);

  function handleSyncComplete() {
    setRefreshKey(k => k + 1);
  }

  return (
    <div className="flex flex-col h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900 shrink-0">
        <span className="font-bold text-slate-100 tracking-wide">Backlog Boss</span>
        <SyncButton onComplete={handleSyncComplete} />
      </header>
      <main className="flex-1 overflow-y-auto">
        {tab === 'now'     && <Now     refreshKey={refreshKey} />}
        {tab === 'next'    && <Next    refreshKey={refreshKey} />}
        {tab === 'done'    && <Done />}
        {tab === 'history' && <History />}
      </main>
      <TabBar tabs={TABS} active={tab} onChange={setTab} />
    </div>
  );
}
