import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { GitHub } from './github.js';
import { admit } from './requests.js';
import { prepare, publish, readJson } from './pipeline.js';
import { review } from './opencode.js';
import { exampleReport } from './preview.js';
import { consumerWorkflow } from './consumer.js';
import { evaluate, probe } from './evaluation.js';

async function output(key: string, value: string) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
async function main() {
  const [command, arg, extra] = process.argv.slice(2);
  const c = config(process.env.TOFAREV_CONFIG ? await readJson(process.env.TOFAREV_CONFIG) : {});
  const event = async () => readJson(process.env.GITHUB_EVENT_PATH!);
  const api = () => new GitHub(process.env.TOFAREV_GITHUB_TOKEN ?? '');
  switch (command) {
    case 'admit': {
      const accepted = !!admit(await event(), process.env.GITHUB_EVENT_NAME ?? '', c);
      await output('accepted', String(accepted)); console.log(JSON.stringify({ accepted })); break;
    }
    case 'prepare': {
      if (!arg) throw new Error('Preparation directory required');
      const p = await prepare(await event(), process.env.GITHUB_EVENT_NAME ?? '', c, api(), arg,
        `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
      await output('ready', String(!!p?.ready)); console.log(JSON.stringify({ ready: !!p?.ready })); break;
    }
    case 'review': {
      if (!arg) throw new Error('Source directory required');
      let result;
      try { result = await review(arg, c); }
      catch { result = { result: null, failed: true, notes: ['Reviewer initialization failed; check model access and TOFAREV_API_KEY.'] }; }
      console.log(JSON.stringify(result)); break;
    }
    case 'publish': {
      if (!arg) throw new Error('Preparation directory required');
      let result: unknown = null;
      try { if (extra) result = await readJson(extra, 2_000_000); } catch {}
      console.log(JSON.stringify(await publish(await readJson(path.join(arg, 'prepared.json')), result, c, api(), process.env.TOFAREV_REVIEW_STATUS))); break;
    }
    case 'preview': console.log(exampleReport(arg)); break;
    case 'consumer': process.stdout.write(consumerWorkflow(arg ?? '', extra ?? '')); break;
    case 'probe': console.log(JSON.stringify(await probe(), null, 2)); break;
    case 'evaluate': console.log(JSON.stringify(await evaluate(arg), null, 2)); break;
    default: throw new Error('Usage: tofarev admit|prepare DIR|review SOURCE|publish PREP RESULT|preview [MODE]|consumer OWNER/REPO SHA|probe|evaluate');
  }
}
main().catch(() => { console.error(process.argv[2] === 'probe' || process.argv[2] === 'evaluate' ? 'Live check failed: require TOFAREV_LIVE=1, TOFAREV_API_KEY, access to zai-org/GLM-5.3-Flash, tool calling and valid structured output.' : 'ToFaRev operation failed. Check configuration, credentials and workflow artifacts; no successful publication is claimed.'); process.exitCode = 1; });
