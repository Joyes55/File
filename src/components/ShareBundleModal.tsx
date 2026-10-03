import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Link2,
  Copy,
  Check,
  Clock,
  Download,
  Archive,
  ShieldAlert,
  Cloud,
  X,
  Eye,
  QrCode,
  Sparkles,
  RefreshCw,
  Ban,
  FileText,
  Printer,
} from 'lucide-react';
import {
  SharedBundle,
  SharedFile,
  formatBytes,
  formatRemainingBundleTtl,
} from '../types/files';
import { QrMatrixSvg, printFileQrIndexCard } from './QrMatrixSvg';

export const BUNDLE_TTL_OPTIONS: { label: string; minutes: number; badge: string }[] = [
  { label: '15 Min', minutes: 15, badge: 'Quick Drop' },
  { label: '1 Hour', minutes: 60, badge: 'Default' },
  { label: '6 Hours', minutes: 360, badge: 'Workday' },
  { label: '24 Hours', minutes: 1440, badge: '1 Day' },
  { label: '7 Days', minutes: 10080, badge: 'Extended' },
];

interface ShareBundleModalProps {
  isOpen: boolean;
  bundle: SharedBundle | null;
  recentBundles: SharedBundle[];
  selectedFiles: SharedFile[];
  isGenerating: boolean;
  selectedTtlMinutes: number;
  isFirebaseAuthenticated: boolean;
  onSelectTtlMinutes: (minutes: number) => void;
  onRegenerateOrUpdateTtl: (minutes: number) => Promise<void>;
  onRevokeBundle: (bundleId: string) => Promise<void>;
  onDownloadBundleZip: (bundle: SharedBundle) => void;
  onPreviewRecipientLink: (bundle: SharedBundle) => void;
  onSelectExistingBundle: (bundle: SharedBundle) => void;
  onClose: () => void;
  onNotify: (msg: string) => void;
}

