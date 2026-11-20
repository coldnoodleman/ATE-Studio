# ATE Studio 0.5.0

폐쇄망에서 PXI·PXIe 장비의 배치, 신호 연결, 케이블과 리시버를 설계하는 데스크톱 앱입니다. 예제 장비와 도면에 근거한 제조사 프로파일이 포함됩니다.

## 실행

| 배포본 | 실행 방법 |
| --- | --- |
| Windows x64 | ZIP 전체를 로컬 폴더에 풀고 `ATE Studio.exe`를 실행 |
| Linux x86_64 | 압축을 풀고 `./ate-studio`를 실행 |

Electron, React, SQLite, XLSX 작성 라이브러리와 한글 폰트를 포함합니다. 별도의 Node.js나 npm 설치가 필요하지 않습니다. Linux에서는 GTK3, NSS, GBM, ALSA 등 배포판 데스크톱 라이브러리가 필요하며 실행 스크립트가 누락을 알려 줍니다. 샌드박스는 일반 실행 시 기본 활성화 상태입니다. Windows 실행 파일은 사내 코드 서명 인증서 적용 전입니다.

## 9050 예제부터 시작

1. 왼쪽 **9050 배선 예제**를 누릅니다. 샘플 파일은 `examples/Pickering_VPC_9050_Sample.ateproj`에도 들어 있습니다.
2. **와이어링 → 리시버**에서 9050의 A·B 각 25위치를 확인합니다. 빈 위치를 눌러 모듈과 후면 접점을 선택한 뒤 **모듈 장착 저장**을 누릅니다. 모듈 전체에 같은 접점을 쓰려면 **핀별 접점 품번**은 비워 둡니다. 기존 연결에 영향이 있으면 장착 창에서 대상 케이블과 신호를 확인할 수 있습니다. 장착 모듈의 **접점 배치**에서 도면의 접점 표시를 확인합니다.
3. **케이블**에서 예제 CBL-001을 엽니다. A측 Pickering `42-153-104` J1의 20/21/22/23번과 B측 VPC `310104368` A.1의 `1A/1B/2A/2B`를 확인합니다. 품번과 핀 ID는 제조사 자료 기준이며, 둘 사이의 배정과 길이는 시연용입니다.
4. 실제 설계에서는 장비를 배치한 후 장비 속성의 **커넥터·핀**에서 사용 모델의 제조사 핀맵을 등록합니다. **와이어링 열기**에서 이 장비를 A측으로 잡고 B측 리시버의 장착 위치를 지정합니다.
5. **신호 연결**에서 장비 여러 개의 핀을 논리 신호로 묶고, 케이블 편집의 **신호에서 채우기**로 해당 양단의 핀쌍을 가져옵니다. 도체 색상, AWG, 페어, 실드, 슬리브, 길이 기준, 원재료 및 백셸을 편집할 수 있습니다.
6. 슬롯 이동은 같은 구성품 ID를 유지합니다. 구성품 교체·탈거 또는 핀맵 변경으로 영향을 받은 신호와 케이블은 남아 있으며 **와이어링 검토**에서 다시 연결하거나 현재 핀맵을 확인할 수 있습니다.

## 기본 리시버 프로파일

| 모델 | 수용 위치 | 설정 |
| --- | --- | --- |
| 9050 310104368 | A/B 각 25 | 양쪽 단 개별 배선 |
| 9050 310104429 | A/B 각 25 | EMI 모델, 양쪽 단 개별 배선 |
| 9050 310104272 | A/B 각 25 | A단 VXI 어댑터 필요, B단 개별 배선 |
| 9025 310104114 | A 25 | 90 Series |
| 9075 310104307 | A/B/C 각 25 | 90 Series |

신호 모듈은 `510150115` QuadraPaddle 192점과 `510104136` TriPaddle 96점을 기본 제공합니다. 리시버의 **후면 종단**에는 장비에 맞물리는 별도 플러그를 추정하는 대신 장착한 모듈의 접점 품번과 종단 방식을 사용합니다. 접점 사양에 AWG 범위가 있으면 기본 AWG 또는 도체별 AWG를 검사합니다. 모듈별 기본 접점과 함께 핀별 접점 품번을 등록할 수 있습니다. 9050 상단 VXI 위치의 어댑터 정렬과 ITA/장비의 기계적 간섭은 적용 현물과 제조사 도면을 대조합니다.

