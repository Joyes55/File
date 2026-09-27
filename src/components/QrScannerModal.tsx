import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import jsQR from 'jsqr';
import {
  X,
  Camera,
  RefreshCw,
  ImageUp,
  Download,
  Lock,
  Check,
  QrCode,
  Radio,
  FileText,
  Flashlight,
  ExternalLink,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { SharedFile, formatBytes, formatDisplayDate } from '../types/files';
import {
  QrMatrixSvg,
  buildFileQrPayloadUrl,
  downloadFileQrPng,
} from './QrMatrixSvg';

export type ParsedQrResult =
  | {
      type: 'room';
      roomCode: string;
      raw: string;
    }
  | {
      type: 'file';
      fileId: string;
      file?: SharedFile;
      roomCode?: string;
      pin?: string;
      raw: string;
    }
  | {
      type: 'unknown';
      raw: string;
    };

export function parseScannedQrPayload(
  rawInput: string,
  files: SharedFile[]
): ParsedQrResult {
  const raw = rawInput.trim();
  if (!raw) {
    return { type: 'unknown', raw: '' };
  }

  // 1. Try parsing as URL (?room=...&file=... or ?file=... or /api/files/:id/download or ?room=...)
  try {
    const url = new URL(raw, window.location.origin);
    const roomParam = url.searchParams.get('room')?.trim() || undefined;
    const fileParam = url.searchParams.get('file')?.trim() || undefined;
    const pinParam = url.searchParams.get('pin')?.trim() || undefined;

    if (fileParam) {
      const targetId = fileParam;
      const matched = files.find(
        (f) =>
          f.id.toLowerCase() === targetId.toLowerCase() ||
          f.name.toLowerCase() === targetId.toLowerCase()
      );
      return {
        type: 'file',
        fileId: matched ? matched.id : targetId,
        file: matched,
        roomCode: roomParam || matched?.roomCode,
        pin: pinParam,
        raw,
      };
    }

    const downloadMatch = url.pathname.match(/\/api\/files\/([^/]+)\/download/i);
    if (downloadMatch && downloadMatch[1]) {
      const targetId = decodeURIComponent(downloadMatch[1]);
      const matched = files.find((f) => f.id === targetId);
      return {
        type: 'file',
        fileId: targetId,
        file: matched,
        roomCode: roomParam || matched?.roomCode,
        pin: pinParam,
        raw,
      };
    }

    if (roomParam) {
      return {
        type: 'room',
        roomCode: roomParam,
        raw,
      };
    }
  } catch {
    // Not a standard URL; continue checking patterns
  }

  // 2. Check custom protocol or prefix e.g. relaydrop://room/842-910 or room:842-910
  const roomPrefixMatch = raw.match(/^(?:relaydrop:\/\/room\/|room:)\s*([a-zA-Z0-9-]{3,20})$/i);
  if (roomPrefixMatch && roomPrefixMatch[1]) {
    return {
      type: 'room',
      roomCode: roomPrefixMatch[1].trim(),
      raw,
    };
  }

  // 3. Check 6-digit room code format e.g. 842-910 or 6 digits
  if (/^\d{3}-\d{3}$/.test(raw)) {
    return {
      type: 'room',
      roomCode: raw,
      raw,
    };
  }
  if (/^\d{6}$/.test(raw)) {
    return {
      type: 'room',
      roomCode: `${raw.slice(0, 3)}-${raw.slice(3)}`,
      raw,
    };
  }

  // 4. Check direct file ID or filename match
  const directFile = files.find(
    (f) =>
      f.id.toLowerCase() === raw.toLowerCase() ||
      f.name.toLowerCase() === raw.toLowerCase()
  );
  if (directFile) {
    return {
      type: 'file',
      fileId: directFile.id,
      file: directFile,
      raw,
    };
  }

  if (raw.startsWith('file-')) {
    return {
      type: 'file',
      fileId: raw,
      raw,
    };
  }

  return {
    type: 'unknown',
    raw,
  };
}

interface QrScannerModalProps {
  isOpen: boolean;
  files: SharedFile[];
  currentRoomCode: string;
  onClose: () => void;
  onJoinRoom: (roomCode: string) => void;
  onInspectFile: (fileId: string) => void;
  onDownloadFile?: (file: SharedFile, pinCode?: string) => void;
  onNotify: (message: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  files,
  currentRoomCode,
  onClose,
  onJoinRoom,
  onInspectFile,
  onDownloadFile,
  onNotify,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraState, setCameraState] = useState<'initializing' | 'active' | 'denied' | 'unavailable'>('initializing');
  const [cameraErrorMsg, setCameraErrorMsg] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);

  const [scannedResult, setScannedResult] = useState<ParsedQrResult | null>(null);
  const [autoExecuteOnScan, setAutoExecuteOnScan] = useState<boolean>(true);
  const [manualInput, setManualInput] = useState<string>('');
  const [showSampleGenerator, setShowSampleGenerator] = useState<boolean>(false);

  // PIN unlock state when scanning a PIN-protected file QR code
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [pinVerified, setPinVerified] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);

  const stopCameraStream = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, []);

  const triggerBrowserDownload = useCallback(
    (file: SharedFile, pin?: string) => {
      if (onDownloadFile) {
        onDownloadFile(file, pin);
        setDownloadTriggered(true);
        return;
      }
      const pinQuery =
        file.pinProtected && pin ? `?pin=${encodeURIComponent(pin)}` : '';
      const link = document.createElement('a');
      link.href = `/api/files/${file.id}/download${pinQuery}`;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setDownloadTriggered(true);
    },
    [onDownloadFile]
  );

  const handleDecodedQrString = useCallback(
    (rawString: string) => {
      const parsed = parseScannedQrPayload(rawString, files);
      setScannedResult(parsed);
      setPinInput(parsed.type === 'file' && parsed.pin ? parsed.pin : '');
      setPinError('');
      setDownloadTriggered(false);

      if (parsed.type === 'room') {
        if (autoExecuteOnScan) {
          onJoinRoom(parsed.roomCode);
          onNotify(`Scanned QR: Joined Room ${parsed.roomCode}`);
        }
      } else if (parsed.type === 'file' && parsed.file) {
        const targetFile = parsed.file;
        const targetRoom = parsed.roomCode || targetFile.roomCode;
        if (targetRoom && targetRoom !== currentRoomCode) {
          onJoinRoom(targetRoom);
        }
        const unlockedViaQrPin = Boolean(parsed.pin);
        setPinVerified(!targetFile.pinProtected || unlockedViaQrPin);
        if (autoExecuteOnScan && (!targetFile.pinProtected || unlockedViaQrPin)) {
          triggerBrowserDownload(targetFile, parsed.pin);
          onNotify(
            `Scanned File QR: Paired to Room ${targetRoom} & downloading "${targetFile.name}"`
          );
        }
      }
    },
    [
      autoExecuteOnScan,
      currentRoomCode,
      files,
      onJoinRoom,
      onNotify,
      triggerBrowserDownload,
    ]
  );

  // Initialize camera stream and QR frame scanner loop
  useEffect(() => {
    if (!isOpen) {
      stopCameraStream();
      return;
    }

    // If a result is currently locked on screen, pause camera scanning until user resets
    if (scannedResult) {
      return;
    }

    let cancelled = false;

    async function startCamera() {
      setCameraState('initializing');
      setCameraErrorMsg('');
      stopCameraStream();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setCameraState('unavailable');
        setCameraErrorMsg('Camera API is not available in this browser context. Use QR Photo Upload or Test Codes below.');
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: facingMode },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available video device
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        }

        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }

        streamRef.current = stream;

        // Check torch capability
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
          if (caps && caps.torch) {
            setTorchSupported(true);
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setCameraState('active');

        // Start frame scanning loop
        let lastScanTime = 0;
        const scanTick = (timestamp: number) => {
          if (cancelled) return;

          if (timestamp - lastScanTime >= 110) {
            lastScanTime = timestamp;
            const video = videoRef.current;
            const canvas = canvasRef.current;

            if (
              video &&
              canvas &&
              video.readyState === video.HAVE_ENOUGH_DATA &&
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              const targetWidth = Math.min(640, video.videoWidth);
              const scale = targetWidth / video.videoWidth;
              const targetHeight = Math.floor(video.videoHeight * scale);

              canvas.width = targetWidth;
              canvas.height = targetHeight;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });

              if (ctx) {
                ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
                const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                  inversionAttempts: 'attemptBoth',
                });

                if (code && code.data && code.data.trim()) {
                  handleDecodedQrString(code.data.trim());
                  return;
                }
              }
            }
          }

          rafRef.current = requestAnimationFrame(scanTick);
        };

        rafRef.current = requestAnimationFrame(scanTick);
      } catch (err) {
        if (cancelled) return;
        setCameraState('denied');
        const message =
          err instanceof Error && err.name === 'NotAllowedError'
            ? 'Camera permission was declined. Allow camera access in your browser bar or scan from an image file below.'
            : 'Could not access physical camera hardware. You can upload a QR image or use the instant QR test targets below.';
        setCameraErrorMsg(message);
      }
    }

    startCamera();

    return () => {
      cancelled = true;
      stopCameraStream();
    };
  }, [isOpen, facingMode, scannedResult, handleDecodedQrString, stopCameraStream]);

  // Reset state when modal opens & listen for Escape key
  useEffect(() => {
    if (isOpen) {
      setScannedResult(null);
      setPinInput('');
      setPinError('');
      setDownloadTriggered(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;
    const nextTorch = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
      });
      setTorchOn(nextTorch);
    } catch {
      // Torch constraint failed on device
    }
  };

  const handleDecodeUploadedImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        canvas.width = Math.max(1, Math.floor(img.width * scale));
        canvas.height = Math.max(1, Math.floor(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });

        if (code && code.data) {
          handleDecodedQrString(code.data);
        } else {
          setPinError('');
          onNotify('No valid QR code found in the selected photo. Try a clearer image.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleUnlockAndDownloadScannedFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!scannedResult || scannedResult.type !== 'file' || !scannedResult.file) return;
    const targetFile = scannedResult.file;
    setPinError('');

    try {
      const res = await fetch(`/api/files/${targetFile.id}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setPinVerified(true);
        triggerBrowserDownload(targetFile, pinInput);
        onNotify(`Unlocked & downloading "${targetFile.name}"`);
      } else {
        setPinError(data.error || 'Incorrect PIN code. (Hint: 2026 for demo BOM file)');
      }
    } catch {
      setPinError('Could not verify PIN.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleDecodedQrString(manualInput.trim());
    setManualInput('');
  };

  const sampleFilesForDemo = files.slice(0, 3);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="qr-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
          onClick={onClose}
        >
          <motion.div
            key="qr-dialog"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-xl bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 max-h-[92vh] flex flex-col overflow-hidden shadow-2xl shadow-slate-950/20"
            onClick={(e) => e.stopPropagation()}
          >
        {/* Mobile Drag Handle */}
        <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0 md:hidden" />

        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 truncate">
                Optical QR Code Scanner
              </h2>
              <p className="text-xs text-slate-500 truncate">
                Scan a Room Code to join or a File QR to download immediately
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close QR Scanner"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Hidden Canvas for jsQR Frame Decoding & File Input for QR Image Upload */}
          <canvas ref={canvasRef} className="hidden" />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleDecodeUploadedImage}
            className="hidden"
          />

          {/* Viewfinder OR Scanned Result Card */}
          {!scannedResult ? (
            <div className="space-y-4">
              {/* Live Optical Camera Viewfinder */}
              <div className="relative rounded-3xl overflow-hidden bg-slate-950 aspect-[4/3] flex items-center justify-center border border-slate-800">
                <video
                  ref={videoRef}
                  playsInline
                  muted
                  className={`w-full h-full object-cover ${
                    cameraState === 'active' ? 'opacity-100' : 'opacity-0'
                  } transition-opacity duration-200`}
                />

                {/* Optical Target Reticle Overlay */}
                {cameraState === 'active' && (
                  <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center p-6">
                    <div className="relative w-52 h-52 sm:w-60 sm:h-60 rounded-3xl border border-white/25 flex items-center justify-center">
                      {/* 4 High-Contrast Corner Brackets */}
                      <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-4 border-l-4 border-sky-400 rounded-tl-2xl" />
                      <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-4 border-r-4 border-sky-400 rounded-tr-2xl" />
                      <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-4 border-l-4 border-sky-400 rounded-bl-2xl" />
                      <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-4 border-r-4 border-sky-400 rounded-br-2xl" />

                      {/* Subtle Center Scan Line */}
                      <div className="w-4/5 h-0.5 bg-gradient-to-r from-transparent via-sky-400 to-transparent opacity-90 animate-pulse" />
                    </div>

                    <div className="mt-4 px-3.5 py-1.5 rounded-full bg-slate-950/75 backdrop-blur-md text-white text-xs font-medium">
                      Align Room or File QR code inside reticle
                    </div>
                  </div>
                )}

                {/* Initializing State */}
                {cameraState === 'initializing' && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6 text-center space-y-3">
                    <Camera className="w-8 h-8 text-sky-400 animate-pulse" />
                    <p className="text-sm font-semibold">Starting Optical Camera Stream...</p>
                    <p className="text-xs text-slate-400 max-w-xs">
                      Requesting camera access for real-time QR code recognition.
                    </p>
                  </div>
                )}

                {/* Camera Permission Denied or Unavailable Fallback inside Viewfinder */}
                {(cameraState === 'denied' || cameraState === 'unavailable') && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-6 text-center space-y-4 bg-slate-900">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6" />
                    </div>
                    <div className="space-y-1 max-w-sm">
                      <p className="text-sm font-semibold">Camera Stream Unavailable</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{cameraErrorMsg}</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <ImageUp className="w-4 h-4" />
                        <span>Scan QR from Photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Retry Camera</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Top Camera Hardware Controls Bar */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-auto">
                  <button
                    type="button"
                    onClick={() =>
                      setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                    }
                    className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
                    <span>{facingMode === 'environment' ? 'Rear Camera' : 'Front Camera'}</span>
                  </button>

                  <div className="flex items-center gap-2">
                    {torchSupported && (
                      <button
                        type="button"
                        onClick={handleToggleTorch}
                        aria-label="Toggle flashlight"
                        className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 transition-colors ${
                          torchOn
                            ? 'bg-amber-400 text-slate-950'
                            : 'bg-slate-900/80 text-white hover:bg-slate-900'
                        }`}
                      >
                        <Flashlight className="w-3.5 h-3.5" />
                        <span>{torchOn ? 'Torch On' : 'Torch'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-semibold backdrop-blur-md flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <ImageUp className="w-3.5 h-3.5 text-sky-400" />
                      <span>Scan Photo</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Auto-Action Toggle */}
              <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200/80">
                <div>
                  <p className="text-xs font-semibold text-slate-900">
                    Instant Action on Scan
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Automatically join scanned rooms or start file downloads immediately
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoExecuteOnScan}
                  onClick={() => setAutoExecuteOnScan((v) => !v)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    autoExecuteOnScan
                      ? 'bg-sky-600 text-white'
                      : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {autoExecuteOnScan ? 'Auto-Action: ON' : 'Confirm First'}
                </button>
              </div>
            </div>
          ) : (
            /* Scanned QR Payload Resolution Card */
            <div className="p-5 rounded-3xl bg-slate-50 border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                  <Check className="w-4 h-4" />
                  <span>QR Code Decoded Successfully</span>
                </span>
                <button
                  type="button"
                  onClick={() => setScannedResult(null)}
                  className="min-h-[36px] px-3 py-1 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                >
                  Scan Another Code
                </button>
              </div>

              {scannedResult.type === 'room' && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 space-y-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                      <Radio className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-500">
                        Peer Room Pairing Code
                      </p>
                      <h3 className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                        Room {scannedResult.roomCode}
                      </h3>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">
                    {currentRoomCode === scannedResult.roomCode
                      ? `You are now connected to Room ${scannedResult.roomCode}. All shared files in this room are synced.`
                      : `Switch your active mesh channel from ${currentRoomCode} to Room ${scannedResult.roomCode}.`}
                  </p>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        onJoinRoom(scannedResult.roomCode);
                        onNotify(`Joined Room ${scannedResult.roomCode}`);
                        onClose();
                      }}
                      className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                    >
                      <Check className="w-4 h-4" />
                      <span>
                        {currentRoomCode === scannedResult.roomCode
                          ? 'Open Room Vault'
                          : `Join Room ${scannedResult.roomCode}`}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {scannedResult.type === 'file' && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 space-y-4">
                  {scannedResult.file ? (
                    <>
                      <div className="flex items-start gap-3.5">
                        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                          <FileText className="w-6 h-6 text-sky-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h3 className="text-base font-bold text-slate-900 truncate">
                              {scannedResult.file.name}
                            </h3>
                            {scannedResult.file.pinProtected && (
                              <Lock className="w-4 h-4 text-amber-600 shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            <span className="font-semibold text-slate-700">
                              {scannedResult.file.category}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatBytes(scannedResult.file.size)}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatDisplayDate(scannedResult.file.uploadDate)}
                            </span>
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            Shared by {scannedResult.file.senderName} ({scannedResult.file.senderDevice}) · Room {scannedResult.roomCode || scannedResult.file.roomCode}
                          </p>
                        </div>
                      </div>

                      {/* PIN Gate if Protected */}
                      {scannedResult.file.pinProtected && !pinVerified ? (
                        <form
                          onSubmit={handleUnlockAndDownloadScannedFile}
                          className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 space-y-2.5"
                        >
                          <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5" />
                            <span>This shared file requires a 4-digit PIN to download</span>
                          </p>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              value={pinInput}
                              onChange={(e) => setPinInput(e.target.value)}
                              placeholder="Enter PIN (e.g. 2026)"
                              className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-amber-300 bg-white text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                            />
                            <button
                              type="submit"
                              className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
                            >
                              Unlock & Download
                            </button>
                          </div>
                          {pinError && (
                            <p className="text-xs font-semibold text-rose-600">{pinError}</p>
                          )}
                        </form>
                      ) : (
                        <div className="flex flex-col sm:flex-row items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() =>
                              triggerBrowserDownload(scannedResult.file!, pinInput)
                            }
                            className="w-full sm:flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                          >
                            <Download className="w-4 h-4" />
                            <span>
                              {downloadTriggered
                                ? `Download Again (${formatBytes(scannedResult.file.size)})`
                                : `Download File (${formatBytes(scannedResult.file.size)})`}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              onInspectFile(scannedResult.file!.id);
                              onClose();
                            }}
                            className="w-full sm:w-auto min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                          >
                            <Eye className="w-4 h-4" />
                            <span>Inspect in Vault</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-900">
                        File Reference: <span className="font-mono">{scannedResult.fileId}</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        This file ID was not found in the current room vault. Make sure you are paired to the sender's room.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {scannedResult.type === 'unknown' && (
                <div className="p-4 rounded-2xl bg-white border border-slate-200/90 space-y-3">
                  <p className="text-xs font-semibold text-slate-500">Decoded QR Payload</p>
                  <p className="text-xs font-mono text-slate-900 break-all bg-slate-50 p-3 rounded-xl border border-slate-200">
                    {scannedResult.raw}
                  </p>
                  {/^https?:\/\//i.test(scannedResult.raw) && (
                    <a
                      href={scannedResult.raw}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold inline-flex items-center gap-2"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open Scanned Link</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Instant Test / Physical QR Simulation Bar & Manual Payload Entry */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <QrCode className="w-3.5 h-3.5 text-sky-600" />
                <span>Quick Test Scan Targets (Simulate Camera Detection)</span>
              </span>
              <button
                type="button"
                onClick={() => setShowSampleGenerator((v) => !v)}
                className="min-h-[36px] px-2.5 text-xs font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap"
              >
                {showSampleGenerator ? 'Hide Printable QRs' : 'Show Scannable QRs'}
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  handleDecodedQrString(`${window.location.origin}/?room=409-218`)
                }
                className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Radio className="w-3.5 h-3.5 text-sky-600" />
                <span>Scan Room QR (409-218)</span>
              </button>

              {sampleFilesForDemo.map((sampleFile) => (
                <button
                  key={sampleFile.id}
                  type="button"
                  onClick={() =>
                    handleDecodedQrString(
                      buildFileQrPayloadUrl({
                        fileId: sampleFile.id,
                        roomCode: sampleFile.roomCode || currentRoomCode,
                      })
                    )
                  }
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1.5 transition-colors whitespace-nowrap max-w-full"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">Scan File: {sampleFile.name}</span>
                </button>
              ))}
            </div>

            {/* Expandable Scannable QR Cards (Point another phone at these or download & upload!) */}
            {showSampleGenerator && (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                <p className="text-xs text-slate-600">
                  Point a phone camera at these QR codes, or click <strong>Download QR PNG</strong> and then <strong>Scan Photo</strong> above to test instant pairing-room file downloads:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center gap-3">
                    <QrMatrixSvg
                      value={`${window.location.origin}/?room=409-218`}
                      size={84}
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">Room 409-218</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Pairs device to Room 409-218
                      </p>
                    </div>
                  </div>

                  {files[0] && (
                    <div className="p-3 rounded-xl bg-white border border-slate-200 flex items-center gap-3">
                      <QrMatrixSvg
                        value={buildFileQrPayloadUrl({
                          fileId: files[0].id,
                          roomCode: files[0].roomCode || currentRoomCode,
                        })}
                        size={84}
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-xs font-bold text-slate-900 truncate">
                          {files[0].name}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Room {files[0].roomCode || currentRoomCode} · Instant Download QR
                        </p>
                        <button
                          type="button"
                          onClick={() =>
                            downloadFileQrPng({
                              value: buildFileQrPayloadUrl({
                                fileId: files[0].id,
                                roomCode: files[0].roomCode || currentRoomCode,
                              }),
                              fileName: files[0].name,
                              category: files[0].category,
                              sizeLabel: formatBytes(files[0].size),
                              roomCode: files[0].roomCode || currentRoomCode,
                            })
                          }
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold inline-flex items-center gap-1"
                        >
                          <Download className="w-3 h-3 text-sky-400" />
                          <span>Download QR PNG</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Manual Code / URL Entry Fallback */}
            <form onSubmit={handleManualSubmit} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="Or paste a QR URL, Room Code (e.g. 842-910), or File ID..."
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
              <button
                type="submit"
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Resolve Code
              </button>
            </form>
          </div>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
