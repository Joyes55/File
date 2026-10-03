import React, { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Download,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  WrapText,
  Code2,
  FileText,
  Image as ImageIcon,
  Lock,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Eye,
  Music,
  ShieldCheck,
  KeyRound,
} from 'lucide-react';
import {
  SharedFile,
  formatBytes,
  formatDisplayDate,
} from '../types/files';
import {
  decryptFilePayload,
  EncryptedEnvelopePayload,
  formatEncryptedEnvelopePreview,
} from '../utils/crypto';
import {
  resolveImageSource,
  resolveTextContent,
} from './FileDetailSheet';

export interface PreviewableFileItem {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  uploadDate: string;
  senderName?: string;
  senderDevice?: string;
  roomCode?: string;
  pinProtected?: boolean;
  pinned?: boolean;
  encrypted?: boolean;
  encryptionAlgo?: string;
  encryptionIv?: string;
  encryptionSalt?: string;
  encryptionFingerprint?: string;
  encryptedPayload?: string;
  keyHint?: string;
  notes?: string;
  previewUrl?: string;
  textContent?: string;
  dataUrl?: string;
}

interface FilePreviewModalProps {
  file: PreviewableFileItem | null;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  onClose: () => void;
  onDownloadFile?: (file: SharedFile, pinCode?: string) => void;
  onOpenFullInspector?: (fileId: string) => void;
}

type PreviewKind = 'image' | 'code' | 'text' | 'audio' | 'binary';
type CanvasBackdrop = 'dark' | 'checker' | 'light';

const CODE_EXTENSION_REGEX =
  /\.(json|jsonl|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|hpp|cs|php|sh|bash|zsh|html?|css|scss|less|xml|svg|ya?ml|toml|ini|conf|env|sql|graphql|dockerfile)$/i;

const MARKDOWN_EXTENSION_REGEX = /\.(md|markdown)$/i;
const CSV_EXTENSION_REGEX = /\.(csv|tsv)$/i;

function detectPreviewKind(
  file: PreviewableFileItem,
  hasImage: boolean,
  hasText: boolean
): PreviewKind {
  if (hasImage) return 'image';
  const lowerMime = (file.mimeType || '').toLowerCase();
  const lowerName = (file.name || '').toLowerCase();

  if (
    lowerMime.startsWith('audio/') ||
    Boolean(file.dataUrl && file.dataUrl.startsWith('data:audio/')) ||
    /\.(wav|mp3|ogg|flac|m4a|aac)$/.test(lowerName)
  ) {
    return 'audio';
  }

  if (hasText) {
    if (
      lowerMime.includes('json') ||
      lowerMime.includes('javascript') ||
      lowerMime.includes('typescript') ||
      lowerMime.includes('xml') ||
      lowerMime.includes('yaml') ||
      lowerMime.includes('sql') ||
      CODE_EXTENSION_REGEX.test(lowerName)
    ) {
      return 'code';
    }
    return 'text';
  }

  return 'binary';
}

function detectLanguageBadge(fileName: string, mimeType: string): string {
  const extMatch = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = extMatch ? extMatch[1] : '';
  const map: Record<string, string> = {
    json: 'JSON',
    jsonl: 'JSONL',
    ts: 'TypeScript',
    tsx: 'TSX / React',
    js: 'JavaScript',
    jsx: 'JSX / React',
    py: 'Python',
    go: 'Go',
    rs: 'Rust',
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    sh: 'Shell',
    bash: 'Bash',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    sql: 'SQL',
    xml: 'XML',
    svg: 'SVG XML',
    md: 'Markdown',
    markdown: 'Markdown',
    csv: 'CSV',
    tsv: 'TSV',
    txt: 'Plain Text',
    log: 'Log File',
  };
  if (ext && map[ext]) return map[ext];
  if (mimeType.includes('json')) return 'JSON';
  if (mimeType.startsWith('text/')) return 'Text';
  return ext ? ext.toUpperCase() : 'File';
}

/**
 * Lightweight syntax highlighter for code & JSON lines inside the preview modal.
 */
