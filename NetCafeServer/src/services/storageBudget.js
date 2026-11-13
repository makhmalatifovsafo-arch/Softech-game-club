import fs from 'node:fs';

export const STORAGE_RESERVE_BYTES = 256 * 1024 * 1024;
export const MAX_UPDATE_BYTES = 1024 * 1024 * 1024;

// Only optional copies/downloads use this guard. Existing financial records
// are never deleted to create space. Disk-full writes must still be handled.
export function requireStorageSpace(directory, bytes, statfs = fs.statfsSync) {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid storage estimate');
  const disk = statfs(directory, { bigint: true });
  const available = BigInt(disk.bavail) * BigInt(disk.bsize);
  if (available < BigInt(bytes) + BigInt(STORAGE_RESERVE_BYTES))
    throw Object.assign(new Error("Diskda bo'sh joy yetarli emas. Zaxira yoki yangilanish kechiktirildi."), { code: 'ENOSPC' });
}
