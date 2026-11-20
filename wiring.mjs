import { parseCsv, csvRows } from './csv.mjs';
import { receiverPorts } from './receiver.mjs';

export const connectorGenders = ['male','female','neutral','unknown'];
export const pinKinds = ['passive','in','out','io','power','ground','shield','nc'];
export const cableKinds = ['single','multicore','twisted','coax'];
export const emptyWiring = () => ({groups:[],nets:[],cables:[],revisions:[]});
const uuid = () => globalThis.crypto.randomUUID();

function assert(ok, message) {
  if (!ok) throw new Error(message);
}
function string(value, title, max=120, required=false) {
  const clean=(value??'');
  assert(typeof clean==='string'&&clean.length<=max&&(!required||clean.trim()), `${title}을(를) 확인하세요.`);
  return clean.trim();
}
function token(value, title) {
  const id=string(value,title,80,true);
  assert(/^[A-Za-z0-9_.-]+$/.test(id), `${title}에는 영문, 숫자, 점, 밑줄, 하이픈을 사용하세요.`);
  return id;
}
function array(value, limit, title) {
  assert(Array.isArray(value)&&value.length<=limit, `${title}은(는) 최대 ${limit}개입니다.`);
  return value;
}
function enumValue(value, options, title, fallback) {
  const actual=value??fallback;
  assert(options.includes(actual), `${title}을(를) 선택하세요.`);
  return actual;
}
function distinct(rows, key, title) {
  const seen=new Set();
  for (const row of rows) {
    const id=key(row);
    assert(!seen.has(id), `${title}이(가) 중복됩니다: ${id}`);
    seen.add(id);
  }
  return rows;
}
function number(value,min,max,title) {
  if (value==null||value==='') return null;
  assert(typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max,`${title}은(는) ${min}~${max} 범위입니다.`);
  return value;
}

export function cleanConnectors(input=[]) {
  const result=array(input,48,'장비 커넥터').map(c=>{
    assert(c&&typeof c==='object','커넥터 정보를 확인하세요.');
    const pins=array(c.pins,1000,'커넥터 핀').map(p=>({
      id:token(p?.id,'핀 번호'), label:string(p.label,'신호명'),
      kind:enumValue(p.kind,pinKinds,'핀 역할','passive'),
    }));
    assert(pins.length>0,'커넥터에는 핀이 한 개 이상 필요합니다.');
    return {
      id:token(c.id,'커넥터 ID'), name:string(c.name,'커넥터 이름'),
      family:string(c.family,'커넥터 규격',120,true),
      gender:enumValue(c.gender,connectorGenders,'커넥터 성별','unknown'),
      part:string(c.part,'장비 커넥터 품번'), source:string(c.source,'핀맵 출처',300),
      pins:distinct(pins,p=>p.id.toUpperCase(),'핀 번호'),
    };
  });
  return distinct(result,c=>c.id.toUpperCase(),'커넥터 ID');
}

function end(e,pin=false) {
  assert(e&&typeof e==='object','연결할 장비와 커넥터를 지정하세요.');
  const value={deviceId:token(e.deviceId,'장비 ID'),portId:token(e.portId,'커넥터 ID'),
    fingerprint:string(e.fingerprint,'커넥터 검토 식별값',128,true), display:string(e.display,'장비 표시명',260,true)};
  if (pin) value.pin=token(e.pin,'핀 번호');
  return value;
}

function plug(p={}) {
  return {family:string(p.family,'케이블 측 커넥터 규격'),part:string(p.part,'케이블 측 커넥터 품번'),
    gender:enumValue(p.gender,connectorGenders,'케이블 측 커넥터 성별','unknown'), termination:string(p.termination,'종단 방식',60), backshell:string(p.backshell,'백셸 품번')};
}

