import { sampleProject, perform, uid } from './domain.mjs';
import { bindEndpoint, defaultPlug, indexDevices } from './wiring.mjs';
import { seedCatalog } from './catalog.mjs';

export function sampleWiring() {
  let project=sampleProject(seedCatalog);
  const find=part=>seedCatalog.find(d=>d.part===part);
  project=perform(project,{type:'projectInfo',name:'ATE → VPC 9050 배선 예제',revision:'A',notes:'Pickering 42-153-104와 VPC 9050의 제조사 접점을 사용한 시연입니다. 두 장비 사이의 핀 배정과 길이는 교육용 설계 예시입니다.'});
  project=perform(project,{type:'place',definition:find('42-153-104'),slot:4,chassisId:project.chassis[0].id,label:'PICK-01'});
  project=perform(project,{type:'addInstrument',definition:find('310104368'),label:'RCV-01'});
  const receiver=project.instruments.at(-1), mux=project.chassis[0].placements.find(p=>p.definition.part==='42-153-104');
  project=perform(project,{type:'receiverMounts',id:receiver.id,mounts:[
    {tier:'A',position:'1',definition:find('510150115'),contactPart:'610138216'},
    {tier:'B',position:'1',definition:find('510150115'),contactPart:'610138216'},
  ]});
  const devices=indexDevices(project), groupId=uid(), nets=[];
  project=perform(project,{type:'wiring',action:{type:'save',entity:'groups',record:{id:groupId,name:'스위칭 인터페이스',members:[mux.id,receiver.id]}}});
  for(const [i,contact] of ['1A','1B','2A','2B'].entries()){
    const source=['20','21','22','23'][i],name=['A1','C1','A2','C2'][i];
    const net={id:uid(),name,groupId,ends:[bindEndpoint(devices,mux.id,'J1',source),bindEndpoint(devices,receiver.id,'A.1',contact)]};
    project=perform(project,{type:'wiring',action:{type:'save',entity:'nets',record:net}});
    nets.push(net);
  }
  const a=bindEndpoint(devices,mux.id,'J1'),b=bindEndpoint(devices,receiver.id,'A.1');
  return perform(project,{type:'wiring',action:{type:'save',entity:'cables',record:{
    id:uid(),code:'CBL-001',name:'Pickering J1 · VPC 9050 A.1',groupId,a,b,kind:'multicore',lengthMm:850,awg:24,
    plugA:{...defaultPlug(devices.get(mux.id).definition.connectors[0]),part:'40-960-037-F'},
    plugB:defaultPlug(devices.get(receiver.id).definition.connectors[0]),bundle:'H-01',sleeve:'교육용 사양',
    wires:nets.map((n,i)=>({id:uid(),label:n.name,a:n.ends[0].pin,b:n.ends[1].pin,color:['WH','BK','GN','BU'][i],netId:n.id})),
  }}});
}
