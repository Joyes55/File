import React, { useMemo } from 'react';
import QRCode from 'qrcode';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export const QR_QUALITY_LABELS: Record<QrErrorCorrectionLevel, string> = {
  L: 'Low',
  M: 'Medium',
  Q: 'Quartile',
  H: 'High',
};

export interface FileQrPayloadOptions {
  fileId: string;
  roomCode?: string;
  mode?: 'room-download' | 'direct-stream';
  pin?: string;
}

export function buildFileQrPayloadUrl({
  fileId,
  roomCode,
  mode = 'room-download',
  pin,
}: FileQrPayloadOptions): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'https://relaydrop.local';

  if (mode === 'direct-stream') {
    const pinSuffix = pin ? `?pin=${encodeURIComponent(pin)}` : '';
    return `${origin}/api/files/${encodeURIComponent(fileId)}/download${pinSuffix}`;
  }

  const params = new URLSearchParams();
  if (roomCode && roomCode.trim()) {
    params.set('room', roomCode.trim());
  }
  params.set('file', fileId);
  params.set('download', '1');
  if (pin && pin.trim()) {
    params.set('pin', pin.trim());
  }
  return `${origin}/?${params.toString()}`;
}

export interface DownloadFileQrOptions {
  value: string;
  fileName: string;
  category?: string;
  sizeLabel?: string;
  roomCode?: string;
  includeCardFooter?: boolean;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  includeLogo?: boolean;
  backgroundColor?: string;
}

function sanitizeFileSlug(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  return (
    base
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'shared-file'
  );
}

/**
 * Renders a high-contrast, jsQR-compatible PNG QR code card onto an HTMLCanvasElement.
 */