export const ShareBundleModal: React.FC<ShareBundleModalProps> = ({
  isOpen,
  bundle,
  recentBundles,
  selectedFiles,
  isGenerating,
  selectedTtlMinutes,
  isFirebaseAuthenticated,
  onSelectTtlMinutes,
  onRegenerateOrUpdateTtl,
  onRevokeBundle,
  onDownloadBundleZip,
  onPreviewRecipientLink,
  onSelectExistingBundle,
  onClose,
  onNotify,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isUpdatingTtl, setIsUpdatingTtl] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const shareUrl =
    bundle?.shareUrl ||
    (bundle ? `${window.location.origin}/?bundle=${encodeURIComponent(bundle.id)}` : '');

  const ttlState = bundle
    ? formatRemainingBundleTtl(bundle.expiresAt, nowMs)
    : { expired: false, remainingMs: 0, label: 'Generating...' };

  const isUnavailable = Boolean(bundle?.revoked || ttlState.expired);

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // Clipboard fallback ignored
    }
    setCopiedUrl(true);
    onNotify('Copied temporary shareable bundle URL to clipboard');
    window.setTimeout(() => setCopiedUrl(false), 2200);
  };

  const handleTtlPresetClick = async (minutes: number) => {
    onSelectTtlMinutes(minutes);
    if (bundle && !bundle.revoked) {
      setIsUpdatingTtl(true);
      try {
        await onRegenerateOrUpdateTtl(minutes);
      } finally {
        setIsUpdatingTtl(false);
      }
    }
  };

  const handleRevokeClick = async () => {
    if (!bundle || bundle.revoked) return;
    setIsRevoking(true);
    try {
      await onRevokeBundle(bundle.id);
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="share-bundle-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
        onClick={onClose}
      >
        <motion.div
          key="share-bundle-modal-dialog"
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="share-bundle-modal-title"
          className="w-full max-w-xl bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 p-6 space-y-5 max-h-[92vh] overflow-y-auto shadow-2xl shadow-slate-950/25"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto -mt-2 mb-1 md:hidden" />

          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-2xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-sky-600/20">
                <Link2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3
                    id="share-bundle-modal-title"
                    className="text-base font-bold text-slate-900 truncate"
                  >
                    Temporary Multi-File Share Link
                  </h3>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] font-mono font-semibold text-emerald-800">
                    <Cloud className="w-3 h-3 text-emerald-600" />
                    <span>
                      {bundle?.firestoreSynced || isFirebaseAuthenticated
                        ? 'Firebase Expiring Link'
                        : 'Server + Firebase Ready'}
                    </span>
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bundled into a single compressed archive on the backend with automatic link expiration
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close temporary shareable link modal"
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {isGenerating ? (
            <div className="p-8 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-sky-600/10 text-sky-600 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">
                  Bundling {selectedFiles.length}{' '}
                  {selectedFiles.length === 1 ? 'file' : 'files'} & minting expiring Firebase link...
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  Compressing payload via /api/bundles/create · Writing TTL to shared_bundles
                </p>
              </div>
            </div>
          ) : bundle ? (
            <>
              {/* Expiration Status Banner */}
              <div
                className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  bundle.revoked
                    ? 'bg-rose-50 border-rose-200 text-rose-950'
                    : ttlState.expired
                    ? 'bg-amber-50 border-amber-200 text-amber-950'
                    : 'bg-slate-900 border-slate-800 text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                      bundle.revoked
                        ? 'bg-rose-600 text-white'
                        : ttlState.expired
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-sky-500/20 border border-sky-400/40 text-sky-300'
                    }`}
                  >
                    {bundle.revoked ? (
                      <Ban className="w-4 h-4" />
                    ) : (
                      <Clock className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold tracking-tight">
                        {bundle.revoked
                          ? 'Link Revoked — No Longer Accessible'
                          : ttlState.expired
                          ? 'Link Expired — Access Automatically Closed'
                          : `Active Expiring Link · Expires in ${ttlState.label}`}
                      </span>
                    </div>
                    <p
                      className={`text-[11px] font-mono truncate mt-0.5 ${
                        bundle.revoked || ttlState.expired ? 'opacity-80' : 'text-slate-300'
                      }`}
                    >
                      ID: {bundle.id} · {bundle.fileCount}{' '}
                      {bundle.fileCount === 1 ? 'file' : 'files'} (
                      {formatBytes(bundle.bundleZipBytes || bundle.totalBytes)} ZIP) ·{' '}
                      {bundle.downloads} {bundle.downloads === 1 ? 'download' : 'downloads'}
                    </p>
                  </div>
                </div>

                {!bundle.revoked && (
                  <button
                    type="button"
                    disabled={isRevoking}
                    onClick={handleRevokeClick}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-rose-200 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>{isRevoking ? 'Revoking...' : 'Revoke Link'}</span>
                  </button>
                )}
              </div>

              {/* Shareable URL Copy Box */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="temporary-bundle-share-url"
                    className="text-xs font-semibold text-slate-800"
                  >
                    Single Shareable Bundle URL
                  </label>
                  <span className="text-[11px] font-mono text-slate-500">
                    Expires {new Date(bundle.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    id="temporary-bundle-share-url"
                    type="text"
                    readOnly
                    value={shareUrl}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                    className={`flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border font-mono text-xs truncate focus:outline-none focus:ring-2 focus:ring-sky-600 ${
                      isUnavailable
                        ? 'bg-slate-100 border-slate-200 text-slate-400 line-through'
                        : 'bg-slate-50 border-slate-300 text-slate-900'
                    }`}
                  />

                  <button
                    type="button"
                    disabled={isUnavailable}
                    onClick={handleCopyShareUrl}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>Copied Link</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={isUnavailable}
                    onClick={() => setShowQrCode((prev) => !prev)}
                    aria-label="Toggle QR code for temporary bundle link"
                    title="Show QR code for mobile scan"
                    className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border text-xs font-semibold transition-colors ${
                      showQrCode
                        ? 'bg-slate-900 border-slate-900 text-white'
                        : 'bg-white hover:bg-slate-100 border-slate-200 text-slate-700'
                    }`}
                  >
                    <QrCode className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Optional Scannable QR Code for the Bundle Link */}
              <AnimatePresence>
                {showQrCode && !isUnavailable && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-center gap-4">
                      <QrMatrixSvg value={shareUrl} size={132} />
                      <div className="space-y-2 text-center sm:text-left flex-1">
                        <p className="text-xs font-bold text-slate-900">
                          Scan to Download All {bundle.fileCount} Bundled Files
                        </p>
                        <p className="text-xs text-slate-600 leading-relaxed">
                          Any mobile device scanning this code before{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            {new Date(bundle.expiresAt).toLocaleString()}
                          </span>{' '}
                          will open the bundle landing view and download{' '}
                          <span className="font-mono text-slate-800">{bundle.archiveName}</span>.
                        </p>
                        <div className="pt-1 flex items-center justify-center sm:justify-start">
                          <button
                            type="button"
                            onClick={() =>
                              printFileQrIndexCard({
                                value: shareUrl,
                                fileName: bundle.archiveName,
                                category: `${bundle.fileCount} Bundled Files`,
                                sizeLabel: formatBytes(
                                  bundle.bundleZipBytes || bundle.totalBytes
                                ),
                                roomCode: bundle.roomCode,
                                senderName: bundle.createdBy,
                                uploadDate: bundle.createdAt.slice(0, 10),
                              })
                            }
                            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap interactive-press"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Print QR (4×6" Index Card)</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Expiration Window (TTL) Selector */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-sky-600" />
                    <span>Link Expiration Window (Firebase TTL)</span>
                  </span>
                  {isUpdatingTtl && (
                    <span className="text-[11px] font-mono text-sky-600 flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Updating expiry...</span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {BUNDLE_TTL_OPTIONS.map((opt) => {
                    const active = (bundle.ttlMinutes || selectedTtlMinutes) === opt.minutes;
                    return (
                      <button
                        key={opt.minutes}
                        type="button"
                        disabled={isUpdatingTtl || bundle.revoked}
                        onClick={() => handleTtlPresetClick(opt.minutes)}
                        className={`min-h-[42px] px-2 py-1.5 rounded-xl border text-center transition-all interactive-press ${
                          active
                            ? 'bg-sky-50 border-sky-600 text-sky-950 font-bold shadow-xs'
                            : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 font-medium'
                        }`}
                      >
                        <div className="text-xs">{opt.label}</div>
                        <div className="text-[10px] text-slate-500 font-mono truncate">
                          {opt.badge}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bundled Files Manifest List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5 text-sky-600" />
                    <span>
                      Bundled Archive Contents ({bundle.fileCount}{' '}
                      {bundle.fileCount === 1 ? 'file' : 'files'})
                    </span>
                  </span>
                  <span className="font-mono text-slate-500">
                    Original: {formatBytes(bundle.totalBytes)} → ZIP:{' '}
                    {formatBytes(bundle.bundleZipBytes || bundle.totalBytes)}
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto rounded-2xl bg-slate-50 border border-slate-200/80 divide-y divide-slate-200/60">
                  {bundle.fileNames.map((name, index) => {
                    const matchingFile = selectedFiles.find(
                      (f) => f.id === bundle.fileIds[index] || f.name === name
                    );
                    return (
                      <div
                        key={`${bundle.id}-file-${index}`}
                        className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-800 truncate">{name}</span>
                          {matchingFile?.category && (
                            <span className="text-[11px] text-slate-500 shrink-0">
                              · {matchingFile.category}
                            </span>
                          )}
                        </div>
                        {matchingFile && (
                          <span className="font-mono tabular-nums text-slate-500 shrink-0">
                            {formatBytes(matchingFile.size)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Primary Action Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isUnavailable}
                  onClick={() => onDownloadBundleZip(bundle)}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
                >
                  <Download className="w-4 h-4 text-sky-400" />
                  <span>Download Bundled ZIP ({formatBytes(bundle.bundleZipBytes || bundle.totalBytes)})</span>
                </button>

                <button
                  type="button"
                  onClick={() => onPreviewRecipientLink(bundle)}
                  className="min-h-[46px] px-4 py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-900 text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
                >
                  <Eye className="w-4 h-4 text-sky-600" />
                  <span>Preview Recipient Share View</span>
                </button>
              </div>
            </>
          ) : null}

          {/* Recent Active Share Bundles in Room */}
          {recentBundles.length > 1 && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Recent Expiring Links in Room
              </span>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {recentBundles.slice(0, 5).map((item) => {
                  const status = formatRemainingBundleTtl(item.expiresAt, nowMs);
                  const isCurrent = bundle?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectExistingBundle(item)}
                      className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 text-xs transition-colors ${
                        isCurrent
                          ? 'bg-sky-50/80 border-sky-300 text-slate-900'
                          : 'bg-white hover:bg-slate-50 border-slate-200/80 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold">{item.id}</span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        <span>
                          {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'} (
                          {formatBytes(item.bundleZipBytes || item.totalBytes)})
                        </span>
                      </div>
                      <span
                        className={`font-mono text-[11px] shrink-0 ${
                          item.revoked || status.expired
                            ? 'text-rose-600 font-semibold'
                            : 'text-emerald-700 font-semibold'
                        }`}
                      >
                        {item.revoked ? 'Revoked' : status.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

interface BundleRecipientBannerProps {
  bundle: SharedBundle;
  onDownloadBundleZip: (bundle: SharedBundle) => void;
  onDismiss: () => void;
}

export const BundleRecipientBanner: React.FC<BundleRecipientBannerProps> = ({
  bundle,
  onDownloadBundleZip,
  onDismiss,
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const ttlState = formatRemainingBundleTtl(bundle.expiresAt, nowMs);
  const isInvalid = bundle.revoked || ttlState.expired;
  const shareUrl =
    bundle.shareUrl || `${window.location.origin}/?bundle=${encodeURIComponent(bundle.id)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      role="region"
      aria-label="Shared Temporary File Bundle"
      className={`mb-5 rounded-3xl border p-5 shadow-lg ${
        isInvalid
          ? 'bg-rose-950 border-rose-800 text-white shadow-rose-950/15'
          : 'bg-slate-900 border-sky-500/40 text-white shadow-slate-950/15'
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
              isInvalid
                ? 'bg-rose-600 text-white'
                : 'bg-sky-500/20 border border-sky-400/40 text-sky-300'
            }`}
          >
            {isInvalid ? (
              <ShieldAlert className="w-5 h-5" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-sky-500/20 border border-sky-400/30 text-[11px] font-mono font-semibold text-sky-300">
                TEMPORARY SHARE BUNDLE · {bundle.id}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ${
                  isInvalid
                    ? 'bg-rose-500/30 text-rose-200'
                    : 'bg-emerald-500/20 border border-emerald-400/30 text-emerald-300'
                }`}
              >
                <Clock className="w-3 h-3" />
                <span>
                  {bundle.revoked
                    ? 'Revoked by Sender'
                    : ttlState.expired
                    ? 'Link Expired'
                    : `Expires in ${ttlState.label}`}
                </span>
              </span>
            </div>

            <h3 className="text-base font-bold text-white truncate">
              {bundle.archiveName} ({bundle.fileCount}{' '}
              {bundle.fileCount === 1 ? 'file' : 'files'} ·{' '}
              {formatBytes(bundle.bundleZipBytes || bundle.totalBytes)})
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              Shared by <span className="font-semibold text-white">{bundle.createdBy}</span> in
              Room <span className="font-mono text-sky-300">{bundle.roomCode}</span> · Includes:{' '}
              <span className="font-mono text-slate-200">
                {bundle.fileNames.slice(0, 4).join(', ')}
                {bundle.fileNames.length > 4
                  ? ` +${bundle.fileNames.length - 4} more`
                  : ''}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {!isInvalid && (
            <>
              <button
                type="button"
                onClick={() => onDownloadBundleZip(bundle)}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center gap-2 whitespace-nowrap interactive-press"
              >
                <Download className="w-4 h-4" />
                <span>
                  Download All as ZIP ({formatBytes(bundle.bundleZipBytes || bundle.totalBytes)})
                </span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(shareUrl);
                  } catch {
                    // Ignore
                  }
                  setCopiedLink(true);
                  window.setTimeout(() => setCopiedLink(false), 2000);
                }}
                className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                {copiedLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss bundle banner"
            className="min-h-[42px] px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-semibold transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  );
};
