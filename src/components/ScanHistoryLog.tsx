import React, { useState, useMemo } from 'react';
import {
  History,
  Download,
  Eye,
  Trash2,
  QrCode,
  Lock,
  ShieldCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Music,
  Code2,
  FolderOpen,
  Search,
  X,
  ArrowUpRight,
  Camera,
} from 'lucide-react';
import { SharedFile, formatBytes } from '../types/files';
import { buildFileQrPayloadUrl } from './QrMatrixSvg';

export const MAX_SCAN_HISTORY_FILES = 10;
const SCAN_HISTORY_STORAGE_KEY = 'relaydrop_qr_scan_history_v1';

export interface ScannedFileHistoryEntry {
  id: string;
  fileId: string;
  fileName: string;
  category: string;
  size: number;
  mimeType: string;
  roomCode: string;
  senderName: string;
  senderDevice?: string;
  uploadDate: string;
  scannedAt: string;
  scanCount: number;
  rawPayload: string;
  pinProtected?: boolean;
  encrypted?: boolean;
}

function buildSeededHistoryFromFiles(files: SharedFile[]): ScannedFileHistoryEntry[] {
  if (!Array.isArray(files) || files.length === 0) return [];
  const now = Date.now();
  return files.slice(0, 3).map((file, idx) => {
    const scannedDate = new Date(now - (idx + 1) * 14 * 60 * 1000).toISOString();
    return {
      id: `scan-seed-${file.id}`,
      fileId: file.id,
      fileName: file.name,
      category: file.category || 'Vault File',
      size: file.size || 0,
      mimeType: file.mimeType || 'application/octet-stream',
      roomCode: file.roomCode || '842-910',
      senderName: file.senderName || 'RelayDrop Peer',
      senderDevice: file.senderDevice,
      uploadDate: file.uploadDate || scannedDate.slice(0, 10),
      scannedAt: scannedDate,
      scanCount: 1,
      rawPayload: buildFileQrPayloadUrl({
        fileId: file.id,
        roomCode: file.roomCode || '842-910',
      }),
      pinProtected: Boolean(file.pinProtected),
      encrypted: Boolean(file.encrypted),
    };
  });
}

export function loadScanHistory(
  fallbackFiles: SharedFile[] = []
): ScannedFileHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SCAN_HISTORY_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_SCAN_HISTORY_FILES);
      }
    }
    const seeded = buildSeededHistoryFromFiles(fallbackFiles);
    if (seeded.length > 0) {
      window.localStorage.setItem(
        SCAN_HISTORY_STORAGE_KEY,
        JSON.stringify(seeded.slice(0, MAX_SCAN_HISTORY_FILES))
      );
    }
    return seeded.slice(0, MAX_SCAN_HISTORY_FILES);
  } catch {
    return buildSeededHistoryFromFiles(fallbackFiles).slice(0, MAX_SCAN_HISTORY_FILES);
  }
}

