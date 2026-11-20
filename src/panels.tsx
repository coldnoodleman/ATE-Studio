import { PortFields, readPortRows, rowsFrom } from './ports';
import { useEffect, useMemo, useState, type ReactNode, type FormEvent } from 'react';
import { X, Search, ChevronRight, Plus, Save, Server, CircuitBoard, Monitor, Package, Sparkles, WifiOff, Plug, Check, Loader2, TriangleAlert, Upload } from 'lucide-react';
import { cleanDefinition, partKey, placementIssues, searchCatalog } from '../domain.mjs';
import { type Definition, type Chassis, type Slot, type Settings, type AIReply, type ImportPreview, type Project, kindNames, evidenceNames, roleNames } from './types';

export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape') onClose();};
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[onClose]);
  return <div className="scrim" onMouseDown={e=>{if(e.target===e.currentTarget) onClose();}}>
    <section className={wide?'modal wide':'modal'} role="dialog" aria-modal="true" aria-label={title}>
      <header><h2>{title}</h2><button className="icon" aria-label="닫기" onClick={onClose}><X size={19}/></button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

export const PartIcon = ({kind,size=19}:{kind:string;size?:number}) =>
  (kind==='chassis'||kind==='receiver')?<Server size={size}/>:kind==='module'?<CircuitBoard size={size}/>:kind==='dut'?<Package size={size}/>:<Monitor size={size}/>;

