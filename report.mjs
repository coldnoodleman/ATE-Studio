import { wiringReport } from './wiring-report.mjs';
import { exportDrawingSvg } from './drawing.mjs';
import { buildBOM, occupied, projectIssues, labelOf } from './domain.mjs';
import { zipSync, strToU8 } from 'fflate';

export const escapeText = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const x = escapeText;
const escXml = value => x(String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,''));
const procurement = v => v?'조달':'기보유/제외';

export function exportRecords(project) {
  const items = projectIssues(project);
  return {
    issues:items,
    bom:buildBOM(project),
    layout:project.chassis.flatMap(c=>[
      [labelOf(c),c.definition.vendor,c.definition.part,c.definition.revision,'','섀시',procurement(c.procurement)],
      ...[...c.placements].sort((a,b)=>a.slot-b.slot).map(p=>[
        labelOf(c),p.definition.vendor,p.definition.part,p.definition.revision,
        occupied(c,p.definition,p.slot).map(s=>s.number).join(', '),labelOf(p),procurement(p.procurement)
      ]),
    ]).concat(project.instruments.map(d=>['독립 장비',d.definition.vendor,d.definition.part,d.definition.revision,'',labelOf(d),procurement(d.procurement)])),
  };
}

function sheet(rows, widths) {
  const c=(value,row,col)=>{
    const ref=String.fromCharCode(65+col)+String(row+1);
    const style=row===0?' s="1"':'';
    return typeof value==='number' ? `<c r="${ref}"${style}><v>${value}</v></c>` :
      `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escXml(String(value??'').slice(0,32000))}</t></is></c>`;
  };
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.map((r,i)=>`<row r="${i+1}">${r.map((v,j)=>c(v,i,j)).join('')}</row>`).join('')}</sheetData></worksheet>`;
}

export function makeXlsx(project, status, catalogVersion) {
  const {bom,layout,issues}=exportRecords(project);
  const sheets = [
    ['부품명세서', [['제조사','품번','품명','리비전','분류','수량','조달 구분','설치 위치'],...bom.map(r=>[r.vendor,r.part,r.name,r.revision,r.category,r.quantity,procurement(r.procurement),r.locations.join(' · ')])],[23,24,38,12,20,10,17,52]],
    ['슬롯 배치', [['섀시','제조사','품번','리비전','점유 슬롯','장비','조달 구분'],...layout],[19,23,24,12,17,32,17]],
    ['프로젝트 검토', [['항목','값'],['프로젝트',project.name],['프로젝트 개정',project.revision],['카탈로그',catalogVersion],['출력 상태',status],...issues.map(i=>[i.severity==='error'?'오류':i.severity==='warning'?'확인 필요':'참고',i.message])],[21,96]],
  ];
  const wiring=wiringReport(project);
  if(wiring.cables.length){
    sheets.push(
      ['케이블 목록', [['케이블','표기','서브시스템','하네스','A측 구성품','A측 종단','B측 구성품','B측 리시버 위치·모듈·접점','B측 종단','형태','원재료','길이 mm','길이 기준','AWG','실드','슬리브','도체','상태','비고'],
        ...wiring.cables.map(c=>[c.code,c.name,c.groupName,c.bundle,c.aName.display,c.terminationA,c.bName.display,c.bName.receiver,c.terminationB,c.typeName,c.cablePart,c.lengthMm,c.measurementName,c.awg,c.shield,c.sleeve,c.rows.length,c.status,c.note])],
        [15,35,22,14,28,31,28,53,31,15,20,13,16,10,16,16,10,15,36]],
      ['도체 핀맵', [['케이블','도체','논리 신호','A측','A 핀','A 핀 이름','B측','B 핀','B 핀 이름','B측 리시버 위치·모듈·접점','색상','AWG','페어','비고','상태','A 후면 접점','B 후면 접점'],
        ...wiring.cables.flatMap(c=>c.rows.map(w=>[c.code,w.label,w.netName,c.aName.display,w.a,w.aLabel,c.bName.display,w.b,w.bLabel,c.bName.receiver,w.color,w.gauge,w.pair,w.note,c.status,w.aContact,w.bContact]))],
        [15,20,20,26,12,21,26,12,21,53,14,10,15,30,15,20,20]],
      ['케이블 자재', [['종류','품번','수량','단위'],...wiring.materials],[23,23,12,10]],
    );
  }
  if(wiring.signalRows.length)sheets.push(['신호 접점',[['서브시스템','신호','구성품·커넥터','배치 위치','장비 품번','핀','핀 이름','리시버 위치·모듈·접점','재검토','비고'],...wiring.signalRows],[20,20,30,22,20,12,20,53,30,35]]);
  if(wiring.placements.length)sheets.push(['리시버 배치',[['리시버','프레임 품번','시리즈','단','위치','모듈','모듈 시리즈','핀 수','후면 종단','접점','대응 ITA 모듈','어댑터','어댑터 시작','출처'],...wiring.placements],[20,18,12,8,9,18,22,10,16,18,19,18,14,47]]);
  if(wiring.revisions.length)sheets.push(['리비전 기록',[['리비전','시각','변경 설명','신호','케이블'],...wiring.revisions.map(r=>[r.name,r.at,r.note,r.netCount,r.cableCount])],[14,27,60,10,10]]);
  const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const files = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel.slice(0,-1)}"><sheets>${sheets.map(([name],i)=>`<sheet name="${escXml(name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${rel}worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="${rel}styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D334A"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
  };
  for (const [i,[,rows,widths]] of sheets.entries()) files[`xl/worksheets/sheet${i+1}.xml`]=sheet(rows,widths);
  return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])),{level:6});
}

