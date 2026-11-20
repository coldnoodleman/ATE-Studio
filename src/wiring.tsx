import { useId, useMemo, useState } from 'react';
import { Cable as CableIcon, ChevronRight, Download, GitBranch, History, Layers3, Plus, Server, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { bindEndpoint, cableKinds, connectorGenders, defaultPlug, endpointReason, indexDevices, inspectEndpoint, matchingNetWires, resolvePickeringPins, wiringIssues } from '../wiring.mjs';
import { Modal } from './panels';
import { ReceiverPanel } from './receivers';
import { genderNames, pinNames } from './ports';
import type { Cable, Definition, Device, Endpoint, Item, Net, Plug, Port, Project, SaveReceiverMounts, Wire, WiringGroup, WiringRevision } from './types';

const labels:Record<string,string>={single:'단심',multicore:'다심',twisted:'트위스트 페어',coax:'동축'};
const absent=(deviceId='',portId=''):Endpoint=>({deviceId,portId,display:'',fingerprint:''});
const itemLabel=(item:Item)=>item.label||item.definition.part;
const uid=()=>crypto.randomUUID();
const api=window.studio;
type Entity='groups'|'nets'|'cables'|'revisions';
type Change={type:'save';entity:Entity;record:Cable|Net|WiringGroup|WiringRevision}|{type:'remove';entity:Entity;id:string};
type Tab='cables'|'nets'|'groups'|'receivers'|'revisions';
type Popup={kind:'cables'; row?:Cable; start?:Endpoint; end?:Endpoint} | {kind:'nets';row?:Net;start?:Endpoint} | {kind:'groups';row?:WiringGroup} | {kind:'revisions'} | null;

export function WiringPage({project,catalog,device,review,onEdit,onAddReceiver,onMount,onOpenPart,notify,onExport}:{
  project:Project;catalog:Definition[];device?:string;review?:string;
  onEdit:(action:Change)=>boolean;onAddReceiver:()=>void;onMount:SaveReceiverMounts;
  onOpenPart:(id:string)=>void;notify:(message:string,error?:boolean)=>void;onExport:()=>void;
}) {
  const w=project.wiring;
  const devices=useMemo(()=>indexDevices(project) as Map<string,Device>,[project]);
  const requested=w.cables.some(c=>c.id===review)?'cables':w.nets.some(n=>n.id===review)?'nets':w.groups.some(g=>g.id===review)?'groups':null;
  const [tab,setTab]=useState<Tab>(requested||(devices.get(device)?.definition.kind==='receiver'?'receivers':'cables'));
  const [focus,setFocus]=useState(review||'');
  const [popup,setPopup]=useState<Popup>(null),[filter,setFilter]=useState(''),[busy,setBusy]=useState(false);
  const issues=useMemo(()=>wiringIssues(project),[project]);
  const current=w.cables.find(c=>c.id===focus&&(!filter||c.groupId===filter))||w.cables.find(c=>!filter||c.groupId===filter);
  const withGroup=(row:{groupId?:string})=>!filter||row.groupId===filter;
  const close=()=>setPopup(null);
  const start=()=>{
    const d=devices.get(device), port=d?.definition.connectors?.[0];
    return d&&port?bindEndpoint(devices,d.id,port.id) as Endpoint:undefined;
  };
  const newCable=()=>{
    const endpoint=start();
    const receiver=devices.get(endpoint?.deviceId)?.definition.kind==='receiver';
    setPopup({kind:'cables',start:receiver?undefined:endpoint,end:receiver?endpoint:undefined});
  };
  const save=(entity:Entity,record:Cable|Net|WiringGroup|WiringRevision)=>{
    if(onEdit({type:'save',entity,record})){setFocus(record.id);close();return true;}
    return false;
  };
  async function sendCsv(format:string) {
    if(!current||busy)return;
    setBusy(true);
    try{const file=await api.exportPinCsv(project,current.id,format);if(file)notify(file.name+' 저장 완료');}
    catch(error){notify(error.message,true);}finally{setBusy(false);}
  }
  const remove=(entity:Entity,id:string)=>{if(window.confirm('선택한 항목을 삭제할까요?'))onEdit({type:'remove',entity,id});};
  const jump=(id:string)=>{
    const cable=w.cables.find(c=>c.id===id),net=w.nets.find(n=>n.id===id),group=w.groups.find(g=>g.id===id);
    if(cable||net||group){setFilter('');setTab(cable?'cables':net?'nets':'groups');setFocus(id);}
  };
  return <section className="data-page wiring-page">
    <div className="page-heading"><div><h1>와이어링 설계</h1><p>구성품의 커넥터, 신호, 리시버 후면 접점을 연결합니다.</p></div><button className="btn" onClick={onExport}><Download size={16}/> 설계 출력</button></div>
    <div className="wire-views">
      {([
        ['cables','케이블',CableIcon,w.cables.length],['receivers','리시버',Server,project.instruments.filter(d=>d.definition.kind==='receiver').length],
        ['nets','신호 연결',GitBranch,w.nets.length],['groups','서브시스템',Layers3,w.groups.length],['revisions','리비전 기록',History,w.revisions.length],
      ] as const).map(([key,title,Icon,num])=><button className={tab===key?'active':''} key={key} onClick={()=>setTab(key)}><Icon size={16}/> {title} <span>{num}</span></button>)}
    </div>
    {tab==='receivers'&&<ReceiverPanel receivers={project.instruments.filter(d=>d.definition.kind==='receiver')} focus={device} catalog={catalog} onAdd={onAddReceiver} onMount={onMount} onCable={(id,port)=>{
      setTab('cables');setPopup({kind:'cables',end:bindEndpoint(devices,id,port) as Endpoint});
    }}/>}
    {tab==='cables'&&<>
      <div className="wire-toolbar"><button className="btn primary" onClick={newCable}><Plus size={16}/> 케이블 추가</button><GroupSelect groups={w.groups} value={filter} onChange={v=>{setFilter(v);setFocus('');}} empty="모든 서브시스템"/></div>
      {w.cables.filter(withGroup).length?<div className="wire-split">
        <div className="wire-list">{w.cables.filter(withGroup).map(c=>{
          const error=issues.some(i=>i.itemId===c.id&&i.severity==='error');
          return <button type="button" key={c.id} className={current?.id===c.id?'active':''} onClick={()=>setFocus(c.id)}><span><b>{c.code}</b><small>{c.name||c.a.display+' · '+c.b.display}</small></span><span className={'tag '+(error?'unverified':'')}>{error?'재검토':c.wires.length+'선'}</span></button>;
        })}</div>
        {current&&<article className="wire-card cable-detail">
          <div className="section-head"><div><h3>{current.code} {current.name}</h3><p>{labels[current.kind]} · {current.lengthMm==null?'길이 미정':current.lengthMm+' mm'}{current.bundle?' · '+current.bundle:''}</p></div>
            <div className="inline-actions"><button className="btn" onClick={()=>setPopup({kind:'cables',row:current})}>케이블 편집</button><button className="icon danger-btn" aria-label="케이블 삭제" onClick={()=>remove('cables',current.id)}><Trash2 size={17}/></button></div>
          </div>
          <div className="cable-overview">
            <EndCard title="A측 · 계측 장비" value={current.a} mate={current.plugA} devices={devices} onOpen={onOpenPart}/>
            <div className="cable-run"><span/><b>{current.wires.length} 도체</b><span/></div>
            <EndCard title="B측 · 리시버 / 대상" value={current.b} mate={current.plugB} devices={devices} onOpen={onOpenPart}/>
          </div>
          <div className="table-box"><table className="data-table"><thead><tr><th>A측 핀</th><th>도체 / 신호</th><th>B측 핀</th><th>색상</th><th>AWG</th><th>페어</th></tr></thead><tbody>
            {current.wires.map(x=><tr key={x.id}><td>{x.a} <small>{x.aLabel}</small></td><td>{x.label||w.nets.find(n=>n.id===x.netId)?.name||'—'}</td><td>{x.b} <small>{x.bLabel}</small></td><td>{x.color||'—'}</td><td>{x.awg??current.awg??'—'}</td><td>{x.pair||'—'}</td></tr>)}
          </tbody></table></div>
          {!current.wires.length&&<div className="empty-small">케이블 편집에서 양단 핀을 연결하세요.</div>}
          <div className="cdt-tools"><b>Pickering CDT 핀맵</b><div className="inline-actions">
            <button className="btn compact" disabled={busy||!current.wires.length} onClick={()=>sendCsv('named')}><Download size={14}/> 핀맵 CSV</button>
            <button className="btn compact" disabled={busy||!current.wires.length} onClick={()=>sendCsv('flying')}><Download size={14}/> 리시버 Flying Lead CSV</button>
          </div><small>CDT에서 먼저 양단과 경로를 만든 뒤 Link Pins에서 가져옵니다. 리시버용은 접점 ID를 우측 리드 이름에 보존합니다.</small></div>
        </article>}
      </div>:<div className="wire-empty"><CableIcon size={25}/><h3>등록된 케이블이 없습니다</h3><p>두 구성품의 커넥터를 선택하고 도체별 핀을 매핑하세요.</p></div>}
    </>}
    {tab==='nets'&&<>
      <div className="wire-toolbar"><button className="btn primary" onClick={()=>setPopup({kind:'nets',start:start()})}><Plus size={16}/> 신호 추가</button><GroupSelect groups={w.groups} value={filter} onChange={setFilter} empty="모든 서브시스템"/></div>
      <div className="net-list">{w.nets.filter(withGroup).map(n=><article key={n.id} className={'wire-card '+(n.id===focus?'highlighted':'')}>
        <div className="section-head"><h3>{n.name}</h3><div className="inline-actions">
          <button className="btn compact" onClick={()=>setPopup({kind:'nets',row:n})}>편집</button>
          {n.ends.length>=2&&<button className="btn compact" onClick={()=>{
            setTab('cables');setPopup({kind:'cables',start:n.ends[0],end:n.ends[1]});
          }}>케이블 초안</button>}
          <button className="icon danger-btn" aria-label={'신호 삭제 '+n.name} onClick={()=>remove('nets',n.id)}><Trash2 size={16}/></button></div></div>
        <div className="net-points">{n.ends.map((e,i)=>{
          const p=inspectEndpoint(devices,e);
          return <button className={'net-point '+(p.status!=='ok'?'stale':'')} key={i} onClick={()=>onOpenPart(e.deviceId)} title={endpointReason(p.status)}><b>{p.display}</b><span>핀 {e.pin} {p.pin?.label||''}</span></button>;
        })}</div>
        {n.note&&<p>{n.note}</p>}
      </article>)}</div>
      {!w.nets.filter(withGroup).length&&<div className="wire-empty"><GitBranch size={25}/><h3>연결할 신호를 추가하세요</h3><p>하나의 신호에 두 개 이상의 장비 핀을 지정할 수 있습니다.</p></div>}
    </>}
    {tab==='groups'&&<>
      <div className="wire-toolbar"><button className="btn primary" onClick={()=>setPopup({kind:'groups'})}><Plus size={16}/> 서브시스템 추가</button></div>
      {w.groups.map(g=><article className={'wire-card '+(g.id===focus?'highlighted':'')} key={g.id}>
        <div className="section-head"><div><h3>{g.name}</h3><p>장비 {g.members.length} · 신호 {w.nets.filter(n=>n.groupId===g.id).length} · 케이블 {w.cables.filter(c=>c.groupId===g.id).length}</p></div>
          <div className="inline-actions"><button className="btn compact" onClick={()=>setPopup({kind:'groups',row:g})}>편집</button><button className="icon danger-btn" aria-label={'서브시스템 삭제 '+g.name} onClick={()=>remove('groups',g.id)}><Trash2 size={16}/></button></div></div>
        <div className="net-points">{g.members.map(id=><button className="net-point" key={id} onClick={()=>onOpenPart(id)}>{devices.get(id)?.label||'제거된 장비 '+id}</button>)}</div>{g.note&&<p>{g.note}</p>}
      </article>)}
      {!w.groups.length&&<div className="wire-empty"><Layers3 size={25}/><h3>서브시스템으로 구성품을 묶으세요</h3></div>}
    </>}
    {tab==='revisions'&&<>
      <div className="wire-toolbar"><button className="btn primary" onClick={()=>setPopup({kind:'revisions'})}><Plus size={16}/> 리비전 기록 추가</button></div>
      {w.revisions.length?<div className="table-box"><table className="data-table"><thead><tr><th>리비전</th><th>기록 시간</th><th>변경 설명</th><th>신호</th><th>케이블</th></tr></thead><tbody>{[...w.revisions].reverse().map(r=><tr key={r.id}><td>{r.name}</td><td>{new Date(r.at).toLocaleString('ko-KR')}</td><td>{r.note}</td><td>{r.netCount}</td><td>{r.cableCount}</td></tr>)}</tbody></table></div>:<div className="wire-empty"><History size={24}/><h3>남긴 리비전 기록이 없습니다</h3></div>}
    </>}
    {issues.length>0&&<details className="wire-card wiring-review" open={issues.some(i=>i.severity==='error')||undefined}><summary><TriangleAlert size={15}/> 와이어링 검토 · {issues.length}건</summary>
      <div className="issue-list">{issues.slice(0,150).map((i,j)=><button className={'issue '+i.severity} key={j} onClick={()=>jump(i.itemId)}><TriangleAlert size={14}/><span>{i.message}</span><ChevronRight size={14}/></button>)}</div></details>}
    {popup?.kind==='cables'&&<Modal title={popup.row?'케이블 편집':'케이블 추가'} onClose={close} wide><CableForm project={project} devices={devices} initial={popup.row} first={popup.start} last={popup.end} group={filter}
      onSave={row=>save('cables',row)} onClose={close}/></Modal>}
    {popup?.kind==='nets'&&<Modal title={popup.row?'신호 연결 편집':'신호 연결 추가'} onClose={close} wide>
      <NetForm devices={devices} project={project} initial={popup.row} start={popup.start} group={filter} onSave={row=>save('nets',row)} onClose={close}/>
    </Modal>}
    {popup?.kind==='groups'&&<Modal title={popup.row?'서브시스템 편집':'서브시스템 추가'} onClose={close}>
      <GroupForm devices={devices} initial={popup.row} onSave={row=>save('groups',row)} onClose={close}/>
    </Modal>}
    {popup?.kind==='revisions'&&<Modal title="리비전 기록 추가" onClose={close}><RevisionForm project={project} onSave={row=>save('revisions',row)}/></Modal>}
  </section>;
}

function GroupSelect({groups,value,onChange,empty='서브시스템 없음'}:{groups:WiringGroup[];value:string;onChange:(v:string)=>void;empty?:string}) {
  return <select aria-label="서브시스템" value={value||''} onChange={e=>onChange(e.target.value)}><option value="">{empty}</option>
    {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select>;
}

function EndCard({title,value,mate,devices,onOpen}:{title:string;value:Endpoint;mate:Plug;devices:Map<string,Device>;onOpen:(id:string)=>void}) {
  const found=inspectEndpoint(devices,value), r=found.port?.receiver;
  return <div className={'end-card '+(found.status==='ok'?'':'stale')}><small>{title}</small>
    <button type="button" onClick={()=>onOpen(value.deviceId)} disabled={!found.device}>{found.display}</button>
    {r?<><span>VPC {r.model} · 위치 {r.tier}.{r.position}</span><span>모듈 {r.module} · 후면 {r.termination} · {r.contactPart||'접점 미확인'}</span></>:
      <span>{found.port?.family||'규격 미확인'} · {mate.part||'케이블 측 품번 미정'}</span>}
    {found.status!=='ok'&&<span className="warn-text">{endpointReason(found.status)}</span>}
  </div>;
}

function EndpointFields({title,devices,value,onChange,withPin=false,preferred=''}:{
  title:string;devices:Map<string,Device>;value:Endpoint;onChange:(value:Endpoint)=>void;withPin?:boolean;preferred?:string;
}) {
  const d=devices.get(value.deviceId), port=d?.definition.connectors?.find(c=>c.id===value.portId);
  const choices=[...devices.values()].filter(i=>i.definition.connectors?.length||i.id===value.deviceId)
    .sort((a,b)=>Number(b.definition.kind===preferred)-Number(a.definition.kind===preferred));
  const missingDevice=value.deviceId&&!d;
  const inspected=value.fingerprint?inspectEndpoint(devices,value):null;
  const stale=inspected?.status&&inspected.status!=='ok';
  const validPin=!withPin||port?.pins.some(p=>p.id===value.pin);
  return <div className="wire-end-fields">
    <b>{title}</b><label>구성품
      <select aria-label={title+' 구성품'} required value={value.deviceId} onChange={e=>{
        const id=e.target.value,p=devices.get(id)?.definition.connectors?.[0];
        onChange(p&&!withPin?bindEndpoint(devices,id,p.id) as Endpoint:absent(id,p?.id));
      }}><option value="">구성품 선택</option>
        {missingDevice&&<option value={value.deviceId}>{value.display} · 제거됨</option>}
        {choices.map(x=><option key={x.id} value={x.id}>{x.label} · {x.definition.part} · {x.location}</option>)}</select>
    </label>
    <label>커넥터 / 리시버 위치<select aria-label={title+' 커넥터'} required value={value.portId} onChange={e=>{
      const id=e.target.value;onChange(id&&!withPin?bindEndpoint(devices,value.deviceId,id) as Endpoint:absent(value.deviceId,id));
    }}><option value="">선택</option>
      {value.portId&&!port&&<option value={value.portId}>{value.portId} · 사라진 커넥터</option>}
      {d?.definition.connectors?.map(p=><option key={p.id} value={p.id}>{p.id} · {p.name||p.family} · {p.pins.length}핀</option>)}
    </select></label>
    {withPin&&<label>핀<select aria-label={title+' 핀'} required value={value.pin||''} onChange={e=>{
      onChange(e.target.value?bindEndpoint(devices,value.deviceId,value.portId,e.target.value) as Endpoint:{...value,pin:''});
    }}><option value="">핀 선택</option>{value.pin&&!validPin&&<option value={value.pin}>{value.pin} · 사라진 핀</option>}
      {port?.pins.map(p=><option disabled={p.kind==='nc'} key={p.id} value={p.id}>{p.id} {p.label||''} · {pinNames[p.kind]}</option>)}</select></label>}
    {!choices.length&&<small className="warn-text">구성품 속성에서 핀맵을 등록하거나 리시버에 모듈을 장착하세요.</small>}
    {stale&&<small className="warn-text">{endpointReason(inspected.status)}</small>}
    {stale&&port&&validPin&&<button type="button" className="btn compact" onClick={()=>onChange(bindEndpoint(devices,value.deviceId,value.portId,value.pin) as Endpoint)}>현재 핀맵으로 재확인</button>}
  </div>;
}

const cleanEnd=(devices:Map<string,Device>,ref?:Endpoint)=>{
  if(!ref)return absent();
  const port=devices.get(ref.deviceId)?.definition.connectors?.find(p=>p.id===ref.portId);
  if(!port)return ref;
  const {pin,...end}=ref;
  return end;
};
const portFor=(devices:Map<string,Device>,ref:Endpoint)=>devices.get(ref.deviceId)?.definition.connectors?.find(p=>p.id===ref.portId);
const draftWire=(a='',b=''):Wire=>({id:uid(),a,b});
function CableForm({project,devices,initial,first,last,group,onSave,onClose}:{
  project:Project;devices:Map<string,Device>;initial?:Cable;first?:Endpoint;last?:Endpoint;group:string;onSave:(row:Cable)=>boolean;onClose:()=>void;
}) {
  const [draft,setDraft]=useState<Cable>(()=>{
    if(initial)return structuredClone(initial);
    let i=1,code=()=>`CBL-${String(i).padStart(3,'0')}`;
    while(project.wiring.cables.some(x=>x.code===code()))i++;
    const a=cleanEnd(devices,first), b=cleanEnd(devices,last);
    return {id:uid(),code:code(),name:'',groupId:group,a,b,plugA:defaultPlug(portFor(devices,a)),plugB:defaultPlug(portFor(devices,b)),kind:'multicore',wires:[]};
  });
  const pinListId=useId();
  const [csvMode,setCsvMode]=useState('named');
  const [err,setErr]=useState(''),[imported,setImported]=useState<{name:string;rows:Wire[]}|null>(null);
  const a=portFor(devices,draft.a),b=portFor(devices,draft.b);
  function change(value:Partial<Cable>) {setDraft(d=>({...d,...value}));setErr('');}
  function endChange(side:'a'|'b',endpoint:Endpoint) {
    const mate=side==='a'?'plugA':'plugB';
    const port=portFor(devices,endpoint), old=draft[side];
    const same=old.deviceId===endpoint.deviceId&&old.portId===endpoint.portId&&old.fingerprint===endpoint.fingerprint;
    change({[side]:endpoint,[mate]:same?draft[mate]:defaultPlug(port)});
    setImported(null);
    if(side==='b'&&!port?.receiver)setCsvMode('named');
  }
  function changeWire(i:number,patch:Partial<Wire>) {
    change({wires:draft.wires.map((w,j)=>j===i?{...w,...patch,...('a' in patch||'b' in patch?{netId:''}:{})}:w)});
  }
  async function loadCsv() {
    try {
      const file=await api.readPinCsv();if(!file)return;
      if(draft.kind==='twisted')throw new Error('CDT 2·4열 단일 도체 CSV는 트위스트 페어에 사용할 수 없습니다.');
      const rows=resolvePickeringPins(file.text,a,b,csvMode);
      setImported({name:file.name,rows});setErr('');
    } catch(error){setErr(error.message);}
  }
  function matching() {
    if(!a||!b){setErr('먼저 케이블 양쪽 커넥터를 정하세요.');return;}
    const found=matchingNetWires(project,draft).filter(w=>!draft.wires.some(x=>x.a===w.a||x.b===w.b));
    if(!found.length){setErr('현재 양단에 추가로 사용할 공통 신호가 없습니다.');return;}
    change({wires:[...draft.wires,...found]});
  }
  function addWire() {
    const left=a?.pins.find(p=>p.kind!=='nc'&&!draft.wires.some(w=>w.a===p.id));
    const right=b?.pins.find(p=>p.kind!=='nc'&&!draft.wires.some(w=>w.b===p.id));
    change({wires:[...draft.wires,draftWire(left?.id,right?.id)]});
  }
  const text=(key:keyof Cable,label:string,max=120)=><label>{label}<input value={String(draft[key]??'')} maxLength={max} onChange={e=>change({[key]:e.target.value})}/></label>;
  const num=(key:keyof Cable,label:string,max:number)=><label>{label}<input type="number" step="any" min="1" max={max} value={String(draft[key]??'')} onChange={e=>change({[key]:e.target.value?Number(e.target.value):undefined})}/></label>;
  return <form className="form" onSubmit={e=>{e.preventDefault();if(!draft.a.fingerprint||!draft.b.fingerprint){setErr('양쪽 커넥터를 선택하세요.');return;}onSave(draft);}}>
    <div className="form-grid">{text('code','케이블 번호',100)}{text('name','이름')}
      <label>서브시스템<GroupSelect groups={project.wiring.groups} value={draft.groupId} onChange={v=>change({groupId:v})}/></label>
      <label>종류<select value={draft.kind} onChange={e=>change({kind:e.target.value})}>{cableKinds.map(k=><option key={k} value={k}>{labels[k]}</option>)}</select></label>
    </div>
    <div className="form-grid">
      <EndpointFields title="A측" devices={devices} value={draft.a} onChange={e=>endChange('a',e)} preferred="module"/>
      <EndpointFields title="B측" devices={devices} value={draft.b} onChange={e=>endChange('b',e)} preferred="receiver"/>
      <MateFields side="A측" port={a} plug={draft.plugA} onChange={v=>change({plugA:v})}/>
      <MateFields side="B측" port={b} plug={draft.plugB} onChange={v=>change({plugB:v})}/>
    </div>
    <div className="form-grid">{num('lengthMm','길이 mm',10000000)}<label>길이 기준<select value={draft.measurement||'tip'} onChange={e=>change({measurement:e.target.value})}><option value="tip">끝단 간</option><option value="backshell">백셸 간</option><option value="cut">절단 길이</option></select></label>{num('awg','기본 AWG',50)}{text('cablePart','케이블 원재료 품번')}{text('bundle','하네스 ID',100)}{text('shield','실드 처리')}{text('sleeve','슬리브')}</div>
    <div className="section-head"><h3>도체별 양단 핀맵</h3><div className="inline-actions">
      <select aria-label="CDT CSV 연결 유형" value={csvMode} onChange={e=>{setCsvMode(e.target.value);setImported(null);}}><option value="named">일반 CDT 핀 번호</option><option value="flying" disabled={!b?.receiver}>리시버 Flying Lead</option></select>
      <button className="btn compact" type="button" disabled={!a||!b} onClick={()=>void loadCsv()}><Upload size={14}/> CDT CSV 가져오기</button>
      <button className="btn compact" type="button" disabled={!a||!b} onClick={matching}>신호에서 채우기</button>
      <button className="btn compact" type="button" disabled={!a||!b||draft.wires.length>=1024} onClick={addWire}><Plus size={14}/> 도체 추가</button></div>
    </div>
    {imported&&<div className="import-wire-preview"><b>{imported.name} · {imported.rows.length}개 핀쌍</b><span>{imported.rows.slice(0,5).map(w=>w.a+' ↔ '+w.b).join(' · ')}</span>
      <div className="inline-actions"><button type="button" className="btn compact" onClick={()=>{change({wires:[...draft.wires,...imported.rows]});setImported(null);}}>기존 도체 뒤에 추가</button>
      <button type="button" className="btn compact" onClick={()=>{change({wires:imported.rows});setImported(null);}}>현재 핀맵 교체</button><button type="button" className="icon" aria-label="가져오기 취소" onClick={()=>setImported(null)}><X size={15}/></button></div>
    </div>}
    <datalist id={pinListId+'-a'}>{a?.pins.filter(p=>p.kind!=='nc').map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</datalist>
    <datalist id={pinListId+'-b'}>{b?.pins.filter(p=>p.kind!=='nc').map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</datalist>
    {!!draft.wires.length&&<div className="wire-edit-scroll"><table className="data-table wire-edit"><thead><tr><th>A 핀</th><th>도체 / 신호</th><th>B 핀</th><th>색상</th><th>AWG</th><th>페어</th><th>제거</th></tr></thead>
      <tbody>{draft.wires.map((w,i)=><tr key={w.id}>
        <td><PinSelect title={`A측 도체 ${i+1} 핀`} list={pinListId+'-a'} value={w.a} change={v=>changeWire(i,{a:v})}/></td>
        <td><input aria-label={`도체 ${i+1} 표기`} value={w.label||''} maxLength={120} onChange={e=>changeWire(i,{label:e.target.value})}/>
        {w.netId&&<small>{project.wiring.nets.find(n=>n.id===w.netId)?.name||'연결된 신호 확인'}</small>}</td>
        <td><PinSelect title={`B측 도체 ${i+1} 핀`} list={pinListId+'-b'} value={w.b} change={v=>changeWire(i,{b:v})}/></td>
        <td><input aria-label={`도체 ${i+1} 색상`} value={w.color||''} maxLength={60} onChange={e=>changeWire(i,{color:e.target.value})}/></td>
        <td><input aria-label={`도체 ${i+1} AWG`} type="number" min={1} max={50} step="any" value={w.awg??''} onChange={e=>changeWire(i,{awg:e.target.value?Number(e.target.value):undefined})}/></td>
        <td><input aria-label={`도체 ${i+1} 페어`} value={w.pair||''} maxLength={50} onChange={e=>changeWire(i,{pair:e.target.value})}/></td>
        <td><button className="icon danger-btn" aria-label={`도체 ${i+1} 제거`} type="button" onClick={()=>change({wires:draft.wires.filter((_,j)=>j!==i)})}><Trash2 size={15}/></button></td>
      </tr>)}</tbody></table></div>}
    <label>제작 비고<textarea rows={2} value={draft.note||''} maxLength={1000} onChange={e=>change({note:e.target.value})}/></label>
    {err&&<p className="form-error">{err}</p>}
    <div className="modal-actions"><button className="btn" type="button" onClick={onClose}>취소</button><button className="btn primary">케이블 저장</button></div>
  </form>;
}
function PinSelect({title,list,value,change}:{title:string;list:string;value:string;change:(v:string)=>void}) {
  return <input aria-label={title} required list={list} maxLength={80} value={value} onChange={e=>change(e.target.value)}/>;
}

function MateFields({side,port,plug,onChange}:{side:string;port?:Port;plug:Plug;onChange:(v:Plug)=>void}) {
  const r=port?.receiver;
  if(!port)return <div/>;
  if(r)return <div className="wire-end-fields receiver-termination"><b>{side} 리시버 후면 종단</b>
    <span>{r.model} · {r.tier}.{r.position} · 모듈 {r.module}</span><span>{r.termination} · 접점 {r.contactPart||'미확인'}</span>
    <span>{r.minAwg!=null?`AWG ${r.minAwg}~${r.maxAwg}`:'AWG 범위는 접점 자료 확인'} · ITA {r.itaPart||'미확인'}</span>
    <button type="button" className="btn compact" onClick={()=>onChange(defaultPlug(port))}>장착 모듈의 후면 사양 적용</button>
  </div>;
  const field=(name:keyof Plug,title:string)=><label>{title}<input maxLength={120} value={plug[name]||''} onChange={e=>onChange({...plug,[name]:e.target.value})}/></label>;
  return <div className="wire-end-fields"><b>{side} 케이블 측 커넥터</b>
    <div className="form-grid">{field('part','커넥터 품번')}{field('family','규격')}
      <label>성별<select value={plug.gender||'unknown'} onChange={e=>onChange({...plug,gender:e.target.value})}>{connectorGenders.map(x=><option value={x} key={x}>{genderNames[x]}</option>)}</select></label>
      {field('backshell','백셸 품번')}
    </div>
  </div>;
}

function NetForm({devices,project,initial,start,group,onSave,onClose}:{
  devices:Map<string,Device>;project:Project;initial?:Net;start?:Endpoint;group:string;onSave:(r:Net)=>boolean;onClose:()=>void;
}) {
  const [row,setRow]=useState<Net>(()=>initial||{id:uid(),name:'',groupId:group,ends:[start?{...start,pin:''}:absent(),absent()]});
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave(row);}}>
    <div className="form-grid"><label>신호 이름<input required maxLength={120} value={row.name} onChange={e=>setRow({...row,name:e.target.value})}/></label>
      <label>서브시스템<GroupSelect groups={project.wiring.groups} value={row.groupId} onChange={groupId=>setRow({...row,groupId})}/></label></div>
    <div className="form-grid net-editor">
      {row.ends.map((ref,i)=><div key={i}>
        <EndpointFields title={`접점 ${i+1}`} devices={devices} value={ref} withPin onChange={value=>setRow({...row,ends:row.ends.map((e,n)=>n===i?value:e)})}/>
        {row.ends.length>2&&<button type="button" className="btn compact" onClick={()=>setRow({...row,ends:row.ends.filter((_,j)=>j!==i)})}>접점 제거</button>}
      </div>)}
    </div>
    <button type="button" className="btn align-left" disabled={row.ends.length>=64} onClick={()=>setRow({...row,ends:[...row.ends,absent()]})}><Plus size={15}/> 접점 추가</button>
    <label>설명<textarea rows={2} maxLength={500} value={row.note||''} onChange={e=>setRow({...row,note:e.target.value})}/></label>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn primary">신호 연결 저장</button></div>
  </form>;
}

function GroupForm({devices,initial,onSave,onClose}:{devices:Map<string,Device>;initial?:WiringGroup;onSave:(r:WiringGroup)=>boolean;onClose:()=>void}) {
  const [row,setRow]=useState<WiringGroup>(()=>initial||{id:uid(),name:'',note:'',members:[]});
  const ids=[...new Set([...devices.keys(),...row.members])];
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave(row);}}>
    <label>이름<input required maxLength={120} value={row.name} onChange={e=>setRow({...row,name:e.target.value})}/></label>
    <label>설명<textarea rows={2} maxLength={500} value={row.note} onChange={e=>setRow({...row,note:e.target.value})}/></label>
    <span>포함할 구성품</span><div className="group-members">{ids.map(id=><label key={id} className="check-row"><input type="checkbox" checked={row.members.includes(id)}
      onChange={e=>setRow({...row,members:e.target.checked?[...row.members,id]:row.members.filter(x=>x!==id)})}/>{devices.get(id)?.label||'제거된 장비 '+id} · {devices.get(id)?.location||''}</label>)}
    </div><div className="modal-actions"><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn primary">서브시스템 저장</button></div>
  </form>;
}

function RevisionForm({project,onSave}:{project:Project;onSave:(record:WiringRevision)=>boolean}) {
  const [name,setName]=useState(project.revision),[note,setNote]=useState('');
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave({id:uid(),name,at:new Date().toISOString(),note,cableCount:project.wiring.cables.length,netCount:project.wiring.nets.length});}}>
    <label>리비전<input maxLength={45} required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label>변경 설명<textarea rows={4} maxLength={1000} required value={note} onChange={e=>setNote(e.target.value)}/></label>
    <div className="modal-actions"><button className="btn primary">리비전 기록 저장</button></div>
  </form>;
}
