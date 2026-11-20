import { indexDevices } from './wiring.mjs';

export const drawingModes=['system','schematic','harness'];
export const drawingBounds={width:1440,height:900};
export const markKinds=['text','junction','rectangle','ellipse'];
export const portDrawingId=(deviceId,portId)=>JSON.stringify([deviceId,portId]);
const need=(v,message)=>{if(!v)throw new Error(message);};
const label=(v,max)=>{
  need(typeof (v??'')==='string'&&(v??'').length<=max,'도면 텍스트 길이를 확인하세요.');
  return (v??'').trim();
};
const identifier=v=>{
  need(typeof v==='string'&&v.length>0&&v.length<=220&&!/[\u0000-\u001f]/.test(v),'도면 개체 ID를 확인하세요.');
  return v;
};
const place=(v,max)=>{
  need(Number.isFinite(v)&&v>=0&&v<=max,'도면 좌표가 유효한 범위를 벗어났습니다.');
  return Math.round(v);
};
const point=v=>({x:place(v.x,drawingBounds.width),y:place(v.y,96000)});
const rows=(v,max,parse)=>{
  need(Array.isArray(v)&&v.length<=max,'도면 개체 개수를 확인하세요.');
  const list=v.map(parse);
  need(new Set(list.map(x=>x.id)).size===list.length,'도면 개체 ID가 중복됩니다.');
  return list;
};
export const emptyDrawing=()=>({positions:[],marks:[],routes:[]});
export function cleanDrawing(value={}) {
  const marks=rows(value.marks??[],400,m=>{
    need(markKinds.includes(m.kind),'도면 주석 종류를 선택하세요.');
    return {id:identifier(m.id),kind:m.kind,text:label(m.text,240),...point(m)};
  });
  const junctions=new Set(marks.filter(row=>row.kind==='junction').map(row=>row.id));
  return {
    positions:rows(value.positions??[],3000,p=>({id:identifier(p.id),...point(p)})),
    marks,
    routes:rows(value.routes??[],1200,route=>{
      need(Array.isArray(route.via)&&route.via.length<=24,'케이블 경유점을 확인하세요.');
      return {id:identifier(route.id),via:route.via.map(p=>{
        if(!p.junction)return point(p);
        need(junctions.has(p.junction),'케이블 경유점의 분기점을 찾을 수 없습니다.');
        return {junction:p.junction};
      })};
    }),
  };
}
export function cleanDrawings(value={}) {
  return Object.fromEntries(drawingModes.map(mode=>[mode,cleanDrawing(value[mode])]));
}

export function buildDrawing(project,mode) {
  need(drawingModes.includes(mode),'도면 유형을 선택하세요.');
  const source=project.drawings?.[mode]??emptyDrawing();
  const saved=new Map(source.positions.map(x=>[x.id,x]));
  const marks=new Map(source.marks.map(x=>[x.id,x]));
  const routes=new Map(source.routes.map(x=>[x.id,x.via]));
  const devices=indexDevices(project);
  const nodes=new Map(), lines=[];
  const partTitle=device=>device?.label||'제거된 구성품';
  const stage=(id,info)=>{
    if(nodes.has(id))return nodes.get(id);
    const i=nodes.size, p=saved.get(id)??{x:70+(i%6)*220,y:75+Math.floor(i/6)*100};
    const node={...info,id,x:p.x,y:p.y};
    nodes.set(id,node);
    return node;
  };
  const deviceNode=id=>{
    const d=devices.get(id);
    return stage(id,{deviceId:id,title:partTitle(d),subtitle:d?.definition.part??'연결 재검토',
      kind:d?.definition.kind??'missing'});
  };
  const portNode=ref=>{
    const d=devices.get(ref.deviceId), p=d?.definition.connectors?.find(x=>x.id===ref.portId);
    const physical=portDrawingId(ref.deviceId,ref.portId);
    return stage(physical,{deviceId:ref.deviceId,portId:ref.portId,title:partTitle(d)+' · '+ref.portId,
      subtitle:p?String(p.pins.length)+'핀 · '+p.family:'연결 재검토',kind:p?d.definition.kind:'missing'});
  };
  if(mode==='system'){
    for(const c of project.chassis){
      stage(c.id,{deviceId:c.id,title:c.label||c.definition.part,subtitle:c.definition.part+' · '+c.definition.slots.length+' 슬롯',
        kind:'chassis',slots:c.definition.slots.map(s=>({number:s.number,used:c.placements.some(x=>x.slot===s.number)}))});
    }
    for(const d of project.instruments)deviceNode(d.id);
  }
  if(mode==='schematic'){
    for(const g of project.wiring.groups)for(const id of g.members)deviceNode(id);
    for(const d of devices.values())if(d.definition.connectors?.length)deviceNode(d.id);
    for(const net of project.wiring.nets){
      const a=deviceNode(net.ends[0].deviceId);
      for(const [i,end] of net.ends.slice(1).entries()){
        const b=deviceNode(end.deviceId);
        lines.push({id:net.id+'-'+i,targetId:net.id,label:net.name,a,b,via:[],pins:[net.ends[0].pin,end.pin]});
      }
    }
  }
  if(mode==='harness'){
    for(const p of source.positions){
      let key;
      try{key=JSON.parse(p.id);}catch{continue;}
      if(Array.isArray(key)&&key.length===2&&key.every(x=>typeof x==='string')){
        const [deviceId,portId]=key;
        const d=devices.get(deviceId);
        if(d?.definition.connectors?.some(c=>c.id===portId))portNode({deviceId,portId});
      }
    }
    for(const cable of project.wiring.cables){
      const a=portNode(cable.a), b=portNode(cable.b);
      const via=(routes.get(cable.id)??[]).map(p=>p.junction?marks.get(p.junction):p).filter(Boolean);
      lines.push({id:cable.id,targetId:cable.id,label:cable.code,a,b,via,
        description:[cable.name,cable.lengthMm!=null?cable.lengthMm+' mm':'',cable.wires.length+'선',cable.bundle].filter(Boolean).join(' · ')});
    }
  }
  const values=[...nodes.values()];
  const height=Math.max(drawingBounds.height,...values.map(p=>p.y+85),...source.marks.map(p=>p.y+70),...lines.flatMap(l=>l.via.map(p=>p.y+70)));
  return {nodes:values,lines,marks:source.marks,bounds:{width:drawingBounds.width,height}};
}

