import { WiringPage } from './wiring';
import { PortForm } from './ports';
import { receiverMountWiringImpact, wiringImpact } from '../wiring.mjs';
import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type DragEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, ArrowDown, ArrowUp, Boxes, Cable, Plug, ChevronDown, ChevronRight, CircuitBoard, ClipboardList, Download,
  FilePlus2, FileSpreadsheet, Folder, FolderOpen, LayoutGrid, List, Maximize, Plus, Redo2, Save, Search, Server,
  Settings2, Sparkles, Trash2, TriangleAlert, Undo2, Upload, X, ZoomIn, ZoomOut, Move, Layers3, Check, PanelRight,
} from 'lucide-react';
import { buildBOM, cleanProject, createProject, labelOf, occupied, partKey, perform, placementIssues, projectIssues, sampleProject, VERSION } from '../domain.mjs';
import { seedCatalog } from '../catalog.mjs';
import { AssistantPanel, CatalogView, DefinitionForm, ImportTable, Modal, PartIcon, SettingsPanel } from './panels';
import { type Definition, type Chassis, type Item, type Project, type FileState, type Settings, type ImportPreview, type AIReply, type SaveReceiverMounts, kindNames, evidenceNames, roleNames } from './types';
import './style.css';

const api=window.studio;
const noFile:FileState={name:'',readOnly:false};
const modelModes={enabled:false,model:'',baseUrl:'',proactive:false,routed:false,hasKey:false,secureKey:false};
type Target={kind:string;chassisId?:string;slot?:number;replace?:string};
type Selection={chassisId?:string;slot?:number;itemId?:string};
type Action=Record<string,any>;
type Popup='ports'|'editor'|'settings'|'project'|'export'|'import'|'recovery'|'move'|'catalog'|'help'|null;
const roleBadge=(role:string, accepts:string[])=>role==='system'?'SYS':role==='timing'?'TIM':role==='reserved'?'—':accepts.includes('Hybrid')?'HYB':accepts.join('/');

