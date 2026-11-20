import { pickeringWiringCatalog } from './pickering-catalog.mjs';
import { receiverCatalog } from './receiver-catalog.mjs';
import { cleanDefinition, partKey } from './domain.mjs';
import { parseCsv, csvCell } from './csv.mjs';

const series = 'https://www.pickeringtest.com/portal/web/256/content/downloads/datasheets/60-104D.pdf';
const gen3 = 'https://info.pickeringtest.com/pickering-gen-3-pxi-express-pxie-chassis';
const slot = (number, role, accepts) => ({ number, role, accepts });
const slots = (size, peripheral, system) => Array.from({length:size}, (_,i) =>
  i === 0 && system ? slot(1,'system',system) : slot(i+1,'peripheral',peripheral));
const demo = { vendor:'ATE Studio 예제', revision:'1', source:'교육용 가상 품목', evidence:'sample' };
const chassis = [
  { kind:'chassis', vendor:'Pickering Interfaces', part:'42-924-001', name:'8슬롯 PXIe Full Hybrid 섀시', revision:'1', standard:'Hybrid',
    category:'섀시', evidence:'verified', source:gen3, slots:slots(8,['Hybrid'],['PXIe']) },
  { kind:'chassis', vendor:'Pickering Interfaces', part:'40-924-001', name:'8슬롯 PXI 섀시', revision:'1', standard:'PXI',
    category:'섀시', evidence:'unverified', source:series, slots:slots(8,['PXI'],['PXI']) },
  { kind:'chassis', vendor:'Pickering Interfaces', part:'60-104-001', name:'2슬롯 LXI/USB 섀시', revision:'1', standard:'LXI/USB',
    category:'섀시', evidence:'unverified', source:series, slots:slots(2,['PXI']) },
  { ...demo, kind:'chassis', part:'DEMO-PXIE-08', name:'8슬롯 하이브리드 실습 섀시', standard:'Hybrid',
    category:'섀시', slots:slots(8,['Hybrid'],['PXIe']), powerLimit:220, coolingLimit:30 },
];
const modules = [
  ['DEMO-CTRL','임베디드 제어기','제어기','PXIe',1,30,'system'],
  ['DEMO-MUX','16채널 2선 멀티플렉서','멀티플렉서','PXIe',1,9],
  ['DEMO-DMM','6½ 디지트 디지털 멀티미터 카드','계측','PXIe',1,14],
  ['DEMO-MATRIX','16 × 16 스위칭 매트릭스','매트릭스','PXIe',2,22],
  ['DEMO-RELAY','SPDT 릴레이 카드','릴레이','PXI',1,7,'peripheral','yes'],
  ['DEMO-PXI-OLD','레거시 PXI 릴레이 카드','릴레이','PXI',1,7,'peripheral','no'],
  ['DEMO-DIO','32채널 디지털 입출력 모듈','디지털 I/O','PXIe',1,8],
  ['DEMO-AIO','아날로그 입출력 모듈','아날로그 I/O','PXIe',1,11],
  ['DEMO-SCOPE','2채널 디지타이저','계측','PXIe',2,19],
  ['DEMO-PSU','프로그래머블 DC 전원 카드','전원','PXIe',2,29],
  ['DEMO-RSIM','프로그래머블 저항 모듈','시뮬레이션','PXI',1,6,'peripheral','yes'],
  ['DEMO-FI','고장 삽입 카드','시뮬레이션','PXIe',1,12],
  ['DEMO-RF','RF 릴레이 모듈','RF 스위칭','PXIe',1,9],
  ['DEMO-BUS','통신 버스 인터페이스','통신','PXIe',1,8],
  ['DEMO-TIMING','타이밍 및 동기화 카드','동기화','PXIe',1,9,'timing'],
].map(([part,name,category,standard,width,power,role='peripheral',hybrid='unknown']) =>
  ({ ...demo, kind:'module', part,name,category,standard,width,power,heat:power/width,role,hybrid }));
modules.push({ kind:'module', vendor:'Pickering Interfaces', part:'43-752A-911', name:'6채널 배터리 시뮬레이터 (TSA 표시 기준)',
  revision:'1', category:'시뮬레이션', standard:'PXIe', width:1, role:'peripheral', evidence:'unverified',
  source:'https://tsa.pickeringtest.com/drawing/main/modchassis/1/0' });