export function drawingLinePoints(line){
  if(line.a.id===line.b.id&&!line.via.length){
    return [[line.a.x,line.a.y],[line.a.x+100,line.a.y-54],[line.a.x-100,line.a.y-54],[line.b.x,line.b.y]];
  }
  return [line.a,...line.via,line.b].map(p=>[p.x,p.y]);
}
const escape=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'')
  .replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function exportDrawingSvg(project,mode) {
  const d=buildDrawing(project,mode);
  const coordinates=[...d.nodes,...d.marks].map(p=>[p.x,p.y]).concat(d.lines.flatMap(drawingLinePoints));
  const left=coordinates.length?Math.min(...coordinates.map(p=>p[0]))-74:0;
  const top=coordinates.length?Math.min(...coordinates.map(p=>p[1]))-45:0;
  const width=coordinates.length?Math.max(...coordinates.map(p=>p[0]))-left+74:d.bounds.width;
  const height=coordinates.length?Math.max(...coordinates.map(p=>p[1]))-top+49:d.bounds.height;
  const markup=[...d.lines.map(l=>{
    const points=drawingLinePoints(l);
    const i=Math.floor(points.length/2), a=points[i-1], b=points[i];
    return '<polyline points="'+points.map(p=>p.join(',')).join(' ')+'" fill="none" stroke="#216b81" stroke-width="2.5"/>'+
      '<text x="'+((a[0]+b[0])/2)+'" y="'+((a[1]+b[1])/2-8)+'" fill="#143b4b">'+escape(l.label)+'</text>';
  }),...d.nodes.map(n=>'<g transform="translate('+n.x+' '+n.y+')"><rect x="-65" y="-31" width="130" height="62" rx="9" fill="#f1f6f8" stroke="#527584"/>'+
    '<text x="0" y="-5" text-anchor="middle" font-weight="700">'+escape(n.title)+'</text><text x="0" y="14" text-anchor="middle">'+escape(n.subtitle)+'</text></g>'),
  ...d.marks.map(m=>{
    const geometry=m.kind==='junction'?'<circle r="5" fill="#216b81"/>':m.kind==='rectangle'?'<rect x="-54" y="-26" width="108" height="52" rx="5" fill="none" stroke="#738999"/>':
      m.kind==='ellipse'?'<ellipse rx="54" ry="26" fill="none" stroke="#738999"/>':'';
    return '<g transform="translate('+m.x+' '+m.y+')">'+geometry+'<text text-anchor="middle" y="'+(m.kind==='junction'?'-12':'4')+'">'+escape(m.text)+'</text></g>';
  })].join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="'+left+' '+top+' '+width+' '+height+'"><title>'+escape(project.name)+'</title><rect x="'+left+'" y="'+top+'" width="'+width+'" height="'+height+'" fill="#fff"/><g font-family="Studio, sans-serif" font-size="12">'+markup+'</g></svg>\n';
}
