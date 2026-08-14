export interface PreflightLimiter {
  allowClient(client: string, now?: number): boolean;
  reserveGithub(configured: boolean, now?: number): boolean;
}

export function createPreflightLimiter(options?: {
  clientLimit?: number;
  clientWindowMs?: number;
  githubLimit?: number;
  githubWindowMs?: number;
  maxClients?: number;
}): PreflightLimiter;
