export const tierModes=['discrete','adapter'];
export const receiverTerminations=['crimp','solder','pcb','wire-wrap','feedthrough'];
const slug=/^[A-Za-z0-9_-]+$/;
const req=(ok,why)=>{if(!ok)throw new Error(why);};
const text=(x,label,max=160,need=false)=>{
  x=x??'';
  req(typeof x==='string'&&x.length<=max&&(!need||x.trim()),label+' 항목을 확인하세요.');
  return x.trim();
};
const id=(x,label)=>{
  const v=text(x,label,45,true);
  req(slug.test(v),label+'에 영문, 숫자, 밑줄, 하이픈을 사용하세요.');
  return v;
};
const count=(x,a,b,label)=>{
  req(Number.isInteger(x)&&x>=a&&x<=b,`${label}은(는) ${a}~${b} 범위입니다.`);
  return x;
};
const list=(x,max,label)=>{
  req(Array.isArray(x)&&x.length<=max,label+' 목록을 확인하세요.');
  return x;
};
const unique=(xs,key,label)=>{
  const keys=xs.map(key);
  req(new Set(keys).size===xs.length,label+'이(가) 중복됩니다.');
  return xs;
};

export function cleanReceiver(p) {
  req(p&&typeof p==='object','리시버 프로파일을 입력하세요.');
  const tiers=list(p.tiers,12,'리시버 단').map(t=>{
    req(tierModes.includes(t.mode),'리시버 장착 방식을 지정하세요.');
    const families=unique(list(t.families,24,'수용 모듈 시리즈').map(f=>text(f,'모듈 시리즈',80,true)),s=>s.toLowerCase(),'수용 모듈 시리즈');
    const positions=unique(list(t.positions,200,'모듈 위치').map(x=>id(x,'모듈 위치')),s=>s.toLowerCase(),'모듈 위치');
    const adapters=unique(list(t.adapters??[],40,'어댑터').map(a=>({
      part:text(a.part,'장착 어댑터 품번',100,true),width:count(a.width,1,32,'어댑터 폭'),
    })),s=>s.part.toLowerCase(),'어댑터 품번');
    req(positions.length&&families.length,'각 단에는 위치와 수용 모듈 시리즈가 필요합니다.');
    req(t.mode!=='adapter'||adapters.length,'어댑터 장착 단에 허용 어댑터를 등록하세요.');
    return {id:id(t.id,'단 ID'),label:text(t.label,'단 이름',80,true),mode:t.mode,
      positions,families,adapters,ita:list(t.ita??[],40,'ITA 품번').map(v=>text(v,'ITA 품번',100,true))};
  });
  req(tiers.length,'리시버에는 한 단 이상 필요합니다.');
  return {series:text(p.series,'리시버 시리즈',80,true),view:text(p.view,'위치 기준',180,true),
    ita:list(p.ita??[],40,'공통 ITA 품번').map(v=>text(v,'ITA 품번',100,true)),
    tiers:unique(tiers,t=>t.id.toLowerCase(),'단 ID')};
}

export function cleanReceiverModule(m) {
  req(m&&typeof m==='object','리시버 모듈 사양을 입력하세요.');
  const contacts=list(m.contacts??[],150,'지원 접점').map(c=>{
    const minAwg=c.minAwg==null?null:count(c.minAwg,1,50,'접점 최소 AWG');
    const maxAwg=c.maxAwg==null?null:count(c.maxAwg,1,50,'접점 최대 AWG');
    req(minAwg==null||maxAwg==null||minAwg<=maxAwg,'접점 AWG 범위가 올바르지 않습니다.');
    return {part:text(c.part,'접점 품번',100,true),minAwg,maxAwg,source:text(c.source,'접점 출처',300)};
  });
  req(receiverTerminations.includes(m.termination),'리시버 후면 종단 방식을 선택하세요.');
  const cavityRows=list(m.cavityRows??[],24,'접점 배치 행').map(r=>list(r,200,'접점 배치 열').map(p=>text(p,'접점 식별자',80,true)));
  unique(cavityRows.flat(),s=>s,'배치도 접점');
  return {cavityRows,cavityView:text(m.cavityView,'접점 표시 방향',180),
    series:text(m.series,'리시버 모듈 시리즈',80,true),width:count(m.width,1,32,'리시버 모듈 폭'),
    termination:m.termination,itaPart:text(m.itaPart,'대응 ITA 모듈 품번',100),contacts:unique(contacts,x=>x.part.toLowerCase(),'접점 품번')};
}

export function modulePositions(profile,mount) {
  const tier=profile.tiers.find(t=>t.id===mount.tier);
  const at=tier?.positions.indexOf(mount.position)??-1;
  return at<0?[]:tier.positions.slice(at,at+mount.definition.receiverModule.width);
}