function cleanWire(w) {
  return {
    id:token(w?.id,'도체 ID'), a:token(w.a,'A측 핀'), b:token(w.b,'B측 핀'),
    aLabel:string(w.aLabel,'A측 핀 이름'), bLabel:string(w.bLabel,'B측 핀 이름'),
    label:string(w.label,'도체 표기'), color:string(w.color,'도체 색상',60), awg:number(w.awg,1,50,'도체 AWG'),
    pair:string(w.pair,'트위스트 페어',50), note:string(w.note,'배선 비고',400),
    netId:w.netId?token(w.netId,'신호 ID'):'',
  };
}

export function cleanWiring(value={}) {
  assert(value&&typeof value==='object'&&!Array.isArray(value),'와이어링 데이터 형식을 확인하세요.');
  const groups=array(value.groups??[],80,'서브시스템').map(g=>({
    id:token(g?.id,'서브시스템 ID'), name:string(g.name,'서브시스템 이름',120,true), note:string(g.note,'서브시스템 설명',500),
    members:distinct(array(g.members,250,'서브시스템 장비').map(id=>token(id,'장비 ID')),id=>id,'장비'),
  }));
  const nets=array(value.nets??[],1200,'신호 연결').map(n=>{
    const ends=distinct(array(n.ends,64,'신호 접점').map(e=>end(e,true)),e=>keyOf(e),'신호 접점');
    assert(ends.length>=2,'신호 연결에는 두 개 이상의 핀이 필요합니다.');
    return {id:token(n.id,'신호 ID'),name:string(n.name,'신호 이름',120,true),note:string(n.note,'신호 설명',500),
      groupId:n.groupId?token(n.groupId,'서브시스템 ID'):'',ends};
  });
  const cables=array(value.cables??[],500,'케이블').map(c=>({
    id:token(c.id,'케이블 ID'),code:string(c.code,'케이블 번호',100,true),name:string(c.name,'케이블 이름'),
    groupId:c.groupId?token(c.groupId,'서브시스템 ID'):'', a:end(c.a), b:end(c.b), plugA:plug(c.plugA),plugB:plug(c.plugB),
    bundle:string(c.bundle,'하네스 ID',100), cablePart:string(c.cablePart,'원재료 품번'), kind:enumValue(c.kind,cableKinds,'케이블 유형','multicore'),
    measurement:enumValue(c.measurement,['tip','backshell','cut'],'길이 기준','tip'),
    lengthMm:number(c.lengthMm,1,10_000_000,'케이블 길이 mm'), awg:number(c.awg,1,50,'케이블 AWG'),
    shield:string(c.shield,'실드 처리',120), sleeve:string(c.sleeve,'슬리브',120), note:string(c.note,'제작 비고',1000),
    wires:distinct(array(c.wires,1024,'도체').map(cleanWire),w=>w.id,'도체 ID'),
  }));
  assert(cables.reduce((n,c)=>n+c.wires.length,0)<=20_000,'프로젝트는 도체 20,000개까지 저장할 수 있습니다.');
  const revisions=array(value.revisions??[],200,'리비전 기록').map(r=>({
    id:token(r.id,'리비전 기록 ID'),name:string(r.name,'리비전',60,true),at:string(r.at,'기록 시간',50,true),note:string(r.note,'변경 설명',1000,true),
    cableCount:number(r.cableCount,0,500,'케이블 수'),netCount:number(r.netCount,0,1200,'신호 수'),
  }));
  return {
    groups:distinct(distinct(groups,g=>g.id,'서브시스템 ID'),g=>g.name.toLowerCase(),'서브시스템 이름'),
    nets:distinct(distinct(nets,n=>n.id,'신호 ID'),n=>JSON.stringify([n.groupId,n.name.toLowerCase()]),'신호 이름'),
    cables:distinct(distinct(cables,c=>c.id,'케이블 ID'),c=>c.code.toLowerCase(),'케이블 번호'),
    revisions:distinct(revisions,r=>r.id,'리비전 기록 ID'),
  };
}

export function indexDevices(project) {
  const devices=new Map();
  const put=(item,location)=>devices.set(item.id,{...item,location,label:item.label||item.definition.part,
    definition:item.definition.kind==='receiver'?{...item.definition,connectors:receiverPorts(item)}:item.definition});
  for(const chassis of project.chassis) {
    const label=chassis.label||chassis.definition.part;
    put(chassis,label);
    for(const card of chassis.placements) put(card,`${label} · 슬롯 ${card.slot}`);
  }
  for(const item of project.instruments)put(item,'독립 장비');
  return devices;
}

