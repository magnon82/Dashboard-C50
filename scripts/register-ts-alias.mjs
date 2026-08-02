/**
 * Uso: node --import ./scripts/register-ts-alias.mjs --experimental-strip-types …
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const hooks = pathToFileURL(path.join(dir, 'ts-alias-hooks.mjs')).href;
register(hooks, pathToFileURL(path.join(dir, 'register-ts-alias.mjs')).href);
