import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {configuration} from '../lib/config.mjs';
import {createApplication} from '../server.mjs';

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
  if(!env.NONIUS_BUDGET_PATH||env.NONIUS_DURABLE_BUDGET_CONFIRMED!=='true')
    throw new Error('Configure a durable NONIUS_BUDGET_PATH and confirm single-instance persistent storage before live hosting.');
  const config=configuration({...env,...common});
  if(!config.key)throw new Error('Live hosting requires a server-side AssemblyAI secret.');
  if(config.demoPassword.length<16)throw new Error('Live hosting requires a demo password of at least 16 characters.');
  return config;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const config=hostedConfiguration();
  const {server}=createApplication({config});
  server.listen(config.port,config.host,()=>console.log(`Nonius hosted ${config.key?'protected live':'keyless sample'} mode on port ${config.port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{
    server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();
  });
}