const portKey = e => JSON.stringify([e.deviceId,e.portId]);
export const keyOf = e => JSON.stringify([e.deviceId,e.portId,e.pin]);
const signatureCache=new WeakMap();
function signature(device,port) {
  const cache=signatureCache.get(port);
  const model=JSON.stringify([device.definition.vendor,device.definition.part,device.definition.revision]);
  if(cache?.model===model)return cache.value;
  const pins=port.pins.map(p=>[p.id,p.label,p.kind,p.rearContact?.part,p.rearContact?.minAwg,p.rearContact?.maxAwg]).sort((a,b)=>a[0].localeCompare(b[0],'en'));
  const input=JSON.stringify([model,port.family,port.gender,port.part,port.receiver?.minAwg,port.receiver?.maxAwg,port.receiver?.termination,pins]);
  let first=2166136261, second=2246822507;
  for(let i=0;i<input.length;i++) {
    const c=input.charCodeAt(i);
    first=Math.imul(first^c,16777619);second=Math.imul(second^c,2654435761);
  }
  const value=[first,second].map(x=>(x>>>0).toString(16).padStart(8,'0')).join('');
  signatureCache.set(port,{model,value});
  return value;
}

export function inspectEndpoint(devices,ref) {
  const device=devices.get(ref?.deviceId);
  const port=device?.definition.connectors?.find(c=>c.id===ref.portId);
  const pin=ref?.pin?port?.pins.find(p=>p.id===ref.pin):null;
  let status='ok';
  if(!device)status='device';
  else if(!port)status='port';
  else if(ref.pin&&!pin)status='pin';
  else if(signature(device,port)!==ref.fingerprint)status='changed';
  return {device,port,pin,status,display:device?`${device.label} · ${ref.portId}`:ref?.display??'미지정'};
}

export function bindEndpoint(devices,deviceId,portId,pin='') {
  const device=devices.get(deviceId);
  const port=device?.definition.connectors?.find(c=>c.id===portId);
  assert(port,'구성품의 커넥터를 지정하세요. 커넥터는 장비 속성에서 등록할 수 있습니다.');
  assert(!pin||port.pins.some(p=>p.id===pin),`${portId}에 핀 ${pin}이 없습니다.`);
  return {deviceId,portId,display:`${device.label} · ${portId}`,fingerprint:signature(device,port),...(pin?{pin}:{})};
}

export function defaultPlug(port) {
  if(!port)return plug();
  if(port.receiver)return {...plug(),family:port.family,gender:'neutral',part:port.receiver.contactPart,termination:port.receiver.termination};
  const gender=port.gender==='male'?'female':port.gender==='female'?'male':port.gender;
  return {...plug(),family:port.family,gender};
}

const endReasons={device:'구성품이 제거 또는 교체됨',port:'커넥터가 없음',pin:'핀 번호가 없음',changed:'품번·리비전 또는 커넥터 핀맵 변경'};
export const endpointReason = status => endReasons[status]??'';

