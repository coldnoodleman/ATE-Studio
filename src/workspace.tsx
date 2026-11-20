import { useEffect, useState } from 'react';
import { Archive, FilePlus, Folder, Plus, Star } from 'lucide-react';
import { Modal } from './panels';
import type { DesignKind, Project, WorkspaceDesign, WorkspaceIndex, WorkspaceOperation } from './types';

const labels:Record<DesignKind,string>={system:'시스템 구성',schematic:'신호 설계',cable:'케이블'};
const date=(value:string)=>new Date(value).toLocaleString('ko-KR');
const api=window.studio;
type Dialog={title:string;action:string;item?:WorkspaceDesign;other?:string;name?:string;customer?:string;description?:string;kind?:DesignKind};
type Section='designs'|'attachments'|'review'|'history'|'templates';

export function ProjectWorkspace({project,onOpen,notify}:{project:Project;onOpen:(designId:string,revisionId?:string)=>void;notify:(text:string,error?:boolean)=>void}) {
  const [index,setIndex]=useState<WorkspaceIndex>({folders:[],templates:[]});
  const [selected,setSelected]=useState('');
  const [section,setSection]=useState<Section>('designs');
  const [query,setQuery]=useState('');
  const [sort,setSort]=useState('updated');
  const [favorites,setFavorites]=useState(false);
  const [dialog,setDialog]=useState<Dialog|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    let active=true;
    api.workspaceIndex().then(data=>{if(active){setIndex(data);setLoaded(true);}}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[]);
  const f=index.folders.find(folder=>folder.id===selected)||index.folders[0];
  const needle=query.trim().toLocaleLowerCase();
  const match=(value:string)=>value.toLocaleLowerCase().includes(needle);
  const folders=index.folders.filter(x=>(!favorites||x.favorite)&&
    (!needle||match([x.name,x.customer,x.description].join(' '))||x.designs.some(d=>match(d.name+' '+d.description))));
  folders.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'ko'):sort==='customer'?a.customer.localeCompare(b.customer,'ko'):b[sort as 'updated'|'created'].localeCompare(a[sort as 'updated'|'created']));

  async function work(action:()=>Promise<WorkspaceIndex|{name:string}|null>,message='') {
    setBusy(true);setError('');
    try{
      const result=await action();
      if(!result)return false;
      if('folders' in result){
        const added=result.folders.find(item=>!index.folders.some(old=>old.id===item.id));
        setIndex(result);
        if(added){setSelected(added.id);setSection('designs');}
      } else notify(result.name+' 저장 완료');
      if(message)notify(message);
      return true;
    }catch(reason){setError(reason.message);return false;}finally{setBusy(false);}
  }
  const edit=(operation:WorkspaceOperation)=>work(()=>api.workspaceEdit({folderId:f?.id,...operation}));
  const open=(next:Dialog)=>{setError('');setDialog(next);};
  const confirmDelete=(message:string,operation:WorkspaceOperation)=>{
    if(window.confirm(message))void edit(operation);
  };
  async function submit(values:{name:string;description:string;customer:string;kind:DesignKind;copy:boolean}) {
    const {action,item,other}=dialog;
    let result=false;
    if(action==='attach')result=await work(()=>api.workspaceAttachment('add',f.id,undefined,values.description));
    else result=await edit({type:action,designId:item?.id,templateId:other,commentId:other,
      toFolder:action==='designMove'?values.name:undefined,
      sourceDesignId:action==='designSync'?values.name:undefined,
      name:values.name,description:values.description,customer:values.customer,kind:values.kind,
      project:values.copy?project:undefined,note:values.description,text:values.description});
    if(result)setDialog(null);
  }
  return <section className="data-page project-workspace">
    <div className="page-heading"><div><h1>프로젝트 관리자</h1><p>로컬 프로젝트와 설계, 검토 자료를 관리합니다.</p></div>
      <div className="inline-actions"><button className="btn" disabled={busy} onClick={()=>void work(()=>api.workspaceTransfer('import'))}>작업공간 가져오기</button>
      <button className="btn primary" disabled={busy||!loaded} onClick={()=>open({title:'프로젝트 만들기',action:'folderNew'})}><Folder size={16}/> 프로젝트 만들기</button></div></div>
    {!dialog&&error&&<p className="form-error" role="alert">{error}</p>}
    <div className="project-manager-grid">
      <aside className="project-index wire-card">
        <div className="form"><label>프로젝트·설계 검색<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="form-grid"><label>정렬<select value={sort} onChange={e=>setSort(e.target.value)}><option value="updated">최근 변경</option><option value="created">생성일</option><option value="name">프로젝트 이름</option><option value="customer">고객명</option></select></label>
        <label className="check-label"><input type="checkbox" checked={favorites} onChange={e=>setFavorites(e.target.checked)}/> 즐겨찾기</label></div></div>
        <div className="wire-list" aria-label="프로젝트 목록">
          {folders.map(row=><button key={row.id} type="button" className={row.id===f?.id&&section!=='templates'?'active':''} onClick={()=>{setSelected(row.id);setSection('designs');}}>
            <span><b>{row.favorite?'★ ':''}{row.name}</b><small>{row.customer||'고객 미지정'} · 설계 {row.designs.length}</small></span></button>)}
          {loaded&&!folders.length&&<p className="muted">표시할 프로젝트가 없습니다.</p>}
        </div>
        <button className="btn" onClick={()=>setSection('templates')}><Archive size={15}/> 템플릿 {index.templates.length}</button>
      </aside>
      <div>
        {section==='templates'?<article className="wire-card">
          <h2>내 템플릿</h2>
          {index.templates.map(t=><div className="project-item-line" key={t.id}><span><b>{t.name}</b><small>{labels[t.kind]}</small></span>
            <div className="inline-actions"><button className="btn compact" disabled={!f||busy} onClick={()=>open({title:'템플릿으로 설계 만들기',action:'templateUse',other:t.id,name:t.name})}>선택 프로젝트에서 사용</button>
            <button className="btn compact" disabled={busy} onClick={()=>confirmDelete('이 템플릿을 삭제할까요?',{type:'templateRemove',templateId:t.id})}>삭제</button></div></div>)}
          {!index.templates.length&&<p className="muted">설계 목록에서 템플릿을 저장할 수 있습니다.</p>}
        </article>:f?<article className="wire-card">
          <div className="section-head"><div><h2>{f.name}</h2><p>{f.customer||'고객 미지정'} · 변경 {date(f.updated)}</p></div>
            <div className="inline-actions">
              <button className="btn compact" disabled={busy} aria-pressed={f.favorite} onClick={()=>void edit({type:'folderFavorite'})}><Star size={15} fill={f.favorite?'currentColor':'none'}/> 즐겨찾기</button>
              <button className="btn compact" disabled={busy} onClick={()=>open({title:'프로젝트 정보',action:'folderEdit',name:f.name,customer:f.customer,description:f.description})}>정보 편집</button>
              <button className="btn compact" disabled={busy} onClick={()=>open({title:'프로젝트 복제',action:'folderCopy',name:f.name+' 사본'})}>복제</button>
              <button className="btn compact" disabled={busy} onClick={()=>void work(()=>api.workspaceTransfer('export',f.id))}>공유 파일 내보내기</button>
              <button className="btn compact danger-btn" disabled={busy} onClick={()=>confirmDelete('프로젝트와 포함된 설계를 삭제할까요?',{type:'folderRemove'})}>삭제</button>
            </div>
          </div>
          {f.description&&<p className="project-description">{f.description}</p>}
          <div className="wire-views">
            {([['designs','설계'],['attachments','첨부'],['review','검토·질의'],['history','이력']] as const).map(([key,label])=><button key={key} className={section===key?'active':''} onClick={()=>setSection(key)}>{label}</button>)}
          </div>
          {section==='designs'&&<>
            <button className="btn primary" disabled={busy} onClick={()=>open({title:'프로젝트에 설계 추가',action:'designNew',kind:'system'})}><FilePlus size={15}/> 설계 추가</button>
            {f.designs.filter(d=>!needle||match(f.name+' '+f.customer+' '+f.description)||match(d.name+' '+d.description)).map(d=><div className="project-design" key={d.id}>
              <div className="project-item-line"><span><b>{d.name}</b><small>{labels[d.kind]} · {d.locked?'잠김 · ':''}{date(d.updated)}</small></span>
                <button className="btn compact primary" disabled={busy} onClick={()=>onOpen(d.id)}>{d.locked?'읽기 전용 열기':'설계 열기'}</button></div>
              {d.description&&<p className="project-description">{d.description}</p>}
              <div className="inline-actions">
                <button className="btn compact" disabled={busy} onClick={()=>void edit({type:'designLock',designId:d.id})}>{d.locked?'잠금 해제':'잠금'}</button>
                <button className="btn compact" disabled={busy} onClick={()=>open({title:'설계 복제',action:'designCopy',item:d,name:d.name+' 사본'})}>복제</button>
                <button className="btn compact" disabled={busy||d.locked||index.folders.length<2} onClick={()=>open({title:'다른 프로젝트로 이동',action:'designMove',item:d})}>이동</button>
                <button className="btn compact" disabled={busy||d.locked||f.designs.length<2} onClick={()=>open({title:'다른 설계 내용 반영',action:'designSync',item:d})}>설계 반영</button>
                <button className="btn compact" disabled={busy} onClick={()=>open({title:'템플릿으로 저장',action:'templateNew',item:d,name:d.name})}>템플릿 저장</button>
                <button className="btn compact" disabled={busy} onClick={()=>void work(()=>api.workspaceRfq(d.id))}>견적 검토 ZIP</button>
                <button className="btn compact" disabled={busy||d.locked} onClick={()=>open({title:'현재 저장본 리비전 남기기',action:'revisionNew',item:d})}>리비전 추가</button>
                <button className="btn compact" disabled={busy} onClick={()=>open({title:'설계 검토 등록',action:'commentAdd',item:d})}>질의</button>
                <button className="btn compact danger-btn" disabled={busy||d.locked} onClick={()=>confirmDelete('이 설계를 삭제할까요?',{type:'designRemove',designId:d.id})}>삭제</button>
              </div>
              {d.revisions.length>0&&<details><summary>리비전 {d.revisions.length}</summary>{d.revisions.map(v=><div key={v.id} className="project-item-line"><span><b>{v.name}</b><small>{date(v.at)} {v.note}</small></span><button className="btn compact" onClick={()=>onOpen(d.id,v.id)}>읽기 전용 열기</button></div>)}</details>}
            </div>)}
          </>}
          {section==='attachments'&&<>
            <button className="btn" disabled={busy} onClick={()=>open({title:'첨부 파일 추가',action:'attach'})}><Plus size={15}/> 첨부 추가</button>
            {f.attachments.map(a=><div className="project-item-line" key={a.id}><span><b>{a.name}</b><small>{a.size.toLocaleString()} bytes · {date(a.at)} {a.note}</small></span>
              <div className="inline-actions"><button className="btn compact" disabled={busy} onClick={()=>void work(()=>api.workspaceAttachment('save',f.id,a.id))}>로컬 저장</button>
              <button className="btn compact danger-btn" disabled={busy} onClick={()=>confirmDelete('이 첨부를 삭제할까요?',{type:'attachmentRemove',attachmentId:a.id})}>삭제</button></div></div>)}
          </>}
          {section==='review'&&<>
            <button className="btn" disabled={busy} onClick={()=>open({title:'프로젝트 검토 등록',action:'commentAdd'})}>검토 등록</button>
            {f.comments.map(c=><div className="project-design" key={c.id}>
              <div className="project-item-line"><span><b>{f.designs.find(d=>d.id===c.designId)?.name||'프로젝트 검토'}</b><small>{date(c.at)} · {c.closed?'해결':'열림'}</small></span>
                <div className="inline-actions"><button className="btn compact" disabled={busy} onClick={()=>open({title:'답변 등록',action:'commentReply',other:c.id})}>답변</button>
                <button className="btn compact" disabled={busy} onClick={()=>void edit({type:'commentToggle',commentId:c.id})}>{c.closed?'다시 열기':'해결'}</button></div></div>
              <p className="project-description">{c.text}</p>
              {c.replies.map((p,i)=><p className="project-reply" key={i}><small>{date(p.at)}</small>{p.text}</p>)}
            </div>)}
          </>}
          {section==='history'&&<ul className="project-history">{f.history.map((h,i)=><li key={i}><time>{date(h.at)}</time><span>{h.text}</span></li>)}</ul>}
        </article>:<div className="wire-empty"><Folder size={30}/><h3>{loaded?'첫 프로젝트를 만들어 설계를 정리하세요.':'작업공간을 불러오는 중입니다.'}</h3></div>}
      </div>
    </div>
    {dialog&&<Modal title={dialog.title} onClose={()=>{if(!busy)setDialog(null);}}><WorkspaceForm dialog={dialog}
      destinations={dialog.action==='designSync'?f.designs.filter(d=>d.id!==dialog.item?.id).map(d=>({id:d.id,name:labels[d.kind]+' · '+d.name})):index.folders.filter(row=>row.id!==f?.id)}
      error={error} busy={busy} onSubmit={submit}/></Modal>}
  </section>;
}

