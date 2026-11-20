import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { getCACertificates } from 'node:tls';
import { cleanProject, labelOf, perform, projectIssues } from './domain.mjs';
import { createHash } from 'node:crypto';

export const defaultLLM = { enabled:false, baseUrl:'', model:'', proactive:false, routed:false };

export function endpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('LLM 주소에 http:// 또는 https://를 포함하세요.'); }
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('LLM 주소의 프로토콜과 경로를 확인하세요.');
  const path = url.pathname.replace(/\/+$/,'').replace(/\/(chat\/completions|models)$/,'');
  url.pathname = path || '/v1';
  return url;
}

export function cleanLLM(input) {
  const enabled = input.enabled === true;
  const baseUrl = String(input.baseUrl ?? '').trim();
  const model = String(input.model ?? '').trim();
  if (baseUrl.length > 600 || model.length > 200 || /[\r\n]/.test(model)) throw new Error('LLM 주소 또는 모델명이 너무 길거나 올바르지 않습니다.');
  return { enabled, baseUrl: (baseUrl || enabled) ? endpoint(baseUrl).href.replace(/\/$/,'') : '', model, proactive:input.proactive === true, routed:input.routed === true };
}

export function addressClass(address) {
  const ip = address.toLowerCase();
  const v = isIP(ip);
  if (v === 4) {
    const [a,b] = ip.split('.').map(Number);
    if (a===0 || a>=224 || (a===169 && b===254) || ip==='100.100.100.200') return 'blocked';
    return a===10 || a===127 || (a===172 && b>=16 && b<=31) || (a===192 && b===168) ? 'private' : 'routed';
  }
  if (v === 6) {
    if (ip === '::1') return 'private';
    if (/^f[cd]/.test(ip)) return 'private';
    if (/^[23][0-9a-f]{3}:/.test(ip)) return 'routed';
  }
  return 'blocked';
}

export async function llmRequest(config, secret, resource, payload) {
  const base = endpoint(config.baseUrl);
  base.pathname = base.pathname + '/' + resource;
  const hostname = base.hostname.replace(/^\[|\]$/g,'');
  const records = isIP(hostname) ? [{address:hostname,family:isIP(hostname)}] : await lookup(hostname,{all:true});
  if (!records.length || records.some(r=>addressClass(r.address)==='blocked' || (!config.routed && addressClass(r.address)!=='private'))) throw new Error('폐쇄망 주소인지 확인하세요. 라우팅된 사내 IP는 설정에서 별도 허용해야 합니다.');
  const pin = records[0];
  const encrypted = base.protocol === 'https:';
  const driver = encrypted ? https : http;
  return new Promise((resolve,reject) => {
    const body = payload == null ? null : JSON.stringify(payload);
    const headers = { Accept:'application/json' };
    if (body) { headers['Content-Type']='application/json'; headers['Content-Length']=Buffer.byteLength(body); }
    if (secret) headers.Authorization='Bearer '+secret;
    const req = driver.request(base,{
      method:body?'POST':'GET', headers, agent:false, family:pin.family,
      ...(encrypted ? {ca:[...getCACertificates('default'),...getCACertificates('system')]} : {}),
      lookup:(_hostname,options,cb)=>options.all?cb(null,[pin]):cb(null,pin.address,pin.family),
    },res=>{
      if (res.statusCode<200 || res.statusCode>299) {
        res.destroy();
        reject(new Error(`LLM API HTTP ${res.statusCode} · 주소·키·모델 설정을 확인하세요.`));
        return;
      }
      const chunks=[]; let bytes=0;
      res.on('data',chunk=>{
        bytes += chunk.length;
        if (bytes>2_000_000) req.destroy(new Error('LLM 응답 크기 한도를 초과했습니다.'));
        else chunks.push(chunk);
      });
      res.on('end',()=>{
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('LLM 응답의 JSON 형식이 올바르지 않습니다.')); }
      });
      res.on('error',reject);
    });
    const deadline = setTimeout(()=>req.destroy(new Error('LLM 응답 제한 시간 120초를 초과했습니다.')),120000);
    req.on('error',reject);
    req.on('close',()=>clearTimeout(deadline));
    req.end(body ?? undefined);
  });
}

export const fingerprint = project => createHash('sha256').update(JSON.stringify(cleanProject(project))).digest('hex');

