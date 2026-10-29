import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';

/** Centered dialog on desktop, bottom sheet on phones. Esc and backdrop click close it. */
export function Modal({ open, onClose, title, children, wide = false, side = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; side?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            role="dialog" aria-modal="true" aria-label={title}
            initial={side ? { x: 60, opacity: 0 } : { y: 40, opacity: 0, scale: 0.98 }} animate={{ x: 0, y: 0, opacity: 1, scale: 1 }} exit={side ? { x: 60, opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            className={clsx('card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 shadow-2xl sm:rounded-b-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{title}</h2>
              <button className="btn-ghost !p-1.5" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
