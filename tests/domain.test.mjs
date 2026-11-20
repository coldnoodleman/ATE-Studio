import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { unzipSync,strFromU8 } from 'fflate';
import { buildBOM, cleanDefinition, cleanProject, createProject, occupied, perform, placementIssues, projectIssues, sampleProject } from '../domain.mjs';
import { catalogCsvTemplate, loadCatalogCsv, planCatalogImport, seedCatalog } from '../catalog.mjs';
import { addressClass, endpoint, fingerprint, interpretReply, makeContext } from '../llm.mjs';
import { acquire, loadProject, store, writeProject } from '../store.mjs';
import { makeReport, makeXlsx } from '../report.mjs';
const get=part=>seedCatalog.find(x=>x.part===part);

test('slot role, width, overlap, hybrid compatibility and stable identity',()=>{
  const project=sampleProject(seedCatalog);
  const ch=project.chassis[0];
  const place=(definition,slot)=>perform(project,{type:'place',definition,chassisId:ch.id,slot});
  assert.equal(placementIssues(ch,get('DEMO-PXI-OLD'),4)[0].code,'hybrid');
  assert.throws(()=>place(get('DEMO-MATRIX'),8),/연속/);
  assert.throws(()=>place(get('DEMO-MATRIX'),4),/겹칩니다/);
  assert.throws(()=>place(get('DEMO-CTRL'),6),/역할/);
  assert.throws(()=>place(get('DEMO-DIO'),1),/역할/);
  const updated=place(get('DEMO-MATRIX'),6);
  const card=updated.chassis[0].placements.at(-1);
  assert.deepEqual(occupied(ch,card.definition,card.slot).map(x=>x.number),[6,7]);
  const moved=perform(updated,{type:'move',id:card.id,chassisId:ch.id,slot:7});
  assert.equal(moved.chassis[0].placements.at(-1).id,card.id);
  assert.equal(moved.chassis[0].placements.at(-1).slot,7);
  assert(projectIssues(project).some(i=>i.code==='chassis-evidence'));
});

test('BOM coalesces identical revisions and separates procurement',()=>{
  const sample=sampleProject(seedCatalog);
  const muxes=sample.chassis[0].placements.filter(x=>x.definition.part==='DEMO-MUX');
  assert.equal(buildBOM(sample).find(x=>x.part==='DEMO-MUX').quantity,2);
  const edited=perform(sample,{type:'itemInfo',id:muxes[0].id,label:'MUX A',procurement:false});
  assert.deepEqual(buildBOM(edited).filter(x=>x.part==='DEMO-MUX').map(r=>[r.quantity,r.procurement]),[[1,false],[1,true]]);
  assert.equal(buildBOM(edited).find(x=>x.part==='DEMO-DUT').procurement,false);
});

test('CSV quote handling, duplicate catalogue rejection and snapshot isolation',async()=>{
  const defs=loadCatalogCsv(catalogCsvTemplate());
  assert.equal(defs[0].slots.length,8);
  assert.throws(()=>planCatalogImport([defs[0],defs[0]],seedCatalog),/중복/);
  assert.throws(()=>loadCatalogCsv('kind,vendor,part,name\nmodule,test,test,test'),/모듈 인터페이스|점유 슬롯/);
  const d=await mkdtemp(path.join(tmpdir(),'ate-store-'));
  try {
    const db=store(d);
    const p=sampleProject(seedCatalog);
    const def={...get('DEMO-MUX'),name:'조정된 품명'};
    db.importCatalog([def]);
    assert.equal(db.list().find(x=>x.part==='DEMO-MUX').name,def.name);
    assert.notEqual(p.chassis[0].placements[1].definition.name,def.name);
    db.close();
  } finally {await rm(d,{recursive:true,force:true});}
});

test('atomic save, recovery, and exclusive write lock',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ate-test-'));
  const file=path.join(dir,'시험.ateproj');
  try {
    const release=await acquire(file);
    assert.equal(await acquire(file),null);
    const p=sampleProject(seedCatalog);
    await writeProject(file,p);
    const q={...p,revision:'B'};
    await writeProject(file,q);
    assert.equal((await loadProject(file)).project.revision,'B');
    await writeFile(file,'corrupt');
    assert.deepEqual(await loadProject(file),{project:cleanProject(p),recovered:true});
    await writeProject(file,q);
    assert.equal(JSON.parse(await readFile(file+'.bak','utf8')).revision,'A');
    await release();
    const again=await acquire(file);
    assert(again);
    await again();
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('LLM endpoint normalization and validated proposals',()=>{
  assert.equal(endpoint('http://localhost:8080/v1/chat/completions').href,'http://localhost:8080/v1');
  assert.equal(addressClass('127.0.0.1'),'private');assert.equal(addressClass('169.254.169.254'),'blocked');
  assert.equal(addressClass('8.8.8.8'),'routed');assert.throws(()=>endpoint('http://a:b@private.local/'),/프로토콜/);
  const p=sampleProject(seedCatalog);
  const {context,refs}=makeContext(p,seedCatalog,'MUX','draft');
  assert(!JSON.stringify(context).includes(p.notes));
  const ref=context.catalog.find(d=>d.part==='DEMO-MUX').ref;
  const valid={action:'place', ref, target:p.chassis[0].id,slot:4};
  const parsed=interpretReply(JSON.stringify({answer:'ok',proposals:[valid,valid,{...valid,ref:'P900'}]}),p,refs);
  assert.equal(parsed.operations.length,1);
  assert.equal(parsed.suggestions.filter(x=>x.status==='rejected').length,2);
  assert.equal(p.chassis[0].placements.length,4);
  assert.notEqual(fingerprint(p),fingerprint(parsed.draft));
});

test('XLSX and report sanitize cell data and keep placement quantities',()=>{
  const project=sampleProject(seedCatalog);
  project.name='<script>name</script>';
  const p=makeReport(project,'초안','sample');
  assert(!p.includes('<script>'));
  assert(p.includes('&lt;script&gt;'));
  const files=unzipSync(makeXlsx(project,'초안','sample'));
  const sheet=strFromU8(files['xl/worksheets/sheet1.xml']);
  assert(sheet.includes('DEMO-MUX'));
  assert(sheet.includes('<v>2</v>'));
  assert(strFromU8(files['xl/worksheets/sheet3.xml']).includes('&lt;script&gt;'));
  assert.throws(()=>cleanDefinition({...get('DEMO-MUX'),image:'https://example.org/file.png'}),/PNG/);
});
