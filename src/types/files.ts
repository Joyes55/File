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
  favorite?: boolean;
  favoritedAt?: string;
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

export interface SharedBundle {
  id: string;
  archiveName: string;
  roomCode: string;
  createdBy: string;
  ownerUid: string;
  createdByDevice?: string;
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  fileIds: string[];
  fileNames: string[];
  fileCount: number;
  totalBytes: number;
  bundleZipBytes?: number;
  downloads: number;
  revoked: boolean;
  shareUrl?: string;
  downloadUrl?: string;
  firestoreSynced?: boolean;
}

export function formatRemainingBundleTtl(
  expiresAt: string,
  nowMs: number = Date.now()
): {
  expired: boolean;
  remainingMs: number;
  label: string;
} {
  const targetMs = new Date(expiresAt).getTime();
  if (Number.isNaN(targetMs)) {
    return { expired: false, remainingMs: 0, label: 'Active' };
  }
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) {
    return { expired: true, remainingMs: 0, label: 'Expired' };
  }
  const totalSec = Math.ceil(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (days > 0) {
    return {
      expired: false,
      remainingMs: diffMs,
      label: `${days}d ${hours}h ${mins}m`,
    };
  }
  if (hours > 0) {
    return {
      expired: false,
      remainingMs: diffMs,
      label: `${hours}h ${mins}m ${secs}s`,
    };
  }
  return {
    expired: false,
    remainingMs: diffMs,
    label: `${mins}m ${secs}s`,
  };
}

export type ActiveTab = 'vault' | 'favorites' | 'upload' | 'radar' | 'rooms' | 'activity';
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

export type VaultFileTypeGroup =
  | 'Image'
  | 'PDF & Docs'
  | 'Code & JSON'
  | 'Spreadsheet'
  | 'Audio & Media';

export interface FileTypeGroupMeta {
  id: VaultFileTypeGroup;
  label: string;
  shortLabel: string;
  extensionsHint: string;
  color: string;
  searchFilterToken: string;
}

export const FILE_TYPE_GROUPS: FileTypeGroupMeta[] = [
  {
    id: 'Image',
    label: 'Image & Vector',
    shortLabel: 'Image',
    extensionsHint: 'PNG · JPG · SVG · WebP',
    color: '#0284c7', // sky-600
    searchFilterToken: 'type:image',
  },
  {
    id: 'PDF & Docs',
    label: 'PDF & Docs',
    shortLabel: 'PDF / Doc',
    extensionsHint: 'PDF · MD · TXT · DOCX',
    color: '#0f172a', // slate-900
    searchFilterToken: 'type:doc',
  },
  {
    id: 'Code & JSON',
    label: 'Code & Archives',
    shortLabel: 'Code',
    extensionsHint: 'JSON · TS/JS · ZIP · YAML',
    color: '#4f46e5', // indigo-600
    searchFilterToken: 'type:code',
  },
  {
    id: 'Spreadsheet',
    label: 'Spreadsheets',
    shortLabel: 'CSV / Sheet',
    extensionsHint: 'CSV · TSV · XLSX',
    color: '#0d9488', // teal-600
    searchFilterToken: 'type:sheet',
  },
  {
    id: 'Audio & Media',
    label: 'Audio & Video',
    shortLabel: 'Audio',
    extensionsHint: 'WAV · MP3 · MP4',
    color: '#d97706', // amber-600
    searchFilterToken: 'type:audio',
  },
];

export function classifyVaultFileType(file: Pick<SharedFile, 'name' | 'mimeType' | 'category'>): VaultFileTypeGroup {
  const lowerName = (file.name || '').toLowerCase();
  const lowerMime = (file.mimeType || '').toLowerCase();

  if (
    lowerMime.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|svg|bmp|avif|heic|ico|tiff?)$/.test(lowerName)
  ) {
    return 'Image';
  }

  if (
    lowerMime.startsWith('audio/') ||
    lowerMime.startsWith('video/') ||
    /\.(wav|mp3|flac|m4a|ogg|aac|mp4|mov|webm)$/.test(lowerName)
  ) {
    return 'Audio & Media';
  }

  if (
    lowerMime === 'text/csv' ||
    lowerMime.includes('spreadsheet') ||
    lowerMime.includes('excel') ||
    /\.(csv|tsv|xlsx|xls|numbers)$/.test(lowerName)
  ) {
    return 'Spreadsheet';
  }

  if (
    lowerMime === 'application/json' ||
    lowerMime.endsWith('+json') ||
    lowerMime.includes('javascript') ||
    lowerMime.includes('zip') ||
    lowerMime.includes('tar') ||
    /\.(json|jsonl|ts|tsx|js|jsx|py|go|rs|java|c|cpp|h|sh|html|css|scss|xml|ya?ml|toml|sql|zip|tar|gz|7z)$/.test(
      lowerName
    )
  ) {
    return 'Code & JSON';
  }

  return 'PDF & Docs';
}

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

