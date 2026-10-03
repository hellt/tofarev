import { setTimeout as delay } from 'node:timers/promises';

export class GitHubError extends Error {
  constructor(public status: number) { super(`GitHub API request failed (HTTP ${status || 'network error'})`); }
}
export type Comment = { id: number; body: string; user: { login: string; type: string }; issue_url?: string };
export type Pull = { state: string; head: { sha: string }; base: { sha: string } };
export class GitHub {
  constructor(private token: string, private transport: typeof fetch = fetch,
    private sleep: (ms: number) => Promise<unknown> = delay) {
    if (!token) throw new Error('GitHub installation token is required');
  }
  async request<T>(method: string, path: string, body?: unknown, retries = 3): Promise<T> {
    if (!path.startsWith('/repos/') && !path.startsWith('/users/')) throw new Error('Invalid GitHub API path');
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.transport(`https://api.github.com${path}`, {
          method, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch { if (attempt >= retries) throw new GitHubError(0); await this.sleep(250 * 2 ** attempt); continue; }
      if (response.ok) return await response.json() as T;
      const transient = response.status === 429 || response.status >= 500 ||
        (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      if (!transient || attempt >= retries) throw new GitHubError(response.status);
      await this.sleep(Math.min(10_000, Math.max(250 * 2 ** attempt, Number(response.headers.get('retry-after') || 0) * 1000)));
    }
  }
  async comments(repo: string, pr: number): Promise<Comment[]> {
    const out: Comment[] = [];
    for (let page = 1; ; page++) {
      const batch = await this.request<Comment[]>('GET', `/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`);
      out.push(...batch); if (batch.length < 100) return out;
    }
  }
  pull(repo: string, pr: number) { return this.request<Pull>('GET', `/repos/${repo}/pulls/${pr}`); }
  comment(repo: string, id: number) { return this.request<Comment>('GET', `/repos/${repo}/issues/comments/${id}`); }
  update(repo: string, id: number, body: string) { return this.request<Comment>('PATCH', `/repos/${repo}/issues/comments/${id}`, { body }); }
  create(repo: string, pr: number, body: string) { return this.request<Comment>('POST', `/repos/${repo}/issues/${pr}/comments`, { body }, 0); }
}