function App() {
  const [project,setProject]=useState<Project>(()=>createProject() as Project);
  const [wireFocus,setWireFocus]=useState({id:'',review:'',version:0});
  const [file,setFile]=useState<FileState>(noFile);
  const [dirty,setDirty]=useState(false);
  const [catalog,setCatalog]=useState<Definition[]>([]);
  const [catalogVersion,setCatalogVersion]=useState('');
  const [settings,setSettings]=useState<Settings>(modelModes);
  const [booted,setBooted]=useState(false);
  const [selection,setSelection]=useState<Selection>({});
  const [tab,setTab]=useState('layout'), [display,setDisplay]=useState('panel'),[side,setSide]=useState('detail');
  const [zoom,setZoom]=useState(100),[showIssues,setShowIssues]=useState(false);
  const [popup,setPopup]=useState<Popup>(null),[target,setTarget]=useState<Target>({kind:'chassis'});
  const [editDef,setEditDef]=useState<Definition|undefined>(undefined);
  const [preview,setPreview]=useState<ImportPreview|null>(null);
  const [recovery,setRecovery]=useState<Project|null>(null);
  const [formal,setFormal]=useState(false);
  const [past,setPast]=useState<Project[]>([]),[future,setFuture]=useState<Project[]>([]);
  const [toast,setToast]=useState({text:'',error:false});
  const [pending,setPending]=useState(false);
  const [reply,setReply]=useState<AIReply|null>(null),[lastAuto,setLastAuto]=useState<AIReply|null>(null);
  const [aiBusy,setAiBusy]=useState(false),[aiError,setAiError]=useState('');
  const [partShelf,setPartShelf]=useState(false),[shelfQuery,setShelfQuery]=useState('');
  const [dragItem,setDragItem]=useState<{id?:string;part?:string}|null>(null),[hover,setHover]=useState('');
  const [issueTab,setIssueTab]=useState('all');
  const projectRef=useRef(project),pendingRef=useRef(false), aiLock=useRef(false), lastAutoVersion=useRef('');
  const bodyRef=useRef<HTMLDivElement>(null);
  const allIssues=useMemo(()=>projectIssues(project),[project]);
  const bom=useMemo(()=>buildBOM(project),[project]);
  const items=useMemo(()=>[...project.chassis,...project.chassis.flatMap(c=>c.placements),...project.instruments],[project]);
  const selectedCh=project.chassis.find(x=>x.id===selection.chassisId);
  const selectedItem=items.find(x=>x.id===selection.itemId);
  const selectedSlot=selectedCh?.definition.slots.find(s=>s.number===selection.slot);
  const selectedCard=selectedCh?.placements.find(x=>x.id===selection.itemId);
  const totalSlots=project.chassis.reduce((a,c)=>a+c.definition.slots.length,0);
  const installed=project.chassis.reduce((a,c)=>a+c.placements.reduce((n,p)=>n+occupied(c,p.definition,p.slot).length,0),0);
  const reports=allIssues.filter(x=>x.severity!=='info');
  const shelfParts=useMemo(()=>catalog.filter(d=>d.kind==='module'&&[d.part,d.name,d.vendor].some(s=>s.toLowerCase().includes(shelfQuery.toLowerCase()))).slice(0,24),[catalog,shelfQuery]);
  const totalCards=project.chassis.reduce((a,c)=>a+c.placements.length,0);
  const selectedIssues=allIssues.filter(x=>x.itemId===selection.itemId || (!selection.itemId&&x.itemId===selection.chassisId));
  const visibleIssues=allIssues.filter(x=>issueTab==='all'||x.severity===issueTab);
  const close=()=>setPopup(null);

  function notify(text:string,error=false) {setToast({text,error});}
  useEffect(()=>{
    if(!toast.text)return;
    const timer=setTimeout(()=>setToast({text:'',error:false}),toast.error?6500:4200);
    return ()=>clearTimeout(timer);
  },[toast]);

  useEffect(()=>{
    api.boot().then(data=>{
      setCatalog(data.catalog);setCatalogVersion(data.catalogVersion);setSettings(data.settings);
      const initial=sampleProject(seedCatalog) as Project;
      projectRef.current=initial;
      setProject(initial);selectDefault(initial);
      if(data.recovery) {setRecovery(data.recovery);setPopup('recovery');}
      setBooted(true);
    }).catch(e=>notify(e.message,true));
  },[]);

  function selectDefault(p:Project) {
    const ch=p.chassis[0]; setSelection(ch?{chassisId:ch.id,itemId:ch.id}:{});
  }

  function newState(p:Project,f:FileState,recovered=false) {
    projectRef.current=p;
    setProject(p);setFile(f);setDirty(recovered);setPast([]);setFuture([]);setReply(null);setLastAuto(null);setAiError('');
    lastAutoVersion.current='';
    selectDefault(p);setTab('layout');setZoom(100);setShowIssues(false);
    if(recovered) api.changed(p).catch(e=>notify(e.message,true));
  }

  function update(p:Project,history=true) {
    const old=projectRef.current;
    if(history) {setPast(h=>[...h.slice(-39),old]);setFuture([]);}
    projectRef.current=p;setProject(p);setDirty(true);
    api.changed(p).catch(e=>notify(e.message,true));
  }

  function run(operation:Action) {
    if(pendingRef.current) return null;
    try {
      const before=projectRef.current;
      const merging=['addChassis','addInstrument','place'].includes(operation.type);
      const p=perform(merging?{...before,catalogVersion}:before,operation) as Project;
      update(p);
      return p;
    } catch(e) {notify(e.message,true);return null;}
  }

  function undo() {
    if(!past.length||pendingRef.current) return;
    const current=projectRef.current;
    setFuture(f=>[current,...f]);
    const next=past.at(-1);
    setPast(p=>p.slice(0,-1));update(next,false);
  }
  function redo() {
    if(!future.length||pendingRef.current) return;
    const current=projectRef.current;
    setPast(h=>[...h,current]);setFuture(f=>f.slice(1));update(future[0],false);
  }

  async function task<T>(work:()=>Promise<T>) {
    if(pendingRef.current)return;
    setPending(true);pendingRef.current=true;
    try {return await work();} catch(error) {notify(error.message,true);}
    finally {setPending(false);pendingRef.current=false;}
  }

  function save(as=false) {
    return task(async()=>{
      const result=await api.save(projectRef.current,as||file.readOnly);
      if(result) {setFile(result.file);setDirty(false);notify(result.file.name+' 저장 완료');}
    });
  }
  function changeProject(open:boolean,sample:boolean|'wiring'=false) {
    if(dirty&&!window.confirm('현재 편집 내용을 닫고 다른 프로젝트를 여시겠습니까?'))return;
    void task(async()=>{
      const r=open?await api.openProject():await api.newProject(sample);
      if(r) {
        const restored='recovered' in r && r.recovered===true;
        newState(r.project,r.file,restored);
        if(restored)notify('직전 정상본을 열었습니다. 파일을 다시 저장할 수 있습니다.');
        if(sample==='wiring')openWiring();
        if(r.file.readOnly)notify('읽기 전용으로 열었습니다. 저장하면 다른 이름으로 저장합니다.');
      }
    });
  }

  useEffect(()=>{
    function keys(e:KeyboardEvent) {
      const mod=e.metaKey||e.ctrlKey;
      if(mod&&e.key.toLowerCase()==='s') {e.preventDefault();void save(e.shiftKey);return;}
      if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as Element)?.tagName||'')||popup)return;
      if(mod&&e.key.toLowerCase()==='z') {e.preventDefault();e.shiftKey?redo():undo();}
      if(mod&&e.key.toLowerCase()==='y') {e.preventDefault();redo();}
      if(mod&&e.key.toLowerCase()==='o') {e.preventDefault();changeProject(true);}
      if(e.key==='Delete'&&selectedItem) remove(selectedItem);
    }
    window.addEventListener('keydown',keys);
    return ()=>window.removeEventListener('keydown',keys);
  });

  function ask(question:string,mode:string,automatic=false) {
    if(aiLock.current)return;
    const snapshot=projectRef.current;
    aiLock.current=true;setAiBusy(true);
    if(!automatic) { setReply(null);setAiError('');setSide('ai'); }
    api.ask(snapshot,question,mode).then(r=>{
      if(snapshot.id!==projectRef.current.id || (automatic&&snapshot.updatedAt!==projectRef.current.updatedAt)) return;
      automatic?setLastAuto(r):setReply(r);
    }).catch(e=>{setAiError(e.message);if(automatic)notify('자동 검토 · '+e.message,true);}).finally(()=>{aiLock.current=false;setAiBusy(false);});
  }

  useEffect(()=>{
    if(!dirty||!settings.enabled||!settings.model||!settings.proactive||!reports.length||aiBusy) return;
    const key=project.id+'|'+project.updatedAt;
    if(lastAutoVersion.current===key)return;
    const timer=setTimeout(()=>{
      if(aiLock.current)return;
      lastAutoVersion.current=key;
      ask('현재 배치의 확인 필요 항목을 짧게 설명하고 다음 확인 순서를 정리해 줘.','audit',true);
    },4500);
    return ()=>clearTimeout(timer);
  },[project,dirty,settings,aiBusy,reports.length]);

  function applyReply() {
    if(!reply?.token||!window.confirm(`검사를 통과한 배치 변경 ${reply.changes}건을 적용할까요?`))return;
    void task(async()=>{
      const p=await api.apply(projectRef.current,reply.token);
      update(p);setReply({...reply,token:null});selectDefault(p);setTab('layout');notify('배치 초안을 적용했습니다.');
    });
  }

  function openCatalog(t:Target) {setTarget(t);setPopup('catalog');}
  function selectSlot(c:Chassis,n:number,open=false) {
    const item=c.placements.find(p=>occupied(c,p.definition,p.slot).some(s=>s.number===n));
    setSelection({chassisId:c.id,slot:n,itemId:item?.id});setSide('detail');
    if(open&&!item) openCatalog({kind:'module',chassisId:c.id,slot:n});
  }
  function openWiring(id='',review='') {
    setWireFocus(w=>({id,review,version:w.version+1}));setTab('wiring');
  }
  function noteImpact(ids:string[]) {
    const impact=wiringImpact(projectRef.current,ids);
    const details=[...impact.cables.map(c=>c.code),...impact.nets.map(n=>n.name),...impact.groups.map(g=>g.name)];
    return details.length?`\n연결 검토 대상 ${details.length}건 · ${details.slice(0,6).join(', ')}. 저장 후 와이어링 검토에서 확인할 수 있습니다.`:'';
  }
  const saveReceiverMounts:SaveReceiverMounts=(id,mounts,confirmed)=>{
    if(pendingRef.current)return {status:'error',message:'진행 중인 작업이 끝난 뒤 다시 저장하세요.'};
    try {
      const before=projectRef.current;
      const next=perform(before,{type:'receiverMounts',id,mounts}) as Project;
      if(!confirmed) {
        const impact=receiverMountWiringImpact(before,next,id);
        const names=[...impact.cables.map(c=>c.code),...impact.nets.map(n=>n.name)];
        if(names.length)return {status:'confirm',message:`기존 연결 ${names.length}건(${names.slice(0,6).join(', ')})에 영향이 있습니다. 저장 후 와이어링 검토에서 확인하세요.`};
      }
      update(next);
      notify('리시버 모듈 배치를 저장했습니다.');
      return {status:'saved'};
    } catch(error) {
      return {status:'error',message:error.message};
    }
  };
  function choosePart(d:Definition) {
    const id=crypto.randomUUID();
    if(target.replace){
      const impact=noteImpact([target.replace]);
      if(impact&&!window.confirm('카드를 교체할까요?'+impact))return;
    }
    const operation={type:d.kind==='chassis'?'addChassis':d.kind==='module'?'place':'addInstrument',definition:d,chassisId:target.chassisId,slot:target.slot,replaceId:target.replace,newId:id};
    const p=run(operation);
    if(p) {
      setSelection({itemId:id,chassisId:d.kind==='chassis'?id:target.chassisId,slot:target.slot});
      if(d.kind==='receiver')openWiring(id);else {setTab('layout');setSide('detail');}
      close();notify(d.part+' 배치 완료');
    }
  }
  function remove(item:Item) {
    const chassis=project.chassis.find(x=>x.id===item.id);
    const impact=noteImpact([item.id,...(chassis?.placements.map(p=>p.id)||[])]);
    if((chassis||impact)&&!window.confirm(`${labelOf(item)}을(를) 구성에서 제거할까요?`+impact))return;
    if(run({type:'remove',id:item.id})) {setSelection({chassisId:selection.chassisId===item.id?undefined:selection.chassisId});notify('구성에서 제거했습니다.');}
  }
  function dragOperation(c:Chassis,n:number,data:{id?:string;part?:string}) {
    if(data?.id)return {type:'move',id:data.id,chassisId:c.id,slot:n};
    const d=catalog.find(x=>partKey(x)===data?.part);
    return d?{type:'place',definition:d,chassisId:c.id,slot:n,newId:crypto.randomUUID()}:null;
  }
  function onDrop(c:Chassis,n:number,e:DragEvent) {
    e.preventDefault();e.stopPropagation();
    const data={id:e.dataTransfer.getData('application/x-ate-card'),part:e.dataTransfer.getData('application/x-ate-part')};
    setDragItem(null);setHover('');
    const operation=dragOperation(c,n,data);
    if(operation&&run(operation))setSelection({chassisId:c.id,slot:n,itemId:operation.id||operation.newId});
  }
  function displayDrag(c:Chassis,n:number) {
    if(!dragItem||!hover.startsWith(c.id+':'))return '';
    const start=Number(hover.slice(c.id.length+1));
    const op=dragOperation(c,start,dragItem);
    if(!op)return '';
    const definition=op.definition||items.find(x=>x.id===op.id)?.definition;
    if(!definition||!occupied(c,definition,start).some(x=>x.number===n))return '';
    return placementIssues(c,definition,start,op.id).some(x=>x.severity==='error')?'drag-no':'drag-ok';
  }
  function changeCatalog(data:{catalog:Definition[];catalogVersion:string}) {
    setCatalog(data.catalog);setCatalogVersion(data.catalogVersion);
  }
  async function saveDef(d:Definition) {
    if(catalog.some(x=>partKey(x)===partKey(d))&&!window.confirm('같은 제조사·품번·리비전의 장비 정의를 업데이트할까요? 이미 저장한 프로젝트에는 현재 정의가 유지됩니다.'))return false;
    const r=await task(async()=>{changeCatalog(await api.saveCatalog(d));close();notify(d.part+' 등록 완료');return true;});
    return r===true;
  }
  function selectedUpdate() {
    if (!selectedItem) return;
    const updates=catalog.filter(d=>d.kind===selectedItem.definition.kind&&d.vendor===selectedItem.definition.vendor&&d.part===selectedItem.definition.part && JSON.stringify(d)!==JSON.stringify(selectedItem.definition));
    if(!updates.length){notify('카탈로그에 다른 정의가 없습니다.');return;}
    const d=updates.find(d=>d.revision===selectedItem.definition.revision)||updates.at(-1);
    if(!window.confirm(`${selectedItem.definition.part}의 배치 정의를 변경할까요?\n개정 ${selectedItem.definition.revision} → ${d.revision}\n${d.source||'출처 미등록'}`+noteImpact([selectedItem.id])))return;
    try {
      const proposed=structuredClone(projectRef.current);
      const item=[...proposed.chassis,...proposed.chassis.flatMap(c=>c.placements),...proposed.instruments].find(x=>x.id===selectedItem.id);
      item.definition=d;
      proposed.catalogVersion=catalogVersion;
      proposed.updatedAt=new Date().toISOString();
      const cleaned=cleanProject(proposed) as Project;
      const before=new Set(projectIssues(projectRef.current).filter(i=>i.severity==='error').map(i=>i.itemId+'|'+i.code+'|'+i.message));
      const error=projectIssues(cleaned).find(i=>i.severity==='error'&&!i.code.startsWith('wiring-')&&!before.has(i.itemId+'|'+i.code+'|'+i.message));
      if(error)throw new Error(error.message);
      update(cleaned);notify('장비 정의를 갱신했습니다.');
    } catch(e) {notify(e.message,true);}
  }
  function catalogImport() {
    void task(async()=>{const data=await api.importCatalog();if(data){setPreview(data);setPopup('import');}});
  }
  function catalogExport(format:string) {
    void task(async()=>{const r=await api.exportCatalog(format);if(r)notify(r.name+' 저장 완료');});
  }
  function exportFile(format:string) {
    void task(async()=>{const r=await api.export(projectRef.current,format,formal);if(r){close();notify(r.name+' 저장 완료');}});
  }
  function navigateIssue(id:string) {
    if([...project.wiring.cables,...project.wiring.nets,...project.wiring.groups].some(x=>x.id===id)){openWiring('',id);return;}

    const direct=project.chassis.find(c=>c.id===id);
    const ch=direct??project.chassis.find(c=>c.placements.some(p=>p.id===id));
    const slot=ch?.placements.find(p=>p.id===id)?.slot;
    setTab('layout');setSide('detail');setSelection({itemId:id,chassisId:ch?.id,slot});
    requestAnimationFrame(()=>document.getElementById('unit-'+(ch?.id||id))?.scrollIntoView({behavior:'smooth',block:'center'}));
  }
  const toolButton=(label:string,icon:any,action:()=>void,disabled=false)=><button className="icon" title={label} aria-label={label} disabled={disabled} onClick={action}>{icon}</button>;

  return <div className="app" onDragEnd={()=>{setDragItem(null);setHover('');}}>
    <header className="topbar">
      <div className="brand"><span className="brand-icon"><CircuitBoard size={23}/></span><div><b>ATE Studio</b><small>시험장비 구성</small></div></div>
      <div className="header-project">
        <Folder size={16}/><button className="project-title" onClick={()=>setPopup('project')}>{project.name}{dirty?' •':''} <ChevronDown size={15}/></button><span className="revision">Rev. {project.revision}</span>
      </div>
      <div className="top-actions">
        {toolButton('새 프로젝트',<FilePlus2 size={19}/>,()=>changeProject(false),pending||!booted)}
        {toolButton('프로젝트 열기',<FolderOpen size={19}/>,()=>changeProject(true),pending||!booted)}
        <span className="divider"/>
        {toolButton('되돌리기',<Undo2 size={18}/>,undo,!past.length||pending)}
        {toolButton('다시 실행',<Redo2 size={18}/>,redo,!future.length||pending)}
        <span className="divider"/>
        <button className="btn top-save" disabled={pending||!booted} onClick={()=>save()}><Save size={16}/> 저장</button>
        <button className="btn primary" disabled={pending||!booted} onClick={()=>{setFormal(false);setPopup('export');}}><Download size={16}/> 내보내기</button>
        {toolButton('앱 설정',<Settings2 size={20}/>,()=>setPopup('settings'),!booted)}
      </div>
    </header>
    <div className={tab==='wiring'?'workspace wiring-workspace':'workspace'}>
      <aside className="navigator">
        <div className="panel-head"><b>구성 트리</b><button className="icon" title="섀시 추가" onClick={()=>openCatalog({kind:'chassis'})}><Plus size={17}/></button></div>
        <div className="tree">
          <div className="tree-label"><Server size={16}/> 섀시 <span>{project.chassis.length}</span></div>
          {project.chassis.map(c=><Fragment key={c.id}>
            <button className={'tree-ch '+(selection.itemId===c.id?'active':'')} onClick={()=>navigateIssue(c.id)}><ChevronRight size={14}/><span>{labelOf(c)}</span><small>{c.placements.length}</small></button>
            {[...c.placements].sort((a,b)=>a.slot-b.slot).map(p=><button className={'tree-card '+(selection.itemId===p.id?'active':'')} key={p.id} onClick={()=>navigateIssue(p.id)}><span className="small-slot">{p.slot}</span><span title={p.definition.part}>{labelOf(p)}</span></button>)}
          </Fragment>)}
          {project.chassis.length===0&&<div className="tree-empty">배치된 섀시 없음</div>}
          <div className="tree-label external"><Boxes size={16}/> 독립 장비 <span>{project.instruments.length}</span></div>
          {project.instruments.map(i=><button key={i.id} className={'tree-card ext '+(selection.itemId===i.id?'active':'')} onClick={()=>navigateIssue(i.id)}><PartIcon kind={i.definition.kind} size={14}/><span>{labelOf(i)}</span></button>)}
          {project.instruments.length===0&&<div className="tree-empty">등록된 독립 장비 없음</div>}
        </div>
        <div className="nav-bottom">
          <button className="btn" onClick={()=>changeProject(false,true)} disabled={pending}><Layers3 size={15}/> 예제 프로젝트 열기</button>
          <button className="btn" onClick={()=>changeProject(false,'wiring')} disabled={pending}><Cable size={15}/> 9050 배선 예제</button>
          <button className="text-btn" onClick={()=>setPopup('help')}>사용 안내 <ChevronRight size={14}/></button>
        </div>
      </aside>

      <main className="main-area">
        <div className="tabs">
          <button className={tab==='layout'?'active':''} onClick={()=>setTab('layout')}><LayoutGrid size={17}/> 배치 편집</button>
          <button className={tab==='catalog'?'active':''} onClick={()=>setTab('catalog')}><Boxes size={17}/> 장비 라이브러리</button>
          <button className={tab==='bom'?'active':''} onClick={()=>setTab('bom')}><ClipboardList size={17}/> 부품명세서</button>
          <button className={tab==='wiring'?'active':''} onClick={()=>openWiring()}><Cable size={17}/> 와이어링</button>
          <span className="tabs-state">{file.readOnly?'읽기 전용':file.name||'로컬 작업'}</span>
        </div>
        {tab==='layout'&&<>
          <div className="work-toolbar">
            <button className="btn" onClick={()=>openCatalog({kind:'chassis'})}><Plus size={16}/> 섀시</button>
            <button className="btn" onClick={()=>openCatalog({kind:'external'})}><Plus size={16}/> 독립 장비</button>
            <button className={"btn "+(partShelf?"shelf-active":"")} disabled={display!=="panel"} aria-pressed={partShelf} onClick={()=>setPartShelf(v=>!v)}><CircuitBoard size={15}/> 모듈 꺼내기</button>
            <div className="view-switch">
              <button className={display==='panel'?'active':''} onClick={()=>setDisplay('panel')}><LayoutGrid size={15}/> 정면도</button>
              <button className={display==='table'?'active':''} onClick={()=>setDisplay('table')}><List size={16}/> 슬롯 표</button>
            </div>
          </div>
          {partShelf&&display==='panel'&&<div className="part-shelf">
            <label className="search-box"><Search size={15}/><input placeholder="배치할 모듈 검색" value={shelfQuery} onChange={e=>setShelfQuery(e.target.value)}/></label>
            <div className="shelf-parts">{shelfParts.map(d=><button className="btn compact" key={partKey(d)} draggable title={d.name+' · 빈 슬롯으로 끌어 놓기'}
              onDragStart={e=>{const part=partKey(d);e.dataTransfer.setData('application/x-ate-part',part);e.dataTransfer.effectAllowed='copy';setDragItem({part});}}
              onClick={()=>{if(selectedCh&&selectedSlot)openCatalog({kind:'module',chassisId:selectedCh.id,slot:selectedSlot.number});else notify('빈 슬롯을 선택하거나 모듈을 끌어 놓으세요.');}}><CircuitBoard size={14}/>{d.part}</button>)}
            {!shelfParts.length&&<span className="muted">일치하는 모듈 없음</span>}</div>
          </div>}
          <div className="drawing" ref={bodyRef} onClick={e=>{if(e.target===e.currentTarget)setSelection({});}}>
            {!project.chassis.length&&!project.instruments.length&&<div className="drawing-empty"><span className="empty-icon"><Server size={33}/></span><h2>첫 섀시를 배치하세요</h2><p>장비 라이브러리에서 섀시를 선택한 뒤 빈 슬롯에 모듈을 추가합니다.</p><button className="btn primary" onClick={()=>openCatalog({kind:'chassis'})}><Plus size={17}/> 섀시 추가</button></div>}
            <div className="drawing-layout" style={display==='panel'?{zoom:zoom/100}:undefined}>
              {project.chassis.map((c,idx)=><article key={c.id} id={'unit-'+c.id} className={'chassis-card '+(selection.chassisId===c.id?'focused':'')}>
                <div className="chassis-heading" onClick={()=>{setSelection({itemId:c.id,chassisId:c.id});setSide('detail');}}>
                  <span className="chassis-icon"><Server size={18}/></span>
                  <div><h3>{labelOf(c)}</h3><span>{c.definition.part} · {c.definition.vendor}</span></div>
                  <span className={'tag '+c.definition.evidence}>{evidenceNames[c.definition.evidence]}</span>
                  <span className="chassis-count">{c.definition.slots.length}슬롯</span>
                  {toolButton('섀시 위로',<ArrowUp size={15}/>,()=>run({type:'order',id:c.id,direction:'up'}),idx===0)}
                  {toolButton('섀시 아래로',<ArrowDown size={15}/>,()=>run({type:'order',id:c.id,direction:'down'}),idx===project.chassis.length-1)}
                </div>
                {display==='panel'?<div className="chassis-scroll">
                  <div className="front-panel">
                    <div className="rail"><i/><i/><span>{c.definition.standard} <em>{c.definition.slots.length} SLOT</em></span><i/><i/></div>
                    <div className="slots-grid" style={{gridTemplateColumns:`repeat(${c.definition.slots.length},minmax(55px,1fr))`}}>
                      {c.definition.slots.map(s=>{
                        const card=c.placements.find(p=>occupied(c,p.definition,p.slot).some(o=>o.number===s.number));
                        const panelStart=card?.slot===s.number;
                        const reserved=s.disabled||s.role==='reserved';
                        const active=selection.chassisId===c.id&&selection.slot===s.number;
                        return <div key={s.number} className={'slot-column '+displayDrag(c,s.number)}>
                          <div className="slot-num"><b>{s.number}</b><span>{roleBadge(s.role,s.accepts)}</span></div>
                          <button className={`slot ${card?'fitted':'free'} ${active?'selected':''} ${reserved?'reserved':''} ${s.role==='system'?'system':''} ${card&&!panelStart?'continued':''}`}
                            title={card?`${s.number}번 · ${card.definition.part}`:reserved?`${s.number}번 예약 슬롯`:`${s.number}번 슬롯에 모듈 추가`}
                            aria-label={card?`${s.number}번 ${card.definition.part}`:`슬롯 ${s.number} 모듈 추가`}
                            disabled={reserved&&!card}
                            draggable={Boolean(card)}
                            onDragStart={e=>{if(card){e.dataTransfer.setData('application/x-ate-card',card.id);e.dataTransfer.effectAllowed='move';setDragItem({id:card.id});}}}
                            onDragOver={e=>{if(!dragItem)return;e.preventDefault();setHover(c.id+':'+s.number);}}
                            onDrop={e=>onDrop(c,s.number,e)} onClick={()=>selectSlot(c,s.number,true)}>
                            {card?<><span className="screw"/>{panelStart?<><span className="port-chip">{card.definition.image?<img alt="" src={card.definition.image}/>:<CircuitBoard size={22}/>}</span><b>{card.definition.part.replace('DEMO-','')}</b><span className="card-kind">{card.definition.category||'모듈'}</span></>:<Move size={15}/>}<span className="screw end"/></>:reserved?<span>—</span>:<Plus size={18}/>}
                          </button>
                        </div>;
                      })}
                    </div>
                    <div className="rail bottom"><i/><span className="vents"/><i/></div>
                  </div>
                </div>:<table className="data-table slot-table"><thead><tr><th>슬롯</th><th>역할</th><th>인터페이스</th><th>장비</th><th>상태</th></tr></thead><tbody>{c.definition.slots.map(s=>{
                  const p=c.placements.find(p=>occupied(c,p.definition,p.slot).some(o=>o.number===s.number));
                  return <tr key={s.number} onClick={()=>selectSlot(c,s.number,false)}>
                    <td>{s.number}</td><td>{roleNames[s.role]}</td><td>{s.accepts.join(' / ')||'—'}</td><td>{p?labelOf(p):'—'}</td><td>{p?'장착됨':s.disabled||s.role==='reserved'?'예약':<button className="btn compact" onClick={e=>{e.stopPropagation();selectSlot(c,s.number,true);}}><Plus size={13}/> 모듈 추가</button>}</td>
                  </tr>;
                })}</tbody></table>}
              </article>)}
              {project.instruments.length>0&&<div className="externals"><h3>독립 장비 / DUT</h3><div>{project.instruments.map(i=><button key={i.id} id={'unit-'+i.id} className={'ext-card '+(selection.itemId===i.id?'selected':'')} onClick={()=>{setSelection({itemId:i.id});setSide('detail');}}>
                <PartIcon kind={i.definition.kind}/><span><b>{labelOf(i)}</b><small>{i.definition.part} · {i.definition.name}</small></span><ChevronRight size={17}/>
              </button>)}</div></div>}
            </div>
          </div>
          <div className="canvas-foot"><span><span className="legend filled"/> 장착 <span className="legend free"/> 비어 있음 <span className="legend sys"/> 시스템 슬롯</span>
            <div className="zoom">{toolButton('축소',<ZoomOut size={16}/>,()=>setZoom(z=>Math.max(65,z-10)),display!=='panel'||zoom<=65)}
              <span>{zoom}%</span>{toolButton('확대',<ZoomIn size={16}/>,()=>setZoom(z=>Math.min(150,z+10)),display!=='panel'||zoom>=150)}
              {toolButton('기본 배율',<Maximize size={15}/>,()=>setZoom(100),display!=='panel')}
            </div></div>
          {showIssues&&<div className="issues-strip"><div><b>배치 검토</b><select aria-label="검토 필터" value={issueTab} onChange={e=>setIssueTab(e.target.value)}><option value="all">전체</option><option value="error">오류</option><option value="warning">확인 필요</option><option value="info">참고</option></select><button className="icon" onClick={()=>setShowIssues(false)} title="닫기"><X size={17}/></button></div>
            <div className="issue-list">{visibleIssues.length?visibleIssues.map((i,j)=><button key={j} className={'issue '+i.severity} onClick={()=>navigateIssue(i.itemId)}><TriangleAlert size={14}/><span>{i.message}</span><ChevronRight size={14}/></button>):<p className="muted">표시할 검토 항목이 없습니다.</p>}</div>
          </div>}
        </>}
        {tab==='wiring'&&<WiringPage key={project.id+':'+wireFocus.version} project={project} catalog={catalog}
          device={wireFocus.id} review={wireFocus.review} onEdit={action=>Boolean(run({type:'wiring',action}))}
          onAddReceiver={()=>openCatalog({kind:'receiver'})} onMount={saveReceiverMounts}
          onOpenPart={navigateIssue} notify={notify} onExport={()=>{setFormal(false);setPopup('export');}}/>}
        {tab==='catalog'&&<section className="data-page">
          <div className="page-heading"><div><h1>장비 라이브러리</h1><p>폐쇄망에서 사용할 장비 정의를 관리합니다.</p></div></div>
          <div className="catalog-actions">
            <button className="btn primary" onClick={()=>{setEditDef(undefined);setPopup('editor');}}><Plus size={16}/> 장비 등록</button>
            <button className="btn" disabled={pending} onClick={catalogImport}><Upload size={16}/> 파일 반입</button>
            <button className="btn" disabled={pending} onClick={()=>catalogExport('csv')}>CSV 양식</button>
            <button className="btn" disabled={pending} onClick={()=>catalogExport('atecat')}>카탈로그 팩 저장</button>
          </div>
          <CatalogView catalog={catalog} onEdit={d=>{setEditDef(d);setPopup('editor');}}/>
        </section>}
        {tab==='bom'&&<section className="data-page">
          <div className="page-heading"><div><h1>부품명세서</h1><p>{bom.length}종 · 전체 장비 {bom.reduce((a,b)=>a+b.quantity,0)}개</p></div><button className="btn" onClick={()=>{setFormal(false);setPopup('export');}}><Download size={16}/> 내보내기</button></div>
          <div className="table-box"><table className="data-table"><thead><tr><th>품번 / 품명</th><th>제조사</th><th>Rev.</th><th>수량</th><th>조달</th><th>설치 위치</th></tr></thead><tbody>{bom.map((r,i)=><tr key={i}><td><b>{r.part}</b><small>{r.name}</small></td><td>{r.vendor}</td><td>{r.revision}</td><td>{r.quantity}</td><td>{r.procurement?'조달':'기보유/제외'}</td><td>{r.locations.join(' · ')}</td></tr>)}</tbody></table>{!bom.length&&<div className="empty-small">구성에 배치된 장비가 없습니다.</div>}</div>
        </section>}
      </main>

      {tab!=='wiring'&&<aside className="inspector">
        <div className="inspector-tabs"><button className={side==='detail'?'active':''} onClick={()=>setSide('detail')}><PanelRight size={15}/> 속성</button><button className={side==='ai'?'active':''} onClick={()=>setSide('ai')}><Sparkles size={15}/> 설계 AI {lastAuto&&<i/>}</button></div>
        {side==='ai'?<AssistantPanel settings={settings} progress={aiBusy} error={aiError} reply={reply} lastAuto={lastAuto} ask={ask} onApply={applyReply} project={project} openSettings={()=>setPopup('settings')}/>
          :<div className="inspector-body">
            {selectedItem?<Fragment key={selectedItem.id+':'+selectedItem.label}>
              <div className="item-heading"><span className="part-icon"><PartIcon kind={selectedItem.definition.kind}/></span><div><h3>{labelOf(selectedItem)}</h3><p>{selectedItem.definition.name}</p></div></div>
              <dl className="props">
                <dt>품번</dt><dd>{selectedItem.definition.part}</dd>
                <dt>제조사</dt><dd>{selectedItem.definition.vendor}</dd>
                <dt>유형</dt><dd>{kindNames[selectedItem.definition.kind]}</dd>
                <dt>인터페이스</dt><dd>{selectedItem.definition.standard}</dd>
                <dt>리비전</dt><dd>{selectedItem.definition.revision}</dd>
                {selectedCard&&<><dt>점유 슬롯</dt><dd>{occupied(selectedCh,selectedCard.definition,selectedCard.slot).map(s=>s.number).join(', ')}</dd></>}
                {selectedItem.definition.widthMm&&<><dt>패널 치수</dt><dd>{selectedItem.definition.widthMm} × {selectedItem.definition.heightMm||'—'} mm</dd></>}
                <dt>근거</dt><dd><span className={'tag '+selectedItem.definition.evidence}>{evidenceNames[selectedItem.definition.evidence]}</span></dd>
                <dt>출처</dt><dd>{selectedItem.definition.source||'미등록'}</dd>
              </dl>
              <ItemForm item={selectedItem} onSave={(label,procurement)=>{if(run({type:'itemInfo',id:selectedItem.id,label,procurement}))notify('장비 속성을 저장했습니다.');}}/>
              {selectedItem.definition.image&&<img className="detail-image" alt="장비 패널" src={selectedItem.definition.image}/>}
              {selectedIssues.length>0&&<div className="detail-issues">{selectedIssues.map((i,j)=><div key={j} className={'issue '+i.severity}><TriangleAlert size={14}/><span>{i.message}</span></div>)}</div>}
              <div className="detail-actions">
                {selectedCard&&<><button className="btn" onClick={()=>setPopup('move')}><Move size={15}/> 카드 이동</button><button className="btn" onClick={()=>openCatalog({kind:'module',chassisId:selectedCh.id,slot:selectedCard.slot,replace:selectedCard.id})}>카드 교체</button></>}
                {selectedItem.definition.kind!=='receiver'&&<button className="btn" onClick={()=>setPopup('ports')}><Plug size={15}/> 커넥터·핀</button>}
                <button className="btn" onClick={()=>openWiring(selectedItem.id)}><Cable size={15}/> {selectedItem.definition.kind==='receiver'?'리시버 모듈 배치':'와이어링 열기'}</button>
                <button className="btn" onClick={selectedUpdate}>카탈로그 정의 갱신</button>
                <button className="btn danger-btn" onClick={()=>remove(selectedItem)}><Trash2 size={15}/> 제거</button>
              </div>
            </Fragment>:selectedSlot?<div className="item-heading"><div><h3>슬롯 {selectedSlot.number}</h3><p>{roleNames[selectedSlot.role]} · {selectedSlot.accepts.join('/')}</p><button className="btn" onClick={()=>openCatalog({kind:'module',chassisId:selectedCh.id,slot:selectedSlot.number})}><Plus size={15}/> 모듈 추가</button></div></div>
            :<div className="empty-small">속성을 확인할 장비를 선택하세요.</div>}
          </div>}
      </aside>}
    </div>
    <footer className="statusbar">
      <span className="status-network"><i/> 로컬 실행</span><span>섀시 {project.chassis.length} · 카드 {totalCards} · 점유 {installed}/{totalSlots}</span>
      <button className={reports.length?'status-warnings':''} onClick={()=>{setTab('layout');setShowIssues(v=>!v);}}><Activity size={15}/> {reports.length?`검토 항목 ${reports.length}`:'배치 검토'}</button>
      <span className="status-spacer"/>
      <span>{settings.enabled&&settings.model?'사내 LLM 설정됨':'LLM 미연결'}</span>
      <span>v{VERSION}</span>
    </footer>
    {toast.text&&<div className={toast.error?'toast error':'toast'} role="status">{toast.error?<TriangleAlert size={18}/>:<Check size={18}/>} {toast.text}<button className="icon" onClick={()=>setToast({text:'',error:false})} aria-label="알림 닫기"><X size={15}/></button></div>}

    {popup==='catalog'&&<Modal title={target.kind==='module'?`${target.slot}번 슬롯 · 모듈 ${target.replace?'교체':'추가'}`:target.kind==='chassis'?'섀시 추가':target.kind==='receiver'?'리시버 추가':'독립 장비 / DUT 추가'} onClose={close} wide>
      <CatalogView catalog={catalog} kind={target.kind} target={project.chassis.find(x=>x.id===target.chassisId)} slot={target.slot} replace={target.replace} onPick={choosePart}/>
    </Modal>}
    {popup==='ports'&&selectedItem&&<Modal title={labelOf(selectedItem)+' 커넥터·핀'} onClose={close} wide>
      <PortForm ports={selectedItem.definition.connectors||[]} onClose={close} onError={m=>notify(m,true)} onSave={connectors=>{
        const impact=noteImpact([selectedItem.id]);
        if(impact&&!window.confirm('구성품 핀맵을 변경할까요?'+impact))return false;
        if(!run({type:'ports',id:selectedItem.id,connectors}))return false;
        close();return true;
      }}/></Modal>}
    {popup==='editor'&&<Modal title={editDef?'장비 정의 편집':'장비 등록'} onClose={close} wide><DefinitionForm initial={editDef} onSave={saveDef} onClose={close}/></Modal>}
    {popup==='settings'&&<Modal title="사내 LLM 연결 설정" onClose={close}><SettingsPanel initial={settings} onSaved={setSettings}/></Modal>}
    {popup==='project'&&<Modal title="프로젝트 정보" onClose={close}><ProjectForm project={project} onSave={(data)=>{if(run({type:'projectInfo',...data}))close();}} onSaveAs={()=>{close();void save(true);}}/></Modal>}
    {popup==='import'&&preview&&<Modal title="카탈로그 반입 확인" onClose={close} wide><ImportTable preview={preview} onClose={close} onApply={()=>void task(async()=>{changeCatalog(await api.commitCatalog(preview.token));close();notify(`${preview.items.length}개 품목 반입 완료`);})}/></Modal>}
    {popup==='export'&&<Modal title="설계 내보내기" onClose={close}>
      <div className="form"><label className="check-row"><input type="checkbox" checked={formal} onChange={e=>setFormal(e.target.checked)}/> 검토본으로 발행</label>
      <p className="muted">{formal?'오류와 확인 필요 항목을 모두 해소해야 합니다.':'초안에는 배치 검토 항목이 포함됩니다.'}</p>
      <div className="export-options">{[['pdf','배치도 PDF'],['png','배치도 PNG'],['xlsx','부품명세서 XLSX']].map(([format,name])=><button key={format} className="btn" disabled={pending} onClick={()=>exportFile(format)}>{format==='xlsx'?<FileSpreadsheet size={18}/>:<Download size={18}/>} {name}</button>)}</div></div>
    </Modal>}
    {popup==='move'&&selectedCard&&<Modal title="카드 이동" onClose={close}><MoveForm project={project} current={selectedCh.id} cardId={selectedCard.id} onMove={(chassisId,slot)=>{
      if(run({type:'move',id:selectedCard.id,chassisId,slot})){setSelection({chassisId,slot,itemId:selectedCard.id});close();}
    }}/></Modal>}
    {popup==='recovery'&&recovery&&<Modal title="자동 복구본 발견" onClose={close}><p>{recovery.name} · Rev. {recovery.revision}</p><div className="modal-actions"><button className="btn" onClick={()=>{void api.discardRecovery().catch(e=>notify(e.message,true));close();}}>복구본 지우기</button><button className="btn primary" onClick={()=>{newState(recovery,noFile,true);close();}}>복구본 열기</button></div></Modal>}
    {popup==='help'&&<Modal title="사용 안내" onClose={close}><div className="help-content"><ol><li>섀시를 추가하고 빈 슬롯을 눌러 모듈을 선택합니다.</li><li>정면도에서 모듈을 끌거나 속성에서 대상 섀시와 슬롯을 지정해 옮깁니다.</li><li>배치 검토 항목을 클릭해 확인할 장비로 이동합니다.</li><li>저장으로 .ateproj 파일을 만들고, 내보내기에서 배치도와 BOM을 출력합니다.</li><li>사내 LLM은 설정에서 주소와 모델을 저장하면 사용할 수 있습니다.</li></ol><p className="muted">카탈로그 버전 {catalogVersion}</p></div></Modal>}
  </div>;
}