export interface CategorySuggestion {
  category: string;
  confidence: 'high' | 'medium';
  reason: string;
  matchedRule: string;
  triggerType: 'keyword' | 'extension' | 'mime' | 'custom' | 'fallback';
}

export const AUTO_TAG_RULE_EXAMPLES: {
  rule: string;
  sampleFileName: string;
  sampleMimeType: string;
  targetCategory: string;
}[] = [
  {
    rule: "'.pdf' -> 'Documents'",
    sampleFileName: 'field-operations-brief.pdf',
    sampleMimeType: 'application/pdf',
    targetCategory: 'Documents',
  },
  {
    rule: "'2025-report' -> 'Financials'",
    sampleFileName: 'q4-2025-report-summary.pdf',
    sampleMimeType: 'application/pdf',
    targetCategory: 'Financials',
  },
  {
    rule: "'.svg' / 'wireframe' -> 'Design Assets'",
    sampleFileName: 'mobile-vault-wireframe.svg',
    sampleMimeType: 'image/svg+xml',
    targetCategory: 'Design Assets',
  },
  {
    rule: "'.json' / 'config' -> 'Archives & Code'",
    sampleFileName: 'mesh-relay-config.json',
    sampleMimeType: 'application/json',
    targetCategory: 'Archives & Code',
  },
  {
    rule: "'.wav' / 'voice' -> 'Audio & Voice'",
    sampleFileName: 'site-inspection-voice-memo.wav',
    sampleMimeType: 'audio/wav',
    targetCategory: 'Audio & Voice',
  },
  {
    rule: "'.png' / 'screenshot' -> 'Photos & Media'",
    sampleFileName: 'handset-radar-screenshot.png',
    sampleMimeType: 'image/png',
    targetCategory: 'Photos & Media',
  },
];

const KEYWORD_CATEGORY_RULES: {
  category: string;
  keywords: string[];
}[] = [
  {
    category: 'Financials',
    keywords: [
      '2025-report',
      '2026-report',
      'annual-report',
      'quarterly-report',
      'q1-report',
      'q2-report',
      'q3-report',
      'q4-report',
      'financial-report',
      'expense-report',
      'report',
      'financial',
      'financials',
      'invoice',
      'budget',
      'receipt',
      'ledger',
      'payroll',
      'tax',
      'expense',
      'revenue',
      'forecast',
      'profit',
      'billing',
      'statement',
      'bom',
      'earnings',
      'balance-sheet',
      'audit',
    ],
  },
  {
    category: 'Design Assets',
    keywords: [
      'wireframe',
      'mockup',
      'prototype',
      'figma',
      'sketch',
      'vector',
      'ui-kit',
      'design-system',
      'brand-guide',
      'logo',
      'icon',
      'palette',
      'shader',
      'lidar',
      'mesh',
      '3d-model',
      'cad',
    ],
  },
  {
    category: 'Audio & Voice',
    keywords: [
      'voice-memo',
      'voice-note',
      'podcast',
      'interview',
      'recording',
      'soundtrack',
      'audio',
      'voice',
      'narration',
      'stems',
    ],
  },
  {
    category: 'Photos & Media',
    keywords: [
      'screenshot',
      'screen-recording',
      'camera',
      'photo',
      'portrait',
      'headshot',
      'wallpaper',
      'thumbnail',
      'timelapse',
      'footage',
    ],
  },
  {
    category: 'Archives & Code',
    keywords: [
      'source-code',
      'backup',
      'bundle',
      'release',
      'package',
      'config',
      'schema',
      'migration',
      'firmware',
      'script',
      'sdk',
      'api-spec',
      'repo',
    ],
  },
  {
    category: 'Documents',
    keywords: [
      'contract',
      'agreement',
      'proposal',
      'manual',
      'handbook',
      'specification',
      'spec',
      'readme',
      'field-notes',
      'notes',
      'memo',
      'resume',
      'whitepaper',
      'brief',
      'policy',
      'syllabus',
      'minutes',
    ],
  },
];

