import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Upload,
  FolderPlus,
  FileUp,
  Check,
  X,
  Lock,
  Calendar,
  FileCode,
  Camera,
  Eye,
  Tag,
  Wand2,
  ShieldCheck,
  KeyRound,
  Copy,
  RefreshCw,
  AlertTriangle,
  Trash2,
  HardDrive,
} from 'lucide-react';
import {
  SharedFile,
  formatBytes,
  formatDisplayDate,
  getTodayIsoDate,
  suggestCategoriesForFile,
  CategorySuggestion,
  AUTO_TAG_RULE_EXAMPLES,
  TransferProgressState,
  estimateTargetThroughputBytesPerSec,
} from '../types/files';
import {
  encryptFilePayload,
  generateStrongPassphrase,
  PersistentE2eeConfig,
  loadPersistentE2eeConfig,
  savePersistentE2eeConfig,
} from '../utils/crypto';
import { TransferProgressBar } from './TransferProgressBar';
import { FilePreviewModal } from './FilePreviewModal';

export interface StagedUploadItem {
  localId: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  uploadDate: string;
  dataUrl?: string;
  textContent?: string;
  suggestions: CategorySuggestion[];
  autoTagged: boolean;
  localEncrypted?: boolean;
  encryptionAlgo?: string;
  encryptionIv?: string;
  encryptionSalt?: string;
  encryptionFingerprint?: string;
  encryptedPayload?: string;
  encryptedWithPassphrase?: string;
  isEncryptingLocally?: boolean;
}

export interface StorageLimitAttemptInfo {
  attemptedFilesCount: number;
  attemptedBytes: number;
  currentVaultBytes: number;
  projectedTotalBytes: number;
  softStorageLimitBytes: number;
  overageBytes: number;
  fileNames: string[];
}

interface UploadCategorizePanelProps {
  categories: string[];
  activeRoomCode: string;
  senderName: string;
  senderDevice: string;
  canUpload?: boolean;
  userRoleLabel?: string;
  currentVaultBytes?: number;
  softStorageLimitBytes?: number;
  vaultFiles?: SharedFile[];
  persistentE2eeConfig?: PersistentE2eeConfig;
  onPersistentE2eeConfigChange?: (config: PersistentE2eeConfig) => void;
  onDeleteOldFile?: (fileId: string) => Promise<void>;
  onManageOldFilesInVault?: () => void;
  onStorageLimitExceededAttempt?: (info: StorageLimitAttemptInfo) => void;
  onOpenAuthModal?: () => void;
  onUploadFile: (
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
  ) => Promise<void>;
  onAddCategory: (name: string) => Promise<void>;
  onUploadComplete?: () => void;
}

const DEFAULT_SOFT_STORAGE_LIMIT_BYTES = 25 * 1024 * 1024; // 25 MB

