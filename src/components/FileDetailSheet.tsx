import React, { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  X,
  Download,
  Lock,
  Check,
  Copy,
  Trash2,
  FolderPlus,
  Image as ImageIcon,
  FileText,
  Music,
  Code2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Maximize2,
  Minimize2,
  Search,
  WrapText,
  Hash,
  FileJson,
  Table as TableIcon,
  Eye,
  Braces,
  ChevronLeft,
  ChevronRight,
  Edit3,
  BookOpen,
  Share2,
  QrCode,
  Pin,
} from 'lucide-react';
import {
  SharedFile,
  TransferProgressState,
  formatBytes,
  formatDisplayDate,
} from '../types/files';
import {
  QrMatrixSvg,
  buildFileQrPayloadUrl,
  downloadFileQrPng,
  downloadFileQrSvg,
} from './QrMatrixSvg';
import { TransferProgressBar } from './TransferProgressBar';

interface FileDetailSheetProps {
  file: SharedFile | null;
  categories: string[];
  activeRoomCode?: string;
  canEdit: boolean;
  hasPrev?: boolean;
  hasNext?: boolean;
  onPrevFile?: () => void;
  onNextFile?: () => void;
  activeTransfer?: TransferProgressState | null;
  onDownloadFile?: (file: SharedFile, pinCode?: string) => void;
  onOpenAuthModal: () => void;
  onClose: () => void;
  onUpdateFile: (
    id: string,
    updates: {
      category?: string;
      name?: string;
      notes?: string;
      uploadDate?: string;
      pinned?: boolean;
    }
  ) => Promise<void>;
  onDeleteFile: (id: string) => Promise<void>;
  onAddCategory: (name: string) => Promise<void>;
}

type ImageBackdrop = 'dark' | 'grid' | 'light';
type TextViewMode = 'pretty' | 'inspector' | 'table' | 'reader' | 'raw';

const COMMON_IMAGE_EXT_REGEX = /\.(jpe?g|png|webp|gif|svg|bmp|avif|ico|tiff?)$/i;
const COMMON_TEXT_EXT_REGEX =
  /\.(json|jsonl|txt|md|markdown|csv|tsv|log|xml|ya?ml|toml|ini|conf|env|sql|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|sh|html?|css|scss)$/i;

/**
 * Decodes text content from a file's `textContent` field or falls back to
 * decoding base64/utf8 text from `dataUrl` when applicable.
 */
export function resolveTextContent(file: SharedFile): string | undefined {
  if (typeof file.textContent === 'string' && file.textContent.length > 0) {
    return file.textContent;
  }

  if (file.dataUrl && file.dataUrl.startsWith('data:')) {
    const isTextDataUrl =
      /^data:(text\/|application\/(json|xml|javascript|x-yaml|csv)|image\/svg\+xml)/i.test(
        file.dataUrl
      ) || COMMON_TEXT_EXT_REGEX.test(file.name);

    if (isTextDataUrl) {
      const commaIdx = file.dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        const meta = file.dataUrl.slice(0, commaIdx);
        const payload = file.dataUrl.slice(commaIdx + 1);
        try {
          if (meta.includes(';base64')) {
            const binary = window.atob(payload);
            const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
            return new TextDecoder('utf-8').decode(bytes);
          } else {
            return decodeURIComponent(payload);
          }
        } catch {
          return undefined;
        }
      }
    }
  }

  return undefined;
}

/**
 * Resolves an image preview source URL from `dataUrl`, `previewUrl`, or inline SVG `textContent`.
 */
export function resolveImageSource(file: SharedFile): {
  isImage: boolean;
  src?: string;
  formatBadge: string;
} {
  const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toUpperCase() : '';

  const isSvg =
    file.mimeType === 'image/svg+xml' ||
    ext === 'SVG' ||
    Boolean(file.dataUrl && file.dataUrl.startsWith('data:image/svg+xml'));

  const isImageMimeOrExt =
    file.mimeType.startsWith('image/') ||
    COMMON_IMAGE_EXT_REGEX.test(file.name) ||
    Boolean(file.previewUrl) ||
    Boolean(file.dataUrl && file.dataUrl.startsWith('data:image/'));

  let src: string | undefined;
  if (file.dataUrl && file.dataUrl.startsWith('data:image/')) {
    src = file.dataUrl;
  } else if (file.previewUrl) {
    src = file.previewUrl;
  } else if (isImageMimeOrExt && file.dataUrl) {
    src = file.dataUrl;
  } else if (isSvg && file.textContent && file.textContent.includes('<svg')) {
    src = `data:image/svg+xml;utf8,${encodeURIComponent(file.textContent)}`;
  }

  const formatBadge =
    ext && /^(JPG|JPEG|PNG|WEBP|GIF|SVG|BMP|AVIF|ICO|TIFF)$/.test(ext)
      ? ext === 'JPG'
        ? 'JPEG'
        : ext
      : file.mimeType.startsWith('image/')
      ? file.mimeType.replace('image/', '').replace('+xml', '').toUpperCase()
      : 'IMAGE';

  return {
    isImage: isImageMimeOrExt && Boolean(src),
    src,
    formatBadge,
  };
}

/**
 * Tokenizes a single line of pretty-printed JSON for clean readable syntax coloring.
 */
function renderHighlightedJsonLine(line: string): React.ReactNode {
  const keyValueMatch = line.match(/^(\s*)(".*?")(\s*:\s*)(.*)$/);
  if (keyValueMatch) {
    const [, indent, keyPart, colonPart, valuePart] = keyValueMatch;
    return (
      <>
        <span>{indent}</span>
        <span className="text-sky-300 font-semibold">{keyPart}</span>
        <span className="text-slate-400">{colonPart}</span>
        {renderJsonValueToken(valuePart)}
      </>
    );
  }
  return renderJsonValueToken(line);
}