const EXTENSION_CATEGORY_RULES: {
  category: string;
  extensions: string[];
}[] = [
  {
    category: 'Documents',
    extensions: [
      '.pdf',
      '.doc',
      '.docx',
      '.txt',
      '.md',
      '.markdown',
      '.rtf',
      '.odt',
      '.pages',
      '.tex',
    ],
  },
  {
    category: 'Financials',
    extensions: ['.csv', '.tsv', '.xlsx', '.xls', '.numbers', '.qbo', '.ofx'],
  },
  {
    category: 'Design Assets',
    extensions: [
      '.fig',
      '.sketch',
      '.svg',
      '.ai',
      '.psd',
      '.eps',
      '.indd',
      '.blend',
      '.obj',
      '.stl',
      '.fbx',
      '.glb',
      '.gltf',
    ],
  },
  {
    category: 'Photos & Media',
    extensions: [
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.heic',
      '.avif',
      '.bmp',
      '.tiff',
      '.tif',
      '.mp4',
      '.mov',
      '.webm',
      '.mkv',
    ],
  },
  {
    category: 'Audio & Voice',
    extensions: [
      '.mp3',
      '.wav',
      '.flac',
      '.m4a',
      '.ogg',
      '.aac',
      '.aiff',
      '.opus',
    ],
  },
  {
    category: 'Archives & Code',
    extensions: [
      '.zip',
      '.tar',
      '.gz',
      '.tgz',
      '.7z',
      '.rar',
      '.json',
      '.jsonl',
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.go',
      '.rs',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.sh',
      '.html',
      '.css',
      '.scss',
      '.yaml',
      '.yml',
      '.toml',
      '.sql',
      '.xml',
    ],
  },
];

