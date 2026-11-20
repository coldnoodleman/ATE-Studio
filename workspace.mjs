import { cleanProject, createProject, uid } from './domain.mjs';

export const MAX_WORKSPACE = 76_000_000;
export const MAX_ATTACHMENT = 8_000_000;
export const designKinds = ['system','cable','schematic'];
const iso = () => new Date().toISOString();
const fail = message => { throw new Error(message); };
const must = (valid,message) => { if(!valid)fail(message); };
const fields = (value,label,max=160,required=false) => {
  must(typeof (value??'')==='string' && (value??'').length<=max,label+' 길이를 확인하세요.');
  const result=(value??'').trim();
  must(!required||result,label+'을 입력하세요.');
  return result;
};
const id = value => {
  must(typeof value==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value),'잘못된 작업공간 ID입니다.');
  return value;
};
const list = (items,label,max) => {
  must(Array.isArray(items) && items.length<=max,label+' 개수를 확인하세요.');
  return items;
};
const unique = (rows,label) => {
  must(new Set(rows.map(row=>row.id)).size===rows.length,label+' ID가 중복됩니다.');
  return rows;
};
const now = value => {
  must(typeof value==='string' && value.length<=35 && Number.isFinite(Date.parse(value)),'변경 시각을 확인하세요.');
  return value;
};

function entry(value) {
  must(value && typeof value==='object','설계 정보를 확인하세요.');
  must(designKinds.includes(value.kind),'설계 종류를 확인하세요.');
  must(Number.isSafeInteger(value.generation)&&value.generation>=0,'설계 저장 번호를 확인하세요.');
  return {id:id(value.id),name:fields(value.name,'설계 이름',150,true),description:fields(value.description,'설계 설명',4000),
    kind:value.kind,updated:now(value.updated),locked:value.locked===true,generation:value.generation,project:cleanProject(value.project),
    revisions:unique(list(value.revisions??[],'설계 리비전',50).map(r=>({
      id:id(r.id),name:fields(r.name,'리비전 이름',45,true),note:fields(r.note,'리비전 비고',1000),
      at:now(r.at),project:cleanProject(r.project),
    })),'리비전')};
}
function attachment(value) {
  const name=fields(value.name,'첨부 파일 이름',220,true);
  must(name!=='.'&&name!=='..'&&!/[\\/\u0000-\u001f]/.test(name),'첨부 파일 이름을 확인하세요.');
  const data=value.data;
  must(typeof data==='string' && data.length%4===0 && data.length<=Math.ceil(MAX_ATTACHMENT/3)*4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(data),'첨부 파일 형식이나 크기를 확인하세요.');
  const size=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);
  must(size<=MAX_ATTACHMENT,'첨부 파일 크기를 확인하세요.');
  return {id:id(value.id),name,data,size,note:fields(value.note,'첨부 설명',500),at:now(value.at)};
}
function folder(value) {
  must(value && typeof value==='object','프로젝트 정보를 확인하세요.');
  return {id:id(value.id),name:fields(value.name,'프로젝트 이름',150,true),customer:fields(value.customer,'고객명',150),
    description:fields(value.description,'프로젝트 설명',4000),favorite:value.favorite===true,created:now(value.created),updated:now(value.updated),
    designs:unique(list(value.designs??[],'설계',150).map(entry),'설계'),
    attachments:unique(list(value.attachments??[],'첨부',80).map(attachment),'첨부'),
    comments:unique(list(value.comments??[],'검토 항목',300).map(c=>({
      id:id(c.id),text:fields(c.text,'검토 내용',2000,true),designId:c.designId?id(c.designId):'',at:now(c.at),closed:c.closed===true,
      replies:list(c.replies??[],'검토 답변',80).map(r=>({text:fields(r.text,'검토 답변',2000,true),at:now(r.at)})),
    })),'검토 항목'),
    history:list(value.history??[],'변경 기록',180).map(h=>({at:now(h.at),text:fields(h.text,'변경 기록',240,true)}))};
}

export const emptyWorkspace = () => ({schema:1,folders:[],templates:[]});
export function cleanWorkspace(input) {
  must(input?.schema===1,'지원하는 ATE 작업공간 형식이 아닙니다.');
  const folders=unique(list(input.folders,'프로젝트',100).map(folder),'프로젝트');
  unique(folders.flatMap(f=>f.designs),'작업공간 설계');
  return {schema:1,folders,templates:unique(list(input.templates??[],'템플릿',60).map(entry),'템플릿')};
}

