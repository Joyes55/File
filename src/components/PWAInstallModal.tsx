import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Smartphone,
  Download,
  Share,
  PlusSquare,
  Check,
  X,
  Copy,
  Monitor,
  Wifi,
  ShieldCheck,
} from 'lucide-react';
import { QrMatrixSvg } from './QrMatrixSvg';

interface PWAInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  onTriggerInstall: () => Promise<boolean>;
  roomCode: string;
  mobileShellMode: boolean;
  onToggleMobileShellMode: (enabled: boolean) => void;
  onNotify: (msg: string) => void;
}

export const PWAInstallModal: React.FC<PWAInstallModalProps> = ({
  isOpen,
  onClose,
  isInstallable,
  isInstalled,
  isIOS,
  onTriggerInstall,
  roomCode,
  mobileShellMode,
  onToggleMobileShellMode,
  onNotify,
}) => {
  const [copiedUrl, setCopiedUrl] = useState(false);

  const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedUrl(true);
      onNotify('Copied mobile app link to clipboard');
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setCopiedUrl(true);
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'RelayDrop Mobile Vault',
          text: `Join RelayDrop Room ${roomCode} to share & categorize files:`,
          url: shareUrl,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    handleCopyLink();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="pwa-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
          onClick={onClose}
        >
          <motion.div
            key="pwa-modal-sheet"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
            className="w-full max-w-lg bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl shadow-slate-950/25"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto -mt-2 mb-1 md:hidden" />

            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-900 text-sky-400 flex items-center justify-center shrink-0 shadow-sm">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h2 id="pwa-install-title" className="text-lg font-bold text-slate-900">
                    RelayDrop Mobile App (PWA)
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Install to your home screen for standalone full-screen mode & offline vault cache.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close mobile app modal"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Viewport Layout Switcher: Mobile Handset Shell vs Full Responsive */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">
                  Interface Viewport Mode
                </span>
                <span className="text-[11px] font-mono text-sky-700">
                  {mobileShellMode ? '412px Handset Shell' : 'Responsive Full Canvas'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onToggleMobileShellMode(true);
                    onNotify('Switched to Mobile App Handset View');
                  }}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 interactive-press ${
                    mobileShellMode
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  <span>Mobile App Shell</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onToggleMobileShellMode(false);
                    onNotify('Switched to Full Responsive View');
                  }}
                  className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 interactive-press ${
                    !mobileShellMode
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Monitor className="w-4 h-4 text-sky-400" />
                  <span>Full Split View</span>
                </button>
              </div>
            </div>

            {/* Direct PWA Install Action or Status */}
            {isInstalled ? (
              <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Check className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-emerald-950">
                    Installed as Standalone Mobile App
                  </p>
                  <p className="text-xs text-emerald-800 mt-0.5">
                    RelayDrop is running in native standalone mode with active Service Worker offline caching.
                  </p>
                </div>
              </div>
            ) : isInstallable ? (
              <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200/90 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0">
                    <Download className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-sky-950">
                      Ready for One-Tap Home Screen Install
                    </p>
                    <p className="text-xs text-sky-800 mt-0.5">
                      Install RelayDrop directly to your device launcher with no app store download required.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const accepted = await onTriggerInstall();
                    if (accepted) {
                      onNotify('RelayDrop installed to your device!');
                      onClose();
                    }
                  }}
                  className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 interactive-press"
                >
                  <Download className="w-4 h-4" />
                  <span>Install RelayDrop App Now</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <p className="text-xs font-bold text-slate-900">
                  {isIOS
                    ? 'Install on iPhone or iPad (Safari)'
                    : 'Add RelayDrop to Your Home Screen'}
                </p>
                <div className="space-y-2 text-xs text-slate-600">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-slate-200/80 text-slate-800 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap">
                      Tap the browser <Share className="w-3.5 h-3.5 text-sky-600 inline" />{' '}
                      <strong>Share</strong> or menu icon in the toolbar.
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-lg bg-slate-200/80 text-slate-800 font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <span className="flex items-center gap-1.5 flex-wrap">
                      Select <PlusSquare className="w-3.5 h-3.5 text-sky-600 inline" />{' '}
                      <strong>Add to Home Screen</strong> or <strong>Install App</strong>.
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Scan to Open on Physical Smartphone */}
            <div className="p-4 rounded-2xl bg-white border border-slate-200/90 flex flex-col sm:flex-row items-center gap-4">
              <div className="shrink-0">
                <QrMatrixSvg value={shareUrl} size={116} />
              </div>
              <div className="space-y-2 text-center sm:text-left flex-1">
                <p className="text-xs font-bold text-slate-900">
                  Scan with Your Phone Camera
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Opens RelayDrop on your phone and automatically pairs with{' '}
                  <span className="font-mono font-semibold text-slate-800">
                    Room {roomCode}
                  </span>{' '}
                  for instant peer file beaming.
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleNativeShare}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 interactive-press"
                  >
                    <Share className="w-3.5 h-3.5 text-sky-400" />
                    <span>Share App Link</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 interactive-press"
                  >
                    {copiedUrl ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedUrl ? 'Copied' : 'Copy URL'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Capabilities Footer */}
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
                <span>Service Worker Offline Cache Ready</span>
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
                <span>Standalone Display Manifest v2</span>
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