export function suggestCategoriesForFile(
  fileName: string,
  mimeType = '',
  availableCategories: string[] = DEFAULT_CATEGORIES
): CategorySuggestion[] {
  const cleanName = (fileName || '').trim();
  const lowerName = cleanName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  const extMatch = lowerName.match(/(\.[a-z0-9]{1,10})$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';
  const baseNameWithoutExt = ext
    ? lowerName.slice(0, Math.max(0, lowerName.length - ext.length))
    : lowerName;

  const suggestions: CategorySuggestion[] = [];
  const seenCategories = new Set<string>();

  const addSuggestion = (suggestion: CategorySuggestion) => {
    if (seenCategories.has(suggestion.category)) return;
    seenCategories.add(suggestion.category);
    suggestions.push(suggestion);
  };

  // 1. Check user-created custom categories by keyword match in filename
  for (const customCat of availableCategories) {
    if (DEFAULT_CATEGORIES.includes(customCat)) continue;
    const slugTokens = customCat
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3);
    const matchedToken = slugTokens.find((token) =>
      baseNameWithoutExt.includes(token)
    );
    if (matchedToken) {
      addSuggestion({
        category: customCat,
        confidence: 'high',
        reason: `Keyword '${matchedToken}'`,
        matchedRule: `'${matchedToken}' -> '${customCat}'`,
        triggerType: 'custom',
      });
    }
  }

  // 2. Check filename keyword rules (e.g., '2025-report' -> 'Financials')
  for (const group of KEYWORD_CATEGORY_RULES) {
    for (const kw of group.keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const boundaryRegex = new RegExp(
        `(^|[^a-z0-9])${escaped}($|[^a-z0-9])`,
        'i'
      );
      if (
        boundaryRegex.test(baseNameWithoutExt) ||
        baseNameWithoutExt.includes(kw)
      ) {
        addSuggestion({
          category: group.category,
          confidence: 'high',
          reason: `Keyword '${kw}'`,
          matchedRule: `'${kw}' -> '${group.category}'`,
          triggerType: 'keyword',
        });
        break;
      }
    }
  }

  // 3. Check file extension rules (e.g., '.pdf' -> 'Documents')
  if (ext) {
    for (const group of EXTENSION_CATEGORY_RULES) {
      if (group.extensions.includes(ext)) {
        addSuggestion({
          category: group.category,
          confidence: suggestions.length === 0 ? 'high' : 'medium',
          reason: `Extension '${ext}'`,
          matchedRule: `'${ext}' -> '${group.category}'`,
          triggerType: 'extension',
        });
      }
    }
  }

  // 4. Check MIME type fallback rules if extension wasn't decisive
  if (lowerMime) {
    if (lowerMime === 'application/pdf') {
      addSuggestion({
        category: 'Documents',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: "MIME 'application/pdf'",
        matchedRule: "'.pdf' -> 'Documents'",
        triggerType: 'mime',
      });
    } else if (lowerMime === 'image/svg+xml') {
      addSuggestion({
        category: 'Design Assets',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: "MIME 'image/svg+xml'",
        matchedRule: "'.svg' -> 'Design Assets'",
        triggerType: 'mime',
      });
    } else if (lowerMime.startsWith('image/') || lowerMime.startsWith('video/')) {
      addSuggestion({
        category: 'Photos & Media',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: `MIME '${lowerMime}'`,
        matchedRule: `'${ext || lowerMime}' -> 'Photos & Media'`,
        triggerType: 'mime',
      });
    } else if (lowerMime.startsWith('audio/')) {
      addSuggestion({
        category: 'Audio & Voice',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: `MIME '${lowerMime}'`,
        matchedRule: `'${ext || lowerMime}' -> 'Audio & Voice'`,
        triggerType: 'mime',
      });
    } else if (
      lowerMime.includes('csv') ||
      lowerMime.includes('spreadsheet') ||
      lowerMime.includes('excel')
    ) {
      addSuggestion({
        category: 'Financials',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: `MIME '${lowerMime}'`,
        matchedRule: `'${ext || 'spreadsheet'}' -> 'Financials'`,
        triggerType: 'mime',
      });
    } else if (
      lowerMime.includes('json') ||
      lowerMime.includes('zip') ||
      lowerMime.includes('javascript')
    ) {
      addSuggestion({
        category: 'Archives & Code',
        confidence: suggestions.length === 0 ? 'high' : 'medium',
        reason: `MIME '${lowerMime}'`,
        matchedRule: `'${ext || lowerMime}' -> 'Archives & Code'`,
        triggerType: 'mime',
      });
    }
  }

  // 5. Fallback default so every file always has at least one valid suggestion
  if (suggestions.length === 0) {
    addSuggestion({
      category: 'Documents',
      confidence: 'medium',
      reason: 'Default document fallback',
      matchedRule: "'.doc / text' -> 'Documents'",
      triggerType: 'fallback',
    });
  }

  return suggestions;
}

export function inferCategoryFromFile(
  fileName: string,
  mimeType: string,
  availableCategories: string[] = DEFAULT_CATEGORIES
): string {
  const suggestions = suggestCategoriesForFile(
    fileName,
    mimeType,
    availableCategories
  );
  return suggestions[0]?.category || 'Documents';
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

  const nameText = `${file.name} ${file.notes || ''} ${file.senderName} ${
    file.encrypted ? 'encrypted aes-256-gcm e2ee cipher' : ''
  }`.toLowerCase();
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
  const fileTypeGroup = classifyVaultFileType(file);

  for (const token of tokens) {
    let tokenMatched = false;
    if (token.startsWith('type:')) {
      const targetType = token.slice(5);
      if (
        (targetType === 'image' && fileTypeGroup === 'Image') ||
        ((targetType === 'doc' || targetType === 'pdf') && fileTypeGroup === 'PDF & Docs') ||
        (targetType === 'code' && fileTypeGroup === 'Code & JSON') ||
        ((targetType === 'sheet' || targetType === 'csv') && fileTypeGroup === 'Spreadsheet') ||
        ((targetType === 'audio' || targetType === 'media') && fileTypeGroup === 'Audio & Media') ||
        ((targetType === 'encrypted' || targetType === 'e2ee') && Boolean(file.encrypted))
      ) {
        matchedBySet.add('category');
        tokenMatched = true;
      }
    }
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
