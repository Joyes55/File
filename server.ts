import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import JSZip from 'jszip';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SharedFileRecord {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  category: string;
  uploadedAt: string; // ISO string e.g. 2026-09-26T08:15:00.000Z
  uploadDate: string; // YYYY-MM-DD in local/UTC for fast date matching
  ownerUid?: string;
  ownerEmail?: string;
  senderName: string;
  senderDevice: string;
  roomCode: string;
  downloads: number;
  pinProtected: boolean;
  pinCode?: string;
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
  localAssetPath?: string;
}

export interface ConnectedPeer {
  id: string;
  name: string;
  deviceModel: string;
  roomCode: string;
  joinedAt: string;
  status: 'idle' | 'receiving' | 'sending';
}

export type ActivityActionType =
  | 'upload'
  | 'delete'
  | 'category_change'
  | 'pin_toggle'
  | 'rename'
  | 'category_created'
  | 'download';

export interface ActivityLogRecord {
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

export interface SharedBundleRecord {
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
  bundleZipBytes: number;
  downloads: number;
  revoked: boolean;
  shareUrl: string;
  downloadUrl: string;
  zipBuffer: Buffer;
}

// Helper to generate a valid tiny 1-second 440Hz sine wave WAV buffer
function createSampleWavDataUrl(): string {
  const sampleRate = 8000;
  const numSamples = sampleRate; // 1 second
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20);  // PCM format
  buffer.writeUInt16LE(1, 22);  // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 2.5);
    const sample = Math.sin(2 * Math.PI * 528 * t) * envelope * 0.45;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return `data:audio/wav;base64,${buffer.toString('base64')}`;
}

const initialCategories: string[] = [
  'Photos & Media',
  'Documents',
  'Design Assets',
  'Audio & Voice',
  'Archives & Code',
  'Financials',
];

const sampleMarkdownSpec = `# RelayDrop P2P Mesh & Categorized Vault Specification
Revision: 4.2 · Date: September 25, 2026
Author: Mobile Systems Architecture Team

## 1. Executive Summary
RelayDrop enables sub-second local and room-paired file transfers across mobile handsets, tablets, and workstations without mandatory cloud account lock-in.

## 2. Core Capabilities
- Zero-Configuration Radar Discovery over WebSocket room channels
- Structured User File Categorization on upload and post-upload
- Instant Multi-Key Search indexing file name, category, and ISO/human upload date
- Optional 4-digit PIN lock for confidential document drops
`;

const sampleJsonTokens = JSON.stringify(
  {
    schemaVersion: '3.1.0',
    updatedAt: '2026-09-22',
    typography: {
      display: 'Syne',
      body: 'Plus Jakarta Sans',
      monospace: 'JetBrains Mono',
    },
    colorTokens: {
      canvas: '#F8FAFC',
      surface: '#FFFFFF',
      primaryInk: '#0F172A',
      accentRelay: '#0284C7',
    },
    touchTargets: {
      minimumHitboxPx: 44,
      primaryCtaHeightPx: 48,
    },
  },
  null,
  2
);

const sampleCsvBom = `PartNumber,Component,Category,UnitCostUSD,Quantity,ExtendedCostUSD,LeadTimeDays
RD-MCU-01,Nordic nRF5340 Dual-Core SoC,Semiconductors,4.85,250,1212.50,14
RD-UWB-02,Decawave DW3120 UWB Transceiver,RF Modules,6.20,250,1550.00,21
RD-ENC-03,CNC Anodized 6061 Aluminum Chassis,Mechanical,18.40,250,4600.00,10
RD-DSP-04,1.9-inch AMOLED High-Contrast Touch Panel,Optoelectronics,11.10,250,2775.00,18
RD-BAT-05,Li-Po 2400mAh High-Discharge Cell,Power,5.60,250,1400.00,7
`;

const sampleWavDataUrl = createSampleWavDataUrl();

