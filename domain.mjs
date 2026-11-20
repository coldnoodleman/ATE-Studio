import { cleanConnectors, cleanWiring, emptyWiring, editWiring, wiringIssues, bindEndpoint, indexDevices, defaultPlug } from './wiring.mjs';
import { cleanReceiver, cleanReceiverModule, cleanReceiverMounts } from './receiver.mjs';
export const VERSION = '0.5.0';
export const kinds = ['chassis', 'module', 'instrument', 'dut', 'receiver', 'receiverModule'];
export const interfaces = ['PXI', 'PXIe', 'Hybrid', 'LXI/USB', 'Standalone'];
export const roles = ['system', 'peripheral', 'timing', 'reserved'];
export const uid = () => globalThis.crypto.randomUUID();
export const partKey = d => JSON.stringify([d.vendor.toLowerCase(), d.part.toLowerCase(), d.revision.toLowerCase()]);
export const labelOf = item => item.label || item.definition.part;
const fail = message => { throw new Error(message); };
const checked = (cond, message) => { if (!cond) fail(message); };
const issue = (severity, code, message, itemId) => ({ severity, code, message, itemId });

function str(value, name, max, optional = false) {
  checked(typeof value === 'string' && value.length <= max && (optional || value.trim()), `${name} 항목을 확인하세요.`);
  return value.trim();
}

function bounded(value, name, min, max, integer = false) {
  checked(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value)), `${name} 값 범위는 ${min}~${max}입니다.`);
  return value;
}

function choose(value, values, name) {
  checked(values.includes(value), `${name} 값이 지원되지 않습니다.`);
  return value;
}

function imageData(value) {
  if (!value) return '';
  checked(typeof value === 'string' && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1_500_000, '패널 이미지는 1MB 이하 PNG 또는 JPEG만 지원합니다.');
  return value;
}

export function cleanDefinition(input) {
  checked(input && typeof input === 'object' && !Array.isArray(input), '장비 정의가 올바르지 않습니다.');
  const kind = choose(input.kind, kinds, '장비 유형');
  const definition = {
    kind,
    vendor: str(input.vendor, '제조사', 100),
    part: str(input.part, '품번', 100),
    name: str(input.name, '품명', 180),
    revision: str(input.revision ?? '1', '리비전', 40),
    category: str(input.category ?? '', '분류', 95, true),
    source: str(input.source ?? '', '출처', 400, true),
    sourceDate: str(input.sourceDate ?? '', '자료 개정일', 30, true),
    evidence: choose(input.evidence ?? 'unverified', ['verified', 'unverified', 'sample'], '검증 상태'),
    standard: choose(input.standard ?? 'Standalone', interfaces, '인터페이스'),
    procure: input.procure !== false,
    image: imageData(input.image),
  };
  checked(definition.evidence !== 'verified' || definition.source, '검증된 장비는 문서 출처를 입력하세요.');
  if (input.widthMm != null) definition.widthMm = bounded(input.widthMm, '가로 치수', 1, 5000);
  if (input.heightMm != null) definition.heightMm = bounded(input.heightMm, '세로 치수', 1, 5000);
  if (kind === 'chassis') {
    checked(definition.standard !== 'Standalone', '섀시 인터페이스를 선택하세요.');
    checked(Array.isArray(input.slots) && input.slots.length >= 1 && input.slots.length <= 64, '슬롯 맵은 1~64개여야 합니다.');
    const numbers = new Set();
    definition.slots = input.slots.map(s => {
      const number = bounded(s?.number, '슬롯 번호', 0, 999, true);
      checked(!numbers.has(number), `중복 슬롯 번호 ${number}`);
      numbers.add(number);
      checked(Array.isArray(s.accepts) && s.accepts.length <= interfaces.length, '슬롯 허용 인터페이스를 확인하세요.');
      return { number, role: choose(s.role, roles, '슬롯 역할'), accepts: [...new Set(s.accepts.map(v => choose(v, ['PXI', 'PXIe', 'Hybrid'], '슬롯 인터페이스')))], disabled: s.disabled === true };
    });
    if (input.powerLimit != null) definition.powerLimit = bounded(input.powerLimit, '섀시 가용 전력', 0.1, 5000);
    if (input.coolingLimit != null) definition.coolingLimit = bounded(input.coolingLimit, '슬롯 냉각 한도', 0.1, 500);
  }
  if (kind === 'module') {
    checked(['PXI', 'PXIe'].includes(definition.standard), '모듈 인터페이스는 PXI 또는 PXIe여야 합니다.');
    definition.width = bounded(input.width, '점유 슬롯 수', 1, 12, true);
    definition.role = choose(input.role ?? 'peripheral', ['system', 'peripheral', 'timing'], '모듈 역할');
    definition.hybrid = choose(input.hybrid ?? 'unknown', ['yes', 'no', 'unknown'], 'PXI Hybrid 호환');
    if (input.power != null) definition.power = bounded(input.power, '소비전력', 0, 5000);
    if (input.heat != null) definition.heat = bounded(input.heat, '슬롯당 발열', 0, 500);
  }
  if (input.connectors!=null) definition.connectors=cleanConnectors(input.connectors);
  if (kind==='receiver') definition.receiver=cleanReceiver(input.receiver);
  if (kind==='receiverModule') {
    definition.receiverModule=cleanReceiverModule(input.receiverModule);
    checked(definition.connectors?.length===1,'리시버 모듈에는 후면 핀맵 하나를 정의하세요.');
    const cavities=definition.receiverModule.cavityRows.flat();
    if(cavities.length)checked(cavities.length===definition.connectors[0].pins.length&&definition.connectors[0].pins.every(p=>cavities.includes(p.id)),'접점 배치도와 후면 핀 목록이 일치해야 합니다.');
  }
  return definition;
}

