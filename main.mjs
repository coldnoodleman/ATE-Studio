import { pickeringCsv } from './wiring.mjs';
import { sampleWiring } from './wiring-sample.mjs';
import { app, BrowserWindow, dialog, ipcMain, protocol, session, safeStorage } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createProject, cleanProject, cleanDefinition, projectIssues, perform, sampleProject } from './domain.mjs';
import { catalogCsvTemplate, loadCatalogCsv, planCatalogImport, seedCatalog } from './catalog.mjs';
import { store, readBounded, atomicWrite, writeProject, loadProject, acquire } from './store.mjs';
import { makeReport, makeXlsx } from './report.mjs';
import { cleanLLM, defaultLLM, llmRequest, fingerprint, makeContext, interpretReply } from './llm.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const renderer=path.join(root,'dist');
const origin='app://studio';
const testMode=process.argv.includes('--self-test');
const reports=new Map();
const drafts=new Map();
const imports=new Map();
let window, db, dataDir, recoveryFile, file=null, fileRelease=null, dirty=false, llmBusy=false, sessionKey='', sessionHost='', quitting=false;
let saves=Promise.resolve();
const serialized = handler => {
  const next=saves.then(handler);
  saves=next.catch(()=>{});
  return next;
};

app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-breakpad');
if (testMode && !process.env.ATE_PROFILE) throw new Error('Set ATE_PROFILE to an isolated profile for self-tests.');
if (process.env.ATE_PROFILE) app.setPath('userData',path.resolve(process.env.ATE_PROFILE));
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{ standard:true,secure:true,supportFetchAPI:true }}]);

const webPrefs={ contextIsolation:true, sandbox:true, nodeIntegration:false, webSecurity:true, spellcheck:false };
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.otf':'font/otf','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'};
const hash = data => createHash('sha256').update(data).digest('hex');