export function wiringIssues(project) {
  const wiring=project.wiring??emptyWiring();
  if(!wiring.cables.length&&!wiring.nets.length&&!wiring.groups.length)return [];
  const issues=[], devices=indexDevices(project), memberships=new Map(), netPins=new Map(), cablePins=new Map(), portsInUse=new Map(), cableEdges=new Map();
  const push=(owner,severity,code,message)=>issues.push({itemId:owner.id,severity,code,message:`${owner.code||owner.name} · ${message}`});
  const pairs=(map,key,value)=>{const rows=map.get(key)||[];rows.push(value);map.set(key,rows);};
  const resolve=(owner,ref,side)=>{
    const inspection=inspectEndpoint(devices,ref);
    if(inspection.status!=='ok')push(owner,'error','wiring-end',`${side} ${ref.display}: ${endpointReason(inspection.status)}. 접점을 다시 확인하세요.`);
    else if(!inspection.port.source)push(owner,'warning','wiring-evidence',`${side} ${ref.display}: 핀맵 출처 확인 필요.`);
    return inspection;
  };
  const checkGroup=(owner,ends)=>{
    if(!owner.groupId)return;
    const members=memberships.get(owner.groupId);
    if(!members)push(owner,'error','wiring-group','서브시스템을 찾을 수 없습니다.');
    else for(const deviceId of new Set(ends.map(e=>e.deviceId))) if(!members.has(deviceId))push(owner,'error','wiring-member',`${devices.get(deviceId)?.label||deviceId} 장비가 서브시스템에 포함되어 있지 않습니다.`);
  };
  for(const group of wiring.groups) {
    memberships.set(group.id,new Set(group.members));
    for(const id of group.members)if(!devices.has(id))push(group,'warning','wiring-group-device',`제거된 장비 ${id}가 목록에 남아 있습니다.`);
  }
  for(const net of wiring.nets) {
    checkGroup(net,net.ends);
    let outputs=0;
    for(const ref of net.ends) {
      const result=resolve(net,ref,ref.pin);
      if(result.pin?.kind==='nc')push(net,'error','wiring-nc',`${result.display} / ${ref.pin} 핀은 NC입니다.`);
      if(result.pin?.kind==='out')outputs++;
      pairs(netPins,keyOf(ref),net);
    }
    if(outputs>1)push(net,'warning','wiring-outputs','출력 핀이 둘 이상 연결되어 있습니다.');
  }
  for(const [key,nets] of netPins) if(nets.length>1)for(const n of nets)push(n,'error','wiring-net-duplicate',`동일한 핀이 신호 ${nets.map(x=>x.name).join(', ')}에 중복됩니다. 핀 ${JSON.parse(key)[2]}.`);

  for(const cable of wiring.cables) {
    const {a,b}=cable;
    checkGroup(cable,[a,b]);
    if(portKey(a)===portKey(b))push(cable,'error','wiring-self','케이블 양 끝이 동일한 커넥터입니다.');
    const ends=[resolve(cable,a,'A측'),resolve(cable,b,'B측')];
    for(const [i,ref] of [a,b].entries()) {
      const mate=[cable.plugA,cable.plugB][i], result=ends[i], side=i?'B측':'A측';
      if(result.status==='ok')pairs(portsInUse,portKey(ref),{cable,mate,side});
      const receiver=result.port?.receiver;
      if(receiver&&mate.termination!==receiver.termination)push(cable,'error','wiring-termination',`${side}에 ${receiver.termination} 후면 종단을 지정하세요.`);
      if(receiver&&receiver.contactPart&&mate.part!==receiver.contactPart)push(cable,'error','wiring-contact',`${side} 케이블 종단과 리시버 접점 품번이 다릅니다.`);
      if(receiver&&!mate.part&&receiver.contactPart)push(cable,'warning','wiring-contact-evidence',`${side} 리시버 후면 접점 사양을 확인하세요.`);
      if(result.port&&mate.family&&result.port.family.toLowerCase()!==mate.family.toLowerCase())push(cable,'error','wiring-family',`${side} 커넥터 규격이 장비와 다릅니다.`);
      if(result.port&&['male','female'].includes(result.port.gender)&&result.port.gender===mate.gender)push(cable,'error','wiring-gender',`${side} 장비 커넥터와 케이블 커넥터의 성별이 같습니다.`);
      if(result.port&&!receiver&&(!mate.part||!mate.family||mate.gender==='unknown'||result.port.gender==='unknown'))push(cable,'warning','wiring-mate',`${side} 맞물림 커넥터 품번·규격·성별 확인 필요.`);
    }
    if(!cable.wires.length)push(cable,'warning','wiring-empty','도체 핀맵이 비어 있습니다.');
    if(cable.lengthMm==null)push(cable,'warning','wiring-length','케이블 길이가 입력되지 않았습니다.');
    const leftPins=new Map(ends[0].port?.pins.map(p=>[p.id,p]));
    const rightPins=new Map(ends[1].port?.pins.map(p=>[p.id,p]));
    const pairGroups=new Map();
    for(const w of cable.wires) {
      if(w.pair)pairs(pairGroups,w.pair,w);
      const aPin=leftPins.get(w.a), bPin=rightPins.get(w.b);
      if(ends[0].port&&!aPin)push(cable,'error','wiring-pin',`A측 핀 ${w.a}가 없습니다.`);
      if(ends[1].port&&!bPin)push(cable,'error','wiring-pin',`B측 핀 ${w.b}가 없습니다.`);
      for(const [side,inspection] of ends.entries()){
        const r=inspection.port?.receiver, awg=w.awg??cable.awg;
        const pin=side?bPin:aPin;
        if(!r||!pin)continue;
        const contact=pin.rearContact??{part:r.contactPart,minAwg:r.minAwg,maxAwg:r.maxAwg};
        if(!contact.part&&r.termination==='crimp')push(cable,'warning','wiring-contact-evidence',`${side?'B':'A'}측 핀 ${pin.id}: 후면 접점 품번 확인 필요.`);
        if((contact.minAwg!=null||contact.maxAwg!=null)&&awg==null)push(cable,'warning','wiring-awg-missing',`${side?'B':'A'}측 핀 ${pin.id}: 리시버 접점에 사용할 도체 AWG 확인 필요.`);
        if(awg!=null&&((contact.minAwg!=null&&awg<contact.minAwg)||(contact.maxAwg!=null&&awg>contact.maxAwg)))push(cable,'error','wiring-contact-awg',`${side?'B':'A'}측 핀 ${pin.id}: ${contact.part} 접점의 AWG ${contact.minAwg??'—'}~${contact.maxAwg??'—'} 범위를 벗어났습니다.`);
      }
      if(aPin?.kind==='nc'||bPin?.kind==='nc')push(cable,'error','wiring-nc',`핀 ${w.a} / ${w.b}에 NC가 포함되어 있습니다.`);
      const k1=keyOf({...a,pin:w.a}),k2=keyOf({...b,pin:w.b});
      if(ends[0].status==='ok'&&aPin)pairs(cablePins,k1,{cable,side:'A',wire:w});
      if(ends[1].status==='ok'&&bPin)pairs(cablePins,k2,{cable,side:'B',wire:w});
      const n1=netPins.get(k1)?.[0],n2=netPins.get(k2)?.[0];
      if(n1&&n2&&n1.id!==n2.id)push(cable,'error','wiring-cross-net',`핀 ${w.a} / ${w.b}가 서로 다른 신호 ${n1.name} / ${n2.name}를 연결합니다.`);
      if(w.netId&&(!n1||!n2||w.netId!==n1.id||w.netId!==n2.id))push(cable,'error','wiring-net-link',`핀 ${w.a} / ${w.b}가 지정한 신호에 속하지 않습니다.`);
      if(n1&&n2&&n1.id===n2.id&&aPin&&bPin&&ends.every(e=>e.status==='ok'))pairs(cableEdges,n1.id,[k1,k2]);
    }
    for(const [name,rows] of pairGroups)if(rows.length!==2)push(cable,'warning','wiring-pair',`트위스트 페어 ${name}의 도체 수가 ${rows.length}개입니다.`);
  }
  for(const uses of portsInUse.values()) {
    if(uses.length<2)continue;
    const first=uses[0];
    if(uses.every(u=>u.cable.bundle&&u.cable.bundle===first.cable.bundle&&JSON.stringify(u.mate)===JSON.stringify(first.mate)))continue;
    for(const u of uses)push(u.cable,'error','wiring-port-in-use',`${u.side}측 커넥터에 다른 케이블이 연결되어 있습니다. 분기는 동일 하네스와 동일 커넥터 사양을 지정하세요.`);
  }
  for(const [key,uses] of cablePins)if(uses.length>1)for(const {cable,side} of uses)push(cable,'error','wiring-duplicate-pin',`${side}측 핀 ${JSON.parse(key)[2]}가 여러 도체에 지정되어 있습니다.`);
  for(const net of wiring.nets) {
    const edges=cableEdges.get(net.id)||[], included=new Set([keyOf(net.ends[0])]);
    let prior=0;
    while(prior<included.size){
      prior=included.size;
      for(const [from,to] of edges)if(included.has(from)||included.has(to)){included.add(from);included.add(to);}
    }
    if(net.ends.some(ref=>!included.has(keyOf(ref))))push(net,'warning','wiring-open-net','일부 접점이 케이블 도체로 이어져 있지 않습니다.');
  }
  return [...new Map(issues.map(i=>[JSON.stringify([i.itemId,i.code,i.message]),i])).values()];
}

