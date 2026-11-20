import { useId, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { buildDrawing, drawingLinePoints, emptyDrawing, portDrawingId } from '../drawing.mjs';
import { indexDevices } from '../wiring.mjs';
import { Modal } from './panels';
import type { Device, Drawing, DrawingMark, DrawingMode, DrawingPoint, Project } from './types';

type PortRef={deviceId:string;portId:string};
type Node=ReturnType<typeof buildDrawing>['nodes'][number];
type Line=ReturnType<typeof buildDrawing>['lines'][number];
type Tool='selection'|'pan'|'route'|DrawingMark['kind'];
type Overlay='showPort'|'connect'|'custom'|'text';
type Props={project:Project;mode:DrawingMode;onChange:(value:Drawing)=>boolean;onOpen:(id:string)=>void;
  onConnect?:(a:PortRef,b:PortRef)=>void;onCreateConnector?:(value:ConnectorInput)=>PortRef|null;
  notify:(text:string,error?:boolean)=>void};
export type ConnectorInput={name:string;family:string;part:string;gender:string;pins:string[];flying:boolean};
const api=window.studio;
const names:Record<DrawingMode,string>={harness:'케이블 경로 도면',system:'시스템 구성 도면',schematic:'신호 결선도'};
const toolNames:Record<Tool,string>={selection:'선택',pan:'이동',route:'경유점 추가',text:'주석',junction:'분기점',rectangle:'사각형',ellipse:'타원'};
const key=()=>crypto.randomUUID();
const put=(draft:Drawing,position:DrawingPoint&{id:string})=>({...draft,positions:[...draft.positions.filter(x=>x.id!==position.id),position]});

export function DrawingCanvas({project,mode,onChange,onOpen,onConnect,onCreateConnector,notify}:Props){
  const drawing=project.drawings?.[mode]??emptyDrawing() as Drawing;
  const model=useMemo(()=>buildDrawing(project,mode),[project,mode]);
  const devices=useMemo(()=>indexDevices(project) as Map<string,Device>,[project]);
  const ports=useMemo(()=>[...devices.values()].flatMap(d=>(d.definition.connectors??[]).map(p=>({
    key:portDrawingId(d.id,p.id),deviceId:d.id,portId:p.id,label:d.label+' · '+p.id+' · '+p.family
  }))),[devices]);
  const [selection,setSelection]=useState<string[]>([]);
  const [line,setLine]=useState('');
  const [tool,setTool]=useState<Tool>('selection');
  const [zoom,setZoom]=useState(0.75);
  const [overlay,setOverlay]=useState<Overlay|null>(null);
  const [textPoint,setTextPoint]=useState<DrawingPoint|null>(null);
  const [preview,setPreview]=useState<Record<string,DrawingPoint>>({});
  const viewport=useRef<HTMLDivElement>(null);
  const svg=useRef<SVGSVGElement>(null);
  const drag=useRef<{id:string;start:DrawingPoint;items:(DrawingPoint&{id:string})[];pan?:{left:number;top:number}}|null>(null);
  const clipboard=useRef<DrawingMark[]>([]);
  const pattern=useId();
  const itemBounds=model.bounds;
  const selectedLine=model.lines.find(x=>x.id===line);
  const shownNodes=model.nodes.map(n=>({...n,...preview[n.id]}));
  const shownMarks=model.marks.map(n=>({...n,...preview[n.id]}));
  const transform=(x:number,y:number)=>{
    const matrix=svg.current?.getScreenCTM();
    if(!matrix)return {x:0,y:0};
    return new DOMPoint(x,y).matrixTransform(matrix.inverse());
  };
  const clamp=(point:DrawingPoint)=>({x:Math.max(50,Math.min(itemBounds.width-50,Math.round(point.x))),
    y:Math.max(36,Math.min(itemBounds.height-30,Math.round(point.y)))});
  const positions=(ids=selection)=>[...model.nodes,...model.marks].filter(n=>ids.includes(n.id));
  const select=(id:string,add:boolean)=>{
    setLine('');
    const next=add?selection.includes(id)?selection.filter(k=>k!==id):[...selection,id]:selection.includes(id)?selection:[id];
    setSelection(next);
    return next;
  };
  function applyPositions(entries:(DrawingPoint&{id:string})[]){
    let next={...drawing,marks:[...drawing.marks]};
    for(const entry of entries) {
      if(next.marks.some(m=>m.id===entry.id))next.marks=next.marks.map(m=>m.id===entry.id?{...m,x:entry.x,y:entry.y}:m);
      else next=put(next,entry);
    }
    return onChange(next);
  }
  function start(node:Node|DrawingMark,event:PointerEvent<SVGElement>){
    if(tool!=='selection')return;
    event.stopPropagation();
    const ids=select(node.id,event.ctrlKey||event.metaKey||event.shiftKey);
    if(!ids.includes(node.id))return;
    drag.current={id:node.id,start:transform(event.clientX,event.clientY),items:positions(ids)};
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent<SVGElement>){
    const d=drag.current;
    if(!d)return;
    if(d.pan&&viewport.current){
      viewport.current.scrollLeft=d.pan.left+d.start.x-event.clientX;
      viewport.current.scrollTop=d.pan.top+d.start.y-event.clientY;
      return;
    }
    const p=transform(event.clientX,event.clientY);
    setPreview(Object.fromEntries(d.items.map(n=>[n.id,clamp({x:n.x+p.x-d.start.x,y:n.y+p.y-d.start.y})])));
  }
  function finish(){
    const d=drag.current;
    if(d&&!d.pan&&Object.keys(preview).length)applyPositions(Object.entries(preview).map(([id,point])=>({id,...point})));
    drag.current=null;
    setPreview({});
  }
  function backgroundDown(event:PointerEvent<SVGSVGElement>){
    if(tool==='pan'&&viewport.current){
      drag.current={id:'',start:{x:event.clientX,y:event.clientY},items:[],pan:{left:viewport.current.scrollLeft,top:viewport.current.scrollTop}};
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function changeRoute(via:Drawing['routes'][number]['via']){
    if(!selectedLine)return;
    onChange({...drawing,routes:[...drawing.routes.filter(r=>r.id!==selectedLine.targetId),{id:selectedLine.targetId,via}]});
  }
  const path=drawing.routes.find(r=>r.id===selectedLine?.targetId)?.via??[];
  function newMark(kind:DrawingMark['kind'],point:DrawingPoint,text:string){
    const mark={id:key(),kind,text,...point};
    if(onChange({...drawing,marks:[...drawing.marks,mark]}))setSelection([mark.id]);
  }
  function background(event:MouseEvent<SVGSVGElement>){
    if(event.target!==event.currentTarget&&!(event.target as SVGElement).classList.contains('drawing-paper'))return;
    if(tool==='pan')return;
    const p=clamp(transform(event.clientX,event.clientY));
    if(tool==='selection'){setSelection([]);setLine('');}
    else if(tool==='route'){if(selectedLine&&path.length<24)changeRoute([...path,p]);}
    else if(tool==='text'){setTextPoint(p);setOverlay('text');}
    else newMark(tool,p,tool==='junction'?'분기 '+(drawing.marks.filter(m=>m.kind==='junction').length+1):'');
  }
  function align(axis:'x'|'y',spread:boolean){
    const items=positions().sort((a,b)=>a[axis]-b[axis]);
    if(items.length<(spread?3:2))return;
    const first=items[0][axis],last=items.at(-1)[axis];
    applyPositions(items.map((item,i)=>({id:item.id,x:item.x,y:item.y,[axis]:spread?first+(last-first)*i/(items.length-1):first})));
  }
  function deleteMarks(){
    const removed=new Map(drawing.marks.filter(m=>selection.includes(m.id)).map(m=>[m.id,m]));
    if(!removed.size)return;
    onChange({...drawing,marks:drawing.marks.filter(m=>!removed.has(m.id)),
      routes:drawing.routes.map(r=>({...r,via:r.via.map(p=>{
        const m='junction' in p?removed.get(p.junction):null;
        return m?{x:m.x,y:m.y}:p;
      })}))});
    setSelection([]);
  }
  function showPort(ref:PortRef){
    const id=portDrawingId(ref.deviceId,ref.portId), existing=shownNodes.find(n=>n.id===id);
    if(existing){setSelection([id]);setOverlay(null);return;}
    const i=shownNodes.length;
    if(onChange(put(drawing,{id,x:70+(i%6)*220,y:75+Math.floor(i/6)*100}))){
      setSelection([id]);setOverlay(null);
    }
  }
  async function exportSvg(){
    try{const result=await api.exportDrawing(project,mode);if(result)notify(result.name+' 저장 완료');}
    catch(error){notify(error.message,true);}
  }
  function keyboard(event:React.KeyboardEvent<HTMLDivElement>){
    if((event.target as HTMLElement).matches('input,textarea,select,button'))return;
    if(event.key==='Delete'){event.preventDefault();deleteMarks();return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){
      clipboard.current=drawing.marks.filter(m=>selection.includes(m.id));if(clipboard.current.length)event.preventDefault();return;
    }
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'&&clipboard.current.length){
      event.preventDefault();
      const copies=clipboard.current.map(m=>({...m,id:key(),...clamp({x:m.x+20,y:m.y+20})}));
      if(onChange({...drawing,marks:[...drawing.marks,...copies]}))setSelection(copies.map(c=>c.id));
      return;
    }
    const shift:Record<string,[number,number]>={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]};
    const delta=shift[event.key];
    if(delta&&selection.length){event.preventDefault();applyPositions(positions().map(n=>({id:n.id,...clamp({x:n.x+delta[0],y:n.y+delta[1]})})));}
  }
  return <section className="drawing-editor" onKeyDown={keyboard}>
    <div className="section-head"><div><h2>{names[mode]}</h2></div><button className="btn compact" onClick={()=>void exportSvg()}>SVG 내보내기</button></div>
    <div className="drawing-toolbar" role="toolbar" aria-label={names[mode]+' 편집'}>
      {(['selection','pan','text','rectangle','ellipse',...(mode==='harness'?['junction','route']:[])] as Tool[]).map(t=><button key={t} className={tool===t?'btn compact primary':'btn compact'}
        disabled={t==='route'&&!selectedLine} aria-pressed={tool===t} onClick={()=>setTool(t)}>{toolNames[t]}</button>)}
      <button className="btn compact" disabled={selection.length<2} onClick={()=>align('y',false)}>가로 정렬</button>
      <button className="btn compact" disabled={selection.length<2} onClick={()=>align('x',false)}>세로 정렬</button>
      <button className="btn compact" disabled={selection.length<3} onClick={()=>align('x',true)}>가로 간격</button>
      <button className="btn compact" disabled={selection.length<3} onClick={()=>align('y',true)}>세로 간격</button>
      <button className="btn compact" onClick={()=>setZoom(z=>Math.max(0.28,z-0.1))} aria-label="도면 축소">−</button>
      <button className="btn compact" onClick={()=>{const width=viewport.current?.clientWidth;setZoom(width?width/itemBounds.width:0.75);}}>화면 맞춤</button>
      <button className="btn compact" onClick={()=>setZoom(z=>Math.min(2,z+0.1))} aria-label="도면 확대">+</button>
      <span>{Math.round(zoom*100)}%</span>
    </div>
    {mode==='harness'&&<div className="drawing-toolbar">
      <button className="btn compact" onClick={()=>setOverlay('showPort')}>장비 커넥터 표시</button>
      <button className="btn compact" onClick={()=>setOverlay('custom')}>커넥터·Flying Lead 추가</button>
      <button className="btn compact primary" disabled={ports.length<2} onClick={()=>setOverlay('connect')}>케이블 경로 연결</button>
      {selectedLine&&<><button className="btn compact" onClick={()=>onOpen(selectedLine.targetId)}>도체·핀 편집</button>
        <button className="btn compact" disabled={!path.length} onClick={()=>changeRoute(path.slice(0,-1))}>마지막 경유점 제거</button>
        <label>분기 경유<select value="" onChange={e=>{if(e.target.value&&path.length<24)changeRoute([...path,{junction:e.target.value}]);}}>
          <option value="">분기점 선택</option>{model.marks.filter(m=>m.kind==='junction').map(m=><option key={m.id} value={m.id}>{m.text}</option>)}</select></label></>}
    </div>}
    <div className="drawing-scroll" ref={viewport} tabIndex={0} aria-label={names[mode]+' 캔버스'}>
      <svg ref={svg} className={'drawing-svg '+tool} width={itemBounds.width*zoom} height={itemBounds.height*zoom}
        viewBox={'0 0 '+itemBounds.width+' '+itemBounds.height} onClick={background} onPointerDown={backgroundDown} onPointerMove={move} onPointerUp={finish}
        onPointerCancel={()=>{drag.current=null;setPreview({});}} aria-label={names[mode]}>
        <defs><pattern id={pattern} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#cedce2" strokeWidth=".6"/></pattern></defs>
        <rect className="drawing-paper" width="100%" height="100%" fill={'url(#'+pattern+')'}/>
        {model.lines.map(l=>{
          const toPreview=n=>({...n,...preview[n.id]});
          const points=drawingLinePoints({...l,a:toPreview(l.a),b:toPreview(l.b),via:l.via.map(toPreview)});
          const i=Math.floor(points.length/2),a=points[i-1],b=points[i];
          return <g key={l.id} className={line===l.id?'drawing-link selected':'drawing-link'} onClick={e=>{e.stopPropagation();setLine(l.id);setSelection([]);}}
            onDoubleClick={()=>onOpen(l.targetId)}><title>{[l.label,l.description,l.pins?.join(' ↔ ')].filter(Boolean).join(' · ')}</title>
            <polyline points={points.map(p=>p.join(',')).join(' ')} className="hit"/><polyline points={points.map(p=>p.join(',')).join(' ')} className="visible"/>
            <text x={(a[0]+b[0])/2} y={(a[1]+b[1])/2-8}>{l.label}</text></g>;
        })}
        {shownNodes.map(n=><g key={n.id} className={'drawing-node '+(selection.includes(n.id)?'selected ':'')+(n.kind==='missing'?'missing':'')}
          role="button" tabIndex={0} aria-label={n.title} transform={'translate('+n.x+' '+n.y+')'}
          onPointerDown={e=>start(n,e)} onDoubleClick={()=>onOpen(n.deviceId)} onKeyDown={e=>{if(e.key==='Enter')onOpen(n.deviceId);}}>
          <title>{n.title+' · '+n.subtitle}</title><rect x="-65" y="-31" width="130" height="62" rx="9"/>
          <text y="-7" textAnchor="middle" fontWeight="700">{n.title.slice(0,20)}</text>
          <text y={n.slots?8:15} textAnchor="middle" className="sub">{n.subtitle.slice(0,22)}</text>
          {n.slots&&n.slots.slice(0,24).map((s,i)=><rect key={s.number} x={-55+i*110/Math.min(n.slots.length,24)} y="15" width={86/Math.min(n.slots.length,24)} height="8" className={s.used?'used':'slot-shape'}/>)}</g>)}
        {shownMarks.map(m=><g key={m.id} transform={'translate('+m.x+' '+m.y+')'} className={'drawing-mark '+(selection.includes(m.id)?'selected':'')}
          role="button" tabIndex={0} aria-label={m.text||toolNames[m.kind]} onPointerDown={e=>start(m,e)}
          onDoubleClick={()=>{setSelection([m.id]);setTextPoint(null);setOverlay('text');}}>
          {m.kind==='junction'?<circle r="6"/>:m.kind==='ellipse'?<ellipse rx="54" ry="26"/>:m.kind==='rectangle'?<rect x="-54" y="-26" width="108" height="52" rx="5"/>:null}
          <text y={m.kind==='junction'?-13:4} textAnchor="middle">{m.text}</text></g>)}
      </svg>
    </div>
    {selectedLine&&<p className="drawing-detail">{selectedLine.label} {selectedLine.description||selectedLine.pins?.join(' ↔ ')}</p>}
    {overlay&&<Modal title={overlay==='showPort'?'장비 커넥터 표시':overlay==='connect'?'케이블 양단 선택':overlay==='custom'?'커넥터·Flying Lead 등록':'도면 주석'} onClose={()=>setOverlay(null)}>
      {(overlay==='showPort'||overlay==='connect')&&<PortPicker ports={ports} pair={overlay==='connect'} onSave={(a,b)=>{
        if(b){onConnect(a,b);setOverlay(null);}else showPort(a);
      }}/>}
      {overlay==='custom'&&<ConnectorForm onSave={value=>{const ref=onCreateConnector(value);if(ref)showPort(ref);}}/>}
      {overlay==='text'&&<DrawingText initial={textPoint?'':drawing.marks.find(m=>selection.includes(m.id))?.text||''} onSave={text=>{
        if(textPoint)newMark('text',textPoint,text);
        else onChange({...drawing,marks:drawing.marks.map(m=>selection.includes(m.id)?{...m,text}:m)});
        setOverlay(null);
      }}/>}
    </Modal>}
  </section>;
}

function PortPicker({ports,pair,onSave}:{ports:(PortRef&{key:string;label:string})[];pair:boolean;onSave:(a:PortRef,b?:PortRef)=>void}){
  const [a,setA]=useState(''),[b,setB]=useState('');
  const fields=(label:string,value:string,set:(value:string)=>void,other='')=><label>{label}<select required value={value} onChange={e=>set(e.target.value)}>
    <option value="">선택</option>{ports.map(p=><option key={p.key} value={p.key} disabled={p.key===other}>{p.label}</option>)}</select></label>;
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave(ports.find(p=>p.key===a),ports.find(p=>p.key===b));}}>
    {fields(pair?'A측 커넥터':'커넥터',a,setA,b)}{pair&&fields('B측 커넥터',b,setB,a)}
    <div className="modal-actions"><button className="btn primary" disabled={!a||(pair&&(!b||a===b))}>{pair?'도체 편집 열기':'도면에 추가'}</button></div>
  </form>;
}
function ConnectorForm({onSave}:{onSave:(value:ConnectorInput)=>void}){
  const [name,setName]=useState(''),[family,setFamily]=useState(''),[part,setPart]=useState(''),[gender,setGender]=useState('unknown');
  const [count,setCount]=useState(9),[pinText,setPinText]=useState(''),[flying,setFlying]=useState(false);
  return <form className="form" onSubmit={e=>{e.preventDefault();
    const pins=pinText.trim()?pinText.split(/[\n,]/).map(p=>p.trim()).filter(Boolean):Array.from({length:count},(_,i)=>String(i+1));
    onSave({name,family:flying?'Flying Lead':family,part,gender:flying?'neutral':gender,pins,flying});
  }}>
    <label>종류<select value={flying?'lead':'connector'} onChange={e=>setFlying(e.target.value==='lead')}><option value="connector">사용자 정의 커넥터</option><option value="lead">Flying Lead</option></select></label>
    <label>표시 이름<input required maxLength={90} value={name} onChange={e=>setName(e.target.value)}/></label>
    {!flying&&<div className="form-grid"><label>규격<input required maxLength={80} value={family} onChange={e=>setFamily(e.target.value)}/></label>
      <label>품번<input maxLength={100} value={part} onChange={e=>setPart(e.target.value)}/></label>
      <label>장비 커넥터 성별<select value={gender} onChange={e=>setGender(e.target.value)}><option value="unknown">미확인</option><option value="male">수</option><option value="female">암</option><option value="neutral">구분 없음</option></select></label></div>}
    <label>핀 또는 리드 수<input type="number" required min={1} max={1000} value={count} onChange={e=>setCount(Number(e.target.value))}/></label>
    <label>핀 ID 직접 입력 <small>비워 두면 1부터 순서대로 만듭니다.</small><textarea rows={3} maxLength={24000} value={pinText} onChange={e=>setPinText(e.target.value)}/></label>
    <div className="modal-actions"><button className="btn primary">등록하고 도면에 추가</button></div>
  </form>;
}
function DrawingText({initial,onSave}:{initial:string;onSave:(text:string)=>void}){
  const [text,setText]=useState(initial);
  return <form className="form" onSubmit={e=>{e.preventDefault();onSave(text);}}><label>내용<input autoFocus maxLength={240} value={text} onChange={e=>setText(e.target.value)}/></label>
    <div className="modal-actions"><button className="btn primary">주석 저장</button></div></form>;
}
