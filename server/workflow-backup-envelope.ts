import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdtemp, open, rmdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { types } from 'node:util';
import { verifyOfflineSnapshotAgainstFence } from './workflow-backup';

const HEADER = 28, TAG = 16, MAX_ARCHIVE = 48_000_000, MAX_REFERENCE = 4096;
const MAX_ENVELOPE = HEADER + MAX_REFERENCE + MAX_ARCHIVE + TAG;
const MAGIC = Buffer.from('FDSBENC\0');
const refused = (): never => { throw new Error('encrypted offline backup refused'); };
type Fence = () => Promise<Buffer>;
type Report = Awaited<ReturnType<typeof verifyOfflineSnapshotAgainstFence>>;

// The caller must own an immutable trusted namespace. These checks are not an openat-style race defense.
async function privateScratch(path: string) {
  if (typeof path !== 'string' || !path.startsWith('/') || /[\\\x00-\x1f\x7f]/.test(path)) refused();
  const parts = path.slice(1).split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) refused();
  for (let i = 0; i <= parts.length; i++) {
    const current = i ? '/' + parts.slice(0, i).join('/') : '/';
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) refused();
    if (i === parts.length && (info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o700)) refused();
  }
}
async function validateArchive(bytes: Buffer, scratchDirectory: string, readTrustedFence: Fence, expected?: Buffer) {
  await privateScratch(scratchDirectory);
  const directory = await mkdtemp(join(scratchDirectory, 'offline-envelope-'));
  const path = join(directory, 'archive.json');
  let created = false;
  try {
    await privateScratch(directory);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o7777) !== 0o600) refused();
      await file.writeFile(bytes);
    } finally { await file.close(); }
    let reference: Buffer | undefined;
    const report = await verifyOfflineSnapshotAgainstFence(path, async () => {
      const value = copyBytes(await readTrustedFence(), 1, MAX_REFERENCE);
      if (expected && !value.equals(expected)) refused();
      reference ??= value;
      return value;
    });
    return { reference: reference ?? refused(), report };
  } finally {
    try { if (created) await unlink(path); } finally { await rmdir(directory); }
  }
}

/** Offline only: encryption is not restore authority. Keys are supplied by the trusted caller. */
export async function encryptOfflineBackup(bytes: Buffer, key: Buffer, scratchDirectory: string, readTrustedFence: Fence): Promise<Buffer> {
  let ownedKey: Buffer | undefined, plaintext: Buffer | undefined;
  try {
    ownedKey = copyBytes(key, 32, 32); plaintext = copyBytes(bytes, 1, MAX_ARCHIVE);
    const { reference } = await validateArchive(plaintext, scratchDirectory, readTrustedFence);
    const header = Buffer.alloc(HEADER);
    MAGIC.copy(header); header[8] = 1; header[9] = 1;
    header.writeUInt16BE(reference.length, 10); header.writeUInt32BE(plaintext.length, 12);
    randomBytes(12).copy(header, 16);
    const cipher = createCipheriv('aes-256-gcm', ownedKey, header.subarray(16), { authTagLength: TAG });
    cipher.setAAD(Buffer.concat([header, reference]));
    return Buffer.concat([header, reference, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  } catch { return refused(); }
  finally { ownedKey?.fill(0); plaintext?.fill(0); }
}

/** Returns serialized archive bytes only; never extracts a runtime tree or authorizes startup. */
export async function decryptOfflineBackup(bytes: Buffer, key: Buffer, scratchDirectory: string, readTrustedFence: Fence): Promise<{ bytes: Buffer; report: Report }> {
  let ownedKey: Buffer | undefined, input: Buffer | undefined, provisional: Buffer | undefined, plaintext: Buffer | undefined;
  let returned = false;
  try {
    ownedKey = copyBytes(key, 32, 32); input = copyBytes(bytes, HEADER + TAG, MAX_ENVELOPE);
    if (!input.subarray(0, MAGIC.length).equals(MAGIC) || input[8] !== 1 || input[9] !== 1) refused();
    const metadataLength = input.readUInt16BE(10), length = input.readUInt32BE(12);
    if (!metadataLength || metadataLength > MAX_REFERENCE || !length || length > MAX_ARCHIVE || input.length !== HEADER + metadataLength + length + TAG) refused();
    const aad = input.subarray(0, HEADER + metadataLength), reference = input.subarray(HEADER, HEADER + metadataLength);
    const decipher = createDecipheriv('aes-256-gcm', ownedKey, input.subarray(16, HEADER), { authTagLength: TAG });
    decipher.setAAD(aad); decipher.setAuthTag(input.subarray(-TAG));
    provisional = decipher.update(input.subarray(aad.length, aad.length + length));
    plaintext = Buffer.concat([provisional, decipher.final()]);
    const { report } = await validateArchive(plaintext, scratchDirectory, readTrustedFence, reference);
    returned = true;
    return { bytes: plaintext, report };
  } catch { return refused(); }
  finally { ownedKey?.fill(0); input?.fill(0); provisional?.fill(0); if (!returned) plaintext?.fill(0); }
}
function copyBytes(value: Buffer, min: number, max: number): Buffer {
  if (!Buffer.isBuffer(value) || value.length < min || value.length > max || types.isSharedArrayBuffer(value.buffer)) return refused();
  return Buffer.from(value);
}