function renderCodeLineTokens(line: string): React.ReactNode {
  const trimmed = line.trim();
  if (!trimmed) return '\u00A0';

  // Comments
  if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
    return <span className="text-slate-500 italic">{line}</span>;
  }

  // JSON key-value pattern
  const jsonKeyMatch = line.match(/^(\s*)(".*?")(\s*:\s*)(.*)$/);
  if (jsonKeyMatch) {
    const [, indent, keyToken, colonToken, restVal] = jsonKeyMatch;
    return (
      <>
        <span>{indent}</span>
        <span className="text-sky-300 font-semibold">{keyToken}</span>
        <span className="text-slate-400">{colonToken}</span>
        {highlightCodeValue(restVal)}
      </>
    );
  }

  // Generic code keywords & literals highlighting
  const tokenRegex =
    /("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`|\b(import|export|from|const|let|var|function|return|async|await|if|else|for|while|switch|case|break|continue|interface|type|class|extends|implements|new|try|catch|finally|throw|true|false|null|undefined|def|fn|pub|struct|enum|match|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|ORDER|BY|GROUP)\b|\b-?\d+(\.\d+)?\b)/g;

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (
      token.startsWith('"') ||
      token.startsWith("'") ||
      token.startsWith('`')
    ) {
      parts.push(
        <span key={match.index} className="text-emerald-300">
          {token}
        </span>
      );
    } else if (/^(true|false|null|undefined)$/.test(token)) {
      parts.push(
        <span key={match.index} className="text-purple-300 font-semibold">
          {token}
        </span>
      );
    } else if (/^-?\d+(\.\d+)?$/.test(token)) {
      parts.push(
        <span key={match.index} className="text-amber-300">
          {token}
        </span>
      );
    } else {
      parts.push(
        <span key={match.index} className="text-sky-400 font-semibold">
          {token}
        </span>
      );
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < line.length) {
    parts.push(line.slice(lastIndex));
  }

  return parts.length > 0 ? parts : line;
}