export function wiringImpact(project,itemIds) {
  const ids=new Set(itemIds), w=project.wiring??emptyWiring();
  return {cables:w.cables.filter(c=>ids.has(c.a.deviceId)||ids.has(c.b.deviceId)),
    nets:w.nets.filter(n=>n.ends.some(e=>ids.has(e.deviceId))),groups:w.groups.filter(g=>g.members.some(id=>ids.has(id)))};
}

export function receiverMountWiringImpact(before,after,receiverId) {
  function portSignatures(project) {
    const receiver=project.instruments.find(item=>item.id===receiverId);
    return new Map(receiverPorts(receiver).map(port=>[port.id,signature(receiver,port)]));
  }
  const previous=portSignatures(before), next=portSignatures(after);
  const changed=ref=>ref.deviceId===receiverId&&previous.get(ref.portId)!==next.get(ref.portId);
  const wiring=before.wiring??emptyWiring();
  return {cables:wiring.cables.filter(c=>changed(c.a)||changed(c.b)),
    nets:wiring.nets.filter(n=>n.ends.some(changed))};
}

export function editWiring(project,action) {
  const before=project.wiring??emptyWiring();
  const value=structuredClone(before);
  const name=action.entity;
  assert(['groups','nets','cables','revisions'].includes(name),'지원되는 배선 편집을 선택하세요.');
  if(action.type==='remove') {
    if(name==='groups')assert(![...value.cables,...value.nets].some(x=>x.groupId===action.id),'연결된 신호와 케이블에서 서브시스템을 먼저 해제하세요.');
    const at=value[name].findIndex(row=>row.id===action.id);
    assert(at>=0,'삭제할 항목을 찾을 수 없습니다.');
    value[name].splice(at,1);
    if(name==='nets')for(const c of value.cables)for(const w of c.wires)if(w.netId===action.id)w.netId='';
  } else if(action.type==='save') {
    const row=structuredClone(action.record);
    row.id ||= uuid();
    const at=value[name].findIndex(x=>x.id===row.id);
    if(at<0)value[name].push(row);
    else value[name][at]=row;
  } else throw new Error('지원되는 배선 편집을 선택하세요.');
  const wiring=cleanWiring(value);
  const issues=wiringIssues({...project,wiring});
  const errors=issues.filter(x=>x.severity==='error');
  if(errors.length) {
    const old=new Set(wiringIssues(project).filter(i=>i.severity==='error').map(i=>JSON.stringify([i.itemId,i.code,i.message])));
    const blocking=errors.find(i=>!old.has(JSON.stringify([i.itemId,i.code,i.message])));
    assert(!blocking,blocking?.message);
  }
  return wiring;
}

