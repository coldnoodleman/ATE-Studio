import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanProject, perform, createProject } from '../domain.mjs';
import { sampleWiring } from '../wiring-sample.mjs';
import { autoLinkWires, bindEndpoint, defaultPlug, draftCablesFromNets, indexDevices, inspectEndpoint, wiringIssues } from '../wiring.mjs';
import { buildDrawing, drawingLinePoints, emptyDrawing, exportDrawingSvg } from '../drawing.mjs';
import { editWorkspace, emptyWorkspace, exportWorkspaceFolder, findDesign, importWorkspaceFolder, workspaceIndex } from '../workspace.mjs';

test('workspace saves with a generation check and exported project copies remain independent',()=>{
  let workspace=editWorkspace(emptyWorkspace(),{type:'folderNew',name:'9050 검토',customer:'내부 시험'});
  const folderId=workspace.folders[0].id;
  const change=op=>{workspace=editWorkspace(workspace,{folderId,...op});};
  change({type:'designNew',name:'배선',kind:'cable',project:sampleWiring()});
  const designId=workspace.folders[0].designs[0].id;
  const read=()=>findDesign(workspace,designId).design;
  change({type:'revisionNew',designId,name:'Rev A',note:'원본'});
  change({type:'commentAdd',designId,text:'부품명 확인'});
  change({type:'attachmentAdd',attachment:{name:'note.txt',data:'dGVzdA=='}});
  const commentId=workspace.folders[0].comments[0].id;
  change({type:'commentReply',commentId,text:'확인'});
  const original=read().project;
  const saved=perform(original,{type:'projectInfo',name:'케이블 9050',revision:'B',notes:''});
  change({type:'designSave',designId,generation:0,project:saved});
  assert.equal(read().generation,1);
  assert.equal(read().revisions[0].project.revision,'A');
  assert.throws(()=>change({type:'designSave',designId,generation:0,project:saved}),/다른 작업/);
  change({type:'designLock',designId});
  assert.throws(()=>change({type:'designSave',designId,generation:2,project:saved}),/잠긴/);
  const packet=JSON.parse(JSON.stringify(exportWorkspaceFolder(workspace,folderId)));
  workspace=importWorkspaceFolder(workspace,packet);
  const copied=workspace.folders.at(-1);
  assert.notEqual(copied.designs[0].project.id,original.id);
  assert.equal(copied.comments[0].designId,copied.designs[0].id);
  assert.equal(copied.comments[0].replies[0].text,'확인');
  assert.equal(copied.designs[0].locked,false);
  assert.deepEqual(copied.designs[0].project.wiring.cables,read().project.wiring.cables);
  const index=workspaceIndex(workspace);
  assert(!('project' in index.folders[0].designs[0]));
  assert(!('data' in index.folders[0].attachments[0]));
});

test('system, schematic and cable workspace sync preserve project identity',()=>{
  const start=editWorkspace(emptyWorkspace(),{type:'folderNew',name:'ATE'});
  const folderId=start.folders[0].id;
  const example=sampleWiring();
  let workspace=editWorkspace(start,{type:'designNew',folderId,kind:'system',name:'System',project:example});
  for(const kind of ['schematic','cable'])workspace=editWorkspace(workspace,{type:'designNew',folderId,kind,name:kind,project:example});
  workspace=editWorkspace(workspace,{type:'designNew',folderId,kind:'system',name:'Target'});
  const [system,schematic,cable,target]=workspace.folders[0].designs;
  for(const source of [system,schematic,cable])workspace=editWorkspace(workspace,{type:'designSync',folderId,designId:target.id,sourceDesignId:source.id});
  const next=findDesign(workspace,target.id).design;
  assert.equal(next.project.id,target.project.id);
  assert.equal(next.generation,3);
  assert.equal(next.project.wiring.cables.length,1);
  assert.deepEqual(wiringIssues(next.project),[]);
});

