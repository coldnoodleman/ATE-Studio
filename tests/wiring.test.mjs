import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { seedCatalog } from '../catalog.mjs';
import { cleanDefinition, cleanProject, createProject, perform, uid } from '../domain.mjs';
import { sampleWiring } from '../wiring-sample.mjs';
import { bindEndpoint, indexDevices, inspectEndpoint, matchingNetWires, parsePickeringPins, pickeringCsv, receiverMountWiringImpact, resolvePickeringPins, wiringImpact, wiringIssues } from '../wiring.mjs';
import { makeReport, makeXlsx } from '../report.mjs';
const part=no=>seedCatalog.find(x=>x.part===no);
const edit=(p,entity,record)=>perform(p,{type:'wiring',action:{type:'save',entity,record}});
const withCable=(p,change)=>edit(p,'cables',{...p.wiring.cables[0],...change});
const addReceiver=def=>perform(createProject(),{type:'addInstrument',definition:def});
const mount=(p,mounts)=>perform(p,{type:'receiverMounts',id:p.instruments[0].id,mounts});

test('legacy ATE schema preserves components while adding an empty wiring graph',()=>{
  const p=createProject('기존 프로젝트');
  delete p.wiring; p.schema=1;
  const migrated=cleanProject(p);
  assert.equal(migrated.schema,2);
  assert.deepEqual(migrated.wiring,{groups:[],nets:[],cables:[],revisions:[]});
  assert.equal(migrated.id,p.id);assert.equal(migrated.name,p.name);
  assert.throws(()=>cleanProject({...p,schema:3}),/형식/);
});

test('9050 variant numbering, 9025/9075 and custom receivers share mount validation',()=>{
  const reference=part('310104368');
  const q=part('510150115');
  const t=part('510104136');
  assert.deepEqual(reference.receiver.tiers.map(x=>[x.id,x.positions.length,x.positions[0],x.positions.at(-1)]),[['A',25,'1','25'],['B',25,'1','25']]);
  assert.equal(q.connectors[0].pins.length,192);
  assert.equal(q.connectors[0].pins[0].id,'1A');
  assert.equal(q.connectors[0].pins.at(-1).id,'48D');
  assert.equal(t.connectors[0].pins.length,96);
  for(const [receiver,tier] of [['310104368','B'],['310104429','B'],['310104114','A'],['310104307','C']]){
    const x=addReceiver(part(receiver));
    const placed=mount(x,[{tier,position:'25',definition:q,contactPart:'610138216'}]);
    assert.equal(indexDevices(placed).values().next().value.definition.connectors[0].id,tier+'.25');
    assert.throws(()=>mount(x,[{tier,position:'26',definition:q}]),/없는 단 또는 위치/);
    assert.throws(()=>mount(x,[{tier,position:'25',definition:t,contactPart:'610138216'}]),/지원 목록/);
    assert.throws(()=>mount(x,[{tier,position:'25',definition:t},{tier,position:'25',definition:q}]),/중복/);
  }
  const vxi=addReceiver(part('310104272'));
  assert.throws(()=>mount(vxi,[{tier:'A',position:'1',definition:q}]),/어댑터/);
  const ok=mount(vxi,[{tier:'A',position:'1',definition:q,adapterPart:'510109179',adapterStart:'1'}]);
  assert.equal(ok.instruments[0].receiverMounts[0].adapterPart,'510109179');
  assert.throws(()=>mount(vxi,[{tier:'A',position:'3',definition:q,adapterPart:'510109179',adapterStart:'1'}]),/범위/);
  const custom=cleanDefinition({...reference,part:'CUSTOM-RECEIVER',receiver:{...reference.receiver,series:'Custom',tiers:[{id:'J',label:'단 1',mode:'discrete',positions:['P1','P2'],families:['VPC 90 Series']}]}});
  assert.equal(mount(addReceiver(custom),[{tier:'J',position:'P2',definition:t}]).instruments[0].receiverMounts[0].position,'P2');
});