다른 리시버는 **장비 라이브러리 → 장비 등록 → 리시버**에서 `receiver` 프로파일을 등록합니다. 각 단에 `id`, `label`, 순서가 있는 `positions`, 허용 모듈 `families` 및 `mode`를 입력합니다. `adapter` 단은 승인 어댑터 품번과 점유 위치 수가 필요합니다. 사용자 모듈은 **리시버 모듈** 유형에 `series`, `width`, `termination`, `itaPart`, `contacts`와 후면 핀맵을 넣습니다. 9050 및 기본 프로파일과 동일하게 위치·점유 폭·중복·어댑터·접점/AWG를 검사합니다.

## Pickering CDT 파일 연동

- ATE Studio의 **와이어링 → 케이블**에서 케이블을 선택하고 **핀맵 CSV** 또는 **리시버 Flying Lead CSV**를 저장합니다.
- [Pickering CDT](https://tsa.pickeringtest.com/drawing/main/cable/1/0)에서 먼저 양쪽 커넥터와 케이블 경로를 구성합니다. VPC 후면 접점을 옮기는 경우 B측을 **Right flying lead**로 만들고 도체 수를 맞춥니다. **Link Pins → CSV Import → Apply Changes** 순으로 불러옵니다.
- 일반 형식은 양쪽 숫자 핀 번호의 2열 또는 핀 이름 포함 4열을 사용합니다. 리시버 Flying Lead 4열 형식은 B측에 1부터 시작하는 리드 번호를 부여하고 이름 칸에 실제 접점 ID(예: `1A`)를 보존합니다. CDT에서 내보낸 같은 형식의 파일을 ATE Studio에서 가져올 때는 해당 모드를 선택합니다.
- 이 연동은 Pinout CSV 교환입니다. CDT의 작업공간과 케이블 본체, VPC 모델, 전선 재료 속성을 서버에서 동기화하거나 네이티브 설계 파일로 자동 생성하는 기능은 포함하지 않습니다. 트위스트 페어 정보는 ATE 프로젝트와 배선표 XLSX에 유지합니다.
- [Pickering CDT의 공식 Pinout CSV 안내](https://pickeringconnect.com/blog/how-to-import-pinouts-using-a-csv-file/)

## 저장과 출력

기존 0.1.0 프로젝트를 열 수 있습니다. 0.2.0에서 저장한 배선 설계는 새 스키마를 사용하므로 기존 0.1.0 앱에는 이전 프로젝트를 따로 보관하세요. 설계 파일은 배치된 장비 정의, 장착 모듈과 배선을 포함합니다. 저장 시 `.bak`에 직전 정상본을 보관하며 읽기 전용으로 열린 공동 파일은 사본으로 저장할 수 있습니다.

**설계 출력**은 배치도·배선도 PDF/PNG와 XLSX를 제공합니다. XLSX에는 부품명세서, 케이블 목록, 양단 도체 핀맵, 케이블 자재, 신호 접점, 리시버 위치와 리비전 기록이 포함됩니다. 검토본 출력 전 핀맵 근거, 접점, AWG 등 앱에 표시된 확인 항목을 해소합니다.

## 사내 LLM

설정에서 OpenAI 호환 API 주소, 모델 ID, 필요한 API 키로 사내 모델을 연결합니다. 로컬 예제는 LLM 연결 없이 사용할 수 있습니다. LLM은 카탈로그 후보와 배치 제안 또는 검토 설명을 제공하며, 적용은 사용자가 확인합니다.

## 개발과 자료

- Node.js 24 계열에서 `npm ci`, `npm run typecheck`, `npm test`, `npm run build`를 실행합니다. 빌드 후 `npm start`로 앱을 엽니다.
- 두 플랫폼 패키지는 Electron 공식 ZIP과 공식 `SHASUMS256.txt`로 `tools/package.sh RUNTIME_DIR OUTPUT_DIR`에서 만듭니다.
- [VPC 9050 표준](https://www.vpc.com/catalog/310104368/) · [9050 EMI](https://www.vpc.com/catalog/310104429/) · [9050 VXI](https://www.vpc.com/catalog/310104272/)
- [VPC 9025](https://www.vpc.com/catalog/310104114/) · [VPC 9075](https://www.vpc.com/catalog/310104307/) · [QuadraPaddle 192](https://www.vpc.com/catalog/510150115/) · [TriPaddle 96](https://www.vpc.com/catalog/510104136/)
- [Pickering 40/42-153 매뉴얼](https://www.pickeringtest.com/portal/web/256/content/downloads/manuals/40-42-153M.pdf) Figure 5.6 · [D-Sub 37 액세서리](https://www.pickeringtest.com/portal/web/256/content/downloads/datasheets/90-007D.pdf)