function highlightCodeValue(rawVal: string): React.ReactNode {
  const trimmed = rawVal.trim();
  if (!trimmed) return rawVal;
  const hasComma = trimmed.endsWith(',');
  const core = hasComma ? trimmed.slice(0, -1) : trimmed;
  const lead = rawVal.match(/^\s*/)?.[0] || '';

  if (core.startsWith('"') && core.endsWith('"')) {
    return (
      <>
        <span>{lead}</span>
        <span className="text-emerald-300">{core}</span>
        {hasComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(core)) {
    return (
      <>
        <span>{lead}</span>
        <span className="text-amber-300">{core}</span>
        {hasComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  if (/^(true|false|null)$/.test(core)) {
    return (
      <>
        <span>{lead}</span>
        <span className="text-purple-300 font-semibold">{core}</span>
        {hasComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  return <span className="text-slate-200">{rawVal}</span>;
}

function parseSimpleCsv(text: string, delimiter = ','): string[][] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((line) => {
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === delimiter && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  file,
  hasPrev = false,
  hasNext = false,
  onPrevFile,
  onNextFile,
  onClose,
  onDownloadFile,
  onOpenFullInspector,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [pinUnlocked, setPinUnlocked] = useState(true);
  const [pinError, setPinError] = useState('');

  // Client-side AES-256-GCM E2EE state
  const [decryptionInput, setDecryptionInput] = useState('');
  const [decryptedData, setDecryptedData] =
    useState<EncryptedEnvelopePayload | null>(null);
  const [decryptionError, setDecryptionError] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showCiphertextInspector, setShowCiphertextInspector] = useState(false);

  // Image preview state
  const [zoom, setZoom] = useState(1);
  const [imageFit, setImageFit] = useState<'contain' | 'cover'>('contain');
  const [backdrop, setBackdrop] = useState<CanvasBackdrop>('dark');
  const [imageFailed, setImageFailed] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Text / Code preview state
  const [wrapLines, setWrapLines] = useState(true);
  const [copiedContent, setCopiedContent] = useState(false);
  const [textFormatMode, setTextFormatMode] = useState<'formatted' | 'raw'>('formatted');
  const [svgViewTab, setSvgViewTab] = useState<'image' | 'code'>('image');

  useEffect(() => {
    if (file) {
      setPinUnlocked(!file.pinProtected);
      setPinInput('');
      setPinError('');
      setDecryptionInput('');
      setDecryptedData(null);
      setDecryptionError('');
      setIsDecrypting(false);
      setShowCiphertextInspector(false);
      setZoom(1);
      setImageFit('contain');
      setBackdrop('dark');
      setImageFailed(false);
      setImageDimensions(null);
      setWrapLines(true);
      setCopiedContent(false);
      setTextFormatMode('formatted');
      setSvgViewTab('image');
    }
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && hasPrev && onPrevFile) {
        e.preventDefault();
        onPrevFile();
      } else if (e.key === 'ArrowRight' && hasNext && onNextFile) {
        e.preventDefault();
        onNextFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, hasPrev, hasNext, onPrevFile, onNextFile, onClose]);

  const normalizedSharedFile = useMemo<SharedFile | null>(() => {
    if (!file) return null;
    return {
      id: file.id,
      name: file.name,
      size: file.size,
      mimeType: decryptedData?.originalMimeType || file.mimeType,
      category: file.category,
      uploadedAt: file.uploadDate,
      uploadDate: file.uploadDate,
      senderName: file.senderName || 'You',
      senderDevice: file.senderDevice || 'This Device',
      roomCode: file.roomCode || '842-910',
      downloads: 0,
      pinProtected: Boolean(file.pinProtected),
      pinned: file.pinned,
      encrypted: Boolean(file.encrypted),
      encryptionAlgo: file.encryptionAlgo,
      encryptionIv: file.encryptionIv,
      encryptionSalt: file.encryptionSalt,
      encryptionFingerprint: file.encryptionFingerprint,
      encryptedPayload: file.encryptedPayload,
      keyHint: file.keyHint,
      notes: file.notes,
      previewUrl: file.previewUrl,
      textContent: decryptedData?.textContent ?? file.textContent,
      dataUrl: decryptedData?.dataUrl ?? file.dataUrl,
    };
  }, [file, decryptedData]);

  const imageInfo = useMemo(() => {
    if (!normalizedSharedFile) {
      return { isImage: false, src: undefined, formatBadge: 'IMAGE' };
    }
    return resolveImageSource(normalizedSharedFile);
  }, [normalizedSharedFile]);

  const rawText = useMemo(() => {
    if (!normalizedSharedFile) return undefined;
    return resolveTextContent(normalizedSharedFile);
  }, [normalizedSharedFile]);

  const previewKind = useMemo<PreviewKind>(() => {
    if (!file) return 'binary';
    return detectPreviewKind(
      file,
      imageInfo.isImage && !imageFailed,
      typeof rawText === 'string' && rawText.length > 0
    );
  }, [file, imageInfo.isImage, imageFailed, rawText]);

  const formattedCodeOrText = useMemo(() => {
    if (!rawText) return '';
    if (
      textFormatMode === 'formatted' &&
      file &&
      (file.mimeType.includes('json') || /\.json$/i.test(file.name))
    ) {
      try {
        return JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        return rawText;
      }
    }
    return rawText;
  }, [rawText, textFormatMode, file]);

  const lines = useMemo(() => {
    if (!formattedCodeOrText) return [];
    return formattedCodeOrText.split(/\r?\n/);
  }, [formattedCodeOrText]);

  const isMarkdown = useMemo(
    () => Boolean(file && MARKDOWN_EXTENSION_REGEX.test(file.name)),
    [file]
  );

  const isCsv = useMemo(
    () =>
      Boolean(
        file &&
          (CSV_EXTENSION_REGEX.test(file.name) || file.mimeType === 'text/csv')
      ),
    [file]
  );

  const csvRows = useMemo(() => {
    if (!isCsv || !rawText) return [];
    const delim = file?.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
    return parseSimpleCsv(rawText, delim);
  }, [isCsv, rawText, file]);

  if (!file || !normalizedSharedFile) return null;

  const hasBothImageAndSvgCode =
    imageInfo.isImage && !imageFailed && typeof rawText === 'string' && rawText.length > 0;

  const languageBadge = detectLanguageBadge(file.name, file.mimeType);

  const handleUnlockPin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinError('');
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(file.id)}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setPinUnlocked(true);
      } else {
        setPinError(data.error || 'Incorrect PIN code. Try 2026 for demo file.');
      }
    } catch {
      if (pinInput.trim() === '2026') {
        setPinUnlocked(true);
      } else {
        setPinError('Could not verify PIN code.');
      }
    }
  };

  const handleDecryptFile = async (
    e?: React.FormEvent,
    overridePassphrase?: string
  ) => {
    if (e) e.preventDefault();
    const passToUse = (overridePassphrase ?? decryptionInput).trim();
    if (!passToUse) {
      setDecryptionError('Please enter the encryption passphrase.');
      return;
    }
    if (!file.encryptedPayload || !file.encryptionIv || !file.encryptionSalt) {
      setDecryptionError('Missing encryption envelope metadata on this file.');
      return;
    }

    setIsDecrypting(true);
    setDecryptionError('');
    try {
      const unlocked = await decryptFilePayload(
        {
          encryptedPayload: file.encryptedPayload,
          encryptionIv: file.encryptionIv,
          encryptionSalt: file.encryptionSalt,
        },
        passToUse
      );
      setDecryptedData(unlocked);
      setShowCiphertextInspector(false);
    } catch (err) {
      setDecryptionError(
        err instanceof Error
          ? err.message
          : 'Decryption failed: incorrect passphrase.'
      );
    } finally {
      setIsDecrypting(false);
    }
  };

  const isE2eeLocked = Boolean(file.encrypted && !decryptedData);

  const handleCopyText = async () => {
    if (!formattedCodeOrText) return;
    try {
      await navigator.clipboard.writeText(formattedCodeOrText);
      setCopiedContent(true);
      setTimeout(() => setCopiedContent(false), 2000);
    } catch {
      setCopiedContent(true);
    }
  };

  const handleTriggerDownload = () => {
    if (file.encrypted && decryptedData) {
      if (decryptedData.dataUrl) {
        const link = document.createElement('a');
        link.href = decryptedData.dataUrl;
        link.download = decryptedData.originalName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }
      if (decryptedData.textContent) {
        const blob = new Blob([decryptedData.textContent], {
          type: decryptedData.originalMimeType || file.mimeType || 'text/plain',
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = decryptedData.originalName || file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(url), 3000);
        return;
      }
    }
    if (onDownloadFile) {
      onDownloadFile(normalizedSharedFile, file.pinProtected ? pinInput : undefined);
      return;
    }
    if (file.dataUrl) {
      const link = document.createElement('a');
      link.href = file.dataUrl;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    if (rawText) {
      const blob = new Blob([rawText], { type: file.mimeType || 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 3000);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="file-preview-modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6"
        onClick={onClose}
      >
        <motion.div
          key={`file-preview-modal-${file.id}`}
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-preview-modal-title"
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-3xl bg-white rounded-3xl border border-slate-200/90 shadow-2xl shadow-slate-950/30 flex flex-col max-h-[88vh] overflow-hidden"
        >
          {/* Modal Header */}
          <div className="px-4 sm:px-6 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
                {previewKind === 'image' ? (
                  <ImageIcon className="w-5 h-5 text-sky-600" />
                ) : previewKind === 'code' ? (
                  <Code2 className="w-5 h-5 text-indigo-600" />
                ) : previewKind === 'audio' ? (
                  <Music className="w-5 h-5 text-amber-600" />
                ) : (
                  <FileText className="w-5 h-5 text-slate-700" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3
                    id="file-preview-modal-title"
                    className="text-base font-bold text-slate-900 truncate"
                  >
                    {file.name}
                  </h3>
                  {file.encrypted && (
                    <ShieldCheck
                      className="w-4 h-4 text-emerald-600 shrink-0"
                      aria-label="End-to-End Encrypted (AES-256-GCM)"
                    />
                  )}
                  {file.pinProtected && (
                    <Lock
                      className="w-3.5 h-3.5 text-amber-600 shrink-0"
                      aria-label="PIN Protected"
                    />
                  )}
                </div>

                {/* Unboxed Zero-Pill Metadata */}
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  <span className="font-semibold text-slate-700">
                    {previewKind === 'image'
                      ? `${imageInfo.formatBadge} Image`
                      : previewKind === 'code'
                      ? `${languageBadge} Code`
                      : previewKind === 'text'
                      ? `${languageBadge} Document`
                      : file.category}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span>{file.category}</span>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatBytes(file.size)}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span className="font-mono tabular-nums">
                    {formatDisplayDate(file.uploadDate)}
                  </span>
                  {file.encrypted && (
                    <>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="font-mono text-emerald-700 font-semibold">
                        {decryptedData ? 'Decrypted (AES-256-GCM)' : 'E2EE Encrypted'}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Header Navigation & Close Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {(hasPrev || hasNext) && (
                <div className="flex items-center bg-slate-100 rounded-xl p-0.5">
                  <button
                    type="button"
                    disabled={!hasPrev}
                    onClick={onPrevFile}
                    aria-label="Previous file"
                    title="Previous file (←)"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-white disabled:opacity-35 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={!hasNext}
                    onClick={onNextFile}
                    aria-label="Next file"
                    title="Next file (→)"
                    className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-white disabled:opacity-35 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close file preview"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Modal Body: Preview Viewport */}
          <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50/50">
            {!pinUnlocked ? (
              <form
                onSubmit={handleUnlockPin}
                className="p-6 rounded-2xl bg-white border border-slate-200/90 max-w-md mx-auto my-6 space-y-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <Lock className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      PIN-Protected File Preview
                    </h4>
                    <p className="text-xs text-slate-500">
                      Enter the 4-digit sender PIN to unlock the preview.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    placeholder="Enter PIN (e.g. 2026)"
                    className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                  />
                  <button
                    type="submit"
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap interactive-press"
                  >
                    Unlock Preview
                  </button>
                </div>

                 {pinError && (
                  <p className="text-xs font-semibold text-rose-600">{pinError}</p>
                )}
              </form>
            ) : isE2eeLocked ? (
              <div className="p-6 rounded-2xl bg-white border border-slate-200/90 max-w-xl mx-auto my-4 space-y-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-bold text-slate-900">
                      Zero-Knowledge End-to-End Encrypted File
                    </h4>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      This file was encrypted in the sender&apos;s browser using{' '}
                      <span className="font-mono font-semibold text-slate-800">
                        {file.encryptionAlgo || 'AES-256-GCM · PBKDF2-SHA256'}
                      </span>
                      . Enter the passphrase to derive the 256-bit key and decrypt locally.
                    </p>
                  </div>
                </div>

                {/* Cryptographic Telemetry Summary */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">
                      Cipher & KDF
                    </span>
                    <span className="text-slate-800 font-semibold">
                      AES-256-GCM · 100k PBKDF2
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 block font-sans">
                      SHA-256 Ciphertext Fingerprint
                    </span>
                    <span className="text-emerald-700 font-semibold">
                      {file.encryptionFingerprint || 'Verified'}
                    </span>
                  </div>
                  {file.keyHint && (
                    <div className="sm:col-span-2 pt-1 border-t border-slate-200/60 font-sans">
                      <span className="text-slate-500">Sender Key Hint: </span>
                      <span className="font-mono font-semibold text-slate-900">
                        {file.keyHint}
                      </span>
                    </div>
                  )}
                </div>

                <form onSubmit={handleDecryptFile} className="space-y-3">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={decryptionInput}
                      onChange={(e) => {
                        setDecryptionInput(e.target.value);
                        setDecryptionError('');
                      }}
                      placeholder="Enter decryption passphrase (e.g. relaydrop-2026)..."
                      className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <button
                      type="submit"
                      disabled={isDecrypting}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {isDecrypting ? 'Decrypting...' : 'Decrypt in Browser'}
                      </span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setDecryptionInput('relaydrop-2026');
                        handleDecryptFile(undefined, 'relaydrop-2026');
                      }}
                      className="text-emerald-700 hover:text-emerald-800 font-semibold underline underline-offset-2"
                    >
                      Unlock with Demo Key (relaydrop-2026)
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowCiphertextInspector((v) => !v)}
                      className="text-slate-600 hover:text-slate-900 font-mono text-[11px]"
                    >
                      {showCiphertextInspector
                        ? 'Hide Raw Ciphertext Envelope'
                        : 'Inspect Raw Server Ciphertext →'}
                    </button>
                  </div>

                  {decryptionError && (
                    <p className="text-xs font-semibold text-rose-600">
                      {decryptionError}
                    </p>
                  )}
                </form>

                {showCiphertextInspector && (
                  <div className="rounded-xl bg-slate-950 text-slate-200 p-3.5 font-mono text-[11px] overflow-x-auto border border-slate-800 space-y-1.5">
                    <div className="flex items-center justify-between text-slate-400 border-b border-slate-800 pb-1.5">
                      <span>Zero-Knowledge Server Ciphertext Envelope</span>
                      <span className="text-emerald-400">AES-256-GCM</span>
                    </div>
                    <pre className="whitespace-pre-wrap break-all leading-relaxed text-slate-300">
                      {formatEncryptedEnvelopePreview(file)}
                    </pre>
                  </div>
                )}
              </div>
            ) : (
              <>
                {file.encrypted && decryptedData && (
                  <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200/90 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-emerald-950">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="font-semibold">
                        Decrypted locally via Web Crypto (AES-256-GCM)
                      </span>
                      {file.encryptionFingerprint && (
                        <span className="font-mono text-[11px] text-emerald-700">
                          · SHA-256: {file.encryptionFingerprint}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowCiphertextInspector((v) => !v)}
                        className="px-2.5 py-1 rounded-lg bg-white hover:bg-emerald-100/60 border border-emerald-200 text-[11px] font-semibold text-emerald-900 transition-colors"
                      >
                        {showCiphertextInspector ? 'Hide Ciphertext' : 'Inspect Ciphertext'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecryptedData(null);
                          setDecryptionInput('');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-[11px] font-semibold text-white transition-colors"
                      >
                        Re-Lock
                      </button>
                    </div>
                  </div>
                )}

                {file.encrypted && decryptedData && showCiphertextInspector && (
                  <div className="rounded-2xl bg-slate-950 text-slate-200 p-4 font-mono text-[11px] overflow-x-auto border border-slate-800">
                    <pre className="whitespace-pre-wrap break-all leading-relaxed text-slate-300">
                      {formatEncryptedEnvelopePreview(file)}
                    </pre>
                  </div>
                )}
                {/* Dual Switcher if SVG has both Image and Source Code */}
                {hasBothImageAndSvgCode && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 p-1 bg-slate-200/75 rounded-xl">
                      <button
                        type="button"
                        onClick={() => setSvgViewTab('image')}
                        className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                          svgViewTab === 'image'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-sky-600" />
                        <span>Rendered Image</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSvgViewTab('code')}
                        className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                          svgViewTab === 'code'
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Code2 className="w-3.5 h-3.5 text-indigo-600" />
                        <span>SVG Code</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* 1. IMAGE PREVIEWER */}
                {previewKind === 'image' &&
                imageInfo.src &&
                (!hasBothImageAndSvgCode || svgViewTab === 'image') ? (
                  <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-slate-950">
                    {/* Image Controls Bar */}
                    <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                        <span className="text-sky-400 font-semibold">
                          {imageInfo.formatBadge}
                        </span>
                        {imageDimensions && (
                          <>
                            <span aria-hidden="true" className="text-slate-600">
                              ·
                            </span>
                            <span className="tabular-nums text-slate-300">
                              {imageDimensions.width} × {imageDimensions.height} px
                            </span>
                          </>
                        )}
                        <span aria-hidden="true" className="text-slate-600">
                          ·
                        </span>
                        <span className="tabular-nums text-slate-400">
                          {formatBytes(file.size)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setImageFit((f) => (f === 'contain' ? 'cover' : 'contain'))
                          }
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors"
                        >
                          {imageFit === 'contain' ? 'Fit' : 'Fill'}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))
                          }
                          disabled={zoom <= 0.5}
                          aria-label="Zoom out"
                          className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>

                        <span className="px-1.5 font-mono tabular-nums text-[11px] text-slate-300">
                          {Math.round(zoom * 100)}%
                        </span>

                        <button
                          type="button"
                          onClick={() =>
                            setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))
                          }
                          disabled={zoom >= 3}
                          aria-label="Zoom in"
                          className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>

                        {zoom !== 1 && (
                          <button
                            type="button"
                            onClick={() => setZoom(1)}
                            aria-label="Reset zoom"
                            className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            setBackdrop((b) =>
                              b === 'dark' ? 'checker' : b === 'checker' ? 'light' : 'dark'
                            )
                          }
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 transition-colors"
                        >
                          {backdrop === 'dark'
                            ? 'Dark BG'
                            : backdrop === 'checker'
                            ? 'Grid BG'
                            : 'Light BG'}
                        </button>
                      </div>
                    </div>

                    {/* Image Canvas */}
                    <div
                      className={`relative min-h-[280px] max-h-[54vh] overflow-auto flex items-center justify-center p-4 transition-colors ${
                        backdrop === 'light'
                          ? 'bg-slate-100'
                          : backdrop === 'checker'
                          ? 'bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] bg-slate-900'
                          : 'bg-slate-950'
                      }`}
                    >
                      <img
                        src={imageInfo.src}
                        alt={file.name}
                        referrerPolicy="no-referrer"
                        onLoad={(e) => {
                          const el = e.currentTarget;
                          if (el.naturalWidth && el.naturalHeight) {
                            setImageDimensions({
                              width: el.naturalWidth,
                              height: el.naturalHeight,
                            });
                          }
                        }}
                        onError={() => setImageFailed(true)}
                        style={{
                          transform: `scale(${zoom})`,
                          transformOrigin: 'center center',
                        }}
                        className={`max-h-[48vh] w-auto rounded-lg transition-transform duration-150 ${
                          imageFit === 'cover' ? 'object-cover w-full' : 'object-contain'
                        }`}
                      />
                    </div>
                  </div>
                ) : (previewKind === 'code' ||
                    previewKind === 'text' ||
                    (hasBothImageAndSvgCode && svgViewTab === 'code')) &&
                  rawText ? (
                  /* 2. CODE & TEXT PREVIEWER */
                  <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950 text-slate-100">
                    {/* Code / Text Toolbar */}
                    <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                        <span className="text-sky-400 font-semibold">
                          {languageBadge}
                        </span>
                        <span aria-hidden="true" className="text-slate-600">
                          ·
                        </span>
                        <span className="tabular-nums">
                          {lines.length} {lines.length === 1 ? 'line' : 'lines'}
                        </span>
                        <span aria-hidden="true" className="text-slate-600">
                          ·
                        </span>
                        <span className="tabular-nums text-slate-400">
                          {rawText.length.toLocaleString()} chars
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {(isMarkdown || isCsv || file.mimeType.includes('json') || /\.json$/i.test(file.name)) && (
                          <div className="flex items-center bg-slate-800 rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() => setTextFormatMode('formatted')}
                              className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                                textFormatMode === 'formatted'
                                  ? 'bg-sky-600 text-white'
                                  : 'text-slate-300 hover:text-white'
                              }`}
                            >
                              {isCsv ? 'Table' : isMarkdown ? 'Reader' : 'Formatted'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setTextFormatMode('raw')}
                              className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                                textFormatMode === 'raw'
                                  ? 'bg-sky-600 text-white'
                                  : 'text-slate-300 hover:text-white'
                              }`}
                            >
                              Raw Code
                            </button>
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setWrapLines((w) => !w)}
                          className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                            wrapLines
                              ? 'bg-slate-800 text-sky-300'
                              : 'bg-slate-800/60 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <WrapText className="w-3.5 h-3.5" />
                          <span>Wrap</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCopyText}
                          className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold flex items-center gap-1 transition-colors"
                        >
                          {copiedContent ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Code / Text Content Area */}
                    <div className="max-h-[52vh] overflow-auto">
                      {isCsv && textFormatMode === 'formatted' && csvRows.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
                            <thead>
                              <tr className="bg-slate-900/90 border-b border-slate-800 text-sky-300">
                                {csvRows[0].map((headerCell, cIdx) => (
                                  <th
                                    key={cIdx}
                                    className="px-3.5 py-2.5 font-semibold whitespace-nowrap border-r border-slate-800/60 last:border-r-0"
                                  >
                                    {headerCell || `Col ${cIdx + 1}`}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {csvRows.slice(1).map((row, rIdx) => (
                                <tr key={rIdx} className="hover:bg-slate-900/50">
                                  {row.map((cell, cIdx) => (
                                    <td
                                      key={cIdx}
                                      className="px-3.5 py-2 text-slate-300 whitespace-nowrap border-r border-slate-800/40 last:border-r-0"
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : isMarkdown && textFormatMode === 'formatted' ? (
                        <div className="p-5 space-y-2.5 font-sans text-slate-200">
                          {lines.map((line, idx) => {
                            const t = line.trim();
                            if (!t) return <div key={idx} className="h-1.5" />;
                            if (t.startsWith('# ')) {
                              return (
                                <h4
                                  key={idx}
                                  className="text-base font-bold text-white border-b border-slate-800 pb-1.5"
                                >
                                  {t.slice(2)}
                                </h4>
                              );
                            }
                            if (t.startsWith('## ')) {
                              return (
                                <h5 key={idx} className="text-sm font-bold text-sky-300 pt-1">
                                  {t.slice(3)}
                                </h5>
                              );
                            }
                            if (t.startsWith('- ') || t.startsWith('* ')) {
                              return (
                                <div key={idx} className="flex items-start gap-2 text-xs leading-relaxed pl-1">
                                  <span className="text-sky-400">•</span>
                                  <span className="text-slate-200">{t.slice(2)}</span>
                                </div>
                              );
                            }
                            return (
                              <p key={idx} className="text-xs text-slate-300 leading-relaxed">
                                {line}
                              </p>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="py-3 font-mono text-xs leading-relaxed">
                          {lines.map((line, idx) => (
                            <div
                              key={idx}
                              className="px-4 py-0.5 hover:bg-slate-900/70 flex items-start gap-3"
                            >
                              <span className="w-8 shrink-0 select-none text-right font-mono tabular-nums text-[11px] text-slate-600">
                                {idx + 1}
                              </span>
                              <span
                                className={`flex-1 ${
                                  wrapLines
                                    ? 'whitespace-pre-wrap break-words'
                                    : 'whitespace-pre'
                                }`}
                              >
                                {previewKind === 'code' ||
                                (hasBothImageAndSvgCode && svgViewTab === 'code')
                                  ? renderCodeLineTokens(line)
                                  : line || '\u00A0'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : previewKind === 'audio' && file.dataUrl ? (
                  /* 3. AUDIO PREVIEWER */
                  <div className="p-6 rounded-2xl bg-slate-900 text-white space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
                        <Music className="w-5 h-5 text-amber-300" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{file.name}</p>
                        <p className="text-xs text-slate-400 font-mono">
                          {file.mimeType} · {formatBytes(file.size)}
                        </p>
                      </div>
                    </div>
                    <audio controls src={file.dataUrl} className="w-full" />
                  </div>
                ) : (
                  /* 4. FALLBACK SUMMARY WHEN BINARY HAS NO INLINE STREAM */
                  <div className="p-8 rounded-2xl bg-white border border-slate-200/80 text-center space-y-2">
                    <Eye className="w-7 h-7 text-slate-400 mx-auto" />
                    <p className="text-sm font-semibold text-slate-900">
                      Binary Asset Ready for Download
                    </p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      {file.name} ({file.mimeType}, {formatBytes(file.size)}) is stored in Room{' '}
                      {file.roomCode || '842-910'}.
                    </p>
                  </div>
                )}

                {file.notes && (
                  <p className="text-xs text-slate-600 px-1">
                    <span className="font-semibold text-slate-800">Sender Note:</span>{' '}
                    {file.notes}
                  </p>
                )}
              </>
            )}
          </div>

          {/* Modal Footer Actions */}
          <div className="px-4 sm:px-6 py-3.5 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-slate-500 truncate">
              <span>Shared by </span>
              <span className="font-semibold text-slate-800">
                {file.senderName || 'Room Peer'}
              </span>
              {file.senderDevice && (
                <>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  <span>{file.senderDevice}</span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {onOpenFullInspector && (
                <button
                  type="button"
                  onClick={() => onOpenFullInspector(file.id)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 text-sky-600" />
                  <span>Manage & Categorize</span>
                </button>
              )}

              {pinUnlocked && !isE2eeLocked && (
                <button
                  type="button"
                  onClick={handleTriggerDownload}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{file.encrypted ? 'Download Decrypted' : 'Download'}</span>
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
