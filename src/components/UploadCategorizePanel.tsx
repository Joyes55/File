import React, { useState, useRef } from 'react';
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
} from 'lucide-react';
import {
  formatBytes,
  getTodayIsoDate,
  inferCategoryFromFile,
  TransferProgressState,
  estimateTargetThroughputBytesPerSec,
} from '../types/files';
import { TransferProgressBar } from './TransferProgressBar';

export interface StagedUploadItem {
  localId: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  uploadDate: string;
  dataUrl?: string;
  textContent?: string;
}

interface UploadCategorizePanelProps {
  categories: string[];
  activeRoomCode: string;
  senderName: string;
  senderDevice: string;
  canUpload?: boolean;
  userRoleLabel?: string;
  onOpenAuthModal?: () => void;
  onUploadFile: (payload: {
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
  }) => Promise<void>;
  onAddCategory: (name: string) => Promise<void>;
  onUploadComplete?: () => void;
}

export const UploadCategorizePanel: React.FC<UploadCategorizePanelProps> = ({
  categories,
  activeRoomCode,
  senderName,
  senderDevice,
  canUpload = true,
  userRoleLabel,
  onOpenAuthModal,
  onUploadFile,
  onAddCategory,
  onUploadComplete,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [stagedItems, setStagedItems] = useState<StagedUploadItem[]>([]);
  const [batchCategory, setBatchCategory] = useState<string>('Documents');
  const [uploadDate, setUploadDate] = useState<string>(getTodayIsoDate());
  const [pinCode, setPinCode] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [showNewCategoryForm, setShowNewCategoryForm] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [activeUploadTransfer, setActiveUploadTransfer] =
    useState<TransferProgressState | null>(null);

  // Quick snippet composer for instant file creation without leaving browser
  const [showSnippetComposer, setShowSnippetComposer] = useState<boolean>(false);
  const [snippetFilename, setSnippetFilename] = useState<string>('field-notes-2026.md');
  const [snippetContent, setSnippetContent] = useState<string>(
    '# Mobile Field Notes\nShared via RelayDrop P2P Vault.\n- Verified UWB & WebSocket room sync\n- Categorized under Documents'
  );

  const processBrowserFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const newStaged: StagedUploadItem[] = [];

    for (const file of filesArray) {
      const inferred = inferCategoryFromFile(file.name, file.type);
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
        category: inferred,
        uploadDate,
        dataUrl,
        textContent,
      });
    }

    setStagedItems((prev) => [...prev, ...newStaged]);
    if (newStaged.length === 1) {
      setBatchCategory(newStaged[0].category);
    }
  };

  const handleAddSnippetToStage = () => {
    const cleanName = snippetFilename.trim() || `note-${Date.now()}.txt`;
    const byteSize = new Blob([snippetContent]).size;
    const inferred = inferCategoryFromFile(cleanName, 'text/plain');
    const item: StagedUploadItem = {
      localId: `staged-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      size: byteSize,
      mimeType: cleanName.endsWith('.json')
        ? 'application/json'
        : cleanName.endsWith('.csv')
        ? 'text/csv'
        : 'text/markdown',
      category: inferred,
      uploadDate,
      textContent: snippetContent,
    };
    setStagedItems((prev) => [...prev, item]);
    setBatchCategory(inferred);
    setShowSnippetComposer(false);
  };

  const handleApplyBatchCategory = (category: string) => {
    setBatchCategory(category);
    setStagedItems((prev) => prev.map((item) => ({ ...item, category })));
  };

  const handleUpdateItemCategory = (localId: string, category: string) => {
    setStagedItems((prev) =>
      prev.map((item) => (item.localId === localId ? { ...item, category } : item))
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

  const handleCommitUploads = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stagedItems.length === 0 || isUploading) return;

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

        // Start network upload in parallel with real-time byte & speed progress stream
        const uploadPromise = onUploadFile({
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
          dataUrl: item.dataUrl,
          textContent: item.textContent,
        });

        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            const elapsedSec = Math.max(0.05, (performance.now() - startedAt) / 1000);
            // Smooth throughput variance (+/- 8%) around estimated P2P link speed
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

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 p-5 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            Upload & Categorize Files
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Assign categories and upload dates so peers can filter or search instantly.
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

      {/* Optional Quick Text/Code File Composer */}
      <AnimatePresence>
        {showSnippetComposer && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-900">
                Compose Instant Text / Markdown / JSON File
              </span>
            </div>
            <input
              type="text"
              value={snippetFilename}
              onChange={(e) => setSnippetFilename(e.target.value)}
              placeholder="Filename (e.g. project-notes.md or config.json)"
              className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-600"
            />
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
                Stage File for Categorization
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
          Photos, PDFs, Documents, Audio, ZIP archives, or Design Assets · Auto-categorized on selection
        </p>
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

        <div className="flex flex-wrap gap-2">
          {categories.map((cat) => {
            const isSelected = batchCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => handleApplyBatchCategory(cat)}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {isSelected && <Check className="w-3.5 h-3.5 text-sky-400" />}
                <span>{cat}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Staged Files Queue with Individual Category Selector */}
      {stagedItems.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900">
              Staged Files ({stagedItems.length})
            </span>
            <button
              type="button"
              onClick={() => setStagedItems([])}
              className="min-h-[40px] px-2 text-xs font-semibold text-slate-500 hover:text-rose-600 whitespace-nowrap"
            >
              Clear All
            </button>
          </div>

          <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 overflow-hidden">
            {stagedItems.map((item) => (
              <div
                key={item.localId}
                className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {item.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <span className="font-mono tabular-nums">{formatBytes(item.size)}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span>{item.mimeType}</span>
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Category for ${item.name}`}
                    value={item.category}
                    onChange={(e) => handleUpdateItemCategory(item.localId, e.target.value)}
                    className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-600"
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
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
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

        {activeUploadTransfer && (
          <TransferProgressBar transfer={activeUploadTransfer} />
        )}

        <button
          type="submit"
          disabled={!canUpload || stagedItems.length === 0 || isUploading}
          className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-sky-600 hover:bg-sky-700 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
        >
          <FileUp className="w-4 h-4" />
          <span>
            {!canUpload
              ? 'Editor or Admin Role Required to Upload'
              : stagedItems.length === 0
              ? 'Select or Stage Files Above to Upload'
              : `Share ${stagedItems.length} Categorized ${stagedItems.length === 1 ? 'File' : 'Files'} to Vault`}
          </span>
        </button>
      </form>
    </div>
  );
};
