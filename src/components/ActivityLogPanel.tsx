import React, { useState, useMemo } from 'react';
import {
  Activity,
  Upload,
  Trash2,
  FolderSync,
  Pin,
  Download,
  FolderPlus,
  Edit3,
  Search,
  X,
  ArrowRight,
  FileSpreadsheet,
  Clock,
  ChevronRight,
} from 'lucide-react';
import {
  ActivityLogEntry,
  ActivityActionType,
  SharedFile,
  formatBytes,
  formatActivityTime,
  getTodayIsoDate,
} from '../types/files';

type ActivityFilterOption =
  | 'all'
  | 'upload'
  | 'category_change'
  | 'delete'
  | 'pin_toggle'
  | 'download';

function getActionMeta(action: ActivityActionType) {
  switch (action) {
    case 'upload':
      return {
        label: 'Upload',
        icon: Upload,
        textClass: 'text-sky-700',
        iconBoxClass: 'bg-sky-50 text-sky-700',
      };
    case 'delete':
      return {
        label: 'Deletion',
        icon: Trash2,
        textClass: 'text-rose-700',
        iconBoxClass: 'bg-rose-50 text-rose-700',
      };
    case 'category_change':
      return {
        label: 'Category Change',
        icon: FolderSync,
        textClass: 'text-indigo-700',
        iconBoxClass: 'bg-indigo-50 text-indigo-700',
      };
    case 'pin_toggle':
      return {
        label: 'Pin Update',
        icon: Pin,
        textClass: 'text-amber-700',
        iconBoxClass: 'bg-amber-50 text-amber-700',
      };
    case 'category_created':
      return {
        label: 'New Category',
        icon: FolderPlus,
        textClass: 'text-emerald-700',
        iconBoxClass: 'bg-emerald-50 text-emerald-700',
      };
    case 'download':
      return {
        label: 'Download',
        icon: Download,
        textClass: 'text-teal-700',
        iconBoxClass: 'bg-teal-50 text-teal-700',
      };
    case 'rename':
    default:
      return {
        label: 'Metadata Edit',
        icon: Edit3,
        textClass: 'text-slate-700',
        iconBoxClass: 'bg-slate-100 text-slate-700',
      };
  }
}

interface ActivityLogPanelProps {
  activities: ActivityLogEntry[];
  files: SharedFile[];
  roomCode: string;
  onSelectFile: (fileId: string) => void;
  onNotify: (message: string) => void;
}