function projectOf(workspace,folderId) {
  return workspace.folders.find(item=>item.id===folderId)??fail('프로젝트를 찾을 수 없습니다.');
}
export function findDesign(workspace,designId) {
  for(const f of workspace.folders) {
    const d=f.designs.find(item=>item.id===designId);
    if(d)return {folder:f,design:d};
  }
  fail('설계를 찾을 수 없습니다.');
}
function independent(project,name=project.name) {
  return {...project,id:uid(),name,updatedAt:iso()};
}
function designOf(kind,name,project,description='') {
  return {id:uid(),kind,name,description,project:project?independent(project,name):createProject(name),updated:iso(),generation:0,
    locked:false,revisions:[]};
}
function audit(f,text) {
  f.updated=iso();
  f.history=[{at:f.updated,text},...f.history].slice(0,180);
}

export function editWorkspace(current, op) {
  const next=structuredClone(current);
  if(op.type==='folderNew') {
    const date=iso();
    next.folders.push({id:uid(),name:op.name,customer:op.customer,description:op.description,
      favorite:false,created:date,updated:date,designs:[],attachments:[],comments:[],history:[]});
  } else if(op.type==='resultImport') {
    const original=folder(op.folder);
    const ids=new Map(original.designs.map(d=>[d.id,uid()]));
    next.folders.push({...original,id:uid(),created:iso(),updated:iso(),
      designs:original.designs.map(d=>({...d,id:ids.get(d.id),project:independent(d.project),locked:false,generation:0})),
      comments:original.comments.map(c=>({...c,id:uid(),designId:ids.get(c.designId)??''}))});
  } else if(op.type==='templateRemove') {
    next.templates=next.templates.filter(t=>t.id!==op.templateId);
  } else if(op.type==='designSave' || op.type==='designMove') {
    const {folder:f,design:d}=findDesign(next,op.designId);
    must(!d.locked,'잠긴 설계입니다.');
    if(op.type==='designSave') {
      must(d.generation===op.generation,'다른 작업에서 이 설계를 저장했습니다. 변경을 파일로 저장한 뒤 설계를 다시 여세요.');
      must(op.project?.id===d.project.id,'열었던 설계의 프로젝트 ID가 다릅니다.');
      d.project=op.project;
      d.name=op.project.name;
      d.updated=iso();
      d.generation+=1;
      audit(f,'설계 저장 · '+d.name);
    } else {
      const target=projectOf(next,op.toFolder);
      must(target.id!==f.id,'이동할 다른 프로젝트를 선택하세요.');
      f.designs=f.designs.filter(item=>item.id!==d.id);
      target.designs.push(d);
      target.comments.push(...f.comments.filter(c=>c.designId===d.id));
      f.comments=f.comments.filter(c=>c.designId!==d.id);
      audit(f,'설계 이동 · '+d.name);
      audit(target,'설계 반입 · '+d.name);
    }
  } else {
    const f=projectOf(next,op.folderId);
    const d=f.designs.find(item=>item.id===op.designId);
    switch(op.type) {
      case 'folderEdit':
        Object.assign(f,{name:op.name,customer:op.customer,description:op.description});
        audit(f,'프로젝트 정보 수정');break;
      case 'folderFavorite': f.favorite=!f.favorite;break;
      case 'folderCopy': {
        const copy={...structuredClone(f),name:fields(op.name,'새 프로젝트 이름',150,true)};
        return editWorkspace(next,{type:'resultImport',folder:copy});
      }
      case 'folderRemove': next.folders=next.folders.filter(item=>item.id!==f.id);break;
      case 'designNew': f.designs.push(designOf(op.kind,op.name,op.project,op.description));audit(f,'설계 추가');break;
      case 'designRemove':
        must(d&&!d.locked,'잠겼거나 없는 설계입니다.');
        f.designs=f.designs.filter(item=>item.id!==d.id);
        f.comments=f.comments.filter(item=>item.designId!==d.id);
        audit(f,'설계 삭제 · '+d.name);break;
      case 'designCopy':
        must(d,'설계를 찾을 수 없습니다.');
        f.designs.push(designOf(d.kind,op.name,d.project,d.description));
        audit(f,'설계 복제 · '+d.name);break;
      case 'designLock':
        must(d,'설계를 찾을 수 없습니다.');
        d.locked=!d.locked;
        d.generation+=1;
        audit(f,d.locked?'설계 잠금 · '+d.name:'설계 잠금 해제 · '+d.name);break;
      case 'designSync': {
        must(d&&!d.locked,'잠겼거나 없는 설계입니다.');
        const source=f.designs.find(item=>item.id===op.sourceDesignId);
        must(source&&source.id!==d.id,'반영할 설계를 선택하세요.');
        const current=d.project, incoming=source.project;
        const drawings={...current.drawings};
        const wiring={...current.wiring};
        let layout={};
        if(source.kind==='system') {
          layout={chassis:incoming.chassis,instruments:incoming.instruments};
          drawings.system=incoming.drawings.system;
        } else if(source.kind==='schematic'){
          wiring.groups=incoming.wiring.groups;
          wiring.nets=incoming.wiring.nets;
          drawings.schematic=incoming.drawings.schematic;
        } else {
          wiring.cables=incoming.wiring.cables;
          drawings.harness=incoming.drawings.harness;
        }
        d.project={...current,...layout,drawings,wiring,updatedAt:iso()};
        d.updated=d.project.updatedAt;d.generation+=1;
        audit(f,'설계 반영 · '+source.name+' → '+d.name);break;
      }
      case 'revisionNew':
        must(d&&!d.locked,'잠겼거나 없는 설계입니다.');
        must(!d.revisions.some(r=>r.name===op.name),'리비전 이름이 중복됩니다.');
        d.revisions.push({id:uid(),name:op.name,note:op.note,at:iso(),project:d.project});
        audit(f,'리비전 저장 · '+d.name);break;
      case 'templateNew':
        must(d,'설계를 찾을 수 없습니다.');
        next.templates.push(designOf(d.kind,op.name,d.project,d.description));break;
      case 'templateUse': {
        const template=next.templates.find(item=>item.id===op.templateId);
        must(template,'템플릿을 찾을 수 없습니다.');
        f.designs.push(designOf(template.kind,op.name,template.project,template.description));
        audit(f,'템플릿에서 설계 생성 · '+template.name);break;
      }
      case 'attachmentAdd':
        f.attachments.push(attachment({...op.attachment,id:uid(),at:iso()}));audit(f,'첨부 추가');break;
      case 'attachmentRemove':
        f.attachments=f.attachments.filter(item=>item.id!==op.attachmentId);audit(f,'첨부 삭제');break;
      case 'commentAdd':
        must(!op.designId||d,'검토할 설계를 선택하세요.');
        f.comments.push({id:uid(),text:op.text,designId:d?.id??'',at:iso(),closed:false,replies:[]});audit(f,'검토 등록');break;
      case 'commentToggle':
      case 'commentReply': {
        const comment=f.comments.find(item=>item.id===op.commentId);
        must(comment,'검토 항목을 찾을 수 없습니다.');
        if(op.type==='commentToggle')comment.closed=!comment.closed;
        else comment.replies.push({text:op.text,at:iso()});
        audit(f,op.type==='commentToggle'?'검토 상태 변경':'검토 답변');break;
      }
      default:fail('지원하는 작업공간 작업이 아닙니다.');
    }
  }
  return cleanWorkspace(next);
}

export function workspaceIndex(workspace) {
  const summary = ({project,revisions,...design})=>({...design,
    revisions:revisions.map(({project,...revision})=>revision)});
  return {folders:workspace.folders.map(f=>({...f,designs:f.designs.map(summary),attachments:f.attachments.map(({data,...row})=>row)})),
    templates:workspace.templates.map(summary)};
}

export function exportWorkspaceFolder(workspace,folderId) {
  return {schema:1,kind:'ate-workspace-folder',folder:projectOf(workspace,folderId)};
}

export function importWorkspaceFolder(workspace,packet) {
  must(packet?.schema===1&&packet.kind==='ate-workspace-folder','ATE 작업공간 반입 파일을 선택하세요.');
  return editWorkspace(workspace,{type:'resultImport',folder:packet.folder});
}
