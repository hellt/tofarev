import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { SessionUrl } from './types.js';

// Keep the native server alive so its share watchers upload each new message.
async function sessionServer(executable: string, working: string, env: NodeJS.ProcessEnv,
  transport: typeof fetch, timeoutMs: number) {
  const child = spawn(executable, ['serve', '--pure', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: working, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env,
  });
  const closed = new Promise<void>(resolve => { child.on('close', () => resolve()); child.on('error', () => resolve()); });
  const close = async () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} await closed; };
  child.stderr.on('data', () => {});
  const endpoint = await new Promise<string | undefined>(resolve => {
    let output = '';
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    const done = (value?: string) => { clearTimeout(timer); resolve(value); };
    child.stdout.on('data', (data: Buffer) => {
      output = (output + data.toString()).slice(-4096);
      const match = output.match(/opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) done(match[1]);
    });
    child.on('error', () => done()); child.on('close', () => done());
  });
  if (!endpoint) { await close(); return; }
  const json = async (url: string, method = 'GET', body?: unknown, signal = AbortSignal.timeout(timeoutMs)): Promise<any> => {
    const response = await transport(url, { method, redirect: 'error', signal,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('Session share request failed');
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16_777_216) throw new Error('Session share response too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  const waitForSync = async (sessionId: string, url: string): Promise<string | undefined> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const messages = await json(`${endpoint}/session/${sessionId}/message`, 'GET', undefined, controller.signal);
      const parts = (messages as any[]).flatMap(m => m.parts);
      const shareId = new URL(url).pathname.split('/').pop()!;
      while (!controller.signal.aborted) {
        try {
          const data = await json(`https://opncd.ai/api/share/${shareId}/data`, 'GET', undefined, controller.signal);
          const uploaded = new Map<string, unknown>((data as any[]).filter(d => d.type === 'part').map(d => [d.data.id, d.data]));
          if (data.some((d: any) => d.type === 'session' && d.data.id === sessionId) && parts.every(p => isDeepStrictEqual(p, uploaded.get(p.id)))) return url;
        } catch { if (controller.signal.aborted) break; }
        await new Promise<void>(resolve => {
          const delay = setTimeout(done, 500);
          function done() { clearTimeout(delay); controller.signal.removeEventListener('abort', done); resolve(); }
          controller.signal.addEventListener('abort', done, { once: true });
        });
      }
    } catch { /* Preserve findings during a sharing outage. */ }
    finally { clearTimeout(timer); controller.abort(); }
  };
  const share = async (sessionId: string) => {
    const session = await json(`${endpoint}/session/${sessionId}/share`, 'POST');
    return SessionUrl.parse(session.share?.url);
  };
  return { endpoint, json, share, waitForSync, close };
}

// Create and share before the first model call. Sharing stays outside agent tools.
export async function startSharedSession(executable: string, working: string, env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch, timeoutMs = 30_000) {
  const server = await sessionServer(executable, working, env, transport, timeoutMs);
  if (!server) return;
  try {
    const session = await server.json(`${server.endpoint}/session`, 'POST', { title: 'ToFaRev Containerlab review' });
    const sessionId: string = session.id;
    if (!/^ses_[a-zA-Z0-9]+$/.test(sessionId)) throw new Error('Invalid native session');
    let url: string | undefined;
    try { url = await server.share(sessionId); await server.waitForSync(sessionId, url); }
    catch { /* Continue the review if the hosted service is unavailable. */ }
    return { endpoint: server.endpoint, sessionId, url, close: server.close,
      resultText: async (): Promise<string> => {
        const messages = await server.json(`${server.endpoint}/session/${sessionId}/message`);
        const assistant = messages.findLast((m: any) => m.info.role === 'assistant');
        return assistant?.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') ?? '';
      },
      renderResult: async (text: string) => {
        const messages = await server.json(`${server.endpoint}/session/${sessionId}/message`);
        const assistant = messages.findLast((m: any) => m.info.role === 'assistant');
        const part = assistant?.parts.find((p: any) => p.type === 'text');
        if (!part) throw new Error('Final review text unavailable');
        await server.json(`${server.endpoint}/session/${sessionId}/message/${assistant.info.id}/part/${part.id}`, 'PATCH', { ...part, text });
      },
      waitForSync: async () => url ? server.waitForSync(sessionId, url) : undefined };
  } catch { await server.close(); }
}

export async function shareSession(executable: string, working: string, env: NodeJS.ProcessEnv,
  sessionId: string, transport: typeof fetch = fetch, timeoutMs = 30_000): Promise<{ url: string; synced: boolean } | undefined> {
  if (!/^ses_[a-zA-Z0-9]+$/.test(sessionId)) return;
  const server = await sessionServer(executable, working, env, transport, timeoutMs);
  if (!server) return;
  try {
    const url = await server.share(sessionId);
    return { url, synced: Boolean(await server.waitForSync(sessionId, url)) };
  }
  catch { /* A share outage must not discard valid findings. */ }
  finally { await server.close(); }
}
