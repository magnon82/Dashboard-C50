/**
 * Custom resolve hooks for `@/*` and extensionless relative .ts imports.
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function resolveFile(base) {
  const candidates = [
    base,
    base + '.ts',
    base + '.tsx',
    base + '.mjs',
    base + '.js',
    path.join(base, 'index.ts'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return pathToFileURL(c).href;
  }
  return null;
}

function fileUrlToFsPath(url) {
  const u = new URL(url);
  let p = decodeURIComponent(u.pathname);
  if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(p)) {
    p = p.slice(1);
  }
  return p;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const target = path.join(root, specifier.slice(2));
    const href = resolveFile(target);
    if (href) return { shortCircuit: true, url: href };
  }

  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL
  ) {
    try {
      return await nextResolve(specifier, context);
    } catch (e) {
      const parentFs = fileUrlToFsPath(context.parentURL);
      const abs = path.resolve(path.dirname(parentFs), specifier);
      const href = resolveFile(abs);
      if (href) return { shortCircuit: true, url: href };
      throw e;
    }
  }

  return nextResolve(specifier, context);
}