export function createProject(name = '새 시험장비 구성') {
  return { schema: 2, wiring:emptyWiring(), id: uid(), name, revision: 'A', notes: '', catalogVersion: '', updatedAt: new Date().toISOString(), chassis: [], instruments: [] };
}

export function cleanProject(input) {
  checked(input && [1,2].includes(input.schema), '이 앱에서 지원하는 ATE 프로젝트 형식이 아닙니다.');
  checked(Array.isArray(input.chassis) && input.chassis.length <= 25, '프로젝트의 섀시 한도는 25대입니다.');
  checked(Array.isArray(input.instruments) && input.instruments.length <= 200, '독립 장비 한도는 200대입니다.');
  const ids = new Set();
  const cleanId = value => {
    const id = str(value, '장비 식별자', 80);
    checked(/^[a-z0-9_-]+$/i.test(id) && !ids.has(id), '장비 식별자가 중복되었거나 올바르지 않습니다.');
    ids.add(id);
    return id;
  };
  const row = (x) => ({
    id: cleanId(x?.id), label: str(x.label ?? '', '장비 별칭', 150, true),
    definition: cleanDefinition(x.definition), procurement: x.procurement !== false,
  });
  const id = cleanId(input.id);
  const project = {
    schema: 2, wiring:cleanWiring(input.wiring), id, name: str(input.name, '프로젝트 이름', 150),
    revision: str(input.revision, '프로젝트 개정', 45), notes: str(input.notes ?? '', '프로젝트 메모', 6000, true),
    catalogVersion:str(input.catalogVersion ?? '', '카탈로그 버전', 100, true),
    updatedAt: str(input.updatedAt, '변경 시각', 45),
    chassis: input.chassis.map(x => {
      const r = row(x);
      checked(r.definition.kind === 'chassis' && Array.isArray(x.placements) && x.placements.length <= 64, '섀시 배치가 올바르지 않습니다.');
      return { ...r, placements: x.placements.map(p => {
        const device = row(p);
        checked(device.definition.kind === 'module', '섀시 내부에는 카드만 둘 수 있습니다.');
        return { ...device, slot: bounded(p.slot, '장착 슬롯', 0, 999, true) };
      }) };
    }),
    instruments: input.instruments.map(x => {
      const r = row(x);
      checked(['instrument','dut','receiver'].includes(r.definition.kind), '독립 장비 유형을 확인하세요.');
      if(r.definition.kind==='receiver')return {...r,receiverMounts:cleanReceiverMounts(r.definition.receiver,x.receiverMounts,cleanDefinition)};
      return r;
    }),
  };
  return project;
}

