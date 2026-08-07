import { useState } from 'react';
import { motion } from 'framer-motion';

const NAV_ITEMS = [
  { label: 'Live Session', icon: PulseIcon, sectionId: 'live-session-section' },
  { label: 'History', icon: HistoryIcon, sectionId: 'history-section' },
  { label: 'Calibration', icon: TargetIcon, sectionId: 'calibration-section' },
];

function PulseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M3 12h4l2-7 4 14 2-7h6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-4.5 w-4.5">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth={1.8} />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth={1.8} />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function Sidebar({ open }: { open: boolean }) {
  const [activeLabel, setActiveLabel] = useState(NAV_ITEMS[0].label);

  const handleNavigate = (label: string, sectionId: string) => {
    setActiveLabel(label);
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 216 : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="hidden shrink-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] md:block"
    >
      <div className="flex h-14 items-center gap-2 px-5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-rate)] text-xs font-bold text-white">
          SB
        </div>
        <span className="whitespace-nowrap text-sm font-semibold text-[var(--color-ink)]">SpeechBio</span>
      </div>
      <nav className="flex flex-col gap-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleNavigate(item.label, item.sectionId)}
            className={`flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeLabel === item.label
                ? 'bg-[var(--color-surface-raised)] text-[var(--color-ink)]'
                : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink-secondary)]'
            }`}
          >
            <item.icon />
            {item.label}
          </button>
        ))}
      </nav>
    </motion.aside>
  );
}
