/**
 * Direct-to-R2 upload: content hashing, single PUT, and multipart with parallel parts.
 *
 * The bytes never touch our API — it only signs URLs. This file is the client half of
 * that contract, and exists because a single presigned PUT cannot carry a multi-GB
 * dashcam file safely: there is no resume, no parallelism, and one dropped connection
 * near the end costs the entire transfer.
 *
 * Three paths, chosen per file by the server's response to `POST /uploads`:
 *   * `deduplicated` → we already hold these exact bytes. Upload nothing.
 *   * `uploadUrl`    → small enough for one PUT (the pre-existing path, unchanged).
 *   * `multipart`    → split into parts, PUT them in parallel, then ask the API to
 *                      assemble them.
 */
import { api, putToPresigned } from '../api/client';
import type { UploadTarget } from '../api/types';

/** How many parts to transfer at once. */
const PART_CONCURRENCY = 3;
/** Attempts per part before giving up on the whole file. */
const PART_MAX_ATTEMPTS = 3;
/**
 * Parts are signed in batches. Every URL in a batch shares the same 15-minute expiry,
 * so signing all ~80 parts of a 5 GB file up front would leave the later ones dead
 * before a slow connection reached them.
 */
const SIGN_BATCH = 10;

export interface UploadProgress {
  /** 0-100 for this file. */
  pct: number;
  bytesSent: number;
  bytesTotal: number;
  /** Parts finished / total, for multipart only. */
  partsDone?: number;
  partsTotal?: number;
}

/**
 * SHA-256 of a File, computed in the browser.
 *
 * Read in chunks and fed through an incremental digest so a 5 GB file is never held in
 * memory. `crypto.subtle.digest` has no streaming API, so the chunks are accumulated
 * into one buffer only when the file is small enough to make that safe; above that we
 * fall back to a pure-JS incremental implementation.
 *
 * Hashing costs a full read of the file before the upload starts (~seconds for a few GB
 * from a local disk). That is worth paying: it's what lets the server say "we already
 * have this" and skip the transfer entirely, which is a far larger saving than the read.
 */
export async function sha256File(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const CHUNK = 8 * 1024 * 1024;

  // Fast path: WebCrypto in one shot, for files small enough to buffer safely.
  if (file.size <= 64 * 1024 * 1024) {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    onProgress?.(100);
    return hex(new Uint8Array(digest));
  }

  const hasher = new Sha256();
  let read = 0;
  for (let offset = 0; offset < file.size; offset += CHUNK) {
    const slice = file.slice(offset, Math.min(offset + CHUNK, file.size));
    hasher.update(new Uint8Array(await slice.arrayBuffer()));
    read += slice.size;
    onProgress?.(Math.round((read / file.size) * 100));
  }
  return hasher.hex();
}

/**
 * Upload one declared file according to the target the server returned.
 *
 * Returns the number of bytes actually transferred, so the caller can report how much a
 * deduplicated upload saved (which is zero bytes moved, the whole point).
 */