export const UploadCategorizePanel: React.FC<UploadCategorizePanelProps> = ({
  categories,
  activeRoomCode,
  senderName,
  senderDevice,
  canUpload = true,
  userRoleLabel,
  currentVaultBytes = 0,
  softStorageLimitBytes = DEFAULT_SOFT_STORAGE_LIMIT_BYTES,
  vaultFiles = [],
  persistentE2eeConfig,
  onPersistentE2eeConfigChange,
  onDeleteOldFile,
  onManageOldFilesInVault,
  onStorageLimitExceededAttempt,
  onOpenAuthModal,
  onUploadFile,
  onAddCategory,
  onUploadComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const limitAlertRef = useRef<HTMLDivElement | null>(null);
  const [stagedItems, setStagedItems] = useState<StagedUploadItem[]>([]);
  const [batchCategory, setBatchCategory] = useState<string>('Documents');
  const [autoTagEnabled, setAutoTagEnabled] = useState<boolean>(true);
  const [uploadDate, setUploadDate] = useState<string>(getTodayIsoDate());
  const [pinCode, setPinCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const initialE2ee = useMemo(
    () => persistentE2eeConfig || loadPersistentE2eeConfig(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [encryptionEnabled, setEncryptionEnabled] = useState<boolean>(
    initialE2ee.enabled
  );
  const [encryptionPassphrase, setEncryptionPassphrase] = useState<string>(
    initialE2ee.passphrase || 'relaydrop-2026'
  );
  const [keyHint, setKeyHint] = useState<string>(
    initialE2ee.keyHint || 'Demo passphrase: relaydrop-2026'
  );
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [encryptionError, setEncryptionError] = useState<string>('');

  // Sync with parent controlled persistent E2EE config if updated externally
  useEffect(() => {
    if (!persistentE2eeConfig) return;
    setEncryptionEnabled(persistentE2eeConfig.enabled);
    if (persistentE2eeConfig.passphrase) {
      setEncryptionPassphrase(persistentE2eeConfig.passphrase);
    }
    if (typeof persistentE2eeConfig.keyHint === 'string') {
      setKeyHint(persistentE2eeConfig.keyHint);
    }
  }, [
    persistentE2eeConfig?.enabled,
    persistentE2eeConfig?.passphrase,
    persistentE2eeConfig?.keyHint,
  ]);

  const updatePersistentE2ee = useCallback(
    (nextPartial: Partial<PersistentE2eeConfig>) => {
      const nextConfig: PersistentE2eeConfig = {
        enabled:
          typeof nextPartial.enabled === 'boolean'
            ? nextPartial.enabled
            : encryptionEnabled,
        passphrase:
          typeof nextPartial.passphrase === 'string'
            ? nextPartial.passphrase
            : encryptionPassphrase,
        keyHint:
          typeof nextPartial.keyHint === 'string' ? nextPartial.keyHint : keyHint,
      };
      setEncryptionEnabled(nextConfig.enabled);
      setEncryptionPassphrase(nextConfig.passphrase);
      setKeyHint(nextConfig.keyHint);
      savePersistentE2eeConfig(nextConfig);
      if (onPersistentE2eeConfigChange) {
        onPersistentE2eeConfigChange(nextConfig);
      }
    },
    [
      encryptionEnabled,
      encryptionPassphrase,
      keyHint,
      onPersistentE2eeConfigChange,
    ]
  );

  // Automatic Local Encryption Flow: whenever Enable E2EE is ON, automatically encrypt staged files locally in browser memory
  useEffect(() => {
    const activePass = (encryptionPassphrase || 'relaydrop-2026').trim();
    if (!encryptionEnabled) {
      setStagedItems((prev) => {
        if (!prev.some((i) => i.localEncrypted || i.isEncryptingLocally)) {
          return prev;
        }
        return prev.map((item) => ({
          ...item,
          localEncrypted: false,
          encryptionAlgo: undefined,
          encryptionIv: undefined,
          encryptionSalt: undefined,
          encryptionFingerprint: undefined,
          encryptedPayload: undefined,
          encryptedWithPassphrase: undefined,
          isEncryptingLocally: false,
        }));
      });
      return;
    }

    if (!activePass) return;

    const needsLocalEncryption = stagedItems.filter(
      (item) =>
        (!item.localEncrypted ||
          item.encryptedWithPassphrase !== activePass ||
          !item.encryptedPayload) &&
        !item.isEncryptingLocally
    );

    if (needsLocalEncryption.length === 0) return;

    let cancelled = false;
    const targetIds = new Set(needsLocalEncryption.map((i) => i.localId));

    setStagedItems((prev) =>
      prev.map((item) =>
        targetIds.has(item.localId)
          ? { ...item, isEncryptingLocally: true }
          : item
      )
    );

    (async () => {
      for (const item of needsLocalEncryption) {
        if (cancelled) return;
        try {
          const encResult = await encryptFilePayload(
            {
              textContent:
                item.textContent ||
                (!item.dataUrl
                  ? `Encrypted RelayDrop File: ${item.name} (${formatBytes(item.size)})`
                  : undefined),
              dataUrl: item.dataUrl,
              mimeType: item.mimeType,
              name: item.name,
            },
            activePass
          );
          if (cancelled) return;
          setStagedItems((prev) =>
            prev.map((current) =>
              current.localId === item.localId
                ? {
                    ...current,
                    localEncrypted: true,
                    encryptionAlgo: encResult.encryptionAlgo,
                    encryptionIv: encResult.encryptionIv,
                    encryptionSalt: encResult.encryptionSalt,
                    encryptionFingerprint: encResult.encryptionFingerprint,
                    encryptedPayload: encResult.encryptedPayload,
                    encryptedWithPassphrase: activePass,
                    isEncryptingLocally: false,
                  }
                : current
            )
          );
        } catch {
          if (cancelled) return;
          setStagedItems((prev) =>
            prev.map((current) =>
              current.localId === item.localId
                ? { ...current, isEncryptingLocally: false }
                : current
            )
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [encryptionEnabled, encryptionPassphrase, stagedItems]);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [showNewCategoryForm, setShowNewCategoryForm] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [activeUploadTransfer, setActiveUploadTransfer] =
    useState<TransferProgressState | null>(null);
  const [previewStagedItem, setPreviewStagedItem] =
    useState<StagedUploadItem | null>(null);
  const [uploadAttemptedOverLimit, setUploadAttemptedOverLimit] =
    useState<boolean>(false);
  const [showSubmitTooltip, setShowSubmitTooltip] = useState<boolean>(false);
  const [deletingOldFileId, setDeletingOldFileId] = useState<string | null>(null);

  // Quick snippet composer for instant file creation without leaving browser
  const [showSnippetComposer, setShowSnippetComposer] = useState<boolean>(false);
  const [snippetFilename, setSnippetFilename] = useState<string>('2025-report-summary.pdf');
  const [snippetContent, setSnippetContent] = useState<string>(
    '# Q4 2025 Financial & Operations Report\nShared via RelayDrop P2P Vault.\n- Revenue & BOM reconciliation verified\n- Auto-tagged via filename keyword rule (2025-report -> Financials)'
  );

  // Live auto-tag suggestions for the snippet filename
  const snippetSuggestions = useMemo(
    () =>
      suggestCategoriesForFile(
        snippetFilename,
        snippetFilename.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : snippetFilename.toLowerCase().endsWith('.json')
          ? 'application/json'
          : snippetFilename.toLowerCase().endsWith('.csv')
          ? 'text/csv'
          : 'text/plain',
        categories
      ),
    [snippetFilename, categories]
  );

  // Aggregate unique suggestions across all currently staged files
  const stagedCategorySuggestions = useMemo(() => {
    const map = new Map<string, CategorySuggestion>();
    for (const item of stagedItems) {
      for (const s of item.suggestions) {
        if (!map.has(s.category)) {
          map.set(s.category, s);
        }
      }
    }
    return Array.from(map.values());
  }, [stagedItems]);

  // Soft Storage Limit (25 MB) Calculations
  const stagedTotalBytes = useMemo(
    () => stagedItems.reduce((sum, item) => sum + (item.size || 0), 0),
    [stagedItems]
  );

  const projectedTotalBytes = currentVaultBytes + stagedTotalBytes;
  const remainingSoftLimitBytes = Math.max(0, softStorageLimitBytes - currentVaultBytes);
  const overageBytes = Math.max(0, projectedTotalBytes - softStorageLimitBytes);
  const wouldExceedSoftLimit =
    stagedItems.length > 0 && projectedTotalBytes > softStorageLimitBytes;
  const currentUsagePercent =
    softStorageLimitBytes > 0
      ? Math.round((currentVaultBytes / softStorageLimitBytes) * 1000) / 10
      : 0;
  const projectedUsagePercent =
    softStorageLimitBytes > 0
      ? Math.round((projectedTotalBytes / softStorageLimitBytes) * 1000) / 10
      : 0;

  // Oldest files in vault suggested for deletion when soft limit is exceeded
  const oldestVaultFiles = useMemo(() => {
    if (!vaultFiles || vaultFiles.length === 0) return [];
    return [...vaultFiles]
      .sort(
        (a, b) =>
          a.uploadDate.localeCompare(b.uploadDate) ||
          a.uploadedAt.localeCompare(b.uploadedAt) ||
          b.size - a.size
      )
      .slice(0, 4);
  }, [vaultFiles]);

  const handleQuickDeleteOldFile = async (fileId: string) => {
    if (!onDeleteOldFile || deletingOldFileId) return;
    setDeletingOldFileId(fileId);
    try {
      await onDeleteOldFile(fileId);
    } finally {
      setDeletingOldFileId(null);
    }
  };

  const handleStageLargeLimitSampleFile = () => {
    // Stage a 21.5 MB sample archive that pushes the ~4.8 MB vault over the 25 MB soft storage limit
    const sampleName = 'lidar-pointcloud-raw-archive-2026.zip';
    const sampleMime = 'application/zip';
    const sampleBytes = Math.max(
      21.5 * 1024 * 1024,
      softStorageLimitBytes - currentVaultBytes + 1.4 * 1024 * 1024
    );
    const suggestions = suggestCategoriesForFile(
      sampleName,
      sampleMime,
      categories
    );
    const assignedCategory = autoTagEnabled
      ? suggestions[0]?.category || 'Archives & Code'
      : batchCategory;
    const manifestText = `# High-Density 3D LiDAR Point Cloud Archive (${sampleName})\nUncompressed Payload: ${formatBytes(
      sampleBytes
    )}\nRoom: ${activeRoomCode}\nNote: Staged to demonstrate the 25 MB soft storage limit notification & tooltip.`;

    const item: StagedUploadItem = {
      localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: sampleName,
      size: Math.round(sampleBytes),
      mimeType: sampleMime,
      category: assignedCategory,
      uploadDate,
      textContent: manifestText,
      suggestions,
      autoTagged: autoTagEnabled,
    };

    const nextStaged = [...stagedItems, item];
    const nextStagedBytes = nextStaged.reduce((s, i) => s + (i.size || 0), 0);
    const nextProjected = currentVaultBytes + nextStagedBytes;

    setStagedItems(nextStaged);
    setBatchCategory(assignedCategory);
    setUploadAttemptedOverLimit(true);
    setShowSubmitTooltip(true);

    if (nextProjected > softStorageLimitBytes && onStorageLimitExceededAttempt) {
      onStorageLimitExceededAttempt({
        attemptedFilesCount: nextStaged.length,
        attemptedBytes: nextStagedBytes,
        currentVaultBytes,
        projectedTotalBytes: nextProjected,
        softStorageLimitBytes,
        overageBytes: nextProjected - softStorageLimitBytes,
        fileNames: nextStaged.map((i) => i.name),
      });
    }
  };

  const processBrowserFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const newStaged: StagedUploadItem[] = [];

    for (const file of filesArray) {
      const suggestions = suggestCategoriesForFile(
        file.name,
        file.type,
        categories
      );
      const primaryCategory = autoTagEnabled
        ? suggestions[0]?.category || 'Documents'
        : batchCategory;

      let dataUrl: string | undefined;
      let textContent: string | undefined;

      if (file.size <= 12 * 1024 * 1024) {
        const isSvg =
          file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
        const isTextOrJson =
          file.type.startsWith('text/') ||
          file.type === 'application/json' ||
          file.type.endsWith('+json') ||
          file.type.endsWith('+xml') ||
          /\.(md|markdown|json|jsonl|csv|tsv|txt|log|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|c|cpp|h|sh|html|htm|css|scss|xml|yml|yaml|toml|ini|conf|env|sql)$/i.test(
            file.name
          );

        if (isSvg) {
          textContent = await file.text();
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        } else if (isTextOrJson) {
          textContent = await file.text();
        } else {
          dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve(typeof reader.result === 'string' ? reader.result : '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });
        }
      }

      newStaged.push({
        localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name,
        size: file.size || 1024,
        mimeType: file.type || 'application/octet-stream',
        category: primaryCategory,
        uploadDate,
        dataUrl,
        textContent,
        suggestions,
        autoTagged: autoTagEnabled,
      });
    }

    setStagedItems((prev) => {
      const combined = [...prev, ...newStaged];
      const nextStagedBytes = combined.reduce((s, i) => s + (i.size || 0), 0);
      const nextProjected = currentVaultBytes + nextStagedBytes;
      if (nextProjected > softStorageLimitBytes) {
        setUploadAttemptedOverLimit(true);
        setShowSubmitTooltip(true);
        if (onStorageLimitExceededAttempt) {
          onStorageLimitExceededAttempt({
            attemptedFilesCount: combined.length,
            attemptedBytes: nextStagedBytes,
            currentVaultBytes,
            projectedTotalBytes: nextProjected,
            softStorageLimitBytes,
            overageBytes: nextProjected - softStorageLimitBytes,
            fileNames: combined.map((i) => i.name),
          });
        }
      }
      return combined;
    });
    if (newStaged.length >= 1 && autoTagEnabled) {
      setBatchCategory(newStaged[newStaged.length - 1].category);
    }
  };

  const handleStageRuleSampleFile = (sample: {
    rule: string;
    sampleFileName: string;
    sampleMimeType: string;
    targetCategory: string;
  }) => {
    const suggestions = suggestCategoriesForFile(
      sample.sampleFileName,
      sample.sampleMimeType,
      categories
    );
    const assignedCategory = autoTagEnabled
      ? suggestions[0]?.category || sample.targetCategory
      : batchCategory;
    const sampleBody = `# Auto-Tagged File Sample (${sample.sampleFileName})\nMatched Rule: ${sample.rule}\nAssigned Category: ${assignedCategory}\nGenerated in Room ${activeRoomCode}`;
    const byteSize = new Blob([sampleBody]).size + 14200;

    const item: StagedUploadItem = {
      localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: sample.sampleFileName,
      size: byteSize,
      mimeType: sample.sampleMimeType,
      category: assignedCategory,
      uploadDate,
      textContent: sampleBody,
      suggestions,
      autoTagged: autoTagEnabled,
    };

    setStagedItems((prev) => [...prev, item]);
    setBatchCategory(assignedCategory);
  };

  const handleAddSnippetToStage = () => {
    const cleanName = snippetFilename.trim() || `note-${Date.now()}.txt`;
    const byteSize = Math.max(256, new Blob([snippetContent]).size);
    const inferredMime = cleanName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : cleanName.toLowerCase().endsWith('.json')
      ? 'application/json'
      : cleanName.toLowerCase().endsWith('.csv')
      ? 'text/csv'
      : 'text/markdown';
    const suggestions = suggestCategoriesForFile(
      cleanName,
      inferredMime,
      categories
    );
    const inferredCategory = autoTagEnabled
      ? suggestions[0]?.category || 'Documents'
      : batchCategory;

    const item: StagedUploadItem = {
      localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      size: byteSize,
      mimeType: inferredMime,
      category: inferredCategory,
      uploadDate,
      textContent: snippetContent,
      suggestions,
      autoTagged: autoTagEnabled,
    };
    setStagedItems((prev) => [...prev, item]);
    setBatchCategory(inferredCategory);
    setShowSnippetComposer(false);
  };

  const handleApplyBatchCategory = (category: string) => {
    setBatchCategory(category);
    setStagedItems((prev) =>
      prev.map((item) => ({
        ...item,
        category,
        autoTagged: item.suggestions[0]?.category === category,
      }))
    );
  };

  const handleReapplyAutoTags = () => {
    setStagedItems((prev) =>
      prev.map((item) => {
        const refreshed = suggestCategoriesForFile(
          item.name,
          item.mimeType,
          categories
        );
        return {
          ...item,
          suggestions: refreshed,
          category: refreshed[0]?.category || item.category,
          autoTagged: true,
        };
      })
    );
    if (stagedItems.length > 0) {
      const lastSuggestions = suggestCategoriesForFile(
        stagedItems[stagedItems.length - 1].name,
        stagedItems[stagedItems.length - 1].mimeType,
        categories
      );
      if (lastSuggestions[0]) {
        setBatchCategory(lastSuggestions[0].category);
      }
    }
  };

  const handleUpdateItemCategory = (localId: string, category: string) => {
    setStagedItems((prev) =>
      prev.map((item) =>
        item.localId === localId
          ? {
              ...item,
              category,
              autoTagged: item.suggestions[0]?.category === category,
            }
          : item
      )
    );
  };

  const handleRemoveStagedItem = (localId: string) => {
    setStagedItems((prev) => prev.filter((item) => item.localId !== localId));
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;
    await onAddCategory(trimmed);
    handleApplyBatchCategory(trimmed);
    setNewCategoryName('');
    setShowNewCategoryForm(false);
  };

  const executeCommitUploads = async (bypassSoftLimit = false) => {
    if (stagedItems.length === 0 || isUploading) return;

    if (wouldExceedSoftLimit && !bypassSoftLimit) {
      setUploadAttemptedOverLimit(true);
      setShowSubmitTooltip(true);
      if (onStorageLimitExceededAttempt) {
        onStorageLimitExceededAttempt({
          attemptedFilesCount: stagedItems.length,
          attemptedBytes: stagedTotalBytes,
          currentVaultBytes,
          projectedTotalBytes,
          softStorageLimitBytes,
          overageBytes,
          fileNames: stagedItems.map((i) => i.name),
        });
      }
      setTimeout(() => {
        limitAlertRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }, 40);
      return;
    }

    if (encryptionEnabled && !encryptionPassphrase.trim()) {
      setEncryptionError('Please enter or generate an encryption passphrase before uploading.');
      return;
    }
    setEncryptionError('');
    setUploadAttemptedOverLimit(false);
    setShowSubmitTooltip(false);
    setIsUploading(true);

    try {
      for (let i = 0; i < stagedItems.length; i++) {
        const item = stagedItems[i];
        const totalBytes = Math.max(1024, item.size || 1024);
        const baseSpeed = estimateTargetThroughputBytesPerSec(totalBytes);
        const transferId = `upload-${Date.now()}-${i}`;
        const startedAt = performance.now();

        setActiveUploadTransfer({
          id: transferId,
          fileName: item.name,
          direction: 'upload',
          totalBytes,
          transferredBytes: 0,
          speedBytesPerSec: baseSpeed,
          etaSeconds: totalBytes / baseSpeed,
          percentage: 2,
          status: 'transferring',
          startedAt,
          peerName: `Room ${activeRoomCode}`,
        });

        let encryptedFields: {
          encrypted?: boolean;
          encryptionAlgo?: string;
          encryptionIv?: string;
          encryptionSalt?: string;
          encryptionFingerprint?: string;
          encryptedPayload?: string;
          keyHint?: string;
        } = {};

        let outgoingDataUrl = item.dataUrl;
        let outgoingTextContent = item.textContent;
        const activePassphrase = (encryptionPassphrase || 'relaydrop-2026').trim();

        if (encryptionEnabled && activePassphrase) {
          if (
            item.localEncrypted &&
            item.encryptedPayload &&
            item.encryptionIv &&
            item.encryptionSalt &&
            item.encryptionFingerprint &&
            item.encryptedWithPassphrase === activePassphrase
          ) {
            encryptedFields = {
              encrypted: true,
              encryptionAlgo:
                item.encryptionAlgo || 'AES-256-GCM · PBKDF2-SHA256',
              encryptionIv: item.encryptionIv,
              encryptionSalt: item.encryptionSalt,
              encryptionFingerprint: item.encryptionFingerprint,
              encryptedPayload: item.encryptedPayload,
              keyHint: keyHint.trim() || undefined,
            };
          } else {
            const encResult = await encryptFilePayload(
              {
                textContent:
                  item.textContent ||
                  (!item.dataUrl
                    ? `Encrypted RelayDrop File: ${item.name} (${formatBytes(item.size)})`
                    : undefined),
                dataUrl: item.dataUrl,
                mimeType: item.mimeType,
                name: item.name,
              },
              activePassphrase
            );
            encryptedFields = {
              encrypted: true,
              encryptionAlgo: encResult.encryptionAlgo,
              encryptionIv: encResult.encryptionIv,
              encryptionSalt: encResult.encryptionSalt,
              encryptionFingerprint: encResult.encryptionFingerprint,
              encryptedPayload: encResult.encryptedPayload,
              keyHint: keyHint.trim() || undefined,
            };
          }
          // Zero-knowledge guarantee: strip plaintext before network transmission
          outgoingDataUrl = undefined;
          outgoingTextContent = undefined;
        }

        // Start network upload in parallel with real-time byte & speed progress stream
        const uploadPromise = onUploadFile(
          {
            name: item.name,
            size: item.size,
            mimeType: item.mimeType,
            category: item.category || batchCategory,
            uploadDate: uploadDate || item.uploadDate,
            senderName,
            senderDevice,
            roomCode: activeRoomCode,
            pinCode: pinCode.trim() || undefined,
            notes: notes.trim() || undefined,
            dataUrl: outgoingDataUrl,
            textContent: outgoingTextContent,
            ...encryptedFields,
          },
          { bypassSoftLimit: true }
        );

        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
            const instantaneousFactor = 0.94 + 0.12 * Math.sin(elapsedSec * 9);
            const currentSpeed = Math.round(baseSpeed * instantaneousFactor);
            const transferred = Math.min(
              totalBytes,
              Math.round(elapsedSec * baseSpeed)
            );
            const remainingBytes = Math.max(0, totalBytes - transferred);
            const etaSec = remainingBytes / Math.max(1, currentSpeed);
            const pct = Math.min(99, Math.round((transferred / totalBytes) * 100));

            setActiveUploadTransfer({
              id: transferId,
              fileName: item.name,
              direction: 'upload',
              totalBytes,
              transferredBytes: transferred,
              speedBytesPerSec: currentSpeed,
              etaSeconds: etaSec,
              percentage: pct,
              status: 'transferring',
              startedAt,
              peerName: `Room ${activeRoomCode}`,
            });

            if (transferred >= totalBytes) {
              clearInterval(timer);
              resolve();
            }
          }, 55);
        });

        await uploadPromise;

        const finalElapsedSec = Math.max(0.2, (performance.now() - startedAt) / 1000);
        const effectiveSpeed = Math.round(totalBytes / finalElapsedSec);
        setActiveUploadTransfer({
          id: transferId,
          fileName: item.name,
          direction: 'upload',
          totalBytes,
          transferredBytes: totalBytes,
          speedBytesPerSec: effectiveSpeed,
          etaSeconds: 0,
          percentage: 100,
          status: 'completed',
          startedAt,
          elapsedSeconds: finalElapsedSec,
          peerName: `Room ${activeRoomCode}`,
        });
      }

      setStagedItems([]);
      setPinCode('');
      setNotes('');
      setTimeout(() => {
        if (onUploadComplete) {
          onUploadComplete();
        }
      }, 380);
    } finally {
      setTimeout(() => {
        setIsUploading(false);
        setActiveUploadTransfer(null);
      }, 650);
    }
  };

  const handleCommitUploads = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeCommitUploads(false);
  };

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Upload & Categorize Files
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Smart auto-tagging suggests categories from file extensions and filename keywords.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              if (e.target.files) {
                processBrowserFiles(e.target.files);
                e.target.value = '';
              }
            }}
            className="hidden"
          />
          <button
            type="button"
            disabled={!canUpload}
            onClick={() => canUpload && cameraInputRef.current?.click()}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-sky-50 hover:bg-sky-100 disabled:opacity-50 text-sky-900 border border-sky-200/80 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap interactive-press"
          >
            <Camera className="w-4 h-4 text-sky-600" />
            <span>Camera Photo</span>
          </button>

          <button
            type="button"
            disabled={!canUpload}
            onClick={() => canUpload && setShowSnippetComposer((v) => !v)}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-800 text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap interactive-press"
          >
            <FileCode className="w-4 h-4 text-sky-600" />
            <span>{showSnippetComposer ? 'Hide Note Composer' : 'Quick Text File'}</span>
          </button>

          <button
            type="button"
            disabled={!canUpload}
            onClick={() => canUpload && handleStageLargeLimitSampleFile()}
            title="Stage a 21.5 MB sample file to test the 25 MB soft storage limit warning & tooltip"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 disabled:opacity-50 text-amber-900 border border-amber-200/90 text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap interactive-press"
          >
            <HardDrive className="w-4 h-4 text-amber-600" />
            <span>Test 25 MB Limit (+21.5 MB)</span>
          </button>

          {/* Persistent Enable E2EE Header Toggle Switch */}
          <button
            type="button"
            role="switch"
            aria-checked={encryptionEnabled}
            aria-label="Enable E2EE"
            onClick={() => {
              updatePersistentE2ee({ enabled: !encryptionEnabled });
              setEncryptionError('');
            }}
            title="Persistent toggle: when enabled, automatically encrypts all staged files locally in browser memory (AES-256-GCM) before sending to the backend"
            className={`min-h-[44px] px-3.5 py-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap interactive-press ${
              encryptionEnabled
                ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm shadow-emerald-600/20'
                : 'bg-emerald-50/70 hover:bg-emerald-100/80 border-emerald-200 text-emerald-950'
            }`}
          >
            <ShieldCheck
              className={`w-4 h-4 ${
                encryptionEnabled ? 'text-white' : 'text-emerald-600'
              }`}
            />
            <span>Enable E2EE</span>
            <span
              className={`px-1.5 py-0.5 rounded-md font-mono text-[10px] font-bold uppercase ${
                encryptionEnabled
                  ? 'bg-white/20 text-white'
                  : 'bg-emerald-200/70 text-emerald-900'
              }`}
            >
              {encryptionEnabled ? 'ON · Persistent' : 'OFF'}
            </span>
          </button>
        </div>
      </div>

      {/* Live Vault Capacity & 25 MB Soft Storage Limit Projection Meter */}
      <div
        className={`p-3.5 rounded-2xl border transition-colors space-y-2 ${
          wouldExceedSoftLimit
            ? 'bg-rose-50/70 border-rose-300/90'
            : projectedUsagePercent >= 80
            ? 'bg-amber-50/60 border-amber-200/90'
            : 'bg-slate-50/80 border-slate-200/80'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <HardDrive
              className={`w-4 h-4 shrink-0 ${
                wouldExceedSoftLimit
                  ? 'text-rose-600'
                  : projectedUsagePercent >= 80
                  ? 'text-amber-600'
                  : 'text-sky-600'
              }`}
            />
            <span className="font-semibold text-slate-900">
              Vault 25 MB Soft Storage Limit
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span
              className={`font-medium ${
                wouldExceedSoftLimit
                  ? 'text-rose-700 font-semibold'
                  : 'text-slate-600'
              }`}
            >
              {wouldExceedSoftLimit
                ? `Exceeds limit by ${formatBytes(overageBytes)} — delete old files before proceeding`
                : stagedTotalBytes > 0
                ? `${formatBytes(
                    Math.max(0, softStorageLimitBytes - projectedTotalBytes)
                  )} remaining after staged upload`
                : `${formatBytes(remainingSoftLimitBytes)} available before soft limit`}
            </span>
          </div>

          <div className="font-mono tabular-nums text-xs text-slate-700">
            <span className="font-semibold text-slate-900">
              {formatBytes(currentVaultBytes)}
            </span>
            {stagedTotalBytes > 0 && (
              <span
                className={
                  wouldExceedSoftLimit
                    ? 'text-rose-600 font-bold'
                    : 'text-sky-700 font-semibold'
                }
              >
                {' '}
                + {formatBytes(stagedTotalBytes)} staged
              </span>
            )}{' '}
            / {formatBytes(softStorageLimitBytes)}{' '}
            <span
              className={
                wouldExceedSoftLimit
                  ? 'text-rose-600 font-bold'
                  : 'text-slate-500'
              }
            >
              ({projectedUsagePercent}%)
            </span>
          </div>
        </div>

        <div
          role="progressbar"
          aria-label="Projected vault storage usage against 25 MB soft limit"
          aria-valuenow={Math.min(100, Math.round(projectedUsagePercent))}
          aria-valuemin={0}
          aria-valuemax={100}
          className="w-full h-2.5 rounded-full bg-slate-200/80 overflow-hidden flex"
        >
          <div
            className="h-full bg-slate-800 transition-all duration-300"
            style={{
              width: `${Math.min(
                100,
                (currentVaultBytes / softStorageLimitBytes) * 100
              )}%`,
            }}
            title={`Current vault files: ${formatBytes(currentVaultBytes)} (${currentUsagePercent}%)`}
          />
          {stagedTotalBytes > 0 && (
            <div
              className={`h-full transition-all duration-300 ${
                wouldExceedSoftLimit ? 'bg-rose-500' : 'bg-sky-500'
              }`}
              style={{
                width: `${Math.min(
                  Math.max(
                    0,
                    100 - (currentVaultBytes / softStorageLimitBytes) * 100
                  ),
                  (stagedTotalBytes / softStorageLimitBytes) * 100
                )}%`,
              }}
              title={`Staged upload: +${formatBytes(stagedTotalBytes)}`}
            />
          )}
        </div>
      </div>

      {!canUpload && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-700 flex items-center justify-center shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-bold text-amber-950">
                Upload Restricted ({userRoleLabel || 'Sign-In Required'})
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Sign in with an Editor or Admin role to upload files or create custom categories.
              </p>
            </div>
          </div>
          {onOpenAuthModal && (
            <button
              type="button"
              onClick={onOpenAuthModal}
              className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap self-start sm:self-auto"
            >
              Sign In / Manage Role
            </button>
          )}
        </div>
      )}

      {/* Optional Quick Text/Code File Composer with Real-Time Filename Auto-Tagging */}
      <AnimatePresence>
        {showSnippetComposer && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                Compose Instant File & Test Filename Auto-Tagging
              </span>
              {snippetSuggestions[0] && (
                <span className="text-xs font-mono text-sky-700 font-semibold">
                  Suggested: {snippetSuggestions[0].matchedRule}
                </span>
              )}
            </div>
            <input
              type="text"
              value={snippetFilename}
              onChange={(e) => setSnippetFilename(e.target.value)}
              placeholder="Filename (e.g. 2025-report.pdf, contract.pdf, config.json)"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />

            {/* Live Category Suggestions based on Filename Keywords & Extension */}
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500 flex items-center gap-1 mr-1">
                <Wand2 className="w-3.5 h-3.5 text-sky-600" />
                <span>Auto-tag suggestions:</span>
              </span>
              {snippetSuggestions.map((sug, idx) => (
                <button
                  key={sug.category}
                  type="button"
                  onClick={() => setBatchCategory(sug.category)}
                  className={`min-h-[30px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                     idx === 0
                      ? 'bg-sky-600 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>{sug.category}</span>
                  <span className="font-mono text-[11px] opacity-85">
                    ({sug.reason})
                  </span>
                </button>
              ))}
            </div>

            <textarea
              rows={3}
              value={snippetContent}
              onChange={(e) => setSnippetContent(e.target.value)}
              placeholder="Paste text, code, or markdown content to share as a file..."
              className="w-full p-3.5 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAddSnippetToStage}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap interactive-press"
              >
                Stage & Auto-Tag File ({snippetSuggestions[0]?.category || 'Documents'})
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Touch-Friendly File Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (e.dataTransfer.files) {
            processBrowserFiles(e.dataTransfer.files);
          }
        }}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-6 sm:p-8 text-center transition-colors ${
          isDragging
            ? 'border-sky-600 bg-sky-50/60'
            : 'border-slate-300 hover:border-slate-400 bg-slate-50/60'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={(e) => {
            if (e.target.files) {
              processBrowserFiles(e.target.files);
              e.target.value = '';
            }
          }}
          className="hidden"
        />
        <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center mx-auto mb-3">
          <Upload className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold text-slate-900">
          Tap to select files from your device or drag & drop here
        </p>
        <p className="text-xs text-slate-500 mt-1">
          Auto-tagging detects extensions & keywords (e.g., <span className="font-mono text-slate-700">'.pdf' -&gt; 'Documents'</span>, <span className="font-mono text-slate-700">'2025-report' -&gt; 'Financials'</span>)
        </p>
      </div>

      {/* Auto-Tagging System Panel: Rules & Interactive Sample Triggers */}
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-sky-600 shrink-0" />
            <div>
              <h3 className="text-xs font-bold text-slate-900">
                Smart Auto-Tagging Engine
              </h3>
              <p className="text-[11px] text-slate-500">
                Matches filename keywords and extensions during upload · Tap any rule below to stage a sample file
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setAutoTagEnabled((prev) => !prev)}
            aria-pressed={autoTagEnabled}
            className={`min-h-[34px] px-3 py-1 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors interactive-press ${
              autoTagEnabled
                ? 'bg-sky-600 text-white'
                : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>{autoTagEnabled ? 'Auto-Tagging: ON' : 'Auto-Tagging: OFF'}</span>
          </button>
        </div>

        {/* Interactive Auto-Tag Rule Buttons */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {AUTO_TAG_RULE_EXAMPLES.map((example) => (
            <button
              key={example.rule}
              type="button"
              disabled={!canUpload}
              onClick={() => handleStageRuleSampleFile(example)}
              title={`Stage "${example.sampleFileName}" using rule ${example.rule}`}
              className="min-h-[34px] px-2.5 py-1 rounded-xl bg-white hover:bg-sky-50 border border-slate-200/90 hover:border-sky-300 text-xs font-mono text-slate-700 hover:text-sky-800 transition-colors flex items-center gap-1.5 interactive-press disabled:opacity-50"
            >
              <span>{example.rule}</span>
            </button>
          ))}
        </div>

        {/* Staged Files Active Suggestions Summary */}
        {stagedCategorySuggestions.length > 0 && (
          <div className="pt-2 border-t border-slate-200/70 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-slate-700 mr-1">
              Suggested for staged files:
            </span>
            {stagedCategorySuggestions.map((sug) => {
              const isSelected = batchCategory === sug.category;
              return (
                <button
                  key={sug.category}
                  type="button"
                  onClick={() => handleApplyBatchCategory(sug.category)}
                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span>{sug.category}</span>
                  <span className="font-mono text-[11px] opacity-80">
                    ({sug.matchedRule})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Category Assignment & Custom Category Creation */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-slate-900">
            Select Upload Category
          </label>
          <button
            type="button"
            onClick={() => setShowNewCategoryForm((v) => !v)}
            className="min-h-[40px] px-2.5 text-xs font-semibold text-sky-700 hover:text-sky-800 flex items-center gap-1.5 whitespace-nowrap"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{showNewCategoryForm ? 'Cancel' : '+ Add Custom Category'}</span>
          </button>
        </div>

        {showNewCategoryForm && (
          <form onSubmit={handleCreateCategory} className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="New category name (e.g. Client Contracts, 3D Models)..."
              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
            <button
              type="submit"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition-colors whitespace-nowrap"
            >
              Add Category
            </button>
          </form>
        )}

        <div className="flex flex-wrap gap-1.5 p-1.5 bg-slate-100 rounded-2xl">
          {categories.map((cat) => {
            const isSelected = batchCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => handleApplyBatchCategory(cat)}
                className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 interactive-press ${
                  isSelected
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 text-sky-600" />}
                <span>{cat}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Staged Files Queue with Individual Category Selector & Auto-Tag Suggestions */}
      {stagedItems.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-900">
              Staged Files ({stagedItems.length})
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleReapplyAutoTags}
                className="min-h-[36px] px-2.5 py-1 rounded-lg bg-sky-50 hover:bg-sky-100 text-xs font-semibold text-sky-700 flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <Wand2 className="w-3.5 h-3.5" />
                <span>Re-apply Auto-Tags</span>
              </button>
              <button
                type="button"
                onClick={() => setStagedItems([])}
                className="min-h-[36px] px-2 text-xs font-semibold text-slate-500 hover:text-rose-600 whitespace-nowrap"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-100 border-y border-slate-100">
            {stagedItems.map((item) => {
              const primarySuggestion = item.suggestions[0];
              return (
                <div
                  key={item.localId}
                  onClick={() => setPreviewStagedItem(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setPreviewStagedItem(item);
                    }
                  }}
                  className="group py-3.5 px-2 -mx-2 rounded-xl bg-white hover:bg-slate-50 transition-colors flex flex-col gap-2.5 cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {item.dataUrl && item.dataUrl.startsWith('data:image/') ? (
                        <div className="w-10 h-10 rounded-xl bg-slate-900 overflow-hidden shrink-0 border border-slate-200/80">
                          <img
                            src={item.dataUrl}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-slate-100 group-hover:bg-sky-50 text-slate-700 group-hover:text-sky-600 flex items-center justify-center shrink-0 transition-colors">
                          <FileCode className="w-4 h-4" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900 group-hover:text-sky-700 transition-colors truncate">
                            {item.name}
                          </p>
                          {encryptionEnabled && (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold ${
                                item.localEncrypted
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                              <span>
                                {item.localEncrypted
                                  ? `Pre-Encrypted Locally · SHA-256: ${item.encryptionFingerprint}`
                                  : 'Encrypting locally (AES-256-GCM)...'}
                              </span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">
                          <span className="font-mono tabular-nums">
                            {formatBytes(item.size)}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span>{item.mimeType}</span>
                          {primarySuggestion && (
                            <>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span className="font-mono text-sky-700 font-semibold">
                                Auto-tag: {primarySuggestion.matchedRule}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div
                      className="flex items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewStagedItem(item)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-sky-50 text-slate-700 hover:text-sky-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5 text-sky-600" />
                        <span>Preview</span>
                      </button>

                      <select
                        aria-label={`Category for ${item.name}`}
                        value={item.category}
                        onChange={(e) =>
                          handleUpdateItemCategory(item.localId, e.target.value)
                        }
                        className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRemoveStagedItem(item.localId)}
                        aria-label={`Remove ${item.name}`}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Per-File Suggested Categories Selector Row */}
                  {item.suggestions.length > 0 && (
                    <div
                      className="flex flex-wrap items-center gap-1.5 pl-0 sm:pl-13 text-xs"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[11px] text-slate-500 flex items-center gap-1 mr-1">
                        <Wand2 className="w-3 h-3 text-sky-600" />
                        <span>Suggested categories:</span>
                      </span>
                      {item.suggestions.map((sug) => {
                        const isAssigned = item.category === sug.category;
                        return (
                          <button
                            key={sug.category}
                            type="button"
                            onClick={() =>
                              handleUpdateItemCategory(item.localId, sug.category)
                            }
                            className={`min-h-[28px] px-2.5 py-0.5 rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                              isAssigned
                                ? 'bg-sky-600 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isAssigned && <Check className="w-3 h-3" />}
                            <span>{sug.category}</span>
                            <span className="font-mono opacity-80">
                              ({sug.reason})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upload Date, Optional PIN Lock, and Notes */}
      <form onSubmit={handleCommitUploads} className="space-y-4 pt-2 border-t border-slate-100">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="upload-date-input"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 mb-1.5"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Upload Date</span>
            </label>
            <input
              id="upload-date-input"
              type="date"
              value={uploadDate}
              onChange={(e) => setUploadDate(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>

          <div>
            <label
              htmlFor="upload-pin-input"
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 mb-1.5"
            >
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Optional PIN Lock</span>
            </label>
            <input
              id="upload-pin-input"
              type="text"
              inputMode="numeric"
              maxLength={8}
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value)}
              placeholder="Leave blank for open room access"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs font-mono tabular-nums text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="upload-notes-input"
            className="block text-xs font-semibold text-slate-900 mb-1.5"
          >
            Transfer Note (Optional, searchable)
          </label>
          <input
            id="upload-notes-input"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add context or project note for recipients..."
            className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
          />
        </div>

        {/* Client-Side Zero-Knowledge End-to-End Encryption (AES-256-GCM) */}
        <div
          className={`p-4 rounded-2xl border transition-colors space-y-3.5 ${
            encryptionEnabled
              ? 'bg-emerald-50/40 border-emerald-300/90'
              : 'bg-slate-50 border-slate-200/80'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  encryptionEnabled
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xs font-bold text-slate-900">
                    End-to-End Encryption (AES-256-GCM)
                  </h3>
                  <span className="px-1.5 py-0.5 rounded-md bg-slate-200/80 text-slate-700 font-mono text-[10px] font-semibold">
                    Persistent Setting
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  When enabled, automatically triggers local Web Crypto encryption before any file is sent to the backend
                </p>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={encryptionEnabled}
              onClick={() => {
                updatePersistentE2ee({ enabled: !encryptionEnabled });
                setEncryptionError('');
              }}
              className={`min-h-[38px] px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap interactive-press ${
                encryptionEnabled
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Enable E2EE</span>
              <span
                className={`w-8 h-4 rounded-full p-0.5 flex items-center transition-colors ${
                  encryptionEnabled ? 'bg-emerald-900/40 justify-end' : 'bg-slate-200 justify-start'
                }`}
              >
                <span className="w-3 h-3 rounded-full bg-white shadow-xs" />
              </span>
            </button>
          </div>

          <AnimatePresence>
            {encryptionEnabled && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="pt-2 border-t border-emerald-200/70 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="e2ee-passphrase-input"
                      className="block text-xs font-semibold text-slate-900 mb-1"
                    >
                      Encryption Passphrase / Key (Persisted Locally)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        id="e2ee-passphrase-input"
                        type="text"
                        value={encryptionPassphrase}
                        onChange={(e) => {
                          updatePersistentE2ee({ passphrase: e.target.value });
                          setEncryptionError('');
                        }}
                        placeholder="Enter passphrase for AES-256 key..."
                        className="flex-1 min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const generated = generateStrongPassphrase(activeRoomCode);
                          updatePersistentE2ee({ passphrase: generated });
                          setEncryptionError('');
                        }}
                        title="Generate random high-entropy key"
                        className="min-h-[42px] px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Generate</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!encryptionPassphrase) return;
                          try {
                            await navigator.clipboard.writeText(encryptionPassphrase);
                          } catch {
                            // Ignore clipboard fallback
                          }
                          setCopiedKey(true);
                          setTimeout(() => setCopiedKey(false), 2000);
                        }}
                        title="Copy encryption key"
                        className="min-h-[42px] px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1 whitespace-nowrap interactive-press"
                      >
                        {copiedKey ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="e2ee-hint-input"
                      className="block text-xs font-semibold text-slate-900 mb-1"
                    >
                      Optional Key Hint for Room Peers
                    </label>
                    <input
                      id="e2ee-hint-input"
                      type="text"
                      value={keyHint}
                      onChange={(e) => updatePersistentE2ee({ keyHint: e.target.value })}
                      placeholder="e.g. Demo key: relaydrop-2026"
                      className="w-full min-h-[42px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-emerald-900">
                  <span>
                    Auto-Encryption Flow: Local Web Crypto (AES-256-GCM · PBKDF2 100k iter) → Strip Plaintext → Send Ciphertext to Backend
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      updatePersistentE2ee({
                        passphrase: 'relaydrop-2026',
                        keyHint: 'Demo passphrase: relaydrop-2026',
                      });
                    }}
                    className="text-emerald-700 hover:text-emerald-900 underline underline-offset-2 font-semibold"
                  >
                    Use Default Demo Key (relaydrop-2026)
                  </button>
                </div>

                {encryptionError && (
                  <p className="text-xs font-semibold text-rose-600">
                    {encryptionError}
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {activeUploadTransfer && (
          <TransferProgressBar transfer={activeUploadTransfer} />
        )}

        {/* Visual Notification when file upload would push the vault over the 25MB soft storage limit */}
        <AnimatePresence>
          {wouldExceedSoftLimit && (
            <motion.div
              ref={limitAlertRef}
              key="soft-storage-limit-alert"
              initial={{ opacity: 0, y: -6, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.99 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              role="alert"
              aria-live="assertive"
              className={`p-4 sm:p-5 rounded-2xl border space-y-3.5 ${
                uploadAttemptedOverLimit
                  ? 'bg-rose-50 border-rose-300 ring-2 ring-rose-500/20'
                  : 'bg-amber-50/90 border-amber-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      uploadAttemptedOverLimit
                        ? 'bg-rose-600 text-white'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3
                        className={`text-sm font-bold ${
                          uploadAttemptedOverLimit
                            ? 'text-rose-950'
                            : 'text-amber-950'
                        }`}
                      >
                        25 MB Soft Storage Limit Exceeded — Please Delete Old Files Before Proceeding
                      </h3>
                      {uploadAttemptedOverLimit && (
                        <span className="text-[11px] font-mono font-bold text-rose-700">
                          · Upload Paused (+{formatBytes(overageBytes)} over limit)
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-xs leading-relaxed ${
                        uploadAttemptedOverLimit
                          ? 'text-rose-900'
                          : 'text-amber-900'
                      }`}
                    >
                      Uploading{' '}
                      <span className="font-semibold">
                        {stagedItems.length === 1
                          ? `"${stagedItems[0].name}"`
                          : `${stagedItems.length} staged files`}
                      </span>{' '}
                      (<span className="font-mono">{formatBytes(stagedTotalBytes)}</span>) would
                      push the room vault from{' '}
                      <span className="font-mono">{formatBytes(currentVaultBytes)}</span> to{' '}
                      <span className="font-mono font-bold">
                        {formatBytes(projectedTotalBytes)}
                      </span>{' '}
                      — exceeding the{' '}
                      <span className="font-mono font-semibold">
                        {formatBytes(softStorageLimitBytes)}
                      </span>{' '}
                      soft storage limit by{' '}
                      <span className="font-mono font-bold">
                        {formatBytes(overageBytes)}
                      </span>
                      . Please delete old files from the vault to free up space before proceeding.
                    </p>
                  </div>
                </div>
              </div>

              {/* Oldest Vault Files Quick-Delete List */}
              {oldestVaultFiles.length > 0 && (
                <div className="bg-white/90 rounded-xl border border-rose-200/80 divide-y divide-slate-100 overflow-hidden">
                  <div className="px-3.5 py-2 bg-slate-50/90 flex items-center justify-between text-[11px] text-slate-600">
                    <span className="font-semibold text-slate-800">
                      Oldest Vault Files Available to Delete
                    </span>
                    <span className="font-mono">
                      Free at least {formatBytes(overageBytes)} to clear warning
                    </span>
                  </div>
                  {oldestVaultFiles.map((oldFile) => (
                    <div
                      key={oldFile.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-slate-900 truncate">
                          {oldFile.name}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate">
                          <span>{oldFile.category}</span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatBytes(oldFile.size)}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">
                            ·
                          </span>
                          <span className="font-mono tabular-nums">
                            Uploaded {formatDisplayDate(oldFile.uploadDate)}
                          </span>
                        </p>
                      </div>

                      {onDeleteOldFile && (
                        <button
                          type="button"
                          disabled={deletingOldFileId === oldFile.id}
                          onClick={() => handleQuickDeleteOldFile(oldFile.id)}
                          className="min-h-[34px] px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors interactive-press disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>
                            {deletingOldFileId === oldFile.id
                              ? 'Deleting...'
                              : `Delete (-${formatBytes(oldFile.size)})`}
                          </span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  {onManageOldFilesInVault && (
                    <button
                      type="button"
                      onClick={onManageOldFilesInVault}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-colors whitespace-nowrap interactive-press"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                      <span>Review & Delete Old Files in Vault</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setStagedItems([]);
                      setUploadAttemptedOverLimit(false);
                      setShowSubmitTooltip(false);
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-xl bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    Clear Staged Upload
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => executeCommitUploads(true)}
                  className="min-h-[40px] px-3.5 py-2 rounded-xl bg-rose-600/10 hover:bg-rose-600/20 text-rose-900 text-xs font-semibold transition-colors whitespace-nowrap"
                >
                  Override Soft Limit & Proceed Anyway →
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button Wrapper with Interactive 25 MB Soft Storage Limit Tooltip */}
        <div
          className="relative"
          onMouseEnter={() => {
            if (wouldExceedSoftLimit) setShowSubmitTooltip(true);
          }}
          onMouseLeave={() => {
            if (!uploadAttemptedOverLimit) setShowSubmitTooltip(false);
          }}
        >
          <AnimatePresence>
            {wouldExceedSoftLimit && (showSubmitTooltip || uploadAttemptedOverLimit) && (
              <motion.div
                key="upload-soft-limit-tooltip"
                role="tooltip"
                initial={{ opacity: 0, y: 6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.98 }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                className="mb-2.5 p-3.5 rounded-2xl bg-slate-900 text-white shadow-xl shadow-slate-950/25 border border-rose-500/40 flex items-start justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-bold text-white">
                      Vault 25 MB Soft Storage Limit Would Be Exceeded (+{formatBytes(overageBytes)})
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                      This upload ({formatBytes(stagedTotalBytes)}) pushes the vault to{' '}
                      <span className="font-mono text-amber-300 font-semibold">
                        {formatBytes(projectedTotalBytes)} / {formatBytes(softStorageLimitBytes)}
                      </span>
                      . Please delete old files before proceeding, or use the override option above.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowSubmitTooltip(false);
                    setUploadAttemptedOverLimit(false);
                  }}
                  aria-label="Dismiss storage limit tooltip"
                  className="p-1 rounded-lg text-slate-400 hover:text-white transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={!canUpload || stagedItems.length === 0 || isUploading}
            onFocus={() => {
              if (wouldExceedSoftLimit) setShowSubmitTooltip(true);
            }}
            onBlur={() => {
              if (!uploadAttemptedOverLimit) setShowSubmitTooltip(false);
            }}
            className={`w-full min-h-[48px] px-5 py-3 rounded-xl disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap ${
              wouldExceedSoftLimit
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-sky-600 hover:bg-sky-700'
            }`}
          >
            {wouldExceedSoftLimit ? (
              <AlertTriangle className="w-4 h-4" />
            ) : (
              <FileUp className="w-4 h-4" />
            )}
            <span>
              {!canUpload
                ? 'Editor or Admin Role Required to Upload'
                : stagedItems.length === 0
                ? 'Select or Stage Files Above to Upload'
                : wouldExceedSoftLimit
                ? `Exceeds 25 MB Soft Limit (+${formatBytes(overageBytes)}) — Delete Old Files First`
                : encryptionEnabled
                ? `Encrypt (AES-256-GCM) & Share ${stagedItems.length} ${stagedItems.length === 1 ? 'File' : 'Files'} to Vault`
                : `Share ${stagedItems.length} Categorized ${stagedItems.length === 1 ? 'File' : 'Files'} to Vault`}
            </span>
          </button>
        </div>
      </form>

      {/* Instant Staged File Preview Modal */}
      <FilePreviewModal
        file={
          previewStagedItem
            ? {
                id: previewStagedItem.localId,
                name: previewStagedItem.name,
                size: previewStagedItem.size,
                mimeType: previewStagedItem.mimeType,
                category: previewStagedItem.category,
                uploadDate: previewStagedItem.uploadDate,
                senderName,
                senderDevice,
                roomCode: activeRoomCode,
                dataUrl: previewStagedItem.dataUrl,
                textContent: previewStagedItem.textContent,
              }
            : null
        }
        onClose={() => setPreviewStagedItem(null)}
      />
    </div>
  );
};
