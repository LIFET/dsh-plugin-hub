export function createPreflightLimiter({
  clientLimit = 8,
  clientWindowMs = 60_000,
  githubLimit = 10,
  githubWindowMs = 60 * 60_000,
  maxClients = 2_000,
} = {}) {
  const clients = new Map();
  let githubBudget = { startedAt: 0, count: 0 };

  return {
    allowClient(client, now = Date.now()) {
      const current = clients.get(client);
      if (!current || now - current.startedAt >= clientWindowMs) {
        clients.set(client, { startedAt: now, count: 1 });
        if (clients.size > maxClients) {
          for (const [key, value] of clients) {
            if (now - value.startedAt >= clientWindowMs) clients.delete(key);
          }
          while (clients.size > maxClients) clients.delete(clients.keys().next().value || "");
        }
        return true;
      }
      current.count += 1;
      return current.count <= clientLimit;
    },

    reserveGithub(configured, now = Date.now()) {
      if (configured) return true;
      if (now - githubBudget.startedAt >= githubWindowMs) {
        githubBudget = { startedAt: now, count: 0 };
      }
      if (githubBudget.count >= githubLimit) return false;
      githubBudget.count += 1;
      return true;
    },
  };
}
