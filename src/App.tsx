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
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
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
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  SharedFile,
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
} from './types/files';
import { UploadCategorizePanel } from './components/UploadCategorizePanel';
import {
  FileDetailSheet,
  resolveImageSource,
  resolveTextContent,
} from './components/FileDetailSheet';
import { QrMatrixSvg } from './components/QrMatrixSvg';
import { QrScannerModal } from './components/QrScannerModal';
import { AuthAccessModal } from './components/AuthAccessModal';
import { PWAInstallModal } from './components/PWAInstallModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { ActiveTransfersTray } from './components/TransferProgressBar';
import { usePWAInstall } from './hooks/usePWAInstall';

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
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Navigation & Layout State
  const [activeTab, setActiveTab] = useState<ActiveTab>('vault');
  const [vaultViewMode, setVaultViewMode] = useState<'list' | 'grid'>('list');
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [quickUploadModalOpen, setQuickUploadModalOpen] = useState<boolean>(false);
  const [qrScannerOpen, setQrScannerOpen] = useState<boolean>(false);
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [pwaModalOpen, setPwaModalOpen] = useState<boolean>(false);
  const [mobileShellMode, setMobileShellMode] = useState<boolean>(true);
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

  // Authentication & Role-Based Authorization State
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);

  // Multi-Select & Bulk Delete State
  const [isMultiSelectMode, setIsMultiSelectMode] = useState<boolean>(false);
  const [checkedFileIds, setCheckedFileIds] = useState<string[]>([]);
  const [confirmBulkDeleteOpen, setConfirmBulkDeleteOpen] = useState<boolean>(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState<boolean>(false);

  // Search, Category & Upload Date Filter State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [customDateFilter, setCustomDateFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
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
  }, [activeTab, confirmBulkDeleteOpen, isBulkDeleting, quickUploadModalOpen, isMultiSelectMode]);

  // Firebase Authentication & Firestore User Profile / Role Listener
  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeUsersList: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }
      if (unsubscribeUsersList) {
        unsubscribeUsersList();
        unsubscribeUsersList = null;
      }

      if (!fbUser) {
        setCurrentUser(null);
        setAllUsers([]);
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
        () => {
          // Ignore list error if rules restrict
        }
      );
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeUsersList) unsubscribeUsersList();
    };
  }, [senderDevice]);

  const getAuthHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (currentUser) {
      headers['x-user-uid'] = currentUser.uid;
      headers['x-user-email'] = currentUser.email;
      headers['x-user-role'] = currentUser.role;
    }
    return headers;
  }, [currentUser]);

  const handleUpdateLocalRole = async (newRole: UserRole) => {
    if (!currentUser) return;
    const nowIso = new Date().toISOString();
    const updated: UserProfile = {
      ...currentUser,
      role: newRole,
      updatedAt: nowIso,
    };
    setCurrentUser(updated);
    try {
      await setDoc(doc(db, 'users', currentUser.uid), updated, { merge: true });
    } catch {
      // If Firestore rule prevents non-admin self-elevation in strict mode, keep session role active for testing
    }
  };

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
        setIsLoading(false);

        const params = new URLSearchParams(window.location.search);
        const linkedRoom = params.get('room');
        if (linkedRoom && linkedRoom.trim()) {
          setRoomCode(linkedRoom.trim());
          setRoomInput(linkedRoom.trim());
        }
        const linkedFileId = params.get('file');
        if (linkedFileId) {
          setSelectedFileId(linkedFileId);
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
          updatedAt: new Date().toISOString(),
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [files, categories]);

  const handleRefreshVault = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.files)) setFiles(data.files);
        if (Array.isArray(data.categories) && data.categories.length > 0) {
          setCategories(data.categories);
        }
        if (Array.isArray(data.peers)) setPeers(data.peers);
        triggerToast('Synced mobile vault with room peers');
      }
    } catch {
      triggerToast('Offline mode — showing cached vault files');
    } finally {
      setTimeout(() => setIsRefreshing(false), 350);
    }
  }, [isRefreshing, triggerToast]);

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
      const order: ActiveTab[] = ['vault', 'upload', 'radar', 'rooms'];
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
  const handleUploadFile = async (payload: {
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
  }) => {
    if (!canUploadOrCreateCategory(currentUser)) {
      triggerToast(
        currentUser
          ? 'Viewer role is read-only. Switch to Editor or Admin to upload files.'
          : 'Sign in required to upload and categorize files.'
      );
      setAuthModalOpen(true);
      return;
    }

    const enrichedPayload = {
      ...payload,
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
        if (currentUser) {
          setDoc(doc(db, 'files', data.file.id), {
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
          }).catch(() => {});
        }
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
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

      const pinParam =
        file.pinProtected && pinCode ? `?pin=${encodeURIComponent(pinCode)}` : '';
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
    updates: { category?: string; name?: string; notes?: string; uploadDate?: string }
  ) => {
    const targetFile = files.find((f) => f.id === id);
    if (!targetFile || !canModifyOrDeleteFile(currentUser, targetFile)) {
      triggerToast(
        currentUser
          ? 'Only the file owner or a Vault Admin can modify this file.'
          : 'Sign in required to categorize or modify files.'
      );
      setAuthModalOpen(true);
      return;
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
        if (currentUser) {
          setDoc(
            doc(db, 'files', data.file.id),
            {
              category: data.file.category,
              uploadDate: data.file.uploadDate,
              name: data.file.name,
              notes: data.file.notes || '',
            },
            { merge: true }
          ).catch(() => {});
        }
      }
      if (Array.isArray(data.categories)) {
        setCategories(data.categories);
      }
      if (updates.category) {
        triggerToast(`Categorized as "${updates.category}"`);
      } else if (updates.name) {
        triggerToast(`Updated "${updates.name}"`);
      }
    } else {
      const errData = await res.json().catch(() => ({}));
      triggerToast(errData.error || 'Not authorized to modify this file.');
    }
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
      setFiles((prev) => prev.filter((f) => f.id !== id));
      setSelectedFileId(null);
      setCheckedFileIds((prev) => prev.filter((item) => item !== id));
      if (currentUser) {
        deleteDoc(doc(db, 'files', id)).catch(() => {});
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
        for (const remId of actualDeletedIds) {
          deleteDoc(doc(db, 'files', remId)).catch(() => {});
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

  // Filtered and sorted files with search match attribution
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
      .filter((item) => item.matches);

    evaluated.sort((a, b) => {
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
  }, [files, searchQuery, selectedCategory, datePreset, customDateFilter, sortBy]);

  // Category counts for filter tabs
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: files.length };
    for (const cat of categories) {
      counts[cat] = 0;
    }
    for (const f of files) {
      counts[f.category] = (counts[f.category] || 0) + 1;
    }
    return counts;
  }, [files, categories]);

  const selectedFile = useMemo(
    () => files.find((f) => f.id === selectedFileId) || null,
    [files, selectedFileId]
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

  // Soft storage limit for room vault (25 MB)
  const softStorageLimitBytes = 25 * 1024 * 1024;
  const storageUsagePercent = useMemo(() => {
    if (totalVaultSize <= 0) return 0;
    return Math.round((totalVaultSize / softStorageLimitBytes) * 1000) / 10;
  }, [totalVaultSize, softStorageLimitBytes]);
  const clampedStorageRatio = Math.min(1, totalVaultSize / softStorageLimitBytes);

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('All');
    setDatePreset('all');
    setCustomDateFilter('');
  };

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedCategory !== 'All' ||
    datePreset !== 'all' ||
    customDateFilter !== '';

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

  const navTabs: { id: ActiveTab; label: string }[] = [
    { id: 'vault', label: 'Shared Vault' },
    { id: 'upload', label: 'Upload & Categorize' },
    { id: 'radar', label: 'Nearby Radar' },
    { id: 'rooms', label: 'Pairing Rooms' },
  ];

  return (
    <div id="top" className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-900 pb-20 md:pb-12">
      {/* Top Bar Contract: [Brand title, one line] — [4 nav links] — [Primary action] */}
      <header className="sticky top-0 z-30 h-14 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between">
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

        {/* Zone 2: 4 clean text navigation links with smooth layout underline */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-600 h-full">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative h-full flex items-center transition-colors whitespace-nowrap ${
                  isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <span>{tab.label}</span>
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

        {/* Zone 3: Primary action & Auth / RBAC / Mobile App Trigger */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setPwaModalOpen(true)}
            title="Mobile App & Install Settings"
            className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press ${
              isInstallable
                ? 'bg-sky-600 hover:bg-sky-700 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-900'
            }`}
          >
            <Smartphone className={`w-3.5 h-3.5 ${isInstallable ? 'text-white' : 'text-sky-600'}`} />
            <span className="hidden sm:inline">
              {isInstalled ? 'App Mode' : isInstallable ? 'Install App' : 'Mobile App'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setAuthModalOpen(true)}
            className={`min-h-[40px] px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press ${
              currentUser
                ? 'bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200'
                : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200'
            }`}
          >
            {currentUser ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-sky-600" />
                <span className="hidden lg:inline max-w-[100px] truncate">
                  {currentUser.displayName}
                </span>
                <span aria-hidden="true" className="hidden lg:inline text-sky-400">·</span>
                <span className="font-mono text-[11px] uppercase tracking-tight">
                  {currentUser.role}
                </span>
              </>
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5 text-amber-600" />
                <span>{isAuthReady ? 'Sign In' : 'Auth...'}</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setQrScannerOpen(true)}
            aria-label="Scan QR Code"
            className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
          >
            <Camera className="w-3.5 h-3.5 text-sky-600" />
            <span className="hidden sm:inline">Scan QR</span>
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
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap interactive-press"
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

      {/* Main Responsive / Mobile Handset Content Container */}
      <main
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className={`flex-1 w-full mx-auto px-3 sm:px-6 pt-4 sm:pt-6 transition-all duration-200 ${
          mobileShellMode ? 'max-w-[460px] pb-20' : 'max-w-[1200px]'
        }`}
      >
        <div
          className={
            mobileShellMode
              ? 'space-y-5'
              : 'grid grid-cols-1 lg:grid-cols-12 gap-8 items-start'
          }
        >
          {/* Primary Column */}
          <div className={mobileShellMode ? 'w-full space-y-4' : 'lg:col-span-8 space-y-5'}>
            <ActiveTransfersTray
              transfers={activeTransfers}
              onDismiss={dismissTransfer}
            />
            <AnimatePresence mode="wait">
              {activeTab === 'vault' && (
                <motion.div
                  key="tab-vault"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  className="space-y-6"
                >
                  {/* Search & Multi-Facet Discovery Panel */}
                  <section
                    aria-label="Search and filter files"
                    className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 space-y-5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                      <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                          Categorized File Vault
                        </h1>
                        <p className="text-xs text-slate-500 mt-1">
                          <span>Room {roomCode}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{files.length} shared files</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatBytes(totalVaultSize)} total</span>
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-start sm:self-auto">
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
                            <span className="hidden sm:inline">List</span>
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
                            <span className="hidden sm:inline">Grid</span>
                          </button>
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
                            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200/70 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-colors"
                          >
                            <option value="newest">Newest Date</option>
                            <option value="oldest">Oldest Date</option>
                            <option value="largest">Largest Size</option>
                            <option value="name">Name (A–Z)</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Horizontal Vault Storage Progress Bar (Soft Limit) */}
                    <div className="pt-3 border-t border-slate-100 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 text-slate-600">
                          <span className="font-semibold text-slate-900">Vault Capacity</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {storageUsagePercent >= 100
                              ? 'Soft limit reached (uploads remain open)'
                              : storageUsagePercent >= 75
                              ? 'Approaching soft storage limit'
                              : 'Within soft storage limit'}
                          </span>
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
                          placeholder="Search by file name, category (e.g. Design Assets), or upload date (e.g. 2026-09-25)..."
                          aria-label="Search files by name, category, or upload date"
                          className="w-full min-h-[48px] pl-11 pr-14 py-2.5 rounded-2xl border border-slate-300 bg-slate-50/70 focus:bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-all"
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

                      {/* Quick Search Sample Triggers (Functional Filter Buttons) */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                        <span className="text-slate-400 shrink-0 mr-1">Quick search:</span>
                        {[
                          { label: 'Name: "nordic"', query: 'nordic' },
                          { label: 'Category: "Design Assets"', query: 'Design Assets' },
                          { label: 'Category: "Documents"', query: 'Documents' },
                          { label: 'Date: "2026-09-25"', query: '2026-09-25' },
                          { label: 'Date: "Sep 26"', query: 'Sep 26' },
                        ].map((sample) => (
                          <button
                            key={sample.query}
                            type="button"
                            onClick={() =>
                              setSearchQuery((prev) =>
                                prev === sample.query ? '' : sample.query
                              )
                            }
                            className={`min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 interactive-press ${
                              searchQuery === sample.query
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                            }`}
                          >
                            {sample.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Category Filter Controls + Add Custom Category */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          Filter by Category
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowAddCategoryInline((v) => !v)}
                          className="min-h-[36px] px-2 text-xs font-semibold text-sky-700 hover:text-sky-800 flex items-center gap-1 whitespace-nowrap"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          <span>{showAddCategoryInline ? 'Close' : 'New Category'}</span>
                        </button>
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

                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        {['All', ...categories].map((cat) => {
                          const active = selectedCategory === cat;
                          const count = categoryCounts[cat] ?? 0;
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => setSelectedCategory(cat)}
                              className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 flex items-center gap-1.5 interactive-press ${
                                active
                                  ? 'bg-slate-900 text-white'
                                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                              }`}
                            >
                              <span>{cat}</span>
                              <span
                                className={`font-mono tabular-nums text-[11px] ${
                                  active ? 'text-sky-300' : 'text-slate-400'
                                }`}
                              >
                                ({count})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Upload Date Filter Bar (Presets + Exact Date Picker) */}
                    <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-1.5 overflow-x-auto">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-1" />
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
                            className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 interactive-press ${
                              datePreset === preset.id && !customDateFilter
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
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

                          <div className="flex items-center gap-2">
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
                              <button
                                type="button"
                                onClick={() => {
                                  if (!currentUser || currentUser.role === 'viewer') {
                                    triggerToast(
                                      currentUser
                                        ? 'Viewer role is read-only. Switch to Editor or Admin for bulk delete.'
                                        : 'Sign in required to select and bulk delete files.'
                                    );
                                    setAuthModalOpen(true);
                                    return;
                                  }
                                  setIsMultiSelectMode(true);
                                  setCheckedFileIds([]);
                                }}
                                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap interactive-press"
                              >
                                <CheckSquare className="w-3.5 h-3.5 text-sky-600" />
                                <span>Select Files</span>
                              </button>
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

                          <div className="flex items-center gap-2">
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
                                  setSelectedFileId(file.id);
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
                                    setSelectedFileId(file.id);
                                  }
                                }
                              }}
                              className={`group min-h-[68px] px-4 sm:px-5 py-3.5 transition-colors flex items-center justify-between gap-3.5 cursor-pointer ${
                                isMultiSelectMode && isChecked
                                  ? 'bg-sky-50/80 hover:bg-sky-100/70'
                                  : 'hover:bg-slate-50/90 active:bg-slate-100/80'
                              }`}
                            >
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
                              {imgPreview.isImage && imgPreview.src && !file.pinProtected ? (
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
                                        {imgPreview.isImage ? `${imgPreview.formatBadge} Preview` : 'Text/JSON Viewer'}
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
                              </div>

                              {/* Right Quick Category Selector + Action Affordance */}
                              {!isMultiSelectMode && (
                                <div
                                  className="flex items-center gap-1.5 shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <select
                                    aria-label={`Change category for ${file.name}`}
                                    disabled={!canModifyOrDeleteFile(currentUser, file)}
                                    value={file.category}
                                    onChange={(e) =>
                                      handleUpdateFile(file.id, { category: e.target.value })
                                    }
                                    className="hidden sm:block min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-60 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-600 transition-colors"
                                  >
                                    {categories.map((cat) => (
                                      <option key={cat} value={cat}>
                                        {cat}
                                      </option>
                                    ))}
                                  </select>

                                  {!file.pinProtected ? (
                                    <button
                                      type="button"
                                      onClick={() => handleDownloadFile(file)}
                                      aria-label={`Download ${file.name}`}
                                      title={`Download ${file.name} (${formatBytes(file.size)})`}
                                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 hover:text-sky-600 hover:bg-sky-50 transition-colors interactive-press"
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setSelectedFileId(file.id)}
                                      aria-label={`Unlock and download ${file.name}`}
                                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-amber-600 hover:bg-amber-50 transition-colors"
                                    >
                                      <Lock className="w-4 h-4" />
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => setSelectedFileId(file.id)}
                                    aria-label={`Inspect ${file.name}`}
                                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 group-hover:text-slate-900 transition-colors"
                                  >
                                    <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Visual Grid View: Rich Image & Code/JSON Cards */
                      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                                  setSelectedFileId(file.id);
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
                                    setSelectedFileId(file.id);
                                  }
                                }
                              }}
                              className={`group rounded-2xl border overflow-hidden flex flex-col justify-between cursor-pointer transition-all ${
                                isMultiSelectMode && isChecked
                                  ? 'border-sky-600 bg-sky-50/40'
                                  : 'border-slate-200/90 hover:border-slate-300 bg-white'
                              }`}
                            >
                              {/* Top Visual Surface */}
                              <div className="relative h-36 bg-slate-950 overflow-hidden flex items-center justify-center">
                                {file.pinProtected ? (
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
                                  <p className="text-sm font-semibold text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                                    {file.name}
                                  </p>
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

                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                                  <span className="truncate">{file.senderName}</span>
                                  <span className="text-sky-700 font-semibold group-hover:underline">
                                    Inspect →
                                  </span>
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
                    onOpenAuthModal={() => setAuthModalOpen(true)}
                    onUploadFile={handleUploadFile}
                    onAddCategory={handleAddCategory}
                    onUploadComplete={() => setActiveTab('vault')}
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
                    <button
                      type="button"
                      onClick={handleReceivePeerSampleDrop}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap self-start sm:self-auto interactive-press"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Receive Test Peer Drop</span>
                    </button>
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
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-slate-700">
                      Connected Devices in Room {roomCode}
                    </h3>
                    <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
                      {peers.map((peer) => {
                        const isSelf = peer.id === peerId;
                        return (
                          <div
                            key={peer.id}
                            className="min-h-[60px] px-4 py-3 bg-white flex items-center justify-between gap-3"
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center p-5 rounded-2xl bg-slate-50 border border-slate-200/80">
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
                </motion.section>
              )}
            </AnimatePresence>
          </div>

          {/* Secondary Companion Column (4 cols on Desktop Split View, or stacked below in Mobile Shell Mode) */}
          <aside className={mobileShellMode ? 'space-y-4 pt-2' : 'lg:col-span-4 space-y-6'}>
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
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Active RBAC Role</span>
                    <span className="font-mono uppercase text-slate-700 font-semibold">
                      {currentUser.role}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
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
                          className={`min-h-[36px] px-2 py-1 rounded-xl text-xs font-semibold capitalize interactive-press ${
                            active
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {roleOption}
                        </button>
                      );
                    })}
                  </div>
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

            {/* Category Breakdown Card */}
            <div className="bg-white rounded-3xl border border-slate-200/90 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900">
                  Category Index
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {categories.length} categories
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {categories.map((cat) => {
                  const count = categoryCounts[cat] || 0;
                  const isSelected = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setSelectedCategory(isSelected ? 'All' : cat);
                        setActiveTab('vault');
                      }}
                      className="w-full min-h-[48px] py-2.5 flex items-center justify-between text-left hover:bg-slate-50 px-2 rounded-xl transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                          {getCategoryIcon(cat)}
                        </div>
                        <span
                          className={`text-xs font-semibold truncate ${
                            isSelected ? 'text-sky-600' : 'text-slate-800'
                          }`}
                        >
                          {cat}
                        </span>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {count} {count === 1 ? 'file' : 'files'}
                      </span>
                    </button>
                  );
                })}
              </div>

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
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold flex items-center justify-center gap-2 whitespace-nowrap interactive-press"
              >
                <Upload className="w-4 h-4" />
                <span>Upload & Categorize File</span>
              </button>
            </div>

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
            ? 'fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[460px] rounded-t-2xl border-x'
            : 'md:hidden fixed bottom-0 left-0 right-0'
        } z-40 h-14 pb-safe bg-white/95 backdrop-blur-md border-t border-slate-200 grid grid-cols-4 items-center px-2 shadow-lg shadow-slate-900/5`}
      >
        {(
          [
            { id: 'vault', label: 'Vault', icon: FolderOpen },
            { id: 'upload', label: 'Upload', icon: Upload },
            { id: 'radar', label: 'Radar', icon: Radio },
            { id: 'rooms', label: 'Pairing', icon: QrCode },
          ] as const
        ).map((item) => {
          const IconComponent = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`relative min-h-[44px] flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-sky-600' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <IconComponent className="w-5 h-5" />
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
                  onOpenAuthModal={() => {
                    setQuickUploadModalOpen(false);
                    setAuthModalOpen(true);
                  }}
                  onUploadFile={handleUploadFile}
                  onAddCategory={handleAddCategory}
                  onUploadComplete={() => {
                    setQuickUploadModalOpen(false);
                    setActiveTab('vault');
                  }}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Detail & Category Assignment Bottom Sheet */}
      <FileDetailSheet
        file={selectedFile}
        categories={categories}
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

      {/* Authentication & Role-Based Authorization (RBAC) Modal */}
      <AuthAccessModal
        isOpen={authModalOpen}
        currentUser={currentUser}
        allUsers={allUsers}
        deviceModel={senderDevice}
        onClose={() => setAuthModalOpen(false)}
        onUpdateLocalRole={handleUpdateLocalRole}
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

      {/* Real-time Offline Connectivity Indicator */}
      <OfflineIndicator />

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
    </div>
  );
}
