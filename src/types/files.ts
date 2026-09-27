export type UserRole = 'admin' | 'editor' | 'viewer';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  role: UserRole;
  deviceModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  uploadedAt: string;
  uploadDate: string; // YYYY-MM-DD
  ownerUid?: string;
  ownerEmail?: string;
  senderName: string;
  senderDevice: string;
  roomCode: string;
  downloads: number;
  pinProtected: boolean;
  pinned?: boolean;
  pinnedAt?: string;
  notes?: string;
  previewUrl?: string;
  textContent?: string;
  dataUrl?: string;
}

export function canUploadOrCreateCategory(user: UserProfile | null): boolean {
  if (!user) return true;
  return user.role === 'admin' || user.role === 'editor';
}

export function canModifyOrDeleteFile(
  user: UserProfile | null,
  file: SharedFile
): boolean {
  if (!user) return true;
  if (user.role === 'admin') return true;
  if (user.role === 'editor') {
    // Editors can modify/delete files they uploaded or shared room files without a restricted ownerUid
    return !file.ownerUid || file.ownerUid === user.uid;
  }
  return false;
}

export function formatRoleLabel(role: UserRole): string {
  if (role === 'admin') return 'Admin';
  if (role === 'editor') return 'Editor';
  return 'Viewer';
}

export interface ConnectedPeer {
  id: string;
  name: string;
  deviceModel: string;
  roomCode: string;
  joinedAt: string;
  status: 'idle' | 'receiving' | 'sending';
}

export type ActiveTab = 'vault' | 'upload' | 'radar' | 'rooms' | 'activity';
export type SortOption = 'newest' | 'oldest' | 'largest' | 'name';
export type DateRangePreset = 'all' | 'today' | 'yesterday' | 'week' | 'custom';

export type ActivityActionType =
  | 'upload'
  | 'delete'
  | 'category_change'
  | 'pin_toggle'
  | 'rename'
  | 'category_created'
  | 'download';

export interface ActivityLogEntry {
  id: string;
  action: ActivityActionType;
  fileId?: string;
  fileName: string;
  fileSize?: number;
  category?: string;
  previousCategory?: string;
  actorName: string;
  actorDevice?: string;
  actorRole?: string;
  roomCode: string;
  details: string;
  timestamp: string;
}

