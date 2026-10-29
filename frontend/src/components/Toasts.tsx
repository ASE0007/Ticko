import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useUi } from '../store/ui';

const ICON = { info: Info, ok: CheckCircle2, warn: AlertTriangle, danger: OctagonAlert };
const COLOR = { info: 'text-info border-info/40', ok: 'text-ok border-ok/40', warn: 'text-warn border-warn/40', danger: 'text-danger border-danger/50' };

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismiss);
  const nav = useNavigate();
  return (
    <div className="pointer-events-none fixed bottom-20 right-3 z-[60] flex w-[min(92vw,360px)] flex-col gap-2 md:bottom-4" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <motion.div
              key={t.id} layout initial={{ opacity: 0, x: 60, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 60 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className={clsx('card pointer-events-auto relative overflow-hidden border p-3 pr-8 shadow-xl', COLOR[t.kind])}
            >
              <button
                className="flex w-full items-start gap-2 text-left" onClick={() => { if (t.ticketId) nav(`/tickets/${t.ticketId}`); dismiss(t.id); }}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{t.title}</span>
                  {t.text && <span className="block truncate text-xs text-mute">{t.text}</span>}
                </span>
              </button>
              <button className="absolute right-2 top-2 text-mute hover:text-ink" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
              <motion.span className="absolute bottom-0 left-0 h-0.5 bg-current" initial={{ width: '100%' }} animate={{ width: 0 }} transition={{ duration: t.kind === 'danger' ? 9 : 5.5, ease: 'linear' }} />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