function createSeededEncryptedFilePayload() {
  const plaintextDoc = JSON.stringify(
    {
      protocol: 'RelayDrop Zero-Knowledge E2EE Mesh v4.2',
      cipherSuite: 'AES-256-GCM (Web Crypto API)',
      kdf: 'PBKDF2-HMAC-SHA256 (100,000 iterations)',
      roomCode: '842-910',
      emergencyRecoveryTokens: [
        'RD-2026-ALPHA-9941-X8B2',
        'RD-2026-BRAVO-7730-M4K9',
        'RD-2026-DELTA-3108-Q2V7',
      ],
      notes: 'Decrypted locally in browser memory via window.crypto.subtle.decrypt.',
    },
    null,
    2
  );

  const envelope = JSON.stringify({
    textContent: plaintextDoc,
    originalMimeType: 'application/json',
    originalName: 'zero-trust-mesh-keys-2026.json',
    encryptedAt: '2026-09-26T06:45:00.000Z',
  });

  const passphrase = 'relaydrop-2026';
  const salt = Buffer.from('relaydrop-salt16', 'utf-8'); // 16 bytes
  const iv = Buffer.from('relaydropiv1', 'utf-8'); // 12 bytes
  const key = crypto.pbkdf2Sync(passphrase, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedBuf = Buffer.concat([
    cipher.update(Buffer.from(envelope, 'utf-8')),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const fingerprint = crypto
    .createHash('sha256')
    .update(encryptedBuf)
    .digest('hex')
    .slice(0, 16);

  return {
    encrypted: true,
    encryptionAlgo: 'AES-256-GCM · PBKDF2-SHA256',
    encryptionIv: iv.toString('base64'),
    encryptionSalt: salt.toString('base64'),
    encryptionFingerprint: fingerprint,
    encryptedPayload: encryptedBuf.toString('base64'),
    keyHint: 'Demo passphrase: relaydrop-2026',
    byteLength: Buffer.byteLength(plaintextDoc, 'utf-8'),
  };
}

const filesStore: Map<string, SharedFileRecord> = new Map();
const categoriesStore: Set<string> = new Set(initialCategories);
const peersStore: Map<string, ConnectedPeer> = new Map();
const activityStore: ActivityLogRecord[] = [];
const bundlesStore: Map<string, SharedBundleRecord> = new Map();

function appendActivityLog(
  entry: Omit<ActivityLogRecord, 'id' | 'timestamp'> & {
    id?: string;
    timestamp?: string;
  }
): ActivityLogRecord {
  const fullEntry: ActivityLogRecord = {
    id: entry.id || `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: entry.timestamp || new Date().toISOString(),
    action: entry.action,
    fileId: entry.fileId,
    fileName: entry.fileName,
    fileSize: entry.fileSize,
    category: entry.category,
    previousCategory: entry.previousCategory,
    actorName: entry.actorName || 'Room Peer',
    actorDevice: entry.actorDevice || 'Mobile Client',
    actorRole: entry.actorRole || 'editor',
    roomCode: entry.roomCode || '842-910',
    details: entry.details,
  };
  activityStore.unshift(fullEntry);
  if (activityStore.length > 250) {
    activityStore.length = 250;
  }
  return fullEntry;
}

function loadAssetDataUrl(assetPath: string, mimeType: string): string | undefined {
  try {
    if (fs.existsSync(assetPath)) {
      const bytes = fs.readFileSync(assetPath);
      return `data:${mimeType};base64,${bytes.toString('base64')}`;
    }
  } catch {
    // Fallback to previewUrl if file read fails
  }
  return undefined;
}

function seedInitialFiles() {
  const archAssetPath = path.join(
    __dirname,
    'src/assets/images/sample_architectural_render_1790426251205.jpg'
  );
  const synthAssetPath = path.join(
    __dirname,
    'src/assets/images/sample_industrial_audio_prototype_1790426265878.jpg'
  );

  const initialFiles: SharedFileRecord[] = [
    {
      id: 'file-arch-render-01',
      name: 'nordic-pavilion-render-8k.jpg',
      size: 2845120,
      mimeType: 'image/jpeg',
      category: 'Photos & Media',
      uploadedAt: '2026-09-26T05:18:00.000Z',
      uploadDate: '2026-09-26',
      senderName: 'Soren Lindqvist',
      senderDevice: 'iPhone 16 Pro',
      roomCode: '842-910',
      downloads: 14,
      pinProtected: false,
      pinned: true,
      pinnedAt: '2026-09-26T08:00:00.000Z',
      favorite: true,
      favoritedAt: '2026-09-26T08:05:00.000Z',
      notes: 'Golden hour exterior facade study with lakeside timber reflections.',
      previewUrl: '/src/assets/images/sample_architectural_render_1790426251205.jpg',
      dataUrl: loadAssetDataUrl(archAssetPath, 'image/jpeg'),
      localAssetPath: archAssetPath,
    },
    {
      id: 'file-audio-synth-02',
      name: 'field-synth-hardware-rev4.jpg',
      size: 1964800,
      mimeType: 'image/jpeg',
      category: 'Design Assets',
      uploadedAt: '2026-09-26T03:42:00.000Z',
      uploadDate: '2026-09-26',
      senderName: 'Maya Lin-Kovacs',
      senderDevice: 'iPad Pro M4',
      roomCode: '842-910',
      downloads: 9,
      pinProtected: false,
      notes: 'Anodized aluminum enclosure macro shot for industrial design sign-off.',
      previewUrl: '/src/assets/images/sample_industrial_audio_prototype_1790426265878.jpg',
      dataUrl: loadAssetDataUrl(synthAssetPath, 'image/jpeg'),
      localAssetPath: synthAssetPath,
    },
    {
      id: 'file-arch-spec-03',
      name: 'q3-product-architecture-spec.md',
      size: Buffer.byteLength(sampleMarkdownSpec, 'utf-8'),
      mimeType: 'text/markdown',
      category: 'Documents',
      uploadedAt: '2026-09-25T16:20:00.000Z',
      uploadDate: '2026-09-25',
      senderName: 'Elena Rostova',
      senderDevice: 'Pixel 9 Pro',
      roomCode: '842-910',
      downloads: 27,
      pinProtected: false,
      favorite: true,
      favoritedAt: '2026-09-25T16:25:00.000Z',
      notes: 'Complete P2P WebSocket mesh protocol & mobile ergonomics specification.',
      textContent: sampleMarkdownSpec,
    },
    {
      id: 'file-impulse-wav-04',
      name: 'acoustic-chime-528hz-test.wav',
      size: 16044,
      mimeType: 'audio/wav',
      category: 'Audio & Voice',
      uploadedAt: '2026-09-24T14:10:00.000Z',
      uploadDate: '2026-09-24',
      senderName: 'Devon Brooks',
      senderDevice: 'Nothing Phone (2a)',
      roomCode: '842-910',
      downloads: 6,
      pinProtected: false,
      notes: 'Reference 528Hz harmonic calibration tone for mobile speaker array.',
      dataUrl: sampleWavDataUrl,
    },
    {
      id: 'file-tokens-json-05',
      name: 'design-tokens-system-v3.json',
      size: Buffer.byteLength(sampleJsonTokens, 'utf-8'),
      mimeType: 'application/json',
      category: 'Archives & Code',
      uploadedAt: '2026-09-22T11:05:00.000Z',
      uploadDate: '2026-09-22',
      senderName: 'Kenji Takahashi',
      senderDevice: 'Galaxy S25 Ultra',
      roomCode: '842-910',
      downloads: 19,
      pinProtected: false,
      notes: 'Production typography, spacing, and 60-30-10 color palette tokens.',
      textContent: sampleJsonTokens,
    },
    {
      id: 'file-bom-csv-06',
      name: 'hardware-bom-cost-sheet-2026.csv',
      size: Buffer.byteLength(sampleCsvBom, 'utf-8'),
      mimeType: 'text/csv',
      category: 'Financials',
      uploadedAt: '2026-09-19T09:30:00.000Z',
      uploadDate: '2026-09-19',
      senderName: 'Soren Lindqvist',
      senderDevice: 'iPhone 16 Pro',
      roomCode: '842-910',
      downloads: 11,
      pinProtected: true,
      pinCode: '2026',
      notes: 'Q4 component unit pricing and lead times. Default PIN: 2026.',
      textContent: sampleCsvBom,
    },
  ];

  const seededE2ee = createSeededEncryptedFilePayload();
  initialFiles.splice(2, 0, {
    id: 'file-e2ee-keys-07',
    name: 'zero-trust-mesh-keys-2026.json',
    size: seededE2ee.byteLength,
    mimeType: 'application/json',
    category: 'Archives & Code',
    uploadedAt: '2026-09-26T06:45:00.000Z',
    uploadDate: '2026-09-26',
    senderName: 'Soren Lindqvist',
    senderDevice: 'iPhone 16 Pro',
    roomCode: '842-910',
    downloads: 8,
    pinProtected: false,
    encrypted: true,
    encryptionAlgo: seededE2ee.encryptionAlgo,
    encryptionIv: seededE2ee.encryptionIv,
    encryptionSalt: seededE2ee.encryptionSalt,
    encryptionFingerprint: seededE2ee.encryptionFingerprint,
    encryptedPayload: seededE2ee.encryptedPayload,
    keyHint: seededE2ee.keyHint,
    notes: 'End-to-end encrypted recovery key bundle (AES-256-GCM). Passphrase: relaydrop-2026',
  });

  for (const item of initialFiles) {
    filesStore.set(item.id, item);
  }

  const initialActivities: ActivityLogRecord[] = [
    {
      id: 'act-seed-01',
      action: 'pin_toggle',
      fileId: 'file-arch-render-01',
      fileName: 'nordic-pavilion-render-8k.jpg',
      fileSize: 2845120,
      category: 'Photos & Media',
      actorName: 'Soren Lindqvist',
      actorDevice: 'iPhone 16 Pro',
      actorRole: 'admin',
      roomCode: '842-910',
      details: 'Pinned "nordic-pavilion-render-8k.jpg" to top of vault',
      timestamp: '2026-09-26T08:00:00.000Z',
    },
    {
      id: 'act-seed-02',
      action: 'upload',
      fileId: 'file-arch-render-01',
      fileName: 'nordic-pavilion-render-8k.jpg',
      fileSize: 2845120,
      category: 'Photos & Media',
      actorName: 'Soren Lindqvist',
      actorDevice: 'iPhone 16 Pro',
      actorRole: 'admin',
      roomCode: '842-910',
      details: 'Uploaded "nordic-pavilion-render-8k.jpg" (2.7 MB) to Photos & Media',
      timestamp: '2026-09-26T05:18:00.000Z',
    },
    {
      id: 'act-seed-03',
      action: 'category_change',
      fileId: 'file-audio-synth-02',
      fileName: 'field-synth-hardware-rev4.jpg',
      fileSize: 1964800,
      previousCategory: 'Photos & Media',
      category: 'Design Assets',
      actorName: 'Maya Lin-Kovacs',
      actorDevice: 'iPad Pro M4',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Reassigned "field-synth-hardware-rev4.jpg" from Photos & Media to Design Assets',
      timestamp: '2026-09-26T03:50:00.000Z',
    },
    {
      id: 'act-seed-04',
      action: 'upload',
      fileId: 'file-audio-synth-02',
      fileName: 'field-synth-hardware-rev4.jpg',
      fileSize: 1964800,
      category: 'Photos & Media',
      actorName: 'Maya Lin-Kovacs',
      actorDevice: 'iPad Pro M4',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Uploaded "field-synth-hardware-rev4.jpg" (1.9 MB) to Photos & Media',
      timestamp: '2026-09-26T03:42:00.000Z',
    },
    {
      id: 'act-seed-05',
      action: 'delete',
      fileId: 'file-legacy-draft-00',
      fileName: 'legacy-enclosure-draft-v1.cad',
      fileSize: 4128000,
      category: 'Design Assets',
      actorName: 'Elena Rostova',
      actorDevice: 'Pixel 9 Pro',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Deleted outdated "legacy-enclosure-draft-v1.cad" from Design Assets',
      timestamp: '2026-09-25T19:12:00.000Z',
    },
    {
      id: 'act-seed-06',
      action: 'upload',
      fileId: 'file-arch-spec-03',
      fileName: 'q3-product-architecture-spec.md',
      fileSize: Buffer.byteLength(sampleMarkdownSpec, 'utf-8'),
      category: 'Documents',
      actorName: 'Elena Rostova',
      actorDevice: 'Pixel 9 Pro',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Uploaded "q3-product-architecture-spec.md" to Documents',
      timestamp: '2026-09-25T16:20:00.000Z',
    },
    {
      id: 'act-seed-07',
      action: 'upload',
      fileId: 'file-impulse-wav-04',
      fileName: 'acoustic-chime-528hz-test.wav',
      fileSize: 16044,
      category: 'Audio & Voice',
      actorName: 'Devon Brooks',
      actorDevice: 'Nothing Phone (2a)',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Uploaded "acoustic-chime-528hz-test.wav" (16 KB) to Audio & Voice',
      timestamp: '2026-09-24T14:10:00.000Z',
    },
    {
      id: 'act-seed-08',
      action: 'upload',
      fileId: 'file-tokens-json-05',
      fileName: 'design-tokens-system-v3.json',
      fileSize: Buffer.byteLength(sampleJsonTokens, 'utf-8'),
      category: 'Archives & Code',
      actorName: 'Kenji Takahashi',
      actorDevice: 'Galaxy S25 Ultra',
      actorRole: 'editor',
      roomCode: '842-910',
      details: 'Uploaded "design-tokens-system-v3.json" to Archives & Code',
      timestamp: '2026-09-22T11:05:00.000Z',
    },
    {
      id: 'act-seed-09',
      action: 'upload',
      fileId: 'file-bom-csv-06',
      fileName: 'hardware-bom-cost-sheet-2026.csv',
      fileSize: Buffer.byteLength(sampleCsvBom, 'utf-8'),
      category: 'Financials',
      actorName: 'Soren Lindqvist',
      actorDevice: 'iPhone 16 Pro',
      actorRole: 'admin',
      roomCode: '842-910',
      details: 'Uploaded PIN-protected "hardware-bom-cost-sheet-2026.csv" to Financials',
      timestamp: '2026-09-19T09:30:00.000Z',
    },
  ];

  for (const act of initialActivities) {
    activityStore.push(act);
  }
}

seedInitialFiles();

function sanitizeFileForClient(file: SharedFileRecord): Omit<SharedFileRecord, 'pinCode' | 'localAssetPath'> {
  const { pinCode, localAssetPath, ...rest } = file;
  return rest;
}

function sanitizeBundleForClient(
  bundle: SharedBundleRecord
): Omit<SharedBundleRecord, 'zipBuffer'> {
  const { zipBuffer, ...rest } = bundle;
  return rest;
}

async function buildZipBufferForFiles(
  files: SharedFileRecord[],
  bundleMeta: {
    bundleId: string;
    archiveName: string;
    roomCode: string;
    createdBy: string;
    createdAt: string;
    expiresAt: string;
    ttlMinutes: number;
  }
): Promise<Buffer> {
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (const file of files) {
    let entryName = file.name.replace(/[/\\?%*:|"<>]/g, '_');
    const seenCount = usedNames.get(entryName.toLowerCase()) || 0;
    usedNames.set(entryName.toLowerCase(), seenCount + 1);
    if (seenCount > 0) {
      const dotIdx = entryName.lastIndexOf('.');
      if (dotIdx > 0) {
        entryName = `${entryName.slice(0, dotIdx)}-${seenCount}${entryName.slice(dotIdx)}`;
      } else {
        entryName = `${entryName}-${seenCount}`;
      }
    }

    if (file.encrypted && file.encryptedPayload) {
      const envelopeJson = JSON.stringify(
        {
          relaydropZeroKnowledgeEnvelope: '1.0',
          fileId: file.id,
          fileName: file.name,
          cipherSuite: file.encryptionAlgo || 'AES-256-GCM · PBKDF2-SHA256',
          ivBase64: file.encryptionIv,
          saltBase64: file.encryptionSalt,
          sha256CiphertextFingerprint: file.encryptionFingerprint,
          ciphertextBase64: file.encryptedPayload,
          keyHint: file.keyHint,
        },
        null,
        2
      );
      zip.file(`${entryName}.enc.json`, Buffer.from(envelopeJson, 'utf-8'));
      continue;
    }

    if (file.localAssetPath && fs.existsSync(file.localAssetPath)) {
      try {
        const assetBuf = fs.readFileSync(file.localAssetPath);
        zip.file(entryName, assetBuf);
        continue;
      } catch {
        // Fallback below
      }
    }

    if (file.dataUrl && file.dataUrl.startsWith('data:')) {
      const matches = file.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches && matches[2]) {
        zip.file(entryName, Buffer.from(matches[2], 'base64'));
        continue;
      }
    }

    if (typeof file.textContent === 'string') {
      zip.file(entryName, Buffer.from(file.textContent, 'utf-8'));
      continue;
    }

    const fallbackContent = [
      `RelayDrop Bundled File Payload: ${file.name}`,
      `File ID: ${file.id}`,
      `Category: ${file.category}`,
      `MIME Type: ${file.mimeType}`,
      `Original Size: ${file.size} bytes`,
      `Uploaded At: ${file.uploadedAt}`,
      `Room Code: ${file.roomCode}`,
      file.notes ? `Notes: ${file.notes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    zip.file(entryName, Buffer.from(fallbackContent, 'utf-8'));
  }

  const manifestJson = JSON.stringify(
    {
      relaydropShareBundleManifest: '1.0',
      bundleId: bundleMeta.bundleId,
      archiveName: bundleMeta.archiveName,
      roomCode: bundleMeta.roomCode,
      createdBy: bundleMeta.createdBy,
      createdAt: bundleMeta.createdAt,
      expiresAt: bundleMeta.expiresAt,
      ttlMinutes: bundleMeta.ttlMinutes,
      fileCount: files.length,
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mimeType: f.mimeType,
        category: f.category,
        encrypted: Boolean(f.encrypted),
        pinProtected: Boolean(f.pinProtected),
        uploadedAt: f.uploadedAt,
      })),
    },
    null,
    2
  );
  zip.file('RELAYDROP_BUNDLE_MANIFEST.json', Buffer.from(manifestJson, 'utf-8'));

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);

  app.use(express.json({ limit: '50mb' }));

  const wss = new WebSocketServer({ noServer: true });
  const socketToPeerId = new Map<WebSocket, string>();

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
  });

  function broadcast(event: string, payload: unknown) {
    const message = JSON.stringify({ event, payload });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.event === 'peer:join' && data.payload) {
          const peer: ConnectedPeer = {
            id: String(data.payload.id || `peer-${Date.now()}`),
            name: String(data.payload.name || 'Mobile Peer'),
            deviceModel: String(data.payload.deviceModel || 'Smartphone'),
            roomCode: String(data.payload.roomCode || '842-910'),
            joinedAt: new Date().toISOString(),
            status: 'idle',
          };
          socketToPeerId.set(ws, peer.id);
          peersStore.set(peer.id, peer);

          // Send authoritative initial sync to joining client
          ws.send(
            JSON.stringify({
              event: 'state:init',
              payload: {
                files: Array.from(filesStore.values()).map(sanitizeFileForClient),
                categories: Array.from(categoriesStore.values()),
                peers: Array.from(peersStore.values()),
                activities: activityStore,
                bundles: Array.from(bundlesStore.values()).map(sanitizeBundleForClient),
              },
            })
          );

          broadcast('peers:updated', Array.from(peersStore.values()));
        } else if (data.event === 'peer:update' && data.payload) {
          const existing = peersStore.get(data.payload.id);
          if (existing) {
            const updated: ConnectedPeer = {
              ...existing,
              ...data.payload,
            };
            peersStore.set(updated.id, updated);
            broadcast('peers:updated', Array.from(peersStore.values()));
          }
        } else if (data.event === 'transfer:pulse' && data.payload) {
          broadcast('transfer:pulse', data.payload);
        }
      } catch (err) {
        console.error('WebSocket message parse error:', err);
      }
    });

    ws.on('close', () => {
      const peerId = socketToPeerId.get(ws);
      if (peerId) {
        peersStore.delete(peerId);
        socketToPeerId.delete(ws);
        broadcast('peers:updated', Array.from(peersStore.values()));
      }
    });
  });

  // Helper to extract caller identity and RBAC role from headers or request body
  function getCallerAuth(req: express.Request) {
    const uid = String(req.headers['x-user-uid'] || req.body?.ownerUid || '').trim();
    const email = String(req.headers['x-user-email'] || req.body?.ownerEmail || '').trim();
    const name = String(
      req.headers['x-user-name'] || req.body?.senderName || req.body?.actorName || 'Alex Rivera'
    ).trim();
    const device = String(
      req.headers['x-user-device'] || req.body?.senderDevice || req.body?.actorDevice || 'Mobile Client'
    ).trim();
    const room = String(
      req.headers['x-room-code'] || req.body?.roomCode || '842-910'
    ).trim();
    const role = String(req.headers['x-user-role'] || req.body?.userRole || 'editor')
      .trim()
      .toLowerCase();
    return {
      uid,
      email,
      name,
      device,
      room,
      role: role === 'admin' || role === 'viewer' ? role : 'editor',
    };
  }

  // REST API Endpoints
  app.get('/api/state', (_req, res) => {
    res.json({
      files: Array.from(filesStore.values()).map(sanitizeFileForClient),
      categories: Array.from(categoriesStore.values()),
      peers: Array.from(peersStore.values()),
      activities: activityStore,
      bundles: Array.from(bundlesStore.values()).map(sanitizeBundleForClient),
    });
  });

  app.get('/api/activity', (_req, res) => {
    res.json({
      activities: activityStore,
    });
  });

  app.post('/api/categories', (req, res) => {
    const caller = getCallerAuth(req);
    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot create categories.',
      });
      return;
    }

    const rawName = String(req.body?.name || '').trim();
    if (!rawName) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    const hadCategory = categoriesStore.has(rawName);
    categoriesStore.add(rawName);
    const allCategories = Array.from(categoriesStore.values());
    broadcast('categories:updated', allCategories);

    let activity: ActivityLogRecord | undefined;
    if (!hadCategory) {
      activity = appendActivityLog({
        action: 'category_created',
        fileName: rawName,
        category: rawName,
        actorName: caller.name,
        actorDevice: caller.device,
        actorRole: caller.role,
        roomCode: caller.room,
        details: `Created custom category "${rawName}"`,
      });
      broadcast('activity:created', activity);
    }

    res.status(201).json({ categories: allCategories, added: rawName, activity });
  });

  app.post('/api/files', (req, res) => {
    const caller = getCallerAuth(req);
    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role is read-only and cannot upload files.',
      });
      return;
    }

    const body = req.body;
    if (!body || !body.name) {
      res.status(400).json({ error: 'File name is required.' });
      return;
    }

    const id = body.id || `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (filesStore.has(id)) {
      const existing = filesStore.get(id)!;
      res.json({ file: sanitizeFileForClient(existing) });
      return;
    }

    const rawFileName = String(body.name).trim();
    const rawMimeType = String(body.mimeType || 'application/octet-stream');
    const inferServerCategory = (name: string, mime: string): string => {
      const lower = name.toLowerCase();
      const lowerMime = mime.toLowerCase();
      if (
        /(2025-report|2026-report|annual-report|report|financial|invoice|budget|receipt|ledger|payroll|tax|expense|revenue|forecast|bom|earnings)/i.test(
          lower
        ) ||
        /\.(csv|tsv|xlsx|xls|numbers|qbo)$/.test(lower)
      ) {
        return 'Financials';
      }
      if (
        /(wireframe|mockup|prototype|figma|sketch|vector|logo|icon|palette|lidar|mesh|cad)/i.test(
          lower
        ) ||
        /\.(fig|sketch|svg|ai|psd|blend|obj|stl)$/.test(lower)
      ) {
        return 'Design Assets';
      }
      if (
        /(voice-memo|podcast|interview|recording|audio|voice)/i.test(lower) ||
        lowerMime.startsWith('audio/') ||
        /\.(mp3|wav|flac|m4a|ogg|aac)$/.test(lower)
      ) {
        return 'Audio & Voice';
      }
      if (
        /(screenshot|camera|photo|portrait|headshot|wallpaper|timelapse)/i.test(
          lower
        ) ||
        lowerMime.startsWith('image/') ||
        lowerMime.startsWith('video/') ||
        /\.(jpg|jpeg|png|webp|gif|heic|mp4|mov|webm)$/.test(lower)
      ) {
        return 'Photos & Media';
      }
      if (
        /(source-code|backup|bundle|release|package|config|schema|firmware|script|sdk)/i.test(
          lower
        ) ||
        /\.(zip|tar|gz|7z|rar|json|ts|tsx|js|py|go|rs|html|css|sh|yaml|yml)$/.test(
          lower
        )
      ) {
        return 'Archives & Code';
      }
      return 'Documents';
    };

    const category =
      String(body.category || '').trim() ||
      inferServerCategory(rawFileName, rawMimeType);
    categoriesStore.add(category);

    const nowIso = body.uploadedAt ? new Date(body.uploadedAt).toISOString() : new Date().toISOString();
    const uploadDate = body.uploadDate || nowIso.slice(0, 10);

    const newFile: SharedFileRecord = {
      id,
      name: String(body.name).trim(),
      size: Number(body.size) || 0,
      mimeType: String(body.mimeType || 'application/octet-stream'),
      category,
      uploadedAt: nowIso,
      uploadDate,
      ownerUid: caller.uid || (body.ownerUid ? String(body.ownerUid) : undefined),
      ownerEmail: caller.email || (body.ownerEmail ? String(body.ownerEmail) : undefined),
      senderName: String(body.senderName || 'You'),
      senderDevice: String(body.senderDevice || 'Mobile Browser'),
      roomCode: String(body.roomCode || '842-910'),
      downloads: 0,
      pinProtected: Boolean(body.pinCode && String(body.pinCode).trim().length > 0),
      pinCode: body.pinCode ? String(body.pinCode).trim() : undefined,
      pinned: Boolean(body.pinned),
      pinnedAt: body.pinned ? String(body.pinnedAt || nowIso) : undefined,
      favorite: Boolean(body.favorite),
      favoritedAt: body.favorite ? String(body.favoritedAt || nowIso) : undefined,
      encrypted: Boolean(body.encrypted),
      encryptionAlgo: body.encryptionAlgo ? String(body.encryptionAlgo) : undefined,
      encryptionIv: body.encryptionIv ? String(body.encryptionIv) : undefined,
      encryptionSalt: body.encryptionSalt ? String(body.encryptionSalt) : undefined,
      encryptionFingerprint: body.encryptionFingerprint
        ? String(body.encryptionFingerprint)
        : undefined,
      encryptedPayload: body.encryptedPayload ? String(body.encryptedPayload) : undefined,
      keyHint: body.keyHint ? String(body.keyHint).trim() : undefined,
      notes: body.notes ? String(body.notes).trim() : undefined,
      previewUrl: body.previewUrl || undefined,
      textContent: body.textContent || undefined,
      dataUrl: body.dataUrl || undefined,
    };

    filesStore.set(id, newFile);
    const clientFile = sanitizeFileForClient(newFile);

    const uploadActivity = appendActivityLog({
      action: 'upload',
      fileId: newFile.id,
      fileName: newFile.name,
      fileSize: newFile.size,
      category: newFile.category,
      actorName: newFile.senderName || caller.name,
      actorDevice: newFile.senderDevice || caller.device,
      actorRole: caller.role,
      roomCode: newFile.roomCode,
      details: `Uploaded "${newFile.name}" to ${newFile.category}${
        newFile.encrypted ? ' (E2EE AES-256-GCM)' : ''
      }${newFile.pinProtected ? ' (PIN-protected)' : ''}`,
    });

    broadcast('file:created', {
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
      activity: uploadActivity,
    });
    broadcast('activity:created', uploadActivity);

    res.status(201).json({
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
      activity: uploadActivity,
    });
  });

  app.patch('/api/files/:id', (req, res) => {
    const caller = getCallerAuth(req);
    const { id } = req.params;
    const existing = filesStore.get(id);
    if (!existing) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const updates = req.body || {};
    const isFavoriteOnlyUpdate =
      Object.keys(updates).length > 0 &&
      Object.keys(updates).every((k) => k === 'favorite' || k === 'favoritedAt');

    if (!isFavoriteOnlyUpdate && caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot modify file metadata or categories.',
      });
      return;
    }

    if (
      !isFavoriteOnlyUpdate &&
      caller.role !== 'admin' &&
      existing.ownerUid &&
      caller.uid &&
      existing.ownerUid !== caller.uid
    ) {
      res.status(403).json({
        error: 'Authorization denied: Only the file owner or an Admin can edit this file.',
      });
      return;
    }
    const prevCategory = existing.category;
    const prevName = existing.name;
    const prevPinned = Boolean(existing.pinned);
    const prevFavorite = Boolean(existing.favorite);
    const prevUploadDate = existing.uploadDate;
    const prevNotes = existing.notes || '';

    const createdActivities: ActivityLogRecord[] = [];

    if (typeof updates.category === 'string' && updates.category.trim()) {
      const nextCategory = updates.category.trim();
      existing.category = nextCategory;
      categoriesStore.add(existing.category);
      if (nextCategory !== prevCategory) {
        createdActivities.push(
          appendActivityLog({
            action: 'category_change',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            previousCategory: prevCategory,
            category: nextCategory,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: `Reassigned "${existing.name}" from ${prevCategory} to ${nextCategory}`,
          })
        );
      }
    }
    if (typeof updates.name === 'string' && updates.name.trim()) {
      const nextName = updates.name.trim();
      existing.name = nextName;
      if (nextName !== prevName) {
        createdActivities.push(
          appendActivityLog({
            action: 'rename',
            fileId: existing.id,
            fileName: nextName,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: `Renamed file from "${prevName}" to "${nextName}"`,
          })
        );
      }
    }
    if (typeof updates.notes === 'string') {
      const nextNotes = updates.notes.trim();
      existing.notes = nextNotes;
      if (nextNotes !== prevNotes && (!updates.name || updates.name.trim() === prevName)) {
        createdActivities.push(
          appendActivityLog({
            action: 'rename',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: nextNotes
              ? `Updated transfer notes on "${existing.name}"`
              : `Cleared transfer notes on "${existing.name}"`,
          })
        );
      }
    }
    if (typeof updates.uploadDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updates.uploadDate)) {
      existing.uploadDate = updates.uploadDate;
      existing.uploadedAt = `${updates.uploadDate}T12:00:00.000Z`;
      if (updates.uploadDate !== prevUploadDate) {
        createdActivities.push(
          appendActivityLog({
            action: 'rename',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: `Updated upload date for "${existing.name}" to ${updates.uploadDate}`,
          })
        );
      }
    }
    if (typeof updates.pinned === 'boolean') {
      existing.pinned = updates.pinned;
      existing.pinnedAt = updates.pinned
        ? typeof updates.pinnedAt === 'string' && updates.pinnedAt.trim()
          ? updates.pinnedAt.trim()
          : new Date().toISOString()
        : undefined;
      if (updates.pinned !== prevPinned) {
        createdActivities.push(
          appendActivityLog({
            action: 'pin_toggle',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: updates.pinned
              ? `Pinned "${existing.name}" to top of vault`
              : `Unpinned "${existing.name}" from top of vault`,
          })
        );
      }
    }
    if (typeof updates.favorite === 'boolean') {
      existing.favorite = updates.favorite;
      existing.favoritedAt = updates.favorite
        ? typeof updates.favoritedAt === 'string' && updates.favoritedAt.trim()
          ? updates.favoritedAt.trim()
          : new Date().toISOString()
        : undefined;
      if (updates.favorite !== prevFavorite) {
        createdActivities.push(
          appendActivityLog({
            action: 'pin_toggle',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: updates.favorite
              ? `Added "${existing.name}" to Favorites`
              : `Removed "${existing.name}" from Favorites`,
          })
        );
      }
    }
    if (typeof updates.encrypted === 'boolean') {
      const prevEncrypted = Boolean(existing.encrypted);
      existing.encrypted = updates.encrypted;
      if (updates.encrypted) {
        existing.encryptionAlgo =
          typeof updates.encryptionAlgo === 'string'
            ? updates.encryptionAlgo
            : 'AES-256-GCM · PBKDF2-SHA256';
        existing.encryptionIv =
          typeof updates.encryptionIv === 'string' ? updates.encryptionIv : undefined;
        existing.encryptionSalt =
          typeof updates.encryptionSalt === 'string' ? updates.encryptionSalt : undefined;
        existing.encryptionFingerprint =
          typeof updates.encryptionFingerprint === 'string'
            ? updates.encryptionFingerprint
            : undefined;
        existing.encryptedPayload =
          typeof updates.encryptedPayload === 'string'
            ? updates.encryptedPayload
            : undefined;
        existing.keyHint =
          typeof updates.keyHint === 'string' ? updates.keyHint.trim() : existing.keyHint;
        existing.textContent = undefined;
        existing.dataUrl = undefined;
        existing.previewUrl = undefined;
      } else {
        existing.encryptionAlgo = undefined;
        existing.encryptionIv = undefined;
        existing.encryptionSalt = undefined;
        existing.encryptionFingerprint = undefined;
        existing.encryptedPayload = undefined;
        existing.keyHint = undefined;
        if (typeof updates.textContent === 'string') {
          existing.textContent = updates.textContent;
        }
        if (typeof updates.dataUrl === 'string') {
          existing.dataUrl = updates.dataUrl;
        }
      }
      if (updates.encrypted !== prevEncrypted) {
        createdActivities.push(
          appendActivityLog({
            action: 'pin_toggle',
            fileId: existing.id,
            fileName: existing.name,
            fileSize: existing.size,
            category: existing.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: existing.roomCode || caller.room,
            details: updates.encrypted
              ? `Encrypted "${existing.name}" with client-side AES-256-GCM`
              : `Decrypted and removed E2EE wrapper on "${existing.name}"`,
          })
        );
      }
    }

    filesStore.set(id, existing);
    const clientFile = sanitizeFileForClient(existing);
    broadcast('file:updated', {
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
    });
    for (const act of createdActivities) {
      broadcast('activity:created', act);
    }

    res.json({
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
      activities: createdActivities,
    });
  });

  app.post('/api/files/bulk-delete', (req, res) => {
    const caller = getCallerAuth(req);
    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot delete files.',
      });
      return;
    }

    const ids: string[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => String(id))
      : [];
    const deletedIds: string[] = [];
    const createdActivities: ActivityLogRecord[] = [];
    for (const id of ids) {
      const target = filesStore.get(id);
      if (target) {
        const canDelete =
          caller.role === 'admin' ||
          !target.ownerUid ||
          (caller.uid && target.ownerUid === caller.uid);
        if (canDelete) {
          filesStore.delete(id);
          deletedIds.push(id);
          const act = appendActivityLog({
            action: 'delete',
            fileId: target.id,
            fileName: target.name,
            fileSize: target.size,
            category: target.category,
            actorName: caller.name,
            actorDevice: caller.device,
            actorRole: caller.role,
            roomCode: target.roomCode || caller.room,
            details: `Deleted "${target.name}" (${target.category}) via bulk action`,
          });
          createdActivities.push(act);
        }
      }
    }
    if (deletedIds.length > 0) {
      broadcast('files:bulk-deleted', { ids: deletedIds });
      for (const act of createdActivities) {
        broadcast('activity:created', act);
      }
    }
    res.json({
      deleted: true,
      ids: deletedIds,
      count: deletedIds.length,
      activities: createdActivities,
    });
  });

  app.post('/api/files/batch-download', (req, res) => {
    const caller = getCallerAuth(req);
    const ids: string[] = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => String(id))
      : [];
    const archiveName = String(
      req.body?.archiveName || `relaydrop-vault-batch-${ids.length}-files.zip`
    ).trim();

    const updatedFiles: Omit<SharedFileRecord, 'pinCode' | 'localAssetPath'>[] = [];
    const downloadedNames: string[] = [];
    let totalBatchBytes = 0;

    for (const id of ids) {
      const target = filesStore.get(id);
      if (target) {
        target.downloads = (target.downloads || 0) + 1;
        filesStore.set(id, target);
        const sanitized = sanitizeFileForClient(target);
        updatedFiles.push(sanitized);
        downloadedNames.push(target.name);
        totalBatchBytes += target.size || 0;
        broadcast('file:updated', {
          file: sanitized,
          categories: Array.from(categoriesStore.values()),
        });
      }
    }

    let activity: ActivityLogRecord | undefined;
    if (updatedFiles.length > 0) {
      const previewNames =
        downloadedNames.length <= 3
          ? downloadedNames.map((n) => `"${n}"`).join(', ')
          : `${downloadedNames
              .slice(0, 2)
              .map((n) => `"${n}"`)
              .join(', ')} + ${downloadedNames.length - 2} more`;

      activity = appendActivityLog({
        action: 'download',
        fileId: updatedFiles[0].id,
        fileName: archiveName,
        fileSize: totalBatchBytes,
        category:
          updatedFiles.length === 1 ? updatedFiles[0].category : 'Archives & Code',
        actorName: caller.name,
        actorDevice: caller.device,
        actorRole: caller.role,
        roomCode: caller.room,
        details: `Batch downloaded ${updatedFiles.length} ${
          updatedFiles.length === 1 ? 'file' : 'files'
        } as ZIP (${previewNames})`,
      });
      broadcast('activity:created', activity);
    }

    res.json({
      ok: true,
      files: updatedFiles,
      activity,
    });
  });

  // Expiring Multi-File Share Bundle Endpoints
  const handleCreateBundle = async (req: express.Request, res: express.Response) => {
    try {
      const caller = getCallerAuth(req);
      if (caller.role === 'viewer') {
        res.status(403).json({
          error: 'Authorization denied: Viewer role cannot create shareable file bundles.',
        });
        return;
      }

      const ids: string[] = Array.isArray(req.body?.ids)
        ? req.body.ids.map((id: unknown) => String(id))
        : [];
      if (ids.length === 0) {
        res.status(400).json({ error: 'Select at least one file to bundle.' });
        return;
      }

      const selectedFiles: SharedFileRecord[] = [];
      for (const id of ids) {
        const found = filesStore.get(id);
        if (found) {
          selectedFiles.push(found);
        }
      }

      // Fallback if client provided file snapshots for any client-only items
      if (selectedFiles.length === 0 && Array.isArray(req.body?.files)) {
        for (const raw of req.body.files) {
          if (raw && raw.id && raw.name) {
            selectedFiles.push({
              id: String(raw.id),
              name: String(raw.name),
              size: Number(raw.size) || 0,
              mimeType: String(raw.mimeType || 'application/octet-stream'),
              category: String(raw.category || 'Documents'),
              uploadedAt: String(raw.uploadedAt || new Date().toISOString()),
              uploadDate: String(raw.uploadDate || new Date().toISOString().slice(0, 10)),
              senderName: String(raw.senderName || caller.name),
              senderDevice: String(raw.senderDevice || caller.device),
              roomCode: String(raw.roomCode || caller.room),
              downloads: Number(raw.downloads) || 0,
              pinProtected: Boolean(raw.pinProtected),
              encrypted: Boolean(raw.encrypted),
              encryptionAlgo: raw.encryptionAlgo,
              encryptionIv: raw.encryptionIv,
              encryptionSalt: raw.encryptionSalt,
              encryptionFingerprint: raw.encryptionFingerprint,
              encryptedPayload: raw.encryptedPayload,
              keyHint: raw.keyHint,
              textContent: raw.textContent,
              dataUrl: raw.dataUrl,
            });
          }
        }
      }

      if (selectedFiles.length === 0) {
        res.status(404).json({ error: 'None of the selected files were found in the vault.' });
        return;
      }

      const rawTtl = Number(req.body?.ttlMinutes);
      const ttlMinutes =
        !Number.isNaN(rawTtl) && rawTtl >= 1 && rawTtl <= 43200 ? Math.round(rawTtl) : 60;

      const bundleId =
        typeof req.body?.id === 'string' && /^bndl-[a-zA-Z0-9_-]{4,40}$/.test(req.body.id)
          ? req.body.id
          : `bndl-${crypto.randomBytes(5).toString('hex')}`;

      const nowMs = Date.now();
      const createdAt = new Date(nowMs).toISOString();
      const expiresAt = new Date(nowMs + ttlMinutes * 60 * 1000).toISOString();

      const rawArchiveName = String(
        req.body?.archiveName ||
          `relaydrop-bundle-${selectedFiles.length}-${
            selectedFiles.length === 1 ? 'file' : 'files'
          }-${bundleId.slice(5, 11)}.zip`
      ).trim();
      const archiveName = rawArchiveName.endsWith('.zip')
        ? rawArchiveName
        : `${rawArchiveName}.zip`;

      const originHeader = String(
        req.body?.origin ||
          req.headers.origin ||
          `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`
      ).replace(/\/+$/, '');

      const zipBuffer = await buildZipBufferForFiles(selectedFiles, {
        bundleId,
        archiveName,
        roomCode: caller.room,
        createdBy: caller.name,
        createdAt,
        expiresAt,
        ttlMinutes,
      });

      const totalBytes = selectedFiles.reduce((acc, f) => acc + (f.size || 0), 0);
      const shareUrl = `${originHeader}/?bundle=${encodeURIComponent(bundleId)}`;
      const downloadUrl = `${originHeader}/api/bundles/${encodeURIComponent(bundleId)}/download`;

      const bundleRecord: SharedBundleRecord = {
        id: bundleId,
        archiveName,
        roomCode: caller.room,
        createdBy: caller.name,
        ownerUid: caller.uid || 'anonymous-peer',
        createdByDevice: caller.device,
        createdAt,
        expiresAt,
        ttlMinutes,
        fileIds: selectedFiles.map((f) => f.id),
        fileNames: selectedFiles.map((f) => f.name),
        fileCount: selectedFiles.length,
        totalBytes,
        bundleZipBytes: zipBuffer.byteLength,
        downloads: 0,
        revoked: false,
        shareUrl,
        downloadUrl,
        zipBuffer,
      };

      bundlesStore.set(bundleId, bundleRecord);
      const clientBundle = sanitizeBundleForClient(bundleRecord);

      const previewNames =
        bundleRecord.fileNames.length <= 3
          ? bundleRecord.fileNames.map((n) => `"${n}"`).join(', ')
          : `${bundleRecord.fileNames
              .slice(0, 2)
              .map((n) => `"${n}"`)
              .join(', ')} + ${bundleRecord.fileNames.length - 2} more`;

      const ttlLabel =
        ttlMinutes >= 1440
          ? `${Math.round(ttlMinutes / 1440)}d`
          : ttlMinutes >= 60
          ? `${Math.round(ttlMinutes / 60)}h`
          : `${ttlMinutes}m`;

      const activity = appendActivityLog({
        action: 'download',
        fileId: selectedFiles[0].id,
        fileName: archiveName,
        fileSize: totalBytes,
        category: 'Archives & Code',
        actorName: caller.name,
        actorDevice: caller.device,
        actorRole: caller.role,
        roomCode: caller.room,
        details: `Created expiring share bundle (${ttlLabel} TTL) for ${
          selectedFiles.length
        } ${selectedFiles.length === 1 ? 'file' : 'files'} (${previewNames})`,
      });

      broadcast('bundle:created', { bundle: clientBundle, activity });
      broadcast('activity:created', activity);

      res.status(201).json({
        ok: true,
        bundle: clientBundle,
        activity,
      });
    } catch (err) {
      console.error('Error creating file bundle:', err);
      res.status(500).json({
        error: 'Failed to bundle selected files on the server.',
      });
    }
  };

  app.post('/api/bundles/create', handleCreateBundle);
  app.post('/api/bundles', handleCreateBundle);

  app.get('/api/bundles', (_req, res) => {
    res.json({
      bundles: Array.from(bundlesStore.values()).map(sanitizeBundleForClient),
    });
  });

  app.get('/api/bundles/:bundleId', (req, res) => {
    const { bundleId } = req.params;
    const bundle = bundlesStore.get(bundleId);
    if (!bundle) {
      res.status(404).json({ error: 'Share bundle not found on server.' });
      return;
    }
    const isExpired = new Date(bundle.expiresAt).getTime() <= Date.now();
    const includedFiles = bundle.fileIds
      .map((fid) => filesStore.get(fid))
      .filter((f): f is SharedFileRecord => Boolean(f))
      .map(sanitizeFileForClient);

    res.json({
      bundle: sanitizeBundleForClient(bundle),
      expired: isExpired,
      revoked: bundle.revoked,
      files: includedFiles,
    });
  });

  app.patch('/api/bundles/:bundleId', (req, res) => {
    const caller = getCallerAuth(req);
    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot modify shareable bundles.',
      });
      return;
    }

    const { bundleId } = req.params;
    const bundle = bundlesStore.get(bundleId);
    if (!bundle) {
      res.status(404).json({ error: 'Share bundle not found.' });
      return;
    }

    if (typeof req.body?.revoked === 'boolean') {
      bundle.revoked = req.body.revoked;
    }
    if (typeof req.body?.expiresAt === 'string' && req.body.expiresAt.trim()) {
      bundle.expiresAt = req.body.expiresAt.trim();
    }
    if (typeof req.body?.ttlMinutes === 'number' && req.body.ttlMinutes >= 1) {
      bundle.ttlMinutes = Math.round(req.body.ttlMinutes);
    }

    bundlesStore.set(bundleId, bundle);
    const clientBundle = sanitizeBundleForClient(bundle);
    broadcast('bundle:updated', { bundle: clientBundle });

    res.json({
      ok: true,
      bundle: clientBundle,
    });
  });

  app.get('/api/bundles/:bundleId/download', async (req, res) => {
    try {
      const { bundleId } = req.params;
      let bundle = bundlesStore.get(bundleId);

      // Rehydrate on the fly if server restarted and Firestore metadata query params are provided
      if (!bundle && typeof req.query.fileIds === 'string' && req.query.fileIds.trim()) {
        const queryIds = req.query.fileIds
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const queryExpiresAt = String(
          req.query.expiresAt || new Date(Date.now() + 3600000).toISOString()
        );
        const queryRevoked = req.query.revoked === 'true';
        if (queryRevoked) {
          res
            .status(410)
            .send('This temporary shareable bundle link has been revoked by its creator.');
          return;
        }
        if (new Date(queryExpiresAt).getTime() <= Date.now()) {
          res
            .status(410)
            .send(`This temporary shareable bundle link expired at ${queryExpiresAt}.`);
          return;
        }
        const matchedFiles = queryIds
          .map((id) => filesStore.get(id))
          .filter((f): f is SharedFileRecord => Boolean(f));
        if (matchedFiles.length > 0) {
          const archiveName = String(
            req.query.archiveName || `relaydrop-bundle-${bundleId}.zip`
          );
          const zipBuffer = await buildZipBufferForFiles(matchedFiles, {
            bundleId,
            archiveName,
            roomCode: matchedFiles[0].roomCode || '842-910',
            createdBy: String(req.query.createdBy || 'RelayDrop Peer'),
            createdAt: new Date().toISOString(),
            expiresAt: queryExpiresAt,
            ttlMinutes: 60,
          });
          const safeArchive = archiveName.replace(/[^a-zA-Z0-9._-]/g, '_');
          res.setHeader('Content-Disposition', `attachment; filename="${safeArchive}"`);
          res.setHeader('Content-Type', 'application/zip');
          res.send(zipBuffer);
          return;
        }
      }

      if (!bundle) {
        res.status(404).send('Share bundle not found or no longer available.');
        return;
      }

      if (bundle.revoked) {
        res
          .status(410)
          .send('This temporary shareable bundle link has been revoked by its creator.');
        return;
      }

      if (new Date(bundle.expiresAt).getTime() <= Date.now()) {
        res
          .status(410)
          .send(`This temporary shareable bundle link expired at ${bundle.expiresAt}.`);
        return;
      }

      bundle.downloads += 1;
      bundlesStore.set(bundleId, bundle);

      for (const fid of bundle.fileIds) {
        const target = filesStore.get(fid);
        if (target) {
          target.downloads = (target.downloads || 0) + 1;
          filesStore.set(fid, target);
          broadcast('file:updated', {
            file: sanitizeFileForClient(target),
            categories: Array.from(categoriesStore.values()),
          });
        }
      }

      const dlActivity = appendActivityLog({
        action: 'download',
        fileId: bundle.fileIds[0],
        fileName: bundle.archiveName,
        fileSize: bundle.totalBytes,
        category: 'Archives & Code',
        actorName: String(req.query.actor || 'Share Link Recipient'),
        actorDevice: 'Temporary Share Link',
        roomCode: bundle.roomCode,
        details: `Downloaded temporary bundle "${bundle.archiveName}" (${bundle.fileCount} files, Download #${bundle.downloads})`,
      });

      broadcast('bundle:updated', { bundle: sanitizeBundleForClient(bundle) });
      broadcast('activity:created', dlActivity);

      const safeArchive = bundle.archiveName.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Disposition', `attachment; filename="${safeArchive}"`);
      res.setHeader('Content-Type', 'application/zip');
      res.send(bundle.zipBuffer);
    } catch (err) {
      console.error('Error downloading bundle:', err);
      res.status(500).send('Failed to download bundle archive.');
    }
  });

  app.delete('/api/files/:id', (req, res) => {
    const caller = getCallerAuth(req);
    const { id } = req.params;
    const existing = filesStore.get(id);
    if (!existing) {
      res.json({ deleted: true, id });
      return;
    }

    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot delete files.',
      });
      return;
    }

    if (
      caller.role !== 'admin' &&
      existing.ownerUid &&
      caller.uid &&
      existing.ownerUid !== caller.uid
    ) {
      res.status(403).json({
        error: 'Authorization denied: Only the file owner or an Admin can delete this file.',
      });
      return;
    }

    filesStore.delete(id);
    const deleteActivity = appendActivityLog({
      action: 'delete',
      fileId: existing.id,
      fileName: existing.name,
      fileSize: existing.size,
      category: existing.category,
      actorName: caller.name,
      actorDevice: caller.device,
      actorRole: caller.role,
      roomCode: existing.roomCode || caller.room,
      details: `Deleted "${existing.name}" from ${existing.category}`,
    });
    broadcast('file:deleted', { id });
    broadcast('activity:created', deleteActivity);
    res.json({ deleted: true, id, activity: deleteActivity });
  });

  app.post('/api/files/:id/verify-pin', (req, res) => {
    const { id } = req.params;
    const file = filesStore.get(id);
    if (!file) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    if (!file.pinProtected) {
      res.json({ valid: true });
      return;
    }
    const submittedPin = String(req.body?.pin || '').trim();
    if (submittedPin === file.pinCode) {
      res.json({ valid: true });
    } else {
      res.status(403).json({ valid: false, error: 'Incorrect PIN code.' });
    }
  });

  app.get('/api/files/:id/download', (req, res) => {
    const { id } = req.params;
    const file = filesStore.get(id);
    if (!file) {
      res.status(404).send('File not found');
      return;
    }

    if (file.pinProtected) {
      const providedPin = String(req.query.pin || '').trim();
      if (providedPin !== file.pinCode) {
        res.status(403).send('Invalid PIN code for protected file');
        return;
      }
    }

    file.downloads += 1;
    filesStore.set(id, file);
    const dlActivity = appendActivityLog({
      action: 'download',
      fileId: file.id,
      fileName: file.name,
      fileSize: file.size,
      category: file.category,
      actorName: String(req.query.actor || 'Room Peer'),
      actorDevice: 'Room Client',
      roomCode: file.roomCode,
      details: `Downloaded "${file.name}" (Download #${file.downloads})`,
    });
    broadcast('file:updated', {
      file: sanitizeFileForClient(file),
      categories: Array.from(categoriesStore.values()),
    });
    broadcast('activity:created', dlActivity);

    const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');

    if (file.localAssetPath && fs.existsSync(file.localAssetPath)) {
      res.sendFile(file.localAssetPath);
      return;
    }

    if (file.dataUrl && file.dataUrl.startsWith('data:')) {
      const matches = file.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches && matches[2]) {
        const buffer = Buffer.from(matches[2], 'base64');
        res.send(buffer);
        return;
      }
    }

    if (typeof file.textContent === 'string') {
      res.send(Buffer.from(file.textContent, 'utf-8'));
      return;
    }

    if (file.encrypted && file.encryptedPayload) {
      const envelopeJson = JSON.stringify(
        {
          relaydropZeroKnowledgeEnvelope: '1.0',
          fileId: file.id,
          fileName: file.name,
          cipherSuite: file.encryptionAlgo || 'AES-256-GCM · PBKDF2-SHA256',
          ivBase64: file.encryptionIv,
          saltBase64: file.encryptionSalt,
          sha256CiphertextFingerprint: file.encryptionFingerprint,
          ciphertextBase64: file.encryptedPayload,
        },
        null,
        2
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFilename}.enc.json"`
      );
      res.setHeader('Content-Type', 'application/json');
      res.send(Buffer.from(envelopeJson, 'utf-8'));
      return;
    }

    res.send(Buffer.from(`RelayDrop File Payload: ${file.name}\nCategory: ${file.category}\nUploaded: ${file.uploadedAt}`, 'utf-8'));
  });

  const distPath = path.join(__dirname, 'dist');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    (!process.execArgv.some((arg) => arg.includes('tsx')) &&
      fs.existsSync(path.join(distPath, 'index.html')));

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: {
          server: httpServer,
          path: '/__vite_hmr',
        },
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`RelayDrop server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
