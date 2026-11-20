import { useState } from 'react';
import { Plus, Trash2, Plug, ChevronDown } from 'lucide-react';
import { cleanConnectors, connectorGenders, pinKinds } from '../wiring.mjs';
import { parseCsv } from '../csv.mjs';
import type { Port } from './types';

export const genderNames:Record<string,string>={male:'수',female:'암',neutral:'무성별 / 접점',unknown:'미확인'};
export const pinNames:Record<string,string>={passive:'일반',in:'입력',out:'출력',io:'입출력',power:'전원',ground:'접지',shield:'실드',nc:'NC'};
const quote=(v:string)=>/[",\n\r]/.test(v)?'"'+v.replaceAll('"','""')+'"':v;
type Row=Omit<Port,'pins'> & {pinText:string};
const rowsFrom=(ports:Port[]):Row[]=>ports.map(({pins,...p})=>({...p,pinText:pins.map(pin=>[pin.id,pin.label||'',pin.kind].map(quote).join(',')).join('\n')}));
export function readPortRows(rows:Row[]) {
  return cleanConnectors(rows.map(({pinText,...r})=>({...r,
    pins:parseCsv(pinText).map(([id,label,kind,...extra])=>{
      if(extra.length)throw new Error('핀 목록은 번호, 신호명, 역할의 3열을 사용하세요.');
      return {id,label:label||'',kind:kind?.trim()||'passive'};
    })}))) as Port[];
}

export function PortForm({ports,onSave,onClose,onError}:{ports:Port[];onSave:(ports:Port[])=>boolean;onClose:()=>void;onError:(s:string)=>void}) {
  const [rows,setRows]=useState(()=>rowsFrom(ports));
  return <form className="form" onSubmit={e=>{
    e.preventDefault();
    try{onSave(readPortRows(rows));}catch(error){onError(error.message);}
  }}><PortFields rows={rows} onChange={setRows}/>
    <div className="modal-actions"><button type="button" className="btn" onClick={onClose}>취소</button><button className="btn primary">구성품 핀맵 저장</button></div>
  </form>;
}

export {rowsFrom};
export function PortFields({rows,onChange,one=false}:{rows:Row[];onChange:(rows:Row[])=>void;one?:boolean}) {
  const put=(i:number,patch:Partial<Row>)=>onChange(rows.map((r,k)=>k===i?{...r,...patch}:r));
  const add=()=>{
    let n=1;while(rows.some(r=>r.id.toUpperCase()==='J'+n))n++;
    onChange([...rows,{id:one?'REAR':'J'+n,name:'',family:'',gender:one?'neutral':'unknown',part:'',source:'',pinText:'1,,passive'}]);
  };
  const autoPins=(i:number)=>{
    const value=window.prompt('순차 핀 개수 (1~1000)','9');
    if(value==null)return;
    const n=Number(value);
    if(Number.isInteger(n)&&n>=1&&n<=1000&&window.confirm('이 커넥터의 핀 목록을 순차 번호로 교체할까요?'))put(i,{pinText:Array.from({length:n},(_,j)=>(j+1)+',,passive').join('\n')});
  };
  return <section className="form">
    <div className="section-head"><h3><Plug size={15}/> 커넥터와 핀</h3><button className="btn compact" type="button" disabled={rows.length>=(one?1:48)} onClick={add}><Plus size={14}/> 커넥터 추가</button></div>
    {!rows.length&&<p className="muted">제조사 핀맵을 참고해 연결할 커넥터를 등록합니다.</p>}
    {rows.map((r,i)=><details className="port-form-row" key={i} open={rows.length===1?true:undefined}>
      <summary><ChevronDown size={15}/><b>{r.id||'커넥터 '+(i+1)}</b><span>{r.family||'규격 입력'}</span></summary>
      <div className="form"><div className="form-grid">
        <label>커넥터 ID<input maxLength={80} value={r.id} required onChange={e=>put(i,{id:e.target.value})}/></label>
        <label>이름<input value={r.name||''} onChange={e=>put(i,{name:e.target.value})} maxLength={120}/></label>
        <label>규격<input placeholder="예: D-Sub 9" required value={r.family} onChange={e=>put(i,{family:e.target.value})} maxLength={120}/></label>
        <label>성별<select value={r.gender} onChange={e=>put(i,{gender:e.target.value})}>{connectorGenders.map(v=><option key={v} value={v}>{genderNames[v]}</option>)}</select></label>
        <label>품번<input value={r.part||''} onChange={e=>put(i,{part:e.target.value})} maxLength={120}/></label>
        <label>핀맵 출처<input value={r.source||''} onChange={e=>put(i,{source:e.target.value})} maxLength={300} placeholder="제조사 문서와 개정"/></label>
      </div>
      <label className="field-label">핀 목록 <span>번호, 신호명, 역할 · 역할 생략 가능</span>
        <textarea aria-label={'핀 목록 '+r.id} rows={6} className="code-field" value={r.pinText} spellCheck={false} onChange={e=>put(i,{pinText:e.target.value})}/>
      </label>
      <small className="muted">{pinKinds.map(k=>k+'='+pinNames[k]).join(' · ')}</small>
      <div className="inline-actions"><button type="button" className="btn compact" onClick={()=>autoPins(i)}>순차 핀 생성</button><button type="button" className="btn compact danger-btn" onClick={()=>onChange(rows.filter((_,j)=>j!==i))}><Trash2 size={14}/> 커넥터 제거</button></div>
      </div>
    </details>)}
  </section>;
}
