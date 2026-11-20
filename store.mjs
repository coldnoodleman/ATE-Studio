import { DatabaseSync } from 'node:sqlite';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanProject, partKey } from './domain.mjs';
import { planCatalogImport, seedCatalog, seedWiringUpdates } from './catalog.mjs';

export const MAX_PROJECT = 28_000_000;

export function store(directory) {
  const db = new DatabaseSync(path.join(directory,'studio.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS catalog (id TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = db.prepare('INSERT INTO catalog VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
  const set = db.prepare('INSERT INTO config VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const get = key => {
    const value = db.prepare('SELECT value FROM config WHERE key=?').get(key)?.value;
    return value === undefined ? undefined : JSON.parse(value);
  };
  const put = (key,value) => set.run(key,JSON.stringify(value));
  const list = () => db.prepare('SELECT value FROM catalog ORDER BY id').all().map(row => JSON.parse(row.value));
  const importCatalog = definitions => {
    const items=planCatalogImport(definitions,list());
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const {definition} of items) insert.run(partKey(definition),JSON.stringify(definition));
      put('catalogVersion',new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return items;
  };
  if (!get('seeded')) {
    importCatalog(seedCatalog);
    put('seeded',true);
  }
  if(!get('receiverSeedV2')) {
    const upgrades=seedWiringUpdates(list());
    if(upgrades.length)importCatalog(upgrades);
    put('receiverSeedV2',true);
  }
  return { list, get, put, importCatalog, close:()=>db.close() };
}

export async function readBounded(filename,max=MAX_PROJECT) {
  const f=await open(filename,'r');
  try {
    const meta=await f.stat();
    if (!meta.isFile() || meta.size>max) throw new Error('파일 형식 또는 크기 한도를 확인하세요.');
    const buffer=Buffer.alloc(meta.size+1);
    let offset=0;
    while(offset<buffer.length) {
      const {bytesRead}=await f.read(buffer,offset,buffer.length-offset,offset);
      if(!bytesRead) break;
      offset+=bytesRead;
    }
    if (offset!==meta.size) throw new Error('읽는 동안 파일이 변경되었습니다.');
    return buffer.subarray(0,offset);
  } finally { await f.close(); }
}

export async function atomicWrite(filename,data) {
  const temp=path.join(path.dirname(filename),`.${path.basename(filename)}.${randomUUID()}.tmp`);
  try {
    const f=await open(temp,'wx',0o600);
    try { await f.writeFile(data); await f.sync(); }
    finally { await f.close(); }
    await rename(temp,filename);
  } finally { await rm(temp,{force:true}).catch(()=>{}); }
}

export async function loadProject(filename) {
  try { return {project:cleanProject(JSON.parse((await readBounded(filename)).toString('utf8'))), recovered:false}; }
  catch (error) {
    try { return {project:cleanProject(JSON.parse((await readBounded(filename+'.bak')).toString('utf8'))), recovered:true}; }
    catch { throw error; }
  }
}

export async function writeProject(filename,project) {
  const data=Buffer.from(JSON.stringify(cleanProject(project),null,2)+'\n','utf8');
  if (data.length>MAX_PROJECT) throw new Error('프로젝트가 28MB 한도를 초과했습니다. 패널 이미지 용량을 줄이세요.');
  let old;
  try {
    const bytes=await readBounded(filename);
    cleanProject(JSON.parse(bytes.toString('utf8')));
    old=bytes;
  } catch (error) {
    if (error.code && error.code!=='ENOENT') throw error;
  }
  if(old) await atomicWrite(filename+'.bak',old);
  await atomicWrite(filename,data);
}

export async function acquire(filename) {
  const lock=filename+'.lock';
  const token=randomUUID();
  try {
    const f=await open(lock,'wx',0o600);
    try { await f.writeFile(JSON.stringify({token,pid:process.pid,createdAt:new Date().toISOString()})); }
    catch (error) { await f.close(); await rm(lock,{force:true}); throw error; }
    await f.close();
    return async ()=>{
      const data=await readFile(lock,'utf8').catch(()=>null);
      if (data && JSON.parse(data).token===token) await rm(lock,{force:true});
    };
  } catch (error) {
    if (['EEXIST','EACCES','EROFS','EPERM'].includes(error.code)) return null;
    throw error;
  }
}
