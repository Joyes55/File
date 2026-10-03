import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';
import {
  SharedFile,
  FILE_TYPE_GROUPS,
  VaultFileTypeGroup,
  classifyVaultFileType,
  formatBytes,
} from '../types/files';

interface FileTypeBreakdownChartProps {
  files: SharedFile[];
  activeSearchQuery: string;
  onFilterByTypeToken: (token: string) => void;
}

interface ChartDatum {
  id: VaultFileTypeGroup;
  name: string;
  shortLabel: string;
  extensionsHint: string;
  color: string;
  searchFilterToken: string;
  count: number;
  bytes: number;
  countPercent: number;
  bytesPercent: number;
  value: number;
}

export const FileTypeBreakdownChart: React.FC<FileTypeBreakdownChartProps> = ({
  files,
  activeSearchQuery,
  onFilterByTypeToken,
}) => {
  const [metricMode, setMetricMode] = useState<'count' | 'bytes'>('count');
  const [hoveredGroupId, setHoveredGroupId] = useState<VaultFileTypeGroup | null>(null);

  const totalCount = files.length;
  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.size || 0), 0),
    [files]
  );

  const breakdownData = useMemo<ChartDatum[]>(() => {
    const counts: Record<VaultFileTypeGroup, number> = {
      Image: 0,
      'PDF & Docs': 0,
      'Code & JSON': 0,
      Spreadsheet: 0,
      'Audio & Media': 0,
    };
    const sizes: Record<VaultFileTypeGroup, number> = {
      Image: 0,
      'PDF & Docs': 0,
      'Code & JSON': 0,
      Spreadsheet: 0,
      'Audio & Media': 0,
    };

    for (const file of files) {
      const group = classifyVaultFileType(file);
      counts[group] = (counts[group] || 0) + 1;
      sizes[group] = (sizes[group] || 0) + (file.size || 0);
    }

    return FILE_TYPE_GROUPS.map((meta) => {
      const count = counts[meta.id] || 0;
      const bytes = sizes[meta.id] || 0;
      const countPercent =
        totalCount > 0 ? Math.round((count / totalCount) * 1000) / 10 : 0;
      const bytesPercent =
        totalBytes > 0 ? Math.round((bytes / totalBytes) * 1000) / 10 : 0;

      return {
        id: meta.id,
        name: meta.label,
        shortLabel: meta.shortLabel,
        extensionsHint: meta.extensionsHint,
        color: meta.color,
        searchFilterToken: meta.searchFilterToken,
        count,
        bytes,
        countPercent,
        bytesPercent,
        value: metricMode === 'count' ? count : bytes,
      };
    });
  }, [files, metricMode, totalBytes, totalCount]);

  const nonZeroChartData = useMemo(
    () => breakdownData.filter((d) => d.value > 0),
    [breakdownData]
  );

  const activeDatum = useMemo(() => {
    if (hoveredGroupId) {
      return breakdownData.find((d) => d.id === hoveredGroupId) || null;
    }
    const trimmedQuery = activeSearchQuery.trim().toLowerCase();
    return (
      breakdownData.find(
        (d) => d.searchFilterToken.toLowerCase() === trimmedQuery
      ) || null
    );
  }, [activeSearchQuery, breakdownData, hoveredGroupId]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4">
      {/* Header & Metric Mode Segmented Switcher */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Vault File Type Breakdown
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Distribution of Image, PDF/Doc, Code, CSV, and Audio assets
          </p>
        </div>

        <div
          role="group"
          aria-label="Chart breakdown metric"
          className="flex items-center p-1 bg-slate-100 rounded-xl shrink-0"
        >
          <button
            type="button"
            onClick={() => setMetricMode('count')}
            className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap interactive-press ${
              metricMode === 'count'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            By Count
          </button>
          <button
            type="button"
            onClick={() => setMetricMode('bytes')}
            className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap interactive-press ${
              metricMode === 'bytes'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            By Size
          </button>
        </div>
      </div>

      {totalCount === 0 ? (
        <div className="py-8 text-center space-y-1.5 border-y border-slate-100">
          <p className="text-xs font-semibold text-slate-800">
            No files currently in vault
          </p>
          <p className="text-xs text-slate-500">
            Upload files to visualize file type breakdown.
          </p>
        </div>
      ) : (
        <>
          {/* Recharts Doughnut Visualization with Center Telemetry Callout */}
          <div className="relative h-52 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={nonZeroChartData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={56}
                  outerRadius={82}
                  paddingAngle={3}
                  cornerRadius={5}
                  stroke="none"
                  isAnimationActive={true}
                  animationDuration={220}
                  onMouseEnter={(_, index) => {
                    const item = nonZeroChartData[index];
                    if (item) setHoveredGroupId(item.id);
                  }}
                  onMouseLeave={() => setHoveredGroupId(null)}
                  onClick={(_, index) => {
                    const item = nonZeroChartData[index];
                    if (item?.searchFilterToken) {
                      onFilterByTypeToken(item.searchFilterToken);
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  {nonZeroChartData.map((entry) => {
                    const isFiltered =
                      activeSearchQuery.trim().toLowerCase() ===
                      entry.searchFilterToken.toLowerCase();
                    const isHovered = hoveredGroupId === entry.id;
                    const dimmed =
                      (hoveredGroupId !== null && !isHovered) ||
                      (hoveredGroupId === null &&
                        activeSearchQuery.trim().startsWith('type:') &&
                        !isFiltered);

                    return (
                      <Cell
                        key={entry.id}
                        fill={entry.color}
                        fillOpacity={dimmed ? 0.35 : 1}
                        style={{
                          transition: 'fill-opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const item = payload[0].payload as ChartDatum;
                    return (
                      <div className="bg-slate-900 text-white px-3 py-2 rounded-xl shadow-lg text-xs space-y-0.5 pointer-events-none">
                        <p className="font-semibold">{item.name}</p>
                        <p className="font-mono tabular-nums text-slate-300">
                          {item.count} {item.count === 1 ? 'file' : 'files'} ({item.countPercent}%)
                          {' · '}
                          {formatBytes(item.bytes)} ({item.bytesPercent}%)
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Center Doughnut Readout */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center px-6">
              {activeDatum ? (
                <>
                  <span className="text-[11px] font-semibold text-slate-500 truncate max-w-[104px]">
                    {activeDatum.shortLabel}
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 leading-tight mt-0.5">
                    {metricMode === 'count'
                      ? `${activeDatum.countPercent}%`
                      : `${activeDatum.bytesPercent}%`}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    {metricMode === 'count'
                      ? `${activeDatum.count} ${activeDatum.count === 1 ? 'file' : 'files'}`
                      : formatBytes(activeDatum.bytes)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {metricMode === 'count' ? 'Vault Total' : 'Total Volume'}
                  </span>
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 leading-tight mt-0.5">
                    {metricMode === 'count'
                      ? `${totalCount}`
                      : formatBytes(totalBytes)}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5">
                    {metricMode === 'count'
                      ? `${totalCount === 1 ? 'file' : 'files'} indexed`
                      : `${totalCount} ${totalCount === 1 ? 'file' : 'files'}`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Interactive File Type Breakdown Legend Rows (Hairline Dividers, Zero-Pill Metadata) */}
          <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
            {breakdownData.map((row) => {
              const isSelected =
                activeSearchQuery.trim().toLowerCase() ===
                row.searchFilterToken.toLowerCase();
              const sharePercent =
                metricMode === 'count' ? row.countPercent : row.bytesPercent;

              return (
                <button
                  key={row.id}
                  type="button"
                  onMouseEnter={() => setHoveredGroupId(row.id)}
                  onMouseLeave={() => setHoveredGroupId(null)}
                  onClick={() => onFilterByTypeToken(row.searchFilterToken)}
                  className={`w-full min-h-[44px] py-2 px-2 rounded-xl flex items-center justify-between gap-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-sky-50/80 text-slate-900'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: row.color }}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-xs font-semibold truncate ${
                          isSelected ? 'text-sky-700' : 'text-slate-900'
                        }`}
                      >
                        {row.name}
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        {row.extensionsHint}
                      </p>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums text-xs shrink-0">
                    <span className="font-semibold text-slate-900">
                      {row.count}
                    </span>
                    <span className="text-slate-400 mx-1" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-600">
                      {formatBytes(row.bytes)}
                    </span>
                    <span className="text-slate-400 mx-1" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-slate-500">{sharePercent}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
