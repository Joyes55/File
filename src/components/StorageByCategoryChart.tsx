import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  BarChart3,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Music,
  Palette,
  Code2,
  Upload,
  HardDrive,
  TrendingUp,
} from 'lucide-react';
import { SharedFile, formatBytes } from '../types/files';

export interface StorageByCategoryChartProps {
  files: SharedFile[];
  categories: string[];
  selectedCategory: string;
  softStorageLimitBytes?: number;
  onSelectCategory: (category: string) => void;
  onTriggerUpload?: () => void;
}

export interface CategoryStorageDatum {
  category: string;
  shortLabel: string;
  bytes: number;
  megabytes: number;
  fileCount: number;
  vaultSharePercent: number;
  quotaSharePercent: number;
  largestFileName: string | null;
  largestFileBytes: number;
  color: string;
}

const CATEGORY_COLOR_MAP: Record<string, string> = {
  'Photos & Media': '#0284c7', // sky-600
  'Design Assets': '#4f46e5', // indigo-600
  Documents: '#0f172a', // slate-900
  'Audio & Voice': '#d97706', // amber-600
  'Archives & Code': '#059669', // emerald-600
  Financials: '#0d9488', // teal-600
};

const FALLBACK_PALETTE = [
  '#0284c7',
  '#4f46e5',
  '#0d9488',
  '#d97706',
  '#059669',
  '#334155',
  '#2563eb',
  '#7c3aed',
];

export function getCategoryColor(category: string, index = 0): string {
  if (CATEGORY_COLOR_MAP[category]) {
    return CATEGORY_COLOR_MAP[category];
  }
  const lower = category.toLowerCase();
  if (lower.includes('photo') || lower.includes('media') || lower.includes('image')) {
    return '#0284c7';
  }
  if (lower.includes('design') || lower.includes('art') || lower.includes('cad')) {
    return '#4f46e5';
  }
  if (lower.includes('audio') || lower.includes('voice') || lower.includes('music')) {
    return '#d97706';
  }
  if (lower.includes('archive') || lower.includes('code') || lower.includes('dev')) {
    return '#059669';
  }
  if (lower.includes('financial') || lower.includes('sheet') || lower.includes('budget')) {
    return '#0d9488';
  }
  return FALLBACK_PALETTE[index % FALLBACK_PALETTE.length];
}

function getCategoryMiniIcon(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes('photo') || lower.includes('media') || lower.includes('image')) {
    return <ImageIcon className="w-3.5 h-3.5 text-sky-600" />;
  }
  if (lower.includes('design') || lower.includes('art')) {
    return <Palette className="w-3.5 h-3.5 text-indigo-600" />;
  }
  if (lower.includes('audio') || lower.includes('voice') || lower.includes('music')) {
    return <Music className="w-3.5 h-3.5 text-amber-600" />;
  }
  if (lower.includes('archive') || lower.includes('code') || lower.includes('dev')) {
    return <Code2 className="w-3.5 h-3.5 text-emerald-600" />;
  }
  if (lower.includes('financial') || lower.includes('sheet') || lower.includes('budget')) {
    return <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />;
  }
  return <FileText className="w-3.5 h-3.5 text-slate-700" />;
}

function abbreviateCategoryLabel(category: string): string {
  if (category === 'Photos & Media') return 'Photos';
  if (category === 'Design Assets') return 'Design';
  if (category === 'Audio & Voice') return 'Audio';
  if (category === 'Archives & Code') return 'Code';
  if (category.length > 11) return `${category.slice(0, 10)}…`;
  return category;
}