export function cleanReceiverMounts(profile,input,cleanDefinition) {
  const mounts=list(input??[],400,'리시버 위치 배치').map(x=>{
    const def=cleanDefinition(x.definition);
    req(def.kind==='receiverModule','리시버 장착용 모듈을 선택하세요.');
    const mount={tier:id(x.tier,'단 ID'),position:id(x.position,'위치'),definition:def,
      contactPart:text(x.contactPart,'선택 접점 품번',100),adapterPart:text(x.adapterPart,'어댑터 품번',100),
      adapterStart:x.adapterStart?id(x.adapterStart,'어댑터 시작 위치'):''};
    const tier=profile.tiers.find(t=>t.id===mount.tier);
    req(tier&&tier.positions.includes(mount.position),'리시버에 없는 단 또는 위치입니다.');
    req(tier.families.some(s=>s.toLowerCase()===def.receiverModule.series.toLowerCase()),`${tier.label}이(가) ${def.receiverModule.series} 모듈을 수용하지 않습니다.`);
    const positions=modulePositions(profile,mount);
    req(positions.length===def.receiverModule.width,'리시버 모듈의 연속 장착 공간이 부족합니다.');
    if(tier.mode==='adapter') {
      const allowed=tier.adapters.find(a=>a.part===mount.adapterPart);
      req(allowed,'이 단에는 지정된 리시버 장착 어댑터가 필요합니다.');
      const start=tier.positions.indexOf(mount.adapterStart);
      const used=tier.positions.slice(Math.max(0,start),Math.max(0,start)+allowed.width);
      req(start>=0&&used.length===allowed.width&&positions.every(p=>used.includes(p)),'모듈 배치가 어댑터 범위를 벗어났습니다.');
    }
    const contacts=new Set(def.receiverModule.contacts.map(c=>c.part));
    const pins=new Set(def.connectors[0].pins.map(p=>p.id));
    req(!mount.contactPart||contacts.has(mount.contactPart),'선택한 접점 품번이 모듈의 지원 목록에 없습니다.');
    const contactOverrides=list(x.contactOverrides??[],1000,'핀별 접점').map(row=>{
      const pin=text(row.pin,'접점 핀 번호',80,true),part=text(row.part,'접점 품번',100,true);
      req(pins.has(pin),`${def.part} 모듈에 '${pin}' 접점이 없습니다. 핀 ID를 확인하세요(예: ${def.connectors[0].pins[0]?.id}).`);
      req(contacts.has(part),`핀 ${pin}의 접점 품번 ${part}이(가) 모듈의 지원 목록에 없습니다.`);
      return {pin,part};
    });
    if(contactOverrides.length)mount.contactOverrides=unique(contactOverrides,row=>row.pin,'핀별 접점');
    return mount;
  });
  const slots=new Set(), adapters=new Map();
  for(const m of mounts) {
    for(const p of modulePositions(profile,m)) {
      const key=m.tier+'/'+p;
      req(!slots.has(key),'리시버 위치 중복: '+key);
      slots.add(key);
    }
    const tier=profile.tiers.find(t=>t.id===m.tier);
    if(tier.mode==='adapter') {
      const a=tier.adapters.find(x=>x.part===m.adapterPart);
      const start=tier.positions.indexOf(m.adapterStart),key=m.adapterPart+'/'+m.adapterStart;
      for(const p of tier.positions.slice(start,start+a.width)){
        const coordinate=m.tier+'/'+p;
        req(!adapters.has(coordinate)||adapters.get(coordinate)===key,'리시버 장착 어댑터 범위가 겹칩니다.');
        adapters.set(coordinate,key);
      }
    }
  }
  return mounts;
}

export const receiverPortId = mount => mount.tier+'.'+mount.position;
export function receiverPorts(device) {
  return (device.receiverMounts??[]).map(m=>{
    const profile=m.definition.receiverModule, connector=m.definition.connectors[0];
    const contacts=new Map(profile.contacts.map(c=>[c.part,c]));
    const contact=contacts.get(m.contactPart);
    const overrides=new Map((m.contactOverrides??[]).map(r=>[r.pin,r.part]));
    const pins=connector.pins.map(pin=>{
      const selected=contacts.get(overrides.get(pin.id));
      return selected?{...pin,rearContact:selected}:pin;
    });
    return {...connector,pins,id:receiverPortId(m),name:`${m.definition.part} · ${profile.termination}`,
      part:[m.definition.part,m.definition.revision,m.contactPart,m.adapterPart,m.adapterStart].filter(Boolean).join('/'),
      receiver:{tier:m.tier,position:m.position,model:device.definition.part,module:m.definition.part,itaPart:profile.itaPart,
        termination:profile.termination,contactPart:m.contactPart,minAwg:contact?.minAwg??null,maxAwg:contact?.maxAwg??null}};
  });
}