test('diagram routes and branch annotations round-trip without altering conductor mappings',()=>{
  const legacy=createProject();
  delete legacy.drawings;
  assert.deepEqual(cleanProject(legacy).drawings.harness,emptyDrawing());
  const example=sampleWiring(),c=example.wiring.cables[0];
  const drawing={positions:[],marks:[{id:'branch',kind:'junction',text:'분기 <1>',x:240,y:140}],routes:[{id:c.id,via:[{junction:'branch'},{x:320,y:130}]}]};
  const changed=perform(example,{type:'drawing',mode:'harness',drawing});
  const fresh=cleanProject(JSON.parse(JSON.stringify(changed)));
  assert.deepEqual(fresh.wiring,example.wiring);
  assert.deepEqual(drawingLinePoints(buildDrawing(fresh,'harness').lines[0]).slice(1,-1),[[240,140],[320,130]]);
  const svg=exportDrawingSvg(fresh,'harness');
  assert(svg.includes('분기 &lt;1&gt;'));
  assert(svg.includes('CBL-001'));
  assert.throws(()=>perform(example,{type:'drawing',mode:'harness',drawing:{...drawing,marks:[]}}),/분기점/);
});

test('pin auto-link omits occupied pins, and two-point nets become a validated cable draft',()=>{
  const port={pins:[{id:'1',kind:'passive'},{id:'2',kind:'passive'},{id:'3',kind:'nc'},{id:'4',kind:'passive'}]};
  assert.deepEqual(autoLinkWires(port,port,'reverse',[{a:'2',b:'2'}]).map(w=>[w.a,w.b]),[['1','4'],['4','1']]);
  const example=sampleWiring();
  assert.equal(draftCablesFromNets(example).skipped.length,4);
  const remove={type:'wiring',action:{type:'remove',entity:'cables',id:example.wiring.cables[0].id}};
  const plan=perform(example,remove);
  const generated=draftCablesFromNets(plan,plan.wiring.groups[0].id);
  assert.equal(generated.cables.length,1);
  assert.deepEqual(generated.cables[0].wires.map(w=>[w.a,w.b]),[['20','1A'],['21','1B'],['22','2A'],['23','2B']]);
  const updated=perform(plan,{type:'cableDrafts',cables:generated.cables});
  assert.equal(updated.wiring.cables.length,1);
  assert.equal(wiringIssues(updated).filter(x=>x.severity==='error').length,0);
});

test('loopback reuses one connector and cable bundles save as a single edit',()=>{
  const example=sampleWiring(),previous=example.wiring.cables[0];
  const source=perform(example,{type:'wiring',action:{type:'remove',entity:'cables',id:previous.id}});
  const devices=indexDevices(source),end=previous.a;
  const mate=defaultPlug(inspectEndpoint(devices,end).port);
  const loop={id:'loop',code:'LP-1',kind:'loopback',a:end,b:end,plugA:mate,plugB:mate,wires:[{id:'link',a:'1',b:'2'}]};
  const save=record=>perform(source,{type:'wiring',action:{type:'save',entity:'cables',record}});
  const withLoop=save(loop);
  assert.equal(wiringIssues(withLoop).filter(i=>i.severity==='error').length,0);
  assert.throws(()=>save({...loop,wires:[{id:'bad',a:'1',b:'1'}]}),/같은 핀/);
  const [left,right]=[...devices.values()].filter(d=>['DEMO-MUX','DEMO-DUT'].includes(d.definition.part));
  const a=bindEndpoint(devices,left.id,left.definition.connectors[0].id),b=bindEndpoint(devices,right.id,right.definition.connectors[0].id);
  const extra={...loop,id:'extra',code:'CBL-002',kind:'multicore',a,b,plugA:defaultPlug(left.definition.connectors[0]),plugB:defaultPlug(right.definition.connectors[0]),wires:[{id:'extra-wire',a:'1',b:'2'}]};
  const withExtra=perform(withLoop,{type:'wiring',action:{type:'save',entity:'cables',record:extra}});
  const bundled=perform(withExtra,{type:'cableBundle',ids:['loop','extra'],bundle:'H-22'});
  assert.deepEqual(bundled.wiring.cables.map(c=>c.bundle),['H-22','H-22']);
  assert(!withExtra.wiring.cables.some(c=>c.bundle));
});