export function saveScanHistory(entries: ScannedFileHistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = entries.slice(0, MAX_SCAN_HISTORY_FILES);
    window.localStorage.setItem(SCAN_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordFileInScanHistory(
  currentEntries: ScannedFileHistoryEntry[],
  scanned: {
    fileId: string;
    file?: SharedFile;
    roomCode?: string;
    raw: string;
  },
  fallbackRoomCode = '842-910'
): ScannedFileHistoryEntry[] {
  const nowIso = new Date().toISOString();
  const existing = currentEntries.find(
    (item) => item.fileId.toLowerCase() === scanned.fileId.toLowerCase()
  );
  const resolvedFile = scanned.file;

  const updatedEntry: ScannedFileHistoryEntry = {
    id: `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    fileId: resolvedFile?.id || existing?.fileId || scanned.fileId,
    fileName:
      resolvedFile?.name ||
      existing?.fileName ||
      `Shared File (${scanned.fileId})`,
    category: resolvedFile?.category || existing?.category || 'Shared via QR',
    size: resolvedFile?.size ?? existing?.size ?? 0,
    mimeType:
      resolvedFile?.mimeType || existing?.mimeType || 'application/octet-stream',
    roomCode:
      scanned.roomCode ||
      resolvedFile?.roomCode ||
      existing?.roomCode ||
      fallbackRoomCode,
    senderName:
      resolvedFile?.senderName || existing?.senderName || 'RelayDrop Peer',
    senderDevice: resolvedFile?.senderDevice || existing?.senderDevice,
    uploadDate:
      resolvedFile?.uploadDate ||
      existing?.uploadDate ||
      nowIso.slice(0, 10),
    scannedAt: nowIso,
    scanCount: (existing?.scanCount || 0) + 1,
    rawPayload:
      scanned.raw ||
      buildFileQrPayloadUrl({
        fileId: resolvedFile?.id || scanned.fileId,
        roomCode:
          scanned.roomCode || resolvedFile?.roomCode || fallbackRoomCode,
      }),
    pinProtected:
      resolvedFile !== undefined
        ? Boolean(resolvedFile.pinProtected)
        : Boolean(existing?.pinProtected),
    encrypted:
      resolvedFile !== undefined
        ? Boolean(resolvedFile.encrypted)
        : Boolean(existing?.encrypted),
  };

  const remaining = currentEntries.filter(
    (item) => item.fileId.toLowerCase() !== scanned.fileId.toLowerCase()
  );
  const next = [updatedEntry, ...remaining].slice(0, MAX_SCAN_HISTORY_FILES);
  saveScanHistory(next);
  return next;
}

function formatRelativeScanTime(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(parsed)) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (diffSec < 45) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(isoTimestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getFileIcon(mimeType: string, fileName: string) {
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|svg|gif)$/i.test(fileName)) {
    return <ImageIcon className="w-4 h-4 text-sky-400" />;
  }
  if (mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(fileName)) {
    return <Music className="w-4 h-4 text-amber-400" />;
  }
  if (
    mimeType.includes('json') ||
    mimeType.includes('javascript') ||
    /\.(json|ts|tsx|js|py|go|rs|sql|sh|yaml|yml)$/i.test(fileName)
  ) {
    return <Code2 className="w-4 h-4 text-emerald-400" />;
  }
  return <FileText className="w-4 h-4 text-sky-400" />;
}

export interface ScanHistoryLogProps {
  entries: ScannedFileHistoryEntry[];
  files: SharedFile[];
  currentRoomCode: string;
  onQuickDownload: (entry: ScannedFileHistoryEntry, resolvedFile?: SharedFile) => void;
  onQuickInspect: (fileId: string, roomCode?: string) => void;
  onReopenScanResult: (entry: ScannedFileHistoryEntry) => void;
  onRemoveEntry: (entryId: string) => void;
  onClearHistory: () => void;
  onSwitchToScanner: () => void;
  onSimulateSampleScan?: (file: SharedFile) => void;
}

export const ScanHistoryLog: React.FC<ScanHistoryLogProps> = ({
  entries,
  files,
  currentRoomCode,
  onQuickDownload,
  onQuickInspect,
  onReopenScanResult,
  onRemoveEntry,
  onClearHistory,
  onSwitchToScanner,
  onSimulateSampleScan,
}) => {
  const [filterQuery, setFilterQuery] = useState('');

  const cappedEntries = useMemo(
    () => entries.slice(0, MAX_SCAN_HISTORY_FILES),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return cappedEntries;
    return cappedEntries.filter(
      (item) =>
        item.fileName.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.roomCode.toLowerCase().includes(q) ||
        item.senderName.toLowerCase().includes(q)
    );
  }, [cappedEntries, filterQuery]);

  return (
    <div className="space-y-4" data-testid="scan-history-log">
      {/* Scan History Summary Header */}
      <div className="p-4 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-400/30 text-sky-400 flex items-center justify-center shrink-0 mt-0.5">
            <History className="w-4 h-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold text-white">
                Scan History
              </h3>
              <span
                data-testid="scan-history-count-badge"
                className="px-2 py-0.5 rounded-md bg-white/10 text-[11px] font-mono tabular-nums text-sky-300 font-semibold"
              >
                {cappedEntries.length} / {MAX_SCAN_HISTORY_FILES} files
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Tracks the last {MAX_SCAN_HISTORY_FILES} files scanned via the QR scanner for quick access.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {cappedEntries.length > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-rose-500/25 text-slate-200 hover:text-rose-200 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear History</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Bar when 2+ items exist */}
      {cappedEntries.length >= 2 && (
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter scanned files by name, category, or room..."
            aria-label="Filter scan history"
            className="w-full min-h-[40px] pl-9 pr-8 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600 focus:bg-white"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery('')}
              aria-label="Clear scan history filter"
              className="absolute right-2.5 p-1 rounded-lg text-slate-400 hover:text-slate-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* History Entries List */}
      {cappedEntries.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200/80 text-center space-y-3">
          <div className="w-11 h-11 rounded-2xl bg-slate-200/70 text-slate-500 flex items-center justify-center mx-auto">
            <QrCode className="w-5 h-5" />
          </div>
          <div className="space-y-1 max-w-xs mx-auto">
            <p className="text-sm font-bold text-slate-900">
              No Scanned Files Yet
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Files decoded by the Optical QR Scanner (up to the last {MAX_SCAN_HISTORY_FILES} files) will appear here for one-click download and inspection.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={onSwitchToScanner}
              className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 interactive-press"
            >
              <Camera className="w-3.5 h-3.5 text-sky-400" />
              <span>Open Camera Viewfinder</span>
            </button>

            {files[0] && onSimulateSampleScan && (
              <button
                type="button"
                onClick={() => onSimulateSampleScan(files[0])}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-semibold inline-flex items-center gap-1.5 interactive-press"
              >
                <QrCode className="w-3.5 h-3.5 text-sky-600" />
                <span>Scan Sample: {files[0].name}</span>
              </button>
            )}
          </div>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 text-center space-y-2">
          <FolderOpen className="w-6 h-6 text-slate-400 mx-auto" />
          <p className="text-xs font-semibold text-slate-700">
            No scanned files match "{filterQuery}"
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-0.5">
          {filteredEntries.map((entry, idx) => {
            const liveVaultFile = files.find(
              (f) =>
                f.id.toLowerCase() === entry.fileId.toLowerCase() ||
                f.name.toLowerCase() === entry.fileName.toLowerCase()
            );
            const isAvailableInVault = Boolean(liveVaultFile);
            const effectiveSize = liveVaultFile?.size ?? entry.size;
            const effectivePinProtected =
              liveVaultFile !== undefined
                ? Boolean(liveVaultFile.pinProtected)
                : Boolean(entry.pinProtected);
            const effectiveEncrypted =
              liveVaultFile !== undefined
                ? Boolean(liveVaultFile.encrypted)
                : Boolean(entry.encrypted);

            return (
              <div
                key={entry.id}
                data-testid={`scan-history-item-${idx}`}
                className="p-3.5 rounded-2xl bg-white border border-slate-200/90 hover:border-slate-300 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* File Icon + Rank Number */}
                  <div className="relative w-10 h-10 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    {getFileIcon(entry.mimeType, entry.fileName)}
                    <span className="absolute -top-1.5 -left-1.5 px-1.5 min-w-[18px] h-4 rounded-md bg-sky-600 text-white font-mono text-[10px] font-bold flex items-center justify-center">
                      #{idx + 1}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onReopenScanResult(entry)}
                        className="text-sm font-bold text-slate-900 hover:text-sky-700 truncate text-left transition-colors"
                        title="Open scanned QR card details"
                      >
                        {entry.fileName}
                      </button>

                      {effectiveEncrypted && (
                        <span
                          title="End-to-End Encrypted"
                          className="inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md"
                        >
                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                          <span>E2EE</span>
                        </span>
                      )}

                      {effectivePinProtected && (
                        <span
                          title="PIN Protected"
                          className="inline-flex items-center gap-0.5 text-[10px] font-mono font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md"
                        >
                          <Lock className="w-3 h-3 text-amber-600" />
                          <span>PIN</span>
                        </span>
                      )}

                      {entry.scanCount > 1 && (
                        <span className="text-[10px] font-mono text-slate-500 font-semibold">
                          · {entry.scanCount}× scanned
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">
                        {entry.category}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {effectiveSize > 0 ? formatBytes(effectiveSize) : 'QR Link'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-mono tabular-nums font-semibold ${
                          entry.roomCode === currentRoomCode
                            ? 'text-sky-700'
                            : 'text-slate-600'
                        }`}
                      >
                        Room {entry.roomCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{formatRelativeScanTime(entry.scannedAt)}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quick Access Action Buttons */}
                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() => onQuickDownload(entry, liveVaultFile)}
                    title={
                      effectivePinProtected
                        ? 'Unlock PIN & download scanned file'
                        : `Download "${entry.fileName}"`
                    }
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>

                  {isAvailableInVault && liveVaultFile ? (
                    <button
                      type="button"
                      onClick={() => onQuickInspect(liveVaultFile.id, entry.roomCode)}
                      title="Inspect file in Vault"
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                    >
                      <Eye className="w-3.5 h-3.5 text-slate-600" />
                      <span>Inspect</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onReopenScanResult(entry)}
                      title="Open QR Scan Card"
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5 text-slate-600" />
                      <span>Open</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemoveEntry(entry.id)}
                    aria-label={`Remove ${entry.fileName} from scan history`}
                    title="Remove from scan history"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
