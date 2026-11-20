import assert from 'node:assert/strict';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createProject, perform, sampleProject, buildBOM } from './domain.mjs';
import { seedCatalog } from './catalog.mjs';
import { sampleWiring } from './wiring-sample.mjs';
import { writeProject, loadProject } from './store.mjs';

export async function runSelfTest({db,renderExport,checkedStatus,window,openFile}) {
  const output=path.resolve(process.env.ATE_TEST_OUTPUT || 'ate-self-test');
  await mkdir(output,{recursive:true});
  const call=(fn,...args)=>window.webContents.executeJavaScript(`window.studio[${JSON.stringify(fn)}](...${JSON.stringify(args)})`);
  const js=source=>window.webContents.executeJavaScript(source);
  const wait=async(pred,label)=>{
    for(let i=0;i<140;i++) {
      if(await js(pred))return;
      await delay(60);
    }
    throw new Error('UI timeout: '+label+'\n'+await js('document.body.innerText.slice(0,1800)'));
  };
  const domClick=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click(); true`);
  const image=async(file)=>{
    await js('document.fonts.ready.then(() => true)');
    const capture=await window.webContents.capturePage();
    assert(!capture.isEmpty(),'renderer snapshot');
    await writeFile(path.join(output,file),capture.toPNG());
  };
  await wait("document.querySelectorAll('.slot').length===8","opening sample");
  assert.equal(await js("document.querySelectorAll('.slot.fitted').length"),4);
  await image('ui-layout.png');

  const clickText=(selector,text)=>js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(x=>x.textContent.trim().startsWith(${JSON.stringify(text)})).click(); true`);
  await clickText('.nav-bottom button','9050 배선 예제');
  await wait("document.querySelector('.cable-detail')?.innerText.includes('CBL-001')",'9050 example');
  assert.equal(await js("document.querySelectorAll('.cable-detail tbody tr').length"),4);
  assert(await js("document.querySelector('.cable-detail').innerText.includes('610138216')"));
  await image('ui-wiring-9050.png');
  await clickText('.wire-views button','리시버');
  await wait("document.querySelectorAll('.receiver-slot').length===50",'9050 50 mount positions');
  await clickText('.wire-toolbar button','후면 보기');
  await wait("document.querySelector('.receiver-slot').innerText.startsWith('25')",'rear view preserves numbering');
  await image('ui-receiver-9050.png');
  await clickText('.receiver-view tbody button','접점 배치');
  await wait("document.querySelectorAll('.cavities .cavity-line span').length===192",'QuadraPaddle drawing');
  assert.equal(await js("document.querySelector('.cavity-line .origin')?.innerText"),'1A');
  await domClick('[role=dialog] button[aria-label="닫기"]');
  await clickText('.wire-views button','케이블');
  await clickText('.cable-detail button','케이블 편집');
  await wait("document.querySelector('[role=dialog]')?.innerText.includes('도체별 양단 핀맵')",'native wiring form');
  assert(await js("document.querySelector('[role=dialog]').innerText.includes('AWG 22~28')"));
  await clickText('[role=dialog] button','케이블 저장');
  await wait("!document.querySelector('[role=dialog]')",'save wiring edits');
  const wiringFile=(await call('boot')).recovery;
  assert.equal(wiringFile.wiring.cables[0].wires[0].b,'1A');
  await clickText('.wire-views button','경로 도면');
  await wait("document.querySelectorAll('.drawing-node').length===2 && document.querySelectorAll('.drawing-link').length===1",'9050 route drawing');
  await image('ui-harness-9050.png');
  const index=await call('workspaceEdit',{type:'folderNew',name:'9050 통합 검사',customer:'테스트'});
  const folderId=index.folders.find(row=>row.name==='9050 통합 검사').id;
  const added=await call('workspaceEdit',{type:'designNew',folderId,kind:'cable',name:'9050 설계',project:wiringFile});
  const designId=added.folders.find(row=>row.id===folderId).designs[0].id;
  assert.equal((await call('workspaceIndex')).folders.find(row=>row.id===folderId).designs[0].name,'9050 설계');
  await clickText('.tabs button','프로젝트 관리자');
  await wait("document.querySelector('.project-workspace')?.innerText.includes('9050 설계')",'workspace design list');
  await image('ui-workspace.png');
  await js("window.__originalConfirm=window.confirm;window.confirm=()=>true;true");
  await clickText('.project-design button','설계 열기');
  await wait("document.querySelector('.drawing-editor')?.innerText.includes('케이블 경로 도면')",'workspace opens linked cable canvas');
  assert.equal((await call('workspaceIndex')).folders[0].designs[0].id,designId);
  await clickText('.nav-bottom button','예제 프로젝트 열기');
  await wait("document.querySelectorAll('.slot').length===8&&document.querySelectorAll('.slot.fitted').length===4",'return to v1 sample');
  await js("window.confirm=window.__originalConfirm;delete window.__originalConfirm;true");
  const wiringExample=sampleWiring();
  for(const ex of ['pdf','xlsx']) {
    const bytes=await renderExport(wiringExample,ex,'초안');
    assert(bytes.length>1500);
    await writeFile(path.join(output,'VPC_9050_배선.'+ex),bytes);
  }
  console.log('PASS 9050 native UI: 50 positions, rear view, 192 cavities, wiring edit and reports');

  await domClick('button[aria-label="슬롯 4 모듈 추가"]');
  await wait("!!document.querySelector('[role=dialog] .catalog-row')",'slot library');
  await js("Array.from(document.querySelectorAll('.catalog-row')).find(x=>x.querySelector('b').textContent==='DEMO-DIO').querySelector('button').click(); true");
  await wait("!!document.querySelector('.slot[aria-label=\"4번 DEMO-DIO\"]')",'placement');
  await domClick('button[aria-label="되돌리기"]');
  await wait("document.querySelectorAll('.slot.fitted').length===4",'undo');
  await domClick('button[aria-label="다시 실행"]');
  await wait("document.querySelectorAll('.slot.fitted').length===5",'redo');
  const recovery=(await call('boot')).recovery;
  assert.equal(recovery.chassis[0].placements.length,5);
  await js("Array.from(document.querySelectorAll('.tabs button')).find(x=>x.textContent.includes('부품명세서')).click(); true");
  await wait("document.querySelector('.data-table')?.innerText.includes('DEMO-DIO')",'BOM');
  await image('ui-bom.png');
  console.log('PASS react ui: chassis, card selector, placement, undo, redo, recovery, BOM');

  const inserted=sampleProject(seedCatalog);
  await call('changed',inserted);
  assert.equal((await call('boot')).recovery.id,inserted.id);
  const sample=path.join(output,'예제_구성.ateproj');
  await writeProject(sample,inserted);
  const update=perform(inserted,{type:'projectInfo',name:'시험 구성 2',revision:'B',notes:'한글 메모'});
  await writeProject(sample,update);
  const opened=await openFile(sample);
  assert.equal(opened.project.revision,'B');
  assert.equal(opened.file.readOnly,false);
  await writeFile(sample,'corrupt');
  assert.equal((await loadProject(sample)).project.id,inserted.id);
  assert.equal((await loadProject(sample)).recovered,true);
  await writeProject(sample,inserted);
  assert.equal(checkedStatus(inserted,false),'초안');
  assert.throws(()=>checkedStatus(inserted,true));
  for(const [ex,header] of [['pdf','25504446'],['png','89504e47'],['xlsx','504b0304']]){
    const bytes=Buffer.from(await renderExport(inserted,ex,'초안'));
    assert.equal(bytes.subarray(0,4).toString('hex'),header);
    if(ex==='png') {
      assert.equal(bytes.readUInt32BE(16),1120);
      assert(bytes.readUInt32BE(20)>=350&&bytes.readUInt32BE(20)<=1800,'sample PNG should be cropped to the report');
    }
    await writeFile(path.join(output,'구성_출력.'+ex),bytes);
  }
  console.log('PASS actual app exports PDF, PNG, XLSX and corrupt-file backup restoration');

  const witnessed=[];
  const server=createServer(async(req,res)=>{
    let raw=''; for await (const c of req)raw+=c;
    const payload=raw?JSON.parse(raw):null;
    witnessed.push([req.url,req.headers.authorization,payload]);
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/models') return res.end(JSON.stringify({data:[{id:'internal-test'}]}));
    if(req.url!=='/v1/chat/completions'){res.statusCode=404;return res.end('{}');}
    if(payload.messages.length===1)return res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));
    const context=JSON.parse(payload.messages[1].content);
    if(context.mode==='audit')return res.end(JSON.stringify({choices:[{message:{content:'{"answer":"확인 항목 검토 완료","proposals":[]}'}}]}));
    const chassis=context.catalog.find(d=>d.part==='DEMO-PXIE-08').ref;
    const mux=context.catalog.find(d=>d.part==='DEMO-MUX').ref;
    const response={answer:'예제 MUX를 배치합니다.',proposals:[
      {action:'chassis',ref:chassis,alias:'new-test'},
      {action:'place',ref:mux,target:'new-test',slot:2},
      {action:'place',ref:mux,target:'new-test',slot:2},
      {action:'place',ref:'P999',target:'new-test',slot:3}
    ]};
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(response)}}]}));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const p=createProject('LLM Test');
    p.notes='DO_NOT_SEND_NOTES_8b0f';
    await call('saveLLM',{enabled:true,baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'internal-test',key:'test-key'});
    assert.deepEqual(await call('models'),['internal-test']);
    assert.equal((await call('testLLM')).model,'internal-test');
    const result=await call('ask',p,'멀티플렉서 카드 한 장 배치','draft');
    assert.equal(result.changes,2);
    assert.equal(result.suggestions.filter(x=>x.status==='rejected').length,2);
    const invalid={...p,revision:'B'};
    await assert.rejects(call('apply',invalid,result.token),/변경되었습니다/);
    const applied=await call('apply',p,result.token);
    assert.equal(buildBOM(applied).length,2);
    assert.equal((await call('ask',applied,'검토','audit')).token,null);
    assert(witnessed.every(x=>x[1]==='Bearer test-key'));
    assert(!JSON.stringify(witnessed).includes(p.notes));
    assert(!JSON.stringify(witnessed).includes('data:image/'));
    console.log('PASS OpenAI-compatible models, auth, chat, audit, bounded recommendations and atomic apply');

    await domClick('button[aria-label="앱 설정"]');
    await wait("!!document.querySelector('[role=dialog] input[placeholder*=사내호스트]')",'LLM settings dialog');
    await js(`(() => {
      const scope=document.querySelector('[role=dialog]');
      const fill=(query,value)=>{
        const input=scope.querySelector(query);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      };
      scope.querySelector('input[type=checkbox]').click();
      fill('input[placeholder*=사내호스트]',${JSON.stringify(`http://127.0.0.1:${server.address().port}/v1`)});
      fill('input[list]', 'internal-test');
      Array.from(scope.querySelectorAll('label')).find(x=>x.textContent.includes('자동 검토 요청')).querySelector('input').click();
      return true;
    })()`);
    await js("Array.from(document.querySelectorAll('[role=dialog] button')).find(b=>b.textContent.trim()==='저장').click(); true");
    await wait("document.querySelector('[role=dialog] .form-ok')?.textContent.includes('저장')",'proactive settings saved');
    await domClick('[role=dialog] button[aria-label="닫기"]');
    await js("Array.from(document.querySelectorAll('.inspector-tabs button')).find(b=>b.textContent.includes('설계 AI')).click(); true");
    await wait("Array.from(document.querySelectorAll('.ai-reply h4')).some(x=>x.textContent==='최근 자동 검토')",'proactive audit');
    assert(witnessed.filter(x=>x[2]?.messages?.[1]?.content.includes('"mode":"audit"')).length>=2);
    await image('ui-ai.png');
    console.log('PASS opt-in automatic LLM review from the actual window');
  } finally { await new Promise(resolve=>server.close(resolve)); }

  assert(db.list().length>=20);
  await cp(sample,path.join(output,'sample.ateproj'));
  console.log('ATE_STUDIO_SELF_TEST_OK');
}
