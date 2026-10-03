import { spawn } from 'node:child_process';
import { SessionUrl } from './types.js';

// Sharing is an explicit runner operation, outside the agent's tool permissions.
// The native server reads the same isolated session store as the completed CLI.
export async function shareSession(executable: string, working: string, env: NodeJS.ProcessEnv,
  sessionId: string, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<string | undefined> {
  if (!/^ses_[a-zA-Z0-9]+$/.test(sessionId)) return;
  const controller = new AbortController();
  const child = spawn(executable, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: working, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  const closed = new Promise<void>(resolve => { child.on('close', () => resolve()); child.on('error', () => resolve()); });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  child.stderr.on('data', () => {});
  try {
    const endpoint = await new Promise<string | undefined>(resolve => {
      let output = '';
      child.stdout.on('data', (data: Buffer) => {
        output = (output + data.toString()).slice(-4096);
        const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) resolve(match[1]);
      });
      child.on('error', () => resolve(undefined)); child.on('close', () => resolve(undefined));
      controller.signal.addEventListener('abort', () => resolve(undefined), { once: true });
    });
    if (!endpoint) return;
    const json = async (url: string, method = 'GET'): Promise<any> => {
      const response = await transport(url, { method, redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error('Session share request failed');
      const chunks: Uint8Array[] = []; let bytes = 0;
      if (response.body) for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 16_777_216) throw new Error('Session share response too large');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };
    const messages = await json(`${endpoint}/session/${sessionId}/message`);
    const partIds = new Set<string>((messages as any[]).flatMap(m => m.parts.map((p: any) => p.id)));
    const session = await json(`${endpoint}/session/${sessionId}/share`, 'POST');
    const url = SessionUrl.parse(session.share?.url);
    const shareId = new URL(url).pathname.split('/').pop()!;
    // Native sync is asynchronous. Do not publish a link until every recorded
    // part, including the final review result, is visible on the public backend.
    while (!controller.signal.aborted) {
      try {
        const data = await json(`https://opncd.ai/api/share/${shareId}/data`);
        const uploaded = new Set<string>((data as any[]).filter(d => d.type === 'part').map(d => d.data.id));
        if (data.some((d: any) => d.type === 'session' && d.data.id === sessionId) && [...partIds].every(id => uploaded.has(id))) return url;
      } catch { if (controller.signal.aborted) break; }
      await new Promise<void>(resolve => {
        const delay = setTimeout(done, 500);
        function done() { clearTimeout(delay); controller.signal.removeEventListener('abort', done); resolve(); }
        controller.signal.addEventListener('abort', done, { once: true });
      });
    }
  } catch { /* A share outage must not discard valid findings. */ }
  finally {
    clearTimeout(timer); controller.abort();
    try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
    await closed;
  }
}
