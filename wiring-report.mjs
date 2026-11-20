import { emptyWiring, indexDevices, inspectEndpoint, endpointReason, wiringIssues } from './wiring.mjs';

const term=(m)=>[m.part,m.termination,m.backshell].filter(Boolean).join(' · ');
const kindLabels={single:'단심',multicore:'다심',twisted:'트위스트 페어',coax:'동축'};
const measureLabels={tip:'끝단 간',backshell:'백셸 간',cut:'절단 길이'};
export function wiringReport(project) {
  const devices=indexDevices(project),w=project.wiring??emptyWiring();
  const groups=new Map(w.groups.map(g=>[g.id,g.name]));
  const nets=new Map(w.nets.map(n=>[n.id,n.name]));
  const wireIssues=wiringIssues(project);
  const issuesBy=new Map();
  for(const i of wireIssues){const existing=issuesBy.get(i.itemId)||[];existing.push(i);issuesBy.set(i.itemId,existing);}
  const named=(ref,pin='')=>{
    const endpoint=inspectEndpoint(devices,ref), r=endpoint.port?.receiver, pinData=endpoint.port?.pins.find(p=>p.id===(pin||ref.pin));
    return {display:endpoint.display, location:endpoint.device?.location||'', part:endpoint.device?.definition.part||'',
      port:ref.portId,pin:pin||ref.pin||'',signal:pinData?.label||'',contact:pinData?.rearContact?.part||r?.contactPart||'',reason:endpointReason(endpoint.status),
      receiver:r?[r.model,r.tier+'.'+r.position,r.module,r.contactPart||'접점 미확인'].join(' / '):''};
  };
  const cables=w.cables.map(c=>{
    const a=named(c.a), b=named(c.b);
    const issues=issuesBy.get(c.id)||[];
    const status=issues.some(i=>i.severity==='error')?'재검토':issues.length?'확인 필요':'규칙 일치';
    return {...c,aName:a,bName:b,groupName:groups.get(c.groupId)||'',typeName:kindLabels[c.kind],measurementName:measureLabels[c.measurement]||'',
      terminationA:term(c.plugA),terminationB:term(c.plugB),status,
      rows:c.wires.map(wire=>{
        const aPin=named(c.a,wire.a), bPin=named(c.b,wire.b);
        return {...wire,aLabel:wire.aLabel||aPin.signal,bLabel:wire.bLabel||bPin.signal,aContact:aPin.contact,bContact:bPin.contact,
          netName:nets.get(wire.netId)||'',gauge:wire.awg??c.awg??''};
      }),
    };
  });
  const signalRows=w.nets.flatMap(n=>n.ends.map(e=>{
    const v=named(e);
    return [groups.get(n.groupId)||'',n.name,v.display,v.location,v.part,v.pin,v.signal,v.receiver,v.reason,n.note];
  }));
  const placements=project.instruments.filter(i=>i.definition.kind==='receiver').flatMap(i=>(i.receiverMounts??[]).map(m=>[
    i.label||i.definition.part,i.definition.part,i.definition.receiver.series,m.tier,m.position,m.definition.part,
    m.definition.receiverModule.series,m.definition.connectors[0].pins.length,m.definition.receiverModule.termination,
    m.contactPart,m.definition.receiverModule.itaPart,m.adapterPart,m.adapterStart,m.definition.source,
  ]));
  const materials=new Map(), shared=new Set();
  function material(type,part,quantity,unit){
    if(!part)return;
    const key=JSON.stringify([type,part,unit]);
    const r=materials.get(key)||[type,part,0,unit];
    r[2]+=quantity;materials.set(key,r);
  }
  for(const c of cables){
    if(c.cablePart&&c.lengthMm!=null)material('케이블 원재료',c.cablePart,c.lengthMm,'mm');
    for(const [ref,mate] of [[c.a,c.plugA],[c.b,c.plugB]]){
      const r=inspectEndpoint(devices,ref).port?.receiver;
      if(r){
        if(r.termination==='crimp')for(const row of c.rows)material('리시버 접점',ref===c.a?row.aContact:row.bContact,1,'개');
      }else{
        const key=JSON.stringify([c.bundle,ref.deviceId,ref.portId,mate.part,mate.backshell]);
        if(!c.bundle||!shared.has(key)){
          material('케이블 커넥터',mate.part,1,'개');material('백셸',mate.backshell,1,'개');shared.add(key);
        }
      }
    }
  }
  return {cables,signalRows,placements,materials:[...materials.values()],revisions:w.revisions};
}
