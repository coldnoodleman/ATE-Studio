import { parseCsv } from '../csv.mjs';
import { useState } from 'react';
import { Cable, FlipHorizontal2, Plus, Server, Trash2 } from 'lucide-react';
import { modulePositions, receiverPortId } from '../receiver.mjs';
import { Modal } from './panels';
import type { Definition, Item, ReceiverMount, ReceiverMountResult, ReceiverTier, SaveReceiverMounts } from './types';

type Pick={tier:ReceiverTier;position:string;mounted?:ReceiverMount};
type ReceiversProps={receivers:Item[];catalog:Definition[];focus?:string;onAdd:()=>void;
  onMount:SaveReceiverMounts;onCable:(id:string,port:string)=>void};
export function ReceiverPanel({receivers,catalog,focus,onAdd,onMount,onCable}:ReceiversProps) {
  const [selected,setSelected]=useState(focus||receivers[0]?.id||'');
  const [rear,setRear]=useState(false),[pick,setPick]=useState<Pick|null>(null),[pinmap,setPinmap]=useState<ReceiverMount|null>(null);
  const item=receivers.find(r=>r.id===selected)||receivers[0];
  const profile=item?.definition.receiver;
  if(!item||!profile)return <div className="wire-empty"><Server size={24}/><h3>리시버를 배치하세요</h3><button className="btn primary" onClick={onAdd}><Plus size={16}/> 리시버 추가</button></div>;
  const mounts=item.receiverMounts??[];
  function replace(patch:ReceiverMount|null,confirmed?:boolean) {
    const rows=mounts.filter(m=>m!==pick.mounted);
    if(patch)rows.push(patch);
    const result=onMount(item.id,rows,confirmed);
    if(result.status==='saved')setPick(null);
    return result;
  }
  return <section className="receiver-view">
    <div className="wire-toolbar"><select aria-label="리시버 선택" value={item.id} onChange={e=>setSelected(e.target.value)}>{receivers.map(r=><option key={r.id} value={r.id}>{r.label||r.definition.part} · {r.definition.part}</option>)}</select>
      <button className="btn" onClick={onAdd}><Plus size={16}/> 리시버 추가</button><button className="btn" onClick={()=>setRear(v=>!v)}><FlipHorizontal2 size={16}/> {rear?'전면 보기':'후면 보기'}</button></div>
    <article className="wire-card">
      <div className="section-head"><div><h3>{item.definition.name}</h3><p>{profile.view}</p></div><span className="tag verified">{rear?'후면 · 좌우 반전':'전면'} · {mounts.length}개 모듈</span></div>
      {profile.tiers.map(t=><div className="receiver-tier" key={t.id}>
        <div className="receiver-tier-heading"><strong>{t.label}</strong><span>{t.mode==='adapter'?'VXI / 어댑터':'개별 배선'} · {t.positions.length} 위치</span></div>
        <div className="receiver-position-scroll"><div className="receiver-position-grid" style={{gridTemplateColumns:`repeat(${t.positions.length}, minmax(31px, 1fr))`}}>
          {(rear?[...t.positions].reverse():t.positions).map(position=>{
            const mount=mounts.find(m=>m.tier===t.id&&modulePositions(profile,m).includes(position));
            return <button type="button" key={position} className={'receiver-slot '+(mount?'mounted':'')}
              onClick={()=>setPick({tier:t,position:mount?.position||position,mounted:mount})}
              aria-label={`리시버 ${t.id}.${position} ${mount?.definition.part||'모듈 장착'}`} title={mount?.definition.part||'빈 위치'}>
              <b>{position}</b><span>{mount?mount.position===position?'▮':'—':'+'}</span></button>;
          })}
        </div></div>
      </div>)}
      {!!profile.ita?.length&&<p className="muted">프레임 대응 ITA {profile.ita.join(' · ')}</p>}
      <p className="source-line">{item.definition.source}</p>
    </article>
    <div className="wire-card"><h3>장착 모듈과 후면 종단</h3><div className="table-box"><table className="data-table"><thead><tr><th>위치</th><th>리시버 모듈</th><th>후면 종단 / 접점</th><th>대응 ITA 모듈</th><th>동작</th></tr></thead>
      <tbody>{mounts.map(m=><tr key={receiverPortId(m)}><td>{receiverPortId(m)}</td><td>{m.definition.part}<small>{m.definition.name}</small></td>
        <td>{m.definition.receiverModule.termination} · {m.contactPart||'미확인'}<small>{m.definition.connectors[0].pins.length} 핀{m.contactOverrides?.length?' · 개별 접점 '+m.contactOverrides.length+'핀':''}</small></td>
        <td>{m.definition.receiverModule.itaPart||'미확인'}</td><td><div className="inline-actions"><button className="btn compact" onClick={()=>setPinmap(m)}>접점 배치</button><button className="btn compact" onClick={()=>onCable(item.id,receiverPortId(m))}><Cable size={15}/> 케이블 연결</button></div></td></tr>)}</tbody>
    </table></div>{!mounts.length&&<div className="empty-small">빈 위치를 선택해 리시버 모듈을 장착하세요.</div>}</div>
    {pinmap&&<Modal title={receiverPortId(pinmap)+' · '+pinmap.definition.part+' 접점 배치'} onClose={()=>setPinmap(null)} wide>
      <div className="form"><p>{pinmap.definition.receiverModule.cavityView||'제조사 핀 식별자'}</p>
      {pinmap.definition.receiverModule.cavityRows?.length>0?
        <div className="cavities">{pinmap.definition.receiverModule.cavityRows.map((line,i)=><div key={i} className="cavity-line">{line.map(p=><span key={p} className={p==='1A'||p==='1'?'origin':''}>{p}</span>)}</div>)}</div>:
        <div className="net-points">{pinmap.definition.connectors[0].pins.map(p=><span className="net-point" key={p.id}>{p.id} {p.label}</span>)}</div>}
      <p className="source-line">{pinmap.definition.connectors[0].source}</p></div>
    </Modal>}
    {pick&&<Modal title={`${pick.tier.id}.${pick.position} 리시버 모듈`} onClose={()=>setPick(null)}>
      <MountForm pick={pick} catalog={catalog} onChange={replace}/></Modal>}
  </section>;
}
function MountForm({pick,catalog,onChange}:{pick:Pick;catalog:Definition[];onChange:(mount:ReceiverMount|null,confirmed?:boolean)=>ReceiverMountResult}) {
  const {tier,mounted,position}=pick;
  const items=catalog.filter(d=>d.kind==='receiverModule'&&tier.families.some(f=>f.toLowerCase()===d.receiverModule.series.toLowerCase()));
  if(mounted&&!items.some(x=>x.part===mounted.definition.part&&x.revision===mounted.definition.revision))items.unshift(mounted.definition);
  const [index,setIndex]=useState(mounted?items.findIndex(x=>x.part===mounted.definition.part&&x.revision===mounted.definition.revision):-1);
  const [contact,setContact]=useState(mounted?.contactPart||''),[adapter,setAdapter]=useState(mounted?.adapterPart||'');
  const [start,setStart]=useState(mounted?.adapterStart||position);
  const [overrides,setOverrides]=useState((mounted?.contactOverrides??[]).map(r=>r.pin+','+r.part).join('\n'));
  const [error,setError]=useState('');
  const [review,setReview]=useState<{mount:ReceiverMount|null;message:string}|null>(null);
  const d=items[index];
  const examplePin=d?.connectors[0]?.pins[0]?.id;
  const exampleContact=d?.receiverModule.contacts.find(c=>c.part!==contact)??d?.receiverModule.contacts[0];
  function save(mount:ReceiverMount|null,confirmed=false) {
    const result=onChange(mount,confirmed);
    if(result.status==='confirm')setReview({mount,message:result.message});
    if(result.status==='error') {
      setReview(null);
      setError(result.message);
    }
  }
  if(review)return <div className="form">
    <p role="status">{review.message}</p>
    <div className="modal-actions">
      <button className="btn" type="button" autoFocus onClick={()=>setReview(null)}>돌아가기</button>
      <button className="btn primary" type="button" onClick={()=>save(review.mount,true)}>{review.mount?'변경 저장':'탈거 확인'}</button>
    </div>
  </div>;
  return <form className="form" onSubmit={e=>{
    e.preventDefault();setError('');
    if(!d)return;
    try {
      const contactOverrides=parseCsv(overrides).map(row=>{
        if(row.length!==2)throw new Error('핀별 접점은 핀 번호와 품번의 2열을 사용하세요.');
        return {pin:row[0].trim(),part:row[1].trim()};
      });
      const adapterStart=tier.mode==='adapter'?start:mounted?.adapterStart;
      save({tier:tier.id,position,definition:d,contactPart:contact,adapterPart:adapter,adapterStart,contactOverrides});
    } catch(error) {setError(error.message);}
  }}>
    <label>장착용 모듈<select required value={index<0?'':index} onChange={e=>{
      const i=e.target.value===''?-1:Number(e.target.value);setIndex(i);
      const choices=items[i]?.receiverModule.contacts??[];setContact(choices.length===1?choices[0].part:'');setOverrides('');
    }}><option value="">모듈 선택</option>{items.map((p,i)=><option key={i} value={i}>{p.part} · {p.name} · Rev.{p.revision}</option>)}</select></label>
    {!items.length&&<p className="muted">장비 라이브러리에서 {tier.families.join(', ')} 리시버 모듈을 등록하세요.</p>}
    {d&&<><p>{d.receiverModule.series} · {d.receiverModule.width}위치 · {d.connectors[0].pins.length}핀 · {d.receiverModule.termination}</p>
      <label>후면 접점<select value={contact} onChange={e=>setContact(e.target.value)}><option value="">미확인</option>{d.receiverModule.contacts.map(c=><option key={c.part} value={c.part}>{c.part}{c.minAwg!=null?` · AWG ${c.minAwg}~${c.maxAwg}`:''}</option>)}</select></label>
      {!!d.receiverModule.contacts.length&&<label>핀별 접점 품번 <small>선택 사항입니다. 모든 핀에 위 접점을 쓰면 비워 두세요. 개별 지정은 핀 ID,품번 순서로 한 줄씩 입력하세요.</small><textarea rows={3}
        placeholder={examplePin&&exampleContact?`예: ${examplePin},${exampleContact.part}`:undefined} value={overrides} onChange={e=>setOverrides(e.target.value)}/></label>}
    </>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {tier.mode==='adapter'&&<><label>장착 어댑터<select required value={adapter} onChange={e=>setAdapter(e.target.value)}><option value="">어댑터 선택</option>{tier.adapters.map(a=><option key={a.part} value={a.part}>{a.part} · {a.width}위치</option>)}</select></label>
      <label>어댑터 시작 위치<select value={start} onChange={e=>setStart(e.target.value)}>{tier.positions.map(p=><option key={p}>{p}</option>)}</select></label></>}
    <div className="modal-actions">{mounted&&<button type="button" className="btn danger-btn" onClick={()=>save(null)}><Trash2 size={15}/> 탈거</button>}
      <button className="btn primary" type="submit" disabled={!d}>모듈 장착 저장</button>
    </div>
  </form>;
}
