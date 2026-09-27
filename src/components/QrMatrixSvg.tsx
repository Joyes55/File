import React, { useMemo } from 'react';
import QRCode from 'qrcode';

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
