import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
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

const filesStore: Map<string, SharedFileRecord> = new Map();
const categoriesStore: Set<string> = new Set(initialCategories);
const peersStore: Map<string, ConnectedPeer> = new Map();

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

  for (const item of initialFiles) {
    filesStore.set(item.id, item);
  }
}

seedInitialFiles();

function sanitizeFileForClient(file: SharedFileRecord): Omit<SharedFileRecord, 'pinCode' | 'localAssetPath'> {
  const { pinCode, localAssetPath, ...rest } = file;
  return rest;
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
    const role = String(req.headers['x-user-role'] || req.body?.userRole || 'editor')
      .trim()
      .toLowerCase();
    return {
      uid,
      email,
      role: role === 'admin' || role === 'viewer' ? role : 'editor',
    };
  }

  // REST API Endpoints
  app.get('/api/state', (_req, res) => {
    res.json({
      files: Array.from(filesStore.values()).map(sanitizeFileForClient),
      categories: Array.from(categoriesStore.values()),
      peers: Array.from(peersStore.values()),
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
    categoriesStore.add(rawName);
    const allCategories = Array.from(categoriesStore.values());
    broadcast('categories:updated', allCategories);
    res.status(201).json({ categories: allCategories, added: rawName });
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

    const category = String(body.category || 'Documents').trim() || 'Documents';
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
      notes: body.notes ? String(body.notes).trim() : undefined,
      previewUrl: body.previewUrl || undefined,
      textContent: body.textContent || undefined,
      dataUrl: body.dataUrl || undefined,
    };

    filesStore.set(id, newFile);
    const clientFile = sanitizeFileForClient(newFile);

    broadcast('file:created', {
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
    });

    res.status(201).json({
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
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

    if (caller.role === 'viewer') {
      res.status(403).json({
        error: 'Authorization denied: Viewer role cannot modify file metadata or categories.',
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
        error: 'Authorization denied: Only the file owner or an Admin can edit this file.',
      });
      return;
    }

    const updates = req.body || {};
    if (typeof updates.category === 'string' && updates.category.trim()) {
      existing.category = updates.category.trim();
      categoriesStore.add(existing.category);
    }
    if (typeof updates.name === 'string' && updates.name.trim()) {
      existing.name = updates.name.trim();
    }
    if (typeof updates.notes === 'string') {
      existing.notes = updates.notes.trim();
    }
    if (typeof updates.uploadDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updates.uploadDate)) {
      existing.uploadDate = updates.uploadDate;
      existing.uploadedAt = `${updates.uploadDate}T12:00:00.000Z`;
    }

    filesStore.set(id, existing);
    const clientFile = sanitizeFileForClient(existing);
    broadcast('file:updated', {
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
    });

    res.json({
      file: clientFile,
      categories: Array.from(categoriesStore.values()),
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
        }
      }
    }
    if (deletedIds.length > 0) {
      broadcast('files:bulk-deleted', { ids: deletedIds });
    }
    res.json({ deleted: true, ids: deletedIds, count: deletedIds.length });
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
    broadcast('file:deleted', { id });
    res.json({ deleted: true, id });
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
    broadcast('file:updated', {
      file: sanitizeFileForClient(file),
      categories: Array.from(categoriesStore.values()),
    });

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
