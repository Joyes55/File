/**
 * Client-Side Zero-Knowledge End-to-End Encryption (E2EE) Utility
 * Uses native Web Crypto API (window.crypto.subtle)
 * Cipher: AES-256-GCM (96-bit random IV, 128-bit authentication tag)
 * Key Derivation: PBKDF2-HMAC-SHA256 (100,000 iterations, 128-bit random salt)
 */

export interface EncryptedEnvelopePayload {
  textContent?: string;
  dataUrl?: string;
  originalMimeType: string;
  originalName: string;
  encryptedAt: string;
}

export interface EncryptionResult {
  encrypted: true;
  encryptionAlgo: string;
  encryptionIv: string;
  encryptionSalt: string;
  encryptionFingerprint: string;
  encryptedPayload: string;
}

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return window.btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '');
  const binary = window.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generates a high-entropy human-typeable passphrase for room file encryption.
 */
export function generateStrongPassphrase(roomCode = '842-910'): string {
  const randomBytes = new Uint8Array(6);
  window.crypto.getRandomValues(randomBytes);
  const hex = bytesToHex(randomBytes);
  const cleanRoom = roomCode.replace(/[^a-zA-Z0-9]/g, '');
  return `rd-${cleanRoom}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * Derives a 256-bit AES-GCM CryptoKey from a user passphrase and 16-byte salt using PBKDF2-SHA256.
 */
async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  usage: KeyUsage[]
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

/**
 * Computes a 16-character hex SHA-256 fingerprint of the ciphertext bytes for integrity verification.
 */
export async function computeCiphertextFingerprint(
  ciphertextBytes: Uint8Array
): Promise<string> {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    ciphertextBytes as unknown as BufferSource
  );
  return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

/**
 * Encrypts file payload (textContent and/or dataUrl) locally in the browser using AES-256-GCM.
 */
export async function encryptFilePayload(
  payload: {
    textContent?: string;
    dataUrl?: string;
    mimeType: string;
    name: string;
  },
  passphrase: string
): Promise<EncryptionResult> {
  const cleanPass = passphrase.trim();
  if (!cleanPass) {
    throw new Error('Encryption passphrase cannot be empty.');
  }

  const salt = new Uint8Array(SALT_BYTE_LENGTH);
  const iv = new Uint8Array(IV_BYTE_LENGTH);
  window.crypto.getRandomValues(salt);
  window.crypto.getRandomValues(iv);

  const key = await deriveAesGcmKey(cleanPass, salt, ['encrypt']);

  const envelope: EncryptedEnvelopePayload = {
    textContent: payload.textContent,
    dataUrl: payload.dataUrl,
    originalMimeType: payload.mimeType || 'application/octet-stream',
    originalName: payload.name,
    encryptedAt: new Date().toISOString(),
  };

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(envelope));

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as unknown as BufferSource,
    },
    key,
    plaintextBytes as unknown as BufferSource
  );

  const ciphertextBytes = new Uint8Array(encryptedBuffer);
  const fingerprint = await computeCiphertextFingerprint(ciphertextBytes);

  return {
    encrypted: true,
    encryptionAlgo: 'AES-256-GCM · PBKDF2-SHA256',
    encryptionIv: bytesToBase64(iv),
    encryptionSalt: bytesToBase64(salt),
    encryptionFingerprint: fingerprint,
    encryptedPayload: bytesToBase64(ciphertextBytes),
  };
}

/**
 * Decrypts an AES-256-GCM encrypted file payload locally in the browser.
 * Throws if the passphrase is incorrect (GCM authentication tag verification fails).
 */
export async function decryptFilePayload(
  encryptedData: {
    encryptedPayload: string;
    encryptionIv: string;
    encryptionSalt: string;
  },
  passphrase: string
): Promise<EncryptedEnvelopePayload> {
  const cleanPass = passphrase.trim();
  if (!cleanPass) {
    throw new Error('Please enter a decryption passphrase.');
  }

  const salt = base64ToBytes(encryptedData.encryptionSalt);
  const iv = base64ToBytes(encryptedData.encryptionIv);
  const ciphertextBytes = base64ToBytes(encryptedData.encryptedPayload);

  const key = await deriveAesGcmKey(cleanPass, salt, ['decrypt']);

  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
      },
      key,
      ciphertextBytes as unknown as BufferSource
    );

    const decoder = new TextDecoder('utf-8');
    const jsonStr = decoder.decode(new Uint8Array(decryptedBuffer));
    const parsed = JSON.parse(jsonStr) as EncryptedEnvelopePayload;
    return parsed;
  } catch {
    throw new Error(
      'AES-256-GCM authentication tag verification failed. Incorrect decryption passphrase.'
    );
  }
}

/**
 * Formats a downloadable JSON ciphertext inspection envelope for encrypted files.
 */
export function formatEncryptedEnvelopePreview(file: {
  id: string;
  name: string;
  encryptionAlgo?: string;
  encryptionIv?: string;
  encryptionSalt?: string;
  encryptionFingerprint?: string;
  encryptedPayload?: string;
}): string {
  return JSON.stringify(
    {
      relaydropZeroKnowledgeEnvelope: '1.0',
      fileId: file.id,
      fileName: file.name,
      cipherSuite: file.encryptionAlgo || 'AES-256-GCM · PBKDF2-SHA256',
      kdfIterations: PBKDF2_ITERATIONS,
      ivBase64: file.encryptionIv || '',
      saltBase64: file.encryptionSalt || '',
      sha256CiphertextFingerprint: file.encryptionFingerprint || '',
      ciphertextBase64: file.encryptedPayload
        ? file.encryptedPayload.length > 640
          ? `${file.encryptedPayload.slice(0, 640)}... [${file.encryptedPayload.length} base64 chars total]`
          : file.encryptedPayload
        : '',
    },
    null,
    2
  );
}

export const PERSISTENT_E2EE_STORAGE_KEY = 'relaydrop_persistent_e2ee_v1';

export interface PersistentE2eeConfig {
  enabled: boolean;
  passphrase: string;
  keyHint: string;
}

export function loadPersistentE2eeConfig(): PersistentE2eeConfig {
  const fallback: PersistentE2eeConfig = {
    enabled: false,
    passphrase: 'relaydrop-2026',
    keyHint: 'Demo passphrase: relaydrop-2026',
  };
  try {
    const raw = window.localStorage.getItem(PERSISTENT_E2EE_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return {
      enabled: Boolean(parsed?.enabled),
      passphrase:
        typeof parsed?.passphrase === 'string' && parsed.passphrase.trim()
          ? parsed.passphrase
          : fallback.passphrase,
      keyHint:
        typeof parsed?.keyHint === 'string' ? parsed.keyHint : fallback.keyHint,
    };
  } catch {
    return fallback;
  }
}

export function savePersistentE2eeConfig(config: PersistentE2eeConfig): void {
  try {
    window.localStorage.setItem(
      PERSISTENT_E2EE_STORAGE_KEY,
      JSON.stringify({
        enabled: Boolean(config.enabled),
        passphrase: config.passphrase || 'relaydrop-2026',
        keyHint: config.keyHint || '',
      })
    );
  } catch {
    // Ignore storage write errors in restricted browsing modes
  }
}