export const ActivityLogPanel: React.FC<ActivityLogPanelProps> = ({
  activities,
  files,
  roomCode,
  onSelectFile,
  onNotify,
}) => {
  const [selectedFilter, setSelectedFilter] = useState<ActivityFilterOption>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fileIdsInVault = useMemo(
    () => new Set(files.map((f) => f.id)),
    [files]
  );

  // Chronological sorting (newest first)
  const sortedActivities = useMemo(() => {
    return [...activities].sort((a, b) =>
      b.timestamp.localeCompare(a.timestamp)
    );
  }, [activities]);

  const counts = useMemo(() => {
    const summary = {
      all: sortedActivities.length,
      upload: 0,
      category_change: 0,
      delete: 0,
      pin_toggle: 0,
      download: 0,
    };
    for (const item of sortedActivities) {
      if (item.action === 'upload') summary.upload += 1;
      else if (item.action === 'category_change' || item.action === 'category_created')
        summary.category_change += 1;
      else if (item.action === 'delete') summary.delete += 1;
      else if (item.action === 'pin_toggle' || item.action === 'rename')
        summary.pin_toggle += 1;
      else if (item.action === 'download') summary.download += 1;
    }
    return summary;
  }, [sortedActivities]);

  const filteredActivities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedActivities.filter((entry) => {
      if (selectedFilter === 'upload' && entry.action !== 'upload') return false;
      if (
        selectedFilter === 'category_change' &&
        entry.action !== 'category_change' &&
        entry.action !== 'category_created'
      ) {
        return false;
      }
      if (selectedFilter === 'delete' && entry.action !== 'delete') return false;
      if (
        selectedFilter === 'pin_toggle' &&
        entry.action !== 'pin_toggle' &&
        entry.action !== 'rename'
      ) {
        return false;
      }
      if (selectedFilter === 'download' && entry.action !== 'download') return false;

      if (!q) return true;
      const haystack = `${entry.fileName} ${entry.category || ''} ${
        entry.previousCategory || ''
      } ${entry.actorName} ${entry.actorDevice || ''} ${entry.details}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [sortedActivities, selectedFilter, searchQuery]);

  const handleExportActivityCsv = () => {
    if (filteredActivities.length === 0) {
      onNotify('No activity entries to export.');
      return;
    }

    const escapeCsv = (val: string | number | undefined) => {
      const str = val === undefined || val === null ? '' : String(val);
      if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'Activity ID',
      'Timestamp (ISO)',
      'Operation',
      'File / Target Name',
      'Previous Category',
      'Category',
      'File Size (Bytes)',
      'Actor Name',
      'Actor Device',
      'Room Code',
      'Audit Details',
    ];

    const rows = filteredActivities.map((item) =>
      [
        item.id,
        item.timestamp,
        item.action,
        item.fileName,
        item.previousCategory || '',
        item.category || '',
        item.fileSize ?? '',
        item.actorName,
        item.actorDevice || '',
        item.roomCode,
        item.details,
      ]
        .map(escapeCsv)
        .join(',')
    );

    const csv = `\uFEFF${headers.map(escapeCsv).join(',')}\r\n${rows.join('\r\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeRoom = (roomCode || 'vault').replace(/[^a-zA-Z0-9_-]/g, '-');
    link.href = url;
    link.download = `relaydrop-room-activity-log-${safeRoom}-${getTodayIsoDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    onNotify(`Exported ${filteredActivities.length} room audit entries to CSV`);
  };

  const filterButtons: { id: ActivityFilterOption; label: string; count: number }[] = [
    { id: 'all', label: 'All Operations', count: counts.all },
    { id: 'upload', label: 'Uploads', count: counts.upload },
    { id: 'category_change', label: 'Category Changes', count: counts.category_change },
    { id: 'delete', label: 'Deletions', count: counts.delete },
    { id: 'pin_toggle', label: 'Pins & Edits', count: counts.pin_toggle },
    { id: 'download', label: 'Downloads', count: counts.download },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <section
        aria-label="Room Activity Audit Overview"
        className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
              Room Activity & Audit Log
            </h2>
            <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span>Room {roomCode}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-700 font-semibold">Live Sync Active</span>
              <span aria-hidden="true">·</span>
              <span>Chronological trail of uploads, category changes, pins & deletions</span>
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportActivityCsv}
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap interactive-press"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
            <span>Export Audit CSV</span>
          </button>
        </div>

        {/* Architectural Hairline Summary Strip (No Nested Cards-Within-Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-100 border-y border-slate-100 py-3.5">
          <div className="pr-4 pb-2.5 sm:pb-0">
            <span className="text-xs text-slate-500">
              Uploads
            </span>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
              {counts.upload}
            </p>
          </div>
          <div className=" sm:px-4 pb-2.5 sm:pb-0">
            <span className="text-xs text-slate-500">
              Category Changes
            </span>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
              {counts.category_change}
            </p>
          </div>
          <div className="pt-2.5 sm:pt-0 sm:px-4">
            <span className="text-xs text-slate-500">
              Deletions
            </span>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
              {counts.delete}
            </p>
          </div>
          <div className="pt-2.5 sm:pt-0 sm:pl-4">
            <span className="text-xs text-slate-500">
              Pins & Edits
            </span>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-0.5">
              {counts.pin_toggle}
            </p>
          </div>
        </div>

        {/* Search & Segmented Operation Filter Bar */}
        <div className="space-y-3">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search activity by file name, category, or peer name..."
              aria-label="Search room activity log"
              className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-2xl border border-slate-200 bg-slate-50/70 focus:bg-white text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear activity search"
                className="absolute right-2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar">
            {filterButtons.map((btn) => {
              const active = selectedFilter === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setSelectedFilter(btn.id)}
                  className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors interactive-press ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{btn.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      active ? 'text-sky-600' : 'text-slate-400'
                    }`}
                  >
                    {btn.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Chronological Timeline List */}
      <section
        aria-label="Chronological activity timeline"
        className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden"
      >
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">
            Showing <span className="font-mono tabular-nums text-slate-900">{filteredActivities.length}</span> of{' '}
            <span className="font-mono tabular-nums">{sortedActivities.length}</span> events
          </span>
          {(selectedFilter !== 'all' || searchQuery.trim() !== '') && (
            <button
              type="button"
              onClick={() => {
                setSelectedFilter('all');
                setSearchQuery('');
              }}
              className="min-h-[36px] px-2 text-xs font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap"
            >
              Reset Filters
            </button>
          )}
        </div>

        {filteredActivities.length === 0 ? (
          <div className="p-8 sm:p-10 text-center space-y-2">
            <p className="text-sm font-semibold text-slate-900">
              No matching activity events found
            </p>
            <p className="text-xs text-slate-500">
              Upload a file, change a category, or pin an item to see real-time audit logs here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredActivities.map((entry) => {
              const meta = getActionMeta(entry.action);
              const IconComp = meta.icon;
              const timeInfo = formatActivityTime(entry.timestamp);
              const canInspect =
                Boolean(entry.fileId) &&
                entry.action !== 'delete' &&
                fileIdsInVault.has(entry.fileId!);

              return (
                <div
                  key={entry.id}
                  onClick={() => {
                    if (canInspect && entry.fileId) {
                      onSelectFile(entry.fileId);
                    }
                  }}
                  role={canInspect ? 'button' : undefined}
                  tabIndex={canInspect ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (canInspect && entry.fileId && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      onSelectFile(entry.fileId);
                    }
                  }}
                  className={`px-3.5 sm:px-5 py-3.5 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 ${
                    canInspect ? 'cursor-pointer active:bg-slate-100/70' : ''
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${meta.iconBoxClass}`}
                    >
                      <IconComp
                        className={`w-4 h-4 ${
                          entry.action === 'pin_toggle' ? '-rotate-45' : ''
                        }`}
                      />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-900 truncate max-w-full">
                          {entry.fileName}
                        </span>
                        <span aria-hidden="true" className="text-slate-300">·</span>
                        <span className={`text-xs font-semibold ${meta.textClass}`}>
                          {meta.label}
                        </span>
                        {typeof entry.fileSize === 'number' && entry.fileSize > 0 && (
                          <>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="text-xs font-mono tabular-nums text-slate-500">
                              {formatBytes(entry.fileSize)}
                            </span>
                          </>
                        )}
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed break-words">
                        {entry.details}
                      </p>

                      {/* Unboxed Category Transition & Actor Provenance */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 pt-0.5">
                        {entry.action === 'category_change' &&
                        entry.previousCategory &&
                        entry.category ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-indigo-700">
                            <span>{entry.previousCategory}</span>
                            <ArrowRight className="w-3 h-3" />
                            <span>{entry.category}</span>
                          </span>
                        ) : entry.category ? (
                          <span className="font-semibold text-slate-700">
                            {entry.category}
                          </span>
                        ) : null}

                        <span aria-hidden="true">·</span>
                        <span>
                          by <strong className="font-semibold text-slate-800">{entry.actorName}</strong>
                          {entry.actorDevice ? ` (${entry.actorDevice})` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          Room {entry.roomCode}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right Timestamp & Optional File Inspect Button */}
                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2 sm:pt-0 border-t border-slate-100 sm:border-t-0 shrink-0">
                    <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-0 text-left sm:text-right">
                      <div className="text-xs font-semibold text-slate-800 flex items-center gap-1 sm:justify-end">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>{timeInfo.relative}</span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-400">
                        {timeInfo.dateLabel} · {timeInfo.clock}
                      </div>
                    </div>

                    {canInspect && entry.fileId && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectFile(entry.fileId!);
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-700 text-xs font-semibold flex items-center gap-1 transition-colors interactive-press"
                      >
                        <span>Inspect</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

interface ActivitySidePanelCardProps {
  activities: ActivityLogEntry[];
  files: SharedFile[];
  onOpenActivityTab: () => void;
  onSelectFile: (fileId: string) => void;
}

export const ActivitySidePanelCard: React.FC<ActivitySidePanelCardProps> = ({
  activities,
  files,
  onOpenActivityTab,
  onSelectFile,
}) => {
  const fileIdsInVault = useMemo(
    () => new Set(files.map((f) => f.id)),
    [files]
  );

  const recentEntries = useMemo(() => {
    return [...activities]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 5);
  }, [activities]);

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Recent Room Activity
            </h2>
            <p className="text-[11px] text-slate-500">
              Uploads, category changes & deletions
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenActivityTab}
          className="min-h-[34px] px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 whitespace-nowrap interactive-press"
        >
          Full Log ({activities.length})
        </button>
      </div>

      {recentEntries.length === 0 ? (
        <p className="text-xs text-slate-500 py-3 text-center">
          No room operations logged yet.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {recentEntries.map((entry) => {
            const meta = getActionMeta(entry.action);
            const IconComp = meta.icon;
            const timeInfo = formatActivityTime(entry.timestamp);
            const canInspect =
              Boolean(entry.fileId) &&
              entry.action !== 'delete' &&
              fileIdsInVault.has(entry.fileId!);

            return (
              <div
                key={entry.id}
                onClick={() => {
                  if (canInspect && entry.fileId) {
                    onSelectFile(entry.fileId);
                  } else {
                    onOpenActivityTab();
                  }
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (canInspect && entry.fileId) {
                      onSelectFile(entry.fileId);
                    } else {
                      onOpenActivityTab();
                    }
                  }
                }}
                className="py-2.5 flex items-start justify-between gap-2.5 hover:bg-slate-50 px-1.5 rounded-xl cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${meta.iconBoxClass}`}
                  >
                    <IconComp
                      className={`w-3.5 h-3.5 ${
                        entry.action === 'pin_toggle' ? '-rotate-45' : ''
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {entry.fileName}
                    </p>
                    <p className="text-[11px] text-slate-500 line-clamp-1">
                      {entry.action === 'category_change' &&
                      entry.previousCategory &&
                      entry.category
                        ? `${entry.previousCategory} → ${entry.category}`
                        : meta.label}{' '}
                      · {entry.actorName}
                    </p>
                  </div>
                </div>

                <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0 mt-0.5">
                  {timeInfo.relative}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onOpenActivityTab}
        className="w-full min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors interactive-press"
      >
        <Activity className="w-3.5 h-3.5 text-sky-600" />
        <span>Open Full Chronological Activity Log</span>
      </button>
    </div>
  );
};
