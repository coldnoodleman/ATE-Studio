export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false, afterQuote = false;
  for (let i=0; i<text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i+1] === '"') { field += '"'; i++; }
      else { quoted = false; afterQuote = true; }
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; afterQuote = false;
      if (c !== ',') { if (c === '\r' && text[i+1] === '\n') i++; if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c === '"' && !field && !afterQuote) quoted = true;
    else if (!afterQuote && c !== '"') field += c;
    else throw new Error('CSV 따옴표와 필드 구분을 확인하세요.');
  }
  if (quoted) throw new Error('CSV에 닫히지 않은 따옴표가 있습니다.');
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;
export const csvRows = rows => rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