const badge = s=>s.role==='system'?'SYS':s.role==='timing'?'TIM':s.disabled?'—':s.accepts.join('/');
function chassisBlock(c) {
  const slots=c.definition.slots;
  const cells = slots.map(s=>{
    const p=c.placements.find(m=>occupied(c,m.definition,m.slot).some(t=>t.number===s.number));
    const occupiedSuffix = p ? ' loaded' : '';
    const part = p ? (p.slot===s.number ? p.definition.part : '↳') : '—';
    return `<div class="slot${occupiedSuffix}"><b>${s.number}</b><small>${x(badge(s))}</small><div>${x(part)}</div></div>`;
  }).join('');
  return `<article><h2>${x(labelOf(c))} <em>${x(c.definition.vendor)} · ${x(c.definition.part)} · Rev. ${x(c.definition.revision)}</em></h2><div class="slots">${cells}</div>
  <table><thead><tr><th>슬롯</th><th>품번</th><th>장비</th><th>개정</th><th>조달</th></tr></thead><tbody>${[...c.placements].sort((a,b)=>a.slot-b.slot).map(p=>`<tr><td>${occupied(c,p.definition,p.slot).map(s=>s.number).join(', ')}</td><td>${x(p.definition.part)}</td><td>${x(labelOf(p))} · ${x(p.definition.name)}</td><td>${x(p.definition.revision)}</td><td>${procurement(p.procurement)}</td></tr>`).join('')}</tbody></table></article>`;
}

