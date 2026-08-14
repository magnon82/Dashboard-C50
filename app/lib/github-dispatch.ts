/**
 * Token para workflow_dispatch desde la Suite (admin).
 * Preferir GH_WORKFLOW_DISPATCH_TOKEN (PAT fine-grained o classic con actions:write).
 * GITHUB_TOKEN también se acepta si existe (local / .env.local).
 * En Vercel no hay GITHUB_TOKEN automático: hay que setear el secret.
 */

export function getGithubDispatchToken(): string | null {
  const t =
    process.env.GH_WORKFLOW_DISPATCH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    '';
  return t || null;
}

export const GITHUB_ACTIONS_HUB_URL =
  'https://github.com/magnon82/Dashboard-C50/actions';
