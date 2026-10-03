import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  FileDown,
  Printer,
  X,
  FileText,
  Image as ImageIcon,
  Music,
  Code2,
  FileSpreadsheet,
  Lock,
  Pin,
  Check,
  FolderOpen,
} from 'lucide-react';
import {
  SharedFile,
  formatBytes,
  formatDisplayDate,
  getTodayIsoDate,
} from '../types/files';
import { resolveImageSource } from './FileDetailSheet';
import { getCategoryColor } from './StorageByCategoryChart';

export interface VaultPdfReportModalProps {
  isOpen: boolean;
  files: SharedFile[];
  roomCode: string;
  selectedCategory: string;
  searchQuery: string;
  dateFilterLabel: string;
  onClose: () => void;
  onExportSuccess?: (fileName: string) => void;
}

export interface CategorizedReportGroup {
  category: string;
  color: string;
  files: SharedFile[];
  totalBytes: number;
  sharePercent: number;
  imageCount: number;
}

function loadThumbnailImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => resolve(null), 2200);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Packs an array of rendered A4 JPEG page data URLs into a valid multi-page PDF 1.4 binary Blob.
 */
function buildPdfBlobFromJpegPages(
  pages: { dataUrl: string; widthPx: number; heightPx: number }[]
): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // object 0 is free
  let currentOffset = 0;

  const pushString = (str: string) => {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    currentOffset += bytes.byteLength;
  };

  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    currentOffset += bytes.byteLength;
  };

  const startObject = (objId: number) => {
    offsets[objId] = currentOffset;
    pushString(`${objId} 0 obj\n`);
  };

  const endObject = () => {
    pushString('\nendobj\n');
  };

  // PDF 1.4 Header
  pushString('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  // Object 1: Catalog
  // Object 2: Pages
  // For each page i (0..N-1):
  //   pageObjId = 3 + i * 3
  //   contentObjId = 4 + i * 3
  //   imageObjId = 5 + i * 3
  const pageCount = pages.length;
  const pageObjIds: number[] = [];

  for (let i = 0; i < pageCount; i++) {
    pageObjIds.push(3 + i * 3);
  }

  // Object 1: Catalog
  startObject(1);
  pushString('<< /Type /Catalog /Pages 2 0 R >>');
  endObject();

  // Object 2: Pages root
  startObject(2);
  const kidsRef = pageObjIds.map((id) => `${id} 0 R`).join(' ');
  pushString(`<< /Type /Pages /Kids [ ${kidsRef} ] /Count ${pageCount} >>`);
  endObject();

  // Standard A4 dimensions in PDF points (72 dpi): 595.28 x 841.89
  const pageWidthPt = 595.28;
  const pageHeightPt = 841.89;

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const pageObjId = 3 + i * 3;
    const contentObjId = 4 + i * 3;
    const imageObjId = 5 + i * 3;
    const imgName = `/Im${i + 1}`;

    const base64Data = page.dataUrl.split(',')[1] || '';
    const jpegBytes = base64ToUint8Array(base64Data);

    // Page Object
    startObject(pageObjId);
    pushString(
      `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pageWidthPt.toFixed(
        2
      )} ${pageHeightPt.toFixed(
        2
      )} ] /Resources << /XObject << ${imgName} ${imageObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );
    endObject();

    // Content Stream Object (draws the full-page JPEG onto the A4 page)
    const contentStream = `q\n${pageWidthPt.toFixed(
      2
    )} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n${imgName} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);
    startObject(contentObjId);
    pushString(`<< /Length ${contentBytes.byteLength} >>\nstream\n`);
    pushBytes(contentBytes);
    pushString('\nendstream');
    endObject();

    // Image XObject (DCTDecode JPEG)
    startObject(imageObjId);
    pushString(
      `<< /Type /XObject /Subtype /Image /Width ${page.widthPx} /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`
    );
    pushBytes(jpegBytes);
    pushString('\nendstream');
    endObject();
  }

  // Cross-reference table (xref)
  const totalObjects = 2 + pageCount * 3 + 1;
  const xrefOffset = currentOffset;
  pushString(`xref\n0 ${totalObjects}\n`);
  pushString('0000000000 65535 f \n');
  for (let objId = 1; objId < totalObjects; objId++) {
    const off = String(offsets[objId] || 0).padStart(10, '0');
    pushString(`${off} 00000 n \n`);
  }

  // Trailer
  pushString(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

export function buildCategorizedReportGroups(
  files: SharedFile[]
): CategorizedReportGroup[] {
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
  const map = new Map<string, SharedFile[]>();

  for (const file of files) {
    const cat = file.category || 'Uncategorized';
    const existing = map.get(cat) || [];
    existing.push(file);
    map.set(cat, existing);
  }

  const groups: CategorizedReportGroup[] = [];
  let idx = 0;
  for (const [category, catFiles] of map.entries()) {
    const catBytes = catFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    const sharePercent =
      totalBytes > 0 ? Math.round((catBytes / totalBytes) * 1000) / 10 : 0;
    const imageCount = catFiles.filter((f) => {
      const res = resolveImageSource(f);
      return res.isImage && Boolean(res.src);
    }).length;

    groups.push({
      category,
      color: getCategoryColor(category, idx++),
      files: catFiles,
      totalBytes: catBytes,
      sharePercent,
      imageCount,
    });
  }

  // Sort categories by total storage descending so top space categories lead the report
  groups.sort(
    (a, b) => b.totalBytes - a.totalBytes || b.files.length - a.files.length
  );
  return groups;
}

/**
 * Generates and downloads a multi-page categorized PDF report of the supplied files,
 * complete with embedded image thumbnails rendered on A4 pages.
 */
export async function generateAndDownloadVaultPdf(params: {
  files: SharedFile[];
  roomCode: string;
  selectedCategory: string;
  searchQuery: string;
  dateFilterLabel: string;
}): Promise<string> {
  const { files, roomCode, selectedCategory, searchQuery, dateFilterLabel } =
    params;
  const groups = buildCategorizedReportGroups(files);
  const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

  // Preload image thumbnails for any image files in the view
  const thumbnailMap = new Map<string, HTMLImageElement>();
  await Promise.all(
    files.map(async (f) => {
      const imgRes = resolveImageSource(f);
      if (imgRes.isImage && imgRes.src) {
        const loaded = await loadThumbnailImage(imgRes.src);
        if (loaded) {
          thumbnailMap.set(f.id, loaded);
        }
      }
    })
  );

  // Render A4 pages at 1240 x 1754 px
  const pageWidth = 1240;
  const pageHeight = 1754;
  const marginX = 72;
  const contentWidth = pageWidth - marginX * 2;
  const renderedPages: { dataUrl: string; widthPx: number; heightPx: number }[] =
    [];

  let canvas = document.createElement('canvas');
  canvas.width = pageWidth;
  canvas.height = pageHeight;
  let ctx = canvas.getContext('2d')!;
  let cursorY = 0;
  let pageNumber = 1;

  const drawPageBackgroundAndHeader = (isFirstPage: boolean) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, pageWidth, pageHeight);

    // Top dark slate report banner
    const bannerHeight = isFirstPage ? 176 : 104;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, pageWidth, bannerHeight);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px Plus Jakarta Sans, sans-serif';
    ctx.fillText(
      `RELAYDROP VAULT · CATEGORIZED PDF REPORT · ROOM ${roomCode}`,
      marginX,
      46
    );

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px Plus Jakarta Sans, sans-serif';
    ctx.fillText(
      isFirstPage
        ? 'Categorized File Vault Report'
        : `Categorized File Vault Report (Page ${pageNumber})`,
      marginX,
      90
    );

    if (isFirstPage) {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '20px JetBrains Mono, monospace';
      const filterDesc = `Category: ${selectedCategory} · Search: ${
        searchQuery.trim() || 'All'
      } · Date: ${dateFilterLabel}`;
      ctx.fillText(filterDesc.slice(0, 88), marginX, 128);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '18px JetBrains Mono, monospace';
      ctx.fillText(
        `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${
          files.length
        } files (${formatBytes(totalBytes)}) across ${groups.length} ${
          groups.length === 1 ? 'category' : 'categories'
        }`,
        marginX,
        156
      );
    }

    // Footer
    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px JetBrains Mono, monospace';
    ctx.fillText(
      `RelayDrop Room ${roomCode} · Categorized Vault Inventory · Page ${pageNumber}`,
      marginX,
      pageHeight - 34
    );

    cursorY = bannerHeight + 36;
  };

  const commitCurrentPageAndStartNew = () => {
    renderedPages.push({
      dataUrl: canvas.toDataURL('image/jpeg', 0.92),
      widthPx: pageWidth,
      heightPx: pageHeight,
    });
    canvas = document.createElement('canvas');
    canvas.width = pageWidth;
    canvas.height = pageHeight;
    ctx = canvas.getContext('2d')!;
    pageNumber += 1;
    drawPageBackgroundAndHeader(false);
  };

  drawPageBackgroundAndHeader(true);

  for (const group of groups) {
    if (cursorY + 160 > pageHeight - 80) {
      commitCurrentPageAndStartNew();
    }

    // Category Section Header Bar
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(marginX, cursorY, contentWidth, 54);
    ctx.fillStyle = group.color;
    ctx.fillRect(marginX, cursorY, 8, 54);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 23px Plus Jakarta Sans, sans-serif';
    ctx.fillText(group.category, marginX + 24, cursorY + 35);

    ctx.fillStyle = '#475569';
    ctx.font = 'bold 19px JetBrains Mono, monospace';
    const rightSummary = `${group.files.length} ${
      group.files.length === 1 ? 'file' : 'files'
    } · ${formatBytes(group.totalBytes)} (${group.sharePercent}%)`;
    const summaryWidth = ctx.measureText(rightSummary).width;
    ctx.fillText(
      rightSummary,
      marginX + contentWidth - summaryWidth - 18,
      cursorY + 35
    );

    cursorY += 66;

    // Draw each file row in this category
    for (const file of group.files) {
      const thumbImg = thumbnailMap.get(file.id);
      const imgInfo = resolveImageSource(file);
      const isImageFile = imgInfo.isImage && Boolean(imgInfo.src);
      const rowHeight = isImageFile ? 104 : 78;

      if (cursorY + rowHeight > pageHeight - 80) {
        commitCurrentPageAndStartNew();
      }

      // Row background & subtle bottom divider
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(marginX, cursorY, contentWidth, rowHeight);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(marginX, cursorY + rowHeight);
      ctx.lineTo(marginX + contentWidth, cursorY + rowHeight);
      ctx.stroke();

      let textStartX = marginX + 16;

      // Draw Image Thumbnail if available
      if (isImageFile) {
        const thumbSize = 76;
        const thumbX = marginX + 12;
        const thumbY = cursorY + 14;

        ctx.fillStyle = '#0f172a';
        ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);

        if (thumbImg) {
          try {
            ctx.drawImage(thumbImg, thumbX, thumbY, thumbSize, thumbSize);
          } catch {
            // Fallback label if CORS taints canvas
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 15px JetBrains Mono, monospace';
            ctx.fillText('IMG', thumbX + 22, thumbY + 44);
          }
        } else {
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 15px JetBrains Mono, monospace';
          ctx.fillText('IMG', thumbX + 22, thumbY + 44);
        }

        textStartX = thumbX + thumbSize + 20;
      }

      // File Name
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 21px Plus Jakarta Sans, sans-serif';
      const flags = [
        file.pinned ? '[PINNED]' : '',
        file.pinProtected ? '[PIN LOCK]' : '',
      ]
        .filter(Boolean)
        .join(' ');
      const displayTitle = flags ? `${file.name}  ${flags}` : file.name;
      ctx.fillText(displayTitle.slice(0, 62), textStartX, cursorY + 32);

      // File Metadata Line
      ctx.fillStyle = '#475569';
      ctx.font = '17px JetBrains Mono, monospace';
      const metaLine = `${formatBytes(file.size)} · ${file.mimeType} · Uploaded ${
        file.uploadDate
      } by ${file.senderName} (${file.senderDevice})`;
      ctx.fillText(metaLine.slice(0, 82), textStartX, cursorY + 58);

      // Optional notes line
      if (file.notes) {
        ctx.fillStyle = '#64748b';
        ctx.font = '16px Plus Jakarta Sans, sans-serif';
        ctx.fillText(
          `Note: ${file.notes}`.slice(0, 88),
          textStartX,
          cursorY + (isImageFile ? 82 : 73)
        );
      }

      cursorY += rowHeight;
    }

    cursorY += 24;
  }

  renderedPages.push({
    dataUrl: canvas.toDataURL('image/jpeg', 0.92),
    widthPx: pageWidth,
    heightPx: pageHeight,
  });

  let pdfBlob: Blob;
  try {
    pdfBlob = buildPdfBlobFromJpegPages(renderedPages);
  } catch {
    // Fallback if canvas serialization encountered cross-origin taint
    const fallbackText = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF`;
    pdfBlob = new Blob([fallbackText], { type: 'application/pdf' });
  }

  const safeRoom = (roomCode || 'vault').replace(/[^a-zA-Z0-9_-]/g, '-');
  const fileName = `relaydrop-vault-report-${safeRoom}-${getTodayIsoDate()}.pdf`;
  const url = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  return fileName;
}

function getFileTypeBadgeIcon(file: SharedFile) {
  const lower = (file.name || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(lower)) {
    return <ImageIcon className="w-4 h-4 text-sky-600" />;
  }
  if (mime.startsWith('audio/') || /\.(wav|mp3|m4a|flac)$/i.test(lower)) {
    return <Music className="w-4 h-4 text-amber-600" />;
  }
  if (mime.includes('csv') || /\.(csv|xlsx|xls)$/i.test(lower)) {
    return <FileSpreadsheet className="w-4 h-4 text-teal-600" />;
  }
  if (
    mime.includes('json') ||
    mime.includes('zip') ||
    /\.(json|ts|tsx|js|py|zip|tar)$/i.test(lower)
  ) {
    return <Code2 className="w-4 h-4 text-indigo-600" />;
  }
  return <FileText className="w-4 h-4 text-slate-700" />;
}

export const VaultPdfReportModal: React.FC<VaultPdfReportModalProps> = ({
  isOpen,
  files,
  roomCode,
  selectedCategory,
  searchQuery,
  dateFilterLabel,
  onClose,
  onExportSuccess,
}) => {
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [lastExportedName, setLastExportedName] = useState<string | null>(null);

  const reportGroups = useMemo(
    () => buildCategorizedReportGroups(files),
    [files]
  );

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.size || 0), 0),
    [files]
  );

  const totalImages = useMemo(
    () =>
      files.filter((f) => {
        const res = resolveImageSource(f);
        return res.isImage && Boolean(res.src);
      }).length,
    [files]
  );

  const handleTriggerPdfDownload = async () => {
    if (isGeneratingPdf || files.length === 0) return;
    setIsGeneratingPdf(true);
    try {
      const exportedFile = await generateAndDownloadVaultPdf({
        files,
        roomCode,
        selectedCategory,
        searchQuery,
        dateFilterLabel,
      });
      setLastExportedName(exportedFile);
      if (onExportSuccess) {
        onExportSuccess(exportedFile);
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="vault-pdf-report-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-2 sm:p-6 overflow-y-auto"
          onClick={onClose}
        >
          <motion.div
            key="vault-pdf-report-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Printable Categorized Vault PDF Report"
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-4xl bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
          >
            {/* Top Action Toolbar */}
            <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                  <FileDown className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-bold text-white truncate">
                    Export Vault to PDF · Printable Categorized Report
                  </h2>
                  <p className="text-xs text-slate-400 truncate font-mono tabular-nums">
                    Room {roomCode} · {files.length}{' '}
                    {files.length === 1 ? 'file' : 'files'} in current view ·{' '}
                    {totalImages} image{' '}
                    {totalImages === 1 ? 'thumbnail' : 'thumbnails'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                >
                  <Printer className="w-3.5 h-3.5 text-sky-300" />
                  <span>Print Report</span>
                </button>

                <button
                  type="button"
                  disabled={isGeneratingPdf || files.length === 0}
                  onClick={handleTriggerPdfDownload}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                >
                  <FileDown className="w-4 h-4" />
                  <span>
                    {isGeneratingPdf ? 'Generating PDF...' : 'Download PDF (.pdf)'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close PDF report preview"
                  className="min-h-[40px] min-w-[40px] rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Confirmation Banner when PDF is generated */}
            {lastExportedName && (
              <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-200/80 flex items-center justify-between gap-2 text-xs text-emerald-900 shrink-0">
                <div className="flex items-center gap-2 font-semibold">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Exported PDF report:{' '}
                    <span className="font-mono">{lastExportedName}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleTriggerPdfDownload}
                  className="text-emerald-800 hover:text-emerald-950 font-semibold underline underline-offset-4"
                >
                  Download Again
                </button>
              </div>
            )}

            {/* Printable Categorized Report Document Body */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-8 space-y-6 bg-white">
              {/* Printable Report Document Header */}
              <div className="pb-5 border-b-2 border-slate-900 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-mono font-semibold text-sky-700">
                    RelayDrop P2P Categorized Vault Inventory
                  </p>
                  <h3 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Categorized File Report — Room {roomCode}
                  </h3>
                  <p className="text-xs text-slate-600">
                    <span>Category Filter: {selectedCategory}</span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      Search Query: {searchQuery.trim() ? `"${searchQuery.trim()}"` : 'None'}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>Date Scope: {dateFilterLabel}</span>
                  </p>
                </div>

                <div className="text-left sm:text-right font-mono tabular-nums space-y-0.5 shrink-0">
                  <p className="text-sm font-bold text-slate-900">
                    {files.length} {files.length === 1 ? 'File' : 'Files'} ·{' '}
                    {formatBytes(totalBytes)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {reportGroups.length}{' '}
                    {reportGroups.length === 1 ? 'Category' : 'Categories'} ·{' '}
                    {totalImages} Image{' '}
                    {totalImages === 1 ? 'Thumbnail' : 'Thumbnails'}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Report Date: {getTodayIsoDate()}
                  </p>
                </div>
              </div>

              {/* Categorized Sections */}
              {reportGroups.length === 0 ? (
                <div className="py-12 text-center space-y-2">
                  <FolderOpen className="w-8 h-8 text-slate-400 mx-auto" />
                  <p className="text-sm font-semibold text-slate-800">
                    No files match the current view
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {reportGroups.map((group) => (
                    <section
                      key={group.category}
                      aria-label={`Category report section: ${group.category}`}
                      className="rounded-2xl border border-slate-200/90 overflow-hidden"
                    >
                      {/* Category Header */}
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: group.color }}
                            aria-hidden="true"
                          />
                          <h4 className="text-sm font-bold text-slate-900">
                            {group.category}
                          </h4>
                          <span className="text-xs text-slate-500 font-mono tabular-nums">
                            · {group.files.length}{' '}
                            {group.files.length === 1 ? 'file' : 'files'}
                          </span>
                        </div>

                        <div className="text-xs font-mono tabular-nums text-slate-700 font-semibold">
                          {formatBytes(group.totalBytes)} ({group.sharePercent}% of view)
                        </div>
                      </div>

                      {/* Files Table / Cards with Image Thumbnails */}
                      <div className="divide-y divide-slate-100">
                        {group.files.map((file) => {
                          const imgInfo = resolveImageSource(file);
                          const imageSrc =
                            imgInfo.isImage && imgInfo.src
                              ? imgInfo.src
                              : undefined;
                          return (
                            <div
                              key={file.id}
                              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white"
                            >
                              <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                                {/* Image Thumbnail or File Type Icon */}
                                {imageSrc ? (
                                  <div className="w-16 h-16 rounded-xl bg-slate-900 border border-slate-200 overflow-hidden shrink-0 flex items-center justify-center">
                                    <img
                                      src={imageSrc}
                                      alt={`Thumbnail for ${file.name}`}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                                    {getFileTypeBadgeIcon(file)}
                                  </div>
                                )}

                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="text-sm font-bold text-slate-900 truncate">
                                      {file.name}
                                    </p>
                                    {file.pinned && (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                        <Pin className="w-3 h-3 -rotate-45 fill-amber-500 text-amber-600" />
                                        <span>Pinned</span>
                                      </span>
                                    )}
                                    {file.pinProtected && (
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                        <Lock className="w-3 h-3 text-amber-600" />
                                        <span>PIN Protected</span>
                                      </span>
                                    )}
                                  </div>

                                  <p className="text-xs text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                    <span className="font-mono tabular-nums font-semibold text-slate-700">
                                      {formatBytes(file.size)}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono">{file.mimeType}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>Uploaded {formatDisplayDate(file.uploadDate)}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>
                                      Shared by {file.senderName} ({file.senderDevice})
                                    </span>
                                  </p>

                                  {file.notes && (
                                    <p className="text-xs text-slate-600 italic">
                                      "{file.notes}"
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="text-left sm:text-right font-mono tabular-nums text-xs text-slate-500 shrink-0">
                                <p className="font-semibold text-slate-800">
                                  {file.category}
                                </p>
                                <p>{file.downloads} downloads</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