export function occupied(chassis, definition, start) {
  const slots = chassis.definition.slots;
  const at = slots.findIndex(s => s.number === start);
  return at < 0 ? [] : slots.slice(at, at + definition.width);
}

export function placementIssues(chassis, definition, start, existingId = '', ignoreId = '') {
  const slots = occupied(chassis, definition, start);
  const target = slots[0];
  const problems = [];
  const add = (severity, code, message) => problems.push(issue(severity, code, message, existingId || chassis.id));
  const slotNames = slots.map(s => s.number);
  if (!target || slots.length !== definition.width) {
    add('error', 'range', '시작 위치 또는 연속 장착 공간을 확인하세요.');
    return problems;
  }
  if (slots.some(s => s.disabled || s.role === 'reserved')) add('error','reserved','사용할 수 없는 슬롯을 포함합니다.');
  if (definition.role !== target.role && !(target.role === 'timing' && definition.role === 'peripheral' && target.accepts.includes('PXIe') && definition.standard === 'PXIe')) {
    add('error','role', `${start}번 슬롯 역할과 카드 역할이 맞지 않습니다.`);
  }
  if (definition.role !== 'system' && slots.slice(1).some(s => ['system', 'timing'].includes(s.role))) {
    add('error','reserved-span','점유 범위에 시스템 또는 타이밍 슬롯이 포함됩니다.');
  }
  if (!target.accepts.includes(definition.standard) && !target.accepts.includes('Hybrid')) {
    add('error','interface', `${start}번 슬롯은 ${definition.standard} 카드를 지원하지 않습니다.`);
  } else if (target.accepts.includes('Hybrid') && definition.standard === 'PXI') {
    if (definition.hybrid === 'no') add('error','hybrid','이 PXI 카드는 Hybrid 슬롯을 지원하지 않습니다.');
    if (definition.hybrid === 'unknown') add('warning','hybrid-unknown','PXI 카드의 Hybrid 슬롯 지원 근거를 확인하세요.');
  }
  const overlap = chassis.placements.find(p => p.id !== existingId && p.id !== ignoreId && occupied(chassis, p.definition, p.slot).some(s => slotNames.includes(s.number)));
  if (overlap) add('error','overlap', `${labelOf(overlap)} 카드와 점유 슬롯이 겹칩니다.`);
  if (definition.evidence !== 'verified') add('warning','evidence','카드의 모델별 장착 자료를 확인하세요.');
  return problems;
}