function installProtocol() {
  protocol.handle('app',async request=>{
    try {
      const url=new URL(request.url);
      if (url.host!=='studio' || request.method!=='GET') return new Response('Not found',{status:404});
      const pathname=decodeURIComponent(url.pathname);
      const policy="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'";
      if (reports.has(pathname)) return new Response(reports.get(pathname),{headers:{'Content-Type':mime['.html'],'Content-Security-Policy':policy}});
      const filename=path.resolve(renderer,'.'+(pathname==='/'?'/index.html':pathname));
      if (!filename.startsWith(renderer+path.sep) || !mime[path.extname(filename)]) return new Response('Not found',{status:404});
      return new Response(new Uint8Array(await readFile(filename)),{headers:{'Content-Type':mime[path.extname(filename)],'Content-Security-Policy':policy,'X-Content-Type-Options':'nosniff'}});
    } catch { return new Response('Not found',{status:404}); }
  });
  session.defaultSession.webRequest.onBeforeRequest({urls:['*://*/*']}, (details,callback)=>{
    callback({cancel:!details.url.startsWith(origin+'/')});
  });
  session.defaultSession.setPermissionRequestHandler((_web,_permission,cb)=>cb(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  app.on('web-contents-created',(_event,contents)=>{
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('will-navigate',event=>event.preventDefault());
    contents.on('will-attach-webview',event=>event.preventDefault());
  });
}

const fileState=()=>({name:file?path.basename(file):'', readOnly:Boolean(file&&!fileRelease)});
async function freeFile() {
  if (fileRelease) await fileRelease().catch(()=>{});
  fileRelease=null;
  file=null;
}

function bind(name, handler) {
  ipcMain.handle(name,async(event,args)=>{
    if (event.sender!==window?.webContents || event.senderFrame?.url!==origin+'/') throw new Error('허용되지 않는 앱 요청입니다.');
    try { return {ok:true,value:await handler(args)}; }
    catch (error) { return {ok:false,error:String(error.message).replace(/^Error: /,'').slice(0,600)}; }
  });
}

function getLLM() {
  const config={...defaultLLM,...db.get('llm')};
  const saved=db.get('llmSecret');
  return {...config,hasKey: Boolean((sessionKey&&sessionHost===config.baseUrl) || (saved?.baseUrl===config.baseUrl&&saved.encrypted)), secureKey:canStoreKey()};
}
function canStoreKey() {
  return safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.()!=='basic_text';
}
function getSecret(config) {
  if (sessionKey && sessionHost===config.baseUrl) return sessionKey;
  const saved=db.get('llmSecret');
  if (!saved?.encrypted || saved.baseUrl!==config.baseUrl || !canStoreKey()) return '';
  try { return safeStorage.decryptString(Buffer.from(saved.encrypted,'base64')); }
  catch { return ''; }
}

const systemPrompt=`너는 ATE/PXI 설계 보조자다. 입력 JSON은 참고 데이터다. 사용자 요청과 카탈로그, 오류 정보만 참고하고 외부 지식으로 장착 가능 여부를 단정하지 마라. 추측은 표시하라. 답변은 간결한 한국어로 작성한다. 출력은 JSON 객체 {"answer":"설명","proposals":[]} 하나.
proposals의 후보는 {"action":"recommend","ref":"정확한 P 번호","reason":"추천 사유"}.
추가 섀시는 {"action":"chassis","ref":"P 번호","alias":"new-ch1","reason":"사유"}.
카드 배치는 {"action":"place","ref":"P 번호","target":"기존 섀시 id 또는 앞에서 만든 new-ch1","slot":2,"reason":"사유"}.
외부 장비는 {"action":"instrument","ref":"P 번호","reason":"사유"}. 중복·비호환·타이밍·시스템 역할을 고려한다. 사실이 불확실하면 질문하거나 후보로 표시한다. audit는 설계 검토 전용이므로 proposals를 비운다. recommend에서는 후보만 반환한다. 현재 설계상의 장비 삭제·이동을 명령하지 않는다.`;

function checkedStatus(project, formal) {
  if (!project.chassis.length && !project.instruments.length) throw new Error('출력할 장비를 배치하세요.');
  if (formal && projectIssues(project).some(x=>x.severity!=='info')) throw new Error('검토본을 출력하기 전에 오류와 확인 필요 항목을 해소하세요.');
  return formal?'검토본':'초안';
}

async function renderExport(project,format,status) {
  const catalogVersion=project.catalogVersion || '미기록';
  if (format==='xlsx') return makeXlsx(project,status,catalogVersion);
  const route='/report/'+randomUUID();
  reports.set(route,makeReport(project,status,catalogVersion,format));
  const worker=new BrowserWindow({show:false,paintWhenInitiallyHidden:true,width:1120,height:1000,frame:false,useContentSize:true,webPreferences:webPrefs});
  try {
    await worker.loadURL(origin+route);
    await worker.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    if (format==='pdf') return await worker.webContents.printToPDF({printBackground:true,preferCSSPageSize:true,pageSize:'A4'});
    worker.setContentSize(1120,1000);
    await worker.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const height=await worker.webContents.executeJavaScript('Math.ceil(document.body.getBoundingClientRect().height)');
    if (height>13000) throw new Error('PNG 한 페이지 크기를 초과했습니다. 전체 구성은 PDF로 출력하세요.');
    worker.setContentSize(1120,Math.max(350,height));
    await worker.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const image=await worker.webContents.capturePage({x:0,y:0,width:1120,height:Math.max(350,height)},{stayHidden:true});
    const data=image.toPNG();
    if (!data.length) throw new Error('배치도 캡처에 실패했습니다.');
    return data;
  } finally { worker.destroy(); reports.delete(route); }
}

function registry() {
  bind('boot',()=>serialized(async()=>({catalog:db.list(),catalogVersion:db.get('catalogVersion'),settings:getLLM(),recovery:(await loadProject(recoveryFile).catch(()=>null))?.project??null})));
  bind('project:new',({sample}={})=>serialized(async()=>{
    await freeFile(); dirty=false; await rm(recoveryFile,{force:true});
    return {project:sample==='wiring'?sampleWiring():sample?sampleProject(seedCatalog):createProject(),file:fileState()};
  }));
  bind('project:open',()=>serialized(async()=>{
    const pick=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'ATE 프로젝트',extensions:['ateproj']}]});
    if (pick.canceled) return null;
    return openFile(pick.filePaths[0]);
  }));
  bind('project:save',({project,as})=>serialized(async()=>{
    let target=file;
    if (!target || as) {
      const pick=await dialog.showSaveDialog(window,{defaultPath:safeName(project.name)+'.ateproj',filters:[{name:'ATE 프로젝트',extensions:['ateproj']}]});
      if (pick.canceled) return null;
      target=pick.filePath.toLowerCase().endsWith('.ateproj')?pick.filePath:pick.filePath+'.ateproj';
    } else if (!fileRelease) throw new Error('읽기 전용 파일입니다. 다른 이름으로 저장하세요.');
    let release=null;
    if (file!==target) {
      release=await acquire(target);
      if (!release) throw new Error('다른 사용자가 편집 중이거나 쓰기 권한이 없습니다.');
    } else if (!fileRelease) throw new Error('이 파일은 편집할 수 없습니다. 다른 파일명을 선택하세요.');
    try { await writeProject(target,project); }
    catch (error) { await release?.(); throw error; }
    if (release) { await freeFile(); file=target; fileRelease=release; }
    dirty=false;
    await rm(recoveryFile,{force:true}).catch(()=>{});
    return {file:fileState()};
  }));
  bind('project:changed',({project})=>serialized(async()=>{
    const data=Buffer.from(JSON.stringify(cleanProject(project)));
    if (data.length>28_000_000) throw new Error('자동 복구 한도를 초과했습니다. 이미지 크기를 줄이세요.');
    dirty=true;
    await atomicWrite(recoveryFile,data);
    return true;
  }));
  bind('project:discardRecovery',()=>serialized(async()=>{ dirty=false; await rm(recoveryFile,{force:true}); }));
  bind('project:export',({project,format,formal})=>serialized(async()=>{
    if (!['pdf','png','xlsx'].includes(format)) throw new Error('지원되지 않는 출력 형식입니다.');
    project=cleanProject(project);
    const status=checkedStatus(project,formal);
    const suffix=formal?'_review':'_draft';
    const pick=await dialog.showSaveDialog(window,{defaultPath:safeName(project.name)+suffix+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if (pick.canceled) return null;
    const dest=pick.filePath.toLowerCase().endsWith('.'+format)?pick.filePath:pick.filePath+'.'+format;
    await atomicWrite(dest,await renderExport(project,format,status));
    return {name:path.basename(dest)};
  }));
  bind('wiring:readCsv',()=>serialized(async()=>{
    const pick=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'CDT 핀맵',extensions:['csv']}]});
    if(pick.canceled)return null;
    const filename=pick.filePaths[0];
    const text=new TextDecoder('utf-8',{fatal:true}).decode(await readBounded(filename,2_000_000));
    return {name:path.basename(filename),text};
  }));
  bind('wiring:exportCsv',({project,cableId,format})=>serialized(async()=>{
    const clean=cleanProject(project);
    const csv=pickeringCsv(clean,cableId,format);
    const cable=clean.wiring.cables.find(x=>x.id===cableId);
    const pick=await dialog.showSaveDialog(window,{defaultPath:safeName(cable.code)+(format==='flying'?'_CDT_flying':'_CDT')+'.csv',
      filters:[{name:'CDT 핀맵',extensions:['csv']}]});
    if(pick.canceled)return null;
    const dest=pick.filePath.toLowerCase().endsWith('.csv')?pick.filePath:pick.filePath+'.csv';
    await atomicWrite(dest,Buffer.from(csv,'utf8'));
    return {name:path.basename(dest)};
  }));
  bind('catalog:single',({definition})=>{
    db.importCatalog([cleanDefinition(definition)]); return {catalog:db.list(),catalogVersion:db.get('catalogVersion')};
  });
  bind('catalog:import',async()=>{
    const pick=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'장비 카탈로그',extensions:['csv','atecat']}]});
    if (pick.canceled) return null;
    const filename=pick.filePaths[0];
    const raw=(await readBounded(filename,28_000_000)).toString('utf8');
    let defs;
    if (filename.toLowerCase().endsWith('.csv')) defs=loadCatalogCsv(raw);
    else {
      const pack=JSON.parse(raw);
      if (pack.schema!==1||!Array.isArray(pack.items)||pack.hash!==hash(JSON.stringify([pack.version,pack.items]))) throw new Error('카탈로그 형식 또는 해시가 일치하지 않습니다.');
      defs=pack.items;
    }
    const items=planCatalogImport(defs,db.list());
    imports.clear(); const token=randomUUID();
    imports.set(token,{defs,version:db.get('catalogVersion')});
    return {token,items:items.map(({definition:x,mode})=>({mode,kind:x.kind,part:x.part,vendor:x.vendor,revision:x.revision,evidence:x.evidence}))};
  });
  bind('catalog:commit',({token})=>{
    const pending=imports.get(token);
    if (!pending||pending.version!==db.get('catalogVersion')) throw new Error('카탈로그가 변경되었습니다. 다시 반입을 확인하세요.');
    db.importCatalog(pending.defs); imports.clear();
    return {catalog:db.list(),catalogVersion:db.get('catalogVersion')};
  });
  bind('catalog:export',async({format})=>{
    if (!['csv','atecat'].includes(format)) throw new Error('카탈로그 형식을 확인하세요.');
    const version=db.get('catalogVersion'),items=db.list();
    const payload=format==='csv'?catalogCsvTemplate():JSON.stringify({schema:1,version,items,hash:hash(JSON.stringify([version,items]))},null,2);
    const pick=await dialog.showSaveDialog(window,{defaultPath:format==='csv'?'장비_등록_양식.csv':'catalog.atecat',filters:[{name:'카탈로그 파일',extensions:[format]}]});
    if (pick.canceled) return null;
    const dest=pick.filePath.toLowerCase().endsWith('.'+format)?pick.filePath:pick.filePath+'.'+format;
    await atomicWrite(dest,Buffer.from(payload));
    return {name:path.basename(dest)};
  });
  bind('llm:settings',async input=>{
    const config=cleanLLM(input);
    const key=String(input.key??'').trim();
    if (key.length>1024 || /[\r\n]/.test(key)) throw new Error('API 키 형식을 확인하세요.');
    if (input.clearKey || db.get('llm')?.baseUrl!==config.baseUrl) {
      sessionKey=''; sessionHost=''; db.put('llmSecret',null);
    }
    if (key) {
      sessionKey=key; sessionHost=config.baseUrl;
      db.put('llmSecret',input.rememberKey===true && canStoreKey()?{baseUrl:config.baseUrl,encrypted:safeStorage.encryptString(key).toString('base64')}:null);
    }
    db.put('llm',config);
    return getLLM();
  });
  bind('llm:models',async()=>{
    const config=getLLM();
    if (!config.enabled) throw new Error('LLM 사용을 켜고 주소를 저장하세요.');
    const data=await llmRequest(config,getSecret(config),'models');
    if (!Array.isArray(data.data)) throw new Error('모델 목록 형식이 다릅니다. 모델 ID를 직접 입력할 수 있습니다.');
    return data.data.map(x=>x.id).filter(x=>typeof x==='string'&&x.length<=200).slice(0,300);
  });
  bind('llm:test',async()=>{
    const config=getLLM();
    if (!config.enabled || !config.model) throw new Error('LLM을 활성화하고 모델 ID를 저장하세요.');
    const data=await llmRequest(config,getSecret(config),'chat/completions',{model:config.model,messages:[{role:'user',content:'Reply with OK.'}],stream:false});
    if (typeof data.choices?.[0]?.message?.content!=='string') throw new Error('모델 응답 형식이 다릅니다.');
    return { model:config.model };
  });
  bind('llm:ask',async({project,question,mode,catalogParts})=>{
    const config=getLLM();
    if (!config.enabled || !config.model) throw new Error('설정에서 사내 LLM 주소와 모델을 저장하세요.');
    if (llmBusy) throw new Error('다른 AI 작업이 진행 중입니다.');
    if (!['ask','recommend','draft','audit'].includes(mode)||typeof question!=='string'||question.length>2500||!question.trim()) throw new Error('질문 또는 작업 유형을 확인하세요.');
    project=cleanProject(project);
    llmBusy=true;
    try {
      const {context,refs}=makeContext(project,db.list(),question,mode,{catalogParts:Array.isArray(catalogParts)?catalogParts.slice(0,20):[]});
      const result=await llmRequest(config,getSecret(config),'chat/completions',{model:config.model,stream:false,messages:[{role:'system',content:systemPrompt},{role:'user',content:JSON.stringify(context)}]});
      const body=result.choices?.[0]?.message?.content;
      if (typeof body!=='string'||!body.trim()) throw new Error('모델이 읽을 수 있는 답변을 반환하지 않았습니다.');
      const parsed=interpretReply(body,project,refs);
      const allow=mode==='draft'||mode==='ask';
      const edits=allow?parsed.operations:[];
      const token=edits.length?randomUUID():null;
      if (token) {
        drafts.clear();
        drafts.set(token,{original:fingerprint(project),edits,catalogVersion:db.get('catalogVersion'),created:Date.now()});
      }
      return {answer:parsed.answer,suggestions:allow?parsed.suggestions:parsed.suggestions.filter(x=>x.status==='reference'),token,changes:edits.length,model:config.model};
    } finally { llmBusy=false; }
  });
  bind('llm:apply',({project,token})=>{
    const draft=drafts.get(token);
    if (!draft||Date.now()-draft.created>600_000||draft.original!==fingerprint(project)||draft.catalogVersion!==db.get('catalogVersion')) throw new Error('초안이 만료되었거나 설계·카탈로그가 변경되었습니다. 제안을 다시 생성하세요.');
    let next={...project,catalogVersion:db.get('catalogVersion')};
    for(const edit of draft.edits) next=perform(next,edit);
    drafts.delete(token);
    return next;
  });
}