function renderJsonValueToken(rawVal: string): React.ReactNode {
  const trimmed = rawVal.trim();
  if (!trimmed) return rawVal;

  const hasTrailingComma = trimmed.endsWith(',');
  const core = hasTrailingComma ? trimmed.slice(0, -1) : trimmed;
  const leadingSpaces = rawVal.match(/^\s*/)?.[0] || '';

  if (core.startsWith('"') && core.endsWith('"')) {
    return (
      <>
        <span>{leadingSpaces}</span>
        <span className="text-emerald-300">{core}</span>
        {hasTrailingComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(core)) {
    return (
      <>
        <span>{leadingSpaces}</span>
        <span className="text-amber-300">{core}</span>
        {hasTrailingComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  if (/^(true|false|null)$/.test(core)) {
    return (
      <>
        <span>{leadingSpaces}</span>
        <span className="text-purple-300 font-semibold">{core}</span>
        {hasTrailingComma && <span className="text-slate-400">,</span>}
      </>
    );
  }
  return <span className="text-slate-200">{rawVal}</span>;
}

/**
 * Parses simple CSV/TSV text into rows and columns for table preview.
 */
function parseDelimitedText(text: string, delimiter = ','): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.slice(0, 100).map((line) => {
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

/**
 * Lightweight Markdown line renderer for clean formatted specification sheets.
 */
function renderMarkdownPreview(lines: { lineNumber: number; content: string }[]): React.ReactNode {
  return (
    <div className="p-4 space-y-2 font-sans text-slate-200">
      {lines.map(({ lineNumber, content }) => {
        const trimmed = content.trim();
        if (!trimmed) {
          return <div key={lineNumber} className="h-1.5" />;
        }
        if (trimmed.startsWith('# ')) {
          return (
            <h4
              key={lineNumber}
              className="text-base font-bold text-white tracking-tight pt-1 border-b border-slate-800 pb-1.5"
            >
              {trimmed.slice(2)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <h5 key={lineNumber} className="text-sm font-bold text-sky-300 pt-1">
              {trimmed.slice(3)}
            </h5>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <h6 key={lineNumber} className="text-xs font-bold text-slate-100 uppercase tracking-wider pt-0.5">
              {trimmed.slice(4)}
            </h6>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const itemText = trimmed.slice(2);
          const boldMatch = itemText.match(/^\*\*(.*?)\*\*:\s*(.*)$/);
          return (
            <div key={lineNumber} className="flex items-start gap-2 text-xs leading-relaxed pl-1">
              <span className="text-sky-400 mt-0.5">•</span>
              {boldMatch ? (
                <span>
                  <strong className="text-white font-semibold">{boldMatch[1]}:</strong>{' '}
                  <span className="text-slate-300">{boldMatch[2]}</span>
                </span>
              ) : (
                <span className="text-slate-300">{itemText}</span>
              )}
            </div>
          );
        }
        return (
          <p key={lineNumber} className="text-xs text-slate-300 leading-relaxed">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}

export const FileDetailSheet: React.FC<FileDetailSheetProps> = ({
  file,
  categories,
  activeRoomCode,
  canEdit,
  hasPrev = false,
  hasNext = false,
  onPrevFile,
  onNextFile,
  activeTransfer,
  onDownloadFile,
  onOpenAuthModal,
  onClose,
  onUpdateFile,
  onDeleteFile,
  onAddCategory,
}) => {
  const [pinInput, setPinInput] = useState('');
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinError, setPinError] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [qrMode, setQrMode] = useState<'room-download' | 'direct-stream'>('room-download');
  const [includePinInQr, setIncludePinInQr] = useState(false);
  const [qrExpanded, setQrExpanded] = useState(false);
  const [qrDownloadFeedback, setQrDownloadFeedback] = useState<string | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [editingDate, setEditingDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Inline File Rename & Notes State
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [editingNotes, setEditingNotes] = useState('');

  // Image Preview Controls State
  const [imageFit, setImageFit] = useState<'contain' | 'cover'>('contain');
  const [imageZoom, setImageZoom] = useState<number>(1);
  const [imageBackdrop, setImageBackdrop] = useState<ImageBackdrop>('dark');
  const [imageExpanded, setImageExpanded] = useState<boolean>(false);
  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [activeDualTab, setActiveDualTab] = useState<'image' | 'text'>('image');

  // Text / JSON Viewer Controls State
  const [textViewMode, setTextViewMode] = useState<TextViewMode>('pretty');
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [textExpanded, setTextExpanded] = useState<boolean>(false);
  const [textSearchQuery, setTextSearchQuery] = useState<string>('');
  const [copiedTextContent, setCopiedTextContent] = useState<boolean>(false);

  useEffect(() => {
    if (file) {
      setPinInput('');
      setPinUnlocked(!file.pinProtected);
      setPinError('');
      setCopiedLink(false);
      setShareFeedback(null);
      setQrMode('room-download');
      setIncludePinInQr(false);
      setQrExpanded(false);
      setQrDownloadFeedback(null);
      setImageLoadFailed(false);
      setCustomCategoryInput('');
      setShowNewCategoryInput(false);
      setEditingDate(file.uploadDate);
      setIsEditingMeta(false);
      setEditingName(file.name);
      setEditingNotes(file.notes || '');

      // Reset image viewer state
      setImageFit('contain');
      setImageZoom(1);
      setImageBackdrop('dark');
      setImageExpanded(false);
      setImageDimensions(null);
      setActiveDualTab('image');

      // Reset text viewer state
      setTextSearchQuery('');
      setCopiedTextContent(false);
      setTextExpanded(false);
      setShowLineNumbers(true);
      setWordWrap(true);

      const isCsv =
        file.mimeType === 'text/csv' || /\.(csv|tsv)$/i.test(file.name);
      const isMd =
        file.mimeType === 'text/markdown' || /\.(md|markdown)$/i.test(file.name);
      setTextViewMode(isCsv ? 'table' : isMd ? 'reader' : 'pretty');
    }
  }, [file]);

  // Keyboard shortcuts for Escape and Left/Right navigation
  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        onClose();
      } else if (!isInputFocused && e.key === 'ArrowLeft' && hasPrev && onPrevFile) {
        e.preventDefault();
        onPrevFile();
      } else if (!isInputFocused && e.key === 'ArrowRight' && hasNext && onNextFile) {
        e.preventDefault();
        onNextFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, hasPrev, hasNext, onPrevFile, onNextFile, onClose]);

  const resolvedText = useMemo(
    () => (file ? resolveTextContent(file) : undefined),
    [file]
  );

  const imageInfo = useMemo(
    () =>
      file
        ? resolveImageSource(file)
        : { isImage: false, src: undefined, formatBadge: 'IMAGE' },
    [file]
  );

  // Determine if text content is JSON, CSV, Markdown, or general text/code
  const textAnalysis = useMemo(() => {
    if (!file || !resolvedText) {
      return {
        hasText: false,
        isJson: false,
        isCsv: false,
        isMarkdown: false,
        formatLabel: 'TEXT',
        parsedJson: null as unknown,
        jsonError: null as string | null,
        prettyJson: '',
        minifiedJson: '',
        jsonKeyCount: 0,
        csvRows: [] as string[][],
      };
    }

    const trimmed = resolvedText.trim();
    const looksLikeJson =
      file.mimeType === 'application/json' ||
      file.mimeType.endsWith('+json') ||
      /\.json$/i.test(file.name) ||
      ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']')));

    let parsedJson: unknown = null;
    let jsonError: string | null = null;
    let prettyJson = resolvedText;
    let minifiedJson = resolvedText;
    let jsonKeyCount = 0;
    let isJson = false;

    if (looksLikeJson) {
      isJson = true;
      try {
        parsedJson = JSON.parse(trimmed);
        prettyJson = JSON.stringify(parsedJson, null, 2);
        minifiedJson = JSON.stringify(parsedJson);
        if (Array.isArray(parsedJson)) {
          jsonKeyCount = parsedJson.length;
        } else if (parsedJson && typeof parsedJson === 'object') {
          jsonKeyCount = Object.keys(parsedJson as Record<string, unknown>).length;
        }
      } catch (err) {
        jsonError = err instanceof Error ? err.message : 'Invalid JSON syntax';
      }
    }

    const isCsv =
      !isJson &&
      (file.mimeType === 'text/csv' || /\.(csv|tsv)$/i.test(file.name));
    const csvDelimiter = /\.tsv$/i.test(file.name) ? '\t' : ',';
    const csvRows = isCsv ? parseDelimitedText(resolvedText, csvDelimiter) : [];

    const isMarkdown =
      !isJson &&
      !isCsv &&
      (file.mimeType === 'text/markdown' || /\.(md|markdown)$/i.test(file.name));

    const extMatch = file.name.match(/\.([a-z0-9]+)$/i);
    const extUpper = extMatch ? extMatch[1].toUpperCase() : '';

    const formatLabel = isJson
      ? 'JSON'
      : isCsv
      ? extUpper || 'CSV'
      : isMarkdown
      ? 'MARKDOWN'
      : extUpper || 'TEXT';

    return {
      hasText: true,
      isJson,
      isCsv,
      isMarkdown,
      formatLabel,
      parsedJson,
      jsonError,
      prettyJson,
      minifiedJson,
      jsonKeyCount,
      csvRows,
    };
  }, [file, resolvedText]);

  const backdropClasses: Record<ImageBackdrop, string> = {
    dark: 'bg-slate-950',
    light: 'bg-slate-100',
    grid: 'bg-slate-900 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:14px_14px]',
  };

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          key="file-detail-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/55 backdrop-blur-sm p-0 md:p-4"
          onClick={onClose}
        >
          <motion.div
            key="file-detail-sheet"
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-2xl bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 max-h-sheet flex flex-col overflow-hidden shadow-2xl shadow-slate-950/20"
            onClick={(e) => e.stopPropagation()}
          >
            {(() => {
              const isAudio =
                file.mimeType.startsWith('audio/') ||
                Boolean(file.dataUrl && file.dataUrl.startsWith('data:audio/'));

              const hasBothImageAndText =
                imageInfo.isImage && !imageLoadFailed && textAnalysis.hasText;

              const displayedText =
                textAnalysis.isJson && !textAnalysis.jsonError
                  ? textViewMode === 'raw'
                    ? textAnalysis.minifiedJson
                    : textAnalysis.prettyJson
                  : resolvedText || '';

              const allLines = displayedText.split(/\r?\n/);
              const normalizedQuery = textSearchQuery.trim().toLowerCase();
              const filteredLinesWithIndex = allLines
                .map((line, idx) => ({ lineNumber: idx + 1, content: line }))
                .filter((item) =>
                  normalizedQuery
                    ? item.content.toLowerCase().includes(normalizedQuery)
                    : true
                );

              const effectiveRoomCode = activeRoomCode || file.roomCode || '842-910';
              const shareUrl = buildFileQrPayloadUrl({
                fileId: file.id,
                roomCode: effectiveRoomCode,
                mode: qrMode,
                pin:
                  file.pinProtected && pinUnlocked && includePinInQr && pinInput
                    ? pinInput
                    : undefined,
              });

              const triggerQrFeedback = (label: string) => {
                setQrDownloadFeedback(label);
                setTimeout(() => {
                  setQrDownloadFeedback((prev) => (prev === label ? null : prev));
                }, 2400);
              };

              const handleDownloadQrPng = async () => {
                try {
                  await downloadFileQrPng({
                    value: shareUrl,
                    fileName: file.name,
                    category: file.category,
                    sizeLabel: formatBytes(file.size),
                    roomCode: effectiveRoomCode,
                    includeCardFooter: true,
                  });
                  triggerQrFeedback('Saved QR PNG');
                } catch {
                  triggerQrFeedback('QR Export Failed');
                }
              };

              const handleDownloadQrSvg = () => {
                try {
                  downloadFileQrSvg({
                    value: shareUrl,
                    fileName: file.name,
                    category: file.category,
                    sizeLabel: formatBytes(file.size),
                    roomCode: effectiveRoomCode,
                  });
                  triggerQrFeedback('Saved QR SVG');
                } catch {
                  triggerQrFeedback('SVG Export Failed');
                }
              };

              const handleUnlockPin = async (e: React.FormEvent) => {
                e.preventDefault();
                setPinError('');
                try {
                  const res = await fetch(`/api/files/${file.id}/verify-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pin: pinInput }),
                  });
                  const data = await res.json();
                  if (res.ok && data.valid) {
                    setPinUnlocked(true);
                  } else {
                    setPinError(
                      data.error || 'Incorrect PIN code. Try 2026 for demo file.'
                    );
                  }
                } catch {
                  setPinError('Could not verify PIN code.');
                }
              };

              const handleDownload = () => {
                if (onDownloadFile) {
                  onDownloadFile(file, file.pinProtected ? pinInput : undefined);
                  return;
                }
                const pinParam = file.pinProtected
                  ? `?pin=${encodeURIComponent(pinInput)}`
                  : '';
                const link = document.createElement('a');
                link.href = `/api/files/${file.id}/download${pinParam}`;
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              };

              const handleCopyShareLink = async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                } catch {
                  setCopiedLink(true);
                }
              };

              const triggerShareFeedback = (label: string) => {
                setShareFeedback(label);
                setTimeout(() => {
                  setShareFeedback((prev) => (prev === label ? null : prev));
                }, 2400);
              };

              const buildShareableFileObject = async (): Promise<File | null> => {
                if (!pinUnlocked) return null;
                try {
                  if (file.dataUrl && file.dataUrl.startsWith('data:')) {
                    const commaIdx = file.dataUrl.indexOf(',');
                    if (commaIdx !== -1) {
                      const header = file.dataUrl.slice(0, commaIdx);
                      const body = file.dataUrl.slice(commaIdx + 1);
                      const mimeMatch = header.match(/^data:([^;]+)/);
                      const mimeType =
                        (mimeMatch && mimeMatch[1]) ||
                        file.mimeType ||
                        'application/octet-stream';
                      if (/;base64/i.test(header)) {
                        const binaryStr = window.atob(body);
                        const bytes = new Uint8Array(binaryStr.length);
                        for (let i = 0; i < binaryStr.length; i++) {
                          bytes[i] = binaryStr.charCodeAt(i);
                        }
                        return new File([bytes], file.name, { type: mimeType });
                      } else {
                        const decoded = decodeURIComponent(body);
                        return new File([decoded], file.name, { type: mimeType });
                      }
                    }
                  }

                  if (typeof resolvedText === 'string' && resolvedText.length > 0) {
                    return new File([resolvedText], file.name, {
                      type: file.mimeType || 'text/plain',
                    });
                  }

                  if (imageInfo.src) {
                    const res = await fetch(imageInfo.src);
                    if (res.ok) {
                      const blob = await res.blob();
                      return new File([blob], file.name, {
                        type: blob.type || file.mimeType || 'application/octet-stream',
                      });
                    }
                  }
                } catch {
                  // Ignore file construction errors and fall back to metadata link share
                }
                return null;
              };

              const handleNativeShareFile = async (
                mode: 'auto' | 'link' | 'contents' = 'auto'
              ) => {
                const metadataText = `${file.name} · ${file.category} · ${formatBytes(
                  file.size
                )} · Uploaded ${formatDisplayDate(file.uploadDate)} by ${
                  file.senderName
                } (Room ${file.roomCode})${file.notes ? ` — ${file.notes}` : ''}`;

                if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                  try {
                    // 1. Attempt to share the actual File contents (or text payload) when requested/supported
                    if ((mode === 'contents' || mode === 'auto') && pinUnlocked) {
                      const shareableFile = await buildShareableFileObject();
                      if (
                        shareableFile &&
                        typeof navigator.canShare === 'function' &&
                        navigator.canShare({ files: [shareableFile] })
                      ) {
                        await navigator.share({
                          files: [shareableFile],
                          title: file.name,
                          text: metadataText,
                        });
                        triggerShareFeedback('Shared File');
                        return;
                      }

                      if (mode === 'contents' && resolvedText) {
                        await navigator.share({
                          title: file.name,
                          text: `${metadataText}\n\n${resolvedText.slice(0, 4000)}`,
                          url: shareUrl,
                        });
                        triggerShareFeedback('Shared Contents');
                        return;
                      }
                    }

                    // 2. Share file metadata link via native Web Share API
                    await navigator.share({
                      title: file.name,
                      text: metadataText,
                      url: shareUrl,
                    });
                    triggerShareFeedback('Shared Link');
                    return;
                  } catch (err) {
                    if (err instanceof Error && err.name === 'AbortError') {
                      return;
                    }
                    // Fall through to clipboard fallback if share API rejects in current context
                  }
                }

                // Fallback when Web Share API is unavailable on desktop browsers
                if (mode === 'contents' && pinUnlocked && resolvedText) {
                  try {
                    await navigator.clipboard.writeText(resolvedText);
                    triggerShareFeedback('Copied Contents');
                    return;
                  } catch {
                    // Fall through to link copy
                  }
                }

                await handleCopyShareLink();
                triggerShareFeedback('Copied Link');
              };

              const handleCopyTextContent = async () => {
                if (!displayedText) return;
                try {
                  await navigator.clipboard.writeText(displayedText);
                  setCopiedTextContent(true);
                  setTimeout(() => setCopiedTextContent(false), 2000);
                } catch {
                  setCopiedTextContent(true);
                }
              };

              const handleCategoryChange = async (newCategory: string) => {
                if (newCategory === file.category) return;
                setIsSaving(true);
                try {
                  await onUpdateFile(file.id, { category: newCategory });
                } finally {
                  setIsSaving(false);
                }
              };

              const handleCreateCustomCategory = async (e: React.FormEvent) => {
                e.preventDefault();
                const trimmed = customCategoryInput.trim();
                if (!trimmed) return;
                setIsSaving(true);
                try {
                  await onAddCategory(trimmed);
                  await onUpdateFile(file.id, { category: trimmed });
                  setCustomCategoryInput('');
                  setShowNewCategoryInput(false);
                } finally {
                  setIsSaving(false);
                }
              };

              const handleDateChange = async (newDate: string) => {
                setEditingDate(newDate);
                if (
                  /^\d{4}-\d{2}-\d{2}$/.test(newDate) &&
                  newDate !== file.uploadDate
                ) {
                  setIsSaving(true);
                  try {
                    await onUpdateFile(file.id, { uploadDate: newDate });
                  } finally {
                    setIsSaving(false);
                  }
                }
              };

              const handleSaveMetaRename = async (e: React.FormEvent) => {
                e.preventDefault();
                const trimmedName = editingName.trim() || file.name;
                setIsSaving(true);
                try {
                  await onUpdateFile(file.id, {
                    name: trimmedName,
                    notes: editingNotes.trim(),
                  });
                  setIsEditingMeta(false);
                } finally {
                  setIsSaving(false);
                }
              };

              return (
                <>
                  {/* Mobile Drag Handle Affordance */}
                  <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 shrink-0 md:hidden" />

                  {/* Sheet Header with Prev/Next Navigation */}
                  <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-100 shrink-0 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900 truncate">
                          {file.name}
                        </h3>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => setIsEditingMeta((v) => !v)}
                            title="Rename file or edit transfer note"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 transition-colors shrink-0"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate mt-0.5">
                        <span className="font-semibold text-slate-700">{file.category}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {formatDisplayDate(file.uploadDate)}
                        </span>
                        {file.pinned && (
                          <>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span className="font-semibold text-amber-700">Pinned</span>
                          </>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={async () => {
                            setIsSaving(true);
                            try {
                              await onUpdateFile(file.id, { pinned: !file.pinned });
                            } finally {
                              setIsSaving(false);
                            }
                          }}
                          aria-label={
                            file.pinned
                              ? `Unpin ${file.name} from top`
                              : `Pin ${file.name} to top`
                          }
                          title={
                            file.pinned ? 'Unpin file from top' : 'Pin file to top of vault'
                          }
                          className={`min-h-[38px] px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors mr-1 ${
                            file.pinned
                              ? 'bg-amber-100 text-amber-900 hover:bg-amber-200/80'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                          }`}
                        >
                          <Pin
                            className={`w-3.5 h-3.5 -rotate-45 ${
                              file.pinned
                                ? 'fill-amber-600 text-amber-600'
                                : 'text-slate-500'
                            }`}
                          />
                          <span className="hidden sm:inline">
                            {file.pinned ? 'Pinned to Top' : 'Pin to Top'}
                          </span>
                        </button>
                      )}
                      {(hasPrev || hasNext) && (
                        <div className="flex items-center bg-slate-100 rounded-xl p-0.5 mr-1">
                          <button
                            type="button"
                            disabled={!hasPrev}
                            onClick={onPrevFile}
                            aria-label="Previous file"
                            title="Previous file (←)"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-white hover:shadow-xs disabled:opacity-35 transition-all"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={!hasNext}
                            onClick={onNextFile}
                            aria-label="Next file"
                            title="Next file (→)"
                            className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-700 hover:bg-white hover:shadow-xs disabled:opacity-35 transition-all"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close file details"
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {/* Scrollable Sheet Content */}
                  <div className="p-4 sm:p-5 overflow-y-auto space-y-5 sm:space-y-6 flex-1">
                    {/* Optional Inline Rename & Notes Editor */}
                    {canEdit && isEditingMeta && (
                      <form
                        onSubmit={handleSaveMetaRename}
                        className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-900">
                            Edit Filename & Transfer Notes
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsEditingMeta(false)}
                            className="text-xs text-slate-500 hover:text-slate-800"
                          >
                            Cancel
                          </button>
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Filename
                          </label>
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                            Transfer Notes
                          </label>
                          <input
                            type="text"
                            value={editingNotes}
                            onChange={(e) => setEditingNotes(e.target.value)}
                            placeholder="Add searchable context note..."
                            className="w-full min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={isSaving}
                            className="min-h-[38px] px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors"
                          >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </form>
                    )}

                    {/* PIN Protection Gate or Preview Surface */}
                    {!pinUnlocked ? (
                      <form
                        onSubmit={handleUnlockPin}
                        className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
                            <Lock className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold text-slate-900">
                              PIN-Protected File Transfer
                            </h4>
                            <p className="text-xs text-slate-600">
                              Enter the 4-digit sender PIN to unlock preview and download.
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
                            className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap"
                          >
                            Unlock File
                          </button>
                        </div>
                        {pinError && (
                          <p className="text-xs font-semibold text-rose-600">{pinError}</p>
                        )}
                      </form>
                    ) : (
                      <div className="space-y-3">
                        {/* Dual Mode Switcher when a file has BOTH Image and Text (e.g. SVG) */}
                        {hasBothImageAndText && (
                          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 w-fit">
                            <button
                              type="button"
                              onClick={() => setActiveDualTab('image')}
                              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                activeDualTab === 'image'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <ImageIcon className="w-3.5 h-3.5 text-sky-600" />
                              <span>Image Preview</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveDualTab('text')}
                              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                activeDualTab === 'text'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <Code2 className="w-3.5 h-3.5 text-sky-600" />
                              <span>Source Text</span>
                            </button>
                          </div>
                        )}

                        {/* 1. Rich Image Preview for Common Formats */}
                        {imageInfo.isImage &&
                        imageInfo.src &&
                        !imageLoadFailed &&
                        (!hasBothImageAndText || activeDualTab === 'image') ? (
                          <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-slate-950">
                            {/* Image Inspection Toolbar */}
                            <div className="px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                              <div className="flex items-center gap-1.5 min-w-0 font-mono text-[11px]">
                                <span className="text-sky-300 font-semibold">
                                  {imageInfo.formatBadge}
                                </span>
                                {imageDimensions && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-600">·</span>
                                    <span className="tabular-nums text-slate-400">
                                      {imageDimensions.width} × {imageDimensions.height} px
                                    </span>
                                  </>
                                )}
                                <span className="hidden sm:inline text-slate-600" aria-hidden="true">·</span>
                                <span className="hidden sm:inline text-slate-400 font-sans">
                                  {file.dataUrl ? 'DataURL' : 'Asset Preview'}
                                </span>
                              </div>

                              <div className="flex items-center gap-1">
                                {/* Fit / Fill Toggle */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImageFit((prev) =>
                                      prev === 'contain' ? 'cover' : 'contain'
                                    )
                                  }
                                  title="Toggle Fit vs Fill"
                                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 transition-colors"
                                >
                                  {imageFit === 'contain' ? 'Fit' : 'Fill'}
                                </button>

                                {/* Zoom Controls */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImageZoom((z) =>
                                      Math.max(1, Number((z - 0.5).toFixed(1)))
                                    )
                                  }
                                  disabled={imageZoom <= 1}
                                  aria-label="Zoom out"
                                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                                >
                                  <ZoomOut className="w-3.5 h-3.5" />
                                </button>
                                <span className="px-1.5 font-mono tabular-nums text-[11px] text-slate-300">
                                  {Math.round(imageZoom * 100)}%
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImageZoom((z) =>
                                      Math.min(3, Number((z + 0.5).toFixed(1)))
                                    )
                                  }
                                  disabled={imageZoom >= 3}
                                  aria-label="Zoom in"
                                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 transition-colors"
                                >
                                  <ZoomIn className="w-3.5 h-3.5" />
                                </button>
                                {imageZoom > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => setImageZoom(1)}
                                    aria-label="Reset zoom"
                                    className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Backdrop Switcher for Transparent PNG/WebP/SVG */}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setImageBackdrop((prev) =>
                                      prev === 'dark'
                                        ? 'grid'
                                        : prev === 'grid'
                                        ? 'light'
                                        : 'dark'
                                    )
                                  }
                                  title="Switch canvas backdrop"
                                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-300 capitalize transition-colors"
                                >
                                  {imageBackdrop}
                                </button>

                                {/* Expand Viewport Toggle */}
                                <button
                                  type="button"
                                  onClick={() => setImageExpanded((v) => !v)}
                                  aria-label={
                                    imageExpanded
                                      ? 'Collapse image preview'
                                      : 'Expand image preview'
                                  }
                                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                                >
                                  {imageExpanded ? (
                                    <Minimize2 className="w-3.5 h-3.5" />
                                  ) : (
                                    <Maximize2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* Image Canvas Surface */}
                            <div
                              className={`relative overflow-auto flex items-center justify-center transition-all ${
                                backdropClasses[imageBackdrop]
                              } ${
                                imageExpanded
                                  ? 'min-h-[360px] max-h-[520px]'
                                  : 'aspect-[4/3] max-h-[340px]'
                              }`}
                            >
                              <img
                                src={imageInfo.src}
                                alt={file.name}
                                referrerPolicy="no-referrer"
                                onLoad={(e) =>
                                  setImageDimensions({
                                    width: e.currentTarget.naturalWidth,
                                    height: e.currentTarget.naturalHeight,
                                  })
                                }
                                onError={() => setImageLoadFailed(true)}
                                style={{
                                  transform: `scale(${imageZoom})`,
                                  transformOrigin: 'center center',
                                }}
                                className={`transition-transform duration-150 ${
                                  imageFit === 'contain'
                                    ? 'max-w-full max-h-full object-contain'
                                    : 'w-full h-full object-cover'
                                }`}
                              />
                              {imageZoom === 1 && (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3.5 flex items-end justify-between">
                                  <div className="text-xs text-white/90 truncate pr-2">
                                    <span className="font-semibold">{file.senderName}</span>
                                    <span className="mx-1.5" aria-hidden="true">
                                      ·
                                    </span>
                                    <span>{file.senderDevice}</span>
                                  </div>
                                  <span className="text-xs font-mono tabular-nums text-white/90 shrink-0">
                                    {formatBytes(file.size)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : isAudio && file.dataUrl ? (
                          /* 2. Audio Stream Preview */
                          <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center">
                                <Music className="w-5 h-5" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold truncate">{file.name}</p>
                                <p className="text-xs text-slate-400">
                                  PCM Audio Stream · Ready for playback
                                </p>
                              </div>
                            </div>
                            <audio controls src={file.dataUrl} className="w-full h-10" />
                          </div>
                        ) : textAnalysis.hasText ? (
                          /* 3. Rich Text & JSON Content Viewer */
                          <div className="rounded-2xl border border-slate-200/90 overflow-hidden bg-slate-950 text-slate-100">
                            {/* Text Viewer Top Header & Mode Switcher */}
                            <div className="px-3.5 py-2.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap font-mono text-[11px]">
                                <span className="text-sky-300 font-semibold flex items-center gap-1">
                                  {textAnalysis.isJson ? (
                                    <FileJson className="w-3 h-3" />
                                  ) : textAnalysis.isCsv ? (
                                    <TableIcon className="w-3 h-3" />
                                  ) : (
                                    <FileText className="w-3 h-3" />
                                  )}
                                  <span>{textAnalysis.formatLabel}</span>
                                </span>

                                <span aria-hidden="true" className="text-slate-600">·</span>

                                <span className="tabular-nums text-slate-400">
                                  {allLines.length} {allLines.length === 1 ? 'line' : 'lines'} ·{' '}
                                  {resolvedText?.length.toLocaleString()} chars
                                </span>

                                {textAnalysis.isJson && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-600">·</span>
                                    <span
                                      className={
                                        textAnalysis.jsonError
                                          ? 'text-rose-300 font-semibold'
                                          : 'text-emerald-300 font-semibold'
                                      }
                                    >
                                      {textAnalysis.jsonError
                                        ? 'Invalid JSON'
                                        : `Valid JSON · ${textAnalysis.jsonKeyCount} ${
                                            Array.isArray(textAnalysis.parsedJson)
                                              ? 'items'
                                              : 'keys'
                                          }`}
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* View Mode & Action Buttons */}
                              <div className="flex items-center gap-1 flex-wrap">
                                {textAnalysis.isJson && !textAnalysis.jsonError && (
                                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 mr-1">
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('pretty')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                        textViewMode === 'pretty'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      <Braces className="w-3 h-3" />
                                      <span>Pretty</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('inspector')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                        textViewMode === 'inspector'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      <Eye className="w-3 h-3" />
                                      <span>Keys</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('raw')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                                        textViewMode === 'raw'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      Raw
                                    </button>
                                  </div>
                                )}

                                {textAnalysis.isCsv && (
                                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 mr-1">
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('table')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                        textViewMode === 'table'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      <TableIcon className="w-3 h-3" />
                                      <span>Table</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('pretty')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                                        textViewMode !== 'table'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      Raw Text
                                    </button>
                                  </div>
                                )}

                                {textAnalysis.isMarkdown && (
                                  <div className="flex items-center bg-slate-800 rounded-lg p-0.5 mr-1">
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('reader')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                        textViewMode === 'reader'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      <BookOpen className="w-3 h-3" />
                                      <span>Reader</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setTextViewMode('pretty')}
                                      className={`min-h-[28px] px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition-colors ${
                                        textViewMode !== 'reader'
                                          ? 'bg-sky-600 text-white'
                                          : 'text-slate-300 hover:text-white'
                                      }`}
                                    >
                                      Source
                                    </button>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setShowLineNumbers((v) => !v)}
                                  title="Toggle line numbers"
                                  className={`min-h-[30px] px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                    showLineNumbers
                                      ? 'bg-slate-800 text-sky-300'
                                      : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  <Hash className="w-3 h-3" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setWordWrap((v) => !v)}
                                  title="Toggle word wrap"
                                  className={`min-h-[30px] px-2 py-1 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                                    wordWrap
                                      ? 'bg-slate-800 text-sky-300'
                                      : 'bg-slate-800/50 text-slate-400 hover:text-slate-200'
                                  }`}
                                >
                                  <WrapText className="w-3 h-3" />
                                </button>

                                <button
                                  type="button"
                                  onClick={handleCopyTextContent}
                                  className="min-h-[30px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 flex items-center gap-1 transition-colors"
                                >
                                  {copiedTextContent ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span className="text-emerald-300">Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy</span>
                                    </>
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setTextExpanded((v) => !v)}
                                  aria-label={
                                    textExpanded
                                      ? 'Collapse text viewer'
                                      : 'Expand text viewer'
                                  }
                                  className="min-h-[30px] min-w-[30px] flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
                                >
                                  {textExpanded ? (
                                    <Minimize2 className="w-3.5 h-3.5" />
                                  ) : (
                                    <Maximize2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>

                            {/* In-File Search Filter Bar */}
                            <div className="px-3.5 py-2 bg-slate-900/70 border-b border-slate-800/80 flex items-center gap-2">
                              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <input
                                type="text"
                                value={textSearchQuery}
                                onChange={(e) => setTextSearchQuery(e.target.value)}
                                placeholder="Filter or search within file content..."
                                className="flex-1 bg-transparent text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none font-mono"
                              />
                              {normalizedQuery && (
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[11px] font-mono tabular-nums text-sky-400">
                                    {filteredLinesWithIndex.length}{' '}
                                    {filteredLinesWithIndex.length === 1 ? 'line' : 'lines'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => setTextSearchQuery('')}
                                    className="text-[11px] text-slate-400 hover:text-white"
                                  >
                                    Clear
                                  </button>
                                </div>
                              )}
                            </div>

                            {/* Text / JSON / CSV / Markdown Body Surface */}
                            <div
                              className={`overflow-auto font-mono text-xs leading-relaxed transition-all ${
                                textExpanded ? 'max-h-[420px]' : 'max-h-64'
                              }`}
                            >
                              {/* Mode A: JSON Structured Key-Value Inspector */}
                              {textAnalysis.isJson &&
                              !textAnalysis.jsonError &&
                              textViewMode === 'inspector' &&
                              textAnalysis.parsedJson &&
                              typeof textAnalysis.parsedJson === 'object' ? (
                                <div className="p-3.5 space-y-2">
                                  {Object.entries(
                                    textAnalysis.parsedJson as Record<string, unknown>
                                  )
                                    .filter(([k, v]) => {
                                      if (!normalizedQuery) return true;
                                      return (
                                        k.toLowerCase().includes(normalizedQuery) ||
                                        JSON.stringify(v)
                                          .toLowerCase()
                                          .includes(normalizedQuery)
                                      );
                                    })
                                    .map(([key, val]) => (
                                      <div
                                        key={key}
                                        className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col sm:flex-row sm:items-start justify-between gap-2"
                                      >
                                        <span className="text-sky-300 font-semibold shrink-0">
                                          "{key}"
                                        </span>
                                        <pre className="text-slate-200 text-xs whitespace-pre-wrap break-all sm:text-right font-mono">
                                          {typeof val === 'object' && val !== null
                                            ? JSON.stringify(val, null, 2)
                                            : JSON.stringify(val)}
                                        </pre>
                                      </div>
                                    ))}
                                </div>
                              ) : textAnalysis.isCsv &&
                                textViewMode === 'table' &&
                                textAnalysis.csvRows.length > 0 ? (
                                /* Mode B: CSV Structured Table Preview */
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                      <tr className="bg-slate-900 border-b border-slate-800 text-sky-300">
                                        {textAnalysis.csvRows[0].map((header, hIdx) => (
                                          <th
                                            key={hIdx}
                                            className="py-2 px-3 font-semibold whitespace-nowrap border-r border-slate-800/60 last:border-r-0"
                                          >
                                            {header}
                                          </th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-800/70">
                                      {textAnalysis.csvRows
                                        .slice(1)
                                        .filter((row) =>
                                          normalizedQuery
                                            ? row.some((cell) =>
                                                cell
                                                  .toLowerCase()
                                                  .includes(normalizedQuery)
                                              )
                                            : true
                                        )
                                        .map((row, rIdx) => (
                                          <tr
                                            key={rIdx}
                                            className="hover:bg-slate-900/60 transition-colors"
                                          >
                                            {row.map((cell, cIdx) => (
                                              <td
                                                key={cIdx}
                                                className="py-2 px-3 text-slate-200 whitespace-nowrap border-r border-slate-800/40 last:border-r-0"
                                              >
                                                {cell}
                                              </td>
                                            ))}
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : textAnalysis.isMarkdown && textViewMode === 'reader' ? (
                                /* Mode C: Formatted Markdown Reader View */
                                renderMarkdownPreview(filteredLinesWithIndex)
                              ) : (
                                /* Mode D: Line-Numbered Code / Pretty JSON / Text Viewer */
                                <div className="py-2.5 px-3">
                                  {filteredLinesWithIndex.length === 0 ? (
                                    <p className="text-xs text-slate-500 py-4 text-center">
                                      No lines match "{textSearchQuery}"
                                    </p>
                                  ) : (
                                    filteredLinesWithIndex.map(
                                      ({ lineNumber, content }) => (
                                        <div
                                          key={lineNumber}
                                          className="flex items-baseline hover:bg-slate-900/60 rounded px-1"
                                        >
                                          {showLineNumbers && (
                                            <span className="w-8 shrink-0 select-none text-right pr-3 text-[11px] text-slate-600 font-mono tabular-nums">
                                              {lineNumber}
                                            </span>
                                          )}
                                          <span
                                            className={`flex-1 ${
                                              wordWrap
                                                ? 'whitespace-pre-wrap break-words'
                                                : 'whitespace-pre'
                                            }`}
                                          >
                                            {textAnalysis.isJson &&
                                            !textAnalysis.jsonError &&
                                            textViewMode === 'pretty'
                                              ? renderHighlightedJsonLine(content)
                                              : content || ' '}
                                          </span>
                                        </div>
                                      )
                                    )
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* 4. Fallback File Summary Banner */
                          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 flex items-center gap-4">
                            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center shrink-0">
                              {imageInfo.isImage ? (
                                <ImageIcon className="w-6 h-6 text-sky-300" />
                              ) : file.category === 'Archives & Code' ? (
                                <Code2 className="w-6 h-6 text-sky-300" />
                              ) : (
                                <FileText className="w-6 h-6 text-sky-300" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{file.name}</p>
                              <p className="text-xs text-slate-300 mt-0.5">
                                {file.mimeType} · {formatBytes(file.size)} · Shared by{' '}
                                {file.senderName}
                              </p>
                            </div>
                          </div>
                        )}

                        {file.notes && (
                          <p className="text-sm text-slate-600 leading-relaxed">
                            {file.notes}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Categorize File Controls */}
                    <div className="space-y-2.5 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-900">
                          Assigned Category{' '}
                          {isSaving && (
                            <span className="text-sky-600 font-normal ml-1">
                              (Saving...)
                            </span>
                          )}
                        </label>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setShowNewCategoryInput((v) => !v)}
                            className="min-h-[40px] px-2.5 text-xs font-semibold text-sky-700 hover:text-sky-800 flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>
                              {showNewCategoryInput ? 'Cancel' : 'New Category'}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenAuthModal();
                            }}
                            className="min-h-[36px] px-2.5 text-xs font-semibold text-amber-700 hover:text-amber-800 flex items-center gap-1 whitespace-nowrap"
                          >
                            <Lock className="w-3.5 h-3.5" />
                            <span>Owner / Admin Required to Edit</span>
                          </button>
                        )}
                      </div>

                      {canEdit && showNewCategoryInput && (
                        <form
                          onSubmit={handleCreateCustomCategory}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            value={customCategoryInput}
                            onChange={(e) => setCustomCategoryInput(e.target.value)}
                            placeholder="Enter custom category name..."
                            className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                          />
                          <button
                            type="submit"
                            className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors whitespace-nowrap"
                          >
                            Save & Assign
                          </button>
                        </form>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {categories.map((cat) => {
                          const active = file.category === cat;
                          return (
                            <button
                              key={cat}
                              type="button"
                              disabled={!canEdit}
                              onClick={() => canEdit && handleCategoryChange(cat)}
                              className={`min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 interactive-press ${
                                active
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50'
                              }`}
                            >
                              {active && <Check className="w-3.5 h-3.5 text-sky-400" />}
                              <span>{cat}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Upload Date & Metadata Inspection */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                      <div>
                        <label
                          htmlFor="detail-upload-date"
                          className="block text-xs font-semibold text-slate-900 mb-1.5"
                        >
                          Upload Date (YYYY-MM-DD)
                        </label>
                        <input
                          id="detail-upload-date"
                          type="date"
                          disabled={!canEdit}
                          value={editingDate}
                          onChange={(e) => canEdit && handleDateChange(e.target.value)}
                          className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums text-slate-900 disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-sky-600"
                        />
                      </div>

                      <div>
                        <span className="block text-xs font-semibold text-slate-900 mb-1.5">
                          Transfer Provenance
                        </span>
                        <div className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-50 flex flex-col justify-center text-xs text-slate-600">
                          <div className="truncate">
                            <span className="font-semibold text-slate-900">
                              {file.senderName}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <span>{file.senderDevice}</span>
                          </div>
                          <div className="font-mono tabular-nums text-[11px] text-slate-500 mt-0.5">
                            Room {file.roomCode} · {file.downloads} downloads
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Instant File QR Code Generator, Download & Native Web Share API Actions */}
                    <div className="pt-4 border-t border-slate-100 space-y-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <QrCode className="w-3.5 h-3.5 text-sky-600" />
                            <span>File QR Code for Room {effectiveRoomCode}</span>
                          </p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            Generate and download a scannable QR code so peers in Room {effectiveRoomCode} can scan and download this file immediately.
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {(qrDownloadFeedback || shareFeedback) && (
                            <span className="text-[11px] font-mono font-semibold text-emerald-700 mr-1">
                              {qrDownloadFeedback || shareFeedback}
                            </span>
                          )}
                          <div className="flex items-center p-0.5 rounded-xl bg-slate-100">
                            <button
                              type="button"
                              onClick={() => setQrMode('room-download')}
                              className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                qrMode === 'room-download'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Room + Auto-Download
                            </button>
                            <button
                              type="button"
                              onClick={() => setQrMode('direct-stream')}
                              className={`min-h-[30px] px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                                qrMode === 'direct-stream'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              Direct File Stream
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-center gap-4">
                        <div className="flex flex-col items-center gap-2 shrink-0">
                          <QrMatrixSvg value={shareUrl} size={qrExpanded ? 200 : 124} />
                          <button
                            type="button"
                            onClick={() => setQrExpanded((v) => !v)}
                            className="text-[11px] font-semibold text-sky-700 hover:text-sky-800 flex items-center gap-1"
                          >
                            {qrExpanded ? (
                              <>
                                <Minimize2 className="w-3 h-3" />
                                <span>Compact QR Size</span>
                              </>
                            ) : (
                              <>
                                <Maximize2 className="w-3 h-3" />
                                <span>Enlarge for Room Scan</span>
                              </>
                            )}
                          </button>
                        </div>

                        <div className="flex-1 space-y-3 w-full min-w-0">
                          {/* Download QR Code Buttons (PNG Card & Vector SVG) */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={handleDownloadQrPng}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap interactive-press"
                            >
                              <Download className="w-3.5 h-3.5 text-sky-400" />
                              <span>Download QR (PNG)</span>
                            </button>

                            <button
                              type="button"
                              onClick={handleDownloadQrSvg}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                            >
                              <QrCode className="w-3.5 h-3.5 text-sky-600" />
                              <span>Download QR (SVG)</span>
                            </button>

                            {file.pinProtected && pinUnlocked && pinInput && (
                              <button
                                type="button"
                                onClick={() => setIncludePinInQr((v) => !v)}
                                className={`min-h-[42px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-colors whitespace-nowrap ${
                                  includePinInQr
                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                <Lock className="w-3.5 h-3.5 text-amber-600" />
                                <span>
                                  {includePinInQr ? 'PIN Embedded in QR' : 'Include Unlock PIN'}
                                </span>
                              </button>
                            )}
                          </div>

                          {/* Encoded QR URL & Copy Control */}
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              readOnly
                              value={shareUrl}
                              aria-label="Encoded File QR URL"
                              className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-mono text-slate-700 truncate"
                            />
                            <button
                              type="button"
                              onClick={handleCopyShareLink}
                              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                            >
                              {copiedLink ? (
                                <Check className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                              <span>{copiedLink ? 'Copied' : 'Copy URL'}</span>
                            </button>
                          </div>

                          {/* Native Web Share API Actions */}
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleNativeShareFile('link')}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                            >
                              <Share2 className="w-3.5 h-3.5 text-sky-600" />
                              <span>Share Metadata Link</span>
                            </button>

                            <button
                              type="button"
                              disabled={!pinUnlocked}
                              onClick={() => handleNativeShareFile('contents')}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 disabled:opacity-50 text-sky-900 border border-sky-200/80 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                            >
                              <Share2 className="w-3.5 h-3.5 text-sky-600" />
                              <span>Share File Contents</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sticky Sheet Footer Actions + Real-Time Download/Upload Progress Bar */}
                  <div className="p-3.5 sm:p-4 pb-safe border-t border-slate-100 bg-white space-y-3 shrink-0">
                    {activeTransfer && (
                      <TransferProgressBar transfer={activeTransfer} compact />
                    )}
                    <div className="flex items-center gap-2.5 sm:gap-3">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => onDeleteFile(file.id)}
                          aria-label="Delete shared file"
                          className="min-h-[48px] px-3.5 sm:px-4 rounded-xl border border-slate-200 text-rose-600 hover:bg-rose-50 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="hidden sm:inline">Remove</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onOpenAuthModal();
                          }}
                          className="min-h-[48px] px-3.5 sm:px-4 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-100 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                        >
                          <Lock className="w-3.5 h-3.5 text-amber-600" />
                          <span className="hidden sm:inline">Permissions</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleNativeShareFile('auto')}
                        aria-label={`Share ${file.name} via native Web Share API`}
                        className="min-h-[48px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap interactive-press"
                      >
                        {shareFeedback ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Share2 className="w-4 h-4 text-sky-400" />
                        )}
                        <span>{shareFeedback || 'Share'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={
                          !pinUnlocked ||
                          (activeTransfer?.status === 'transferring' &&
                            activeTransfer?.direction === 'download')
                        }
                        onClick={handleDownload}
                        className="flex-1 min-h-[48px] px-4 sm:px-5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap interactive-press"
                      >
                        <Download className="w-4 h-4" />
                        <span>
                          {activeTransfer?.status === 'transferring' &&
                          activeTransfer?.direction === 'download'
                            ? `Downloading... ${Math.round(activeTransfer.percentage)}%`
                            : `Download (${formatBytes(file.size)})`}
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              );
            })()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
