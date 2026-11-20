# ATE Studio v0.7.0

## 프로젝트와 도면

- 로컬 프로젝트 관리, 설계 복제·이동·반영, 템플릿, 잠금, 리비전, 첨부와 검토·질의
- 시스템 구성도, 신호 결선도, 케이블 경로 도면, 분기점과 경유점, 사용자 커넥터와 Flying Lead
- 핀 선택판, 자동 핀 연결, 신호 기반 케이블 초안, 루프백, 케이블 묶기, 길이 단위 변환
- 작업공간 공유 파일, 견적 검토 ZIP, SVG 도면, BOM CSV
- [TSA 화면별 기능 대조](https://github.com/coldnoodleman/ATE-Studio/blob/main/docs/TSA-FEATURES.md)

## 폐쇄망용 포터블

- Windows x64는 ZIP을 통째로 풀고 `ATE Studio.exe`를 실행합니다.
- Linux x86_64는 X11 또는 Wayland 데스크톱에서 압축을 풀고 `./ate-studio`를 실행합니다. `./ate-studio --check`로 라이브러리를 먼저 검사할 수 있습니다. glibc 기반 배포판이 필요하며 동봉 라이브러리의 빌드 기준은 Ubuntu 22.04입니다.
- 실행에 필요한 Electron과 Node.js 런타임, 앱 라이브러리, 한글 폰트를 포함했습니다. 배치·배선·저장·출력은 오프라인으로 사용할 수 있습니다. 설계 AI를 켠 경우에만 설정한 사내 LLM에 연결합니다.

## 주요 기능

- PXI·PXIe 섀시와 장비 배치, Pickering J1에서 VPC 9050 후면 접점까지 배선
- VPC 9025·9075와 사용자 정의 리시버, 접점별 AWG 검증, CDT 핀맵 CSV 교환
- 9050 예제, 모듈별 핀 ID 안내, 기존 배선에 영향을 주는 장착 변경 확인
- 오프라인 설치 안내 및 개발 인수인계는 저장소의 README와 AGENTS.md에 포함