export function renderFileQrPngCanvas({
  value,
  fileName,
  category,
  sizeLabel,
  roomCode,
  includeCardFooter = true,
  errorCorrectionLevel = 'M',
  includeLogo = false,
  backgroundColor = '#ffffff',
}: DownloadFileQrOptions): HTMLCanvasElement {
  const effectiveEcc: QrErrorCorrectionLevel =
    includeLogo && (errorCorrectionLevel === 'L' || errorCorrectionLevel === 'M')
      ? 'H'
      : errorCorrectionLevel;
  const qr = QRCode.create(value || 'https://relaydrop.local', {
    errorCorrectionLevel: effectiveEcc,
  });
  const count = qr.modules.size;
  const data = qr.modules.data;

  const quietZoneModules = 5;
  const totalModules = count + quietZoneModules * 2;
  const modulePixelSize = Math.max(12, Math.floor(720 / totalModules));
  const qrSquareSize = totalModules * modulePixelSize;
  const footerHeight = includeCardFooter ? 136 : 0;

  const canvas = document.createElement('canvas');
  canvas.width = qrSquareSize;
  canvas.height = qrSquareSize + footerHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  // 1. Card background fill
  ctx.fillStyle = backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Integer-aligned dark modules for 100% reliable optical & jsQR decoding
  ctx.fillStyle = '#0f172a';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (data[r * count + c]) {
        const x = (c + quietZoneModules) * modulePixelSize;
        const y = (r + quietZoneModules) * modulePixelSize;
        ctx.fillRect(x, y, modulePixelSize, modulePixelSize);
      }
    }
  }

  // 2b. Optional centered RelayDrop emblem (sized within Reed-Solomon recovery budget)
  if (includeLogo) {
    const center = qrSquareSize / 2;
    const badgeOuter = Math.round(qrSquareSize * 0.16);
    const badgeInner = Math.round(badgeOuter * 0.82);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      center - badgeOuter / 2,
      center - badgeOuter / 2,
      badgeOuter,
      badgeOuter
    );

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(
      center - badgeInner / 2,
      center - badgeInner / 2,
      badgeInner,
      badgeInner
    );

    ctx.fillStyle = '#38bdf8';
    ctx.font = `bold ${Math.round(badgeInner * 0.45)}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('RD', center, center);
    ctx.textBaseline = 'alphabetic';
  }

  // 3. Clean metadata footer below the quiet zone
  if (includeCardFooter) {
    const dividerY = qrSquareSize - 4;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(40, dividerY);
    ctx.lineTo(canvas.width - 40, dividerY);
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 24px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    const truncatedName =
      fileName.length > 38 ? `${fileName.slice(0, 35)}...` : fileName;
    ctx.fillText(truncatedName, canvas.width / 2, qrSquareSize + 38);

    const metaParts = [
      roomCode ? `Room ${roomCode}` : null,
      category || null,
      sizeLabel || null,
    ].filter(Boolean);

    ctx.fillStyle = '#0284c7';
    ctx.font = '600 18px "JetBrains Mono", monospace';
    ctx.fillText(metaParts.join('  ·  '), canvas.width / 2, qrSquareSize + 74);

    ctx.fillStyle = '#64748b';
    ctx.font = '500 15px "Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'RelayDrop — Scan in pairing room to download file immediately',
      canvas.width / 2,
      qrSquareSize + 108
    );
  }

  return canvas;
}

/**
 * Renders a high-contrast, jsQR-compatible PNG QR code card and triggers a browser file download.
 */
export async function downloadFileQrPng(options: DownloadFileQrOptions): Promise<string> {
  const canvas = renderFileQrPngCanvas(options);
  const dataUrl = canvas.toDataURL('image/png');
  const downloadName = `relaydrop-qr-${sanitizeFileSlug(options.fileName)}.png`;

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return dataUrl;
}

/**
 * Shares a file's direct download link or rendered QR code PNG image using the Web Share API,
 * with graceful fallback to clipboard/download when Web Share is unavailable.
 */
export async function shareFileQrViaWebShare(
  options: DownloadFileQrOptions & {
    shareTarget?: 'auto' | 'link' | 'qr-image';
  }
): Promise<'shared-image' | 'shared-link' | 'copied-link' | 'aborted'> {
  const {
    value,
    fileName,
    category,
    sizeLabel,
    roomCode,
    shareTarget = 'auto',
  } = options;

  const shareTitle = `RelayDrop QR · ${fileName}`;
  const shareText = [
    fileName,
    category ? `Category: ${category}` : null,
    sizeLabel ? `Size: ${sizeLabel}` : null,
    roomCode ? `Room ${roomCode}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      if (shareTarget === 'qr-image' || shareTarget === 'auto') {
        const canvas = renderFileQrPngCanvas(options);
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/png')
        );
        if (blob) {
          const qrFile = new File(
            [blob],
            `relaydrop-qr-${sanitizeFileSlug(fileName)}.png`,
            { type: 'image/png' }
          );
          if (
            typeof navigator.canShare !== 'function' ||
            navigator.canShare({ files: [qrFile] })
          ) {
            await navigator.share({
              files: [qrFile],
              title: shareTitle,
              text: shareText,
              url: value,
            });
            return 'shared-image';
          }
        }
      }

      await navigator.share({
        title: shareTitle,
        text: shareText,
        url: value,
      });
      return 'shared-link';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return 'aborted';
      }
      // Fall through to clipboard fallback
    }
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Ignore clipboard error
    }
  }
  return 'copied-link';
}

/**
 * Generates a standalone vector SVG QR code for a specific file and triggers a browser download.
 */
export function downloadFileQrSvg({
  value,
  fileName,
  roomCode,
  sizeLabel,
  errorCorrectionLevel = 'M',
  backgroundColor = '#ffffff',
}: DownloadFileQrOptions): void {
  const qr = QRCode.create(value || 'https://relaydrop.local', {
    errorCorrectionLevel,
  });
  const count = qr.modules.size;
  const data = qr.modules.data;
  const quietZone = 4;
  const viewBoxWidth = count + quietZone * 2;
  const footerUnits = 6;
  const viewBoxHeight = viewBoxWidth + footerUnits;

  const rects: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (data[r * count + c]) {
        rects.push(
          `<rect x="${c + quietZone}" y="${r + quietZone}" width="0.96" height="0.96" rx="0.1" fill="#0f172a" />`
        );
      }
    }
  }

  const safeLabel = fileName
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const subLabel = [roomCode ? `Room ${roomCode}` : null, sizeLabel || null]
    .filter(Boolean)
    .join(' · ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');

  const bgColor = backgroundColor || '#ffffff';
  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" width="640" height="${Math.round(
    (640 * viewBoxHeight) / viewBoxWidth
  )}">
  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="${bgColor}" />
  ${rects.join('\n  ')}
  <text x="${
    viewBoxWidth / 2
  }" y="${viewBoxWidth + 2.2}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="1.4" font-weight="700" fill="#0f172a">${safeLabel}</text>
  <text x="${
    viewBoxWidth / 2
  }" y="${viewBoxWidth + 4.3}" text-anchor="middle" font-family="monospace" font-size="1.1" font-weight="600" fill="#0284c7">${subLabel}</text>
