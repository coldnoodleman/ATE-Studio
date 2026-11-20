const catalogUrl=part=>`https://www.vpc.com/catalog/${part}/`;
const drawUrl=part=>`https://www.vpc.com/resources/files/${part}-pdf/`;
const positions=(start,end)=>Array.from({length:end-start+1},(_,i)=>String(start+i));
const discrete=(id,label,start,end,ita=[])=>({id,label,mode:'discrete',positions:positions(start,end),families:['VPC 90 Series'],ita});
const upper=()=>discrete('A','상단 A',1,25,['410104111','410104505']);
const lower=()=>discrete('B','하단 B',1,25,['410104111','410104505']);
const frame=(part,series,name,tiers,ita,view)=>({kind:'receiver',vendor:'Virginia Panel Corporation',part,name,revision:'1',category:'매스 인터커넥트',standard:'Standalone',
  evidence:'verified',source:catalogUrl(part),receiver:{series,view,ita,tiers}});
export const receiverCatalog=[
  frame('310104368','9050','VPC 9050 50위치 · 2단', [upper(),lower()],['410104538'],'제조사 전면 도면 기준 · A/B 각 1~25'),
  frame('310104429','9050','VPC 9050 50위치 · EMI', [upper(),lower()],['410104577'],'제조사 전면 도면 기준 · A/B 각 1~25'),
  frame('310104272','9050','VPC 9050 50위치 · 상단 VXI', [
    {...upper(),mode:'adapter',adapters:[{part:'510109179',width:2},{part:'510109118',width:4}]},lower()
  ],['410104181','410104111'],'상단 VXI 어댑터 · 하단 개별 배선 · 현물 장착 위치 확인'),
  frame('310104114','9025','VPC 9025 25위치 · 1단',[discrete('A','단일 단',1,25,['410104111'])],['410104111'],'단일 단 장착 위치 번호'),
  frame('310104307','9075','VPC 9075 75위치 · 3단',[
    upper(),discrete('B','중단 B',1,25,['410104111','410104505']),discrete('C','하단 C',1,25)
  ],['410104258','410104181','410104276'],'제조사 전면 도면 기준 · A/B/C 각 1~25 · 2단 ITA 조합은 도면 확인'),
  {
    kind:'receiverModule',vendor:'Virginia Panel Corporation',part:'510150115',name:'90 Series QuadraPaddle 리시버 신호 모듈 · 192 위치',
    revision:'1',category:'리시버 모듈',standard:'Standalone',evidence:'verified',source:catalogUrl('510150115'),
    receiverModule:{series:'VPC 90 Series',width:1,termination:'crimp',itaPart:'510151105',
      cavityRows:['A','B','C','D'].map(row=>positions(1,48).map(n=>n+row)),
      cavityView:'후면 · 1A 표시가 왼쪽 위',
      contacts:[{part:'610138216',minAwg:22,maxAwg:28,source:catalogUrl('510150115')}]},
    connectors:[{id:'REAR',name:'후면 접점',family:'VPC QuadraPaddle 192',gender:'neutral',part:'510150115',
      source:drawUrl('510150115'),pins:positions(1,48).flatMap(column=>['A','B','C','D'].map(row=>({id:column+row,kind:'passive'})))}],
  },
  {
    kind:'receiverModule',vendor:'Virginia Panel Corporation',part:'510104136',name:'90 Series TriPaddle 리시버 신호 모듈 · 96 위치',
    revision:'1',category:'리시버 모듈',standard:'Standalone',evidence:'verified',source:catalogUrl('510104136'),
    receiverModule:{series:'VPC 90 Series',width:1,termination:'crimp',itaPart:'510108126',
      cavityRows:[positions(1,32).reverse(),positions(33,64).reverse(),positions(65,96).reverse()],
      cavityView:'제조사 도면 표시 방향 · 오른쪽에 1 / 33 / 65',
      contacts:[{part:'610110101',minAwg:20,maxAwg:24,source:catalogUrl('510104136')},
        {part:'610110167',minAwg:26,maxAwg:28,source:catalogUrl('510104136')}]},
    connectors:[{id:'REAR',name:'후면 접점',family:'VPC TriPaddle 96',gender:'neutral',part:'510104136',
      source:drawUrl('510104136'),pins:positions(1,96).map(id=>({id,kind:'passive'}))}],
  },

];