test('receiver mounting checks module-specific pins and only reviews affected wiring',()=>{
  const project=sampleWiring();
  const receiver=project.instruments.at(-1);
  const [wired,unwired]=receiver.receiverMounts;
  const update=mounts=>perform(project,{type:'receiverMounts',id:receiver.id,mounts});
  const newMount={...wired,position:'2'};
  const added=update([wired,unwired,newMount]);
  assert.deepEqual(receiverMountWiringImpact(project,added,receiver.id),{cables:[],nets:[]});
  assert.deepEqual(receiverMountWiringImpact(project,update([unwired,wired]),receiver.id),{cables:[],nets:[]});
  const changed=update([unwired,{...wired,definition:part('510104136'),contactPart:'610110101'}]);
  const impact=receiverMountWiringImpact(project,changed,receiver.id);
  assert.deepEqual(impact.cables.map(c=>c.code),['CBL-001']);
  assert.equal(impact.nets.length,4);
  assert.throws(()=>update([wired,unwired,{...newMount,contactOverrides:[{pin:'12',part:'610138216'}]}]),/510150115.*'12'.*1A/);
  assert.doesNotThrow(()=>update([wired,unwired,{...newMount,contactOverrides:[{pin:'12A',part:'610138216'}]}]));
});

test('verified Pickering pin identities and VPC receiver termination',()=>{
  const d=part('42-153-104');
  assert.equal(d.connectors[0].pins[0].label,'A10');
  assert.equal(d.connectors[0].pins[18].kind,'ground');
  assert.equal(d.connectors[0].pins[19].label,'A1');
  assert.equal(d.connectors[0].pins[36].label,'C9');
  const p=sampleWiring(),c=p.wiring.cables[0];
  assert.deepEqual(wiringIssues(p),[]);
  assert.equal(c.plugB.part,'610138216');
  assert.equal(c.plugB.termination,'crimp');
  assert.throws(()=>withCable(p,{awg:30}),/22~28/);
  assert.throws(()=>withCable(p,{plugB:{...c.plugB,part:'UNKNOWN'}}),/접점 품번이 다릅니다/);
  assert.throws(()=>withCable(p,{plugA:{...c.plugA,gender:'male'}}),/성별이 같습니다/);
  assert.throws(()=>withCable(p,{wires:[...c.wires,{id:uid(),a:'37',b:'49A'}]}),/핀 49A/);
  assert.throws(()=>withCable(p,{wires:[...c.wires,{id:uid(),a:'20',b:'2C'}]}),/여러 도체/);
  const cross={...c.wires[0],b:c.wires[1].b,netId:''};
  assert.throws(()=>withCable(p,{wires:[cross,...c.wires.slice(2)]}),/서로 다른 신호/);
  assert.equal(matchingNetWires(p,{...c,wires:[]}).length,4);
});

test('slot move retains wiring, replacement and changed cavity cause repairable discrepancies',()=>{
  const p=sampleWiring(), cable=p.wiring.cables[0], rx=p.instruments.at(-1), ch=p.chassis[0];
  const moved=perform(p,{type:'move',id:cable.a.deviceId,chassisId:ch.id,slot:6});
  assert.deepEqual(wiringIssues(moved),[]);
  assert.equal(wiringImpact(moved,[cable.a.deviceId]).nets.length,4);
  const replacement=perform(moved,{type:'place',definition:part('42-153-104'),chassisId:ch.id,slot:6,replaceId:cable.a.deviceId});
  assert.equal(replacement.wiring.cables.length,1);
  assert(wiringIssues(replacement).some(x=>x.code==='wiring-end'&&x.message.includes('제거 또는 교체됨')));
  assert.throws(()=>pickeringCsv(replacement,cable.id,'flying'),/재|구성품/);
  const after=perform(p,{type:'receiverMounts',id:rx.id,mounts:rx.receiverMounts.filter(x=>x.tier==='B')});
  assert.equal(inspectEndpoint(indexDevices(after),cable.b).status,'port');
  assert(after.wiring.nets.every(n=>n.ends[1].portId==='A.1'));
  const newAssignment=perform(p,{type:'ports',id:cable.a.deviceId,connectors:[{...part('42-153-104').connectors[0],
    pins:part('42-153-104').connectors[0].pins.map(x=>x.id==='20'?{...x,label:'changed'}:x)}]});
  assert.equal(inspectEndpoint(indexDevices(newAssignment),cable.a).status,'changed');
  const repairedRef=bindEndpoint(indexDevices(newAssignment),cable.a.deviceId,'J1');
  const repaired=withCable(newAssignment,{a:repairedRef});
  assert(!wiringIssues(repaired).some(i=>i.itemId===cable.id&&i.code==='wiring-end'));
});