</svg>`;

  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `relaydrop-qr-${sanitizeFileSlug(fileName)}.svg`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Renders the 4x6" QR Index Card design onto a high-resolution canvas and packages it into a valid PDF 1.4 document.
 */
export function downloadFileQrCardPdf({
  value,
  fileName,
  category = 'Vault File',
  sizeLabel = '—',
  roomCode = '842-910',
  senderName = 'RelayDrop Peer',
  labelTemplate = 'Detailed',
  errorCorrectionLevel = 'M',
  includeLogo = false,
  backgroundColor = '#ffffff',
  cornerRadius = 0,
}: DownloadFileQrOptions & {
  senderName?: string;
  labelTemplate?: 'Minimalist' | 'Detailed' | 'Compact';
  cornerRadius?: number;
}): void {
  const widthPx = 800;
  const heightPx = 1200; // 4:6 ratio
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Card background + outer border
  ctx.fillStyle = backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 6;
  if (cornerRadius > 0 && typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(28, 28, widthPx - 56, heightPx - 56, Math.min(cornerRadius * 2.2, 88));
    ctx.stroke();
  } else {
    ctx.strokeRect(28, 28, widthPx - 56, heightPx - 56);
  }

  // Header
  ctx.fillStyle = '#0284c7';
  ctx.font = '700 20px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    labelTemplate === 'Minimalist'
      ? 'RELAYDROP · MINIMALIST QR CARD'
      : `RELAYDROP · 4×6" INDEX CARD (${labelTemplate.toUpperCase()})`,
    60,
    82
  );

  if (labelTemplate !== 'Minimalist') {
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 28px system-ui, -apple-system, sans-serif';
    ctx.fillText('Instant P2P File Transfer Card', 60, 120);
  }

  // Room badge
  const roomText = `ROOM ${roomCode}`;
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(widthPx - 230, 58, 170, 48);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(roomText, widthPx - 145, 90);

  // Header divider
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(60, 148);
  ctx.lineTo(widthPx - 60, 148);
  ctx.stroke();

  // Render QR code in center
  const qrCanvas = renderFileQrPngCanvas({
    value,
    fileName,
    category,
    sizeLabel,
    roomCode,
    errorCorrectionLevel,
    includeLogo,
  });
  const qrSize = labelTemplate === 'Compact' ? 480 : 560;
  const qrX = Math.round((widthPx - qrSize) / 2);
  const qrY = 180;
  ctx.drawImage(qrCanvas, 0, 0, qrCanvas.width, qrCanvas.width, qrX, qrY, qrSize, qrSize);

  // Caption under QR
  ctx.fillStyle = '#475569';
  ctx.font = '600 18px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    `SCAN TO DOWNLOAD · TEMPLATE: ${labelTemplate.toUpperCase()} · ECC: ${errorCorrectionLevel}`,
    widthPx / 2,
    qrY + qrSize + 40
  );

  // Footer divider
  const footerTop = 840;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(60, footerTop);
  ctx.lineTo(widthPx - 60, footerTop);
  ctx.stroke();

  // File name
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 32px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const truncatedTitle =
    fileName.length > 36 ? `${fileName.slice(0, 34)}…` : fileName;
  ctx.fillText(truncatedTitle, 60, footerTop + 56);

  if (labelTemplate !== 'Minimalist') {
    ctx.fillStyle = '#334155';
    ctx.font = '600 22px monospace';
    ctx.fillText(`Category: ${category}`, 60, footerTop + 112);
    ctx.fillText(`Size:     ${sizeLabel}`, 60, footerTop + 154);
    ctx.fillText(`Sender:   ${senderName}`, 60, footerTop + 196);
    ctx.fillText(`Format:   4×6 in PDF Card (${labelTemplate})`, 60, footerTop + 238);
  }

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const base64Data = jpegDataUrl.split(',')[1] || '';
  const binary = atob(base64Data);
  const jpegBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    jpegBytes[i] = binary.charCodeAt(i);
  }

  // Build single-page 4x6" PDF 1.4 (288pt x 432pt)
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
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

  pushString('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  startObject(1);
  pushString('<< /Type /Catalog /Pages 2 0 R >>');
  endObject();

  startObject(2);
  pushString('<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >>');
  endObject();

  const pageWidthPt = 288; // 4 inches * 72 pt/in
  const pageHeightPt = 432; // 6 inches * 72 pt/in

  startObject(3);
  pushString(
    `<< /Type /Page /Parent 2 0 R /MediaBox [ 0 0 ${pageWidthPt} ${pageHeightPt} ] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>`
  );
  endObject();

  const contentStream = `q\n${pageWidthPt} 0 0 ${pageHeightPt} 0 0 cm\n/Im1 Do\nQ\n`;
  const contentBytes = encoder.encode(contentStream);
  startObject(4);
  pushString(`<< /Length ${contentBytes.byteLength} >>\nstream\n`);
  pushBytes(contentBytes);
  pushString('\nendstream');
  endObject();

  startObject(5);
  pushString(
    `<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.byteLength} >>\nstream\n`
  );
  pushBytes(jpegBytes);
  pushString('\nendstream');
  endObject();

  const xrefStart = currentOffset;
  const totalObjects = 6;
  pushString(`xref\n0 ${totalObjects}\n`);
  pushString('0000000000 65535 f \n');
  for (let objId = 1; objId < totalObjects; objId++) {
    const paddedOffset = String(offsets[objId] || 0).padStart(10, '0');
    pushString(`${paddedOffset} 00000 n \n`);
  }
  pushString(
    `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  const pdfBlob = new Blob(chunks as BlobPart[], { type: 'application/pdf' });
  const pdfUrl = URL.createObjectURL(pdfBlob);
  const link = document.createElement('a');
  link.href = pdfUrl;
  link.download = `relaydrop-qr-card-${sanitizeFileSlug(fileName)}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(pdfUrl), 4000);
}