export function projectIssues(project) {
  const output = [];
  for (const chassis of project.chassis) {
    const { definition } = chassis;
    if (definition.evidence !== 'verified') output.push(issue('warning','chassis-evidence', `${labelOf(chassis)} 섀시 슬롯 맵의 출처를 확인하세요.`, chassis.id));
    if (definition.slots.some(s => s.role === 'system' && !s.disabled) && !chassis.placements.some(p => p.definition.role === 'system')) {
      output.push(issue('warning','controller', `${labelOf(chassis)} 시스템 제어기가 배치되지 않았습니다.`, chassis.id));
    }
    for (const placement of chassis.placements) {
      for (const i of placementIssues(chassis, placement.definition, placement.slot, placement.id)) {
        output.push({ ...i, message: `${labelOf(chassis)} / ${placement.slot}번 · ${placement.definition.part} · ${i.message}` });
      }
    }
    if (chassis.placements.length) {
      const powers = chassis.placements.map(p => p.definition.power);
      const total = powers.reduce((a,b) => a + (b ?? 0), 0);
      if (definition.powerLimit != null && total > definition.powerLimit) output.push(issue('warning','power-limit', `${labelOf(chassis)} 확인 소비전력 ${total}W / 가용 ${definition.powerLimit}W`, chassis.id));
      if (powers.some(p => p == null) || definition.powerLimit == null) output.push(issue('info','power-data', `${labelOf(chassis)} 전력 자료 일부가 비어 있습니다.`, chassis.id));
      if (definition.coolingLimit == null || chassis.placements.some(p => p.definition.heat == null)) output.push(issue('info','cooling-data', `${labelOf(chassis)} 냉각 자료 일부가 비어 있습니다.`, chassis.id));
      for (const p of chassis.placements.filter(p => definition.coolingLimit != null && p.definition.heat > definition.coolingLimit)) {
        output.push(issue('warning','cooling-limit', `${labelOf(chassis)} / ${p.slot}번 · 슬롯당 발열 ${p.definition.heat}W / 냉각 한도 ${definition.coolingLimit}W`, p.id));
      }
    }
  }
  for (const x of project.instruments.filter(x => x.definition.evidence !== 'verified')) {
    output.push(issue('warning','device-evidence', `${labelOf(x)} 장비 자료를 확인하세요.`, x.id));
  }
  return [...output,...wiringIssues(project)];
}

export function buildBOM(project) {
  const parts = new Map();
  const push = (item, location) => {
    const { definition } = item;
    const key = JSON.stringify([partKey(definition), item.procurement]);
    const row = parts.get(key) || { vendor: definition.vendor, part: definition.part, name: definition.name, revision: definition.revision,
      category: definition.category || definition.kind, quantity: 0, procurement: item.procurement, locations: [] };
    row.quantity++;
    row.locations.push(location);
    parts.set(key, row);
  };
  for (const c of project.chassis) {
    push(c, labelOf(c));
    for (const p of [...c.placements].sort((a,b) => a.slot-b.slot)) push(p, `${labelOf(c)} / ${occupied(c,p.definition,p.slot).map(s=>s.number).join(', ')}번`);
  }
  for (const x of project.instruments) {
    push(x, labelOf(x));
    for(const m of x.receiverMounts??[])push({definition:m.definition,procurement:m.definition.procure},`${labelOf(x)} / ${m.tier} ${m.position}`);
  }
  return [...parts.values()];
}

function makeItem(definition, label = '', id = uid()) {
  return { id, label, definition: structuredClone(definition), procurement: definition.procure };
}