function WorkspaceForm({dialog,destinations,error,busy,onSubmit}:{dialog:Dialog;destinations:{id:string;name:string}[];
  error:string;busy:boolean;onSubmit:(values:{name:string;description:string;customer:string;kind:DesignKind;copy:boolean})=>void}) {
  const [name,setName]=useState(dialog.name||'');
  const [description,setDescription]=useState(dialog.description||'');
  const [customer,setCustomer]=useState(dialog.customer||'');
  const [kind,setKind]=useState<DesignKind>(dialog.kind||'system');
  const [copy,setCopy]=useState(false);
  const comment=['commentAdd','commentReply'].includes(dialog.action);
  const projectForm=['folderNew','folderEdit'].includes(dialog.action);
  const descriptionField=projectForm||comment||['attach','revisionNew','designNew'].includes(dialog.action);
  return <form className="form" onSubmit={e=>{e.preventDefault();onSubmit({name,description,customer,kind,copy});}}>
    {['designMove','designSync'].includes(dialog.action)?<label>{dialog.action==='designSync'?'원본 설계':'대상 프로젝트'}<select required value={name} onChange={e=>setName(e.target.value)}><option value="">선택</option>{destinations.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>:
      !comment&&dialog.action!=='attach'&&<label>이름<input autoFocus required maxLength={dialog.action==='revisionNew'?45:150} value={name} onChange={e=>setName(e.target.value)}/></label>}
    {projectForm&&<label>고객명<input maxLength={150} value={customer} onChange={e=>setCustomer(e.target.value)}/></label>}
    {dialog.action==='designNew'&&<><label>설계 유형<select value={kind} onChange={e=>setKind(e.target.value as DesignKind)}>{Object.entries(labels).map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></label>
      <label className="check-label"><input type="checkbox" checked={copy} onChange={e=>setCopy(e.target.checked)}/> 현재 편집 중인 설계로 시작</label></>}
    {descriptionField&&<label>{comment?'내용':'설명'}<textarea required={comment} rows={4} maxLength={comment?2000:dialog.action==='attach'?500:dialog.action==='revisionNew'?1000:4000} value={description} onChange={e=>setDescription(e.target.value)}/></label>}
    {dialog.action==='designSync'&&<p className="muted">원본 설계 유형에 해당하는 배치, 신호 또는 케이블을 현재 저장본에 덮어씁니다. 기존 연결을 와이어링 검토에서 확인하세요.</p>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="btn primary" disabled={busy}>{dialog.action==='attach'?'파일 선택':'저장'}</button></div>
  </form>;
}
