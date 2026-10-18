import { spawn } from 'node:child_process';

// Capture through the local API. No hosted sharing endpoint is required.
export async function startSession(executable: string, working: string, env: NodeJS.ProcessEnv,
  transport: typeof fetch = fetch, timeoutMs = 30_000) {
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
  const json = async (route: string, method = 'GET', body?: unknown): Promise<any> => {
    const response = await transport(`${endpoint}${route}`, { method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error('Session capture request failed');
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 16_777_216) throw new Error('Session capture response too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
  try {
    const session = await json('/session', 'POST', { title: 'ToFaRev review' });
    const sessionId: string = session.id;
    if (!/^ses_[a-zA-Z0-9]+$/.test(sessionId)) throw new Error('Invalid native session');
    const messages = () => json(`/session/${sessionId}/message`);
    return { endpoint, sessionId, close,
      snapshot: async () => ({ info: await json(`/session/${sessionId}`), messages: await messages() }),
      resultText: async (): Promise<string> => {
        const assistant = (await messages()).findLast((m: any) => m.info.role === 'assistant');
        return assistant?.parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') ?? '';
      },
    };
  } catch { await close(); }
}