export function perform(project, operation) {
  const next = structuredClone(project);
  const c = next.chassis.find(x => x.id === operation.chassisId);
  const targetId = operation.id ?? '';
  if (operation.type === 'addChassis') {
    const d = cleanDefinition(operation.definition);
    checked(d.kind === 'chassis', '섀시를 선택하세요.');
    checked(next.chassis.length < 25, '섀시 한도는 25대입니다.');
    const labels=new Set(next.chassis.map(labelOf));
    let index=1;
    const format=i=>`CH-${String(i).padStart(2,'0')}`;
    while(labels.has(format(index))) index++;
    next.chassis.push({ ...makeItem(d, operation.label || format(index), operation.newId), placements: [] });
  } else if (operation.type === 'addInstrument') {
    const d = cleanDefinition(operation.definition);
    checked(['instrument','dut','receiver'].includes(d.kind), '독립 장비를 선택하세요.');
    checked(next.instruments.length < 200, '독립 장비 한도는 200대입니다.');
    next.instruments.push(makeItem(d, operation.label, operation.newId));
  } else if (operation.type === 'place' || operation.type === 'move') {
    checked(c, '대상 섀시를 선택하세요.');
    const from = next.chassis.find(x => x.placements.some(p => p.id === targetId));
    const old = from?.placements.find(x => x.id === targetId);
    const replace = c.placements.find(x => x.id === operation.replaceId);
    checked(operation.type !== 'move' || old, '이동할 카드가 없습니다.');
    const d = old?.definition || cleanDefinition(operation.definition);
    checked(d.kind === 'module', '모듈을 선택하세요.');
    const issues = placementIssues(c, d, operation.slot, old?.id, replace?.id);
    const blocking = issues.find(x => x.severity === 'error');
    checked(!blocking, blocking?.message);
    if (from) from.placements = from.placements.filter(p => p.id !== targetId);
    if (replace) c.placements = c.placements.filter(p => p.id !== replace.id);
    c.placements.push({ ...(old || makeItem(d, operation.label, operation.newId)), slot: operation.slot });
  } else if (operation.type === 'remove') {
    next.chassis = next.chassis.filter(x => x.id !== targetId);
    next.instruments = next.instruments.filter(x => x.id !== targetId);
    for (const ch of next.chassis) ch.placements = ch.placements.filter(x => x.id !== targetId);
  } else if (operation.type === 'itemInfo') {
    const target = [...next.chassis, ...next.chassis.flatMap(x => x.placements), ...next.instruments].find(x => x.id === targetId);
    checked(target, '선택한 장비가 없습니다.');
    target.label = str(operation.label, '장비 별칭', 150, true);
    target.procurement = operation.procurement === true;
  } else if (operation.type === 'order') {
    const at = next.chassis.findIndex(x => x.id === targetId);
    const step = operation.direction === 'up' ? -1 : 1;
    const to = at + step;
    if (at >= 0 && to >= 0 && to < next.chassis.length) [next.chassis[at],next.chassis[to]] = [next.chassis[to],next.chassis[at]];
  } else if (operation.type==='wiring') {
    next.wiring=editWiring(project,operation.action);
    if(operation.action.type==='save'&&operation.action.entity==='revisions')next.revision=operation.action.record.name;
  } else if (operation.type==='receiverMounts' || operation.type==='ports') {
    const item=[...next.chassis,...next.chassis.flatMap(x=>x.placements),...next.instruments].find(x=>x.id===targetId);
    checked(item,'배치된 구성품을 찾을 수 없습니다.');
    if(operation.type==='receiverMounts'){
      checked(item.definition.kind==='receiver','리시버를 선택하세요.');
      item.receiverMounts=cleanReceiverMounts(item.definition.receiver,operation.mounts,cleanDefinition);
    } else {
      checked(item.definition.kind!=='receiver','리시버 포트는 장착 모듈에서 정의하세요.');
      item.definition={...item.definition,connectors:cleanConnectors(operation.connectors)};
    }
  } else if (operation.type === 'projectInfo') {
    next.name = operation.name; next.revision = operation.revision; next.notes = operation.notes;
  } else fail('지원되지 않는 편집 명령입니다.');
  next.updatedAt = new Date().toISOString();
  return cleanProject(next);
}

export function searchCatalog(list, text, kind = '', standard = '', count = '') {
  const terms = text.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return list.filter(d => (!kind || d.kind === kind) && (!standard || d.standard === standard) &&
    (!count || d.slots?.length === Number(count)) &&
    terms.every(t => [d.vendor,d.part,d.name,d.category,d.standard,d.source].some(v => v.toLowerCase().includes(t))));
}

export function sampleProject(catalog) {
  const find = part => catalog.find(x => x.part === part);
  let p = createProject('ATE 스위칭 구성 예제');
  p.catalogVersion = '내장 교육용 예제';
  p.notes = '교육용 배치입니다. 모델별 호환 조건과 검증 상태를 확인하세요.';
  p = perform(p,{ type:'addChassis', definition:find('DEMO-PXIE-08'), label:'CH-01' });
  const chassisId = p.chassis[0].id;
  for (const [part,slot] of [['DEMO-CTRL',1],['DEMO-MUX',2],['DEMO-MUX',3],['DEMO-DMM',5]]) {
    p = perform(p,{ type:'place', definition:find(part), chassisId, slot });
  }
  return perform(p,{ type:'addInstrument', definition:find('DEMO-DUT'), label:'DUT-01' });
}