export function matchingNetWires(project,cable) {
  const wires=[];
  for(const net of (project.wiring??emptyWiring()).nets) {
    if(cable.groupId&&net.groupId!==cable.groupId)continue;
    const a=net.ends.filter(p=>portKey(p)===portKey(cable.a));
    const b=net.ends.filter(p=>portKey(p)===portKey(cable.b));
    if(a.length===1&&b.length===1&&a[0].fingerprint===cable.a.fingerprint&&b[0].fingerprint===cable.b.fingerprint) {
      wires.push({id:uuid(),a:a[0].pin,b:b[0].pin,label:net.name,netId:net.id});
    }
  }
  return wires;
}

export function parsePickeringPins(raw) {
  const rows=parseCsv(String(raw).replace(/^\ufeff/,''));
  const first=rows[0];
  if(first&&((first.length===2&&first.every(v=>/pin|핀/i.test(v)))||
    (first.length===4&&(/pin|핀/i.test(first[1])&&/pin|핀/i.test(first[2])))))rows.shift();
  assert(rows.length>0&&rows.length<=1024,'핀맵은 1~1,024행으로 입력하세요.');
  const width=rows[0].length;
  assert([2,4].includes(width)&&rows.every(row=>row.length===width),
    'CDT 단일 도체 핀맵의 2열 또는 이름 포함 4열 형식만 지원합니다.');
  return rows.map((r,i)=>{
    const [aLabel,a,b,bLabel]=width===2?['',r[0],r[1],'']:r;
    try{return cleanWire({id:uuid(),a,b,aLabel,bLabel});}
    catch(error){throw new Error(`CSV ${i+1}행 · ${error.message}`);}
  });
}