export interface PrintFileQrOptions {
  value: string;
  fileName: string;
  category?: string;
  sizeLabel?: string;
  roomCode?: string;
  senderName?: string;
  uploadDate?: string;
  encrypted?: boolean;
  encryptionFingerprint?: string;
  pinProtected?: boolean;
  notes?: string;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  includeLogo?: boolean;
  backgroundColor?: string;
  cornerRadius?: number;
}

function escapeHtmlText(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Prepares and mounts the 4x6 inch index card print stylesheet and printable card DOM node.
 */
export function prepareQrIndexCardPrintSheet({
  value,
  fileName,
  category = 'Vault File',
  sizeLabel = '—',
  roomCode = '742-881',
  senderName = 'RelayDrop Peer',
  uploadDate,
  encrypted,
  encryptionFingerprint,
  pinProtected,
  errorCorrectionLevel = 'M',
  backgroundColor = '#ffffff',
  cornerRadius = 0,
}: PrintFileQrOptions): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const qr = QRCode.create(value || 'https://relaydrop.local', {
    errorCorrectionLevel,
  });
  const count = qr.modules.size;
  const data = qr.modules.data;
  const quietZone = 2;
  const viewBoxSize = count + quietZone * 2;

  const rects: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (data[r * count + c]) {
        rects.push(
          `<rect x="${c + quietZone}" y="${r + quietZone}" width="0.96" height="0.96" rx="0.1" fill="#0f172a" />`
        );
      }
    }
  }

  let styleEl = document.getElementById(
    'relaydrop-qr-4x6-print-style'
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'relaydrop-qr-4x6-print-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    @page {
      size: 4in 6in;
      margin: 0;
    }
  `;

  let sheetEl = document.getElementById(
    'relaydrop-qr-4x6-print-card'
  ) as HTMLDivElement | null;
  if (!sheetEl) {
    sheetEl = document.createElement('div');
    sheetEl.id = 'relaydrop-qr-4x6-print-card';
    sheetEl.className = 'qr-print-4x6-sheet';
    sheetEl.setAttribute('data-card-size', '4x6');
    sheetEl.setAttribute('aria-label', 'Printable 4x6 inch QR index card');
    document.body.appendChild(sheetEl);
  }

  const securityLabel = encrypted
    ? `E2EE AES-256-GCM${encryptionFingerprint ? ` (${encryptionFingerprint})` : ''}`
    : pinProtected
    ? 'PIN Protected Transfer'
    : 'Direct Room Verified';

  const dateDisplay = uploadDate || new Date().toISOString().slice(0, 10);
  const cardBg = escapeHtmlText(backgroundColor || '#ffffff');
  const cardRadius = typeof cornerRadius === 'number' ? cornerRadius : 0;

  sheetEl.innerHTML = `
    <div style="background-color: ${cardBg}; border-radius: ${cardRadius}px;" class="w-full h-full border-2 border-slate-900 p-3.5 flex flex-col justify-between text-slate-900 font-sans">
      <!-- Top 4x6 Index Card Ruled Header -->
      <div class="border-b-2 border-slate-900 pb-2 flex items-center justify-between gap-2">
        <div>
          <div class="text-[9px] font-mono font-bold uppercase tracking-widest text-sky-700">
            RELAYDROP · 4×6" INDEX CARD
          </div>
          <div class="text-xs font-bold text-slate-900 tracking-tight">
            Instant P2P File Transfer Card
          </div>
        </div>
        <div class="px-2 py-1 rounded-md bg-slate-900 text-white font-mono text-[11px] font-bold">
          ROOM ${escapeHtmlText(roomCode)}
        </div>
      </div>

      <!-- Centered Scannable Optical QR Matrix -->
      <div class="my-auto py-2 flex flex-col items-center justify-center">
        <div class="p-2.5 rounded-xl border-2 border-slate-900 bg-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"
            width="216"
            height="216"
            role="img"
            aria-label="Printable 4x6 QR Code Matrix"
          >
            <rect x="0" y="0" width="${viewBoxSize}" height="${viewBoxSize}" fill="#ffffff" />
            ${rects.join('')}
          </svg>
        </div>
        <div class="mt-1.5 text-[10px] font-mono font-semibold text-slate-600 uppercase tracking-wider">
          Scan with Camera or RelayDrop QR Scanner
        </div>
      </div>

      <!-- Ruled Index Card File Metadata Table -->
      <div class="border-t-2 border-slate-900 pt-2 space-y-1.5">
        <div class="text-xs font-bold text-slate-900 leading-snug break-all line-clamp-2">
          ${escapeHtmlText(fileName)}
        </div>

        <div class="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] border-t border-slate-200 pt-1.5">
          <div>
            <span class="font-mono uppercase text-slate-500">Category:</span>
            <span class="font-semibold text-slate-900 ml-1">${escapeHtmlText(category)}</span>
          </div>
          <div>
            <span class="font-mono uppercase text-slate-500">Size:</span>
            <span class="font-mono font-semibold text-slate-900 ml-1">${escapeHtmlText(sizeLabel)}</span>
          </div>
          <div>
            <span class="font-mono uppercase text-slate-500">Sender:</span>
            <span class="font-semibold text-slate-900 ml-1">${escapeHtmlText(senderName)}</span>
          </div>
          <div>
            <span class="font-mono uppercase text-slate-500">Date:</span>
            <span class="font-mono text-slate-900 ml-1">${escapeHtmlText(dateDisplay)}</span>
          </div>
        </div>

        <div class="flex items-center justify-between text-[9px] font-mono border-t border-slate-200 pt-1 text-slate-600">
          <span>Security: <strong class="text-slate-900">${escapeHtmlText(securityLabel)}</strong></span>
          <span>Format: 4in × 6in</span>
        </div>

        <div class="text-[8px] font-mono text-slate-500 truncate pt-0.5">
          ${escapeHtmlText(value)}
        </div>
      </div>
    </div>
  `;

  return sheetEl;
}

/**
 * Cleans up the 4x6 index card print mode attributes so standard page printing is unaffected.
 */
export function clearQrIndexCardPrintMode(): void {
  if (typeof document === 'undefined') return;
  document.body.removeAttribute('data-print-mode');
  const styleEl = document.getElementById('relaydrop-qr-4x6-print-style');
  if (styleEl) {
    styleEl.textContent = '';
  }
}

/**
 * Formats the generated QR card for a standard 4x6 inch index card size and directly triggers
 * the browser print dialog (window.print).
 */
export function printFileQrIndexCard(options: PrintFileQrOptions): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  prepareQrIndexCardPrintSheet(options);
  document.body.setAttribute('data-print-mode', 'qr-4x6');

  const handleAfterPrint = () => {
    window.removeEventListener('afterprint', handleAfterPrint);
  };
  window.addEventListener('afterprint', handleAfterPrint);

  window.print();
}

function buildSingleBatchCardHtml(
  item: PrintFileQrOptions,
  index: number,
  total: number
): string {
  const qr = QRCode.create(item.value || 'https://relaydrop.local', {
    errorCorrectionLevel: 'M',
  });
  const count = qr.modules.size;
  const data = qr.modules.data;
  const quietZone = 2;
  const viewBoxSize = count + quietZone * 2;

  const rects: string[] = [];
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (data[r * count + c]) {
        rects.push(
          `<rect x="${c + quietZone}" y="${r + quietZone}" width="0.96" height="0.96" rx="0.1" fill="#0f172a" />`
        );
      }
    }
  }

  const securityLabel = item.encrypted
    ? `E2EE AES-256${item.encryptionFingerprint ? ` (${item.encryptionFingerprint})` : ''}`
    : item.pinProtected
    ? 'PIN Protected'
    : 'Room Verified';
  const dateDisplay = item.uploadDate || new Date().toISOString().slice(0, 10);
  const roomDisplay = item.roomCode || '742-881';

  return `
    <div class="qr-batch-index-card-item border-2 border-slate-900 rounded-xl p-3 flex flex-col justify-between bg-white text-slate-900 font-sans" data-card-size="4x6" data-batch-card-index="${index + 1}">
      <!-- Index Card Header -->
      <div class="border-b-2 border-slate-900 pb-1.5 flex items-center justify-between gap-2">
        <div>
          <div class="text-[8px] font-mono font-bold uppercase tracking-widest text-sky-700">
            RELAYDROP · 4×6" INDEX CARD (${index + 1} OF ${total})
          </div>
          <div class="text-[11px] font-bold text-slate-900 tracking-tight">
            Instant P2P File Transfer Card
          </div>
        </div>
        <div class="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] font-bold shrink-0">
          ROOM ${escapeHtmlText(roomDisplay)}
        </div>
      </div>

      <!-- Centered Optical QR Matrix -->
      <div class="my-2 flex flex-col items-center justify-center">
        <div class="p-2 rounded-lg border-2 border-slate-900 bg-white">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 ${viewBoxSize} ${viewBoxSize}"
            width="148"
            height="148"
            role="img"
            aria-label="Printable QR Code Matrix for ${escapeHtmlText(item.fileName)}"
          >
            <rect x="0" y="0" width="${viewBoxSize}" height="${viewBoxSize}" fill="#ffffff" />
            ${rects.join('')}
          </svg>
        </div>
        <div class="mt-1 text-[9px] font-mono font-semibold text-slate-600 uppercase tracking-wider">
          Scan to Join Room ${escapeHtmlText(roomDisplay)} &amp; Download
        </div>
      </div>

      <!-- Ruled Index Card File Metadata -->
      <div class="border-t-2 border-slate-900 pt-1.5 space-y-1">
        <div class="text-[11px] font-bold text-slate-900 leading-snug break-all line-clamp-1">
          ${escapeHtmlText(item.fileName)}
        </div>
        <div class="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] border-t border-slate-200 pt-1">
          <div class="truncate">
            <span class="font-mono uppercase text-slate-500">Category:</span>
            <span class="font-semibold text-slate-900 ml-1">${escapeHtmlText(item.category || 'Vault File')}</span>
          </div>
          <div class="truncate">
            <span class="font-mono uppercase text-slate-500">Size:</span>
            <span class="font-mono font-semibold text-slate-900 ml-1">${escapeHtmlText(item.sizeLabel || '—')}</span>
          </div>
          <div class="truncate">
            <span class="font-mono uppercase text-slate-500">Sender:</span>
            <span class="font-semibold text-slate-900 ml-1">${escapeHtmlText(item.senderName || 'RelayDrop Peer')}</span>
          </div>
          <div class="truncate">
            <span class="font-mono uppercase text-slate-500">Date:</span>
            <span class="font-mono text-slate-900 ml-1">${escapeHtmlText(dateDisplay)}</span>
          </div>
        </div>
        <div class="flex items-center justify-between text-[8px] font-mono border-t border-slate-200 pt-1 text-slate-600">
          <span>Security: <strong class="text-slate-900">${escapeHtmlText(securityLabel)}</strong></span>
          <span>Card #${index + 1}</span>
        </div>
        <div class="text-[7px] font-mono text-slate-500 truncate">
          ${escapeHtmlText(item.value)}
        </div>
      </div>
    </div>
  `;
}

/**
 * Prepares and mounts a printable multi-card index card sheet with one QR code per selected file.
 */
export function prepareBatchQrIndexCardPrintSheet(
  items: PrintFileQrOptions[],
  roomCode = '742-881'
): HTMLElement | null {
  if (typeof document === 'undefined' || items.length === 0) return null;

  let styleEl = document.getElementById(
    'relaydrop-qr-4x6-print-style'
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'relaydrop-qr-4x6-print-style';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    @page {
      size: letter portrait;
      margin: 0.3in;
    }
  `;

  let batchSheetEl = document.getElementById(
    'relaydrop-qr-batch-print-sheet'
  ) as HTMLDivElement | null;
  if (!batchSheetEl) {
    batchSheetEl = document.createElement('div');
    batchSheetEl.id = 'relaydrop-qr-batch-print-sheet';
    batchSheetEl.className = 'qr-print-batch-sheet';
    batchSheetEl.setAttribute('aria-label', 'Printable batch QR index card sheet');
    document.body.appendChild(batchSheetEl);
  }
  batchSheetEl.setAttribute('data-batch-count', String(items.length));

  const cardsHtml = items
    .map((item, idx) => buildSingleBatchCardHtml(item, idx, items.length))
    .join('\n');

  batchSheetEl.innerHTML = `
    <div class="space-y-3 font-sans text-slate-900 bg-white">
      <div class="pb-2 border-b-2 border-slate-900 flex items-center justify-between gap-4">
        <div>
          <div class="text-[10px] font-mono font-bold uppercase tracking-widest text-sky-700">
            RELAYDROP · BATCH QR INDEX CARD SHEET
          </div>
          <div class="text-base font-bold text-slate-900">
            Room ${escapeHtmlText(roomCode)} — ${items.length} Scannable File Index ${items.length === 1 ? 'Card' : 'Cards'}
          </div>
        </div>
        <div class="text-right font-mono text-[10px] text-slate-600">
          <div>One QR Code Per File · Cut Along Card Borders</div>
          <div>Generated ${escapeHtmlText(new Date().toISOString().slice(0, 10))}</div>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-3.5">
        ${cardsHtml}
      </div>
    </div>
  `;

  return batchSheetEl;
}