const instruments = [
  { ...demo, kind:'instrument', part:'DEMO-EXT-DMM', name:'벤치 디지털 멀티미터', category:'계측' },
  { ...demo, kind:'instrument', part:'DEMO-EXT-PSU', name:'프로그래머블 외부 전원', category:'전원' },
  { ...demo, kind:'dut', part:'DEMO-DUT', name:'시험 대상 장치 예시', category:'DUT', procure:false },
];
const trainingPort=(family,signals)=>({
  id:'J1',name:'예제 배선 포트',family,gender:'female',source:'교육용 가상 핀맵 · 실제 장비 금지',
  pins:signals.map((label,i)=>({id:String(i+1),label,kind:'passive'})),
});
const trainingPorts={
  'DEMO-MUX':trainingPort('D-Sub 9',['CH0+','CH0-','CH1+','CH1-','CH2+','CH2-','CH3+','CH3-','SHIELD']),
  'DEMO-DMM':trainingPort('D-Sub 9',['HI','LO','SENSE HI','SENSE LO','GUARD','NC6','NC7','NC8','SHIELD']),
  'DEMO-DIO':trainingPort('D-Sub 9',['D0','D1','D2','D3','D4','D5','D6','D7','GND']),
  'DEMO-DUT':trainingPort('D-Sub 9',['IN0','IN1','IN2','IN3','IN4','IN5','IN6','IN7','GND']),
};
export const seedCatalog = [...chassis,...modules,...instruments,...receiverCatalog,...pickeringWiringCatalog].map(row=>
  cleanDefinition(trainingPorts[row.part]?{...row,connectors:[trainingPorts[row.part]]}:row));
export const seedWiringUpdates = items => {
  const indexed=new Map(items.map(d=>[partKey(d),d]));
  return seedCatalog.filter(d=>{
    const saved=indexed.get(partKey(d));
    if(!saved)return d.kind==='receiver'||d.kind==='receiverModule'||(d.vendor==='Pickering Interfaces'&&d.connectors?.length>0);
    if(!d.connectors?.length||saved.connectors?.length||saved.evidence!=='sample')return false;
    const {connectors,...baseline}=d;
    return JSON.stringify(baseline)===JSON.stringify(saved);
  });
};

const fields = ['kind','vendor','part','name','revision','category','standard','evidence','source','sourceDate','width','role','hybrid','slots','power','heat','powerLimit','coolingLimit','procure','widthMm','heightMm','connectors','receiver','receiverModule'];
const num = new Set(['width','power','heat','powerLimit','coolingLimit','widthMm','heightMm']);

export function loadCatalogCsv(raw) {
  const [headers,...rows] = parseCsv(raw.replace(/^\uFEFF/,''));
  if (!headers || !rows.length || new Set(headers).size !== headers.length || headers.some(h=>!fields.includes(h))) throw new Error('장비 CSV 열 또는 데이터가 올바르지 않습니다. 앱의 CSV 양식을 사용하세요.');
  if (rows.length > 2500) throw new Error('한 번에 최대 2,500품목을 반입할 수 있습니다.');
  return rows.map((row,i) => {
    try {
      if (row.length !== headers.length) throw new Error('열 개수가 일치하지 않습니다.');
      const values = {};
      for (const [j,key] of headers.entries()) {
        const value = row[j];
        if (!value) continue;
        if (num.has(key)) values[key] = Number(value);
        else if (['slots','connectors','receiver','receiverModule'].includes(key)) values[key] = JSON.parse(value);
        else if (key === 'procure') {
          if (!['true','false'].includes(value)) throw new Error('조달 여부는 true 또는 false입니다.');
          values[key] = value === 'true';
        } else values[key] = value;
      }
      return cleanDefinition(values);
    } catch (error) { throw new Error(`CSV ${i+2}행 · ${error.message}`); }
  });
}

export const catalogCsvTemplate = () => '\uFEFF' + fields.join(',') + '\r\n' +
  [seedCatalog[3],seedCatalog[4]].map(row => fields.map(key => csvCell(['slots','connectors','receiver','receiverModule'].includes(key) && row[key] ? JSON.stringify(row[key]) : row[key] ?? '')).join(',')).join('\r\n');

export function planCatalogImport(incoming, existing) {
  if (!Array.isArray(incoming) || incoming.length > 2500 || !incoming.length) throw new Error('반입할 장비가 없거나 한도를 넘었습니다.');
  const old = new Map(existing.map(d=>[partKey(d),d]));
  const seen = new Set();
  const items = incoming.map(cleanDefinition).map(definition => {
    const key = partKey(definition);
    if (seen.has(key)) throw new Error(`장비가 중복됩니다 · ${definition.vendor} ${definition.part} ${definition.revision}`);
    seen.add(key);
    return { definition, mode:old.has(key) ? 'update' : 'add' };
  });
  return items;
}