export const StorageByCategoryChart: React.FC<StorageByCategoryChartProps> = ({
  files,
  categories,
  selectedCategory,
  softStorageLimitBytes = 25 * 1024 * 1024,
  onSelectCategory,
  onTriggerUpload,
}) => {
  const [sortMode, setSortMode] = useState<'usage' | 'default'>('usage');
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);

  const totalBytes = useMemo(
    () => files.reduce((sum, f) => sum + (f.size || 0), 0),
    [files]
  );

  const categoryData = useMemo<CategoryStorageDatum[]>(() => {
    const allCategoryNames = Array.from(
      new Set([...categories, ...files.map((f) => f.category || 'Uncategorized')])
    );

    const statsMap = new Map<
      string,
      {
        bytes: number;
        fileCount: number;
        largestFileName: string | null;
        largestFileBytes: number;
      }
    >();

    for (const cat of allCategoryNames) {
      statsMap.set(cat, {
        bytes: 0,
        fileCount: 0,
        largestFileName: null,
        largestFileBytes: 0,
      });
    }

    for (const file of files) {
      const cat = file.category || 'Uncategorized';
      const current = statsMap.get(cat) || {
        bytes: 0,
        fileCount: 0,
        largestFileName: null,
        largestFileBytes: 0,
      };
      const fileSize = file.size || 0;
      current.bytes += fileSize;
      current.fileCount += 1;
      if (fileSize >= current.largestFileBytes) {
        current.largestFileBytes = fileSize;
        current.largestFileName = file.name;
      }
      statsMap.set(cat, current);
    }

    const rows: CategoryStorageDatum[] = allCategoryNames.map((cat, idx) => {
      const stat = statsMap.get(cat)!;
      const vaultSharePercent =
        totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 1000) / 10 : 0;
      const quotaSharePercent =
        softStorageLimitBytes > 0
          ? Math.round((stat.bytes / softStorageLimitBytes) * 1000) / 10
          : 0;

      return {
        category: cat,
        shortLabel: abbreviateCategoryLabel(cat),
        bytes: stat.bytes,
        megabytes: Math.round((stat.bytes / (1024 * 1024)) * 100) / 100,
        fileCount: stat.fileCount,
        vaultSharePercent,
        quotaSharePercent,
        largestFileName: stat.largestFileName,
        largestFileBytes: stat.largestFileBytes,
        color: getCategoryColor(cat, idx),
      };
    });

    if (sortMode === 'usage') {
      return [...rows].sort(
        (a, b) => b.bytes - a.bytes || b.fileCount - a.fileCount
      );
    }
    return rows;
  }, [categories, files, softStorageLimitBytes, sortMode, totalBytes]);

  const topConsumer = useMemo<CategoryStorageDatum | null>(() => {
    if (categoryData.length === 0 || totalBytes === 0) return null;
    return categoryData.reduce((best, curr) =>
      curr.bytes > best.bytes ? curr : best
    , categoryData[0]);
  }, [categoryData, totalBytes]);

  const activeDatum = useMemo<CategoryStorageDatum | null>(() => {
    if (hoveredCategory) {
      return categoryData.find((d) => d.category === hoveredCategory) || null;
    }
    if (selectedCategory && selectedCategory !== 'All') {
      return categoryData.find((d) => d.category === selectedCategory) || null;
    }
    return topConsumer;
  }, [categoryData, hoveredCategory, selectedCategory, topConsumer]);

  return (
    <section
      aria-label="Storage Usage by Category Dashboard"
      className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4"
    >
      {/* Header & Sort Mode Switcher */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-sky-600 shrink-0" />
            <h2 className="text-base font-bold text-slate-900">
              Storage Usage by Category
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Identify which categories consume the most vault space
          </p>
        </div>

        <div
          role="group"
          aria-label="Category chart sort order"
          className="flex items-center p-1 bg-slate-100 rounded-xl shrink-0"
        >
          <button
            type="button"
            onClick={() => setSortMode('usage')}
            className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap interactive-press ${
              sortMode === 'usage'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Top Space
          </button>
          <button
            type="button"
            onClick={() => setSortMode('default')}
            className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap interactive-press ${
              sortMode === 'default'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Default
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="py-8 text-center space-y-1.5 border-y border-slate-100">
          <p className="text-xs font-semibold text-slate-800">
            No storage consumed yet
          </p>
          <p className="text-xs text-slate-500">
            Upload files to compare category storage consumption.
          </p>
        </div>
      ) : (
        <>
          {/* Highest Storage Consumer Callout Banner */}
          {activeDatum && (
            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-between gap-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                  <TrendingUp className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                  <span>
                    {hoveredCategory
                      ? 'Inspected Category'
                      : selectedCategory !== 'All' &&
                        activeDatum.category === selectedCategory
                      ? 'Filtered Category'
                      : 'Highest Space Consumer'}
                  </span>
                </div>
                <p className="text-sm font-bold text-slate-900 truncate">
                  {activeDatum.category}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  <span>
                    {activeDatum.fileCount}{' '}
                    {activeDatum.fileCount === 1 ? 'file' : 'files'}
                  </span>
                  {activeDatum.largestFileName && (
                    <>
                      <span className="mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span>Largest: {activeDatum.largestFileName}</span>
                    </>
                  )}
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-base font-bold font-mono tabular-nums text-slate-900">
                  {formatBytes(activeDatum.bytes)}
                </p>
                <p className="text-[11px] font-mono tabular-nums text-sky-700 font-semibold">
                  {activeDatum.vaultSharePercent}% of vault
                </p>
              </div>
            </div>
          )}

          {/* Recharts Bar Chart of Storage Usage by Category */}
          <div
            className="h-56 w-full pt-1"
            role="img"
            aria-label="Bar chart comparing storage usage across vault categories"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={categoryData}
                margin={{ top: 8, right: 6, left: -12, bottom: 4 }}
                barCategoryGap="22%"
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#e2e8f0"
                />
                <XAxis
                  dataKey="shortLabel"
                  tickLine={false}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{
                    fontSize: 10,
                    fill: '#64748b',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                  tickFormatter={(val: number) => {
                    if (val === 0) return '0 B';
                    if (val >= 1024 * 1024) {
                      return `${(val / (1024 * 1024)).toFixed(1)}M`;
                    }
                    if (val >= 1024) {
                      return `${Math.round(val / 1024)}K`;
                    }
                    return `${val}B`;
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148, 163, 184, 0.12)', radius: 8 }}
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const item = payload[0].payload as CategoryStorageDatum;
                    return (
                      <div className="bg-slate-900 text-white px-3.5 py-2.5 rounded-xl shadow-xl text-xs space-y-1 pointer-events-none max-w-[240px]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-white truncate">
                            {item.category}
                          </span>
                          <span className="font-mono tabular-nums text-sky-400 font-semibold shrink-0">
                            {item.vaultSharePercent}%
                          </span>
                        </div>
                        <p className="font-mono tabular-nums text-slate-200">
                          {formatBytes(item.bytes)} · {item.fileCount}{' '}
                          {item.fileCount === 1 ? 'file' : 'files'}
                        </p>
                        {item.largestFileName && (
                          <p className="text-[11px] text-slate-400 truncate">
                            Top file: {item.largestFileName} (
                            {formatBytes(item.largestFileBytes)})
                          </p>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="bytes"
                  name="Storage Bytes"
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={true}
                  animationDuration={240}
                  onMouseEnter={(data) => {
                    const payload = data?.payload as CategoryStorageDatum | undefined;
                    if (payload?.category) {
                      setHoveredCategory(payload.category);
                    }
                  }}
                  onMouseLeave={() => setHoveredCategory(null)}
                  onClick={(data) => {
                    const payload = data?.payload as CategoryStorageDatum | undefined;
                    if (payload?.category) {
                      onSelectCategory(
                        selectedCategory === payload.category
                          ? 'All'
                          : payload.category
                      );
                    }
                  }}
                  className="cursor-pointer focus:outline-none"
                >
                  {categoryData.map((entry) => {
                    const isSelected = selectedCategory === entry.category;
                    const isHovered = hoveredCategory === entry.category;
                    const dimmed =
                      (hoveredCategory !== null && !isHovered) ||
                      (hoveredCategory === null &&
                        selectedCategory !== 'All' &&
                        !isSelected);

                    return (
                      <Cell
                        key={entry.category}
                        fill={entry.color}
                        fillOpacity={dimmed ? 0.35 : 1}
                        style={{
                          transition:
                            'fill-opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Interactive Category Storage Breakdown Rows (Hairline Dividers, Zero-Pill Metadata) */}
          <div className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
            {categoryData.map((row) => {
              const isSelected = selectedCategory === row.category;
              const isTopConsumer =
                topConsumer &&
                topConsumer.category === row.category &&
                row.bytes > 0;
              const barWidthPercent =
                topConsumer && topConsumer.bytes > 0
                  ? Math.max(
                      row.bytes > 0 ? 4 : 0,
                      Math.round((row.bytes / topConsumer.bytes) * 100)
                    )
                  : 0;

              return (
                <button
                  key={row.category}
                  type="button"
                  onMouseEnter={() => setHoveredCategory(row.category)}
                  onMouseLeave={() => setHoveredCategory(null)}
                  onClick={() =>
                    onSelectCategory(isSelected ? 'All' : row.category)
                  }
                  className={`w-full min-h-[48px] py-2.5 px-2 rounded-xl flex flex-col justify-center gap-1.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-sky-50/80 text-slate-900'
                      : 'hover:bg-slate-50 text-slate-800'
                  }`}
                >
                  <div className="w-full flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                        {getCategoryMiniIcon(row.category)}
                      </div>
                      <span
                        className={`text-xs font-semibold truncate ${
                          isSelected ? 'text-sky-700' : 'text-slate-900'
                        }`}
                      >
                        {row.category}
                      </span>
                      {isTopConsumer && (
                        <span className="text-[11px] text-amber-700 font-semibold shrink-0">
                          · Top Space
                        </span>
                      )}
                    </div>

                    <div className="text-right font-mono tabular-nums text-xs shrink-0">
                      <span className="font-semibold text-slate-900">
                        {formatBytes(row.bytes)}
                      </span>
                      <span className="text-slate-400 mx-1" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-600">
                        {row.vaultSharePercent}%
                      </span>
                      <span className="text-slate-400 mx-1" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-500">
                        {row.fileCount}{' '}
                        {row.fileCount === 1 ? 'file' : 'files'}
                      </span>
                    </div>
                  </div>

                  {/* Proportional Micro Bar per Category */}
                  <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${barWidthPercent}%`,
                        backgroundColor: row.color,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Footer Summary & Upload Action */}
      <div className="pt-2 border-t border-slate-100 flex flex-col gap-2.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
            <span>Total Across {categoryData.length} Categories</span>
          </span>
          <span className="font-mono tabular-nums font-semibold text-slate-800">
            {formatBytes(totalBytes)} / {formatBytes(softStorageLimitBytes)}
          </span>
        </div>

        {onTriggerUpload && (
          <button
            type="button"
            onClick={onTriggerUpload}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
          >
            <Upload className="w-4 h-4" />
            <span>Upload & Categorize File</span>
          </button>
        )}
      </div>
    </section>
  );
};