const safeName = name => String(name).replace(/[<>:"/\\|?*\u0000-\u001F]/g,'_').replace(/[. ]+$/,'').slice(0,90)||'ATE';
async function openFile(target) {
  if (!target.toLowerCase().endsWith('.ateproj')) throw new Error('ATE 프로젝트 파일을 선택하세요.');
  const loaded=await loadProject(target);
  if (target!==file) {
    const release=await acquire(target);
    await freeFile(); file=target; fileRelease=release;
  }
  dirty=false;
  await rm(recoveryFile,{force:true}).catch(()=>{});
  return {...loaded,file:fileState()};
}

async function init() {
  dataDir=app.getPath('userData');
  await mkdir(dataDir,{recursive:true,mode:0o700});
  recoveryFile=path.join(dataDir,'recovery.ateproj');
  db=store(dataDir);
  installProtocol();
  registry();
  window=new BrowserWindow({width:1480,height:930,minWidth:1000,minHeight:720,show:false,title:'ATE Studio',
    backgroundColor:'#eef2f5',autoHideMenuBar:true,webPreferences:{...webPrefs,preload:path.join(root,'preload.cjs')}});
  window.once('ready-to-show',()=>window.show());
  window.on('close',event=>{
    if (quitting) return;
    event.preventDefault();
    void serialized(async()=>{
      if (dirty) {
        const choice=await dialog.showMessageBox(window,{type:'question',title:'저장되지 않은 변경',message:'변경 내용이 자동 복구본에 남습니다.',buttons:['복구본을 남기고 종료','계속 편집'],defaultId:1,cancelId:1});
        if (choice.response!==0) return;
      }
      await freeFile();
      quitting=true;
      window.close();
    }).catch(error=>dialog.showErrorBox('종료 오류',error.message));
  });
  await window.loadURL(origin+'/');
  if (testMode) {
    const {runSelfTest}=await import('./selftest.mjs');
    try {
      await runSelfTest({db,renderExport,checkedStatus,window,openFile});
      await freeFile();
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  }
}

if (!testMode && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance',()=>{ if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(init).catch(error=>{ console.error(error); dialog.showErrorBox('ATE Studio 시작 실패',error.message); app.exit(1); });
  app.on('window-all-closed',()=>app.quit());
  app.on('will-quit',()=>db?.close());
}
