import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WifiOff, Wifi, RefreshCw, X } from 'lucide-react';
import { useConnectivityTransition } from '../hooks/useOnlineStatus';

export interface OfflineIndicatorProps {
  onSyncNow?: () => Promise<void> | void;
  isSyncing?: boolean;
  roomCode?: string;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  onSyncNow,
  isSyncing = false,
  roomCode,
}) => {
  const {
    isOnline,
    hasReconnected,
    reconnectedAt,
    dismissReconnected,
    triggerOnline,
  } = useConnectivityTransition();

  const handleSyncClick = async () => {
    try {
      if (onSyncNow) {
        await onSyncNow();
      }
    } finally {
      dismissReconnected();
    }
  };

  return (
    <>
      {/* Persistent Offline Mode Banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            key="offline-mode-banner"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            data-testid="offline-status-banner"
            className="fixed bottom-16 md:bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-2xl bg-amber-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-xl shadow-amber-950/25 border border-amber-500/40"
          >
            <span className="h-2 w-2 rounded-full bg-white animate-pulse shrink-0" />
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Offline Mode — Cached vault data is active</span>
            <button
              type="button"
              onClick={triggerOnline}
              className="ml-1 px-2 py-1 rounded-lg bg-white/15 hover:bg-white/25 text-[11px] font-semibold text-white transition-colors whitespace-nowrap"
            >
              Reconnect
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent Offline-to-Online Transition Toast Notification with 'Sync Now' Action */}
      <AnimatePresence>
        {isOnline && hasReconnected && (
          <motion.div
            key="reconnected-sync-toast"
            initial={{ opacity: 0, y: -14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
            data-testid="reconnect-sync-toast"
            className="fixed top-16 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 z-50 w-[calc(100%-1.5rem)] sm:w-auto sm:max-w-md rounded-2xl bg-slate-900 text-white p-3.5 shadow-2xl shadow-slate-950/30 border border-emerald-500/40 flex items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                <Wifi className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                  <p className="text-xs font-bold text-white truncate">
                    Back Online — Connection Restored
                  </p>
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                  {roomCode ? `Room ${roomCode} is back online.` : 'Connection restored.'}{' '}
                  Sync now to refresh the vault state.
                  {reconnectedAt ? (
                    <span className="ml-1 font-mono text-[10px] text-slate-400">
                      ({reconnectedAt})
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleSyncClick}
                disabled={isSyncing}
                aria-label="Sync Now"
                data-testid="sync-now-button"
                className="min-h-[36px] px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-700 text-slate-950 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors interactive-press shadow-sm"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                />
                <span>Sync Now</span>
              </button>

              <button
                type="button"
                onClick={dismissReconnected}
                aria-label="Dismiss reconnection toast"
                title="Dismiss notification"
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