/**
 * Formats an index card sheet with one QR code per selected file and directly triggers
 * the browser print dialog (window.print).
 */
export function printBatchFileQrIndexCards(
  items: PrintFileQrOptions[],
  roomCode = '742-881'
): void {
  if (typeof window === 'undefined' || typeof document === 'undefined' || items.length === 0) {
    return;
  }

  prepareBatchQrIndexCardPrintSheet(items, roomCode);
  document.body.setAttribute('data-print-mode', 'qr-batch-sheet');

  const handleAfterPrint = () => {
    window.removeEventListener('afterprint', handleAfterPrint);
  };
  window.addEventListener('afterprint', handleAfterPrint);

  window.print();
}

interface QrMatrixSvgProps {
  value: string;
  size?: number;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  includeLogo?: boolean;
}

export const QrMatrixSvg: React.FC<QrMatrixSvgProps> = ({
  value,
  size = 160,
  errorCorrectionLevel = 'M',
  includeLogo = false,
}) => {
  const effectiveErrorCorrectionLevel: QrErrorCorrectionLevel =
    includeLogo && (errorCorrectionLevel === 'L' || errorCorrectionLevel === 'M')
      ? 'H'
      : errorCorrectionLevel;

  const { modules, gridSize } = useMemo(() => {
    try {
      const qr = QRCode.create(value || 'https://relaydrop.local', {
        errorCorrectionLevel: effectiveErrorCorrectionLevel,
      });
      const count = qr.modules.size;
      const data = qr.modules.data;
      const grid: boolean[][] = [];

      for (let r = 0; r < count; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < count; c++) {
          row.push(Boolean(data[r * count + c]));
        }
        grid.push(row);
      }

      return { modules: grid, gridSize: count };
    } catch {
      return { modules: [[true]], gridSize: 1 };
    }
  }, [value, effectiveErrorCorrectionLevel]);

  const quietZone = 2;
  const viewBoxSize = gridSize + quietZone * 2;
  const qualityLabel =
    QR_QUALITY_LABELS[effectiveErrorCorrectionLevel] || 'Medium';
  const logoBoxSize = Math.max(5, Math.round(gridSize * 0.18));
  const logoCoord = (viewBoxSize - logoBoxSize) / 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      className="rounded-xl bg-white p-2 border border-slate-200/90 shrink-0"
      role="img"
      data-error-correction={effectiveErrorCorrectionLevel}
      data-qr-quality={qualityLabel}
      data-include-logo={includeLogo ? 'true' : 'false'}
      aria-label={`Scannable QR code (${qualityLabel} error correction${
        includeLogo ? ', with RelayDrop Logo' : ''
      }) for ${value}`}
    >
      <rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
      {modules.map((row, rIdx) =>
        row.map((cell, cIdx) =>
          cell ? (
            <rect
              key={`${rIdx}-${cIdx}`}
              x={cIdx + quietZone}
              y={rIdx + quietZone}
              width={0.96}
              height={0.96}
              rx={0.12}
              fill="#0f172a"
            />
          ) : null
        )
      )}
      {includeLogo && (
        <g
          data-testid="qr-center-logo"
          aria-label="RelayDrop Logo"
        >
          <rect
            x={logoCoord - 0.6}
            y={logoCoord - 0.6}
            width={logoBoxSize + 1.2}
            height={logoBoxSize + 1.2}
            rx={1.1}
            fill="#ffffff"
          />
          <rect
            x={logoCoord}
            y={logoCoord}
            width={logoBoxSize}
            height={logoBoxSize}
            rx={0.85}
            fill="#0f172a"
            stroke="#0284c7"
            strokeWidth={0.35}
          />
          <circle
            cx={viewBoxSize / 2}
            cy={viewBoxSize / 2 - logoBoxSize * 0.14}
            r={logoBoxSize * 0.13}
            fill="#38bdf8"
          />
          <text
            x={viewBoxSize / 2}
            y={viewBoxSize / 2 + logoBoxSize * 0.28}
            textAnchor="middle"
            fontSize={logoBoxSize * 0.34}
            fontWeight="800"
            fontFamily="JetBrains Mono, monospace"
            fill="#ffffff"
          >
            RD
          </text>
        </g>
      )}
    </svg>
  );
};