export function formatActivityTime(isoTimestamp: string): {
  relative: string;
  clock: string;
  dateLabel: string;
} {
  if (!isoTimestamp) {
    return { relative: 'Just now', clock: '--:--', dateLabel: '' };
  }
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return { relative: isoTimestamp, clock: '--:--', dateLabel: '' };
  }

  const nowMs = Date.now();
  const diffSec = Math.round((nowMs - parsed.getTime()) / 1000);
  let relative = 'Just now';
  if (diffSec >= 5 && diffSec < 60) {
    relative = `${diffSec}s ago`;
  } else if (diffSec >= 60 && diffSec < 3600) {
    relative = `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec >= 3600 && diffSec < 86400) {
    relative = `${Math.floor(diffSec / 3600)}h ago`;
  } else if (diffSec >= 86400) {
    const days = Math.floor(diffSec / 86400);
    relative = days === 1 ? 'Yesterday' : `${days}d ago`;
  }

  const clock = parsed.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const dateLabel = parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return { relative, clock, dateLabel };
}

export const DEFAULT_CATEGORIES = [
  'Photos & Media',
  'Documents',
  'Design Assets',
  'Audio & Voice',
  'Archives & Code',
  'Financials',
];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, idx);
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

export interface TransferProgressState {
  id: string;
  fileId?: string;
  fileName: string;
  direction: 'upload' | 'download';
  totalBytes: number;
  transferredBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number;
  percentage: number;
  status: 'transferring' | 'completed' | 'error';
  startedAt: number;
  elapsedSeconds?: number;
  peerName?: string;
  errorMessage?: string;
}

export function formatTransferSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 KB/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(etaSeconds: number): string {
  if (!Number.isFinite(etaSeconds) || etaSeconds <= 0) return '0.0s';
  if (etaSeconds < 1) return `${Math.max(0.1, etaSeconds).toFixed(1)}s`;
  if (etaSeconds < 60) return `${Math.ceil(etaSeconds)}s`;
  const mins = Math.floor(etaSeconds / 60);
  const secs = Math.ceil(etaSeconds % 60);
  return `${mins}m ${secs}s`;
}

/**
 * Estimates baseline P2P / mobile transfer throughput in bytes/sec scaled to file size
 * so both small text snippets and multi-megabyte media renders display accurate,
 * readable real-time progress updates.
 */
export function estimateTargetThroughputBytesPerSec(totalBytes: number): number {
  const safeTotal = Math.max(1024, totalBytes);
  // Target a visual transfer window of ~0.85s to 1.6s depending on payload size,
  // while clamping to realistic Wi-Fi Direct / WebSocket mesh rates (45 KB/s – 8.5 MB/s)
  const targetDurationSec =
    safeTotal < 50 * 1024
      ? 0.85
      : safeTotal < 1024 * 1024
      ? 1.15
      : 1.45;
  return Math.round(safeTotal / targetDurationSec);
}

export function getTodayIsoDate(): string {
  // Reference current date or system date in YYYY-MM-DD
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getYesterdayIsoDate(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDisplayDate(uploadDate: string): string {
  if (!uploadDate) return 'Unknown date';
  const today = getTodayIsoDate();
  const yesterday = getYesterdayIsoDate();

  const [y, m, d] = uploadDate.split('-').map(Number);
  if (!y || !m || !d) return uploadDate;
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const formatted = dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (uploadDate === today) return `Today (${formatted})`;
  if (uploadDate === yesterday) return `Yesterday (${formatted})`;
  return formatted;
}

export function inferCategoryFromFile(fileName: string, mimeType: string): string {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();

  if (
    lowerMime.startsWith('image/') ||
    lowerMime.startsWith('video/') ||
    /\.(jpg|jpeg|png|webp|gif|heic|mp4|mov|webm)$/.test(lowerName)
  ) {
    return 'Photos & Media';
  }
  if (
    lowerMime.startsWith('audio/') ||
    /\.(mp3|wav|flac|m4a|ogg|aac)$/.test(lowerName)
  ) {
    return 'Audio & Voice';
  }
  if (
    /\.(fig|sketch|svg|ai|psd|blend|obj|stl)$/.test(lowerName)
  ) {
    return 'Design Assets';
  }
  if (
    /\.(csv|xlsx|xls|numbers|qbo)$/.test(lowerName) ||
    lowerName.includes('invoice') ||
    lowerName.includes('bom') ||
    lowerName.includes('budget')
  ) {
    return 'Financials';
  }
  if (
    /\.(zip|tar|gz|7z|rar|json|ts|tsx|js|py|go|rs|html|css|sh|yaml|yml)$/.test(lowerName) ||
    lowerMime.includes('json') ||
    lowerMime.includes('zip') ||
    lowerMime.includes('javascript')
  ) {
    return 'Archives & Code';
  }
  return 'Documents';
}

export interface SearchMatchSummary {
  matches: boolean;
  matchedBy: ('name' | 'category' | 'date')[];
}

export function evaluateFileSearch(
  file: SharedFile,
  rawQuery: string,
  selectedCategory: string,
  datePreset: DateRangePreset,
  customDate: string
): SearchMatchSummary {
  // 1. Category filter bar check
  if (selectedCategory !== 'All' && file.category.toLowerCase() !== selectedCategory.toLowerCase()) {
    return { matches: false, matchedBy: [] };
  }

  // 2. Date preset / date picker check
  const today = getTodayIsoDate();
  const yesterday = getYesterdayIsoDate();

  if (datePreset === 'today' && file.uploadDate !== today) {
    return { matches: false, matchedBy: [] };
  }
  if (datePreset === 'yesterday' && file.uploadDate !== yesterday) {
    return { matches: false, matchedBy: [] };
  }
  if (datePreset === 'week') {
    const fileTime = new Date(`${file.uploadDate}T00:00:00Z`).getTime();
    const todayTime = new Date(`${today}T00:00:00Z`).getTime();
    const diffDays = (todayTime - fileTime) / (1000 * 60 * 60 * 24);
    if (diffDays < 0 || diffDays > 7) {
      return { matches: false, matchedBy: [] };
    }
  }
  if (datePreset === 'custom' && customDate) {
    if (file.uploadDate !== customDate) {
      return { matches: false, matchedBy: [] };
    }
  }

  // 3. Unified Search Bar check (matches Name, Category, or Upload Date)
  const query = rawQuery.trim().toLowerCase();
  if (!query) {
    return { matches: true, matchedBy: [] };
  }

  const nameText = `${file.name} ${file.notes || ''} ${file.senderName}`.toLowerCase();
  const categoryText = file.category.toLowerCase();

  // Build searchable date representations (YYYY-MM-DD, "Sep 26, 2026", "September 26", "Today", "Yesterday")
  const [y, m, d] = file.uploadDate.split('-').map(Number);
  const dateObj = y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
  const shortMonthDate = dateObj
    ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
    : '';
  const longMonthDate = dateObj
    ? dateObj.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
    : '';
  const relativeLabel =
    file.uploadDate === today ? 'today' : file.uploadDate === yesterday ? 'yesterday' : '';

  const dateText = `${file.uploadDate} ${shortMonthDate} ${longMonthDate} ${relativeLabel}`.toLowerCase();

  // Support multi-word tokens or direct substring
  const tokens = query.split(/\s+/).filter(Boolean);
  const matchedBySet = new Set<'name' | 'category' | 'date'>();

  for (const token of tokens) {
    let tokenMatched = false;
    if (nameText.includes(token)) {
      matchedBySet.add('name');
      tokenMatched = true;
    }
    if (categoryText.includes(token)) {
      matchedBySet.add('category');
      tokenMatched = true;
    }
    if (dateText.includes(token)) {
      matchedBySet.add('date');
      tokenMatched = true;
    }
    if (!tokenMatched) {
      return { matches: false, matchedBy: [] };
    }
  }

  return {
    matches: true,
    matchedBy: Array.from(matchedBySet),
  };
}