test('Pickering numeric and Flying Lead files preserve physical contacts, outputs include wiring',()=>{
  const p=sampleWiring(),c=p.wiring.cables[0], csv=pickeringCsv(p,c.id,'flying');
  const rows=parsePickeringPins(csv);
  assert.deepEqual(rows.map(w=>[w.a,w.b,w.bLabel]),[['20','1','1A'],['21','2','1B'],['22','3','2A'],['23','4','2B']]);
  const devices=indexDevices(p);
  const left=inspectEndpoint(devices,c.a).port, right=inspectEndpoint(devices,c.b).port;
  assert.equal(resolvePickeringPins(csv,left,right,'flying')[0].b,'1A');
  const numbered={...right,pins:[{id:'1',kind:'passive'},{id:'25',kind:'passive'}]};
  assert.equal(resolvePickeringPins('A1,20,1,25\n',left,numbered,'flying')[0].b,'25');
  assert.equal(resolvePickeringPins('A1,20,1,25\n',left,numbered,'named')[0].b,'1');
  assert.equal(parsePickeringPins('A Pin,B Pin\n8,9\n')[0].a,'8');
  assert.throws(()=>parsePickeringPins('1,2,3\n'),/2열/);
  assert.throws(()=>pickeringCsv(p,c.id,'named'),/숫자 핀/);
  assert.throws(()=>pickeringCsv(withCable(p,{kind:'twisted'}),c.id,'flying'),/트위스트 페어/);
  const files=unzipSync(makeXlsx(p,'초안','예제'));
  const workbook=strFromU8(files['xl/workbook.xml']);
  for(const sheet of ['케이블 목록','도체 핀맵','케이블 자재','신호 접점','리시버 배치'])assert(workbook.includes(sheet),sheet);
  assert(strFromU8(files['xl/worksheets/sheet5.xml']).includes('610138216'));
  assert(makeReport(p,'초안','예제').includes('VPC 9050 A.1'));
});


test('all 50 positions are usable and per-pin contact variants enforce the exact wire gauge',()=>{
  const ch=part('310104368'), q=part('510150115'), t=part('510104136');
  const bulk=mount(addReceiver(ch),ch.receiver.tiers.flatMap(x=>x.positions.map(position=>({
    tier:x.id,position,definition:q,contactPart:'610138216',
  }))));
  assert.equal(indexDevices(bulk).values().next().value.definition.connectors.length,50);
  const p=sampleWiring(),c=p.wiring.cables[0],rx=p.instruments.at(-1);
  let next=perform(p,{type:'receiverMounts',id:rx.id,mounts:[{tier:'A',position:'1',definition:t,
    contactPart:'610110101',contactOverrides:[{pin:'25',part:'610110167'}]}]});
  assert.throws(()=>perform(next,{type:'receiverMounts',id:rx.id,mounts:[{tier:'A',position:'1',definition:t,
    contactOverrides:[{pin:'25',part:'unknown'}]}]}),/지원 목록/);
  const d=indexDevices(next),b=bindEndpoint(d,rx.id,'A.1');
  const ref=inspectEndpoint(d,b).port;
  assert.equal(ref.pins.find(x=>x.id==='25').rearContact.part,'610110167');
  const a=bindEndpoint(d,p.chassis[0].placements[1].id,'J1');
  const custom={...c,id:uid(),code:'CBL-NEW',groupId:'',a,b,plugA:{family:'D-Sub 9',gender:'male',part:'training'},
    plugB:{family:ref.family,gender:'neutral',part:ref.receiver.contactPart,termination:'crimp'},awg:24,
    wires:[{id:uid(),a:'1',b:'25'}]};
  next=perform(next,{type:'wiring',action:{type:'remove',entity:'cables',id:c.id}});
  assert.throws(()=>edit(next,'cables',custom),/26~28/);
  const repaired=edit(next,'cables',{...custom,awg:28});
  const csv=pickeringCsv(repaired,custom.id,'flying');
  assert.deepEqual(parsePickeringPins(csv).map(row=>[row.a,row.bLabel]),[['1','25']]);
});