export function makeContext(project, catalog, question, mode, options = {}) {
  const terms = String(question).toLowerCase().split(/[^a-z0-9가-힣-]+/).filter(t=>t.length>=2);
  const rank = d => terms.reduce((a,t)=>a + ([d.name,d.part,d.category,d.vendor].join(' ').toLowerCase().includes(t)?1:0),0);
  const pinned = options.catalogParts ?? [];
  const ordered = [...catalog].sort((a,b)=>Number(pinned.includes(b.part))-Number(pinned.includes(a.part)) || rank(b)-rank(a));
  const slice = [...ordered.filter(x=>x.kind==='chassis').slice(0,10), ...ordered.filter(x=>x.kind!=='chassis').slice(0,90)];
  const catalogContext = slice.map((x,i)=>({
    ref:`P${i+1}`, part:x.part, name:x.name, vendor:x.vendor, revision:x.revision, kind:x.kind, standard:x.standard,
    evidence:x.evidence, category:x.category, width:x.width, role:x.role, hybrid:x.hybrid,
    slots:x.slots?.map(s=>[s.number,s.role,s.accepts,s.disabled]), source:x.source,
  }));
  const layout = project.chassis.map(c=>({
    id:c.id, name:labelOf(c), part:c.definition.part,
    slots:c.definition.slots.map(s=>[s.number,s.role,s.accepts,s.disabled]),
    placements:c.placements.map(p=>({id:p.id, part:p.definition.part, slot:p.slot, width:p.definition.width})),
  }));
  const context = { mode, question, layout, catalog:catalogContext,
    instruments:project.instruments.map(x=>({part:x.definition.part,label:labelOf(x)})),
    issues:projectIssues(project).filter(x=>x.severity!=='info').slice(0,100),
  };
  return { context, refs:new Map(catalogContext.map((c,i)=>[c.ref,slice[i]])) };
}

export function interpretReply(content, project, refs) {
  const raw = String(content).trim();
  let payload;
  try {
    const fenced=raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    payload=JSON.parse(fenced?.[1] ?? raw);
  } catch { return { answer:raw.slice(0,14000), suggestions:[], operations:[] }; }
  if (!payload || typeof payload !== 'object') throw new Error('LLM 결과 형식을 확인하세요.');
  const answer=typeof payload.answer==='string'?payload.answer.slice(0,14000):'';
  if (!answer && !Array.isArray(payload.proposals)) return {answer:raw.slice(0,14000),suggestions:[],operations:[]};
  const suggestions=[], operations=[], tempIds=new Map();
  let draft=project;
  for (const p of (Array.isArray(payload.proposals)?payload.proposals:[]).slice(0,28)) {
    const def=refs.get(p?.ref);
    const reason=String(p?.reason ?? '').slice(0,400);
    const action=p?.action;
    const row={ label:def?.part || '미등록 장비', target:String(p?.target ?? '').slice(0,80), slot:p?.slot, reason, status:'rejected', message:'' };
    try {
      if (!def) throw new Error('응답이 현재 카탈로그의 장비를 참조하지 않습니다.');
      let operation;
      if (action === 'chassis' && def.kind === 'chassis') {
        if (typeof p.alias!=='string' || !/^new-[a-z0-9-]{1,32}$/i.test(p.alias) || tempIds.has(p.alias)) throw new Error('새 섀시의 참조 이름이 올바르지 않습니다.');
        operation={type:'addChassis',definition:def,newId:globalThis.crypto.randomUUID()};
      } else if (action === 'place' && def.kind === 'module') {
        operation={type:'place', definition:def,chassisId:tempIds.get(p.target) ?? p.target,slot:p.slot,newId:globalThis.crypto.randomUUID()};
        if (!Number.isInteger(p.slot)) throw new Error('배치 슬롯 정보를 확인하세요.');
        const c=draft.chassis.find(x=>x.id===operation.chassisId);
        row.target=c ? labelOf(c) : row.target;
      } else if (action === 'instrument' && (def.kind === 'instrument' || def.kind === 'dut')) {
        operation={type:'addInstrument',definition:def,newId:globalThis.crypto.randomUUID()};
      } else if (action === 'recommend') {
        row.status='reference'; row.message='카탈로그 후보';
      } else throw new Error('지원되지 않는 제안입니다.');
      if (operation) {
        draft=perform(draft,operation);
        if (action==='chassis') tempIds.set(p.alias,operation.newId);
        row.status='ready'; row.message=def.evidence==='verified'?'배치 검사를 통과했습니다.':'임시 배치 · 장비 근거 확인 필요';
        operations.push(operation);
      }
    } catch(error) { row.message=error.message; }
    suggestions.push(row);
  }
  return { answer,suggestions,operations, draft };
}