export function CatalogView({catalog,kind='',target,slot,replace,onPick,onEdit,onDrag}:{
  catalog:Definition[];kind?:string; target?:Chassis;slot?:number;replace?:string;
  onPick?:(d:Definition)=>void;onEdit?:(d:Definition)=>void;onDrag?:(d:Definition)=>void;
}) {
  const [query,setQuery]=useState(''),[filter,setFilter]=useState(kind),[standard,setStandard]=useState(''),[count,setCount]=useState(''),[includeBlocked,setIncludeBlocked]=useState(false);
  const rows=useMemo(()=>{
    const actualKind=kind==='external'?'':filter;
    return (searchCatalog(catalog,query,actualKind,standard,count) as Definition[])
      .filter(d=>kind!=='external'||['instrument','dut','receiver'].includes(d.kind))
      .map(d=>{
        const rules=target!=null&&slot!=null&&d.kind==='module'?placementIssues(target,d,slot,'',replace):[];
        return {d,rules,blocked:rules.some(r=>r.severity==='error')};
      }).filter(x=>includeBlocked||!x.blocked).sort((a,b)=>a.rules.length-b.rules.length || Number(a.d.evidence!=='verified')-Number(b.d.evidence!=='verified'));
  },[catalog,query,filter,standard,count,includeBlocked,target,slot,kind,replace]);

  return <div className="catalog-view">
    <div className="search-line">
      <label className="search-box"><Search size={16}/><input autoFocus placeholder="품번, 제조사, 품명 검색" value={query} onChange={e=>setQuery(e.target.value)}/></label>
      {!kind&&<select aria-label="장비 유형" value={filter} onChange={e=>{setFilter(e.target.value);setCount('');}}><option value="">모든 유형</option>{Object.entries(kindNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}
      <select aria-label="인터페이스" value={standard} onChange={e=>setStandard(e.target.value)}><option value="">모든 인터페이스</option>{['PXI','PXIe','Hybrid','LXI/USB','Standalone'].map(x=><option key={x}>{x}</option>)}</select>
      {filter==='chassis'&&<select aria-label="슬롯 수" value={count} onChange={e=>setCount(e.target.value)}><option value="">슬롯 수</option>{[...new Set(catalog.filter(d=>d.kind==='chassis').map(d=>d.slots.length))].sort((a,b)=>a-b).map(n=><option key={n}>{n}</option>)}</select>}
    </div>
    <div className="results-label"><span>{rows.length.toLocaleString()}개 품목</span>{target&&<label><input type="checkbox" checked={includeBlocked} onChange={e=>setIncludeBlocked(e.target.checked)}/> 비호환 포함</label>}</div>
    <div className="catalog-list">
      {rows.slice(0,350).map(({d,rules,blocked})=><div className={blocked?'catalog-row blocked':'catalog-row'} key={partKey(d)} draggable={Boolean(onDrag&&d.kind==='module')} onDragStart={e=>{e.dataTransfer.setData('application/x-ate-part',partKey(d));onDrag?.(d);}}>
        <span className="part-icon"><PartIcon kind={d.kind}/></span>
        <div className="part-name"><b>{d.part}</b><span>{d.name}</span><small>{d.vendor} · Rev. {d.revision}{d.width? ` · ${d.width}슬롯`:d.slots? ` · ${d.slots.length}슬롯`:''}</small>
          {rules.length>0&&<small className={blocked?'danger-text':'warn-text'}>{rules.map(r=>r.message).join(' ')}</small>}
        </div>
        <span className="tag">{d.standard}</span><span className={'tag '+d.evidence}>{evidenceNames[d.evidence]}</span>
        {onEdit&&<button className="icon" onClick={()=>onEdit(d)} title="품목 편집"><ChevronRight size={19}/></button>}
        {onPick&&<button disabled={blocked} className="btn compact" onClick={()=>onPick(d)}><Plus size={15}/> 선택</button>}
      </div>)}
      {!rows.length&&<div className="empty-small">조건에 맞는 장비가 없습니다.</div>}
      {rows.length>350&&<div className="empty-small">처음 350개를 표시합니다. 검색어로 범위를 줄일 수 있습니다.</div>}
    </div>
  </div>;
}

const blank:Definition={kind:'module',vendor:'',part:'',name:'',revision:'1',category:'',source:'',sourceDate:'',evidence:'unverified',standard:'PXIe',width:1,role:'peripheral',hybrid:'unknown',procure:true,image:''};
const blankSlots=[{number:1,role:'system',accepts:['PXIe']},{number:2,role:'peripheral',accepts:['Hybrid']}];

export function DefinitionForm({initial,onSave,onClose}:{initial?:Definition;onSave:(d:Definition)=>Promise<boolean>;onClose:()=>void}) {
  const [draft,setDraft]=useState<Definition>(initial||blank);
  const [portRows,setPortRows]=useState(()=>rowsFrom(initial?.connectors||[]));
  const [receiverText,setReceiverText]=useState(()=>JSON.stringify(initial?.receiver||{series:'',view:'전면 기준',tiers:[{id:'A',label:'상단 A',mode:'discrete',positions:['1','2','3','4'],families:['VPC 90 Series']}],ita:[]},null,2));
  const [moduleText,setModuleText]=useState(()=>JSON.stringify(initial?.receiverModule||{series:'VPC 90 Series',width:1,termination:'crimp',itaPart:'',contacts:[]},null,2));
  const [slotMap,setSlotMap]=useState<Slot[]>(initial?.slots||blankSlots);
  const [err,setErr]=useState(''),[saving,setSaving]=useState(false);
  const set=(field:string,value:any)=>setDraft(d=>({...d,[field]:value}));
  const basic=(label:string,key:string,max:number,placeholder='')=><label>{label}<input value={(draft as any)[key]??''} onChange={e=>set(key,e.target.value)} maxLength={max} placeholder={placeholder}/></label>;
  const num=(label:string,key:string,min=0,step='any')=><label>{label}<input type="number" min={min} step={step} value={(draft as any)[key]??''} onChange={e=>set(key,e.target.value===''?undefined:Number(e.target.value))}/></label>;
  const select=(label:string,key:string,options:[string,string][]) => <label>{label}<select value={(draft as any)[key]??''} onChange={e=>set(key,e.target.value)}>{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>;
  async function submit(e:FormEvent) {
    e.preventDefault();
    setErr('');setSaving(true);
    try {
      const definition=cleanDefinition({...draft,slots:draft.kind==='chassis'?slotMap:undefined,
        connectors:draft.kind!=='receiver'&&portRows.length?readPortRows(portRows):undefined,
        receiver:draft.kind==='receiver'?JSON.parse(receiverText):undefined,
        receiverModule:draft.kind==='receiverModule'?JSON.parse(moduleText):undefined}) as Definition;
      await onSave(definition);
    } catch(error) { setErr(error.message); } finally { setSaving(false); }
  }
  const changeKind=(kind:string)=>setDraft(d=>({...d,kind,standard:kind==='chassis'?'Hybrid':kind==='module'?'PXIe':'Standalone'}));
  return <form className="form" onSubmit={submit}>
    <div className="form-grid">
      <label>장비 유형<select value={draft.kind} onChange={e=>changeKind(e.target.value)}>{Object.entries(kindNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      {select('인터페이스','standard',(draft.kind==='chassis'?['PXI','PXIe','Hybrid','LXI/USB']:draft.kind==='module'?['PXI','PXIe']:['Standalone','LXI/USB']).map(v=>[v,v]))}
      {basic('제조사','vendor',100)}{basic('품번','part',100)}{basic('품명','name',180)}{basic('장비 리비전','revision',40)}
      {basic('분류','category',95)}
      {select('근거 상태','evidence',Object.entries(evidenceNames))}
      {basic('자료 출처','source',400,'문서 번호 또는 URL')}{basic('자료 개정일','sourceDate',30,'YYYY-MM-DD')}
      {num('패널 가로 mm','widthMm',1)}{num('패널 세로 mm','heightMm',1)}
      {draft.kind==='module'&&<>
        {num('점유 슬롯','width',1,'1')}{select('카드 역할','role',Object.entries(roleNames).filter(([x])=>x!=='reserved'))}
        {select('PXI Hybrid 장착 근거','hybrid',[['unknown','미확인'],['yes','지원'],['no','미지원']])}{num('소비전력 W','power')}{num('슬롯당 발열 W','heat')}
      </>}
      {draft.kind==='chassis'&&<>{num('가용 전력 W','powerLimit',.1)}{num('슬롯당 냉각 한도 W','coolingLimit',.1)}</>}
    </div>
    {draft.kind==='chassis'&&<SlotMapEditor slots={slotMap} setSlots={setSlotMap}/>}
    {draft.kind==='receiver'&&<label>리시버 프로파일 <small>단, 위치, 수용 시리즈, 어댑터·ITA 품번을 정의합니다.</small><textarea rows={10} className="code-field" value={receiverText} onChange={e=>setReceiverText(e.target.value)}/></label>}
    {draft.kind==='receiverModule'&&<label>리시버 모듈 사양 <small>시리즈, 점유 폭, 종단 방식과 접점 품번을 정의합니다.</small><textarea rows={8} className="code-field" value={moduleText} onChange={e=>setModuleText(e.target.value)}/></label>}
    {draft.kind!=='receiver'&&<PortFields rows={portRows} onChange={setPortRows} one={draft.kind==='receiverModule'}/>}

    <label className="check-row"><input type="checkbox" checked={draft.procure} onChange={e=>set('procure',e.target.checked)}/> BOM에 조달 대상으로 표시</label>
    <div className="image-field">
      {draft.image&&<img alt="등록된 패널" src={draft.image}/>}
      <label>패널 이미지 PNG/JPEG · 최대 1MB<input type="file" accept="image/png,image/jpeg" onChange={e=>{
        const file=e.target.files?.[0];
        if(!file) return;
        if(file.size>1_000_000||!['image/png','image/jpeg'].includes(file.type)) {setErr('1MB 이하 PNG/JPEG를 선택하세요.');return;}
        const reader=new FileReader();
        reader.onload=()=>{set('image',String(reader.result));setErr('');};reader.readAsDataURL(file);
      }}/></label>
      {draft.image&&<button type="button" className="btn" onClick={()=>set('image','')}>이미지 제거</button>}
    </div>
    {err&&<p className="form-error">{err}</p>}
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={saving}><Save size={16}/> 장비 저장</button></div>
  </form>;
}

function SlotMapEditor({slots,setSlots}:{slots:Slot[];setSlots:(slots:Slot[])=>void}) {
  const set=(index:number,fields:Partial<Slot>)=>setSlots(slots.map((s,j)=>index===j?{...s,...fields}:s));
  const add=()=>setSlots([...slots,{number:Math.max(-1,...slots.map(s=>s.number))+1,role:'peripheral',accepts:['Hybrid']}]);
  return <div className="form">
    <b>슬롯 맵</b><p className="muted">왼쪽부터 배열되는 순서대로 슬롯을 등록합니다.</p>
    <div className="slot-map-editor"><table className="data-table"><thead><tr><th>번호</th><th>역할</th><th>허용 카드</th><th>사용 안 함</th><th>삭제</th></tr></thead>
      <tbody>{slots.map((s,i)=><tr key={i}>
        <td><input aria-label={`슬롯 ${i+1} 번호`} type="number" min="0" max="999" step="1" value={Number.isFinite(s.number)?s.number:''} onChange={e=>set(i,{number:e.target.value===''?NaN:Number(e.target.value)})}/></td>
        <td><select aria-label={`슬롯 ${i+1} 역할`} value={s.role} onChange={e=>set(i,{role:e.target.value})}>{Object.entries(roleNames).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></td>
        <td><select aria-label={`슬롯 ${i+1} 허용 카드`} value={s.accepts.includes('Hybrid')?'Hybrid':s.accepts.join('/')} onChange={e=>set(i,{accepts:e.target.value?e.target.value.split('/'):[]})}>
          {['','PXI','PXIe','Hybrid','PXI/PXIe','PXIe/PXI'].map(x=><option value={x} key={x}>{x||'없음'}</option>)}</select></td>
        <td><input aria-label={`슬롯 ${i+1} 사용 안 함`} type="checkbox" checked={s.disabled===true} onChange={e=>set(i,{disabled:e.target.checked})}/></td>
        <td><button type="button" className="icon" aria-label={`슬롯 행 ${i+1} 삭제`} disabled={slots.length<=1} onClick={()=>setSlots(slots.filter((_,j)=>j!==i))}><X size={15}/></button></td>
      </tr>)}</tbody></table></div>
    <button type="button" className="btn align-left" onClick={add} disabled={slots.length>=64}><Plus size={15}/> 슬롯 추가</button>
  </div>;
}

export function ImportTable({preview,onApply,onClose}:{preview:ImportPreview;onApply:()=>void;onClose:()=>void}) {
  return <>
    <p className="modal-description">신규 {preview.items.filter(i=>i.mode==='add').length}개 · 덮어쓰기 {preview.items.filter(i=>i.mode==='update').length}개</p>
    <div className="import-scroll"><table className="data-table"><thead><tr><th>작업</th><th>품번</th><th>제조사</th><th>형태</th><th>리비전</th><th>근거</th></tr></thead><tbody>
      {preview.items.map((i,j)=><tr key={j}><td>{i.mode==='add'?'추가':'변경'}</td><td>{i.part}</td><td>{i.vendor}</td><td>{kindNames[i.kind]}</td><td>{i.revision}</td><td>{evidenceNames[i.evidence]}</td></tr>)}
    </tbody></table></div><div className="modal-actions"><button className="btn" onClick={onClose}>취소</button><button className="btn primary" onClick={onApply}><Upload size={16}/> 반입 적용</button></div>
  </>;
}

export function SettingsPanel({initial,onSaved}:{initial:Settings;onSaved:(s:Settings)=>void}) {
  const [settings,setSettings]=useState(initial);
  const [key,setKey]=useState(''),[remember,setRemember]=useState(initial.secureKey),[clear,setClear]=useState(false);
  const [models,setModels]=useState<string[]>([]),[status,setStatus]=useState({text:'',error:false}),[busy,setBusy]=useState(false);
  const set=(field:string,value:any)=>setSettings(v=>({...v,[field]:value}));
  async function run(kind:string) {
    setBusy(true);setStatus({text:'',error:false});
    try {
      const saved=await window.studio.saveLLM({...settings,key,rememberKey:remember,clearKey:clear});
      setSettings(saved);onSaved(saved);setKey('');setClear(false);
      if(kind==='models') {const list=await window.studio.models();setModels(list);setStatus({text:`${list.length}개 모델을 찾았습니다.`,error:false});}
      else if(kind==='test') {const r=await window.studio.testLLM();setStatus({text:`${r.model} 응답 확인`,error:false});}
      else setStatus({text:'연결 설정을 저장했습니다.',error:false});
    } catch(e) {setStatus({text:e.message,error:true});} finally {setBusy(false);}
  }
  return <div className="form">
    <label className="check-row"><input type="checkbox" checked={settings.enabled} onChange={e=>set('enabled',e.target.checked)}/> 사내 LLM 연결 사용</label>
    <div className="notice"><Plug size={16}/> OpenAI 호환 API를 사용합니다. 예를 들어 <code>http://192.168.0.30:8000/v1</code>을 입력합니다.</div>
    <label>API 기본 주소<input placeholder="http://사내호스트:포트/v1" value={settings.baseUrl} onChange={e=>{set('baseUrl',e.target.value);setModels([]);}}/></label>
    <label>API 키 <small>{clear?'삭제 대기':settings.hasKey?'키가 설정되어 있습니다.':'필요한 서버에만 입력하세요.'}</small><input type="password" autoComplete="off" value={key} onChange={e=>{setKey(e.target.value);setClear(false);}} placeholder="Bearer 토큰"/></label>
    {settings.secureKey?<label className="check-row"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> OS 자격 증명 저장소로 암호화하여 유지</label>:<p className="muted">이 PC에서는 API 키를 현재 실행 세션에 보관합니다.</p>}
    {settings.hasKey&&<button className="btn align-left" onClick={()=>{setClear(true);setKey('');}}>저장된 API 키 삭제 선택</button>}
    <label>모델 ID<input list="available-models" placeholder="서버의 모델 ID" value={settings.model} onChange={e=>set('model',e.target.value)}/>
      <datalist id="available-models">{models.map(x=><option value={x} key={x}/>)}</datalist></label>
    <label className="check-row"><input type="checkbox" checked={settings.routed} onChange={e=>set('routed',e.target.checked)}/> 사내 라우팅 주소 허용 · 사내에서 관리하는 주소임을 확인했습니다.</label>
    <label className="check-row"><input type="checkbox" checked={settings.proactive} onChange={e=>set('proactive',e.target.checked)}/> 배치 변경 후 검토 항목이 있으면 LLM에 자동 검토 요청</label>
    <div className="notice"><WifiOff size={16}/> 요청할 때 현재 배치, 후보 장비의 요약 정보와 질문을 지정 서버로 보냅니다. 프로젝트 메모와 패널 이미지에는 접근하지 않습니다.</div>
    {status.text&&<p className={status.error?'form-error':'form-ok'}>{status.text}</p>}
    <div className="modal-actions"><button className="btn" disabled={busy||!settings.enabled} onClick={()=>run('models')}>모델 목록 조회</button>
      <button className="btn" disabled={busy||!settings.enabled||!settings.model} onClick={()=>run('test')}>연결 테스트</button>
      <button className="btn primary" disabled={busy} onClick={()=>run('save')}><Save size={16}/> 저장</button></div>
  </div>;
}

export function AssistantPanel({settings,reply,progress,error,ask,onApply,openSettings,lastAuto,project}:{
  settings:Settings;reply:AIReply|null;progress:boolean;error:string;ask:(question:string,mode:string)=>void;onApply:()=>void;openSettings:()=>void;lastAuto:AIReply|null;project:Project;
}) {
  const [question,setQuestion]=useState(''),[mode,setMode]=useState('ask');
  return <div className="assistant-content">
    <div className="ai-heading"><span className="ai-mark"><Sparkles size={19}/></span><div><b>설계 어시스턴트</b><small>{settings?.enabled&&settings?.model?settings.model:'사내 LLM 미연결'}</small></div></div>
    {!settings?.enabled||!settings?.model?<div className="ai-unavailable">
      <p>사내 모델을 연결하면 장비 검색, 배치 초안, 현재 설계 검토를 요청할 수 있습니다.</p><button className="btn primary" onClick={openSettings}><Plug size={15}/> LLM 연결 설정</button>
    </div>:<>
      <div className="ai-quick">
        <button className="btn" disabled={progress} onClick={()=>{setMode('audit');ask('현재 슬롯 구성의 오류와 확인 항목을 우선순위 순으로 설명해 줘.','audit');}}>현재 구성 검토</button>
        <button className="btn" disabled={progress} onClick={()=>{setMode('recommend');setQuestion('현재 구성에 적합한 모듈 후보를 찾아줘. 필요한 기능은 ');}}>장비 후보 추천</button>
        <button className="btn" disabled={progress} onClick={()=>{setMode('draft');setQuestion(project.chassis.length?'현재 섀시에 추가할 장비와 필요한 수량: ':'구성할 시험 시스템과 필요한 장비: ');}}>배치 초안</button>
      </div>
      <label className="ai-mode">작업<select value={mode} onChange={e=>setMode(e.target.value)}><option value="ask">질문</option><option value="recommend">장비 추천</option><option value="draft">배치 초안</option><option value="audit">설계 검토</option></select></label>
      <textarea aria-label="LLM 요청" placeholder="예: 현재 섀시에 멀티플렉서 2개를 추가할 위치를 제안해 줘." value={question} maxLength={2500} onChange={e=>setQuestion(e.target.value)} rows={4}/>
      <button className="btn primary ai-send" disabled={progress||!question.trim()} onClick={()=>ask(question,mode)}>{progress?<Loader2 className="spin" size={16}/>:<Sparkles size={16}/>} {progress?'모델 응답 대기':'요청 보내기'}</button>
      {error&&<p className="form-error"><TriangleAlert size={14}/>{error}</p>}
      {reply&&<article className="ai-reply"><h4>모델 답변</h4><div className="reply-text">{reply.answer||'배치 제안을 확인하세요.'}</div>
        {reply.suggestions.map((s,i)=><div className={'suggest '+s.status} key={i}><b>{s.label}{s.slot!=null?` · 슬롯 ${s.slot}`:''}</b><span>{s.target}</span><small>{s.message} {s.reason}</small></div>)}
        {reply.token&&<button className="btn primary" onClick={onApply}><Check size={16}/> 통과한 {reply.changes}건 적용</button>}
      </article>}
      {lastAuto&&<article className="ai-reply"><h4>최근 자동 검토</h4><div className="reply-text">{lastAuto.answer}</div></article>}
    </>}
  </div>;
}