function wiringBlock(project,mode) {
  const {cables,signalRows,placements}=wiringReport(project);
  const cableLimit=mode==='png'?8:500, rowLimit=mode==='png'?12:1024;
  const table=(head,rows)=>`<table><thead><tr>${head.map(t=>`<th>${x(t)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${x(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `${placements.length?`<article><h2>리시버 모듈 배치</h2>${table(['리시버 / 품번','위치','모듈 · 접점','후면 종단','대응 ITA'],placements.slice(0,mode==='png'?12:500).map(r=>[r[0]+' · '+r[1],r[3]+'.'+r[4],r[5]+' / '+(r[9]||'미확인'),r[8],r[10]]))}</article>`:''}
  ${cables.slice(0,cableLimit).map(c=>`<article class="cable-report"><h2>${x(c.code)} · ${x(c.name)} <em>${x(c.status)}</em></h2>
  <div class="cable-ends"><span><b>A</b> · ${x(c.aName.display)} · ${x(c.terminationA)}${c.aName.reason?' · '+x(c.aName.reason):''}</span>
  <span><b>B</b> · ${x(c.bName.display)} · ${x(c.bName.receiver||c.terminationB)}${c.bName.reason?' · '+x(c.bName.reason):''}</span></div>
  <p>${x(c.typeName)} · ${x(c.lengthMm??'길이 미정')}${c.lengthMm!=null?' mm':''} · ${x(c.measurementName)} · ${x(c.bundle)} ${x(c.shield)} ${x(c.sleeve)}</p>
  ${table(['A 핀','도체 / 신호','B 핀','색상 · AWG','페어'],c.rows.slice(0,rowLimit).map(w=>[[w.a,w.aLabel].filter(Boolean).join(' · '),w.label||w.netName,[w.b,w.bLabel,w.bContact].filter(Boolean).join(' · '),[w.color,w.gauge].filter(Boolean).join(' · '),w.pair]))}
  ${c.rows.length>rowLimit?'<small>전체 도체는 XLSX에서 확인하세요.</small>':''}
  ${c.note?`<p class="notes">${x(c.note)}</p>`:''}</article>`).join('')}
  ${cables.length>cableLimit?'<small>전체 케이블은 XLSX에서 확인하세요.</small>':''}
  ${mode==='pdf'&&signalRows.length?`<article><h2>논리 신호 접점</h2>${table(['신호','장비 · 커넥터','품번 / 핀','리시버','재검토'],signalRows.map(r=>[r[1],r[2],r[4]+' / '+r[5],r[7],r[8]]))}</article>`:''}`;
}

export function makeReport(project,status,catalogVersion,mode='pdf') {
  const {issues}=exportRecords(project);
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>ATE Studio 배치도</title><style>
  @font-face{font-family:Studio;src:url('/fonts/NotoSansCJKkr-Regular.woff2') format('woff2');font-display:block}
  *{box-sizing:border-box}body{font:14px Studio,sans-serif;color:#182a38;background:white;margin:0;padding:32px}h1{font-size:27px;margin:8px 0}h2{font-size:17px;margin:0 0 10px}p{margin:6px 0}small{font-size:10px}em{font-style:normal;font-size:12px;color:#465c6c}header{border-bottom:2px solid #1d3949;padding-bottom:14px;margin-bottom:18px}strong{color:#087468}article{margin:0 0 22px}.slots{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px;margin:0 0 8px;break-inside:avoid}.slot{background:#eef3f5;border:1px solid #cad7df;padding:6px;min-width:0;min-height:62px;overflow-wrap:anywhere}.slot small{margin-left:5px;color:#435560}.slot div{font-size:10px;margin-top:7px}.loaded{background:#d9f1eb;border-color:#76aa9f}table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed}th,td{padding:6px 7px;border:1px solid #dbe3e8;text-align:left;overflow-wrap:anywhere}th{background:#edf2f4}tr{break-inside:avoid}th:nth-child(3){width:43%}.cable-ends{display:grid;grid-template-columns:1fr 1fr;gap:7px}.cable-ends span{padding:7px;background:#edf5f4;overflow-wrap:anywhere}.notes{white-space:pre-wrap;overflow-wrap:anywhere}.issues{columns:1}li{margin-bottom:4px}h2{break-after:avoid}header{break-inside:avoid}@page{size:A4;margin:15mm}@media print{body{padding:0}} ${mode==='png'?'body{width:1120px}':''}
  .route-figure{break-inside:avoid}.route-figure svg{display:block;max-width:100%;max-height:150mm;width:auto;height:auto}
  </style></head><body><header><strong>ATE STUDIO · 구성 배치도</strong><h1>${x(project.name)}</h1><p>프로젝트 개정 ${x(project.revision)} · ${x(status)} · 섀시 ${project.chassis.length}대</p><p>카탈로그 ${x(catalogVersion)}</p></header>
  ${project.chassis.map(chassisBlock).join('') || '<p>등록된 섀시가 없습니다.</p>'}
  ${project.instruments.length?`<article><h2>독립 장비 / DUT</h2><ul>${project.instruments.map(d=>`<li>${x(labelOf(d))} · ${x(d.definition.vendor)} · ${x(d.definition.part)} · ${procurement(d.procurement)}</li>`).join('')}</ul></article>`:''}
  ${mode==='pdf'&&project.wiring?.cables?.length?`<article class="route-figure"><h2>케이블 경로 도면</h2>${exportDrawingSvg(project,'harness')}</article>`:''}
  ${wiringBlock(project,mode)}
  ${project.notes?`<article><h2>프로젝트 메모</h2><p class="notes">${x(project.notes)}</p></article>`:''}
  ${issues.length?`<article><h2>검토 항목</h2><ul class="issues">${issues.slice(0,mode==='png'?150:5000).map(i=>`<li>${i.severity==='error'?'오류':i.severity==='warning'?'확인':'참고'} · ${x(i.message)}</li>`).join('')}${mode==='png'&&issues.length>150?`<li>전체 항목은 PDF 또는 XLSX에서 확인하세요.</li>`:''}</ul></article>`:''}</body></html>`;
}
