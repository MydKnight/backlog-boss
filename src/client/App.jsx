import { useState, useEffect } from 'react';
import TabBar from './components/TabBar.jsx';
import SyncButton from './components/SyncButton.jsx';
import Now from './views/Now.jsx';
import Next from './views/Next.jsx';
import Done from './views/Done.jsx';
import History from './views/History.jsx';
import GuideSheet from './components/GuideSheet.jsx';
import GuideReader from './components/GuideReader.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import Onboarding from './components/Onboarding.jsx';
import Settings from './components/Settings.jsx';

const TABS = [
  { id: 'now',     label: 'Now',     icon: '▶' },
  { id: 'next',    label: 'Next',    icon: '⏭' },
  { id: 'done',    label: 'Done',    icon: '✓' },
  { id: 'history', label: 'History', icon: '◷' },
];

export default function App() {
  const [tab, setTab] = useState('now');
  const [refreshKey, setRefreshKey] = useState(0);
  // { igdbId, gameTitle } — shows guide list sheet
  const [guideSheet, setGuideSheet] = useState(null);
  // { guideId, gameTitle } — shows full-screen reader
  const [guideReader, setGuideReader] = useState(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // ⚙ bottom sheet: 'closed' | 'open'
  const [settingsMenu, setSettingsMenu] = useState('closed');

  // Auth / onboarding state
  const [me, setMe] = useState(null);          // null = loading
  const [meError, setMeError] = useState(false);

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => setMe(data))
      .catch(() => setMeError(true));
  }, []);

  function handleSyncComplete() {
    setRefreshKey(k => k + 1);
  }

  function handleOnboardingComplete() {
    // Re-fetch /api/me to get updated steamConfigured flag
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        setMe(data);
        setRefreshKey(k => k + 1);
      })
      .catch(() => {});
  }

  function openGuideSheet(igdbId, gameTitle) {
    setGuideSheet({ igdbId, gameTitle });
  }

  function openGuideReader(guideId) {
    setGuideReader({ guideId, gameTitle: guideSheet?.gameTitle ?? '' });
  }

  // Loading state — wait for /api/me before rendering
  if (!me && !meError) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-500 text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-dvh bg-slate-950 text-slate-100">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-slate-900 shrink-0">
        <span className="font-bold text-slate-100 tracking-wide">Backlog Boss</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSettingsMenu('open')}
            className="text-slate-500 hover:text-slate-300 transition-colors p-1"
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
          <SyncButton onComplete={handleSyncComplete} />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        {tab === 'now'     && <Now     refreshKey={refreshKey} onGameAction={handleSyncComplete} onOpenGuide={openGuideSheet} />}
        {tab === 'next'    && <Next    refreshKey={refreshKey} onGameAction={handleSyncComplete} onOpenGuide={openGuideSheet} />}
        {tab === 'done'    && <Done    refreshKey={refreshKey} />}
        {tab === 'history' && <History />}
      </main>
      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* Guide sheet — sits above tab bar */}
      {guideSheet && (
        <GuideSheet
          igdbId={guideSheet.igdbId}
          gameTitle={guideSheet.gameTitle}
          onClose={() => setGuideSheet(null)}
          onOpenReader={openGuideReader}
        />
      )}

      {/* Guide reader — full screen, above everything */}
      {guideReader && (
        <GuideReader
          guideId={guideReader.guideId}
          gameTitle={guideReader.gameTitle}
          onClose={() => setGuideReader(null)}
        />
      )}

      {/* Settings menu bottom sheet */}
      {settingsMenu === 'open' && (
        <div className="fixed inset-0 z-40 bg-black/60 flex items-end justify-center" onClick={() => setSettingsMenu('closed')}>
          <div className="bg-slate-900 w-full max-w-md rounded-t-2xl border border-slate-700 p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-slate-300">Settings</span>
              <button onClick={() => setSettingsMenu('closed')} className="text-slate-400 hover:text-slate-200 text-xl leading-none">✕</button>
            </div>
            <button
              onClick={() => { setSettingsMenu('closed'); setShowSettings(true); }}
              className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-800 text-slate-100 text-sm"
            >
              Account Settings
            </button>
            <button
              onClick={() => { setSettingsMenu('closed'); setShowAdmin(true); }}
              className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-800 text-slate-100 text-sm"
            >
              Data Quality
            </button>
          </div>
        </div>
      )}

      {/* Account settings overlay */}
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            fetch('/api/me').then(r => r.json()).then(setMe).catch(() => {});
          }}
        />
      )}

      {/* Admin panel — data quality tools */}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}

      {/* Onboarding — shown when Steam not configured */}
      {me && !me.steamConfigured && (
        <Onboarding onComplete={handleOnboardingComplete} />
      )}
    </div>
  );
}
