const manual='https://www.pickeringtest.com/portal/web/256/content/downloads/manuals/40-42-153M.pdf';
const pinNames=[
  ...Array.from({length:9},(_,i)=>['A'+(10+i),'C'+(10+i)]).flat(),
  'GND',
  ...Array.from({length:9},(_,i)=>['A'+(1+i),'C'+(1+i)]).flat(),
];
export const pickeringWiringCatalog=['PXI','PXIe'].map(standard=>({
  kind:'module',vendor:'Pickering Interfaces',part:standard==='PXI'?'40-153-104':'42-153-104',
  name:`${standard} 18 × SPST 전력 릴레이 · D-Sub 37`,revision:'1',category:'릴레이',standard,
  width:1,role:'peripheral',hybrid:'unknown',source:manual,evidence:'verified',
  connectors:[{id:'J1',name:'전면 신호 커넥터',family:'D-Sub 37',gender:'male',
    source:manual+' (Figure 5.6, 장비 전면 기준)',
    pins:pinNames.map((label,i)=>({id:String(i+1),label,kind:label==='GND'?'ground':'passive'}))}],
}));
