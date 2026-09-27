import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Upload,
  Download,
  Check,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  TransferProgressState,
  formatBytes,
  formatTransferSpeed,
  formatEta,
} from '../types/files';

interface TransferProgressBarProps {
  transfer: TransferProgressState;
  onDismiss?: (id: string) => void;
  compact?: boolean;
}

export const TransferProgressBar: React.FC<TransferProgressBarProps> = ({
  transfer,
  onDismiss,
  compact = false,
}) => {
  const isCompleted = transfer.status === 'completed';
  const isError = transfer.status === 'error';
  const isUpload = transfer.direction === 'upload';
  const clampedPct = Math.max(0, Math.min(100, Math.round(transfer.percentage)));

  const actionLabel = isError
    ? isUpload
      ? 'Upload Failed'
      : 'Download Failed'
    : isCompleted
    ? isUpload
      ? 'Uploaded'
      : 'Downloaded'
    : isUpload
    ? 'Uploading'
    : 'Downloading';

  return (
    <div
      className={`rounded-2xl border transition-colors ${
        compact ? 'p-3' : 'p-3.5 sm:p-4'
      } ${
        isError
          ? 'bg-rose-50/90 border-rose-200 text-rose-950'
          : isCompleted
          ? 'bg-emerald-50/80 border-emerald-200/90 text-slate-900'
          : 'bg-slate-50/95 border-slate-200/90 text-slate-900'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isError
                ? 'bg-rose-600 text-white'
                : isCompleted
                ? 'bg-emerald-600 text-white'
                : isUpload
                ? 'bg-sky-600 text-white'
                : 'bg-slate-900 text-sky-400'
            }`}
          >
            {isError ? (
              <AlertCircle className="w-4 h-4" />
            ) : isCompleted ? (
              <Check className="w-4 h-4" />
            ) : isUpload ? (
              <Upload className="w-4 h-4" />
            ) : (
              <Download className="w-4 h-4" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-bold text-slate-900 truncate">
                <span>{actionLabel}: </span>
                <span className="font-semibold">{transfer.fileName}</span>
              </p>
              <span className="text-xs font-bold font-mono tabular-nums text-slate-900 shrink-0">
                {clampedPct}%
              </span>
            </div>

            {/* Zero-Pill Metadata Discipline: Clean unboxed telemetry with · separators */}
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-600 mt-0.5">
              <span>
                {formatBytes(transfer.transferredBytes)} / {formatBytes(transfer.totalBytes)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-sky-700">
                {formatTransferSpeed(transfer.speedBytesPerSec)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {isError
                  ? transfer.errorMessage || 'Transfer interrupted'
                  : isCompleted
                  ? `Completed in ${(transfer.elapsedSeconds || 0.9).toFixed(1)}s`
                  : `ETA ${formatEta(transfer.etaSeconds)}`}
              </span>
              {transfer.peerName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-sans text-slate-500 truncate">
                    {transfer.peerName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={() => onDismiss(transfer.id)}
            aria-label={`Dismiss ${transfer.fileName} transfer progress`}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Real-Time Progress Track */}
      <div
        role="progressbar"
        aria-label={`${actionLabel} ${transfer.fileName}`}
        aria-valuenow={clampedPct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-2.5 w-full h-2 rounded-full bg-slate-200/80 overflow-hidden"
      >
        <div
          className={`h-full w-full origin-left transition-transform duration-75 ease-out rounded-full ${
            isError
              ? 'bg-rose-600'
              : isCompleted
              ? 'bg-emerald-600'
              : 'bg-sky-600'
          }`}
          style={{ transform: `scaleX(${Math.max(0.02, clampedPct / 100)})` }}
        />
      </div>
    </div>
  );
};

interface ActiveTransfersTrayProps {
  transfers: TransferProgressState[];
  onDismiss: (id: string) => void;
}

export const ActiveTransfersTray: React.FC<ActiveTransfersTrayProps> = ({
  transfers,
  onDismiss,
}) => {
  if (transfers.length === 0) return null;

  return (
    <section
      aria-label="Real-time file transfers"
      className="space-y-2"
    >
      <AnimatePresence initial={false}>
        {transfers.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <TransferProgressBar transfer={item} onDismiss={onDismiss} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
};