export function resolvePickeringPins(raw,left,right,mode='named') {
  assert(left&&right,'양단 커넥터를 먼저 지정하세요.');
  assert(['named','flying'].includes(mode),'CSV 연결 유형을 확인하세요.');
  if(mode==='flying')assert(right.receiver,'Flying Lead CSV는 B측에 리시버 접점을 지정하세요.');
  const leftPins=new Set(left.pins.map(p=>p.id)),rightPins=new Set(right.pins.map(p=>p.id));
  return parsePickeringPins(raw).map(w=>{
    const contact=mode==='flying'?w.bLabel.split(/\s+/)[0]:w.b;
    assert(leftPins.has(w.a)&&rightPins.has(contact),`핀 ${w.a} / ${contact||'접점 이름 없음'}가 현재 양단에 없습니다.`);
    return {...w,b:contact};
  });
}

export function pickeringCsv(project,cableId,format='named') {
  const cable=project.wiring?.cables.find(c=>c.id===cableId);
  assert(cable?.wires.length,'내보낼 케이블 핀맵이 비어 있습니다.');
  const issue=wiringIssues(project).find(x=>x.itemId===cable.id&&x.severity==='error');
  assert(!issue,issue?.message);
  assert(cable.kind!=='twisted'&&!cable.wires.some(w=>w.pair),'트위스트 페어는 이 CDT 단일 도체 CSV 형식으로 저장할 수 없습니다. 프로젝트 XLSX에서 페어 정보를 확인하세요.');
  const devices=indexDevices(project);
  const ports=[inspectEndpoint(devices,cable.a).port,inspectEndpoint(devices,cable.b).port];
  const [left,right]=ports.map(p=>new Map(p.pins.map(pin=>[pin.id,pin.label])));
  assert(['named','plain','flying'].includes(format),'CDT CSV 출력 형식을 확인하세요.');
  if(format==='flying'){
    assert(ports[1].receiver,'B측에 리시버 후면 접점을 지정하세요.');
    assert(cable.wires.every(w=>/^\d+$/.test(w.a)),'CDT Flying Lead CSV의 A측은 CDT 숫자 핀 번호가 필요합니다.');
    return csvRows(cable.wires.map((w,i)=>[w.aLabel||left.get(w.a)||'',w.a,i+1,
      [w.b,w.bLabel||right.get(w.b)||''].filter(Boolean).join(' ')]));
  }
  assert(cable.wires.every(w=>/^\d+$/.test(w.a)&&/^\d+$/.test(w.b)),
    'CDT 일반 CSV에는 양단 숫자 핀 번호가 필요합니다. 리시버 접점은 Flying Lead CSV 또는 배선표 XLSX를 사용하세요.');
  return csvRows(cable.wires.map(w=>format==='named'?[w.aLabel||left.get(w.a)||'',w.a,w.b,w.bLabel||right.get(w.b)||'']:[w.a,w.b]));
}
