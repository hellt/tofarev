// Child process for PDF fetching and parsing. Its environment holds only PATH
// (see workerEnv), so a malicious PDF that compromises pdf.js finds no keys.
// Input on stdin: {"requests":[{"url","maxChars"}],"allowLoopback":false}.
// Output on stdout: a JSON array of results, nothing else.
import { readPdfs, type SourceRequest } from './pdf.js';

console.log = console.info = console.warn = console.debug = () => {};
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { requests: SourceRequest[]; allowLoopback?: boolean };
process.stdout.write(JSON.stringify(await readPdfs(input.requests, input.allowLoopback === true)));
