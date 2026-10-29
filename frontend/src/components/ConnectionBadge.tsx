import clsx from 'clsx';
import { useUi } from '../store/ui';

const META = {
  live: { label: 'Live', dot: 'bg-ok', text: 'text-ok' },
  connecting: { label: 'Connecting…', dot: 'bg-warn', text: 'text-warn' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-warn', text: 'text-warn' },
  offline: { label: 'Offline', dot: 'bg-danger', text: 'text-danger' },
} as const;

export function ConnectionBadge() {
  const conn = useUi((s) => s.conn);
  const m = META[conn];
  return (
    <span className={clsx('chip border-current/30', m.text)} role="status" aria-label={`Real-time connection: ${m.label}`}>
      <span className="relative flex h-2 w-2">
        {conn === 'live' && <span className={clsx('absolute inline-flex h-full w-full rounded-full opacity-60 animate-pulseRing', m.dot)} />}
        <span className={clsx('relative inline-flex h-2 w-2 rounded-full', m.dot, conn !== 'live' && 'animate-pulse')} />
      </span>
      {m.label}
    </span>
  );
}