export async function uploadFileForTarget(
  uploadId: string,
  target: UploadTarget,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<{ bytesTransferred: number; deduplicated: boolean }> {
  if (target.deduplicated) {
    // Identical bytes already exist server-side. Nothing to send.
    onProgress?.({ pct: 100, bytesSent: 0, bytesTotal: file.size });
    return { bytesTransferred: 0, deduplicated: true };
  }

  if (target.multipart) {
    await uploadMultipart(uploadId, target, file, onProgress);
    return { bytesTransferred: file.size, deduplicated: false };
  }

  if (!target.uploadUrl) throw new Error(`No upload URL for ${file.name}`);
  await putToPresigned(target.uploadUrl, file, (pct) =>
    onProgress?.({ pct, bytesSent: Math.round((pct / 100) * file.size), bytesTotal: file.size }),
  );
  return { bytesTransferred: file.size, deduplicated: false };
}

/**
 * Multipart transfer: sign a batch, PUT its parts in parallel, repeat, then assemble.
 *
 * Concurrency is capped at 3 rather than uploading everything at once. Beyond a handful
 * of parallel streams a domestic upstream link is already saturated, and the extra
 * sockets only add retry noise and memory pressure from buffered slices.
 */
async function uploadMultipart(
  uploadId: string,
  target: UploadTarget,
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<void> {
  const { partSizeBytes, partsTotal } = target.multipart!;
  const completed: Array<{ partNumber: number; etag: string }> = [];
  // Per-part byte counters, so progress reflects concurrent transfers accurately rather
  // than jumping only as whole parts land.
  const sentPerPart = new Map<number, number>();

  const report = () => {
    const bytesSent = [...sentPerPart.values()].reduce((a, b) => a + b, 0);
    onProgress?.({
      pct: Math.min(99, Math.round((bytesSent / file.size) * 100)),
      bytesSent,
      bytesTotal: file.size,
      partsDone: completed.length,
      partsTotal,
    });
  };

  for (let first = 1; first <= partsTotal; first += SIGN_BATCH) {
    const numbers: number[] = [];
    for (let n = first; n < first + SIGN_BATCH && n <= partsTotal; n++) numbers.push(n);

    const signed = await api.signUploadParts(uploadId, target.fileId, numbers);

    // Simple worker pool over this batch.
    let cursor = 0;
    const workers = Array.from({ length: Math.min(PART_CONCURRENCY, signed.parts.length) }, () =>
      (async () => {
        while (cursor < signed.parts.length) {
          const part = signed.parts[cursor++];
          const start = (part.partNumber - 1) * partSizeBytes;
          const blob = file.slice(start, Math.min(start + partSizeBytes, file.size));
          const etag = await putPartWithRetry(part.uploadUrl, blob, (sent) => {
            sentPerPart.set(part.partNumber, sent);
            report();
          });
          sentPerPart.set(part.partNumber, blob.size);
          completed.push({ partNumber: part.partNumber, etag });
          report();
        }
      })(),
    );
    await Promise.all(workers);
  }

  await api.completeUploadParts(uploadId, target.fileId, completed);
  onProgress?.({
    pct: 100,
    bytesSent: file.size,
    bytesTotal: file.size,
    partsDone: completed.length,
    partsTotal,
  });
}

/**
 * PUT one part and return its ETag, retrying transient failures.
 *
 * The ETag is required: R2 verifies every part's ETag when assembling, so a missing one
 * fails the whole object. Retries use backoff because the common cause is a saturated
 * link or a brief network drop — retrying instantly just fails again.
 */
async function putPartWithRetry(
  url: string,
  blob: Blob,
  onBytes?: (sent: number) => void,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= PART_MAX_ATTEMPTS; attempt++) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onBytes?.(e.loaded);
        };
        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(`Part upload failed (HTTP ${xhr.status})`));
            return;
          }
          const etag = xhr.getResponseHeader('ETag') ?? xhr.getResponseHeader('etag');
          if (!etag) {
            // Usually a CORS configuration that doesn't expose ETag — worth saying so
            // explicitly, because the upload itself succeeded and the cause is elsewhere.
            reject(
              new Error(
                'Storage did not return an ETag for this part. ' +
                  'Check the bucket CORS policy exposes the ETag header.',
              ),
            );
            return;
          }
          resolve(etag.replace(/"/g, ''));
        };
        xhr.onerror = () => reject(new Error('Part upload network error'));
        xhr.send(blob);
      });
    } catch (e) {
      lastError = e as Error;
      onBytes?.(0); // this attempt's bytes didn't land; don't leave them counted
      if (attempt < PART_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastError ?? new Error('Part upload failed');
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Minimal incremental SHA-256 (FIPS 180-4).
 *
 * Needed because `crypto.subtle.digest` is one-shot: it cannot hash a file larger than
 * memory. This streams 8 MB at a time instead, which is what makes hashing a 5 GB file
 * in a browser tab possible at all. Small files still use WebCrypto, which is far faster.
 */
class Sha256 {
  private static readonly K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ]);

  private h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  private buffer = new Uint8Array(64);
  private bufferLen = 0;
  private totalLen = 0;
  private readonly w = new Uint32Array(64);

  update(data: Uint8Array): void {
    this.totalLen += data.length;
    let offset = 0;

    if (this.bufferLen > 0) {
      const need = 64 - this.bufferLen;
      const take = Math.min(need, data.length);
      this.buffer.set(data.subarray(0, take), this.bufferLen);
      this.bufferLen += take;
      offset = take;
      if (this.bufferLen === 64) {
        this.block(this.buffer, 0);
        this.bufferLen = 0;
      }
    }

    for (; offset + 64 <= data.length; offset += 64) this.block(data, offset);

    if (offset < data.length) {
      this.buffer.set(data.subarray(offset), 0);
      this.bufferLen = data.length - offset;
    }
  }

  hex(): string {
    // Pad: 0x80, zeros, then the message length in bits as a 64-bit big-endian value.
    const bitLen = this.totalLen * 8;
    const padLen = this.bufferLen < 56 ? 56 - this.bufferLen : 120 - this.bufferLen;
    const tail = new Uint8Array(padLen + 8);
    tail[0] = 0x80;
    const view = new DataView(tail.buffer);
    // Split across two 32-bit writes: bit lengths beyond 2^32 exceed what a single
    // 32-bit write can express, and a 5 GB file is 4×10^10 bits.
    view.setUint32(padLen, Math.floor(bitLen / 0x100000000));
    view.setUint32(padLen + 4, bitLen >>> 0);

    const saved = this.totalLen;
    this.update(tail);
    this.totalLen = saved;

    return [...this.h].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  private block(data: Uint8Array, offset: number): void {
    const { w } = this;
    const h = this.h;

    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + Sha256.K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;

      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
