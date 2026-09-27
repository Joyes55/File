import React, { useMemo } from 'react';
import QRCode from 'qrcode';

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
 * Renders a high-contrast, jsQR-compatible PNG QR code card and triggers a browser file download.
 */
export async function downloadFileQrPng({
  value,
  fileName,
  category,
  sizeLabel,
  roomCode,
  includeCardFooter = true,
}: DownloadFileQrOptions): Promise<string> {
  const qr = QRCode.create(value || 'https://relaydrop.local', {
    errorCorrectionLevel: 'M',
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

  // 1. Crisp white background
  ctx.fillStyle = '#ffffff';
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

  const dataUrl = canvas.toDataURL('image/png');
  const downloadName = `relaydrop-qr-${sanitizeFileSlug(fileName)}.png`;

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = downloadName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return dataUrl;
}

/**
 * Generates a standalone vector SVG QR code for a specific file and triggers a browser download.
 */
export function downloadFileQrSvg({
  value,
  fileName,
  roomCode,
  sizeLabel,
}: DownloadFileQrOptions): void {
  const qr = QRCode.create(value || 'https://relaydrop.local', {
    errorCorrectionLevel: 'M',
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

  const svgContent = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" width="640" height="${Math.round(
    (640 * viewBoxHeight) / viewBoxWidth
  )}">
  <rect x="0" y="0" width="${viewBoxWidth}" height="${viewBoxHeight}" fill="#ffffff" />
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

interface QrMatrixSvgProps {
  value: string;
  size?: number;
}

export const QrMatrixSvg: React.FC<QrMatrixSvgProps> = ({ value, size = 160 }) => {
  const { modules, gridSize } = useMemo(() => {
    try {
      const qr = QRCode.create(value || 'https://relaydrop.local', {
        errorCorrectionLevel: 'M',
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
  }, [value]);

  const quietZone = 2;
  const viewBoxSize = gridSize + quietZone * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      className="rounded-xl bg-white p-2 border border-slate-200/90 shrink-0"
      role="img"
      aria-label={`Scannable QR code for ${value}`}
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
    </svg>
  );
};
