const {contextBridge,ipcRenderer}=require('electron');
const call = async (name, data) => {
  const result=await ipcRenderer.invoke(name,data);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
contextBridge.exposeInMainWorld('studio',{
  boot:()=>call('boot'),
  workspaceIndex:()=>call('workspace:index'),
  workspaceEdit:operation=>call('workspace:edit',operation),
  workspaceOpen:(designId,revisionId)=>call('workspace:open',{designId,revisionId}),
  workspaceTransfer:(direction,folderId)=>call('workspace:transfer',{direction,folderId}),
  workspaceAttachment:(direction,folderId,attachmentId,note)=>call('workspace:attachment',{direction,folderId,attachmentId,note}),
  workspaceRfq:designId=>call('workspace:rfq',{designId}),
  exportDrawing:(project,mode)=>call('drawing:export',{project,mode}),
  newProject:sample=>call('project:new',{sample}),
  openProject:()=>call('project:open'),
  save:(project,as)=>call('project:save',{project,as}),
  changed:project=>call('project:changed',{project}),
  discardRecovery:()=>call('project:discardRecovery'),
  export:(project,format,formal)=>call('project:export',{project,format,formal}),
  saveCatalog:definition=>call('catalog:single',{definition}),
  importCatalog:()=>call('catalog:import'),
  commitCatalog:token=>call('catalog:commit',{token}),
  exportCatalog:format=>call('catalog:export',{format}),
  saveLLM:settings=>call('llm:settings',settings),
  models:()=>call('llm:models'),
  testLLM:()=>call('llm:test'),
  ask:(project,question,mode)=>call('llm:ask',{project,question,mode}),
  apply:(project,token)=>call('llm:apply',{project,token}),
  readPinCsv:()=>call('wiring:readCsv'),
  exportPinCsv:(project,cableId,format)=>call('wiring:exportCsv',{project,cableId,format}),
});
