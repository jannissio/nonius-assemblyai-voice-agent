// A guaranteed keyless mode: do not load .env or inherit provider credentials.
import {createApplication} from '../server.mjs';
import {configuration} from '../lib/config.mjs';
const config=configuration({HOST:process.env.HOST||'127.0.0.1',PORT:process.env.PORT||'4317',
  NONIUS_ALLOWED_HOSTS:process.env.NONIUS_ALLOWED_HOSTS,
  NONIUS_MAX_AUDIO_SECONDS:'0',NONIUS_MAX_LLM_CALLS:'0',NONIUS_BUDGET_USD:'0',
  NONIUS_BUDGET_PATH:'runtime/sample-budget.json'});
const {server}=createApplication({config});server.listen(config.port,config.host,()=>console.log(`Nonius sample at http://${config.host}:${config.port} (no API key loaded)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
