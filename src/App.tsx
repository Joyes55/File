/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Search,
  Upload,
  FolderOpen,
  Radio,
  QrCode,
  Download,
  Lock,
  X,
  Calendar,
  FileText,
  Image as ImageIcon,
  Music,
  Code2,
  Palette,
  FileSpreadsheet,
  SlidersHorizontal,
  Smartphone,
  Check,
  Copy,
  Send,
  FolderPlus,
  ChevronRight,
  Camera,
  CheckSquare,
  Square,
  Trash2,
  AlertTriangle,
  ShieldCheck,
  LogIn,
  LayoutList,
  LayoutGrid,
  RefreshCw,
  Share2,
  Monitor,
  UserPlus,
  Pin,
  Activity,
  Archive,
  Eye,
  Cloud,
  FileDown,
  Heart,
  Link2,
  Printer,
  Mail,
  MessageSquare,
  Bluetooth,
  History,
  Clock,
} from 'lucide-react';
import JSZip from 'jszip';
import { onAuthStateChanged, signInWithPopup } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  SharedFile,
  SharedBundle,
  ConnectedPeer,
  ActiveTab,
  SortOption,
  DateRangePreset,
  UserProfile,
  UserRole,
  DEFAULT_CATEGORIES,
  formatBytes,
  formatDisplayDate,
  getTodayIsoDate,
  evaluateFileSearch,
  canUploadOrCreateCategory,
  canModifyOrDeleteFile,
  formatRoleLabel,
  TransferProgressState,
  estimateTargetThroughputBytesPerSec,
  ActivityLogEntry,
} from './types/files';
import {
  ShareBundleModal,
  BundleRecipientBanner,
} from './components/ShareBundleModal';
import {
  ActivityLogPanel,
  ActivitySidePanelCard,
} from './components/ActivityLogPanel';
import {
  UploadCategorizePanel,
  StorageLimitAttemptInfo,
} from './components/UploadCategorizePanel';
import {
  FileDetailSheet,
  resolveImageSource,
  resolveTextContent,
} from './components/FileDetailSheet';
import {
  QrMatrixSvg,
  QrErrorCorrectionLevel,
  QR_QUALITY_LABELS,
  buildFileQrPayloadUrl,
  downloadFileQrPng,
  downloadFileQrSvg,
  downloadFileQrCardPdf,
  shareFileQrViaWebShare,
  printFileQrIndexCard,
  prepareQrIndexCardPrintSheet,
  clearQrIndexCardPrintMode,
  prepareBatchQrIndexCardPrintSheet,
  printBatchFileQrIndexCards,
} from './components/QrMatrixSvg';
import { QrScannerModal } from './components/QrScannerModal';
import {
  ScannedFileHistoryEntry,
  MAX_SCAN_HISTORY_FILES,
  loadScanHistory,
} from './components/ScanHistoryLog';
import { AuthAccessModal } from './components/AuthAccessModal';
import { PWAInstallModal } from './components/PWAInstallModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ActiveTransfersTray } from './components/TransferProgressBar';
import { FileTypeBreakdownChart } from './components/FileTypeBreakdownChart';
import { StorageByCategoryChart } from './components/StorageByCategoryChart';
import { FilePreviewModal } from './components/FilePreviewModal';
import {
  VaultPdfReportModal,
  generateAndDownloadVaultPdf,
} from './components/VaultPdfReportModal';
import {
  encryptFilePayload,
  PersistentE2eeConfig,
  loadPersistentE2eeConfig,
  savePersistentE2eeConfig,
} from './utils/crypto';
import { usePWAInstall } from './hooks/usePWAInstall';

const MAX_RECENT_QR_PRINTS = 5;
const RECENT_QR_PRINTS_STORAGE_KEY = 'relaydrop_recent_qr_prints_v1';

interface RecentQrPrintEntry {
  fileId: string;
  fileName: string;
  category: string;
  size: number;
  sizeLabel: string;
  roomCode: string;
  senderName: string;
  uploadDate: string;
  encrypted?: boolean;
  encryptionFingerprint?: string;
  pinProtected?: boolean;
  notes?: string;
  printedAt: string;
  printCount: number;
}

interface SessionQrPrintEvent {
  id: string;
  fileId: string;
  fileName: string;
  category: string;
  size: number;
  sizeLabel: string;
  roomCode: string;
  senderName: string;
  qualityLevel: QrErrorCorrectionLevel;
  printMode: '4×6" Card' | 'Batch Sheet' | 'Re-print';
  timestamp: string;
}

function formatSessionPrintTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const timeStr = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${timeStr} (${iso.slice(0, 10)})`;
}

function detectDeviceLabel(): string {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone Mobile';
  if (/iPad/i.test(ua)) return 'iPad Touch';
  if (/Android/i.test(ua)) return 'Android Handset';
  if (/Macintosh/i.test(ua)) return 'macOS Workstation';
  if (/Windows/i.test(ua)) return 'Windows Bridge';
  return 'Mobile Web Client';
}

function getCategoryIcon(category: string) {
  const lower = category.toLowerCase();
  if (lower.includes('photo') || lower.includes('media') || lower.includes('image')) {
    return <ImageIcon className="w-4 h-4 text-sky-600" />;
  }
  if (lower.includes('design') || lower.includes('art')) {
    return <Palette className="w-4 h-4 text-indigo-600" />;
  }
  if (lower.includes('audio') || lower.includes('voice') || lower.includes('music')) {
    return <Music className="w-4 h-4 text-amber-600" />;
  }
  if (lower.includes('archive') || lower.includes('code') || lower.includes('dev')) {
    return <Code2 className="w-4 h-4 text-emerald-600" />;
  }
  if (lower.includes('financial') || lower.includes('sheet') || lower.includes('budget')) {
    return <FileSpreadsheet className="w-4 h-4 text-teal-600" />;
  }
  return <FileText className="w-4 h-4 text-slate-700" />;
}

export default function App() {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [peers, setPeers] = useState<ConnectedPeer[]>([]);
  const [activities, setActivities] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Navigation & Layout State
  const [activeTab, setActiveTab] = useState<ActiveTab>('vault');
  const [vaultViewMode, setVaultViewMode] = useState<'list' | 'grid'>('list');
  const [previewModalFileId, setPreviewModalFileId] = useState<string | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [qrModalFileId, setQrModalFileId] = useState<string | null>(null);
  const [pairingQrFileId, setPairingQrFileId] = useState<string>('');
  const [qrBorderStyle, setQrBorderStyle] = useState<'Solid' | 'Dashed' | 'Rounded'>('Solid');
  const [qrCornerRadius, setQrCornerRadius] = useState<number>(0);
  const [qrCardBgColor, setQrCardBgColor] = useState<string>('#ffffff');
  const [copiedFileQrUrl, setCopiedFileQrUrl] = useState<boolean>(false);
  const [copiedFileMetadataJson, setCopiedFileMetadataJson] = useState<boolean>(false);
  const [addedToVaultQrFile, setAddedToVaultQrFile] = useState<boolean>(false);
  const [emailShareTriggered, setEmailShareTriggered] = useState<boolean>(false);
  const [smsShareTriggered, setSmsShareTriggered] = useState<boolean>(false);
  const [bluetoothSessionState, setBluetoothSessionState] = useState<{
    status: 'idle' | 'scanning' | 'transferring' | 'completed';
    deviceName: string;
    message: string;
  }>({
    status: 'idle',
    deviceName: '',
    message: '',
  });
  const [exportedRecentPrintsCsv, setExportedRecentPrintsCsv] = useState<boolean>(false);
  const [copiedRecentPrintsCsv, setCopiedRecentPrintsCsv] = useState<boolean>(false);
  const [confirmClearRecentPrintsOpen, setConfirmClearRecentPrintsOpen] = useState<boolean>(false);
  const hasSeededRecentPrintsRef = useRef<boolean>(false);
  const [quickUploadModalOpen, setQuickUploadModalOpen] = useState<boolean>(false);
  const [qrScannerOpen, setQrScannerOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [pwaModalOpen, setPwaModalOpen] = useState<boolean>(false);
  const [mobileShellMode, setMobileShellMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [activeTransfers, setActiveTransfers] = useState<TransferProgressState[]>([]);

  const { isInstallable, isInstalled, isIOS, install: triggerPwaInstall } = usePWAInstall();
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const upsertTransfer = useCallback((item: TransferProgressState) => {
    setActiveTransfers((prev) => {
      const idx = prev.findIndex((t) => t.id === item.id);
      if (idx === -1) {
        return [item, ...prev].slice(0, 5);
      }
      const next = [...prev];
      next[idx] = item;
      return next;
    });
  }, []);

  const dismissTransfer = useCallback((id: string) => {
    setActiveTransfers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Authentication & Role-Based Authorization State (Defaults to active local Admin session so all UI controls work immediately)
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(() => {
    const nowIso = new Date().toISOString();
    return {
      uid: 'local-peer',
      email: 'alex@relaydrop.app',
      displayName: 'Alex Rivera',
      role: 'admin',
      deviceModel: detectDeviceLabel(),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(true);
  const [firestoreSyncedCount, setFirestoreSyncedCount] = useState<number>(0);
  const [isSyncingFirestore, setIsSyncingFirestore] = useState<boolean>(false);

  // Multi-Select, Batch ZIP Download, Expiring Share Bundle & Bulk Delete State
  const [isMultiSelectMode, setIsMultiSelectMode] = useState<boolean>(false);
  const [checkedFileIds, setCheckedFileIds] = useState<string[]>([]);
  const [isBatchZipping, setIsBatchZipping] = useState<boolean>(false);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);
  const [pdfReportModalOpen, setPdfReportModalOpen] = useState<boolean>(false);
  const [sharedBundles, setSharedBundles] = useState<SharedBundle[]>([]);
  const [activeShareBundle, setActiveShareBundle] = useState<SharedBundle | null>(null);
  const [shareBundleModalOpen, setShareBundleModalOpen] = useState<boolean>(false);
  const [isGeneratingShareBundle, setIsGeneratingShareBundle] = useState<boolean>(false);
  const [bundleTtlMinutes, setBundleTtlMinutes] = useState<number>(60);
  const [recipientLandingBundle, setRecipientLandingBundle] =
    useState<SharedBundle | null>(null);

  // Search, Category & Upload Date Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [customDateFilter, setCustomDateFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [showPinnedOnly, setShowPinnedOnly] = useState<boolean>(false);
  const [showEncryptedOnly, setShowEncryptedOnly] = useState<boolean>(false);
  const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState<boolean>(false);
  const [newCategoryInput, setNewCategoryInput] = useState<string>('');
  const [showAddCategoryInline, setShowAddCategoryInline] = useState<boolean>(false);

  // Device & Room Identity
  const [peerId] = useState<string>(() => `peer-${Math.random().toString(36).slice(2, 9)}`);
  const [senderName, setSenderName] = useState<string>('Alex Rivera');
  const [senderDevice] = useState<string>(() => detectDeviceLabel());
  const [roomCode, setRoomCode] = useState<string>('842-910');
  const [roomInput, setRoomInput] = useState<string>('842-910');
  const [copiedRoom, setCopiedRoom] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [storageLimitNotification, setStorageLimitNotification] =
    useState<StorageLimitAttemptInfo | null>(null);
  const [showVaultCapacityTooltip, setShowVaultCapacityTooltip] =
    useState<boolean>(false);
  const [persistentE2eeConfig, setPersistentE2eeConfig] =
    useState<PersistentE2eeConfig>(() => loadPersistentE2eeConfig());

  const handlePersistentE2eeConfigChange = useCallback(
    (nextConfig: PersistentE2eeConfig) => {
      setPersistentE2eeConfig(nextConfig);
      savePersistentE2eeConfig(nextConfig);
    },
    []
  );

  const wsRef = useRef<WebSocket | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const triggerToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Global keyboard shortcuts ('/' or Cmd/Ctrl+K to focus search, Escape to close modals/selection)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveTab('vault');
        setTimeout(() => searchInputRef.current?.focus(), 20);
      } else if (!isInputFocused && e.key === '/' && activeTab === 'vault') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (confirmBulkDeleteOpen && !isBulkDeleting) {
          setConfirmBulkDeleteOpen(false);
        } else if (qrModalFileId) {
          setQrModalFileId(null);
        } else if (quickUploadModalOpen) {
          setQuickUploadModalOpen(false);
        } else if (isMultiSelectMode) {
          setIsMultiSelectMode(false);
          setCheckedFileIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeTab, confirmBulkDeleteOpen, isBulkDeleting, qrModalFileId, quickUploadModalOpen, isMultiSelectMode]);

  // Firebase Authentication & Firestore User Profile / Vault Files / Activity Listener
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeUsersList: (() => void) | null = null;
    let unsubscribeVaultFiles: (() => void) | null = null;
    let unsubscribeActivityLogs: (() => void) | null = null;
    let unsubscribeSharedBundles: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      if (unsubscribeUsersList) {
        unsubscribeUsersList();
        unsubscribeUsersList = null;
      }
      if (unsubscribeVaultFiles) {
        unsubscribeVaultFiles();
        unsubscribeVaultFiles = null;
      }
      if (unsubscribeActivityLogs) {
        unsubscribeActivityLogs();
        unsubscribeActivityLogs = null;
      }
      if (unsubscribeSharedBundles) {
        unsubscribeSharedBundles();
        unsubscribeSharedBundles = null;
      }

      if (!fbUser) {
        setCurrentUser((prev) => {
          if (prev && prev.uid === 'local-peer') return prev;
          const nowIso = new Date().toISOString();
          return {
            uid: 'local-peer',
            email: 'alex@relaydrop.app',
            displayName: 'Alex Rivera',
            role: 'admin',
            deviceModel: senderDevice,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
        });
        setAllUsers([]);
        setFirestoreSyncedCount(0);
        setIsAuthReady(true);
        return;
      }

      const userRef = doc(db, 'users', fbUser.uid);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const emailStr = (fbUser.email || 'peer@relaydrop.app').toLowerCase();
          const isDefaultAdmin = emailStr === 'joyesgrg555@gmail.com';
          const nowIso = new Date().toISOString();
          const initialProfile: UserProfile = {
            uid: fbUser.uid,
            email: fbUser.email || 'peer@relaydrop.app',
            displayName:
              fbUser.displayName ||
              (fbUser.email ? fbUser.email.split('@')[0] : 'Mobile Peer'),
            photoURL: fbUser.photoURL || '',
            role: isDefaultAdmin ? 'admin' : 'editor',
            deviceModel: senderDevice,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          await setDoc(userRef, initialProfile);
          setCurrentUser(initialProfile);
          setSenderName(initialProfile.displayName);
        }
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
        } catch {
          // Handled structured log
        }
      }

      unsubscribeProfile = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setCurrentUser(data);
            if (data.displayName) {
              setSenderName(data.displayName);
            }
          }
          setIsAuthReady(true);
        },
        (err) => {
          setIsAuthReady(true);
          try {
            handleFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
          } catch {
            // Handled
          }
        }
      );

      unsubscribeUsersList = onSnapshot(
        collection(db, 'users'),
        (snap) => {
          const list: UserProfile[] = [];
          snap.forEach((d) => list.push(d.data() as UserProfile));
          list.sort((a, b) => a.displayName.localeCompare(b.displayName));
          setAllUsers(list);
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'users');
          } catch {
            // Handled
          }
        }
      );

      unsubscribeVaultFiles = onSnapshot(
        collection(db, 'vault_files'),
        (snap) => {
          const cloudFiles: SharedFile[] = [];
          snap.forEach((d) => {
            const raw = d.data() as SharedFile;
            if (raw && raw.id && raw.name) {
              cloudFiles.push(raw);
            }
          });
          setFirestoreSyncedCount(cloudFiles.length);
          if (cloudFiles.length > 0) {
            setFiles((prev) => {
              const map = new Map<string, SharedFile>();
              for (const existing of prev) {
                map.set(existing.id, existing);
              }
              for (const cf of cloudFiles) {
                const prior = map.get(cf.id);
                map.set(cf.id, prior ? { ...prior, ...cf } : cf);
              }
              return Array.from(map.values());
            });
            setCategories((prevCats) => {
              const set = new Set(prevCats);
              for (const cf of cloudFiles) {
                if (cf.category) set.add(cf.category);
              }
              return Array.from(set);
            });
          }
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'vault_files');
          } catch {
            // Handled
          }
        }
      );

      unsubscribeActivityLogs = onSnapshot(
        collection(db, 'activity_logs'),
        (snap) => {
          const cloudLogs: ActivityLogEntry[] = [];
          snap.forEach((d) => {
            const raw = d.data() as ActivityLogEntry;
            if (raw && raw.id && raw.action) {
              cloudLogs.push(raw);
            }
          });
          if (cloudLogs.length > 0) {
            setActivities((prev) => {
              const seen = new Set(prev.map((a) => a.id));
              const fresh = cloudLogs.filter((item) => !seen.has(item.id));
              if (fresh.length === 0) return prev;
              const combined = [...fresh, ...prev];
              combined.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
              return combined.slice(0, 250);
            });
          }
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'activity_logs');
          } catch {
            // Handled
          }
        }
      );

      unsubscribeSharedBundles = onSnapshot(
        collection(db, 'shared_bundles'),
        (snap) => {
          const cloudBundles: SharedBundle[] = [];
          snap.forEach((d) => {
            const raw = d.data() as SharedBundle;
            if (raw && raw.id && raw.expiresAt) {
              cloudBundles.push({ ...raw, firestoreSynced: true });
            }
          });
          if (cloudBundles.length > 0) {
            setSharedBundles((prev) => {
              const map = new Map<string, SharedBundle>();
              for (const b of prev) map.set(b.id, b);
              for (const cb of cloudBundles) {
                const existing = map.get(cb.id);
                map.set(cb.id, existing ? { ...existing, ...cb, firestoreSynced: true } : cb);
              }
              return Array.from(map.values()).sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt)
              );
            });
          }
        },
        (err) => {
          try {
            handleFirestoreError(err, OperationType.LIST, 'shared_bundles');
          } catch {
            // Handled
          }
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeUsersList) unsubscribeUsersList();
      if (unsubscribeVaultFiles) unsubscribeVaultFiles();
      if (unsubscribeActivityLogs) unsubscribeActivityLogs();
      if (unsubscribeSharedBundles) unsubscribeSharedBundles();
    };
  }, [senderDevice]);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-user-name': currentUser?.displayName || senderName || 'Alex Rivera',
      'x-user-device': currentUser?.deviceModel || senderDevice || 'Mobile Client',
      'x-room-code': roomCode || '842-910',
    };
    if (currentUser) {
      headers['x-user-uid'] = currentUser.uid;
      headers['x-user-email'] = currentUser.email;
      headers['x-user-role'] = currentUser.role;
    }
    return headers;
  }, [currentUser, roomCode, senderDevice, senderName]);

  const recordActivitiesLocally = useCallback(
    (incoming: ActivityLogEntry | ActivityLogEntry[] | undefined) => {
      if (!incoming) return;
      const list = Array.isArray(incoming) ? incoming : [incoming];
      if (list.length === 0) return;

      setActivities((prev) => {
        const seen = new Set(prev.map((a) => a.id));
        const fresh = list.filter((item) => item && item.id && !seen.has(item.id));
        if (fresh.length === 0) return prev;
        return [...fresh, ...prev].slice(0, 250);
      });

      if (currentUser && currentUser.uid !== 'local-peer') {
        for (const entry of list) {
          if (entry && entry.id) {
            setDoc(doc(db, 'activity_logs', entry.id), {
              id: entry.id,
              action: entry.action,
              fileId: entry.fileId || '',
              fileName: entry.fileName || 'Vault Item',
              category: entry.category || 'Uncategorized',
              fileSize: entry.fileSize || 0,
              actorName: entry.actorName || currentUser.displayName,
              actorDevice: entry.actorDevice || senderDevice,
              actorRole: entry.actorRole || currentUser.role,
              roomCode: entry.roomCode || roomCode,
              details: entry.details || '',
              timestamp: entry.timestamp || new Date().toISOString(),
            }).catch((err) => {
              try {
                handleFirestoreError(err, OperationType.WRITE, `activity_logs/${entry.id}`);
              } catch {
                // Handled
              }
            });
          }
        }
      }
    },
    [currentUser, roomCode, senderDevice]
  );

  const handleSyncVaultToFirestore = useCallback(async () => {
    if (!currentUser || currentUser.uid === 'local-peer' || isSyncingFirestore) return;
    setIsSyncingFirestore(true);
    let synced = 0;
    try {
      for (const f of files) {
        const docPayload: Record<string, unknown> = {
          id: f.id,
          name: f.name,
          size: f.size,
          mimeType: f.mimeType,
          category: f.category,
          uploadedAt: f.uploadedAt,
          uploadDate: f.uploadDate,
          ownerUid: f.ownerUid && f.ownerUid !== 'local-peer' ? f.ownerUid : currentUser.uid,
          ownerEmail: f.ownerEmail || currentUser.email,
          senderName: f.senderName,
          senderDevice: f.senderDevice || senderDevice,
          roomCode: f.roomCode || roomCode,
          pinProtected: Boolean(f.pinProtected),
          downloads: f.downloads || 0,
          notes: f.notes || '',
          pinned: Boolean(f.pinned),
          favorite: Boolean(f.favorite),
        };
        if (f.pinnedAt) {
          docPayload.pinnedAt = f.pinnedAt;
        }
        if (f.favoritedAt) {
          docPayload.favoritedAt = f.favoritedAt;
        }
        if (f.previewUrl) {
          docPayload.previewUrl = f.previewUrl;
        }
        if (f.textContent && f.textContent.length < 40000) {
          docPayload.textContent = f.textContent;
        }
        if (typeof f.encrypted === 'boolean') {
          docPayload.encrypted = f.encrypted;
        }
        if (f.encryptionAlgo) {
          docPayload.encryptionAlgo = f.encryptionAlgo;
        }
        if (f.encryptionIv) {
          docPayload.encryptionIv = f.encryptionIv;
        }
        if (f.encryptionSalt) {
          docPayload.encryptionSalt = f.encryptionSalt;
        }
        if (f.encryptionFingerprint) {
          docPayload.encryptionFingerprint = f.encryptionFingerprint;
        }
        if (f.keyHint) {
          docPayload.keyHint = f.keyHint;
        }
        if (f.encryptedPayload && f.encryptedPayload.length < 40000) {
          docPayload.encryptedPayload = f.encryptedPayload;
        }
        await setDoc(doc(db, 'vault_files', f.id), docPayload, { merge: true });
        synced += 1;
      }
      triggerToast(`Synced ${synced} vault ${synced === 1 ? 'file' : 'files'} to Cloud Firestore`);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, 'vault_files');
      } catch {
        // Handled structured error
      }
      triggerToast('Could not sync all files to Firestore (check role permissions).');
    } finally {
      setIsSyncingFirestore(false);
    }
  }, [currentUser, files, isSyncingFirestore, roomCode, senderDevice, triggerToast]);

  const handleQuickGoogleSignIn = useCallback(async () => {
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const fbUser = cred.user;
      const userRef = doc(db, 'users', fbUser.uid);
      const nowIso = new Date().toISOString();
      const emailStr = (fbUser.email || 'peer@relaydrop.app').toLowerCase();
      const isDefaultAdmin = emailStr === 'joyesgrg555@gmail.com';
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        const initialProfile: UserProfile = {
          uid: fbUser.uid,
          email: fbUser.email || 'peer@relaydrop.app',
          displayName:
            fbUser.displayName ||
            (fbUser.email ? fbUser.email.split('@')[0] : 'Google User'),
          photoURL: fbUser.photoURL || '',
          role: isDefaultAdmin ? 'admin' : 'editor',
          deviceModel: senderDevice,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        await setDoc(userRef, initialProfile);
      }
      triggerToast(`Signed in with Google as ${fbUser.displayName || fbUser.email}`);
    } catch {
      setAuthModalOpen(true);
    }
  }, [senderDevice, triggerToast]);

  const handleUpdateLocalRole = async (newRole: UserRole) => {
    const nowIso = new Date().toISOString();
    if (!currentUser) {
      const created: UserProfile = {
        uid: 'local-peer',
        email: 'alex@relaydrop.app',
        displayName: senderName || 'Alex Rivera',
        role: newRole,
        deviceModel: senderDevice,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setCurrentUser(created);
      return;
    }
    const updated: UserProfile = {
      ...currentUser,
      role: newRole,
      updatedAt: nowIso,
    };
    setCurrentUser(updated);
    if (currentUser.uid !== 'local-peer') {
      try {
        await setDoc(doc(db, 'users', currentUser.uid), updated, { merge: true });
      } catch {
        // Keep session role active for testing if Firestore rule restricts self-elevation
      }
    }
  };

  const handleActivateLocalSession = useCallback(
    (role: UserRole, customName?: string) => {
      const nowIso = new Date().toISOString();
      const finalName = customName?.trim() || senderName || 'Alex Rivera';
      const localProfile: UserProfile = {
        uid: 'local-peer',
        email: 'alex@relaydrop.app',
        displayName: finalName,
        role,
        deviceModel: senderDevice,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setCurrentUser(localProfile);
      setSenderName(finalName);
      triggerToast(`Active session set to ${finalName} (${formatRoleLabel(role)})`);
    },
    [senderDevice, senderName, triggerToast]
  );

  const handleSignOutSession = useCallback(() => {
    setCurrentUser(null);
  }, []);

  // Fetch initial state (with offline localStorage cache fallback) & check URL query param
  useEffect(() => {
    let mounted = true;
    try {
      const cachedRaw = localStorage.getItem('relaydrop_offline_vault_v1');
      if (cachedRaw) {
        const cached = JSON.parse(cachedRaw);
        if (Array.isArray(cached.files) && cached.files.length > 0) {
          setFiles(cached.files);
        }
        if (Array.isArray(cached.categories) && cached.categories.length > 0) {
          setCategories(cached.categories);
        }
        if (Array.isArray(cached.activities) && cached.activities.length > 0) {
          setActivities(cached.activities);
        }
      }
    } catch {
      // Ignore storage read errors
    }

    fetch('/api/state')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        if (Array.isArray(data.files)) {
          setFiles(data.files);
        }
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          setCategories(data.categories);
        }
        if (Array.isArray(data.peers)) {
          setPeers(data.peers);
        }
        if (Array.isArray(data.activities)) {
          setActivities(data.activities);
        }
        if (Array.isArray(data.bundles)) {
          setSharedBundles((prev) => {
            const map = new Map<string, SharedBundle>();
            for (const b of prev) map.set(b.id, b);
            for (const sb of data.bundles as SharedBundle[]) {
              const prior = map.get(sb.id);
              map.set(sb.id, prior ? { ...prior, ...sb } : sb);
            }
            return Array.from(map.values()).sort((a, b) =>
              b.createdAt.localeCompare(a.createdAt)
            );
          });
        }
        setIsLoading(false);

        const params = new URLSearchParams(window.location.search);
        const linkedBundleId = params.get('bundle')?.trim();
        if (linkedBundleId) {
          // Resolve temporary shareable bundle from Firebase Firestore & backend endpoint
          (async () => {
            let resolvedBundle: SharedBundle | null = null;
            try {
              const fbSnap = await getDoc(doc(db, 'shared_bundles', linkedBundleId));
              if (fbSnap.exists()) {
                resolvedBundle = {
                  ...(fbSnap.data() as SharedBundle),
                  firestoreSynced: true,
                };
              }
            } catch {
              // Fallback to server lookup
            }

            try {
              const srvRes = await fetch(
                `/api/bundles/${encodeURIComponent(linkedBundleId)}`
              );
              if (srvRes.ok) {
                const srvData = await srvRes.json();
                if (srvData?.bundle) {
                  resolvedBundle = resolvedBundle
                    ? { ...resolvedBundle, ...srvData.bundle }
                    : srvData.bundle;
                }
              }
            } catch {
              // Ignore network error
            }

            if (resolvedBundle) {
              setRecipientLandingBundle(resolvedBundle);
              setActiveShareBundle(resolvedBundle);
            }
          })();
        }
        const linkedRoom = params.get('room');
        if (linkedRoom && linkedRoom.trim()) {
          setRoomCode(linkedRoom.trim());
          setRoomInput(linkedRoom.trim());
        }
        const linkedFileId = params.get('file');
        if (linkedFileId) {
          setSelectedFileId(linkedFileId);
          const shouldAutoDownload = params.get('download') === '1';
          const urlPin = params.get('pin')?.trim() || undefined;
          if (shouldAutoDownload && Array.isArray(data.files)) {
            const matchedFile = (data.files as SharedFile[]).find(
              (f) => f.id === linkedFileId
            );
            if (matchedFile && (!matchedFile.pinProtected || urlPin)) {
              setTimeout(() => {
                const pinSuffix =
                  matchedFile.pinProtected && urlPin
                    ? `?pin=${encodeURIComponent(urlPin)}`
                    : '';
                const dlLink = document.createElement('a');
                dlLink.href = `/api/files/${matchedFile.id}/download${pinSuffix}`;
                dlLink.download = matchedFile.name;
                document.body.appendChild(dlLink);
                dlLink.click();
                document.body.removeChild(dlLink);
              }, 250);
            }
          }
        }
      })
      .catch(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Persist lightweight offline vault snapshot whenever files or categories change
  useEffect(() => {
    if (files.length === 0) return;
    try {
      localStorage.setItem(
        'relaydrop_offline_vault_v1',
        JSON.stringify({
          files: files.slice(0, 30),
          categories,
          activities: activities.slice(0, 50),
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [files, categories, activities]);

  const handleRefreshVault = useCallback(
    async (forceOrEvent?: boolean | React.MouseEvent) => {
      const force = forceOrEvent === true;
      if (isRefreshing && !force) return;
      setIsRefreshing(true);
      try {
        const res = await fetch('/api/state', {
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.files)) setFiles(data.files);
          if (Array.isArray(data.categories) && data.categories.length > 0) {
            setCategories(data.categories);
          }
          if (Array.isArray(data.peers)) setPeers(data.peers);
          if (Array.isArray(data.activities)) setActivities(data.activities);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                event: 'peer:join',
                payload: {
                  id: peerId,
                  name: senderName,
                  deviceModel: senderDevice,
                  roomCode,
                },
              })
            );
          }
          triggerToast('Synced mobile vault with room peers');
        }
      } catch {
        triggerToast('Offline mode — showing cached vault files');
      } finally {
        setTimeout(() => setIsRefreshing(false), 350);
      }
    },
    [isRefreshing, peerId, roomCode, senderDevice, senderName, triggerToast]
  );

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length !== 1) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    // Only trigger horizontal tab swipe if horizontal delta > 75px and dominates vertical scroll
    if (Math.abs(dx) > 75 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      const order: ActiveTab[] = ['vault', 'upload', 'activity', 'radar', 'rooms'];
      const currentIdx = order.indexOf(activeTab);
      if (dx < 0 && currentIdx < order.length - 1) {
        setActiveTab(order[currentIdx + 1]);
      } else if (dx > 0 && currentIdx > 0) {
        setActiveTab(order[currentIdx - 1]);
      }
    }
  };

  // Connect real-time WebSocket for room presence & instant file sync
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            event: 'peer:join',
            payload: {
              id: peerId,
              name: senderName,
              deviceModel: senderDevice,
              roomCode,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.event === 'state:init' && message.payload) {
            if (Array.isArray(message.payload.files)) {
              setFiles(message.payload.files);
            }
            if (Array.isArray(message.payload.categories)) {
              setCategories(message.payload.categories);
            }
            if (Array.isArray(message.payload.peers)) {
              setPeers(message.payload.peers);
            }
            if (Array.isArray(message.payload.activities)) {
              setActivities(message.payload.activities);
            }
            if (Array.isArray(message.payload.bundles)) {
              setSharedBundles((prev) => {
                const map = new Map<string, SharedBundle>();
                for (const b of prev) map.set(b.id, b);
                for (const sb of message.payload.bundles as SharedBundle[]) {
                  const prior = map.get(sb.id);
                  map.set(sb.id, prior ? { ...prior, ...sb } : sb);
                }
                return Array.from(map.values()).sort((a, b) =>
                  b.createdAt.localeCompare(a.createdAt)
                );
              });
            }
          } else if (message.event === 'bundle:created' && message.payload?.bundle) {
            const incomingBundle: SharedBundle = message.payload.bundle;
            setSharedBundles((prev) => {
              const filtered = prev.filter((b) => b.id !== incomingBundle.id);
              return [incomingBundle, ...filtered];
            });
          } else if (message.event === 'bundle:updated' && message.payload?.bundle) {
            const updatedBundle: SharedBundle = message.payload.bundle;
            setSharedBundles((prev) =>
              prev.map((b) => (b.id === updatedBundle.id ? { ...b, ...updatedBundle } : b))
            );
            setActiveShareBundle((prev) =>
              prev && prev.id === updatedBundle.id ? { ...prev, ...updatedBundle } : prev
            );
            setRecipientLandingBundle((prev) =>
              prev && prev.id === updatedBundle.id ? { ...prev, ...updatedBundle } : prev
            );
          } else if (message.event === 'activity:created' && message.payload?.id) {
            const incomingAct: ActivityLogEntry = message.payload;
            setActivities((prev) => {
              if (prev.some((a) => a.id === incomingAct.id)) return prev;
              return [incomingAct, ...prev].slice(0, 250);
            });
          } else if (message.event === 'file:created' && message.payload?.file) {
            const incomingFile: SharedFile = message.payload.file;
            setFiles((prev) => {
              if (prev.some((f) => f.id === incomingFile.id)) return prev;
              return [incomingFile, ...prev];
            });
            if (Array.isArray(message.payload.categories)) {
              setCategories(message.payload.categories);
            }
          } else if (message.event === 'file:updated' && message.payload?.file) {
            const updatedFile: SharedFile = message.payload.file;
            setFiles((prev) =>
              prev.map((f) => (f.id === updatedFile.id ? updatedFile : f))
            );
            if (Array.isArray(message.payload.categories)) {
              setCategories(message.payload.categories);
            }
          } else if (message.event === 'file:deleted' && message.payload?.id) {
            setFiles((prev) => prev.filter((f) => f.id !== message.payload.id));
            setSelectedFileId((prev) => (prev === message.payload.id ? null : prev));
            setCheckedFileIds((prev) => prev.filter((id) => id !== message.payload.id));
          } else if (message.event === 'files:bulk-deleted' && Array.isArray(message.payload?.ids)) {
            const removedSet = new Set<string>(message.payload.ids);
            setFiles((prev) => prev.filter((f) => !removedSet.has(f.id)));
            setSelectedFileId((prev) => (prev && removedSet.has(prev) ? null : prev));
            setCheckedFileIds((prev) => prev.filter((id) => !removedSet.has(id)));
          } else if (message.event === 'categories:updated' && Array.isArray(message.payload)) {
            setCategories(message.payload);
          } else if (message.event === 'peers:updated' && Array.isArray(message.payload)) {
            setPeers(message.payload);
          } else if (
            message.event === 'transfer:pulse' &&
            message.payload?.transfer &&
            message.payload?.originPeerId !== peerId
          ) {
            const incomingTransfer = message.payload.transfer as TransferProgressState;
            upsertTransfer(incomingTransfer);
            if (incomingTransfer.status === 'completed') {
              setTimeout(() => {
                dismissTransfer(incomingTransfer.id);
              }, 3600);
            }
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [peerId, roomCode, senderDevice, senderName]);

  // Handlers for API mutations with RBAC Authorization Enforcement
  const handleUploadFile = async (
    payload: {
      name: string;
      size: number;
      mimeType: string;
      category: string;
      uploadDate: string;
      senderName: string;
      senderDevice: string;
      roomCode: string;
      pinCode?: string;
      notes?: string;
      dataUrl?: string;
      textContent?: string;
      encrypted?: boolean;
      encryptionAlgo?: string;
      encryptionIv?: string;
      encryptionSalt?: string;
      encryptionFingerprint?: string;
      encryptedPayload?: string;
      keyHint?: string;
    },
    options?: { bypassSoftLimit?: boolean }
  ) => {
    if (!canUploadOrCreateCategory(currentUser)) {
      triggerToast(
        currentUser
          ? 'Viewer role is read-only. Switch to Editor or Admin to upload files.'
          : 'Sign in required to upload and categorize files.'
      );
      setAuthModalOpen(true);
      return;
    }

    const currentTotalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);
    const limitBytes = 25 * 1024 * 1024;
    const incomingSize = Math.max(0, payload.size || 0);
    if (!options?.bypassSoftLimit && currentTotalBytes + incomingSize > limitBytes) {
      const projected = currentTotalBytes + incomingSize;
      setStorageLimitNotification({
        attemptedFilesCount: 1,
        attemptedBytes: incomingSize,
        currentVaultBytes: currentTotalBytes,
        projectedTotalBytes: projected,
        softStorageLimitBytes: limitBytes,
        overageBytes: projected - limitBytes,
        fileNames: [payload.name],
      });
      triggerToast(
        `Upload exceeds 25 MB soft storage limit (+${formatBytes(
          projected - limitBytes
        )} over). Please delete old files before proceeding.`
      );
      return;
    }

    let finalPayload = { ...payload };
    if (persistentE2eeConfig.enabled && !finalPayload.encrypted) {
      const activePass = (
        persistentE2eeConfig.passphrase || 'relaydrop-2026'
      ).trim();
      if (activePass) {
        try {
          const encResult = await encryptFilePayload(
            {
              textContent:
                finalPayload.textContent ||
                (!finalPayload.dataUrl
                  ? `Encrypted RelayDrop File: ${finalPayload.name} (${formatBytes(
                      finalPayload.size
                    )})`
                  : undefined),
              dataUrl: finalPayload.dataUrl,
              mimeType: finalPayload.mimeType,
              name: finalPayload.name,
            },
            activePass
          );
          finalPayload = {
            ...finalPayload,
            dataUrl: undefined,
            textContent: undefined,
            encrypted: true,
            encryptionAlgo: encResult.encryptionAlgo,
            encryptionIv: encResult.encryptionIv,
            encryptionSalt: encResult.encryptionSalt,
            encryptionFingerprint: encResult.encryptionFingerprint,
            encryptedPayload: encResult.encryptedPayload,
            keyHint:
              finalPayload.keyHint ||
              persistentE2eeConfig.keyHint?.trim() ||
              undefined,
          };
        } catch {
          // Continue if fallback fails
        }
      }
    }

    const enrichedPayload = {
      ...finalPayload,
      ownerUid: currentUser?.uid,
      ownerEmail: currentUser?.email,
    };

    const totalBytes = Math.max(1024, payload.size || 1024);
    const baseSpeed = estimateTargetThroughputBytesPerSec(totalBytes);
    const transferId = `tx-up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = performance.now();

    const broadcastPulse = (state: TransferProgressState) => {
      upsertTransfer(state);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            event: 'transfer:pulse',
            payload: { originPeerId: peerId, transfer: state },
          })
        );
      }
    };

    broadcastPulse({
      id: transferId,
      fileName: payload.name,
      direction: 'upload',
      totalBytes,
      transferredBytes: 0,
      speedBytesPerSec: baseSpeed,
      etaSeconds: totalBytes / baseSpeed,
      percentage: 3,
      status: 'transferring',
      startedAt,
      peerName: `${payload.senderName} → Room ${payload.roomCode}`,
    });

    const uploadFetchPromise = fetch('/api/files', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(enrichedPayload),
    });

    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
        const speedFactor = 0.94 + 0.12 * Math.sin(elapsedSec * 9);
        const currentSpeed = Math.round(baseSpeed * speedFactor);
        const transferred = Math.min(totalBytes, Math.round(elapsedSec * baseSpeed));
        const remaining = Math.max(0, totalBytes - transferred);
        const etaSec = remaining / Math.max(1, currentSpeed);
        const pct = Math.min(98, Math.round((transferred / totalBytes) * 100));

        broadcastPulse({
          id: transferId,
          fileName: payload.name,
          direction: 'upload',
          totalBytes,
          transferredBytes: transferred,
          speedBytesPerSec: currentSpeed,
          etaSeconds: etaSec,
          percentage: pct,
          status: 'transferring',
          startedAt,
          peerName: `${payload.senderName} → Room ${payload.roomCode}`,
        });

        if (transferred >= totalBytes) {
          clearInterval(timer);
          resolve();
        }
      }, 60);
    });

    const res = await uploadFetchPromise;
    if (res.ok) {
      const data = await res.json();
      const finalElapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
      broadcastPulse({
        id: transferId,
        fileId: data.file?.id,
        fileName: payload.name,
        direction: 'upload',
        totalBytes,
        transferredBytes: totalBytes,
        speedBytesPerSec: Math.round(totalBytes / finalElapsedSec),
        etaSeconds: 0,
        percentage: 100,
        status: 'completed',
        startedAt,
        elapsedSeconds: finalElapsedSec,
        peerName: `${payload.senderName} → Room ${payload.roomCode}`,
      });
      setTimeout(() => dismissTransfer(transferId), 4000);

      if (data.file) {
        setFiles((prev) => {
          if (prev.some((f) => f.id === data.file.id)) return prev;
          return [data.file, ...prev];
        });
        if (currentUser && currentUser.uid !== 'local-peer') {
          const firestoreFilePayload: Record<string, unknown> = {
            id: data.file.id,
            name: data.file.name,
            size: data.file.size,
            mimeType: data.file.mimeType,
            category: data.file.category,
            uploadedAt: data.file.uploadedAt,
            uploadDate: data.file.uploadDate,
            senderName: data.file.senderName,
            senderDevice: data.file.senderDevice,
            roomCode: data.file.roomCode,
            ownerUid: currentUser.uid,
            ownerEmail: currentUser.email,
            pinProtected: Boolean(data.file.pinProtected),
            downloads: data.file.downloads || 0,
            notes: data.file.notes || '',
            pinned: Boolean(data.file.pinned),
            favorite: Boolean(data.file.favorite),
          };
          if (data.file.textContent && data.file.textContent.length < 40000) {
            firestoreFilePayload.textContent = data.file.textContent;
          }
          if (typeof data.file.encrypted === 'boolean') {
            firestoreFilePayload.encrypted = data.file.encrypted;
          }
          if (data.file.encryptionAlgo) {
            firestoreFilePayload.encryptionAlgo = data.file.encryptionAlgo;
          }
          if (data.file.encryptionIv) {
            firestoreFilePayload.encryptionIv = data.file.encryptionIv;
          }
          if (data.file.encryptionSalt) {
            firestoreFilePayload.encryptionSalt = data.file.encryptionSalt;
          }
          if (data.file.encryptionFingerprint) {
            firestoreFilePayload.encryptionFingerprint = data.file.encryptionFingerprint;
          }
          if (data.file.keyHint) {
            firestoreFilePayload.keyHint = data.file.keyHint;
          }
          if (data.file.encryptedPayload && data.file.encryptedPayload.length < 40000) {
            firestoreFilePayload.encryptedPayload = data.file.encryptedPayload;
          }
          setDoc(doc(db, 'vault_files', data.file.id), firestoreFilePayload).catch((err) => {
            try {
              handleFirestoreError(err, OperationType.CREATE, `vault_files/${data.file.id}`);
            } catch {
              // Handled
            }
          });
        }
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
      if (data.activity) {
        recordActivitiesLocally(data.activity);
      }
      triggerToast(`Uploaded "${payload.name}" under ${payload.category}`);
    } else {
      const errData = await res.json().catch(() => ({}));
      upsertTransfer({
        id: transferId,
        fileName: payload.name,
        direction: 'upload',
        totalBytes,
        transferredBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        percentage: 0,
        status: 'error',
        startedAt,
        errorMessage: errData.error || 'Upload rejected',
      });
      setTimeout(() => dismissTransfer(transferId), 4000);
      triggerToast(errData.error || 'Unauthorized to upload file.');
      setAuthModalOpen(true);
    }
  };

  // Real-time File Download Handler with File Size & Transfer Speed Estimate Progress
  const handleDownloadFile = useCallback(
    async (file: SharedFile, pinCode?: string) => {
      const totalBytes = Math.max(1024, file.size || 1024);
      const baseSpeed = estimateTargetThroughputBytesPerSec(totalBytes);
      const transferId = `tx-down-${file.id}-${Date.now()}`;
      const startedAt = performance.now();

      upsertTransfer({
        id: transferId,
        fileId: file.id,
        fileName: file.name,
        direction: 'download',
        totalBytes,
        transferredBytes: 0,
        speedBytesPerSec: baseSpeed,
        etaSeconds: totalBytes / baseSpeed,
        percentage: 4,
        status: 'transferring',
        startedAt,
        peerName: `From ${file.senderName}`,
      });

      const actorParam = `actor=${encodeURIComponent(
        currentUser?.displayName || senderName || 'Room Peer'
      )}`;
      const pinParam =
        file.pinProtected && pinCode
          ? `?pin=${encodeURIComponent(pinCode)}&${actorParam}`
          : `?${actorParam}`;
      const downloadUrl = `/api/files/${file.id}/download${pinParam}`;

      const fetchPromise = fetch(downloadUrl).then(async (res) => {
        if (!res.ok) {
          throw new Error('Download failed or invalid PIN');
        }
        return res.blob();
      });

      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
          const speedFactor = 0.95 + 0.1 * Math.cos(elapsedSec * 8);
          const currentSpeed = Math.round(baseSpeed * speedFactor);
          const transferred = Math.min(totalBytes, Math.round(elapsedSec * baseSpeed));
          const remaining = Math.max(0, totalBytes - transferred);
          const etaSec = remaining / Math.max(1, currentSpeed);
          const pct = Math.min(98, Math.round((transferred / totalBytes) * 100));

          upsertTransfer({
            id: transferId,
            fileId: file.id,
            fileName: file.name,
            direction: 'download',
            totalBytes,
            transferredBytes: transferred,
            speedBytesPerSec: currentSpeed,
            etaSeconds: etaSec,
            percentage: pct,
            status: 'transferring',
            startedAt,
            peerName: `From ${file.senderName}`,
          });

          if (transferred >= totalBytes) {
            clearInterval(timer);
            resolve();
          }
        }, 55);
      });

      try {
        const blob = await fetchPromise;
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

        const finalElapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
        upsertTransfer({
          id: transferId,
          fileId: file.id,
          fileName: file.name,
          direction: 'download',
          totalBytes,
          transferredBytes: totalBytes,
          speedBytesPerSec: Math.round(totalBytes / finalElapsedSec),
          etaSeconds: 0,
          percentage: 100,
          status: 'completed',
          startedAt,
          elapsedSeconds: finalElapsedSec,
          peerName: `From ${file.senderName}`,
        });
        triggerToast(`Downloaded "${file.name}" (${formatBytes(file.size)})`);
        setTimeout(() => dismissTransfer(transferId), 4200);
      } catch (err) {
        upsertTransfer({
          id: transferId,
          fileId: file.id,
          fileName: file.name,
          direction: 'download',
          totalBytes,
          transferredBytes: 0,
          speedBytesPerSec: 0,
          etaSeconds: 0,
          percentage: 0,
          status: 'error',
          startedAt,
          errorMessage: err instanceof Error ? err.message : 'Download failed',
        });
        setTimeout(() => dismissTransfer(transferId), 4000);
      }
    },
    [dismissTransfer, triggerToast, upsertTransfer]
  );

  const handleUpdateFile = async (
    id: string,
    updates: {
      category?: string;
      name?: string;
      notes?: string;
      uploadDate?: string;
      pinned?: boolean;
      favorite?: boolean;
      encrypted?: boolean;
      encryptionAlgo?: string;
      encryptionIv?: string;
      encryptionSalt?: string;
      encryptionFingerprint?: string;
      encryptedPayload?: string;
      keyHint?: string;
    }
  ) => {
    const targetFile = files.find((f) => f.id === id);
    const isFavoriteToggleOnly =
      Object.keys(updates).length === 1 && typeof updates.favorite === 'boolean';
    if (!targetFile || (!isFavoriteToggleOnly && !canModifyOrDeleteFile(currentUser, targetFile))) {
      triggerToast(
        currentUser
          ? 'Only the file owner or a Vault Admin can modify this file.'
          : 'Sign in required to categorize or modify files.'
      );
      setAuthModalOpen(true);
      return;
    }

    if (typeof updates.favorite === 'boolean') {
      const nextFav = updates.favorite;
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                favorite: nextFav,
                favoritedAt: nextFav ? new Date().toISOString() : undefined,
              }
            : f
        )
      );
    }

    const res = await fetch(`/api/files/${id}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.file) {
        setFiles((prev) => prev.map((f) => (f.id === data.file.id ? data.file : f)));
        if (currentUser && currentUser.uid !== 'local-peer') {
          const updatedDocPayload: Record<string, unknown> = {
            id: data.file.id,
            name: data.file.name,
            size: data.file.size,
            mimeType: data.file.mimeType,
            category: data.file.category,
            uploadedAt: data.file.uploadedAt,
            uploadDate: data.file.uploadDate,
            ownerUid:
              data.file.ownerUid && data.file.ownerUid !== 'local-peer'
                ? data.file.ownerUid
                : currentUser.uid,
            senderName: data.file.senderName,
            senderDevice: data.file.senderDevice,
            roomCode: data.file.roomCode,
            pinProtected: Boolean(data.file.pinProtected),
            notes: data.file.notes || '',
            pinned: Boolean(data.file.pinned),
            favorite: Boolean(data.file.favorite),
          };
          if (data.file.pinnedAt) {
            updatedDocPayload.pinnedAt = data.file.pinnedAt;
          }
          if (data.file.favoritedAt) {
            updatedDocPayload.favoritedAt = data.file.favoritedAt;
          }
          if (typeof data.file.encrypted === 'boolean') {
            updatedDocPayload.encrypted = data.file.encrypted;
          }
          if (data.file.encryptionAlgo) {
            updatedDocPayload.encryptionAlgo = data.file.encryptionAlgo;
          }
          if (data.file.encryptionIv) {
            updatedDocPayload.encryptionIv = data.file.encryptionIv;
          }
          if (data.file.encryptionSalt) {
            updatedDocPayload.encryptionSalt = data.file.encryptionSalt;
          }
          if (data.file.encryptionFingerprint) {
            updatedDocPayload.encryptionFingerprint = data.file.encryptionFingerprint;
          }
          if (data.file.keyHint) {
            updatedDocPayload.keyHint = data.file.keyHint;
          }
          if (data.file.encryptedPayload && data.file.encryptedPayload.length < 40000) {
            updatedDocPayload.encryptedPayload = data.file.encryptedPayload;
          }
          setDoc(doc(db, 'vault_files', data.file.id), updatedDocPayload, {
            merge: true,
          }).catch((err) => {
            try {
              handleFirestoreError(err, OperationType.UPDATE, `vault_files/${data.file.id}`);
            } catch {
              // Handled
            }
          });
        }
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
      if (Array.isArray(data.activities)) {
        recordActivitiesLocally(data.activities);
      }
      if (typeof updates.favorite === 'boolean') {
        triggerToast(
          updates.favorite
            ? `Added "${targetFile.name}" to Favorites`
            : `Removed "${targetFile.name}" from Favorites`
        );
      } else if (typeof updates.pinned === 'boolean') {
        triggerToast(
          updates.pinned
            ? `Pinned "${targetFile.name}" to top of vault`
            : `Unpinned "${targetFile.name}" from top`
        );
      } else if (typeof updates.encrypted === 'boolean') {
        triggerToast(
          updates.encrypted
            ? `Encrypted "${targetFile.name}" with AES-256-GCM`
            : `Updated encryption state for "${targetFile.name}"`
        );
      } else if (updates.category) {
        triggerToast(`Categorized as "${updates.category}"`);
      } else if (updates.name) {
        triggerToast(`Updated "${updates.name}"`);
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      triggerToast(errData.error || 'Not authorized to modify this file.');
    }
  };

  const handleTogglePinFile = async (file: SharedFile) => {
    await handleUpdateFile(file.id, { pinned: !file.pinned });
  };

  const handleToggleFavoriteFile = async (file: SharedFile) => {
    await handleUpdateFile(file.id, { favorite: !file.favorite });
  };

  const handleBulkTogglePin = async (pinState: boolean) => {
    if (checkedFileIds.length === 0) return;
    const targets = files.filter((f) => checkedFileIds.includes(f.id));
    for (const file of targets) {
      if (Boolean(file.pinned) !== pinState) {
        await handleUpdateFile(file.id, { pinned: pinState });
      }
    }
    triggerToast(
      pinState
        ? `Pinned ${targets.length} selected ${targets.length === 1 ? 'file' : 'files'} to top`
        : `Unpinned ${targets.length} selected ${targets.length === 1 ? 'file' : 'files'}`
    );
    setCheckedFileIds([]);
    setIsMultiSelectMode(false);
  };

  const handleDeleteFile = async (id: string) => {
    const target = files.find((f) => f.id === id);
    if (!target || !canModifyOrDeleteFile(currentUser, target)) {
      triggerToast(
        currentUser
          ? 'Only the file owner or a Vault Admin can delete this file.'
          : 'Sign in required to delete files.'
      );
      setAuthModalOpen(true);
      return;
    }

    const res = await fetch(`/api/files/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.activity) {
        recordActivitiesLocally(data.activity);
      }
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setSelectedFileId(null);
      setCheckedFileIds((prev) => prev.filter((item) => item !== id));
      if (currentUser && currentUser.uid !== 'local-peer') {
        deleteDoc(doc(db, 'vault_files', id)).catch((err) => {
          try {
            handleFirestoreError(err, OperationType.DELETE, `vault_files/${id}`);
          } catch {
            // Handled
          }
        });
      }
      if (target) {
        triggerToast(`Removed "${target.name}"`);
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      triggerToast(errData.error || 'Not authorized to delete this file.');
    }
  };

  const handleToggleCheckFile = (id: string) => {
    setCheckedFileIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchDownloadZip = useCallback(async () => {
    if (checkedFileIds.length === 0 || isBatchZipping) return;
    const selectedFiles = files.filter((f) => checkedFileIds.includes(f.id));
    if (selectedFiles.length === 0) return;

    setIsBatchZipping(true);
    const safeRoom = (roomCode || 'vault').replace(/[^a-zA-Z0-9_-]/g, '-');
    const archiveName = `relaydrop-room-${safeRoom}-${selectedFiles.length}-${
      selectedFiles.length === 1 ? 'file' : 'files'
    }-${getTodayIsoDate()}.zip`;

    const totalBytes = Math.max(
      2048,
      selectedFiles.reduce((sum, f) => sum + (f.size || 1024), 0)
    );
    const baseSpeed = estimateTargetThroughputBytesPerSec(totalBytes);
    const transferId = `tx-zip-${Date.now()}`;
    const startedAt = performance.now();

    upsertTransfer({
      id: transferId,
      fileName: archiveName,
      direction: 'download',
      totalBytes,
      transferredBytes: 0,
      speedBytesPerSec: baseSpeed,
      etaSeconds: totalBytes / baseSpeed,
      percentage: 5,
      status: 'transferring',
      startedAt,
      peerName: `Batch ZIP (${selectedFiles.length} ${
        selectedFiles.length === 1 ? 'file' : 'files'
      })`,
    });

    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();

      const getUniqueEntryName = (rawName: string): string => {
        const cleaned = (rawName || 'shared-file').replace(/[\\/]/g, '_');
        if (!usedNames.has(cleaned.toLowerCase())) {
          usedNames.add(cleaned.toLowerCase());
          return cleaned;
        }
        const dotIdx = cleaned.lastIndexOf('.');
        const stem = dotIdx > 0 ? cleaned.slice(0, dotIdx) : cleaned;
        const ext = dotIdx > 0 ? cleaned.slice(dotIdx) : '';
        let counter = 2;
        while (usedNames.has(`${stem}-${counter}${ext}`.toLowerCase())) {
          counter += 1;
        }
        const unique = `${stem}-${counter}${ext}`;
        usedNames.add(unique.toLowerCase());
        return unique;
      };

      let accumulatedBytes = 0;

      for (let i = 0; i < selectedFiles.length; i += 1) {
        const file = selectedFiles[i];
        const entryName = getUniqueEntryName(file.name);
        let addedToZip = false;

        // 1. Check inline base64 dataUrl
        if (file.dataUrl && file.dataUrl.startsWith('data:')) {
          const base64Match = file.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (base64Match && base64Match[2]) {
            zip.file(entryName, base64Match[2], { base64: true });
            addedToZip = true;
          }
        }

        // 2. Check inline textContent
        if (!addedToZip && typeof file.textContent === 'string' && file.textContent.length > 0) {
          zip.file(entryName, file.textContent);
          addedToZip = true;
        }

        // 3. Try fetching binary blob from server endpoint or previewUrl
        if (!addedToZip) {
          try {
            const actorParam = `actor=${encodeURIComponent(
              currentUser?.displayName || senderName || 'Room Peer'
            )}`;
            const dlUrl = file.pinProtected
              ? `/api/files/${encodeURIComponent(file.id)}/download?pin=2026&${actorParam}`
              : `/api/files/${encodeURIComponent(file.id)}/download?${actorParam}`;
            const res = await fetch(dlUrl);
            if (res.ok) {
              const arrayBuffer = await res.arrayBuffer();
              zip.file(entryName, arrayBuffer);
              addedToZip = true;
            } else if (file.previewUrl) {
              const previewRes = await fetch(file.previewUrl);
              if (previewRes.ok) {
                const arrayBuffer = await previewRes.arrayBuffer();
                zip.file(entryName, arrayBuffer);
                addedToZip = true;
              }
            }
          } catch {
            // Fallback below if offline
          }
        }

        // 4. Fallback synthesized content if offline
        if (!addedToZip) {
          const fallbackText =
            resolveTextContent(file) ||
            `RelayDrop Shared File: ${file.name}\nCategory: ${file.category}\nSize: ${formatBytes(
              file.size
            )}\nUploaded: ${file.uploadDate}\nShared by: ${file.senderName} (${
              file.senderDevice
            })\nRoom: ${file.roomCode}\nNotes: ${file.notes || 'None'}\n`;
          zip.file(entryName, fallbackText);
        }

        accumulatedBytes += Math.max(512, file.size || 1024);
        const elapsedSec = Math.max(0.08, (performance.now() - startedAt) / 1000);
        const currentSpeed = Math.round(
          Math.max(baseSpeed * 0.9, accumulatedBytes / elapsedSec)
        );
        const remaining = Math.max(0, totalBytes - accumulatedBytes);
        const pct = Math.min(
          92,
          Math.max(12, Math.round((accumulatedBytes / totalBytes) * 90))
        );

        upsertTransfer({
          id: transferId,
          fileName: archiveName,
          direction: 'download',
          totalBytes,
          transferredBytes: Math.min(totalBytes, accumulatedBytes),
          speedBytesPerSec: currentSpeed,
          etaSeconds: remaining / Math.max(1, currentSpeed),
          percentage: pct,
          status: 'transferring',
          startedAt,
          peerName: `Zipping ${i + 1}/${selectedFiles.length}: ${file.name}`,
        });

        // Brief yield so progress UI updates smoothly
        await new Promise((r) => setTimeout(r, 45));
      }

      // Include structured manifest inside the ZIP archive
      const manifestPayload = {
        archiveName,
        roomCode,
        exportedAt: new Date().toISOString(),
        exportedBy: currentUser?.displayName || senderName,
        totalFiles: selectedFiles.length,
        totalUncompressedBytes: selectedFiles.reduce((s, f) => s + f.size, 0),
        files: selectedFiles.map((f) => ({
          id: f.id,
          name: f.name,
          category: f.category,
          size: f.size,
          formattedSize: formatBytes(f.size),
          mimeType: f.mimeType,
          uploadDate: f.uploadDate,
          senderName: f.senderName,
          senderDevice: f.senderDevice,
          notes: f.notes || '',
        })),
      };
      zip.file('relaydrop-manifest.json', JSON.stringify(manifestPayload, null, 2));

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      const objectUrl = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = archiveName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 6000);

      // Record batch download on server & update download counters + activity log
      fetch('/api/files/batch-download', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          ids: selectedFiles.map((f) => f.id),
          archiveName,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          if (Array.isArray(data.files) && data.files.length > 0) {
            const updatedMap = new Map<string, SharedFile>(
              data.files.map((u: SharedFile) => [u.id, u])
            );
            setFiles((prev) =>
              prev.map((existing) => updatedMap.get(existing.id) || existing)
            );
          }
          if (data.activity) {
            recordActivitiesLocally(data.activity);
          }
        })
        .catch(() => {});

      const finalElapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
      upsertTransfer({
        id: transferId,
        fileName: archiveName,
        direction: 'download',
        totalBytes,
        transferredBytes: totalBytes,
        speedBytesPerSec: Math.round(totalBytes / finalElapsedSec),
        etaSeconds: 0,
        percentage: 100,
        status: 'completed',
        startedAt,
        elapsedSeconds: finalElapsedSec,
        peerName: `Packed ${selectedFiles.length} ${
          selectedFiles.length === 1 ? 'file' : 'files'
        } (${formatBytes(zipBlob.size)} ZIP)`,
      });
      setTimeout(() => dismissTransfer(transferId), 4500);

      triggerToast(
        `Downloaded ${selectedFiles.length} ${
          selectedFiles.length === 1 ? 'file' : 'files'
        } as ZIP (${formatBytes(zipBlob.size)})`
      );
      setCheckedFileIds([]);
      setIsMultiSelectMode(false);
    } catch (err) {
      upsertTransfer({
        id: transferId,
        fileName: archiveName,
        direction: 'download',
        totalBytes,
        transferredBytes: 0,
        speedBytesPerSec: 0,
        etaSeconds: 0,
        percentage: 0,
        status: 'error',
        startedAt,
        errorMessage: err instanceof Error ? err.message : 'Batch ZIP failed',
      });
      setTimeout(() => dismissTransfer(transferId), 4000);
      triggerToast('Failed to generate batch ZIP archive.');
    } finally {
      setIsBatchZipping(false);
    }
  }, [
    checkedFileIds,
    currentUser,
    dismissTransfer,
    files,
    getAuthHeaders,
    isBatchZipping,
    recordActivitiesLocally,
    roomCode,
    senderName,
    triggerToast,
    upsertTransfer,
  ]);

  const handleCreateExpiringShareBundle = useCallback(
    async (overrideTtlMinutes?: number) => {
      const targetIds =
        checkedFileIds.length > 0
          ? checkedFileIds
          : activeShareBundle?.fileIds || [];
      if (targetIds.length === 0 || isGeneratingShareBundle) return;

      if (!canUploadOrCreateCategory(currentUser)) {
        triggerToast(
          currentUser
            ? 'Viewer role cannot create expiring share links. Switch to Editor or Admin.'
            : 'Sign in required to generate shareable bundle links.'
        );
        setAuthModalOpen(true);
        return;
      }

      const selectedFiles = files.filter((f) => targetIds.includes(f.id));
      if (selectedFiles.length === 0) return;

      const ttlToUse = overrideTtlMinutes || bundleTtlMinutes || 60;
      setBundleTtlMinutes(ttlToUse);
      setShareBundleModalOpen(true);
      setIsGeneratingShareBundle(true);

      try {
        const safeRoom = (roomCode || 'vault').replace(/[^a-zA-Z0-9_-]/g, '-');
        const archiveName = `relaydrop-bundle-${safeRoom}-${selectedFiles.length}-${
          selectedFiles.length === 1 ? 'file' : 'files'
        }.zip`;

        const res = await fetch('/api/bundles/create', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            ids: targetIds,
            ttlMinutes: ttlToUse,
            archiveName,
            origin: window.location.origin,
            files: selectedFiles,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to bundle selected files on server.');
        }

        const data = await res.json();
        let createdBundle: SharedBundle = data.bundle;

        if (data.activity) {
          recordActivitiesLocally(data.activity);
        }

        // Write expiring link record to Firebase Firestore shared_bundles/{bundleId}
        const fbUser = auth.currentUser;
        const ownerUidToSave =
          fbUser?.uid ||
          (currentUser?.uid && currentUser.uid !== 'local-peer'
            ? currentUser.uid
            : 'local-peer');

        const firestoreBundleDoc: Record<string, unknown> = {
          id: createdBundle.id,
          archiveName: createdBundle.archiveName,
          roomCode: createdBundle.roomCode || roomCode,
          createdBy: createdBundle.createdBy || currentUser?.displayName || senderName,
          ownerUid: ownerUidToSave,
          createdByDevice: createdBundle.createdByDevice || senderDevice,
          createdAt: createdBundle.createdAt,
          expiresAt: createdBundle.expiresAt,
          ttlMinutes: createdBundle.ttlMinutes,
          fileIds: createdBundle.fileIds,
          fileNames: createdBundle.fileNames,
          fileCount: createdBundle.fileCount,
          totalBytes: createdBundle.totalBytes,
          bundleZipBytes: createdBundle.bundleZipBytes || createdBundle.totalBytes,
          downloads: createdBundle.downloads || 0,
          revoked: false,
          shareUrl:
            createdBundle.shareUrl ||
            `${window.location.origin}/?bundle=${encodeURIComponent(createdBundle.id)}`,
          downloadUrl:
            createdBundle.downloadUrl ||
            `${window.location.origin}/api/bundles/${encodeURIComponent(createdBundle.id)}/download`,
        };

        if (fbUser) {
          try {
            await setDoc(
              doc(db, 'shared_bundles', createdBundle.id),
              firestoreBundleDoc,
              { merge: true }
            );
            createdBundle = { ...createdBundle, firestoreSynced: true };
          } catch (fbErr) {
            try {
              handleFirestoreError(
                fbErr,
                OperationType.WRITE,
                `shared_bundles/${createdBundle.id}`
              );
            } catch {
              // Handled structured log
            }
          }
        }

        setActiveShareBundle(createdBundle);
        setSharedBundles((prev) => {
          const rest = prev.filter((b) => b.id !== createdBundle.id);
          return [createdBundle, ...rest];
        });

        if (createdBundle.shareUrl) {
          try {
            await navigator.clipboard.writeText(createdBundle.shareUrl);
          } catch {
            // Clipboard fallback ignored
          }
        }

        triggerToast(
          `Created expiring bundle URL for ${createdBundle.fileCount} ${
            createdBundle.fileCount === 1 ? 'file' : 'files'
          } (copied to clipboard)`
        );
      } catch (err) {
        triggerToast(
          err instanceof Error
            ? err.message
            : 'Could not generate temporary shareable bundle link.'
        );
      } finally {
        setIsGeneratingShareBundle(false);
      }
    },
    [
      activeShareBundle,
      bundleTtlMinutes,
      checkedFileIds,
      currentUser,
      files,
      getAuthHeaders,
      isGeneratingShareBundle,
      recordActivitiesLocally,
      roomCode,
      senderDevice,
      senderName,
      triggerToast,
    ]
  );

  const handleUpdateBundleTtl = useCallback(
    async (minutes: number) => {
      if (!activeShareBundle) return;
      const nextExpiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

      try {
        const res = await fetch(
          `/api/bundles/${encodeURIComponent(activeShareBundle.id)}`,
          {
            method: 'PATCH',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              ttlMinutes: minutes,
              expiresAt: nextExpiresAt,
            }),
          }
        );

        let updatedBundle: SharedBundle = {
          ...activeShareBundle,
          ttlMinutes: minutes,
          expiresAt: nextExpiresAt,
        };
        if (res.ok) {
          const data = await res.json();
          if (data.bundle) {
            updatedBundle = { ...updatedBundle, ...data.bundle };
          }
        }

        if (auth.currentUser) {
          try {
            await setDoc(
              doc(db, 'shared_bundles', updatedBundle.id),
              {
                ttlMinutes: minutes,
                expiresAt: nextExpiresAt,
              },
              { merge: true }
            );
            updatedBundle.firestoreSynced = true;
          } catch {
            // Ignore Firestore update error when offline
          }
        }

        setActiveShareBundle(updatedBundle);
        setSharedBundles((prev) =>
          prev.map((b) => (b.id === updatedBundle.id ? updatedBundle : b))
        );
        setRecipientLandingBundle((prev) =>
          prev && prev.id === updatedBundle.id ? updatedBundle : prev
        );
        triggerToast(`Updated bundle link expiration to ${minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`}`);
      } catch {
        triggerToast('Failed to update bundle expiration window.');
      }
    },
    [activeShareBundle, getAuthHeaders, triggerToast]
  );

  const handleRevokeShareBundle = useCallback(
    async (bundleId: string) => {
      try {
        await fetch(`/api/bundles/${encodeURIComponent(bundleId)}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ revoked: true }),
        });

        if (auth.currentUser) {
          try {
            await setDoc(
              doc(db, 'shared_bundles', bundleId),
              { revoked: true },
              { merge: true }
            );
          } catch {
            // Handled
          }
        }

        setActiveShareBundle((prev) =>
          prev && prev.id === bundleId ? { ...prev, revoked: true } : prev
        );
        setSharedBundles((prev) =>
          prev.map((b) => (b.id === bundleId ? { ...b, revoked: true } : b))
        );
        setRecipientLandingBundle((prev) =>
          prev && prev.id === bundleId ? { ...prev, revoked: true } : prev
        );
        triggerToast('Revoked temporary shareable bundle link');
      } catch {
        triggerToast('Could not revoke bundle link.');
      }
    },
    [getAuthHeaders, triggerToast]
  );

  const handleDownloadBundleZip = useCallback(
    (bundle: SharedBundle) => {
      if (bundle.revoked) {
        triggerToast('This temporary shareable bundle link has been revoked.');
        return;
      }
      if (new Date(bundle.expiresAt).getTime() <= Date.now()) {
        triggerToast('This temporary shareable bundle link has expired.');
        return;
      }

      const query = new URLSearchParams({
        fileIds: bundle.fileIds.join(','),
        expiresAt: bundle.expiresAt,
        archiveName: bundle.archiveName,
        revoked: String(Boolean(bundle.revoked)),
        actor: currentUser?.displayName || senderName || 'Bundle Recipient',
      });

      const dlLink = document.createElement('a');
      dlLink.href = `/api/bundles/${encodeURIComponent(bundle.id)}/download?${query.toString()}`;
      dlLink.download = bundle.archiveName;
      document.body.appendChild(dlLink);
      dlLink.click();
      document.body.removeChild(dlLink);

      if (auth.currentUser) {
        setDoc(
          doc(db, 'shared_bundles', bundle.id),
          { downloads: (bundle.downloads || 0) + 1 },
          { merge: true }
        ).catch(() => {});
      }

      triggerToast(`Downloading bundled ZIP "${bundle.archiveName}"`);
    },
    [currentUser, senderName, triggerToast]
  );

  const handleConfirmBulkDelete = async () => {
    if (checkedFileIds.length === 0 || isBulkDeleting) return;
    if (!currentUser || currentUser.role === 'viewer') {
      setConfirmBulkDeleteOpen(false);
      triggerToast(
        currentUser
          ? 'Viewer role cannot delete files. Elevate to Editor or Admin.'
          : 'Sign in required to perform bulk deletion.'
      );
      setAuthModalOpen(true);
      return;
    }

    setIsBulkDeleting(true);
    try {
      const idsToDelete = [...checkedFileIds];
      const res = await fetch('/api/files/bulk-delete', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ ids: idsToDelete }),
      });
      if (res.ok) {
        const data = await res.json();
        const actualDeletedIds: string[] = Array.isArray(data.ids)
          ? data.ids
          : idsToDelete;
        const removedSet = new Set(actualDeletedIds);
        setFiles((prev) => prev.filter((f) => !removedSet.has(f.id)));
        if (selectedFileId && removedSet.has(selectedFileId)) {
          setSelectedFileId(null);
        }
        if (currentUser && currentUser.uid !== 'local-peer') {
          for (const remId of actualDeletedIds) {
            deleteDoc(doc(db, 'vault_files', remId)).catch((err) => {
              try {
                handleFirestoreError(err, OperationType.DELETE, `vault_files/${remId}`);
              } catch {
                // Handled
              }
            });
          }
        }
        if (Array.isArray(data.activities)) {
          recordActivitiesLocally(data.activities);
        }
        setCheckedFileIds([]);
        setConfirmBulkDeleteOpen(false);
        setIsMultiSelectMode(false);
        triggerToast(
          `Deleted ${actualDeletedIds.length} ${actualDeletedIds.length === 1 ? 'file' : 'files'} from vault`
        );
      } else {
        const errData = await res.json().catch(() => ({}));
        setConfirmBulkDeleteOpen(false);
        triggerToast(errData.error || 'You do not have permission to delete the selected files.');
        setAuthModalOpen(true);
      }
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleAddCategory = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!canUploadOrCreateCategory(currentUser)) {
      triggerToast(
        currentUser
          ? 'Viewer role cannot create categories. Switch to Editor or Admin.'
          : 'Sign in required to create custom categories.'
      );
      setAuthModalOpen(true);
      return;
    }

    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
      if (data.activity) {
        recordActivitiesLocally(data.activity);
      }
      if (currentUser) {
        const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        setDoc(doc(db, 'categories', slug || `cat-${Date.now()}`), {
          name: trimmed,
          createdByUid: currentUser.uid,
          createdAt: new Date().toISOString(),
        }).catch(() => {});
      }
      triggerToast(`Category "${trimmed}" added`);
    } else {
      const errData = await res.json().catch(() => ({}));
      triggerToast(errData.error || 'Not authorized to create categories.');
    }
  };

  const handleCreateInlineCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryInput.trim()) return;
    const created = newCategoryInput.trim();
    await handleAddCategory(created);
    setSelectedCategory(created);
    setNewCategoryInput('');
    setShowAddCategoryInline(false);
  };

  const pinnedCount = useMemo(
    () => files.filter((f) => Boolean(f.pinned)).length,
    [files]
  );

  const encryptedCount = useMemo(
    () => files.filter((f) => Boolean(f.encrypted)).length,
    [files]
  );

  const favoritesCount = useMemo(
    () => files.filter((f) => Boolean(f.favorite)).length,
    [files]
  );

  const favoritesTotalSize = useMemo(
    () =>
      files
        .filter((f) => Boolean(f.favorite))
        .reduce((acc, f) => acc + (f.size || 0), 0),
    [files]
  );

  // Filtered and sorted files with search match attribution (Pinned files always appear at the top)
  const filteredResults = useMemo(() => {
    const evaluated = files
      .map((file) => {
        const result = evaluateFileSearch(
          file,
          searchQuery,
          selectedCategory,
          datePreset,
          customDateFilter
        );
        return { file, ...result };
      })
      .filter(
        (item) =>
          item.matches &&
          (!showPinnedOnly || Boolean(item.file.pinned)) &&
          (!showEncryptedOnly || Boolean(item.file.encrypted)) &&
          (activeTab !== 'favorites' || Boolean(item.file.favorite))
      );

    evaluated.sort((a, b) => {
      const aPinned = Boolean(a.file.pinned);
      const bPinned = Boolean(b.file.pinned);
      if (aPinned !== bPinned) {
        return aPinned ? -1 : 1;
      }

      if (sortBy === 'newest') {
        return (
          b.file.uploadDate.localeCompare(a.file.uploadDate) ||
          b.file.uploadedAt.localeCompare(a.file.uploadedAt)
        );
      }
      if (sortBy === 'oldest') {
        return (
          a.file.uploadDate.localeCompare(b.file.uploadDate) ||
          a.file.uploadedAt.localeCompare(b.file.uploadedAt)
        );
      }
      if (sortBy === 'largest') {
        return b.file.size - a.file.size;
      }
      return a.file.name.localeCompare(b.file.name);
    });

    return evaluated;
  }, [
    files,
    searchQuery,
    selectedCategory,
    datePreset,
    customDateFilter,
    sortBy,
    showPinnedOnly,
    showEncryptedOnly,
    activeTab,
  ]);

  // Category counts for filter tabs
  const categoryCounts = useMemo(() => {
    const sourceFiles =
      activeTab === 'favorites'
        ? files.filter((f) => Boolean(f.favorite))
        : files;
    const counts: Record<string, number> = { All: sourceFiles.length };
    for (const cat of categories) {
      counts[cat] = 0;
    }
    for (const f of sourceFiles) {
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    return counts;
  }, [activeTab, files, categories]);

  const previewModalFile = useMemo(
    () => files.find((f) => f.id === previewModalFileId) || null,
    [files, previewModalFileId]
  );

  const previewFileIndex = useMemo(() => {
    if (!previewModalFileId) return -1;
    return filteredResults.findIndex((r) => r.file.id === previewModalFileId);
  }, [filteredResults, previewModalFileId]);

  const hasPrevPreviewFile = previewFileIndex > 0;
  const hasNextPreviewFile =
    previewFileIndex !== -1 && previewFileIndex < filteredResults.length - 1;

  const handlePrevPreviewFile = useCallback(() => {
    if (previewFileIndex > 0) {
      setPreviewModalFileId(filteredResults[previewFileIndex - 1].file.id);
    }
  }, [filteredResults, previewFileIndex]);

  const handleNextPreviewFile = useCallback(() => {
    if (previewFileIndex !== -1 && previewFileIndex < filteredResults.length - 1) {
      setPreviewModalFileId(filteredResults[previewFileIndex + 1].file.id);
    }
  }, [filteredResults, previewFileIndex]);

  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) || null,
    [files, selectedFileId]
  );

  const qrModalFile = useMemo(
    () => files.find((f) => f.id === qrModalFileId) || null,
    [files, qrModalFileId]
  );

  const [qrModalBatchMode, setQrModalBatchMode] = useState<boolean>(false);
  const [qrQualityLevel, setQrQualityLevel] = useState<QrErrorCorrectionLevel>('M');
  const [qrLabelTemplate, setQrLabelTemplate] = useState<'Minimalist' | 'Detailed' | 'Compact'>('Detailed');
  const [includeQrLogo, setIncludeQrLogo] = useState<boolean>(false);
  const [qrScanHistory, setQrScanHistory] = useState<ScannedFileHistoryEntry[]>(() =>
    loadScanHistory([])
  );
  const [sessionQrPrintLog, setSessionQrPrintLog] = useState<SessionQrPrintEvent[]>([]);
  const [selectedPrintHistoryIds, setSelectedPrintHistoryIds] = useState<string[]>([]);
  const [printHistorySearchQuery, setPrintHistorySearchQuery] = useState<string>('');
  const [printHistoryDateStart, setPrintHistoryDateStart] = useState<string>('');
  const [printHistoryDateEnd, setPrintHistoryDateEnd] = useState<string>('');
  const hasSeededSessionPrintLogRef = useRef<boolean>(false);
  const [recentQrPrints, setRecentQrPrints] = useState<RecentQrPrintEntry[]>(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_QR_PRINTS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, MAX_RECENT_QR_PRINTS);
        }
      }
    } catch {
      // Ignore storage read error
    }
    return [];
  });

  // Seed recent prints from initial vault files once if none have been recorded in localStorage yet
  useEffect(() => {
    if (hasSeededRecentPrintsRef.current) return;
    if (files.length === 0) return;
    hasSeededRecentPrintsRef.current = true;

    try {
      if (window.localStorage.getItem(RECENT_QR_PRINTS_STORAGE_KEY) !== null) {
        return;
      }
    } catch {
      // Ignore storage read error
    }

    if (recentQrPrints.length === 0) {
      const now = Date.now();
      const seeded: RecentQrPrintEntry[] = files
        .slice(0, MAX_RECENT_QR_PRINTS)
        .map((f, idx) => ({
          fileId: f.id,
          fileName: f.name,
          category: f.category,
          size: f.size,
          sizeLabel: formatBytes(f.size),
          roomCode: f.roomCode || roomCode,
          senderName: f.senderName,
          uploadDate: f.uploadDate,
          encrypted: f.encrypted,
          encryptionFingerprint: f.encryptionFingerprint,
          pinProtected: f.pinProtected,
          notes: f.notes,
          printedAt: new Date(now - (idx + 1) * 18 * 60 * 1000).toISOString(),
          printCount: 1,
        }));
      setRecentQrPrints(seeded);
      try {
        window.localStorage.setItem(
          RECENT_QR_PRINTS_STORAGE_KEY,
          JSON.stringify(seeded)
        );
      } catch {
        // Ignore storage write error
      }
    }
  }, [files, recentQrPrints.length, roomCode]);

  const recordFilesInRecentQrPrints = useCallback(
    (
      printedFiles: SharedFile[],
      mode: '4×6" Card' | 'Batch Sheet' | 'Re-print' = '4×6" Card'
    ) => {
      if (!printedFiles || printedFiles.length === 0) return;
      const nowIso = new Date().toISOString();

      setSessionQrPrintLog((prev) => {
        const newEvents: SessionQrPrintEvent[] = printedFiles.map((f, i) => ({
          id: `print-evt-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          fileId: f.id,
          fileName: f.name,
          category: f.category,
          size: f.size,
          sizeLabel: formatBytes(f.size),
          roomCode: f.roomCode || roomCode,
          senderName: f.senderName,
          qualityLevel: qrQualityLevel,
          printMode: mode,
          timestamp: nowIso,
        }));
        return [...newEvents, ...prev];
      });

      setRecentQrPrints((prev) => {
        let updatedList = [...prev];
        for (const f of [...printedFiles].reverse()) {
          const existing = updatedList.find((item) => item.fileId === f.id);
          const nextEntry: RecentQrPrintEntry = {
            fileId: f.id,
            fileName: f.name,
            category: f.category,
            size: f.size,
            sizeLabel: formatBytes(f.size),
            roomCode: f.roomCode || roomCode,
            senderName: f.senderName,
            uploadDate: f.uploadDate,
            encrypted: f.encrypted,
            encryptionFingerprint: f.encryptionFingerprint,
            pinProtected: f.pinProtected,
            notes: f.notes,
            printedAt: nowIso,
            printCount: (existing?.printCount || 0) + 1,
          };
          updatedList = [
            nextEntry,
            ...updatedList.filter((item) => item.fileId !== f.id),
          ];
        }
        const trimmed = updatedList.slice(0, MAX_RECENT_QR_PRINTS);
        try {
          window.localStorage.setItem(
            RECENT_QR_PRINTS_STORAGE_KEY,
            JSON.stringify(trimmed)
          );
        } catch {
          // Ignore storage write error
        }
        return trimmed;
      });
    },
    [qrQualityLevel, roomCode]
  );

  // Refresh scan history from localStorage / seed from files whenever QR modal opens or files load
  useEffect(() => {
    if (files.length === 0) return;
    setQrScanHistory(loadScanHistory(files));
  }, [files, qrModalFileId, qrScannerOpen]);

  // Seed initial session print log entry once when files load so Print History shows activity at a glance
  useEffect(() => {
    if (hasSeededSessionPrintLogRef.current || files.length === 0) return;
    hasSeededSessionPrintLogRef.current = true;
    const now = Date.now();
    const initialEvents: SessionQrPrintEvent[] = files.slice(0, 3).map((f, idx) => ({
      id: `session-seed-${f.id}-${idx}`,
      fileId: f.id,
      fileName: f.name,
      category: f.category,
      size: f.size,
      sizeLabel: formatBytes(f.size),
      roomCode: f.roomCode || roomCode,
      senderName: f.senderName,
      qualityLevel: 'M',
      printMode: '4×6" Card',
      timestamp: new Date(now - (idx + 1) * 6 * 60 * 1000).toISOString(),
    }));
    setSessionQrPrintLog(initialEvents);
  }, [files, roomCode]);

  const batchQrFiles = useMemo(() => {
    if (checkedFileIds.length > 0) {
      return files.filter((f) => checkedFileIds.includes(f.id));
    }
    if (qrModalFile) {
      const rest = files.filter((f) => f.id !== qrModalFile.id).slice(0, 5);
      return [qrModalFile, ...rest];
    }
    return files.slice(0, 6);
  }, [checkedFileIds, files, qrModalFile]);

  const handleBatchPrintSelectedQrCards = useCallback(() => {
    const selected =
      checkedFileIds.length > 0
        ? files.filter((f) => checkedFileIds.includes(f.id))
        : batchQrFiles;

    if (selected.length === 0) {
      triggerToast('Select at least one file to batch print QR index cards.');
      return;
    }

    const batchItems = selected.map((file) => ({
      value: buildFileQrPayloadUrl({
        fileId: file.id,
        roomCode: file.roomCode || roomCode,
      }),
      fileName: file.name,
      category: file.category,
      sizeLabel: formatBytes(file.size),
      roomCode: file.roomCode || roomCode,
      senderName: file.senderName,
      uploadDate: file.uploadDate,
      encrypted: file.encrypted,
      encryptionFingerprint: file.encryptionFingerprint,
      pinProtected: file.pinProtected,
      notes: file.notes,
    }));

    setQrModalBatchMode(true);
    if (!qrModalFileId && selected[0]) {
      setQrModalFileId(selected[0].id);
    }

    printBatchFileQrIndexCards(batchItems, roomCode);
    recordFilesInRecentQrPrints(selected, 'Batch Sheet');
    triggerToast(
      `Opening Batch Print dialog for ${selected.length} QR index ${
        selected.length === 1 ? 'card' : 'cards'
      }`
    );
  }, [batchQrFiles, checkedFileIds, files, qrModalFileId, recordFilesInRecentQrPrints, roomCode, triggerToast]);

  // Sync the 4x6 inch index card or batch index card print sheet whenever the QR generator modal is open
  useEffect(() => {
    if (!qrModalFile) {
      clearQrIndexCardPrintMode();
      return;
    }

    if (qrModalBatchMode && batchQrFiles.length > 0) {
      const batchItems = batchQrFiles.map((file) => ({
        value: buildFileQrPayloadUrl({
          fileId: file.id,
          roomCode: file.roomCode || roomCode,
        }),
        fileName: file.name,
        category: file.category,
        sizeLabel: formatBytes(file.size),
        roomCode: file.roomCode || roomCode,
        senderName: file.senderName,
        uploadDate: file.uploadDate,
        encrypted: file.encrypted,
        encryptionFingerprint: file.encryptionFingerprint,
        pinProtected: file.pinProtected,
        notes: file.notes,
      }));
      prepareBatchQrIndexCardPrintSheet(batchItems, roomCode);
      document.body.setAttribute('data-print-mode', 'qr-batch-sheet');
      return () => {
        clearQrIndexCardPrintMode();
      };
    }

    const fileQrUrl = buildFileQrPayloadUrl({
      fileId: qrModalFile.id,
      roomCode,
    });
    prepareQrIndexCardPrintSheet({
      value: fileQrUrl,
      fileName: qrModalFile.name,
      category: qrModalFile.category,
      sizeLabel: formatBytes(qrModalFile.size),
      roomCode,
      senderName: qrModalFile.senderName,
      uploadDate: qrModalFile.uploadDate,
      encrypted: qrModalFile.encrypted,
      encryptionFingerprint: qrModalFile.encryptionFingerprint,
      pinProtected: qrModalFile.pinProtected,
      notes: qrModalFile.notes,
    });
    document.body.setAttribute('data-print-mode', 'qr-4x6');

    return () => {
      clearQrIndexCardPrintMode();
    };
  }, [batchQrFiles, qrModalBatchMode, qrModalFile, roomCode]);

  const activePairingQrFile = useMemo(
    () =>
      files.find((f) => f.id === pairingQrFileId) ||
      (files.length > 0 ? files[0] : null),
    [files, pairingQrFileId]
  );

  // Compute Prev / Next file navigation inside filteredResults
  const selectedFileIndex = useMemo(() => {
    if (!selectedFileId) return -1;
    return filteredResults.findIndex((r) => r.file.id === selectedFileId);
  }, [filteredResults, selectedFileId]);

  const hasPrevFile = selectedFileIndex > 0;
  const hasNextFile =
    selectedFileIndex !== -1 && selectedFileIndex < filteredResults.length - 1;

  const handlePrevFile = useCallback(() => {
    if (selectedFileIndex > 0) {
      setSelectedFileId(filteredResults[selectedFileIndex - 1].file.id);
    }
  }, [filteredResults, selectedFileIndex]);

  const handleNextFile = useCallback(() => {
    if (selectedFileIndex !== -1 && selectedFileIndex < filteredResults.length - 1) {
      setSelectedFileId(filteredResults[selectedFileIndex + 1].file.id);
    }
  }, [filteredResults, selectedFileIndex]);

  const totalVaultSize = useMemo(
    () => files.reduce((acc, f) => acc + f.size, 0),
    [files]
  );

  const topStorageCategory = useMemo(() => {
    if (files.length === 0 || totalVaultSize <= 0) return null;
    const byCat: Record<string, number> = {};
    for (const f of files) {
      const cat = f.category || 'Uncategorized';
      byCat[cat] = (byCat[cat] || 0) + (f.size || 0);
    }
    let bestCat = '';
    let bestBytes = 0;
    for (const [cat, bytes] of Object.entries(byCat)) {
      if (bytes > bestBytes) {
        bestBytes = bytes;
        bestCat = cat;
      }
    }
    if (!bestCat) return null;
    const sharePercent = Math.round((bestBytes / totalVaultSize) * 1000) / 10;
    return { category: bestCat, bytes: bestBytes, sharePercent };
  }, [files, totalVaultSize]);

  // Soft storage limit for room vault (25 MB)
  const softStorageLimitBytes = 25 * 1024 * 1024;
  const storageUsagePercent = useMemo(() => {
    if (totalVaultSize <= 0) return 0;
    return Math.round((totalVaultSize / softStorageLimitBytes) * 1000) / 10;
  }, [totalVaultSize, softStorageLimitBytes]);
  const clampedStorageRatio = Math.min(1, totalVaultSize / softStorageLimitBytes);

  const oldestVaultFile = useMemo(() => {
    if (files.length === 0) return null;
    return [...files].sort(
      (a, b) =>
        a.uploadDate.localeCompare(b.uploadDate) ||
        a.uploadedAt.localeCompare(b.uploadedAt) ||
        b.size - a.size
    )[0];
  }, [files]);

  // Automatically clear or update the 25MB soft storage limit notification when old files are deleted
  useEffect(() => {
    if (!storageLimitNotification) return;
    const liveProjected = totalVaultSize + storageLimitNotification.attemptedBytes;
    if (liveProjected <= softStorageLimitBytes) {
      setStorageLimitNotification(null);
      triggerToast(
        'Vault space freed! Storage is now within the 25 MB soft limit — you may proceed with your upload.'
      );
    } else if (storageLimitNotification.currentVaultBytes !== totalVaultSize) {
      setStorageLimitNotification((prev) =>
        prev
          ? {
              ...prev,
              currentVaultBytes: totalVaultSize,
              projectedTotalBytes: liveProjected,
              overageBytes: Math.max(0, liveProjected - softStorageLimitBytes),
            }
          : null
      );
    }
  }, [totalVaultSize, softStorageLimitBytes, storageLimitNotification, triggerToast]);

  const handleStorageLimitExceededAttempt = useCallback(
    (info: StorageLimitAttemptInfo) => {
      setStorageLimitNotification(info);
    },
    []
  );

  const handleManageOldFilesInVault = useCallback(() => {
    setQuickUploadModalOpen(false);
    setSearchQuery('');
    setSelectedCategory('All');
    setDatePreset('all');
    setCustomDateFilter('');
    setShowPinnedOnly(false);
    setShowEncryptedOnly(false);
    setSortBy('oldest');
    setActiveTab('vault');
    setIsMultiSelectMode(true);
    if (files.length > 0) {
      const oldestSorted = [...files].sort(
        (a, b) =>
          a.uploadDate.localeCompare(b.uploadDate) ||
          a.uploadedAt.localeCompare(b.uploadedAt)
      );
      if (oldestSorted[0]) {
        setCheckedFileIds([oldestSorted[0].id]);
      }
    }
    triggerToast('Sorted vault by oldest files — select and delete old files to free space.');
  }, [files, triggerToast]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setDatePreset('all');
    setCustomDateFilter('');
    setShowPinnedOnly(false);
    setShowEncryptedOnly(false);
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedCategory !== 'All' ||
    datePreset !== 'all' ||
    customDateFilter !== '' ||
    showPinnedOnly ||
    showEncryptedOnly;

  const handleExportVisibleFilesToCsv = useCallback(() => {
    if (filteredResults.length === 0) {
      triggerToast('No visible files available to export.');
      return;
    }

    const escapeCsvCell = (
      value: string | number | boolean | undefined | null
    ): string => {
      const str = value === undefined || value === null ? '' : String(value);
      if (/[",\r\n]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'File ID',
      'File Name',
      'Category',
      'Size (Bytes)',
      'Formatted Size',
      'MIME Type',
      'Upload Date',
      'Uploaded Timestamp',
      'Sender Name',
      'Sender Device',
      'Room Code',
      'Pinned to Top',
      'PIN Protected',
      'Downloads',
      'Transfer Notes',
      'Direct Download URL',
      'Room QR Download URL',
    ];

    const rows = filteredResults.map(({ file }) => {
      const origin =
        typeof window !== 'undefined'
          ? window.location.origin
          : 'https://relaydrop.local';
      const directDownloadUrl = `${origin}/api/files/${encodeURIComponent(
        file.id
      )}/download`;
      const qrDownloadUrl = buildFileQrPayloadUrl({
        fileId: file.id,
        roomCode: file.roomCode || roomCode,
      });

      return [
        file.id,
        file.name,
        file.category,
        file.size,
        formatBytes(file.size),
        file.mimeType,
        file.uploadDate,
        file.uploadedAt,
        file.senderName,
        file.senderDevice,
        file.roomCode,
        file.pinned ? 'Yes' : 'No',
        file.pinProtected ? 'Yes' : 'No',
        file.downloads,
        file.notes || '',
        directDownloadUrl,
        qrDownloadUrl,
      ]
        .map(escapeCsvCell)
        .join(',');
    });

    const csvContent = `\uFEFF${headers.map(escapeCsvCell).join(',')}\r\n${rows.join(
      '\r\n'
    )}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeRoom = (roomCode || 'vault').replace(/[^a-zA-Z0-9_-]/g, '-');
    link.href = url;
    link.download = `relaydrop-vault-export-${safeRoom}-${getTodayIsoDate()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    triggerToast(
      `Exported ${filteredResults.length} visible ${
        filteredResults.length === 1 ? 'file' : 'files'
      } to CSV`
    );
  }, [filteredResults, roomCode, triggerToast]);

  const activeDateFilterLabel = useMemo(() => {
    if (customDateFilter) return customDateFilter;
    if (datePreset === 'today') return 'Today';
    if (datePreset === 'yesterday') return 'Yesterday';
    if (datePreset === 'week') return 'Last 7 Days';
    return 'All Dates';
  }, [customDateFilter, datePreset]);

  const handleExportVaultToPdf = useCallback(async () => {
    if (filteredResults.length === 0) {
      triggerToast('No visible files in the current view to export to PDF.');
      return;
    }
    setPdfReportModalOpen(true);
    try {
      const exportedName = await generateAndDownloadVaultPdf({
        files: filteredResults.map((r) => r.file),
        roomCode,
        selectedCategory,
        searchQuery,
        dateFilterLabel: activeDateFilterLabel,
      });
      triggerToast(
        `Exported categorized PDF report (${exportedName})`
      );
    } catch {
      triggerToast('Opened printable categorized PDF report.');
    }
  }, [
    activeDateFilterLabel,
    filteredResults,
    roomCode,
    searchQuery,
    selectedCategory,
    triggerToast,
  ]);

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedRoom(true);
      setTimeout(() => setCopiedRoom(false), 2000);
    } catch {
      setCopiedRoom(true);
    }
  };

  const handleReceivePeerSampleDrop = async () => {
    const today = getTodayIsoDate();
    await handleUploadFile({
      name: `mobile-lidar-scan-${Math.floor(100 + Math.random() * 899)}.json`,
      size: 482900,
      mimeType: 'application/json',
      category: 'Design Assets',
      uploadDate: today,
      senderName: 'Clara Vance',
      senderDevice: 'iPhone 16 Pro (Nearby UWB)',
      roomCode,
      notes: 'Point cloud spatial mesh beamed via Nearby Radar.',
      textContent: JSON.stringify(
        {
          meshId: `lidar-${Date.now()}`,
          capturedBy: 'Clara Vance',
          vertices: 14280,
          category: 'Design Assets',
          date: today,
        },
        null,
        2
      ),
    });
  };

  const handleSimulateNewPeer = () => {
    const samplePeers = [
      { name: 'Clara Vance', deviceModel: 'iPhone 16 Pro (UWB)' },
      { name: 'Liam O’Connor', deviceModel: 'MacBook Pro M4 Max' },
      { name: 'Zoe Chen', deviceModel: 'Pixel 9 Pro Fold' },
      { name: 'Mateo Silva', deviceModel: 'iPad Pro 13" OLED' },
    ];
    const pick = samplePeers[peers.length % samplePeers.length];
    const simPeer: ConnectedPeer = {
      id: `sim-peer-${Date.now().toString(36)}`,
      name: pick.name,
      deviceModel: pick.deviceModel,
      roomCode,
      joinedAt: new Date().toISOString(),
      status: 'idle',
    };
    setPeers((prev) => [...prev, simPeer]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          event: 'peer:join',
          payload: simPeer,
        })
      );
    }
    triggerToast(`${simPeer.name} (${simPeer.deviceModel}) joined Room ${roomCode}`);
  };
  const navTabs: { id: ActiveTab; label: string; badge?: number }[] = [
    { id: 'vault', label: 'Vault' },
    { id: 'favorites', label: 'Favorites', badge: favoritesCount },
    { id: 'upload', label: 'Upload' },
    { id: 'activity', label: 'Activity' },
    { id: 'radar', label: 'Radar' },
    { id: 'rooms', label: 'Pairing' },
  ];

  return (
    <div id="top" className="min-h-screen min-h-dvh flex flex-col bg-[#f8fafc] text-slate-900 pb-mobile-nav md:pb-12">
      {/* Strict 3-Zone Top Bar Contract: [Brand title, one line] — [nav links] — [2 primary actions] */}
      <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between gap-4">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('vault');
          }}
          className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 font-display whitespace-nowrap"
        >
          RelayDrop
        </a>

        {/* Zone 2: Clean text navigation links with subtle hover/active underline */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 h-full">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative h-full flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  isActive ? 'text-slate-900 font-semibold' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                {tab.id === 'favorites' && (
                  <Heart
                    className={`w-3.5 h-3.5 ${
                      isActive || (tab.badge && tab.badge > 0)
                        ? 'fill-rose-500 text-rose-500'
                        : 'text-slate-400'
                    }`}
                  />
                )}
                <span>{tab.label}</span>
                {typeof tab.badge === 'number' && tab.badge > 0 && (
                  <span className="font-mono tabular-nums text-xs text-rose-600 font-semibold">
                    ({tab.badge})
                  </span>
                )}
                {isActive && (
                  <motion.div
                    layoutId="desktop-nav-indicator"
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-sky-600 rounded-full"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 2 primary actions (Scan QR + Upload) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setQrScannerOpen(true)}
            aria-label="Scan QR Code"
            title="Scan QR Code"
            className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
          >
            <Camera className="w-3.5 h-3.5 text-sky-600" />
            <span>Scan QR</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!canUploadOrCreateCategory(currentUser)) {
                triggerToast(
                  currentUser
                    ? 'Viewer role is read-only. Switch to Editor or Admin to upload.'
                    : 'Sign in required to upload files.'
                );
                setAuthModalOpen(true);
                return;
              }
              setQuickUploadModalOpen(true);
            }}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap interactive-press"
          >
            + Upload
          </button>
        </div>
      </header>

      {/* Smooth Animated Toast Feedback Banner */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            key="toast-banner"
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-16 right-4 z-50 bg-slate-900 text-white pl-4 pr-2.5 py-2.5 rounded-2xl shadow-xl shadow-slate-900/15 text-xs font-semibold flex items-center gap-2.5 max-w-sm"
          >
            <Check className="w-4 h-4 text-sky-400 shrink-0" />
            <span className="flex-1 leading-snug">{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              aria-label="Dismiss notification"
              className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Global Visual Notification Banner when a file upload would push the vault over the 25MB soft storage limit */}
      <AnimatePresence>
        {storageLimitNotification && (
          <motion.div
            key="global-storage-limit-notification"
            role="alert"
            aria-live="assertive"
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -14, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-16 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-1.5rem)] max-w-2xl bg-slate-900 text-white rounded-2xl p-4 shadow-2xl shadow-slate-950/35 border border-rose-500/50 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-400 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs sm:text-sm font-bold text-white">
                      25 MB Soft Storage Limit Reached — Delete Old Files Before Proceeding
                    </p>
                    <span className="text-[11px] font-mono text-rose-300 font-semibold">
                      +{formatBytes(storageLimitNotification.overageBytes)} over 25 MB limit
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Attempting to upload{' '}
                    <span className="font-semibold text-white">
                      {storageLimitNotification.fileNames.length === 1
                        ? `"${storageLimitNotification.fileNames[0]}"`
                        : `${storageLimitNotification.attemptedFilesCount} files`}
                    </span>{' '}
                    (<span className="font-mono">{formatBytes(storageLimitNotification.attemptedBytes)}</span>)
                    pushes the room vault from{' '}
                    <span className="font-mono">{formatBytes(storageLimitNotification.currentVaultBytes)}</span>{' '}
                    to{' '}
                    <span className="font-mono font-semibold text-amber-300">
                      {formatBytes(storageLimitNotification.projectedTotalBytes)} /{' '}
                      {formatBytes(storageLimitNotification.softStorageLimitBytes)}
                    </span>
                    . Please delete old files from the vault to free up space before proceeding.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStorageLimitNotification(null)}
                aria-label="Dismiss storage limit notification"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleManageOldFilesInVault}
                  className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Review & Delete Old Files</span>
                </button>

                {oldestVaultFile && (
                  <button
                    type="button"
                    onClick={() => handleDeleteFile(oldestVaultFile.id)}
                    className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                    <span>
                      Delete Oldest: "{oldestVaultFile.name}" (-{formatBytes(oldestVaultFile.size)})
                    </span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setStorageLimitNotification(null)}
                className="min-h-[36px] px-3 py-1.5 rounded-xl text-slate-400 hover:text-white text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Dismiss
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Responsive / Mobile Handset Content Container */}
      <main
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`flex-1 w-full mx-auto px-3 sm:px-6 lg:px-8 pt-3 sm:pt-6 transition-all duration-200 ${
          mobileShellMode
            ? 'max-w-[430px] pb-28 my-2 sm:my-4 sm:rounded-[36px] sm:border-[6px] sm:border-slate-900 sm:bg-[#f8fafc] sm:shadow-2xl'
            : 'max-w-7xl pb-24 md:pb-12'
        }`}
      >
        {mobileShellMode && (
          <div className="mb-3 px-3 py-2 rounded-2xl bg-slate-900 text-white flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Smartphone className="w-3.5 h-3.5 text-sky-400" />
              <span className="font-semibold">Mobile Handset Shell</span>
              <span className="font-mono text-[11px] text-slate-400">412px</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileShellMode(false)}
              className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-semibold text-sky-300 transition-colors"
            >
              Exit Handset
            </button>
          </div>
        )}

        {/* Contextual Workspace Utility Bar */}
        <div className="mb-4 pb-3 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => setActiveTab('rooms')}
              className="font-semibold text-slate-900 hover:text-sky-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>Room {roomCode}</span>
            </button>
            <span aria-hidden="true" className="text-slate-300">·</span>
            <button
              type="button"
              onClick={() => setActiveTab('radar')}
              className="hover:text-slate-900 font-mono tabular-nums transition-colors whitespace-nowrap"
            >
              {peers.length} active {peers.length === 1 ? 'peer' : 'peers'}
            </button>
            <span aria-hidden="true" className="hidden sm:inline text-slate-300">·</span>
            <button
              type="button"
              onClick={() => setActiveTab('activity')}
              className="hidden sm:inline hover:text-slate-900 font-mono tabular-nums transition-colors whitespace-nowrap"
            >
              {activities.length} audit events
            </button>
            {sharedBundles.length > 0 && (
              <>
                <span aria-hidden="true" className="text-slate-300">·</span>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeShareBundle && sharedBundles.length > 0) {
                      setActiveShareBundle(sharedBundles[0]);
                    }
                    setShareBundleModalOpen(true);
                  }}
                  className="text-sky-700 hover:text-sky-800 font-semibold font-mono tabular-nums flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>
                    {sharedBundles.filter(
                      (b) => !b.revoked && new Date(b.expiresAt).getTime() > Date.now()
                    ).length}{' '}
                    expiring {sharedBundles.length === 1 ? 'link' : 'links'}
                  </span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMobileShellMode((prev) => {
                  const next = !prev;
                  triggerToast(
                    next
                      ? 'Switched to Mobile Handset Preview'
                      : 'Switched to Full Responsive Split View'
                  );
                  return next;
                });
              }}
              className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors whitespace-nowrap"
            >
              {mobileShellMode ? (
                <>
                  <Monitor className="w-3.5 h-3.5 text-sky-600" />
                  <span>Desktop Split View</span>
                </>
              ) : (
                <>
                  <Smartphone className="w-3.5 h-3.5 text-sky-600" />
                  <span>Handset Preview</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setPwaModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 transition-colors whitespace-nowrap"
            >
              <Smartphone className="w-3.5 h-3.5 text-sky-600" />
              <span>{isInstalled ? 'App Mode' : 'Mobile App'}</span>
            </button>

            <button
              type="button"
              onClick={() => setAuthModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200/90 hover:border-slate-300 text-xs font-semibold text-slate-800 transition-colors whitespace-nowrap"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
              <span>
                {currentUser ? `${currentUser.displayName} · ${currentUser.role.toUpperCase()}` : 'Sign In'}
              </span>
            </button>
          </div>
        </div>

        {/* Recipient Temporary Share Bundle Landing Banner (triggered via ?bundle=... or Preview) */}
        <AnimatePresence>
          {recipientLandingBundle && (
            <BundleRecipientBanner
              bundle={recipientLandingBundle}
              onDownloadBundleZip={handleDownloadBundleZip}
              onDismiss={() => setRecipientLandingBundle(null)}
            />
          )}
        </AnimatePresence>

        <div
          className={
            mobileShellMode
              ? 'space-y-4'
              : 'grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 xl:gap-8 items-start'
          }
        >
          {/* Primary Column */}
          <div className={mobileShellMode ? 'w-full space-y-4' : 'lg:col-span-8 space-y-6 min-w-0'}>
            <ActiveTransfersTray
              transfers={activeTransfers}
              onDismiss={dismissTransfer}
            />
            <AnimatePresence mode="wait">
              {(activeTab === 'vault' || activeTab === 'favorites') && (
                <motion.div
                  key={activeTab === 'favorites' ? 'tab-favorites' : 'tab-vault'}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  {/* Search & Multi-Facet Discovery Panel */}
                  <section
                    aria-label="Search and filter files"
                    className="bg-white rounded-3xl border border-slate-200/90 p-4 sm:p-6 space-y-4 sm:space-y-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2.5">
                          {activeTab === 'favorites' && (
                            <div className="w-8 h-8 rounded-2xl bg-rose-50 border border-rose-200/80 flex items-center justify-center shrink-0">
                              <Heart className="w-4 h-4 fill-rose-600 text-rose-600" />
                            </div>
                          )}
                          <h1 className="text-xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                            {activeTab === 'favorites'
                              ? 'Favorite Files'
                              : 'Categorized File Vault'}
                          </h1>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span>Room {roomCode}</span>
                          <span aria-hidden="true">·</span>
                          {activeTab === 'favorites' ? (
                            <>
                              <span className="font-mono tabular-nums text-rose-600 font-semibold">
                                {favoritesCount} favorite {favoritesCount === 1 ? 'file' : 'files'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatBytes(favoritesTotalSize)} favorited size
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="font-mono tabular-nums">{files.length} shared files</span>
                              {favoritesCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <button
                                    type="button"
                                    onClick={() => setActiveTab('favorites')}
                                    className="font-mono tabular-nums text-rose-600 hover:text-rose-700 font-semibold hover:underline underline-offset-4"
                                  >
                                    {favoritesCount} {favoritesCount === 1 ? 'favorite' : 'favorites'}
                                  </button>
                                </>
                              )}
                              {pinnedCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums text-amber-700 font-semibold">
                                    {pinnedCount} pinned to top
                                  </span>
                                </>
                              )}
                              {encryptedCount > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums text-emerald-700 font-semibold inline-flex items-center gap-1">
                                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                    {encryptedCount} AES-256 encrypted
                                  </span>
                                </>
                              )}
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{formatBytes(totalVaultSize)} total</span>
                            </>
                          )}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 self-start sm:self-auto w-full sm:w-auto justify-between sm:justify-end">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleRefreshVault}
                            title="Sync vault with room peers"
                            aria-label="Sync vault with room peers"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 interactive-press"
                          >
                            <RefreshCw
                              className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-sky-600' : ''}`}
                            />
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              const url = `${window.location.origin}/?room=${encodeURIComponent(roomCode)}`;
                              if (navigator.share) {
                                try {
                                  await navigator.share({
                                    title: `RelayDrop Room ${roomCode}`,
                                    text: `Join RelayDrop Room ${roomCode} to share & categorize files:`,
                                    url,
                                  });
                                  return;
                                } catch {
                                  // Fallback to clipboard
                                }
                              }
                              handleCopyRoomCode();
                              triggerToast(`Copied Room ${roomCode} link`);
                            }}
                            title="Share Room via Mobile Share Sheet"
                            aria-label="Share Room"
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 interactive-press"
                          >
                            <Share2 className="w-3.5 h-3.5 text-sky-600" />
                          </button>

                          <button
                            type="button"
                            onClick={handleExportVaultToPdf}
                            disabled={filteredResults.length === 0}
                            title="Export printable, categorized PDF report of all files in the current view"
                            aria-label="Export Vault to PDF"
                            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                          >
                            <FileDown className="w-3.5 h-3.5 text-sky-400" />
                            <span>Export Vault to PDF</span>
                          </button>

                          {/* View Mode Switcher: Tap List vs. Visual Grid */}
                          <div
                            role="group"
                            aria-label="Vault display layout"
                            className="flex items-center bg-slate-100 p-1 rounded-xl"
                          >
                            <button
                              type="button"
                              onClick={() => setVaultViewMode('list')}
                              title="Compact List View"
                              aria-label="Compact List View"
                              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                vaultViewMode === 'list'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <LayoutList className="w-3.5 h-3.5" />
                              <span className="hidden xs:inline sm:inline">List</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setVaultViewMode('grid')}
                              title="Visual Preview Grid"
                              aria-label="Visual Preview Grid"
                              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                                vaultViewMode === 'grid'
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <LayoutGrid className="w-3.5 h-3.5" />
                              <span className="hidden xs:inline sm:inline">Grid</span>
                            </button>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 hidden sm:inline" />
                          <label htmlFor="vault-sort-select" className="sr-only">
                            Sort files
                          </label>
                          <select
                            id="vault-sort-select"
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value as SortOption)}
                            className="min-h-[40px] px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-colors"
                          >
                            <option value="newest">Newest Date</option>
                            <option value="oldest">Oldest Date</option>
                            <option value="largest">Largest Size</option>
                            <option value="name">Name (A–Z)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Horizontal Vault Storage Progress Bar (Soft Limit) with Interactive Tooltip */}
                    <div
                      className="relative pt-3 border-t border-slate-100 space-y-1.5"
                      onMouseEnter={() => setShowVaultCapacityTooltip(true)}
                      onMouseLeave={() => setShowVaultCapacityTooltip(false)}
                      onFocus={() => setShowVaultCapacityTooltip(true)}
                      onBlur={() => setShowVaultCapacityTooltip(false)}
                      tabIndex={0}
                    >
                      <AnimatePresence>
                        {showVaultCapacityTooltip && (
                          <motion.div
                            key="vault-capacity-tooltip"
                            role="tooltip"
                            initial={{ opacity: 0, y: 4, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.98 }}
                            transition={{ duration: 0.14 }}
                            className="absolute bottom-full left-0 mb-2 z-30 w-full sm:w-auto sm:max-w-md p-3 rounded-2xl bg-slate-900 text-white text-xs shadow-xl shadow-slate-950/20 border border-slate-700 pointer-events-none space-y-1"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold text-white flex items-center gap-1.5">
                                {storageUsagePercent >= 100 && (
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                )}
                                <span>25 MB Soft Storage Limit</span>
                              </span>
                              <span className="font-mono tabular-nums text-sky-400 font-semibold">
                                {formatBytes(totalVaultSize)} / {formatBytes(softStorageLimitBytes)} ({storageUsagePercent}%)
                              </span>
                            </div>
                            <p className="text-slate-300 leading-relaxed">
                              {storageUsagePercent >= 100
                                ? `Vault is over the 25 MB soft storage limit by ${formatBytes(
                                    totalVaultSize - softStorageLimitBytes
                                  )}. Please delete old files before uploading new large assets.`
                                : `${formatBytes(
                                    Math.max(0, softStorageLimitBytes - totalVaultSize)
                                  )} remaining before reaching the 25 MB soft limit. Uploading files beyond 25 MB will prompt you to delete old files first.`}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span className="font-semibold text-slate-900">Vault Capacity</span>
                          <span className="hidden sm:inline" aria-hidden="true">·</span>
                          <span className="hidden sm:inline">
                            {storageUsagePercent >= 100
                              ? 'Over 25 MB soft limit — delete old files before uploading'
                              : storageUsagePercent >= 75
                              ? 'Approaching 25 MB soft storage limit'
                              : 'Within 25 MB soft storage limit'}
                          </span>
                          {topStorageCategory && (
                            <>
                              <span className="hidden md:inline" aria-hidden="true">·</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCategory((prev) =>
                                    prev === topStorageCategory.category
                                      ? 'All'
                                      : topStorageCategory.category
                                  )
                                }
                                className="hidden md:inline font-medium text-sky-700 hover:text-sky-800 hover:underline underline-offset-4 transition-colors"
                              >
                                Top space: {topStorageCategory.category} (
                                {formatBytes(topStorageCategory.bytes)} ·{' '}
                                {topStorageCategory.sharePercent}%)
                              </button>
                            </>
                          )}
                        </div>
                        <div className="font-mono tabular-nums text-slate-600">
                          <span className="font-semibold text-slate-900">
                            {formatBytes(totalVaultSize)}
                          </span>{' '}
                          / {formatBytes(softStorageLimitBytes)}{' '}
                          <span className="text-slate-400">({storageUsagePercent}%)</span>
                        </div>
                      </div>

                      <div
                        role="progressbar"
                        aria-label="Vault storage usage relative to soft limit"
                        aria-valuenow={Math.min(100, Math.round(storageUsagePercent))}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="w-full h-2 rounded-full bg-slate-100 overflow-hidden"
                      >
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            storageUsagePercent >= 100
                              ? 'bg-rose-500'
                              : storageUsagePercent >= 75
                              ? 'bg-amber-500'
                              : 'bg-sky-600'
                          }`}
                          style={{ width: `${Math.max(2, clampedStorageRatio * 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Unified Search Bar: Name, Category, or Upload Date */}
                    <div className="space-y-2.5">
                      <div className="relative flex items-center">
                        <Search className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
                        <input
                          ref={searchInputRef}
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search by file name, category, or upload date (YYYY-MM-DD)..."
                          aria-label="Search files by name, category, or upload date"
                          className="w-full min-h-[48px] pl-11 pr-12 py-2.5 rounded-2xl border border-slate-300 bg-slate-50/70 focus:bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-all"
                        />
                        {searchQuery ? (
                          <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear search query"
                            className="absolute right-1.5 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        ) : (
                          <span
                            aria-hidden="true"
                            className="hidden sm:inline-flex absolute right-3.5 px-2 py-0.5 rounded-md bg-slate-200/70 text-[11px] font-mono text-slate-500 pointer-events-none"
                          >
                            /
                          </span>
                        )}
                      </div>

                      {/* Editorial Inline Search Suggestions */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 px-1">
                        <span className="text-slate-400">Quick filter:</span>
                        {[
                          { label: 'nordic', query: 'nordic' },
                          { label: 'Design Assets', query: 'Design Assets' },
                          { label: 'Documents', query: 'Documents' },
                          { label: '2026-09-25', query: '2026-09-25' },
                        ].map((sample, idx) => (
                          <React.Fragment key={sample.query}>
                            {idx > 0 && <span aria-hidden="true" className="text-slate-300">·</span>}
                            <button
                              type="button"
                              onClick={() =>
                                setSearchQuery((prev) =>
                                  prev === sample.query ? '' : sample.query
                                )
                              }
                              className={`font-medium transition-colors whitespace-nowrap ${
                                searchQuery === sample.query
                                  ? 'text-sky-600 font-semibold underline underline-offset-4'
                                  : 'text-slate-600 hover:text-slate-900 hover:underline underline-offset-4'
                              }`}
                            >
                              {sample.label}
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* Category Filter Segmented Bar + Add Custom Category + Mobile Date Filter Toggle */}
                    <div className="space-y-2.5 pt-3 border-t border-slate-100">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          Category
                        </span>
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setMobileFiltersExpanded((v) => !v)}
                            className={`sm:hidden text-xs font-semibold flex items-center gap-1 whitespace-nowrap ${
                              datePreset !== 'all' || Boolean(customDateFilter) || mobileFiltersExpanded
                                ? 'text-sky-700'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Calendar className="w-3.5 h-3.5 text-sky-600" />
                            <span>
                              {datePreset !== 'all' || customDateFilter
                                ? 'Date Active'
                                : 'Filter by Date'}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setShowAddCategoryInline((v) => !v)}
                            className="text-xs font-semibold text-sky-700 hover:text-sky-800 flex items-center gap-1 whitespace-nowrap"
                          >
                            <FolderPlus className="w-3.5 h-3.5" />
                            <span>{showAddCategoryInline ? 'Close' : 'New Category'}</span>
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {showAddCategoryInline && (
                          <motion.form
                            initial={{ opacity: 0, y: -6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                            onSubmit={handleCreateInlineCategory}
                            className="flex items-center gap-2 pb-1"
                          >
                            <input
                              type="text"
                              value={newCategoryInput}
                              onChange={(e) => setNewCategoryInput(e.target.value)}
                              placeholder="Create custom category (e.g. CAD Models, Contracts)..."
                              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                            />
                            <button
                              type="submit"
                              className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap interactive-press"
                            >
                              Create
                            </button>
                          </motion.form>
                        )}
                      </AnimatePresence>

                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar">
                        {['All', ...categories].map((cat) => {
                          const active = selectedCategory === cat;
                          const count = categoryCounts[cat] ?? 0;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setSelectedCategory(cat)}
                              className={`min-h-[38px] px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 transition-colors interactive-press ${
                                active
                                  ? 'bg-white text-slate-900 shadow-xs'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              <span>{cat}</span>
                              <span
                                className={`font-mono tabular-nums text-[11px] ${
                                  active ? 'text-sky-600' : 'text-slate-400'
                                }`}
                              >
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Upload Date Filter Bar (Always visible on sm+, or when toggled / active on mobile) */}
                    <div
                      className={`${
                        mobileFiltersExpanded || datePreset !== 'all' || Boolean(customDateFilter)
                          ? 'flex'
                          : 'hidden sm:flex'
                      } pt-2.5 border-t border-slate-100 flex-col sm:flex-row sm:items-center justify-between gap-3`}
                    >
                      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto no-scrollbar">
                        {(
                          [
                            { id: 'all', label: 'All Dates' },
                            { id: 'today', label: 'Today' },
                            { id: 'yesterday', label: 'Yesterday' },
                            { id: 'week', label: 'Last 7 Days' },
                          ] as { id: DateRangePreset; label: string }[]
                        ).map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              setDatePreset(preset.id);
                              setCustomDateFilter('');
                            }}
                            className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors interactive-press ${
                              datePreset === preset.id && !customDateFilter
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-2">
                        <label htmlFor="exact-date-filter" className="text-xs text-slate-500 whitespace-nowrap">
                          Exact Date:
                        </label>
                        <input
                          id="exact-date-filter"
                          type="date"
                          value={customDateFilter}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomDateFilter(val);
                            setDatePreset(val ? 'custom' : 'all');
                          }}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
                        />
                      </div>
                    </div>
                  </section>

                  {/* Active Search Status, Multi-Select Action Bar & File List / Grid */}
                  <section aria-label="Shared files list" className="bg-white rounded-3xl border border-slate-200/90 overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                      {!isMultiSelectMode ? (
                        <>
                          <p className="text-xs text-slate-600">
                            Showing <span className="font-semibold font-mono tabular-nums text-slate-900">{filteredResults.length}</span> of{' '}
                            <span className="font-mono tabular-nums">{files.length}</span> files
                            {searchQuery.trim() && (
                              <span>
                                {' '}matching <span className="font-semibold text-slate-900">"{searchQuery.trim()}"</span>
                              </span>
                            )}
                          </p>

                          <div className="flex flex-wrap items-center gap-2">
                            {encryptedCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowEncryptedOnly((prev) => !prev)}
                                title={
                                  showEncryptedOnly
                                    ? 'Show all files'
                                    : 'Filter to only AES-256-GCM encrypted files'
                                }
                                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press ${
                                  showEncryptedOnly
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200/80'
                                }`}
                              >
                                <ShieldCheck
                                  className={`w-3.5 h-3.5 ${
                                    showEncryptedOnly ? 'text-white' : 'text-emerald-600'
                                  }`}
                                />
                                <span>
                                  {showEncryptedOnly
                                    ? `E2EE Only (${encryptedCount})`
                                    : `E2EE (${encryptedCount})`}
                                </span>
                              </button>
                            )}

                            {pinnedCount > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowPinnedOnly((prev) => !prev)}
                                title={
                                  showPinnedOnly
                                    ? 'Show all files (pinned still at top)'
                                    : 'Show only pinned files'
                                }
                                className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press ${
                                  showPinnedOnly
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80'
                                }`}
                              >
                                <Pin
                                  className={`w-3.5 h-3.5 -rotate-45 ${
                                    showPinnedOnly ? 'fill-white text-white' : 'fill-amber-600 text-amber-600'
                                  }`}
                                />
                                <span>
                                  {showPinnedOnly ? `Pinned Only (${pinnedCount})` : `Pinned (${pinnedCount})`}
                                </span>
                              </button>
                            )}

                            {hasActiveFilters && (
                              <button
                                type="button"
                                onClick={clearAllFilters}
                                className="min-h-[36px] px-2.5 text-xs font-semibold text-sky-700 hover:text-sky-800 whitespace-nowrap"
                              >
                                Reset Filters
                              </button>
                            )}

                            {filteredResults.length > 0 && (
                              <>
                                <button
                                  type="button"
                                  onClick={handleExportVaultToPdf}
                                  aria-label="Export Vault to PDF report with image thumbnails"
                                  title="Generate printable categorized PDF report of current view"
                                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200/80 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                                >
                                  <FileDown className="w-3.5 h-3.5 text-sky-600" />
                                  <span>Export Vault to PDF</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={handleExportVisibleFilesToCsv}
                                  aria-label="Export all visible files metadata to CSV"
                                  title="Download CSV metadata for all currently visible files"
                                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                                >
                                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
                                  <span>Export All to CSV</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setIsMultiSelectMode(true);
                                    setCheckedFileIds([]);
                                  }}
                                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                                >
                                  <CheckSquare className="w-3.5 h-3.5 text-sky-600" />
                                  <span>Select Files</span>
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center gap-2.5">
                            <button
                              type="button"
                              onClick={() => {
                                const visibleIds = filteredResults.map((r) => r.file.id);
                                const allVisibleChecked =
                                  visibleIds.length > 0 &&
                                  visibleIds.every((id) => checkedFileIds.includes(id));
                                if (allVisibleChecked) {
                                  setCheckedFileIds((prev) =>
                                    prev.filter((id) => !visibleIds.includes(id))
                                  );
                                } else {
                                  setCheckedFileIds((prev) =>
                                    Array.from(new Set([...prev, ...visibleIds]))
                                  );
                                }
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              {filteredResults.length > 0 &&
                              filteredResults.every((r) => checkedFileIds.includes(r.file.id)) ? (
                                <>
                                  <CheckSquare className="w-3.5 h-3.5 text-sky-600" />
                                  <span>Deselect All</span>
                                </>
                              ) : (
                                <>
                                  <Square className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Select All ({filteredResults.length})</span>
                                </>
                              )}
                            </button>

                            <span className="text-xs text-slate-600">
                              <span className="font-semibold font-mono tabular-nums text-slate-900">
                                {checkedFileIds.length}
                              </span>{' '}
                              selected
                              {checkedFileIds.length > 0 && (
                                <>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums text-slate-500">
                                    {formatBytes(
                                      files
                                        .filter((f) => checkedFileIds.includes(f.id))
                                        .reduce((acc, f) => acc + f.size, 0)
                                    )}
                                  </span>
                                </>
                              )}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={checkedFileIds.length === 0}
                              onClick={handleBatchPrintSelectedQrCards}
                              title="Batch print an index card sheet with one QR code per selected file"
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Printer className="w-3.5 h-3.5 text-sky-400" />
                              <span>Batch Print QR ({checkedFileIds.length})</span>
                            </button>

                            <button
                              type="button"
                              disabled={checkedFileIds.length === 0 || isGeneratingShareBundle}
                              onClick={() => handleCreateExpiringShareBundle()}
                              title="Bundle all selected files on the server and generate a single expiring shareable URL in Firebase"
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Link2 className="w-3.5 h-3.5" />
                              <span>
                                {isGeneratingShareBundle
                                  ? 'Bundling Link...'
                                  : `Share Expiring Link (${checkedFileIds.length})`}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={checkedFileIds.length === 0 || isBatchZipping}
                              onClick={handleBatchDownloadZip}
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>
                                {isBatchZipping
                                  ? 'Zipping Files...'
                                  : `Download ZIP (${checkedFileIds.length})`}
                              </span>
                            </button>

                            <button
                              type="button"
                              disabled={checkedFileIds.length === 0}
                              onClick={() => handleBulkTogglePin(true)}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200 disabled:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400 text-amber-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Pin className="w-3.5 h-3.5 -rotate-45 fill-amber-600 text-amber-600" />
                              <span>Pin to Top</span>
                            </button>

                            <button
                              type="button"
                              disabled={checkedFileIds.length === 0}
                              onClick={() => setConfirmBulkDeleteOpen(true)}
                              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Delete Selected ({checkedFileIds.length})</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setIsMultiSelectMode(false);
                                setCheckedFileIds([]);
                              }}
                              className="min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Geometry-Matched Skeleton Loading State */}
                    {isLoading ? (
                      <div className="divide-y divide-slate-100">
                        {[1, 2, 3, 4].map((skeletonId) => (
                          <div
                            key={skeletonId}
                            className="min-h-[68px] px-5 py-3.5 flex items-center justify-between gap-3 animate-pulse"
                          >
                            <div className="w-11 h-11 rounded-xl bg-slate-200/80 shrink-0" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3.5 w-48 bg-slate-200/80 rounded-md" />
                              <div className="h-2.5 w-72 bg-slate-100 rounded-md" />
                            </div>
                            <div className="h-9 w-24 bg-slate-100 rounded-xl shrink-0" />
                          </div>
                        ))}
                      </div>
                    ) : filteredResults.length === 0 ? (
                      <div className="p-12 text-center space-y-3">
                        {activeTab === 'favorites' ? (
                          <>
                            <div className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto">
                              <Heart className="w-6 h-6" />
                            </div>
                            <p className="text-base font-semibold text-slate-900">
                              {favoritesCount === 0
                                ? 'No favorite files yet'
                                : 'No favorite files match your current filters'}
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                              {favoritesCount === 0
                                ? 'Tap the heart icon on any file in the Vault list or grid to mark it as a favorite for instant access here.'
                                : 'Try resetting your category or search filters to view all favorited files.'}
                            </p>
                            <div className="pt-2 flex items-center justify-center gap-3">
                              {hasActiveFilters && (
                                <button
                                  type="button"
                                  onClick={clearAllFilters}
                                  className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-100 text-slate-800 text-xs font-semibold hover:bg-slate-200 whitespace-nowrap interactive-press"
                                >
                                  Reset Filters
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setActiveTab('vault')}
                                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap interactive-press"
                              >
                                Browse Vault Files
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-base font-semibold text-slate-900">
                              No files match your search criteria
                            </p>
                            <p className="text-xs text-slate-500 max-w-md mx-auto">
                              Try searching by another file name, category (such as Photos & Media or Documents), or upload date (YYYY-MM-DD).
                            </p>
                            <div className="pt-2 flex items-center justify-center gap-3">
                              <button
                                type="button"
                                onClick={clearAllFilters}
                                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap interactive-press"
                              >
                                Show All Files
                              </button>
                              <button
                                type="button"
                                onClick={() => setQuickUploadModalOpen(true)}
                                className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 whitespace-nowrap interactive-press"
                              >
                                + Upload New File
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ) : vaultViewMode === 'list' ? (
                      /* Compact Tap List View with Live Thumbnails */
                      <div className="divide-y divide-slate-100">
                        {filteredResults.map(({ file, matchedBy }) => {
                          const isChecked = checkedFileIds.includes(file.id);
                          const imgPreview = resolveImageSource(file);
                          const textSnippet = resolveTextContent(file);

                          return (
                            <div
                              key={file.id}
                              onClick={() => {
                                if (isMultiSelectMode) {
                                  handleToggleCheckFile(file.id);
                                } else {
                                  setPreviewModalFileId(file.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-selected={isMultiSelectMode ? isChecked : undefined}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (isMultiSelectMode) {
                                    handleToggleCheckFile(file.id);
                                  } else {
                                    setPreviewModalFileId(file.id);
                                  }
                                }
                              }}
                              className={`group min-h-[68px] px-3.5 sm:px-5 py-3.5 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 cursor-pointer ${
                                isMultiSelectMode && isChecked
                                  ? 'bg-sky-50/80 hover:bg-sky-100/70'
                                  : file.pinned
                                  ? 'bg-amber-50/35 hover:bg-amber-50/65 border-l-2 border-l-amber-500'
                                  : 'hover:bg-slate-50/90 active:bg-slate-100/80'
                              }`}
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                {/* Multi-select Checkbox Affordance */}
                                {isMultiSelectMode && (
                                  <button
                                    type="button"
                                    role="checkbox"
                                    aria-checked={isChecked}
                                    aria-label={`Select ${file.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleToggleCheckFile(file.id);
                                    }}
                                    className={`w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 transition-colors ${
                                      isChecked
                                        ? 'bg-sky-600 border-sky-600 text-white'
                                        : 'bg-white border-slate-300 text-transparent hover:border-sky-500'
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {/* Left 44px Thumbnail or Category Icon Container */}
                                {file.encrypted ? (
                                  <div className="w-11 h-11 rounded-xl bg-emerald-950 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/40">
                                    <ShieldCheck className="w-5 h-5" />
                                  </div>
                                ) : imgPreview.isImage && imgPreview.src && !file.pinProtected ? (
                                  <div className="w-11 h-11 rounded-xl bg-slate-900 overflow-hidden shrink-0 border border-slate-200/80 relative">
                                    <img
                                      src={imgPreview.src}
                                      alt={file.name}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-11 h-11 rounded-xl bg-slate-100 group-hover:bg-slate-200/70 transition-colors flex items-center justify-center shrink-0">
                                    {getCategoryIcon(file.category)}
                                  </div>
                                )}

                                {/* Middle Stacked Title & Clean Unboxed Metadata */}
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="text-sm font-semibold text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                                      {file.name}
                                    </p>
                                    {file.encrypted && (
                                      <span
                                        title={`End-to-End Encrypted (${file.encryptionAlgo || 'AES-256-GCM'})`}
                                        className="inline-flex items-center gap-1 text-[11px] font-mono font-semibold text-emerald-700 shrink-0"
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                                        <span>AES-256-GCM</span>
                                      </span>
                                    )}
                                    {file.favorite && (
                                      <span
                                        title="Favorited file"
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 shrink-0"
                                      >
                                        <Heart className="w-3 h-3 fill-rose-600 text-rose-600" />
                                        <span>Favorite</span>
                                      </span>
                                    )}
                                    {file.pinned && (
                                      <span
                                        title="Pinned to top of vault"
                                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 shrink-0"
                                      >
                                        <Pin className="w-3 h-3 fill-amber-600 text-amber-600 -rotate-45" />
                                        <span>Pinned</span>
                                      </span>
                                    )}
                                    {file.pinProtected && (
                                      <Lock
                                        className="w-3.5 h-3.5 text-amber-600 shrink-0"
                                        aria-label="PIN Protected"
                                      />
                                    )}
                                  </div>

                                  {/* Zero-Pill Metadata Discipline: Clean unboxed text with subtle · separators */}
                                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                                    <span className="font-semibold text-slate-700">{file.category}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">{formatBytes(file.size)}</span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      {formatDisplayDate(file.uploadDate)}
                                    </span>
                                    {(imgPreview.isImage || Boolean(textSnippet)) && !file.pinProtected && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="font-mono text-[11px] text-sky-700">
                                          {imgPreview.isImage ? `${imgPreview.formatBadge} Preview` : 'Code/Text Preview'}
                                        </span>
                                      </>
                                    )}
                                    <span className="hidden md:inline" aria-hidden="true">·</span>
                                    <span className="hidden md:inline truncate">
                                      {file.senderName}
                                    </span>
                                    {matchedBy.length > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="text-sky-700 font-semibold">
                                          Matched {matchedBy.join(' & ')}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  {/* Inline 1-Line Code / Text Excerpt when available */}
                                  {file.encrypted ? (
                                    <p className="text-[11px] font-mono text-emerald-700 truncate mt-1">
                                      Zero-Knowledge Ciphertext · SHA-256:{' '}
                                      {(file.encryptionFingerprint || '').slice(0, 16)}… · Tap to decrypt in browser
                                    </p>
                                  ) : (
                                    textSnippet &&
                                    !imgPreview.isImage &&
                                    !file.pinProtected && (
                                      <p className="text-[11px] font-mono text-slate-500 truncate mt-1">
                                        {textSnippet
                                          .split(/\r?\n/)
                                          .map((l) => l.trim())
                                          .filter(Boolean)
                                          .slice(0, 2)
                                          .join('  ')}
                                      </p>
                                    )
                                  )}
                                </div>
                              </div>

                              {/* Right Quick Category Selector + Action Affordance (Responsive across mobile & desktop) */}
                              {!isMultiSelectMode && (
                                <div
                                  className="w-full sm:w-auto pt-2.5 sm:pt-0 mt-1 sm:mt-0 border-t border-slate-100 sm:border-t-0 flex items-center justify-between sm:justify-end gap-1.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setPreviewModalFileId(file.id)}
                                    aria-label={`Preview ${file.name}`}
                                    title={`Open modal preview for ${file.name}`}
                                    className="min-h-[38px] sm:min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 text-slate-800 hover:text-sky-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors interactive-press"
                                  >
                                    <Eye className="w-3.5 h-3.5 text-sky-600" />
                                    <span>Preview</span>
                                  </button>

                                  <select
                                    aria-label={`Change category for ${file.name}`}
                                    disabled={!canModifyOrDeleteFile(currentUser, file)}
                                    value={file.category}
                                    onChange={(e) =>
                                      handleUpdateFile(file.id, { category: e.target.value })
                                    }
                                    className="min-h-[38px] sm:min-h-[40px] flex-1 sm:flex-initial max-w-[150px] sm:max-w-none px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-colors"
                                  >
                                    {categories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                  </select>

                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleFavoriteFile(file)}
                                      aria-label={
                                        file.favorite
                                          ? `Remove ${file.name} from favorites`
                                          : `Add ${file.name} to favorites`
                                      }
                                      aria-pressed={Boolean(file.favorite)}
                                      title={
                                        file.favorite
                                          ? `Remove "${file.name}" from Favorites`
                                          : `Mark "${file.name}" as Favorite`
                                      }
                                      className={`min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl transition-colors interactive-press ${
                                        file.favorite
                                          ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                                          : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                      }`}
                                    >
                                      <Heart
                                        className={`w-4 h-4 ${
                                          file.favorite ? 'fill-rose-600 text-rose-600' : ''
                                        }`}
                                      />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleTogglePinFile(file)}
                                      aria-label={
                                        file.pinned
                                          ? `Unpin ${file.name} from top`
                                          : `Pin ${file.name} to top`
                                      }
                                      title={
                                        file.pinned
                                          ? `Unpin "${file.name}" from top`
                                          : `Pin "${file.name}" to top of list/grid`
                                      }
                                      className={`min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl transition-colors interactive-press ${
                                        file.pinned
                                          ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                                          : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                                      }`}
                                    >
                                      <Pin
                                        className={`w-4 h-4 -rotate-45 ${
                                          file.pinned ? 'fill-amber-600 text-amber-600' : ''
                                        }`}
                                      />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => setQrModalFileId(file.id)}
                                      aria-label={`Generate QR code for ${file.name}`}
                                      title={`Generate & download QR code for ${file.name}`}
                                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition-colors interactive-press"
                                    >
                                      <QrCode className="w-4 h-4" />
                                    </button>

                                    {!file.pinProtected ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadFile(file)}
                                        aria-label={`Download ${file.name}`}
                                        title={`Download ${file.name} (${formatBytes(file.size)})`}
                                        className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition-colors interactive-press"
                                      >
                                        <Download className="w-4 h-4" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setPreviewModalFileId(file.id)}
                                        aria-label={`Unlock and preview ${file.name}`}
                                        className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl text-amber-600 hover:bg-amber-50 transition-colors"
                                      >
                                        <Lock className="w-4 h-4" />
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => setSelectedFileId(file.id)}
                                      aria-label={`Inspect and manage ${file.name}`}
                                      title="Manage category, notes & QR settings"
                                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 transition-colors"
                                    >
                                      <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Visual Grid View: Rich Image & Code/JSON Cards */
                      <div
                        className={`p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 ${
                          mobileShellMode ? '' : 'xl:grid-cols-3'
                        } gap-4`}
                      >
                        {filteredResults.map(({ file, matchedBy }) => {
                          const isChecked = checkedFileIds.includes(file.id);
                          const imgPreview = resolveImageSource(file);
                          const textSnippet = resolveTextContent(file);

                          return (
                            <div
                              key={file.id}
                              onClick={() => {
                                if (isMultiSelectMode) {
                                  handleToggleCheckFile(file.id);
                                } else {
                                  setPreviewModalFileId(file.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  if (isMultiSelectMode) {
                                    handleToggleCheckFile(file.id);
                                  } else {
                                    setPreviewModalFileId(file.id);
                                  }
                                }
                              }}
                              className={`group rounded-2xl border overflow-hidden flex flex-col justify-between cursor-pointer transition-all ${
                                isMultiSelectMode && isChecked
                                  ? 'border-sky-600 bg-sky-50/40'
                                  : file.pinned
                                  ? 'border-amber-300 hover:border-amber-400 bg-amber-50/15 ring-1 ring-amber-400/20'
                                  : 'border-slate-200/90 hover:border-slate-300 bg-white'
                              }`}
                            >
                              {/* Top Visual Surface */}
                              <div className="relative h-36 bg-slate-950 overflow-hidden flex items-center justify-center">
                                {!isMultiSelectMode && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleFavoriteFile(file);
                                      }}
                                      aria-label={
                                        file.favorite
                                          ? `Remove ${file.name} from favorites`
                                          : `Add ${file.name} to favorites`
                                      }
                                      aria-pressed={Boolean(file.favorite)}
                                      title={
                                        file.favorite
                                          ? 'Remove from Favorites'
                                          : 'Add to Favorites'
                                      }
                                      className={`absolute top-2.5 left-2.5 z-10 min-h-[32px] min-w-[32px] px-2 py-1 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 backdrop-blur-md transition-all interactive-press ${
                                        file.favorite
                                          ? 'bg-rose-600 text-white shadow-sm'
                                          : 'bg-slate-900/70 hover:bg-slate-900 text-white/90 border border-white/15'
                                      }`}
                                    >
                                      <Heart
                                        className={`w-3.5 h-3.5 ${
                                          file.favorite ? 'fill-white text-white' : ''
                                        }`}
                                      />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleTogglePinFile(file);
                                      }}
                                      aria-label={
                                        file.pinned
                                          ? `Unpin ${file.name} from top`
                                          : `Pin ${file.name} to top`
                                      }
                                      title={
                                        file.pinned ? 'Unpin from top' : 'Pin to top'
                                      }
                                      className={`absolute top-2.5 right-2.5 z-10 min-h-[32px] px-2.5 py-1 rounded-xl text-[11px] font-semibold flex items-center gap-1 backdrop-blur-md transition-all interactive-press ${
                                        file.pinned
                                          ? 'bg-amber-500 text-white shadow-sm'
                                          : 'bg-slate-900/70 hover:bg-slate-900 text-white/90 border border-white/15'
                                      }`}
                                    >
                                      <Pin
                                        className={`w-3 h-3 -rotate-45 ${
                                          file.pinned ? 'fill-white text-white' : ''
                                        }`}
                                      />
                                      <span>{file.pinned ? 'Pinned' : 'Pin'}</span>
                                    </button>
                                  </>
                                )}
                                {file.encrypted ? (
                                  <div className="flex flex-col items-center justify-center text-emerald-400 space-y-1.5 p-4 text-center">
                                    <ShieldCheck className="w-6 h-6" />
                                    <span className="text-xs font-semibold text-white">
                                      AES-256-GCM Encrypted
                                    </span>
                                    <span className="text-[11px] font-mono text-emerald-300/90">
                                      SHA-256: {(file.encryptionFingerprint || '').slice(0, 12)}…
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      Tap to decrypt in browser
                                    </span>
                                  </div>
                                ) : file.pinProtected ? (
                                  <div className="flex flex-col items-center justify-center text-amber-400 space-y-1.5 p-4 text-center">
                                    <Lock className="w-6 h-6" />
                                    <span className="text-xs font-semibold text-white">
                                      PIN-Protected File
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      Tap to enter PIN & preview
                                    </span>
                                  </div>
                                ) : imgPreview.isImage && imgPreview.src ? (
                                  <>
                                    <img
                                      src={imgPreview.src}
                                      alt={file.name}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                                    />
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-3 py-2 flex items-center justify-between text-[11px] font-mono text-white/90">
                                      <span>{imgPreview.formatBadge}</span>
                                      <span>{formatBytes(file.size)}</span>
                                    </div>
                                  </>
                                ) : textSnippet ? (
                                  <div className="w-full h-full p-3.5 text-left font-mono text-[11px] leading-relaxed text-slate-300 overflow-hidden select-none relative">
                                    <pre className="whitespace-pre-wrap break-words opacity-90">
                                      {textSnippet.slice(0, 260)}
                                    </pre>
                                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent flex items-end justify-between px-3.5 pb-2 text-[11px] text-sky-300">
                                      <span>Tap to inspect text/JSON</span>
                                      <span>{formatBytes(file.size)}</span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center justify-center text-slate-300 space-y-1.5">
                                    <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center">
                                      {getCategoryIcon(file.category)}
                                    </div>
                                    <span className="text-[11px] font-mono text-slate-400">
                                      {file.mimeType}
                                    </span>
                                  </div>
                                )}

                                {isMultiSelectMode && (
                                  <div className="absolute top-2.5 left-2.5">
                                    <span
                                      className={`w-6 h-6 rounded-lg border flex items-center justify-center ${
                                        isChecked
                                          ? 'bg-sky-600 border-sky-600 text-white'
                                          : 'bg-slate-900/70 border-white/50 text-transparent'
                                      }`}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Card Body */}
                              <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-sm font-semibold text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                                      {file.name}
                                    </p>
                                    {file.encrypted && (
                                      <ShieldCheck
                                        className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                                        aria-label="AES-256-GCM Encrypted"
                                      />
                                    )}
                                    {file.favorite && (
                                      <Heart
                                        className="w-3.5 h-3.5 fill-rose-600 text-rose-600 shrink-0"
                                        aria-label="Favorite file"
                                      />
                                    )}
                                    {file.pinned && (
                                      <Pin
                                        className="w-3.5 h-3.5 fill-amber-600 text-amber-600 -rotate-45 shrink-0"
                                        aria-label="Pinned to top"
                                      />
                                    )}
                                  </div>
                                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                                    <span className="font-semibold text-slate-700">
                                      {file.category}
                                    </span>
                                    <span className="mx-1.5" aria-hidden="true">·</span>
                                    <span className="font-mono tabular-nums">
                                      {formatDisplayDate(file.uploadDate)}
                                    </span>
                                    {matchedBy.length > 0 && (
                                      <>
                                        <span className="mx-1.5" aria-hidden="true">·</span>
                                        <span className="text-sky-700 font-semibold">
                                          Matched {matchedBy.join(' & ')}
                                        </span>
                                      </>
                                    )}
                                  </p>
                                </div>

                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs text-slate-500">
                                  <span className="truncate">{file.senderName}</span>
                                  <div
                                    className="flex items-center gap-1 shrink-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleToggleFavoriteFile(file)}
                                      aria-label={
                                        file.favorite
                                          ? `Remove ${file.name} from favorites`
                                          : `Add ${file.name} to favorites`
                                      }
                                      aria-pressed={Boolean(file.favorite)}
                                      title={
                                        file.favorite
                                          ? 'Remove from Favorites'
                                          : 'Add to Favorites'
                                      }
                                      className={`p-1.5 rounded-lg transition-colors ${
                                        file.favorite
                                          ? 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                                          : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'
                                      }`}
                                    >
                                      <Heart
                                        className={`w-3.5 h-3.5 ${
                                          file.favorite ? 'fill-rose-600 text-rose-600' : ''
                                        }`}
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleTogglePinFile(file)}
                                      aria-label={
                                        file.pinned
                                          ? `Unpin ${file.name} from top`
                                          : `Pin ${file.name} to top`
                                      }
                                      title={
                                        file.pinned ? 'Unpin from top' : 'Pin to top'
                                      }
                                      className={`p-1.5 rounded-lg transition-colors ${
                                        file.pinned
                                          ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                                          : 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                                      }`}
                                    >
                                      <Pin
                                        className={`w-3.5 h-3.5 -rotate-45 ${
                                          file.pinned ? 'fill-amber-600 text-amber-600' : ''
                                        }`}
                                      />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setQrModalFileId(file.id)}
                                      aria-label={`Generate QR code for ${file.name}`}
                                      title={`Generate & download QR code for ${file.name}`}
                                      className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                    >
                                      <QrCode className="w-3.5 h-3.5" />
                                    </button>
                                    {!file.pinProtected ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDownloadFile(file)}
                                        aria-label={`Download ${file.name}`}
                                        title={`Download ${file.name}`}
                                        className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                      >
                                        <Download className="w-3.5 h-3.5" />
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setSelectedFileId(file.id)}
                                        aria-label={`Unlock ${file.name}`}
                                        title="Unlock PIN-protected file"
                                        className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
                                      >
                                        <Lock className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setPreviewModalFileId(file.id)}
                                      className="pl-1 text-sky-700 font-semibold hover:underline"
                                    >
                                      Preview →
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </motion.div>
              )}

              {activeTab === 'upload' && (
                <motion.div
                  key="tab-upload"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  <UploadCategorizePanel
                    categories={categories}
                    activeRoomCode={roomCode}
                    senderName={senderName}
                    senderDevice={senderDevice}
                    canUpload={canUploadOrCreateCategory(currentUser)}
                    userRoleLabel={
                      currentUser ? formatRoleLabel(currentUser.role) : 'Guest (Read-Only)'
                    }
                    currentVaultBytes={totalVaultSize}
                    softStorageLimitBytes={softStorageLimitBytes}
                    vaultFiles={files}
                    persistentE2eeConfig={persistentE2eeConfig}
                    onPersistentE2eeConfigChange={handlePersistentE2eeConfigChange}
                    onDeleteOldFile={handleDeleteFile}
                    onManageOldFilesInVault={handleManageOldFilesInVault}
                    onStorageLimitExceededAttempt={handleStorageLimitExceededAttempt}
                    onOpenAuthModal={() => setAuthModalOpen(true)}
                    onUploadFile={handleUploadFile}
                    onAddCategory={handleAddCategory}
                    onUploadComplete={() => {
                      setStorageLimitNotification(null);
                      setActiveTab('vault');
                    }}
                  />
                </motion.div>
              )}

              {activeTab === 'activity' && (
                <motion.div
                  key="tab-activity"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ActivityLogPanel
                    activities={activities}
                    files={files}
                    roomCode={roomCode}
                    onSelectFile={(fileId) => setPreviewModalFileId(fileId)}
                    onNotify={triggerToast}
                  />
                </motion.div>
              )}

              {activeTab === 'radar' && (
                <motion.section
                  key="tab-radar"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        Nearby WebSocket Peer Radar
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Real-time discovery for devices paired to Room {roomCode}. Open a second mobile browser tab to see live peer presence.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={handleSimulateNewPeer}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                      >
                        <UserPlus className="w-3.5 h-3.5 text-sky-600" />
                        <span>+ Simulate Peer</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleReceivePeerSampleDrop}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap interactive-press"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>Receive Test Peer Drop</span>
                      </button>
                    </div>
                  </div>

                  {/* Tactile Animated Radar Visualization */}
                  <div className="relative rounded-3xl bg-slate-900 text-white p-8 flex flex-col items-center justify-center min-h-[280px] overflow-hidden">
                    <div className="relative w-56 h-56 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border border-sky-400/30 radar-pulse-ring pointer-events-none" />
                      <div className="absolute inset-4 rounded-full border border-sky-400/25 radar-pulse-ring-delayed pointer-events-none" />
                      <div className="w-56 h-56 rounded-full border border-sky-500/20 flex items-center justify-center">
                        <div className="w-36 h-36 rounded-full border border-sky-400/30 flex items-center justify-center">
                          <div className="w-16 h-16 rounded-full bg-sky-500/20 border border-sky-400 flex items-center justify-center">
                            <Radio className="w-7 h-7 text-sky-400" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 text-center relative z-10">
                      <p className="text-sm font-semibold">
                        {senderName} · {senderDevice}
                      </p>
                      <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                        Active Mesh Channel: {roomCode} · {peers.length} connected {peers.length === 1 ? 'peer' : 'peers'}
                      </p>
                    </div>
                  </div>

                  {/* Connected Peers Tap List */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <h3 className="text-xs font-semibold text-slate-700">
                      Connected Devices in Room {roomCode}
                    </h3>
                    <div className="divide-y divide-slate-100">
                      {peers.map((peer) => {
                        const isSelf = peer.id === peerId;
                        return (
                          <div
                            key={peer.id}
                            className="min-h-[60px] py-3 flex items-center justify-between gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                                <Smartphone className="w-4 h-4 text-slate-700" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">
                                  {peer.name} {isSelf && '(This Device)'}
                                </p>
                                <p className="text-xs text-slate-500 truncate">
                                  <span>{peer.deviceModel}</span>
                                  <span className="mx-1.5" aria-hidden="true">·</span>
                                  <span className="font-mono tabular-nums">Room {peer.roomCode}</span>
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                if (!canUploadOrCreateCategory(currentUser)) {
                                  triggerToast(
                                    currentUser
                                      ? 'Viewer role is read-only. Switch to Editor or Admin to beam files.'
                                      : 'Sign in required to beam files.'
                                  );
                                  setAuthModalOpen(true);
                                  return;
                                }
                                setQuickUploadModalOpen(true);
                              }}
                              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap interactive-press"
                            >
                              Beam File
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.section>
              )}

              {activeTab === 'rooms' && (
                <motion.section
                  key="tab-rooms"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-6"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-bold text-slate-900">
                        Mobile Room Pairing & Identity
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Pair multiple phones or laptops using a 6-digit room code or instant camera QR scan.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQrScannerOpen(true)}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap self-start sm:self-auto interactive-press"
                    >
                      <Camera className="w-4 h-4" />
                      <span>Scan Physical QR Code</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center py-5 border-y border-slate-100">
                    <div className="flex flex-col items-center sm:items-start space-y-3">
                      <span className="text-xs font-semibold text-slate-500">
                        Current Pairing Code
                      </span>
                      <div className="text-3xl font-bold font-mono tabular-nums text-slate-900 tracking-wider">
                        {roomCode}
                      </div>
                      <p className="text-xs text-slate-600">
                        Files uploaded to this room are immediately indexed by name, category, and upload date for all paired members.
                      </p>
                      <button
                        type="button"
                        onClick={handleCopyRoomCode}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center gap-2 hover:bg-slate-800 whitespace-nowrap interactive-press"
                      >
                        {copiedRoom ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        <span>{copiedRoom ? 'Copied Room Code' : 'Copy Room Code'}</span>
                      </button>
                    </div>

                    <div className="flex flex-col items-center justify-center">
                      <QrMatrixSvg
                        value={`${window.location.origin}/?room=${encodeURIComponent(roomCode)}`}
                        size={152}
                      />
                      <span className="text-xs text-slate-500 mt-2 font-mono">
                        Scan to join Room {roomCode}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                    <div>
                      <label
                        htmlFor="sender-name-input"
                        className="block text-xs font-semibold text-slate-900 mb-1.5"
                      >
                        Your Display Name
                      </label>
                      <input
                        id="sender-name-input"
                        type="text"
                        value={senderName}
                        onChange={(e) => setSenderName(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="room-code-input"
                        className="block text-xs font-semibold text-slate-900 mb-1.5"
                      >
                        Switch Room Code
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="room-code-input"
                          type="text"
                          value={roomInput}
                          onChange={(e) => setRoomInput(e.target.value)}
                          className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (roomInput.trim()) {
                              setRoomCode(roomInput.trim());
                              triggerToast(`Switched to Room ${roomInput.trim()}`);
                            }
                          }}
                          className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 whitespace-nowrap interactive-press"
                        >
                          Join
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* File-Specific QR Code Generator & Download for Pairing Room */}
                  {activePairingQrFile && (
                    <div className="pt-5 border-t border-slate-100 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                            <QrCode className="w-4 h-4 text-sky-600" />
                            <span>Generate & Download File QR Code for Room {roomCode}</span>
                          </h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Select any file in the vault to generate a scannable QR card that pairs peers to Room {roomCode} and downloads the file immediately.
                          </p>
                        </div>

                        <select
                          aria-label="Select file to generate QR code"
                          value={activePairingQrFile.id}
                          onChange={(e) => setPairingQrFileId(e.target.value)}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600 max-w-xs"
                        >
                          {files.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} ({formatBytes(f.size)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col sm:flex-row items-center gap-5">
                        <div className="flex flex-col items-center shrink-0">
                          <QrMatrixSvg
                            value={buildFileQrPayloadUrl({
                              fileId: activePairingQrFile.id,
                              roomCode,
                            })}
                            size={148}
                          />
                          <span className="text-[11px] font-mono text-slate-500 mt-2">
                            Room {roomCode} · Instant Download
                          </span>
                        </div>

                        <div className="flex-1 space-y-3 w-full min-w-0">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-slate-900 truncate">
                                {activePairingQrFile.name}
                              </h4>
                              {activePairingQrFile.pinProtected && (
                                <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                              <span className="font-semibold text-slate-700">
                                {activePairingQrFile.category}
                              </span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {formatBytes(activePairingQrFile.size)}
                              </span>
                              <span className="mx-1.5" aria-hidden="true">·</span>
                              <span>Shared by {activePairingQrFile.senderName}</span>
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                printFileQrIndexCard({
                                  value: buildFileQrPayloadUrl({
                                    fileId: activePairingQrFile.id,
                                    roomCode,
                                  }),
                                  fileName: activePairingQrFile.name,
                                  category: activePairingQrFile.category,
                                  sizeLabel: formatBytes(activePairingQrFile.size),
                                  roomCode,
                                  senderName: activePairingQrFile.senderName,
                                  uploadDate: activePairingQrFile.uploadDate,
                                  encrypted: activePairingQrFile.encrypted,
                                  encryptionFingerprint: activePairingQrFile.encryptionFingerprint,
                                  pinProtected: activePairingQrFile.pinProtected,
                                  notes: activePairingQrFile.notes,
                                });
                                triggerToast(
                                  `Opening print dialog for "${activePairingQrFile.name}" (4×6" index card)`
                                );
                              }}
                              title="Print QR card formatted for a standard 4x6 index card size"
                              className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap interactive-press"
                            >
                              <Printer className="w-4 h-4" />
                              <span>Print QR</span>
                              <span className="text-[10px] font-mono text-sky-100">4×6"</span>
                            </button>

                            <button
                              type="button"
                              onClick={async () => {
                                await downloadFileQrPng({
                                  value: buildFileQrPayloadUrl({
                                    fileId: activePairingQrFile.id,
                                    roomCode,
                                  }),
                                  fileName: activePairingQrFile.name,
                                  category: activePairingQrFile.category,
                                  sizeLabel: formatBytes(activePairingQrFile.size),
                                  roomCode,
                                });
                                triggerToast(
                                  `Downloaded QR Code PNG for "${activePairingQrFile.name}"`
                                );
                              }}
                              className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap interactive-press"
                            >
                              <Download className="w-4 h-4 text-sky-400" />
                              <span>Download QR Code (PNG)</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                downloadFileQrSvg({
                                  value: buildFileQrPayloadUrl({
                                    fileId: activePairingQrFile.id,
                                    roomCode,
                                  }),
                                  fileName: activePairingQrFile.name,
                                  category: activePairingQrFile.category,
                                  sizeLabel: formatBytes(activePairingQrFile.size),
                                  roomCode,
                                });
                                triggerToast(
                                  `Downloaded QR Code SVG for "${activePairingQrFile.name}"`
                                );
                              }}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <QrCode className="w-3.5 h-3.5 text-sky-600" />
                              <span>Download SVG</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setSelectedFileId(activePairingQrFile.id)}
                              className="min-h-[42px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <span>Inspect File</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          {/* Secondary Companion Column (4 cols on Desktop Split View, or stacked below in Mobile Shell Mode) */}
          <aside className={mobileShellMode ? 'space-y-4 pt-2' : 'lg:col-span-4 lg:sticky lg:top-20 space-y-6'}>
            {/* Identity & Role-Based Access Control (RBAC) Card */}
            <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                      currentUser
                        ? 'bg-sky-600 text-white'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-slate-900 truncate">
                      {currentUser ? currentUser.displayName : 'Guest Session (Read-Only)'}
                    </h2>
                    <p className="text-xs text-slate-500 truncate">
                      {currentUser
                        ? `${formatRoleLabel(currentUser.role)} · ${currentUser.email}`
                        : 'Sign in to upload, categorize, or delete files'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 interactive-press"
                >
                  {currentUser ? 'Permissions' : 'Sign In'}
                </button>
              </div>

              {currentUser ? (
                <div className="space-y-2 pt-2.5 border-t border-slate-100">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>Active RBAC Role</span>
                    <span className="font-mono text-[11px] uppercase text-slate-700 font-semibold">
                      {currentUser.role}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                    {(['admin', 'editor', 'viewer'] as UserRole[]).map((roleOption) => {
                      const active = currentUser.role === roleOption;
                      return (
                        <button
                          key={roleOption}
                          type="button"
                          onClick={async () => {
                            await handleUpdateLocalRole(roleOption);
                            triggerToast(`Role switched to ${formatRoleLabel(roleOption)}`);
                          }}
                          className={`min-h-[34px] px-2 py-1 rounded-lg text-xs font-semibold capitalize transition-colors interactive-press ${
                            active
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {roleOption}
                        </button>
                      );
                    })}
                  </div>
                  {(!currentUser || currentUser.uid === 'local-peer') ? (
                    <button
                      type="button"
                      onClick={handleQuickGoogleSignIn}
                      className="w-full min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap interactive-press"
                    >
                      <Cloud className="w-3.5 h-3.5 text-sky-400" />
                      <span>Sign in with Google (Sync to Firestore)</span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-mono text-emerald-700 font-semibold flex items-center gap-1">
                        <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Firestore Synced ({firestoreSyncedCount} files)</span>
                      </span>
                      <button
                        type="button"
                        disabled={isSyncingFirestore}
                        onClick={handleSyncVaultToFirestore}
                        className="px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-sky-700 text-[11px] font-semibold transition-colors whitespace-nowrap"
                      >
                        {isSyncingFirestore ? 'Syncing...' : 'Sync Vault'}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAuthModalOpen(true)}
                  className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
                >
                  <LogIn className="w-4 h-4 text-sky-400" />
                  <span>Authenticate & Unlock Vault Actions</span>
                </button>
              )}
            </div>

            {/* Recharts Bar Chart Dashboard: Storage Usage by Category */}
            <StorageByCategoryChart
              files={files}
              categories={categories}
              selectedCategory={selectedCategory}
              softStorageLimitBytes={softStorageLimitBytes}
              onSelectCategory={(cat) => {
                setSelectedCategory(cat);
                setActiveTab('vault');
              }}
              onTriggerUpload={() => {
                if (!canUploadOrCreateCategory(currentUser)) {
                  triggerToast(
                    currentUser
                      ? 'Viewer role is read-only. Switch to Editor or Admin to upload.'
                      : 'Sign in required to upload files.'
                  );
                  setAuthModalOpen(true);
                  return;
                }
                setQuickUploadModalOpen(true);
              }}
            />

            {/* Recharts Doughnut Visualization: File Type Breakdown */}
            <FileTypeBreakdownChart
              files={files}
              activeSearchQuery={searchQuery}
              onFilterByTypeToken={(token) => {
                setSearchQuery((prev) =>
                  prev.trim().toLowerCase() === token.toLowerCase() ? '' : token
                );
                setActiveTab('vault');
              }}
            />

            {/* Chronological Recent Activity Side-Panel Card */}
            <ActivitySidePanelCard
              activities={activities}
              files={files}
              onOpenActivityTab={() => setActiveTab('activity')}
              onSelectFile={(fileId) => setPreviewModalFileId(fileId)}
            />

            {/* Instant Room QR Card */}
            <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Mobile Handset Pairing
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Room {roomCode} · {peers.length} active {peers.length === 1 ? 'device' : 'devices'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCopyRoomCode}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  {copiedRoom ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedRoom ? 'Copied' : roomCode}</span>
                </button>
              </div>

              <div className="flex items-center gap-4">
                <QrMatrixSvg
                  value={`${window.location.origin}/?room=${encodeURIComponent(roomCode)}`}
                  size={96}
                />
                <div className="text-xs text-slate-600 space-y-2">
                  <p className="font-semibold text-slate-900">
                    Zero-App Camera Drop
                  </p>
                  <p className="leading-relaxed">
                    Scan a physical code with your device camera to join a room or download a specific shared file.
                  </p>
                  <button
                    type="button"
                    onClick={() => setQrScannerOpen(true)}
                    className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap interactive-press"
                  >
                    <Camera className="w-3.5 h-3.5 text-sky-400" />
                    <span>Open Camera Scanner</span>
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Fixed Bottom Tab Bar on Mobile (< md) or when Mobile App Shell Mode is active — Strictly <= 15% Sticky Cap */}
      <nav
        aria-label="Mobile Bottom Navigation"
        className={`${
          mobileShellMode
            ? 'fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] rounded-t-2xl border-x'
            : 'md:hidden fixed bottom-0 left-0 right-0'
        } z-40 min-h-[56px] pb-safe bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-6 items-center px-1 shadow-lg shadow-slate-900/5`}
      >
        {(
          [
            { id: 'vault', label: 'Vault', icon: FolderOpen, badge: files.length },
            { id: 'favorites', label: 'Favorites', icon: Heart, badge: favoritesCount },
            { id: 'upload', label: 'Upload', icon: Upload, badge: 0 },
            { id: 'activity', label: 'Activity', icon: Activity, badge: activities.length },
            { id: 'radar', label: 'Radar', icon: Radio, badge: peers.length },
            { id: 'rooms', label: 'Pairing', icon: QrCode, badge: 0 },
          ] as const
        ).map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative min-h-[48px] py-1 flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-sky-600' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <IconComponent className="w-5 h-5" />
                {item.badge > 0 && (
                  <span
                    className={`absolute -top-1.5 -right-3.5 px-1 min-w-[16px] h-4 rounded-full text-[9px] font-mono font-bold flex items-center justify-center ${
                      isActive
                        ? 'bg-sky-600 text-white'
                        : 'bg-slate-200/90 text-slate-700'
                    }`}
                  >
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold tracking-tight mt-0.5 whitespace-nowrap">
                {item.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-indicator"
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute top-0 w-8 h-0.5 bg-sky-600 rounded-full"
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick Upload & Categorize Bottom Sheet / Modal */}
      <AnimatePresence>
        {quickUploadModalOpen && (
          <motion.div
            key="quick-upload-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/55 backdrop-blur-sm p-0 md:p-4"
            onClick={() => setQuickUploadModalOpen(false)}
          >
            <motion.div
              key="quick-upload-sheet"
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-2xl bg-white rounded-t-3xl md:rounded-3xl max-h-[90vh] overflow-y-auto relative shadow-2xl shadow-slate-950/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mt-3 mb-1 md:hidden" />
              <div className="flex items-center justify-between px-6 pt-4 pb-2">
                <span className="text-xs font-semibold text-slate-500">
                  Quick File Drop · Room {roomCode}
                </span>
                <button
                  type="button"
                  onClick={() => setQuickUploadModalOpen(false)}
                  aria-label="Close upload modal"
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="px-2 pb-2">
                <UploadCategorizePanel
                  categories={categories}
                  activeRoomCode={roomCode}
                  senderName={senderName}
                  senderDevice={senderDevice}
                  canUpload={canUploadOrCreateCategory(currentUser)}
                  userRoleLabel={
                    currentUser ? formatRoleLabel(currentUser.role) : 'Guest (Read-Only)'
                  }
                  currentVaultBytes={totalVaultSize}
                  softStorageLimitBytes={softStorageLimitBytes}
                  vaultFiles={files}
                  persistentE2eeConfig={persistentE2eeConfig}
                  onPersistentE2eeConfigChange={handlePersistentE2eeConfigChange}
                  onDeleteOldFile={handleDeleteFile}
                  onManageOldFilesInVault={handleManageOldFilesInVault}
                  onStorageLimitExceededAttempt={handleStorageLimitExceededAttempt}
                  onOpenAuthModal={() => {
                    setQuickUploadModalOpen(false);
                    setAuthModalOpen(true);
                  }}
                  onUploadFile={handleUploadFile}
                  onAddCategory={handleAddCategory}
                  onUploadComplete={() => {
                    setStorageLimitNotification(null);
                    setQuickUploadModalOpen(false);
                    setActiveTab('vault');
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dedicated File Preview Modal for Text, Code, and Images */}
      <FilePreviewModal
        file={previewModalFile}
        hasPrev={hasPrevPreviewFile}
        hasNext={hasNextPreviewFile}
        onPrevFile={handlePrevPreviewFile}
        onNextFile={handleNextPreviewFile}
        onClose={() => setPreviewModalFileId(null)}
        onDownloadFile={handleDownloadFile}
        onOpenFullInspector={(fileId) => {
          setPreviewModalFileId(null);
          setSelectedFileId(fileId);
        }}
      />

      {/* File Detail & Category Assignment Bottom Sheet */}
      <FileDetailSheet
        file={selectedFile}
        categories={categories}
        activeRoomCode={roomCode}
        canEdit={selectedFile ? canModifyOrDeleteFile(currentUser, selectedFile) : false}
        hasPrev={hasPrevFile}
        hasNext={hasNextFile}
        onPrevFile={handlePrevFile}
        onNextFile={handleNextFile}
        activeTransfer={
          selectedFile
            ? activeTransfers.find(
                (t) => t.fileId === selectedFile.id || t.fileName === selectedFile.name
              ) || null
            : null
        }
        onDownloadFile={handleDownloadFile}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onClose={() => setSelectedFileId(null)}
        onUpdateFile={handleUpdateFile}
        onDeleteFile={handleDeleteFile}
        onAddCategory={handleAddCategory}
      />

      {/* Dedicated File QR Code Generator, 4x6 Card & Batch Print Index Card Sheet Modal */}
      <AnimatePresence>
        {qrModalFile && (
          <motion.div
            key="file-qr-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
            onClick={() => {
              setQrModalFileId(null);
              setQrModalBatchMode(false);
            }}
          >
            <motion.div
              key="file-qr-modal-dialog"
              id="file-qr-modal-dialog"
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="file-qr-modal-title"
              className={`w-full ${
                qrModalBatchMode ? 'max-w-2xl' : 'max-w-md'
              } bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl shadow-slate-950/20`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto -mt-2 mb-1 md:hidden" />

              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
                    <QrCode className="w-4 h-4 text-sky-400" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      id="file-qr-modal-title"
                      className="text-base font-bold text-slate-900 truncate"
                    >
                      {qrModalBatchMode
                        ? `Batch Print QR Sheet (${batchQrFiles.length} Files) · Room ${roomCode}`
                        : `File QR Code · Room ${roomCode}`}
                    </h3>
                    <p className="text-xs text-slate-500 truncate">
                      {qrModalBatchMode
                        ? 'Index card sheet with one scannable QR code per selected file'
                        : 'Scan in pairing room to download immediately'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setQrModalFileId(null);
                    setQrModalBatchMode(false);
                  }}
                  aria-label="Close File QR Modal"
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Batch Print Mode Toggle Bar + Single 4x6 Card vs. Batch Print Index Card Sheet Switcher */}
              <div className="space-y-2">
                <div
                  data-testid="qr-batch-print-mode-bar"
                  className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Printer className="w-4 h-4 text-sky-600 shrink-0" />
                    <div className="min-w-0 text-left">
                      <span className="block text-xs font-bold text-slate-900">
                        Batch Print
                      </span>
                      <span className="block text-[10px] font-mono text-slate-500 truncate">
                        Print multiple files at once on a 4×6" index card sheet
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={qrModalBatchMode}
                    aria-label="Batch Print"
                    data-testid="qr-batch-print-mode-toggle"
                    onClick={() => setQrModalBatchMode((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-600 ${
                      qrModalBatchMode ? 'bg-sky-600' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
                        qrModalBatchMode ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-slate-100">
                  <button
                    type="button"
                    aria-pressed={!qrModalBatchMode}
                    onClick={() => setQrModalBatchMode(false)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all interactive-press ${
                      !qrModalBatchMode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <QrCode className="w-3.5 h-3.5 text-sky-600" />
                    <span>Single 4×6" Card</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={qrModalBatchMode}
                    data-testid="qr-batch-print-tab-btn"
                    onClick={() => setQrModalBatchMode(true)}
                    className={`min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all interactive-press ${
                      qrModalBatchMode
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Printer className="w-3.5 h-3.5 text-sky-600" />
                    <span>Batch Print ({batchQrFiles.length})</span>
                  </button>
                </div>
              </div>

              {qrModalBatchMode ? (
                <div className="space-y-4">
                  {/* Multi-File Selection Bar for Batch Index Card Sheet */}
                  <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        Select Files for Index Card Sheet ({batchQrFiles.length} selected)
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setCheckedFileIds(files.map((f) => f.id))}
                          className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-700"
                        >
                          Select All ({files.length})
                        </button>
                        {checkedFileIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setCheckedFileIds([])}
                            className="px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[10px] font-semibold text-slate-600"
                          >
                            Default (6)
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {files.map((f) => {
                        const isIncluded = batchQrFiles.some((bf) => bf.id === f.id);
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              const currentIds = batchQrFiles.map((bf) => bf.id);
                              if (currentIds.includes(f.id)) {
                                if (currentIds.length > 1) {
                                  setCheckedFileIds(currentIds.filter((id) => id !== f.id));
                                }
                              } else {
                                setCheckedFileIds([...currentIds, f.id]);
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1.5 transition-colors ${
                              isIncluded
                                ? 'bg-sky-600 border-sky-600 text-white'
                                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <span className="truncate max-w-[150px]">{f.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Printable Batch Index Card Sheet Preview */}
                  <div
                    data-testid="qr-batch-sheet-preview"
                    className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-3"
                  >
                    <div className="pb-2.5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-sky-700">
                          RelayDrop · Batch QR Index Card Sheet
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {batchQrFiles.length}{' '}
                          {batchQrFiles.length === 1 ? 'File Card' : 'File Cards'} · One QR Code Per File
                        </span>
                      </div>
                      <span className="px-2 py-1 rounded-md bg-slate-900 text-white font-mono text-[11px] font-bold">
                        ROOM {roomCode}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1">
                      {batchQrFiles.map((batchFile, idx) => {
                        const itemUrl = buildFileQrPayloadUrl({
                          fileId: batchFile.id,
                          roomCode: batchFile.roomCode || roomCode,
                        });
                        return (
                          <div
                            key={batchFile.id}
                            data-testid={`batch-qr-card-${idx}`}
                            data-card-size="4x6"
                            className="p-3 rounded-xl bg-white border-2 border-slate-900 flex flex-col justify-between space-y-2 text-left shadow-2xs"
                          >
                            <div className="pb-1.5 border-b border-slate-900 flex items-center justify-between gap-1.5">
                              <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-sky-700">
                                4×6" Card #{idx + 1} of {batchQrFiles.length}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[9px] font-bold">
                                ROOM {batchFile.roomCode || roomCode}
                              </span>
                            </div>

                            <div className="py-1 flex flex-col items-center justify-center">
                              <QrMatrixSvg
                                value={itemUrl}
                                size={118}
                                errorCorrectionLevel={qrQualityLevel}
                                includeLogo={includeQrLogo}
                              />
                            </div>

                            <div className="pt-1.5 border-t border-slate-900 space-y-1">
                              <p className="text-xs font-bold text-slate-900 truncate">
                                {batchFile.name}
                              </p>
                              <div className="flex items-center justify-between text-[10px] text-slate-600 font-mono">
                                <span className="truncate font-sans font-semibold text-slate-700">
                                  {batchFile.category}
                                </span>
                                <span>{formatBytes(batchFile.size)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleBatchPrintSelectedQrCards}
                    data-testid="qr-batch-print-sheet-action-btn"
                    title="Directly trigger browser print dialog for the batch QR index card sheet"
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-sm interactive-press"
                  >
                    <Printer className="w-4 h-4" />
                    <span>
                      Batch Print QR Sheet ({batchQrFiles.length}{' '}
                      {batchQrFiles.length === 1 ? 'Index Card' : 'Index Cards'})
                    </span>
                  </button>
                </div>
              ) : (
                (() => {
                const fileQrUrl = buildFileQrPayloadUrl({
                  fileId: qrModalFile.id,
                  roomCode,
                });

                const handleTriggerPrintQrCard = () => {
                  printFileQrIndexCard({
                    value: fileQrUrl,
                    fileName: qrModalFile.name,
                    category: qrModalFile.category,
                    sizeLabel: formatBytes(qrModalFile.size),
                    roomCode,
                    senderName: qrModalFile.senderName,
                    uploadDate: qrModalFile.uploadDate,
                    encrypted: qrModalFile.encrypted,
                    encryptionFingerprint: qrModalFile.encryptionFingerprint,
                    pinProtected: qrModalFile.pinProtected,
                    notes: qrModalFile.notes,
                    errorCorrectionLevel: qrQualityLevel,
                    backgroundColor: qrCardBgColor,
                    cornerRadius: qrCornerRadius,
                  });
                  recordFilesInRecentQrPrints([qrModalFile]);
                  triggerToast(
                    `Opening print dialog for "${qrModalFile.name}" (4×6" index card)`
                  );
                };

                const handleReprintRecentEntry = (entry: RecentQrPrintEntry) => {
                  const matchedVaultFile = files.find((f) => f.id === entry.fileId);
                  const targetRoom = entry.roomCode || roomCode;
                  const targetUrl = buildFileQrPayloadUrl({
                    fileId: entry.fileId,
                    roomCode: targetRoom,
                  });

                  printFileQrIndexCard({
                    value: targetUrl,
                    fileName: entry.fileName,
                    category: entry.category,
                    sizeLabel: entry.sizeLabel || formatBytes(entry.size),
                    roomCode: targetRoom,
                    senderName: entry.senderName,
                    uploadDate: entry.uploadDate,
                    encrypted: entry.encrypted,
                    encryptionFingerprint: entry.encryptionFingerprint,
                    pinProtected: entry.pinProtected,
                    notes: entry.notes,
                    backgroundColor: qrCardBgColor,
                    cornerRadius: qrCornerRadius,
                  });

                  if (matchedVaultFile) {
                    recordFilesInRecentQrPrints([matchedVaultFile], 'Re-print');
                  } else {
                    const nowIso = new Date().toISOString();
                    setSessionQrPrintLog((prev) => [
                      {
                        id: `print-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        fileId: entry.fileId,
                        fileName: entry.fileName,
                        category: entry.category,
                        size: entry.size,
                        sizeLabel: entry.sizeLabel || formatBytes(entry.size),
                        roomCode: targetRoom,
                        senderName: entry.senderName,
                        qualityLevel: qrQualityLevel,
                        printMode: 'Re-print',
                        timestamp: nowIso,
                      },
                      ...prev,
                    ]);
                    setRecentQrPrints((prev) => {
                      const next: RecentQrPrintEntry[] = [
                        {
                          ...entry,
                          printedAt: nowIso,
                          printCount: (entry.printCount || 1) + 1,
                        },
                        ...prev.filter((item) => item.fileId !== entry.fileId),
                      ].slice(0, MAX_RECENT_QR_PRINTS);
                      try {
                        window.localStorage.setItem(
                          RECENT_QR_PRINTS_STORAGE_KEY,
                          JSON.stringify(next)
                        );
                      } catch {
                        // Ignore storage error
                      }
                      return next;
                    });
                  }

                  triggerToast(
                    `Re-opening print dialog for "${entry.fileName}" (4×6" index card)`
                  );
                };

                const buildRecentPrintsAuditCsv = () => {
                  const escapeCsvCell = (val: unknown): string => {
                    const str = String(val ?? '');
                    if (/[",\n\r]/.test(str)) {
                      return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                  };

                  const auditRows: RecentQrPrintEntry[] =
                    recentQrPrints.length > 0
                      ? recentQrPrints
                      : [
                          {
                            fileId: qrModalFile.id,
                            fileName: qrModalFile.name,
                            category: qrModalFile.category,
                            size: qrModalFile.size,
                            sizeLabel: formatBytes(qrModalFile.size),
                            roomCode,
                            senderName: qrModalFile.senderName,
                            uploadDate: qrModalFile.uploadDate,
                            encrypted: qrModalFile.encrypted,
                            encryptionFingerprint: qrModalFile.encryptionFingerprint,
                            pinProtected: qrModalFile.pinProtected,
                            notes: qrModalFile.notes,
                            printedAt: new Date().toISOString(),
                            printCount: 1,
                          },
                        ];

                  const headers = [
                    'File ID',
                    'File Name',
                    'Category',
                    'Size (Bytes)',
                    'Formatted Size',
                    'Room Code',
                    'Sender',
                    'Upload Date',
                    'Security Status',
                    'Print Count',
                    'Last Printed At',
                    'QR Payload URL',
                  ];

                  const lines = [
                    headers.map(escapeCsvCell).join(','),
                    ...auditRows.map((entry) => {
                      const entryRoom = entry.roomCode || roomCode;
                      const securityStatus = entry.encrypted
                        ? 'E2EE (AES-256-GCM)'
                        : entry.pinProtected
                        ? 'PIN Protected'
                        : 'Standard';
                      const payloadUrl = buildFileQrPayloadUrl({
                        fileId: entry.fileId,
                        roomCode: entryRoom,
                      });
                      return [
                        entry.fileId,
                        entry.fileName,
                        entry.category,
                        entry.size,
                        entry.sizeLabel || formatBytes(entry.size),
                        entryRoom,
                        entry.senderName,
                        entry.uploadDate,
                        securityStatus,
                        entry.printCount || 1,
                        entry.printedAt,
                        payloadUrl,
                      ]
                        .map(escapeCsvCell)
                        .join(',');
                    }),
                  ];

                  return {
                    rawCsv: lines.join('\r\n'),
                    rowCount: auditRows.length,
                  };
                };

                const handleCopyRecentPrintsCsv = async () => {
                  const { rawCsv, rowCount } = buildRecentPrintsAuditCsv();
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(rawCsv);
                    } else {
                      throw new Error('Clipboard API unavailable');
                    }
                  } catch {
                    try {
                      const textArea = document.createElement('textarea');
                      textArea.value = rawCsv;
                      textArea.style.position = 'fixed';
                      textArea.style.opacity = '0';
                      document.body.appendChild(textArea);
                      textArea.select();
                      document.execCommand('copy');
                      document.body.removeChild(textArea);
                    } catch {
                      // Ignore fallback copy error
                    }
                  }

                  setCopiedRecentPrintsCsv(true);
                  setTimeout(() => setCopiedRecentPrintsCsv(false), 2800);
                  triggerToast(
                    `Copied QR print audit CSV (${rowCount} ${
                      rowCount === 1 ? 'record' : 'records'
                    }) to clipboard`
                  );
                };

                const handleExportRecentPrintsCsv = () => {
                  const { rawCsv, rowCount } = buildRecentPrintsAuditCsv();
                  const csvContent = `\uFEFF${rawCsv}`;
                  const blob = new Blob([csvContent], {
                    type: 'text/csv;charset=utf-8;',
                  });
                  const url = URL.createObjectURL(blob);
                  const downloadLink = document.createElement('a');
                  const fileName = `relaydrop-qr-print-history-${roomCode}-${getTodayIsoDate()}.csv`;
                  downloadLink.href = url;
                  downloadLink.download = fileName;
                  document.body.appendChild(downloadLink);
                  downloadLink.click();
                  document.body.removeChild(downloadLink);
                  setTimeout(() => URL.revokeObjectURL(url), 1000);

                  setExportedRecentPrintsCsv(true);
                  setTimeout(() => setExportedRecentPrintsCsv(false), 2800);
                  triggerToast(
                    `Exported QR print audit CSV (${rowCount} ${
                      rowCount === 1 ? 'record' : 'records'
                    })`
                  );
                };

                const handleConfirmClearAllRecentPrints = () => {
                  setRecentQrPrints([]);
                  setSessionQrPrintLog([]);
                  setConfirmClearRecentPrintsOpen(false);
                  try {
                    window.localStorage.setItem(
                      RECENT_QR_PRINTS_STORAGE_KEY,
                      JSON.stringify([])
                    );
                  } catch {
                    // Ignore storage error
                  }
                  triggerToast('Cleared all recent print history');
                };

                const handleTriggerWebShareQr = async (
                  shareTarget: 'auto' | 'link' | 'qr-image' = 'auto'
                ) => {
                  const outcome = await shareFileQrViaWebShare({
                    value: fileQrUrl,
                    fileName: qrModalFile.name,
                    category: qrModalFile.category,
                    sizeLabel: formatBytes(qrModalFile.size),
                    roomCode,
                    shareTarget,
                    errorCorrectionLevel: qrQualityLevel,
                  });
                  if (outcome === 'shared-image') {
                    triggerToast(`Shared QR image & direct link for "${qrModalFile.name}"`);
                  } else if (outcome === 'shared-link') {
                    triggerToast(`Shared direct link for "${qrModalFile.name}"`);
                  } else if (outcome === 'copied-link') {
                    setCopiedFileQrUrl(true);
                    setTimeout(() => setCopiedFileQrUrl(false), 2500);
                    triggerToast(
                      `Copied direct share link for "${qrModalFile.name}"`
                    );
                  }
                };

                const handleCopyDirectFileLink = async () => {
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(fileQrUrl);
                    } else {
                      const tempInput = document.createElement('textarea');
                      tempInput.value = fileQrUrl;
                      document.body.appendChild(tempInput);
                      tempInput.select();
                      document.execCommand('copy');
                      document.body.removeChild(tempInput);
                    }
                  } catch {
                    // Ignore clipboard fallback
                  }
                  setCopiedFileQrUrl(true);
                  setTimeout(() => setCopiedFileQrUrl(false), 2500);
                };

                const fileMetadataJson = JSON.stringify(
                  {
                    name: qrModalFile.name,
                    category: qrModalFile.category,
                    size: qrModalFile.size,
                    sizeFormatted: formatBytes(qrModalFile.size),
                  },
                  null,
                  2
                );

                const handleCopyFileMetadataJson = async () => {
                  try {
                    if (navigator.clipboard?.writeText) {
                      await navigator.clipboard.writeText(fileMetadataJson);
                    } else {
                      const tempInput = document.createElement('textarea');
                      tempInput.value = fileMetadataJson;
                      document.body.appendChild(tempInput);
                      tempInput.select();
                      document.execCommand('copy');
                      document.body.removeChild(tempInput);
                    }
                  } catch {
                    // Ignore clipboard fallback
                  }
                  setCopiedFileMetadataJson(true);
                  setTimeout(() => setCopiedFileMetadataJson(false), 2800);
                  triggerToast(`Copied metadata JSON for "${qrModalFile.name}"`);
                };

                const handleAddFileToLocalVault = () => {
                  const nowIso = new Date().toISOString();
                  const todayDate = getTodayIsoDate();
                  const savedFileMetadata: SharedFile = {
                    ...qrModalFile,
                    roomCode: roomCode || qrModalFile.roomCode || '842-910',
                    uploadedAt: qrModalFile.uploadedAt || nowIso,
                    uploadDate: qrModalFile.uploadDate || todayDate,
                  };

                  try {
                    const storageKey = 'relaydrop_local_vault_files_v1';
                    const rawExisting = window.localStorage.getItem(storageKey);
                    const parsedExisting: SharedFile[] = rawExisting
                      ? JSON.parse(rawExisting)
                      : [];
                    const deduped = [
                      savedFileMetadata,
                      ...parsedExisting.filter((item) => item && item.id !== savedFileMetadata.id),
                    ];
                    window.localStorage.setItem(storageKey, JSON.stringify(deduped));
                  } catch {
                    // Ignore localStorage quota errors
                  }

                  setFiles((prev) => {
                    const existsIndex = prev.findIndex((f) => f.id === savedFileMetadata.id);
                    if (existsIndex === -1) {
                      return [savedFileMetadata, ...prev];
                    }
                    const updated = [...prev];
                    updated[existsIndex] = {
                      ...updated[existsIndex],
                      ...savedFileMetadata,
                    };
                    return updated;
                  });

                  if (
                    savedFileMetadata.category &&
                    !categories.includes(savedFileMetadata.category)
                  ) {
                    setCategories((prev) =>
                      prev.includes(savedFileMetadata.category)
                        ? prev
                        : [...prev, savedFileMetadata.category]
                    );
                  }

                  recordActivitiesLocally({
                    id: `act-vault-save-${Date.now()}`,
                    action: 'upload',
                    fileId: savedFileMetadata.id,
                    fileName: savedFileMetadata.name,
                    fileSize: savedFileMetadata.size,
                    category: savedFileMetadata.category,
                    actorName: currentUser?.displayName || senderName || 'Alex Rivera',
                    actorDevice: senderDevice,
                    actorRole: currentUser?.role || 'admin',
                    roomCode: savedFileMetadata.roomCode,
                    details: `Saved file metadata "${savedFileMetadata.name}" to local vault from QR modal`,
                    timestamp: nowIso,
                  });

                  setAddedToVaultQrFile(true);
                  setTimeout(() => setAddedToVaultQrFile(false), 2800);
                  triggerToast(`Added "${qrModalFile.name}" to local vault`);
                };

                const emailSubject = `RelayDrop File Share: ${qrModalFile.name} (Room ${roomCode})`;
                const emailBody = [
                  `Here is the direct file link and metadata shared via RelayDrop:`,
                  ``,
                  `File Name: ${qrModalFile.name}`,
                  `Direct File Link: ${fileQrUrl}`,
                  `Category: ${qrModalFile.category}`,
                  `Size: ${formatBytes(qrModalFile.size)}`,
                  `Pairing Room: ${roomCode}`,
                  `Sender: ${qrModalFile.senderName}`,
                  `Upload Date: ${qrModalFile.uploadDate}`,
                  `Security: ${
                    qrModalFile.encrypted
                      ? 'End-to-End Encrypted (AES-256-GCM)'
                      : qrModalFile.pinProtected
                      ? 'PIN Protected'
                      : 'Standard Room Access'
                  }`,
                ].join('\n');
                const fileMailtoUrl = `mailto:?subject=${encodeURIComponent(
                  emailSubject
                )}&body=${encodeURIComponent(emailBody)}`;

                const handleShareViaEmail = () => {
                  try {
                    const mailtoAnchor = document.createElement('a');
                    mailtoAnchor.href = fileMailtoUrl;
                    mailtoAnchor.style.display = 'none';
                    document.body.appendChild(mailtoAnchor);
                    mailtoAnchor.click();
                    document.body.removeChild(mailtoAnchor);
                  } catch {
                    // Ignore mailto navigation error in restricted environments
                  }
                  setEmailShareTriggered(true);
                  setTimeout(() => setEmailShareTriggered(false), 3000);
                  triggerToast(`Opened email draft for "${qrModalFile.name}"`);
                };

                const smsMessageBody = `RelayDrop File Share: "${qrModalFile.name}" (${formatBytes(
                  qrModalFile.size
                )}) in Room ${roomCode}. Direct File Link: ${fileQrUrl}`;
                const fileSmsUrl = `sms:?body=${encodeURIComponent(smsMessageBody)}`;

                const handleShareViaSms = () => {
                  try {
                    const smsAnchor = document.createElement('a');
                    smsAnchor.href = fileSmsUrl;
                    smsAnchor.style.display = 'none';
                    document.body.appendChild(smsAnchor);
                    smsAnchor.click();
                    document.body.removeChild(smsAnchor);
                  } catch {
                    // Ignore sms protocol navigation error in restricted environments
                  }
                  setSmsShareTriggered(true);
                  setTimeout(() => setSmsShareTriggered(false), 3000);
                  triggerToast(`Opened SMS message for "${qrModalFile.name}" (Room ${roomCode})`);
                };

                const handleShareViaBluetooth = async () => {
                  setBluetoothSessionState({
                    status: 'scanning',
                    deviceName: 'Scanning BLE Peers...',
                    message: `Requesting Web Bluetooth device for "${qrModalFile.name}"...`,
                  });

                  type WebBluetoothNavigator = Navigator & {
                    bluetooth?: {
                      requestDevice: (options: {
                        acceptAllDevices?: boolean;
                        optionalServices?: string[];
                      }) => Promise<{
                        id?: string;
                        name?: string;
                        gatt?: {
                          connect?: () => Promise<unknown>;
                        };
                      }>;
                    };
                  };

                  const navWithBluetooth = navigator as WebBluetoothNavigator;
                  let resolvedPeerName = 'RelayDrop BLE Peer (Local P2P)';

                  try {
                    if (
                      navWithBluetooth.bluetooth &&
                      typeof navWithBluetooth.bluetooth.requestDevice === 'function'
                    ) {
                      const bleDevice = await navWithBluetooth.bluetooth.requestDevice({
                        acceptAllDevices: true,
                        optionalServices: ['generic_access', 'device_information'],
                      });
                      if (bleDevice?.name) {
                        resolvedPeerName = bleDevice.name;
                      }
                      if (bleDevice?.gatt?.connect) {
                        await bleDevice.gatt.connect();
                      }
                    }
                  } catch {
                    // Fallback to local P2P BLE session handshake when hardware dialog is dismissed or unavailable in iframe
                  }

                  setBluetoothSessionState({
                    status: 'transferring',
                    deviceName: resolvedPeerName,
                    message: `Initiated Bluetooth P2P session with ${resolvedPeerName} · Streaming "${qrModalFile.name}" (${formatBytes(qrModalFile.size)})`,
                  });
                  triggerToast(
                    `Bluetooth P2P session started with ${resolvedPeerName} for "${qrModalFile.name}"`
                  );

                  setTimeout(() => {
                    setBluetoothSessionState({
                      status: 'completed',
                      deviceName: resolvedPeerName,
                      message: `Bluetooth P2P transfer ready for "${qrModalFile.name}" (Room ${roomCode})`,
                    });
                  }, 600);
                };

                return (
                  <>
                    {/* 4x6 Index Card Formatted QR Card Preview */}
                    <div
                      data-testid="qr-card-4x6-preview"
                      data-card-size="4x6"
                      data-label-template={qrLabelTemplate}
                      data-border-style={qrBorderStyle}
                      data-corner-radius={qrCornerRadius}
                      data-bg-color={qrCardBgColor}
                      style={{
                        backgroundColor: qrCardBgColor,
                        borderRadius: `${qrCornerRadius}px`,
                      }}
                      className={`border-2 border-slate-900 shadow-xs transition-all overflow-hidden ${
                        qrBorderStyle === 'Dashed' ? 'border-dashed' : 'border-solid'
                      } ${
                        qrLabelTemplate === 'Compact'
                          ? 'p-3 space-y-2'
                          : qrLabelTemplate === 'Minimalist'
                          ? 'p-5 space-y-2.5'
                          : 'p-4 flex flex-col justify-between space-y-3'
                      }`}
                    >
                      {/* Index Card Header (adapts to Minimalist / Detailed / Compact) */}
                      {qrLabelTemplate === 'Minimalist' ? (
                        <div className="flex items-center justify-between gap-2 text-left">
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500">
                            Minimalist Label
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-900 text-white font-mono text-[10px] font-bold shrink-0">
                            ROOM {roomCode}
                          </span>
                        </div>
                      ) : (
                        <div className="pb-2 border-b-2 border-slate-900 flex items-center justify-between gap-2 text-left">
                          <div>
                            <span className="block text-[10px] font-mono font-bold uppercase tracking-wider text-sky-700">
                              RelayDrop · 4×6" Index Card ({qrLabelTemplate})
                            </span>
                            {qrLabelTemplate === 'Detailed' && (
                              <span className="text-xs font-bold text-slate-900">
                                Instant P2P File Transfer Card
                              </span>
                            )}
                          </div>
                          <span className="px-2 py-1 rounded-md bg-slate-900 text-white font-mono text-[11px] font-bold shrink-0">
                            ROOM {roomCode}
                          </span>
                        </div>
                      )}

                      {/* Centered Optical QR Matrix */}
                      <div className="py-1 flex flex-col items-center text-center">
                        <QrMatrixSvg
                          value={fileQrUrl}
                          size={qrLabelTemplate === 'Compact' ? 144 : 184}
                          errorCorrectionLevel={qrQualityLevel}
                          includeLogo={includeQrLogo}
                        />
                        <span className="mt-1.5 text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
                          Scan in pairing room to download immediately · Template: {qrLabelTemplate} · Quality: {QR_QUALITY_LABELS[qrQualityLevel]} ({qrQualityLevel}){includeQrLogo ? ' · Logo Embedded' : ''}
                        </span>
                      </div>

                      {/* Ruled File Metadata Footer (Minimalist vs Compact vs Detailed) */}
                      {qrLabelTemplate === 'Minimalist' ? (
                        <div className="pt-1.5 border-t border-slate-200 text-center">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {qrModalFile.name}
                          </p>
                        </div>
                      ) : qrLabelTemplate === 'Compact' ? (
                        <div className="pt-2 border-t border-slate-900 flex items-center justify-between gap-2 text-left">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {qrModalFile.name}
                          </p>
                          <span className="text-[10px] font-mono font-semibold text-slate-600 shrink-0">
                            {qrModalFile.category} · {formatBytes(qrModalFile.size)}
                          </span>
                        </div>
                      ) : (
                        <div className="pt-2.5 border-t-2 border-slate-900 space-y-1.5 text-left">
                          <p className="text-sm font-bold text-slate-900 truncate">
                            {qrModalFile.name}
                          </p>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-slate-200">
                            <div className="truncate">
                              <span className="font-mono text-slate-500">Category: </span>
                              <span className="font-semibold text-slate-800">
                                {qrModalFile.category}
                              </span>
                            </div>
                            <div className="truncate">
                              <span className="font-mono text-slate-500">Size: </span>
                              <span className="font-mono tabular-nums font-semibold text-slate-800">
                                {formatBytes(qrModalFile.size)}
                              </span>
                            </div>
                            <div className="truncate">
                              <span className="font-mono text-slate-500">Sender: </span>
                              <span className="font-semibold text-slate-800">
                                {qrModalFile.senderName}
                              </span>
                            </div>
                            <div className="truncate">
                              <span className="font-mono text-slate-500">Format: </span>
                              <span className="font-mono font-semibold text-sky-700">
                                4×6 in Card ({qrLabelTemplate})
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Label Template Selector (Minimalist, Detailed, Compact) */}
                    <div
                      data-testid="qr-label-template-control"
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                    >
                      <label
                        htmlFor="qr-label-template-select"
                        className="text-xs font-bold text-slate-900 flex items-center gap-1.5"
                      >
                        <Printer className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>Label Template</span>
                        <span className="text-[10px] font-mono font-semibold text-slate-500">
                          (Card Layout)
                        </span>
                      </label>

                      <select
                        id="qr-label-template-select"
                        aria-label="Label Template"
                        data-testid="qr-label-template-select"
                        value={qrLabelTemplate}
                        onChange={(e) => {
                          const val = e.target.value as 'Minimalist' | 'Detailed' | 'Compact';
                          setQrLabelTemplate(val);
                          triggerToast(`QR index card template set to ${val}`);
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      >
                        <option value="Minimalist">Minimalist</option>
                        <option value="Detailed">Detailed</option>
                        <option value="Compact">Compact</option>
                      </select>
                    </div>

                    {/* Border Style Radio Toggle Group (Solid, Dashed, Rounded) */}
                    <div
                      role="radiogroup"
                      aria-label="Border Style"
                      data-testid="qr-border-style-control"
                      className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                    >
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Border Style</span>
                      </span>

                      <div className="inline-flex items-center gap-1.5 p-1 rounded-lg bg-white border border-slate-200">
                        {(['Solid', 'Dashed', 'Rounded'] as const).map((styleOption) => {
                          const isChecked = qrBorderStyle === styleOption;
                          return (
                            <label
                              key={styleOption}
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer select-none flex items-center gap-1.5 transition-colors ${
                                isChecked
                                  ? 'bg-slate-900 text-white shadow-2xs'
                                  : 'text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <input
                                type="radio"
                                name="qr-border-style"
                                value={styleOption}
                                checked={isChecked}
                                onChange={() => {
                                  setQrBorderStyle(styleOption);
                                  if (styleOption === 'Solid') {
                                    setQrCornerRadius(0);
                                  } else if (styleOption === 'Dashed' && qrCornerRadius === 0) {
                                    setQrCornerRadius(12);
                                  } else if (styleOption === 'Rounded' && qrCornerRadius === 0) {
                                    setQrCornerRadius(24);
                                  }
                                  triggerToast(`QR card border style set to ${styleOption}`);
                                }}
                                aria-label={styleOption}
                                data-testid={`qr-border-style-${styleOption.toLowerCase()}`}
                                className="sr-only"
                              />
                              <span>{styleOption}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    {/* Corner Radius Range Slider Control */}
                    <div
                      data-testid="qr-corner-radius-control"
                      className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="qr-corner-radius-slider"
                          className="text-xs font-bold text-slate-900 flex items-center gap-1.5 cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          <span>Corner Radius</span>
                          <span className="text-[10px] font-mono font-semibold text-slate-500">
                            (Card Curvature)
                          </span>
                        </label>

                        <div className="flex items-center gap-2">
                          <span
                            data-testid="qr-corner-radius-value"
                            className="px-2 py-0.5 rounded-md bg-white border border-slate-200 font-mono text-xs font-bold text-slate-800 tabular-nums shadow-2xs"
                          >
                            {qrCornerRadius}px
                          </span>
                          {qrCornerRadius !== 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setQrCornerRadius(0);
                                if (qrBorderStyle === 'Rounded') {
                                  setQrBorderStyle('Solid');
                                }
                                triggerToast('Corner radius reset to 0px');
                              }}
                              aria-label="Reset Corner Radius"
                              title="Reset to 0px (Square corners)"
                              data-testid="qr-corner-radius-reset-btn"
                              className="text-[10px] font-mono font-semibold text-slate-400 hover:text-slate-700 underline"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 pt-0.5">
                        <span className="text-[10px] font-mono font-semibold text-slate-400">0px</span>
                        <input
                          id="qr-corner-radius-slider"
                          type="range"
                          min={0}
                          max={48}
                          step={2}
                          value={qrCornerRadius}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setQrCornerRadius(val);
                            if (val === 0 && qrBorderStyle === 'Rounded') {
                              setQrBorderStyle('Solid');
                            } else if (val > 0 && qrBorderStyle === 'Solid') {
                              setQrBorderStyle('Rounded');
                            }
                          }}
                          aria-label="Card Corner Radius"
                          data-testid="qr-corner-radius-slider"
                          className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-600"
                        />
                        <span className="text-[10px] font-mono font-semibold text-slate-400">48px</span>
                      </div>

                      <div className="flex items-center justify-between pt-0.5 text-[10px] font-mono text-slate-500">
                        <button
                          type="button"
                          onClick={() => {
                            setQrCornerRadius(0);
                            if (qrBorderStyle === 'Rounded') setQrBorderStyle('Solid');
                            triggerToast('Corner radius: Square (0px)');
                          }}
                          className={`px-1.5 py-0.5 rounded hover:bg-slate-200/70 transition-colors ${
                            qrCornerRadius === 0 ? 'font-bold text-sky-700 bg-sky-50' : ''
                          }`}
                        >
                          Square (0px)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQrCornerRadius(12);
                            triggerToast('Corner radius: Medium (12px)');
                          }}
                          className={`px-1.5 py-0.5 rounded hover:bg-slate-200/70 transition-colors ${
                            qrCornerRadius === 12 ? 'font-bold text-sky-700 bg-sky-50' : ''
                          }`}
                        >
                          Medium (12px)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQrCornerRadius(24);
                            setQrBorderStyle('Rounded');
                            triggerToast('Corner radius: Rounded (24px)');
                          }}
                          className={`px-1.5 py-0.5 rounded hover:bg-slate-200/70 transition-colors ${
                            qrCornerRadius === 24 ? 'font-bold text-sky-700 bg-sky-50' : ''
                          }`}
                        >
                          Large (24px)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setQrCornerRadius(40);
                            setQrBorderStyle('Rounded');
                            triggerToast('Corner radius: Pill (40px)');
                          }}
                          className={`px-1.5 py-0.5 rounded hover:bg-slate-200/70 transition-colors ${
                            qrCornerRadius === 40 ? 'font-bold text-sky-700 bg-sky-50' : ''
                          }`}
                        >
                          Pill (40px)
                        </button>
                      </div>
                    </div>

                    {/* Background Color Color Picker */}
                    <div
                      data-testid="qr-bg-color-control"
                      className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                    >
                      <label
                        htmlFor="qr-bg-color-picker"
                        className="text-xs font-bold text-slate-900 flex items-center gap-1.5 cursor-pointer"
                      >
                        <Palette className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                        <span>Background Color</span>
                        <span className="text-[10px] font-mono font-semibold text-slate-500">
                          (Card Fill)
                        </span>
                      </label>

                      <div className="flex items-center gap-2">
                        {/* Quick Presets */}
                        <div className="flex items-center gap-1">
                          {[
                            { color: '#ffffff', label: 'White' },
                            { color: '#fef3c7', label: 'Manila' },
                            { color: '#ecfdf5', label: 'Mint' },
                            { color: '#eff6ff', label: 'Sky' },
                            { color: '#fdf2f8', label: 'Rose' },
                            { color: '#f1f5f9', label: 'Slate' },
                          ].map((preset) => (
                            <button
                              key={preset.color}
                              type="button"
                              onClick={() => {
                                setQrCardBgColor(preset.color);
                                triggerToast(`Card background set to ${preset.label} (${preset.color})`);
                              }}
                              aria-label={`Set background color to ${preset.label}`}
                              title={`${preset.label} (${preset.color})`}
                              data-testid={`qr-bg-preset-${preset.label.toLowerCase()}`}
                              className={`w-5 h-5 rounded-full border transition-all ${
                                qrCardBgColor.toLowerCase() === preset.color.toLowerCase()
                                  ? 'ring-2 ring-indigo-600 ring-offset-1 border-slate-900 scale-110'
                                  : 'border-slate-300 hover:scale-105'
                              }`}
                              style={{ backgroundColor: preset.color }}
                            />
                          ))}
                        </div>

                        {/* Color input picker */}
                        <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-200">
                          <input
                            id="qr-bg-color-picker"
                            type="color"
                            value={qrCardBgColor}
                            onChange={(e) => {
                              setQrCardBgColor(e.target.value);
                            }}
                            aria-label="Background Color Picker"
                            data-testid="qr-bg-color-picker"
                            className="w-7 h-7 rounded-lg border border-slate-300 cursor-pointer p-0.5 bg-white shrink-0"
                          />
                          <span className="text-[10px] font-mono font-semibold text-slate-600 uppercase">
                            {qrCardBgColor}
                          </span>
                          {qrCardBgColor.toLowerCase() !== '#ffffff' && (
                            <button
                              type="button"
                              onClick={() => {
                                setQrCardBgColor('#ffffff');
                                triggerToast('Reset card background to White');
                              }}
                              aria-label="Reset Background Color"
                              title="Reset to default white"
                              data-testid="qr-bg-color-reset-btn"
                              className="text-[10px] font-mono font-semibold text-slate-400 hover:text-slate-700 underline ml-0.5"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* QR Quality (Error Correction Level) Selector */}
                    <div
                      data-testid="qr-quality-control"
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                    >
                      <label
                        htmlFor="qr-quality-select"
                        className="text-xs font-bold text-slate-900 flex items-center gap-1.5"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                        <span>QR Quality</span>
                        <span className="text-[10px] font-mono font-semibold text-slate-500">
                          (Error Correction)
                        </span>
                      </label>

                      <select
                        id="qr-quality-select"
                        aria-label="QR Quality"
                        data-testid="qr-quality-select"
                        value={qrQualityLevel}
                        onChange={(e) => {
                          const rawVal = e.target.value.trim();
                          const map: Record<string, QrErrorCorrectionLevel> = {
                            L: 'L',
                            Low: 'L',
                            low: 'L',
                            M: 'M',
                            Medium: 'M',
                            medium: 'M',
                            Q: 'Q',
                            Quartile: 'Q',
                            quartile: 'Q',
                            H: 'H',
                            High: 'H',
                            high: 'H',
                          };
                          const resolved = map[rawVal] || 'M';
                          setQrQualityLevel(resolved);
                          triggerToast(
                            `QR Quality set to ${QR_QUALITY_LABELS[resolved]} (${resolved})`
                          );
                        }}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      >
                        <option value="L">Low</option>
                        <option value="M">Medium</option>
                        <option value="Q">Quartile</option>
                        <option value="H">High</option>
                      </select>
                    </div>

                    {/* Include RelayDrop Logo Checkbox */}
                    <div
                      data-testid="qr-include-logo-control"
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/90"
                    >
                      <label
                        htmlFor="qr-include-logo-checkbox"
                        className="flex items-center gap-2.5 cursor-pointer select-none flex-1"
                      >
                        <input
                          id="qr-include-logo-checkbox"
                          type="checkbox"
                          checked={includeQrLogo}
                          onChange={(e) => {
                            const nextChecked = e.target.checked;
                            setIncludeQrLogo(nextChecked);
                            if (nextChecked && (qrQualityLevel === 'L' || qrQualityLevel === 'M')) {
                              setQrQualityLevel('H');
                              triggerToast(
                                'Included RelayDrop Logo in QR center (High error correction enabled)'
                              );
                            } else {
                              triggerToast(
                                nextChecked
                                  ? 'Included RelayDrop Logo in QR center'
                                  : 'Removed RelayDrop Logo from QR center'
                              );
                            }
                          }}
                          aria-label="Include RelayDrop Logo"
                          data-testid="qr-include-logo-checkbox"
                          className="w-4 h-4 rounded border-slate-300 text-sky-600 focus:ring-sky-600"
                        />
                        <span className="text-xs font-bold text-slate-900">
                          Include RelayDrop Logo
                        </span>
                      </label>
                      <span className="text-[10px] font-mono font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md shrink-0">
                        {includeQrLogo ? '30% Reed-Solomon ECC' : 'Center Emblem'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={fileQrUrl}
                        aria-label="File QR Code URL"
                        className="flex-1 min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-mono text-slate-700 truncate"
                      />
                      <button
                        type="button"
                        onClick={handleCopyDirectFileLink}
                        aria-label="Copy Link"
                        data-testid="qr-copy-link-btn"
                        data-direct-url={fileQrUrl}
                        title="Copy current file's direct download URL to the system clipboard"
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                      >
                        {copiedFileQrUrl ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                        <span>Copy Link</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopyFileMetadataJson}
                        aria-label="Copy Metadata"
                        data-testid="qr-copy-metadata-btn"
                        title="Copy file name, category, and size to clipboard as a structured JSON object"
                        className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-950 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                      >
                        {copiedFileMetadataJson ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Code2 className="w-4 h-4 text-indigo-600" />
                        )}
                        <span>Copy Metadata</span>
                      </button>
                    </div>

                    {copiedFileMetadataJson && (
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="qr-copy-metadata-toast"
                        className="p-3 rounded-xl bg-slate-900 text-white text-xs space-y-1.5 shadow-md"
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold">
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>Copied Metadata JSON!</span>
                          </div>
                          <span className="text-[10px] font-mono text-sky-300">
                            name · category · size
                          </span>
                        </div>
                        <pre className="p-2 rounded-lg bg-slate-950 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
                          {fileMetadataJson}
                        </pre>
                      </div>
                    )}

                    {copiedFileQrUrl && (
                      <div
                        role="status"
                        aria-live="polite"
                        data-testid="qr-copy-link-toast"
                        className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-md"
                      >
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span>Copied!</span>
                        </div>
                        <span className="text-[11px] font-mono text-slate-300 truncate">
                          Direct file URL copied to clipboard
                        </span>
                      </div>
                    )}

                    {/* Primary Add to Vault + Share (Web Share API) + Print QR (4x6 Index Card) + Download Actions */}
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleAddFileToLocalVault}
                        aria-label="Add to Vault"
                        data-testid="qr-add-to-vault-btn"
                        title="Quickly save the scanned or viewed file metadata to your local vault with one click"
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-sm interactive-press"
                      >
                        {addedToVaultQrFile ? (
                          <Check className="w-4 h-4 text-emerald-300" />
                        ) : (
                          <FolderPlus className="w-4 h-4 text-indigo-200" />
                        )}
                        <span>Add to Vault</span>
                      </button>

                      {addedToVaultQrFile && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-added-to-vault-toast"
                          className="px-3.5 py-2 rounded-xl bg-emerald-950 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-md"
                        >
                          <div className="flex items-center gap-2">
                            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                            <span>Added to Vault!</span>
                          </div>
                          <span className="text-[11px] font-mono text-emerald-200 truncate">
                            Saved "{qrModalFile.name}" metadata to local vault
                          </span>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => handleTriggerWebShareQr('auto')}
                          title="Share file direct link or QR image via Web Share API"
                          className="min-h-[46px] px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm interactive-press"
                        >
                          <Share2 className="w-4 h-4" />
                          <span>Share</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleTriggerPrintQrCard}
                          aria-label="Print Now"
                          data-testid="qr-print-now-btn"
                          title="Directly trigger the browser's native print dialog for the current 4×6 inch index card"
                          className="min-h-[46px] px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm interactive-press"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Print Now</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleTriggerPrintQrCard}
                          title="Directly trigger browser print dialog formatted for a standard 4x6 index card size"
                          className="min-h-[46px] px-3 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap shadow-sm interactive-press"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Print QR</span>
                          <span className="text-[10px] font-mono font-semibold text-sky-100">
                            4×6"
                          </span>
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => handleTriggerWebShareQr('link')}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Share Direct Link</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleTriggerWebShareQr('qr-image')}
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/80 text-emerald-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <QrCode className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Share QR Image</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleShareViaEmail}
                          aria-label="Share via Email"
                          data-testid="qr-share-email-btn"
                          data-mailto={fileMailtoUrl}
                          {...({ href: fileMailtoUrl } as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                          title="Open a pre-formatted email draft using mailto: with the file link and metadata"
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200/80 text-sky-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <Mail className="w-3.5 h-3.5 text-sky-600" />
                          <span>Share via Email</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleShareViaSms}
                          aria-label="Share via SMS"
                          data-testid="qr-share-sms-btn"
                          data-sms={fileSmsUrl}
                          {...({ href: fileSmsUrl } as React.ButtonHTMLAttributes<HTMLButtonElement>)}
                          title="Open the default system SMS app with a pre-formatted message containing the file link and room code"
                          className="min-h-[38px] px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 border border-amber-200/80 text-amber-950 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-amber-600" />
                          <span>Share via SMS</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleShareViaBluetooth}
                          aria-label="Share via Bluetooth"
                          data-testid="qr-share-bluetooth-btn"
                          title="Use the Web Bluetooth API to initiate a local peer-to-peer file transfer session"
                          className="col-span-2 min-h-[38px] px-3 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-950 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <Bluetooth className="w-3.5 h-3.5 text-indigo-600" />
                          <span>Share via Bluetooth</span>
                        </button>
                      </div>

                      {bluetoothSessionState.status !== 'idle' && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-bluetooth-transfer-status"
                          className="px-3.5 py-2.5 rounded-xl bg-indigo-950 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-md"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Bluetooth className="w-4 h-4 text-sky-400 shrink-0" />
                            <span className="truncate">{bluetoothSessionState.message}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-indigo-800 text-[10px] font-mono text-sky-200 shrink-0">
                            {bluetoothSessionState.deviceName}
                          </span>
                        </div>
                      )}

                      {smsShareTriggered && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-sms-draft-toast"
                          className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-md"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <MessageSquare className="w-4 h-4 text-amber-400 shrink-0" />
                            <span className="truncate">
                              SMS draft opened for "{qrModalFile.name}" (Room {roomCode})
                            </span>
                          </div>
                          <a
                            href={fileSmsUrl}
                            className="text-[11px] font-mono text-amber-300 hover:text-amber-200 underline shrink-0"
                          >
                            sms: link
                          </a>
                        </div>
                      )}

                      {emailShareTriggered && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-email-draft-toast"
                          className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center justify-between gap-2 shadow-md"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Mail className="w-4 h-4 text-sky-400 shrink-0" />
                            <span className="truncate">
                              Email draft opened for "{qrModalFile.name}"
                            </span>
                          </div>
                          <a
                            href={fileMailtoUrl}
                            className="text-[11px] font-mono text-sky-300 hover:text-sky-200 underline shrink-0"
                          >
                            mailto: link
                          </a>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            await downloadFileQrPng({
                              value: fileQrUrl,
                              fileName: qrModalFile.name,
                              category: qrModalFile.category,
                              sizeLabel: formatBytes(qrModalFile.size),
                              roomCode,
                              errorCorrectionLevel: qrQualityLevel,
                              includeLogo: includeQrLogo,
                              backgroundColor: qrCardBgColor,
                            });
                            triggerToast(`Downloaded QR PNG for "${qrModalFile.name}"`);
                          }}
                          className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <Download className="w-3.5 h-3.5 text-sky-400" />
                          <span>Download QR (PNG)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            downloadFileQrSvg({
                              value: fileQrUrl,
                              fileName: qrModalFile.name,
                              category: qrModalFile.category,
                              sizeLabel: formatBytes(qrModalFile.size),
                              roomCode,
                              errorCorrectionLevel: qrQualityLevel,
                              backgroundColor: qrCardBgColor,
                            });
                            triggerToast(`Downloaded QR SVG for "${qrModalFile.name}"`);
                          }}
                          className="min-h-[44px] px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap interactive-press"
                        >
                          <QrCode className="w-3.5 h-3.5 text-sky-600" />
                          <span>Download QR (SVG)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            downloadFileQrCardPdf({
                              value: fileQrUrl,
                              fileName: qrModalFile.name,
                              category: qrModalFile.category,
                              sizeLabel: formatBytes(qrModalFile.size),
                              roomCode,
                              senderName: qrModalFile.senderName,
                              labelTemplate: qrLabelTemplate,
                              errorCorrectionLevel: qrQualityLevel,
                              includeLogo: includeQrLogo,
                              backgroundColor: qrCardBgColor,
                              cornerRadius: qrCornerRadius,
                            });
                            triggerToast(
                              `Downloaded 4×6" QR Card PDF (${qrLabelTemplate}) for "${qrModalFile.name}"`
                            );
                          }}
                          aria-label="Download PDF"
                          data-testid="qr-download-pdf-btn"
                          title="Export the current 4×6 inch QR card design as a formatted PDF file"
                          className="min-h-[44px] px-2.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shadow-2xs interactive-press"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                          <span>Download PDF</span>
                        </button>
                      </div>
                    </div>

                    {/* Recent Prints Sub-Section (Tracks the Last 5 Printed Files for Quick Re-Print) */}
                    <div
                      data-testid="qr-recent-prints-section"
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Printer className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          <h4 className="text-xs font-bold text-slate-900">
                            Recent Prints
                          </h4>
                          <span
                            data-testid="qr-recent-prints-count"
                            className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono tabular-nums text-[10px] font-bold"
                          >
                            {recentQrPrints.slice(0, MAX_RECENT_QR_PRINTS).length} / {MAX_RECENT_QR_PRINTS}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleCopyRecentPrintsCsv}
                            aria-label="Copy CSV"
                            data-testid="qr-recent-prints-copy-csv-btn"
                            title="Copy raw QR print audit logs in CSV format to the system clipboard"
                            className="min-h-[30px] px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-2xs interactive-press"
                          >
                            {copiedRecentPrintsCsv ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3 text-indigo-600" />
                            )}
                            <span>Copy CSV</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleExportRecentPrintsCsv}
                            aria-label="Export CSV"
                            data-testid="qr-recent-prints-export-csv-btn"
                            title="Download a CSV audit history of all previously generated QR index cards"
                            className="min-h-[30px] px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-2xs interactive-press"
                          >
                            {exportedRecentPrintsCsv ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <FileSpreadsheet className="w-3 h-3 text-teal-600" />
                            )}
                            <span>Export CSV</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setConfirmClearRecentPrintsOpen(true)}
                            disabled={recentQrPrints.length === 0}
                            aria-label="Clear Recent Prints"
                            data-testid="qr-recent-prints-clear-all-btn"
                            title="Remove all items from the Recent Prints section after confirmation"
                            className={`min-h-[30px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-2xs interactive-press ${
                              recentQrPrints.length === 0
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-white hover:bg-rose-50 border-slate-200 hover:border-rose-200 text-rose-700'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Clear Recent Prints</span>
                          </button>
                        </div>
                      </div>

                      {confirmClearRecentPrintsOpen && (
                        <div
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby="clear-recent-prints-dialog-title"
                          data-testid="qr-clear-recent-prints-confirm-dialog"
                          className="p-3 rounded-xl bg-rose-50 border border-rose-200 space-y-2.5"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                            <div className="space-y-0.5 text-left">
                              <p
                                id="clear-recent-prints-dialog-title"
                                className="text-xs font-bold text-rose-950"
                              >
                                Clear Recent Prints?
                              </p>
                              <p className="text-[11px] text-rose-800 leading-relaxed">
                                This will permanently remove all {recentQrPrints.length} items from your Recent Prints history.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmClearRecentPrintsOpen(false)}
                              data-testid="qr-clear-recent-prints-cancel-btn"
                              className="min-h-[32px] px-3 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-semibold whitespace-nowrap interactive-press"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleConfirmClearAllRecentPrints}
                              aria-label="Confirm Clear Recent Prints"
                              data-testid="qr-clear-recent-prints-confirm-btn"
                              className="min-h-[32px] px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Confirm</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {copiedRecentPrintsCsv && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-copy-csv-toast"
                          className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Copied Audit CSV to Clipboard!</span>
                          </div>
                          <span className="font-mono text-[10px] text-slate-300">
                            {recentQrPrints.length || 1} {(recentQrPrints.length || 1) === 1 ? 'record' : 'records'}
                          </span>
                        </div>
                      )}

                      {exportedRecentPrintsCsv && (
                        <div
                          role="status"
                          aria-live="polite"
                          data-testid="qr-export-csv-toast"
                          className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-[11px] font-semibold flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>Exported QR Print Audit CSV!</span>
                          </div>
                          <span className="font-mono text-[10px] text-slate-300">
                            {recentQrPrints.length} {recentQrPrints.length === 1 ? 'card' : 'cards'}
                          </span>
                        </div>
                      )}

                      {recentQrPrints.length === 0 ? (
                        <p className="text-xs text-slate-500 py-1">
                          No files printed yet. Click Print QR above to add to Recent Prints.
                        </p>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                          {recentQrPrints
                            .slice(0, MAX_RECENT_QR_PRINTS)
                            .map((entry, idx) => (
                              <div
                                key={entry.fileId}
                                data-testid={`recent-print-item-${idx}`}
                                className="px-3 py-2 rounded-xl bg-white border border-slate-200/80 flex items-center justify-between gap-2.5"
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[10px] font-bold shrink-0">
                                    #{idx + 1}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (files.some((f) => f.id === entry.fileId)) {
                                          setQrModalFileId(entry.fileId);
                                        }
                                      }}
                                      className="text-xs font-bold text-slate-900 hover:text-sky-700 truncate block text-left w-full"
                                      title={`Select ${entry.fileName}`}
                                    >
                                      {entry.fileName}
                                    </button>
                                    <p className="text-[10px] text-slate-500 font-mono truncate">
                                      <span className="font-sans font-semibold text-slate-600">
                                        {entry.category}
                                      </span>
                                      {' · '}
                                      <span>{entry.sizeLabel || formatBytes(entry.size)}</span>
                                      {entry.printCount > 1 ? ` · ${entry.printCount}× printed` : ''}
                                    </p>
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleReprintRecentEntry(entry)}
                                  data-testid={`recent-print-trigger-${idx}`}
                                  aria-label={`Re-print ${entry.fileName}`}
                                  title={`Re-trigger 4×6" index card print dialog for "${entry.fileName}"`}
                                  className="min-h-[32px] px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold flex items-center gap-1.5 shrink-0 whitespace-nowrap interactive-press"
                                >
                                  <Printer className="w-3 h-3" />
                                  <span>Re-print</span>
                                </button>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>

                    {/* Print History Sub-Section (Tracks Timestamps & Metadata of All QR Codes Printed in Current Session) */}
                    <div
                      data-testid="qr-print-history-section"
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                          <h4 className="text-xs font-bold text-slate-900">
                            Print History
                          </h4>
                          <span
                            data-testid="qr-print-history-count"
                            className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-800 font-mono tabular-nums text-[10px] font-bold"
                          >
                            {sessionQrPrintLog.length}{' '}
                            {sessionQrPrintLog.length === 1 ? 'print' : 'prints'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {sessionQrPrintLog.length > 0 && (
                            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer select-none">
                              <input
                                id="qr-print-history-select-all"
                                type="checkbox"
                                checked={
                                  sessionQrPrintLog.length > 0 &&
                                  sessionQrPrintLog.every((evt) =>
                                    selectedPrintHistoryIds.includes(evt.id)
                                  )
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPrintHistoryIds(
                                      sessionQrPrintLog.map((evt) => evt.id)
                                    );
                                  } else {
                                    setSelectedPrintHistoryIds([]);
                                  }
                                }}
                                aria-label="Select All Print History Items"
                                data-testid="qr-print-history-select-all"
                                className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                              />
                              <span>Select All</span>
                            </label>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (selectedPrintHistoryIds.length === 0) return;
                              const removedCount = selectedPrintHistoryIds.length;
                              const toRemoveSet = new Set(selectedPrintHistoryIds);
                              setSessionQrPrintLog((prev) =>
                                prev.filter((evt) => !toRemoveSet.has(evt.id))
                              );
                              setSelectedPrintHistoryIds([]);
                              triggerToast(
                                `Removed ${removedCount} selected ${
                                  removedCount === 1 ? 'item' : 'items'
                                } from print history`
                              );
                            }}
                            disabled={selectedPrintHistoryIds.length === 0}
                            aria-label="Bulk Remove"
                            data-testid="qr-print-history-bulk-remove-btn"
                            title="Delete selected items from the print history log"
                            className={`min-h-[30px] px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 whitespace-nowrap shadow-2xs interactive-press ${
                              selectedPrintHistoryIds.length === 0
                                ? 'bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-rose-600 hover:bg-rose-700 border-rose-600 text-white'
                            }`}
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>
                              Bulk Remove
                              {selectedPrintHistoryIds.length > 0
                                ? ` (${selectedPrintHistoryIds.length})`
                                : ''}
                            </span>
                          </button>
                        </div>
                      </div>

                      {/* Session Print Volume Line Chart */}
                      {(() => {
                        const nowMs = Date.now();
                        const bucketLabels = ['-20m', '-15m', '-10m', '-5m', 'Now'];
                        const bucketCounts = [0, 0, 0, 0, 0];

                        for (const evt of sessionQrPrintLog) {
                          const t = new Date(evt.timestamp).getTime();
                          const ageMin = Number.isFinite(t)
                            ? Math.max(0, (nowMs - t) / 60000)
                            : 0;
                          if (ageMin <= 3) bucketCounts[4] += 1;
                          else if (ageMin <= 8) bucketCounts[3] += 1;
                          else if (ageMin <= 14) bucketCounts[2] += 1;
                          else if (ageMin <= 19) bucketCounts[1] += 1;
                          else bucketCounts[0] += 1;
                        }

                        const maxCount = Math.max(1, ...bucketCounts);
                        const coords = bucketCounts.map((count, i) => {
                          const cx = 35 + i * 48;
                          const cy =
                            count === 0
                              ? 52
                              : 52 - Math.max(10, Math.round((count / maxCount) * 34));
                          return { cx, cy, count, label: bucketLabels[i] };
                        });

                        const polylinePoints = coords
                          .map((pt) => `${pt.cx},${pt.cy}`)
                          .join(' ');
                        const linePathD = coords
                          .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.cx} ${pt.cy}`)
                          .join(' ');
                        const areaPathD = `${linePathD} L ${coords[coords.length - 1].cx} 54 L ${coords[0].cx} 54 Z`;

                        return (
                          <div
                            data-testid="qr-print-volume-chart"
                            data-chart-type="line"
                            className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                              <span className="font-sans font-bold text-slate-800">
                                Session Print Volume (Line Chart)
                              </span>
                              <span className="text-indigo-700 font-semibold tabular-nums">
                                Peak: {Math.max(...bucketCounts)} / window · Total: {sessionQrPrintLog.length}
                              </span>
                            </div>

                            <svg
                              viewBox="0 0 260 72"
                              className="w-full h-16 overflow-visible"
                              role="img"
                              aria-label="Session QR print volume line chart"
                              data-testid="qr-print-volume-svg"
                              data-chart-type="line"
                            >
                              <line
                                x1={16}
                                y1={26}
                                x2={244}
                                y2={26}
                                stroke="#f1f5f9"
                                strokeDasharray="3 3"
                                strokeWidth={1}
                              />
                              <line
                                x1={16}
                                y1={54}
                                x2={244}
                                y2={54}
                                stroke="#e2e8f0"
                                strokeWidth={1}
                              />

                              {/* Shaded Area under Line */}
                              <path
                                d={areaPathD}
                                fill="rgba(79, 70, 229, 0.12)"
                                data-testid="qr-print-volume-area"
                              />

                              {/* Trend Line Path & Polyline */}
                              <path
                                d={linePathD}
                                fill="none"
                                stroke="#4f46e5"
                                strokeWidth={2.25}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                data-testid="qr-print-volume-line"
                              />
                              <polyline
                                points={polylinePoints}
                                fill="none"
                                stroke="#4f46e5"
                                strokeWidth={2.25}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                data-testid="qr-print-volume-polyline"
                              />

                              {coords.map((pt, i) => {
                                const barWidth = 18;
                                const barHeight = Math.max(2, 54 - pt.cy);

                                return (
                                  <g key={pt.label}>
                                    <rect
                                      x={pt.cx - barWidth / 2}
                                      y={pt.cy}
                                      width={barWidth}
                                      height={barHeight}
                                      rx={3}
                                      fill="rgba(79, 70, 229, 0.14)"
                                      data-testid={`print-volume-bar-${i}`}
                                      data-count={pt.count}
                                    />
                                    <circle
                                      cx={pt.cx}
                                      cy={pt.cy}
                                      r={3.5}
                                      fill="#ffffff"
                                      stroke="#4f46e5"
                                      strokeWidth={2}
                                      data-testid={`print-volume-point-${i}`}
                                      data-count={pt.count}
                                    />
                                    <text
                                      x={pt.cx}
                                      y={pt.cy - 6}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontFamily="JetBrains Mono, monospace"
                                      fontWeight="700"
                                      fill="#334155"
                                    >
                                      {pt.count}
                                    </text>
                                    <text
                                      x={pt.cx}
                                      y={66}
                                      textAnchor="middle"
                                      fontSize="8"
                                      fontFamily="JetBrains Mono, monospace"
                                      fill="#64748b"
                                    >
                                      {pt.label}
                                    </text>
                                  </g>
                                );
                              })}
                            </svg>
                          </div>
                        );
                      })()}

                      {/* Search & Date Range Filter for Print History */}
                      <div
                        data-testid="qr-print-history-filter-bar"
                        className="p-2.5 rounded-xl bg-white border border-slate-200/80 space-y-2"
                      >
                        <div className="relative flex items-center">
                          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
                          <input
                            id="qr-print-history-search-input"
                            type="text"
                            value={printHistorySearchQuery}
                            onChange={(e) => setPrintHistorySearchQuery(e.target.value)}
                            placeholder="Filter print history by filename or category..."
                            aria-label="Filter Print History"
                            data-testid="qr-print-history-search-input"
                            className="w-full min-h-[34px] pl-8 pr-7 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:bg-white"
                          />
                          {printHistorySearchQuery && (
                            <button
                              type="button"
                              onClick={() => setPrintHistorySearchQuery('')}
                              aria-label="Clear print history search"
                              className="absolute right-2 p-1 text-slate-400 hover:text-slate-700"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 items-center">
                          <label className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
                            <span className="shrink-0 font-semibold">From:</span>
                            <input
                              type="date"
                              value={printHistoryDateStart}
                              onChange={(e) => setPrintHistoryDateStart(e.target.value)}
                              aria-label="Print History Start Date"
                              data-testid="qr-print-history-date-start"
                              className="w-full min-h-[30px] px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            />
                          </label>

                          <label className="flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
                            <span className="shrink-0 font-semibold">To:</span>
                            <input
                              type="date"
                              value={printHistoryDateEnd}
                              onChange={(e) => setPrintHistoryDateEnd(e.target.value)}
                              aria-label="Print History End Date"
                              data-testid="qr-print-history-date-end"
                              className="w-full min-h-[30px] px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            />
                          </label>
                        </div>

                        {(printHistorySearchQuery ||
                          printHistoryDateStart ||
                          printHistoryDateEnd) && (
                          <div className="flex items-center justify-between pt-0.5 text-[10px] font-mono text-slate-500">
                            <span>Filtering past print events</span>
                            <button
                              type="button"
                              onClick={() => {
                                setPrintHistorySearchQuery('');
                                setPrintHistoryDateStart('');
                                setPrintHistoryDateEnd('');
                              }}
                              data-testid="qr-print-history-clear-filters-btn"
                              className="text-indigo-700 hover:text-indigo-900 font-semibold"
                            >
                              Reset Filters
                            </button>
                          </div>
                        )}
                      </div>

                      {(() => {
                        const q = printHistorySearchQuery.trim().toLowerCase();
                        const filteredPrintEvents = sessionQrPrintLog.filter((evt) => {
                          const evtDate = (evt.timestamp || '').slice(0, 10);
                          if (q) {
                            const matchesQuery =
                              evt.fileName.toLowerCase().includes(q) ||
                              evt.category.toLowerCase().includes(q) ||
                              evt.senderName.toLowerCase().includes(q) ||
                              evt.roomCode.toLowerCase().includes(q) ||
                              evtDate.includes(q);
                            if (!matchesQuery) return false;
                          }
                          if (printHistoryDateStart && evtDate < printHistoryDateStart) {
                            return false;
                          }
                          if (printHistoryDateEnd && evtDate > printHistoryDateEnd) {
                            return false;
                          }
                          return true;
                        });

                        if (sessionQrPrintLog.length === 0) {
                          return (
                            <p className="text-xs text-slate-500 py-1">
                              No QR codes printed in this session yet.
                            </p>
                          );
                        }

                        if (filteredPrintEvents.length === 0) {
                          return (
                            <p
                              data-testid="qr-print-history-empty-filter"
                              className="text-xs text-slate-500 py-2 text-center"
                            >
                              No print history events match your search or date range filter.
                            </p>
                          );
                        }

                        return (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                            {filteredPrintEvents.map((evt, idx) => {
                              const isSelected = selectedPrintHistoryIds.includes(evt.id);
                              return (
                                <div
                                  key={evt.id}
                                  data-testid={`print-history-event-${idx}`}
                                  className={`px-3 py-2 rounded-xl border flex flex-col gap-1 text-left transition-colors ${
                                    isSelected
                                      ? 'bg-indigo-50/70 border-indigo-300'
                                      : 'bg-white border-slate-200/80'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <label className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer select-none">
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          setSelectedPrintHistoryIds((prev) =>
                                            checked
                                              ? prev.includes(evt.id)
                                                ? prev
                                                : [...prev, evt.id]
                                              : prev.filter((id) => id !== evt.id)
                                          );
                                        }}
                                        aria-label={`Select print event ${evt.fileName}`}
                                        data-testid={`print-history-select-${idx}`}
                                        className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 shrink-0"
                                      />
                                      <span className="text-xs font-bold text-slate-900 truncate">
                                        {evt.fileName}
                                      </span>
                                    </label>
                                    <span
                                      data-testid={`print-history-timestamp-${idx}`}
                                      className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-500 shrink-0"
                                    >
                                      <Clock className="w-2.5 h-2.5 text-slate-400" />
                                      <span>{formatSessionPrintTimestamp(evt.timestamp)}</span>
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] font-mono text-slate-500 pl-5">
                                    <div className="flex flex-wrap items-center gap-1.5 truncate">
                                      <span className="font-sans font-semibold text-slate-700">
                                        {evt.category}
                                      </span>
                                      <span>·</span>
                                      <span>{evt.sizeLabel}</span>
                                      <span>·</span>
                                      <span>Room {evt.roomCode}</span>
                                      <span>·</span>
                                      <span>By {evt.senderName}</span>
                                    </div>

                                    <div className="flex items-center gap-1 shrink-0">
                                      <span className="px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-800 font-semibold">
                                        {QR_QUALITY_LABELS[evt.qualityLevel]} ({evt.qualityLevel})
                                      </span>
                                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">
                                        {evt.printMode}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Scan History Sub-Section (Recently Scanned Files from QR Scanner for Quick Re-Access & Re-Download) */}
                    <div
                      data-testid="qr-modal-scan-history-section"
                      className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <History className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <h4 className="text-xs font-bold text-slate-900">
                            Scan History
                          </h4>
                          <span
                            data-testid="qr-modal-scan-history-count"
                            className="px-1.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-mono tabular-nums text-[10px] font-bold"
                          >
                            {qrScanHistory.length} / {MAX_SCAN_HISTORY_FILES}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500">
                          Recently Scanned via QR Scanner
                        </span>
                      </div>

                      {qrScanHistory.length === 0 ? (
                        <p className="text-xs text-slate-500 py-1">
                          No files scanned yet. Open the QR Scanner to scan and log files here.
                        </p>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                          {qrScanHistory
                            .slice(0, MAX_SCAN_HISTORY_FILES)
                            .map((scanEntry, idx) => {
                              const matchedVaultFile = files.find(
                                (f) =>
                                  f.id.toLowerCase() === scanEntry.fileId.toLowerCase() ||
                                  f.name.toLowerCase() === scanEntry.fileName.toLowerCase()
                              );

                              return (
                                <div
                                  key={scanEntry.id}
                                  data-testid={`qr-scan-history-item-${idx}`}
                                  className="px-3 py-2 rounded-xl bg-white border border-slate-200/80 flex items-center justify-between gap-2.5 text-left"
                                >
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (matchedVaultFile) {
                                          setQrModalFileId(matchedVaultFile.id);
                                          triggerToast(
                                            `Switched QR view to scanned file "${matchedVaultFile.name}"`
                                          );
                                        } else {
                                          triggerToast(
                                            `Accessed scanned file "${scanEntry.fileName}" (Room ${scanEntry.roomCode})`
                                          );
                                        }
                                      }}
                                      className="text-xs font-bold text-slate-900 hover:text-sky-700 truncate block text-left w-full"
                                      title={`Re-access ${scanEntry.fileName}`}
                                    >
                                      {scanEntry.fileName}
                                    </button>
                                    <p className="text-[10px] text-slate-500 font-mono truncate">
                                      <span className="font-sans font-semibold text-slate-700">
                                        {scanEntry.category}
                                      </span>
                                      {' · '}
                                      <span>{formatBytes(scanEntry.size)}</span>
                                      {' · '}
                                      <span>Room {scanEntry.roomCode}</span>
                                      {' · '}
                                      <span>By {scanEntry.senderName}</span>
                                    </p>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (matchedVaultFile) {
                                          setQrModalFileId(matchedVaultFile.id);
                                          setSelectedFileId(matchedVaultFile.id);
                                        }
                                        triggerToast(
                                          `Re-accessed scanned file "${scanEntry.fileName}"`
                                        );
                                      }}
                                      data-testid={`qr-scan-history-open-${idx}`}
                                      aria-label={`Access ${scanEntry.fileName}`}
                                      title={`Re-access "${scanEntry.fileName}"`}
                                      className="min-h-[30px] px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                                    >
                                      <Eye className="w-3 h-3 text-slate-600" />
                                      <span>Access</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (matchedVaultFile) {
                                          handleDownloadFile(matchedVaultFile);
                                        } else {
                                          const fallbackUrl =
                                            scanEntry.rawPayload ||
                                            buildFileQrPayloadUrl({
                                              fileId: scanEntry.fileId,
                                              roomCode: scanEntry.roomCode || roomCode,
                                            });
                                          const a = document.createElement('a');
                                          a.href = fallbackUrl;
                                          a.download = scanEntry.fileName;
                                          document.body.appendChild(a);
                                          a.click();
                                          document.body.removeChild(a);
                                          triggerToast(
                                            `Re-downloading scanned file "${scanEntry.fileName}"`
                                          );
                                        }
                                      }}
                                      data-testid={`qr-scan-history-download-${idx}`}
                                      aria-label={`Download ${scanEntry.fileName}`}
                                      title={`Re-download "${scanEntry.fileName}"`}
                                      className="min-h-[30px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                                    >
                                      <Download className="w-3 h-3" />
                                      <span>Download</span>
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}
                    </div>

                    <div className="pt-1 space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQrModalFileId(null);
                          setQrModalBatchMode(false);
                          setQrScannerOpen(true);
                        }}
                        aria-label="Scan Next"
                        data-testid="qr-scan-next-btn"
                        title="Close current QR view and immediately open the QR Scanner for batch scanning"
                        className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-xs interactive-press"
                      >
                        <Camera className="w-4 h-4 text-sky-400" />
                        <span>Scan Next</span>
                      </button>

                      <div className="flex items-center justify-between pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            const id = qrModalFile.id;
                            setQrModalFileId(null);
                            setSelectedFileId(id);
                          }}
                          className="text-xs font-semibold text-sky-700 hover:text-sky-800"
                        >
                          Inspect Full File Details →
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setQrModalFileId(null);
                            setQrModalBatchMode(false);
                            setQrScannerOpen(true);
                          }}
                          className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          <span>Open QR Scanner</span>
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Authentication & Role-Based Authorization (RBAC) Modal */}
      <AuthAccessModal
        isOpen={authModalOpen}
        currentUser={currentUser}
        allUsers={allUsers}
        deviceModel={senderDevice}
        firestoreSyncedCount={firestoreSyncedCount}
        isSyncingFirestore={isSyncingFirestore}
        onSyncVaultToFirestore={handleSyncVaultToFirestore}
        onClose={() => setAuthModalOpen(false)}
        onUpdateLocalRole={handleUpdateLocalRole}
        onActivateLocalSession={handleActivateLocalSession}
        onSignOutSession={handleSignOutSession}
        onNotify={triggerToast}
      />

      {/* Optical Camera QR Code Scanner Modal */}
      <QrScannerModal
        isOpen={qrScannerOpen}
        files={files}
        currentRoomCode={roomCode}
        onClose={() => setQrScannerOpen(false)}
        onJoinRoom={(newRoom) => {
          setRoomCode(newRoom);
          setRoomInput(newRoom);
          setActiveTab('vault');
        }}
        onInspectFile={(fileId) => {
          setSelectedFileId(fileId);
          setActiveTab('vault');
        }}
        onDownloadFile={handleDownloadFile}
        onNotify={triggerToast}
      />

      {/* Mobile PWA Install & Viewport Mode Modal */}
      <PWAInstallModal
        isOpen={pwaModalOpen}
        onClose={() => setPwaModalOpen(false)}
        isInstallable={isInstallable}
        isInstalled={isInstalled}
        isIOS={isIOS}
        onTriggerInstall={triggerPwaInstall}
        roomCode={roomCode}
        mobileShellMode={mobileShellMode}
        onToggleMobileShellMode={setMobileShellMode}
        onNotify={triggerToast}
      />

      {/* Real-time Offline Connectivity Indicator & Persistent Reconnection Sync Toast */}
      <OfflineIndicator
        onSyncNow={() => handleRefreshVault(true)}
        isSyncing={isRefreshing}
        roomCode={roomCode}
      />

      {/* Floating Multi-Select Batch Action Dock when files are selected */}
      <AnimatePresence>
        {isMultiSelectMode &&
          checkedFileIds.length > 0 &&
          (activeTab === 'vault' || activeTab === 'favorites') && (
            <motion.div
              key="multi-select-batch-dock"
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="fixed bottom-16 md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-3xl bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl shadow-slate-950/30 border border-slate-800 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-sky-600 text-white font-mono tabular-nums text-xs font-bold flex items-center justify-center shrink-0">
                  {checkedFileIds.length}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white truncate">
                    {checkedFileIds.length}{' '}
                    {checkedFileIds.length === 1 ? 'file selected' : 'files selected'} for batch action
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-slate-400 truncate">
                    Total payload:{' '}
                    {formatBytes(
                      files
                        .filter((f) => checkedFileIds.includes(f.id))
                        .reduce((acc, f) => acc + f.size, 0)
                    )}{' '}
                    · Room {roomCode}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleBatchPrintSelectedQrCards}
                  title="Batch print an index card sheet with one QR code per selected file"
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <Printer className="w-4 h-4 text-sky-600" />
                  <span>Batch Print ({checkedFileIds.length})</span>
                </button>

                <button
                  type="button"
                  disabled={isGeneratingShareBundle}
                  onClick={() => handleCreateExpiringShareBundle()}
                  title="Bundle selected files on backend & create temporary expiring URL in Firebase"
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-700 text-slate-950 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <Link2 className="w-4 h-4" />
                  <span>
                    {isGeneratingShareBundle
                      ? 'Bundling...'
                      : `Share Expiring Link (${checkedFileIds.length})`}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={isBatchZipping}
                  onClick={handleBatchDownloadZip}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:bg-slate-700 text-slate-950 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <Archive className="w-4 h-4" />
                  <span>
                    {isBatchZipping
                      ? 'Packing ZIP...'
                      : `Download ZIP (${checkedFileIds.length})`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmBulkDeleteOpen(true)}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-rose-600/90 hover:bg-rose-600 text-white font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap interactive-press"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Delete</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsMultiSelectMode(false);
                    setCheckedFileIds([]);
                  }}
                  className="min-h-[40px] px-2.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  Done
                </button>
              </div>
            </motion.div>
          )}
      </AnimatePresence>

      {/* Expiring Multi-File Share Bundle Modal */}
      <ShareBundleModal
        isOpen={shareBundleModalOpen}
        bundle={activeShareBundle}
        recentBundles={sharedBundles}
        selectedFiles={files.filter((f) =>
          (checkedFileIds.length > 0
            ? checkedFileIds
            : activeShareBundle?.fileIds || []
          ).includes(f.id)
        )}
        isGenerating={isGeneratingShareBundle}
        selectedTtlMinutes={bundleTtlMinutes}
        isFirebaseAuthenticated={Boolean(auth.currentUser)}
        onSelectTtlMinutes={setBundleTtlMinutes}
        onRegenerateOrUpdateTtl={handleUpdateBundleTtl}
        onRevokeBundle={handleRevokeShareBundle}
        onDownloadBundleZip={handleDownloadBundleZip}
        onPreviewRecipientLink={(bundleToPreview) => {
          setRecipientLandingBundle(bundleToPreview);
          setShareBundleModalOpen(false);
          triggerToast('Opened recipient landing banner for temporary share link');
        }}
        onSelectExistingBundle={(existingBundle) => {
          setActiveShareBundle(existingBundle);
        }}
        onClose={() => setShareBundleModalOpen(false)}
        onNotify={triggerToast}
      />

      {/* Single Confirmation Prompt Modal for Bulk Delete */}
      <AnimatePresence>
        {confirmBulkDeleteOpen && (
          <motion.div
            key="bulk-delete-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-slate-950/60 backdrop-blur-sm p-0 md:p-4"
            onClick={() => !isBulkDeleting && setConfirmBulkDeleteOpen(false)}
          >
            <motion.div
              key="bulk-delete-dialog"
              initial={{ opacity: 0, y: 28, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-delete-dialog-title"
              className="w-full max-w-md bg-white rounded-t-3xl md:rounded-3xl border border-slate-200/90 p-6 space-y-5 shadow-2xl shadow-slate-950/20"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto -mt-2 mb-1 md:hidden" />

              <div className="flex items-start gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3
                    id="bulk-delete-dialog-title"
                    className="text-base font-bold text-slate-900"
                  >
                    Delete {checkedFileIds.length} Selected{' '}
                    {checkedFileIds.length === 1 ? 'File' : 'Files'}?
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    This action will permanently remove{' '}
                    <span className="font-semibold text-slate-900">
                      {checkedFileIds.length} {checkedFileIds.length === 1 ? 'file' : 'files'}
                    </span>{' '}
                    (
                    <span className="font-mono tabular-nums">
                      {formatBytes(
                        files
                          .filter((f) => checkedFileIds.includes(f.id))
                          .reduce((acc, f) => acc + f.size, 0)
                      )}
                    </span>
                    ) from Room {roomCode} for all connected peers.
                  </p>
                </div>
              </div>

              {/* Concise preview list of files to be deleted */}
              <div className="max-h-40 overflow-y-auto rounded-2xl bg-slate-50 border border-slate-200/80 divide-y divide-slate-200/60">
                {files
                  .filter((f) => checkedFileIds.includes(f.id))
                  .map((file) => (
                    <div
                      key={file.id}
                      className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="font-semibold text-slate-800 truncate">
                        {file.name}
                      </span>
                      <span className="font-mono tabular-nums text-slate-500 shrink-0">
                        {formatBytes(file.size)}
                      </span>
                    </div>
                  ))}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={isBulkDeleting}
                  onClick={() => setConfirmBulkDeleteOpen(false)}
                  className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-semibold whitespace-nowrap interactive-press"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isBulkDeleting}
                  onClick={handleConfirmBulkDelete}
                  className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>
                    {isBulkDeleting
                      ? 'Deleting...'
                      : `Confirm Delete (${checkedFileIds.length})`}
                  </span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Printable Categorized PDF Report Modal */}
      <VaultPdfReportModal
        isOpen={pdfReportModalOpen}
        files={filteredResults.map((r) => r.file)}
        roomCode={roomCode}
        selectedCategory={selectedCategory}
        searchQuery={searchQuery}
        dateFilterLabel={activeDateFilterLabel}
        onClose={() => setPdfReportModalOpen(false)}
        onExportSuccess={(fileName) =>
          triggerToast(`Downloaded categorized PDF report: ${fileName}`)
        }
      />
    </div>
  );
}
