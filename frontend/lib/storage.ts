import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { createHash } from 'crypto';

const STORAGE_ROOT = process.env.STORAGE_ROOT || '/data';

export async function ensureDir(dirPath: string): Promise<void> {
  const fullPath = path.join(STORAGE_ROOT, dirPath);
  await fs.mkdir(fullPath, { recursive: true });
}

export async function storeFile(relativePath: string, content: Buffer | string): Promise<string> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
  await fs.writeFile(fullPath, buffer);
  return createHash('sha256').update(buffer).digest('hex');
}

export async function readStoredFile(relativePath: string): Promise<Buffer | null> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  try {
    return await fs.readFile(fullPath);
  } catch {
    return null;
  }
}

export async function listDirectory(relativePath: string): Promise<string[]> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  try {
    return await fs.readdir(fullPath);
  } catch {
    return [];
  }
}

export async function deleteFile(relativePath: string): Promise<boolean> {
  const fullPath = path.join(STORAGE_ROOT, relativePath);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch {
    return false;
  }
}

export function fileExists(relativePath: string): boolean {
  return existsSync(path.join(STORAGE_ROOT, relativePath));
}

export async function provisionTenantStorage(slug: string): Promise<void> {
  const dirs = [
    `customers/${slug}`,
    `customers/${slug}/uploads`,
    `customers/${slug}/proposals`,
    `customers/${slug}/library`,
  ];
  for (const dir of dirs) {
    await ensureDir(dir);
  }
}