function ItemForm({item,onSave}:{item:Item;onSave:(label:string,procurement:boolean)=>void}) {
  const [name,setName]=useState(item.label),[procure,setProcure]=useState(item.procurement);
  useEffect(()=>{setName(item.label);setProcure(item.procurement);},[item.label,item.procurement]);
  return <form className="item-form" onSubmit={e=>{e.preventDefault();onSave(name,procure);}}>
    <label>장비 별칭<input value={name} maxLength={150} onChange={e=>setName(e.target.value)} placeholder={item.definition.part}/></label>
    <label className="check-row"><input type="checkbox" checked={procure} onChange={e=>setProcure(e.target.checked)}/> BOM 조달 대상</label>
    <button className="btn compact" disabled={name===item.label&&procure===item.procurement}>속성 저장</button>
  </form>;
}

function ProjectForm({project,onSave,onSaveAs}:{project:Project;onSave:(data:Record<string,string>)=>void;onSaveAs:()=>void}) {
  const [name,setName]=useState(project.name),[revision,setRevision]=useState(project.revision),[notes,setNotes]=useState(project.notes);
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave({name,revision,notes});}}>
    <label>프로젝트 이름<input required value={name} onChange={e=>setName(e.target.value)} maxLength={150}/></label>
    <label>개정<input required value={revision} onChange={e=>setRevision(e.target.value)} maxLength={45}/></label>
    <label>프로젝트 메모<textarea rows={5} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={6000}/></label>
    <div className="modal-actions"><button type="button" className="btn" onClick={onSaveAs}>다른 이름으로 저장</button><button className="btn primary">프로젝트 정보 적용</button></div>
  </form>;
}

