import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {configuration} from '../lib/config.mjs';
import {createApplication} from '../server.mjs';
import {PostgresBudget} from '../lib/postgres-budget.mjs';

export function hostedConfiguration(env=process.env) {
  const mode=env.NONIUS_HOSTED_MODE||'sample';
  if(!['sample','live'].includes(mode))throw new Error('NONIUS_HOSTED_MODE must be sample or live.');
  const domains=[env.NONIUS_ALLOWED_HOSTS,env.REPLIT_DOMAINS,env.REPLIT_DEV_DOMAIN]
    .filter(Boolean).flatMap(value=>value.split(',')).map(value=>value.trim().toLowerCase()).filter(Boolean);
  for(const domain of domains)if(!/^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[::1\])$/.test(domain))
    throw new Error('Allowed hosts must be exact hostnames, without schemes, ports or wildcards.');
  const common={HOST:'0.0.0.0',PORT:env.PORT||'4317',
    NONIUS_ALLOWED_HOSTS:[...new Set(['127.0.0.1','localhost','[::1]',...domains])].join(',')};
  if(mode==='sample')return configuration({...common,NONIUS_MAX_AUDIO_SECONDS:'0',
    NONIUS_MAX_LLM_CALLS:'0',NONIUS_BUDGET_USD:'0',NONIUS_BUDGET_PATH:'runtime/sample-budget.json'});
  if(!domains.length)throw new Error('Live hosting requires an exact deployment hostname.');
  if(!env.DATABASE_URL)throw new Error('Live hosting requires a durable DATABASE_URL.');
  const config=configuration({...env,...common});
  if(!config.key)throw new Error('Live hosting requires a server-side AssemblyAI secret.');
  if(config.demoPassword.length<16&&!config.allowPublicLive)throw new Error('Live hosting requires a demo password of at least 16 characters, or explicit public live mode.');
  if(!Number.isFinite(config.dailyBudgetUsd))throw new Error('Live hosting requires an explicit daily allowance.');
  return config;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const config=hostedConfiguration();
  const budget=config.key?await new PostgresBudget(config,{connectionString:process.env.DATABASE_URL}).initialize():undefined;
  const {server}=createApplication({config,...(budget?{budget}:{})});
  server.listen(config.port,config.host,()=>console.log(`Nonius hosted ${config.key?(config.allowPublicLive?'capped public live':'protected live'):'keyless sample'} mode on port ${config.port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    server.close(async()=>{await budget?.close();process.exit(0);});setTimeout(()=>process.exit(0),2000).unref();
  });
}