function MoveForm({project,current,cardId,onMove}:{project:Project;current:string;cardId:string;onMove:(c:string,n:number)=>void}) {
  const [chassis,setChassis]=useState(current),[slot,setSlot]=useState('');
  const c=project.chassis.find(x=>x.id===chassis);
  const card=project.chassis.flatMap(x=>x.placements).find(x=>x.id===cardId);
  const candidates=c.definition.slots.map(s=>({s,reason:placementIssues(c,card.definition,s.number,cardId).find(i=>i.severity==='error')}));
  return <form className="form" onSubmit={(e:FormEvent)=>{e.preventDefault();if(slot!=='')onMove(chassis,Number(slot));}}>
    <label>대상 섀시<select value={chassis} onChange={e=>{setChassis(e.target.value);setSlot('');}}>{project.chassis.map(x=><option key={x.id} value={x.id}>{labelOf(x)}</option>)}</select></label>
    <label>시작 슬롯<select value={slot} onChange={e=>setSlot(e.target.value)}><option value="">슬롯 선택</option>{candidates.map(({s,reason})=><option key={s.number} disabled={Boolean(reason)} value={s.number}>{s.number}번 {reason?'· '+reason.message:''}</option>)}</select></label>
    <div className="modal-actions"><button className="btn primary" disabled={!slot}>이동 적용</button></div>
  </form>;
}

createRoot(document.getElementById('root')).render(<App/>);
