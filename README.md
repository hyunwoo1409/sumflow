# SumFlow – 문서 요약 · 검색 웹 서비스

PDF / HWP / Office 문서를 업로드하면 **OCR + LLM 요약**을 수행하고, 결과와 메타데이터를 **검색·관리**할 수 있는 웹 서비스입니다.  
백엔드는 **FastAPI + Celery + Redis + MySQL + Tesseract + Ollama**, 프론트는 **React + Vite + Tailwind** 기반으로 구성되어 있습니다.

---

## 1. 주요 기능

### 1-1. 인증 / 회원 기능
- 이메일(ID) + 비밀번호 기반 로그인
- **JWT 토큰** 기반 “로그인 유지” 옵션
- “아이디 저장” 옵션 (로컬 스토리지 저장)
- **CAPTCHA**(이미지 + 음성) 기반 자동 봇 방지
- 이메일 인증을 포함한 회원가입
  - 가입 시 인증코드 발송 → 코드 검증
- 아이디 찾기 / 비밀번호 재설정
  - 이메일 + 인증코드 검증 후 ID 마스킹 노출, 비밀번호 재설정

### 1-2. 문서 업로드 / 처리
- 단일 / 다중 파일 업로드, 폴더 업로드, Drag & Drop 지원
- 지원 포맷(기본):  
  `PDF, HWP/HWPX, DOC/DOCX, PPT/PPTX, XLS/XLSX, TXT, JPG/JPEG/PNG/TIF/TIFF`
- 업로드 시 **Celery 비동기 작업 큐**에 태스크 등록
- 프론트에서 주기적으로 태스크 상태 폴링 → **진행률(%) + ETA** 표시
- 처리 완료 후:
  - OCR 원문, LLM 요약, 카테고리, 메타데이터를 파일 시스템 + DB에 저장
  - ZIP 다운로드(원본 + 결과 파일 패키징) 지원

### 1-3. 요약 / 카테고리 파이프라인
- **OCR 단계**
  - PyMuPDF로 PDF 페이지 렌더링
  - Tesseract OCR로 텍스트 추출
  - 이미지 전처리(Pillow, scikit-image) 적용
- **Ingest 단계 (PDF 이외 포맷)**
  - DOCX/PPTX/XLSX → LibreOffice(soffice) 기반 PDF 변환
  - HWP → hwp5txt 또는 pyhwp 기반 텍스트 추출
- **LLM 요약 단계**
  - Ollama (`gemma3-summarizer:latest`) 호출
  - “요약 / 카테고리” 2줄 형식 응답
- **카테고리 정규화 단계**
  - `core/category_parser.py`의 TAXONOMY에 따라
  - `대분류/중분류` 2단계 카테고리 문자열로 정규화
- **결과 저장**
  - 파일 시스템 내 결과 JSON/텍스트
  - MySQL의 DOCUMENT, DOC_COMMENT, VISIT_LOG 등 메타데이터 테이블

### 1-4. 검색 / 열람 / 관리
- 키워드, 카테고리, 업로드일 등 조건으로 **문서 검색**
- pdfjs-dist 기반 **PDF 미리보기**(페이지 넘김, 확대/축소)
- 요약/태그 확인, 원본 및 결과 ZIP 다운로드
- 마이페이지:
  - 프로필(닉네임, 연락처, 이메일) 수정
  - 내가 업로드한 문서/댓글 목록
- 댓글:
  - 문서별 댓글 작성/수정/삭제(소프트 삭제)
- 관리자 페이지:
  - 일자별 업로드/방문 통계 (Recharts 차트)
  - 사용자 목록/상태 관리
  - 파일 목록, 삭제(소프트 삭제), 에러 파일 관리

---

## 2. 시스템 아키텍처

```text
[Browser]
  React (Vite, React Router, TailwindCSS)
        │
        ▼
[FastAPI Backend] (app/main.py)
  ├─ /api/v1/...  : 로그인/회원가입/캡차/업로드/검색/계정 찾기 등
  ├─ /download/...: 결과 파일 및 ZIP 다운로드
  ├─ /admin/...   : 관리자 통계/회원/파일 관리
  └─ 미들웨어     : JWT 기반 방문 로그 기록 (VISIT_LOG)
        │
        ├─ MySQL          (사용자, 문서 메타데이터, 방문/댓글 로그)
        ├─ Redis/Memurai  (Celery 브로커 & 결과 백엔드, OCR 캐시)
        ├─ Tesseract + PyMuPDF (OCR 엔진)
        └─ Ollama         (LLM 요약)

3. 기술 스택
3-1. Backend

Python 3.10.x

FastAPI 0.115.0

SQLAlchemy 2.x

Celery 5.4.0 (비동기 작업 큐)

Redis (Windows에서는 Memurai로 대체)

MySQL 8.x

PyMuPDF (pymupdf) / pytesseract / Pillow / scikit-image / scipy

PyJWT, bcrypt, python-dotenv, pydantic v2

httpx, requests

gTTS (CAPTCHA 음성 출력을 위한 TTS)

3-2. Frontend

Node.js 20.x / npm 10.x

React 19.x, React Router DOM 7.x

Vite 7.x

TailwindCSS 4.x

pdfjs-dist 5.x (PDF 뷰어)

jszip, file-saver-es (ZIP/파일 다운로드)

recharts (차트)

lucide-react (아이콘)

react-simple-captcha (캡차 UI)

ESLint + React Hooks/Refresh 플러그인

4. 디렉토리 구조

실제 깃 리포지토리 구조에 맞춰 backend, front 폴더 이름만 조정해서 쓰면 됩니다.

.
├── backend/
│   └── app/
│       ├── main.py                # FastAPI 엔트리포인트
│       ├── config.py              # 환경변수 → 설정 값(OCR/경로/제한 등)
│       ├── core/                  # 코어 유틸/엔진
│       │   ├── db.py              # DB 연결, SessionLocal, Base
│       │   ├── security.py        # JWT, 비밀번호 해시/검증
│       │   ├── ocr_engine.py      # PyMuPDF + Tesseract OCR 파이프라인
│       │   ├── llm_engine.py      # Ollama 호출 및 요약 로직
│       │   ├── category_parser.py # LLM 응답 파싱 + 카테고리 정규화
│       │   └── perf_recorder.py   # 처리 단계별 성능 로그 헬퍼
│       ├── models/                # SQLAlchemy 모델
│       │   ├── user_model.py
│       │   ├── document_model.py
│       │   ├── comment_model.py
│       │   ├── visitlog_model.py
│       │   └── email_verification_model.py
│       ├── schemas/
│       │   └── admin_schema.py    # 관리자 통계/파일 리스트 스키마
│       ├── api/
│       │   └── v1/                # 배치/저수준 OCR/태스크용 API
│       │       ├── ocr_router.py
│       │       ├── ocr_raw_router.py
│       │       ├── task_router.py
│       │       └── batch_router.py
│       ├── routers/               # 일반 웹앱용 라우터
│       │   ├── captcha_audio.py       # CAPTCHA 음성 출력
│       │   ├── user_check_router.py   # 아이디 중복/유효성 체크
│       │   ├── email_verify_router.py # 이메일 인증 코드 전송/검증
│       │   ├── account_recovery_router.py # 아이디 찾기/비밀번호 재설정
│       │   ├── documents.py            # 문서 목록, 삭제(소프트 삭제) 등
│       │   ├── comments.py             # 문서 댓글 CRUD
│       │   ├── ocr_commit_router.py    # OCR/LLM 결과 JSON/ZIP 조회
│       │   ├── download.py             # 결과 파일/ZIP 다운로드
│       │   ├── mypage_router.py        # 마이페이지(프로필/내 문서)
│       │   └── admin_router.py         # 관리자 파일/통계/사용자 관리
│       ├── services/               # 비즈니스 로직 + 일부 APIRouter
│       │   ├── login.py            # 로그인 API + JWT 발급
│       │   ├── signup.py           # 회원가입 API
│       │   ├── captcha.py          # CAPTCHA 이미지/코드 생성
│       │   ├── email_verify.py     # 이메일 인증 코드 생성/발송/검증
│       │   ├── admin_service.py    # 관리자 통계 쿼리
│       │   └── preprocess.py       # 전처리 관련 유틸
│       ├── workers/                # Celery 워커/태스크
│       │   ├── celery_app.py       # Celery 인스턴스, 브로커/백엔드 설정
│       │   └── tasks.py            # OCR → LLM → 카테고리 전체 파이프라인
│       ├── converters/             # 문서 포맷 변환기
│       │   ├── document_ingest.py  # docx/hwp/pptx 등을 PDF/Text로 변환
│       │   ├── docx_extractor.py
│       │   ├── hwp_extractor.py    # hwp5txt/pyhwp 추출
│       │   └── loffice.py          # LibreOffice(soffice) 래퍼
│       ├── utils/
│       │   ├── file_manager.py     # 업로드 파일 관리
│       │   ├── zip_handler.py      # ZIP 압축/해제
│       │   ├── rcache.py           # Redis 캐시(ocr:{task_id} 등)
│       │   └── category_name.py    # 카테고리명 관련 유틸
│       └── storage/                # 예시용 샘플 파일(2.pdf 등)
└── front/
    ├── package.json
    ├── vite.config.*               # Vite 설정
    ├── tailwind.config.*           # Tailwind 설정
    ├── index.html
    └── src/
        ├── main.jsx                # 앱 엔트리, 라우터/전역 컨텍스트
        ├── pages/
        │   ├── LoginPage.jsx           # 로그인 + CAPTCHA
        │   ├── SignupPage.jsx          # 회원가입 + 이메일 인증 + 주소 API
        │   ├── FindAccountPage.jsx     # 아이디/비밀번호 찾기
        │   ├── UploadPage.jsx          # 업로드 홈(Drag & Drop, 폴더 업로드)
        │   ├── UploadFilesPage.jsx     # 업로드 목록/진행도/ZIP 다운로드
        │   ├── Search.jsx              # 검색 화면
        │   ├── AdminPage.jsx           # 관리자 메인 레이아웃
        │   ├── AdminDashboardMain.jsx  # 통계 차트 대시보드
        │   ├── AdminUserManage.jsx     # 회원 관리
        │   └── AdminFileManage.jsx     # 파일/에러 관리
        ├── components/
        │   ├── Sidebar.jsx             # 좌측 사이드바(업로드/검색/마이페이지 등)
        │   ├── AdminSidebar.jsx
        │   ├── UploadHome.jsx          # 업로드 홈 카드 UI
        │   ├── ItemCard.jsx            # 파일 카드 + 진행도/CTA 버튼들
        │   ├── DocPreviewPane.jsx      # pdfjs-dist 기반 미리보기
        │   ├── DbSearchPane.jsx        # 검색 필터 영역
        │   └── ProfileEditModal.jsx    # 프로필 수정 모달
        └── utils/
            ├── http.js                 # API_BASE/VITE_API_URL 래핑
            ├── authStorage.js          # JWT/아이디 저장 로직
            ├── uploadHelpers.js        # 업로드 헬퍼, ZIP 다운로드, 카테고리 파싱
            ├── login.js / signupApi.js # 로그인/회원가입 API 호출
            ├── recoveryApi.js          # 아이디/비밀번호 찾기 API 호출
            ├── searchApi.js            # 검색 API 호출
            ├── adminApi.js / mypageApi.js
            ├── categoryUtils.js        # 카테고리 유틸
            └── fileUtils.js            # 파일 처리 유틸

5. 로컬 개발 환경 구성
5-1. 사전 준비

Python 3.10.x 설치

Node.js 20.x (LTS) + npm 10.x 설치

MySQL 8.x 설치 및 DB 생성 (예: sumflow)

Redis

Windows: Memurai Developer 버전 (Redis 호환) 설치

Tesseract OCR

한글 언어 데이터 포함 설치

예: C:\Program Files\Tesseract-OCR\tesseract.exe

(선택) LibreOffice

soffice 명령어 사용 가능하도록 PATH 설정 (docx/pptx → pdf 변환)

Git, VS Code 등 개발 도구

5-2. 백엔드 가상환경 및 패키지 설치
# backend 디렉토리 기준 (예시)
cd backend

# 1. 가상환경 생성
python -m venv ocrenv

# 2. 가상환경 활성화 (Windows)
ocrenv\Scripts\activate

# 3. 패키지 설치
#   - requirements.txt가 있다면:
pip install -r requirements.txt

#   - 없다면 환경 가이드에 나온 패키지를 수동 설치:
#     fastapi, uvicorn, sqlalchemy, mysql-connector-python / PyMySQL,
#     celery, redis, aiofiles, httpx, python-dotenv, pydantic,
#     python-multipart, Pillow, pytesseract, pymupdf, numpy,
#     scikit-image, PyJWT, bcrypt, python-docx, python-pptx, openpyxl 등

5-3. .env 설정 (백엔드)

backend/app/.env (또는 리포지토리 루트 .env)에 아래와 같이 설정합니다. 값은 실제 환경에 맞게 수정하세요.

# --- LLM (Ollama) ---
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gemma3-summarizer:latest
OLLAMA_OPTIONS=temperature=0.2,top_p=0.9,num_predict=384

# --- Redis / Memurai ---
REDIS_URL=redis://127.0.0.1:6379/0
CELERY_BROKER_URL=${REDIS_URL}
CELERY_RESULT_BACKEND=${REDIS_URL}

# --- 퍼포먼스 로깅 ---
PERF_ENABLED=true

# --- Tesseract OCR 경로 (Windows 예시) ---
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
TESSDATA_PREFIX=C:\Program Files\Tesseract-OCR\tessdata

# --- Database 설정 (MySQL 예시) ---
DB_USER=admin_user
DB_PASS=secure_pass1234
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=sumflow
DB_DRIVER=mysqlconnector

# --- JWT 보안키 ---
JWT_SECRET=GENERATED_SECRET_KEY_123456

# --- 이메일 인증 (예시) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=example@gmail.com
SMTP_PASS=your_app_password_here
SMTP_FROM=SumFlow <example@gmail.com>

# --- 파이프라인 저장소 / 업로드 제한 (필요 시 조정) ---
RESULT_DIR=ocr_store/uploads
ZIP_MAX_FILES=200
ZIP_MAX_BYTES=314572800


허용 확장자, 업로드 경로 등의 기본값은 app/config.py에도 정의되어 있으니, 필요 시 코드/환경변수를 함께 맞춰 주면 됩니다.

5-4. 프론트엔드 환경 변수 및 설치
cd front

# .env.development.local (또는 .env) 예시
echo VITE_API_URL=http://127.0.0.1:4000 > .env.development.local

# 의존성 설치
npm install


프론트에서는 VITE_API_URL(및 일부에서 VITE_API_BASE)를 통해 백엔드 API base URL을 사용합니다.
기본값은 http://127.0.0.1:4000 이므로, 백엔드 포트와 반드시 맞춰야 합니다.

6. 애플리케이션 실행 방법
6-1. Redis / Memurai 실행

Redis 서버(Memurai 포함)가 redis://127.0.0.1:6379/0로 동작 중인지 확인

Windows + Memurai 예:

서비스 상태 확인: Get-Service Memurai

자동 시작 설정: Set-Service Memurai -StartupType Automatic

6-2. Celery 워커 실행 (백엔드)
cd backend\app
ocrenv\Scripts\activate

set PYTHONPATH=%CD%
celery -A workers.celery_app:celery worker -P solo --concurrency=1 -l INFO


Windows에서는 -P solo 필수

로그에 [config] / [tasks] / [Worker] Ready. 가 나오면 정상 실행

6-3. FastAPI 서버 실행
cd backend\app
ocrenv\Scripts\activate

uvicorn main:app --reload --port 4000


개발 기본 포트: 4000

OpenAPI 문서: http://127.0.0.1:4000/docs

6-4. 프론트엔드 개발 서버 실행
cd front
npm run dev


기본 포트: http://127.0.0.1:5173

브라우저에서 접속 후 로그인 → 업로드 → 검색/관리 플로우 테스트

6-5. 전체 실행 순서 요약

Redis / Memurai 실행

Ollama 실행 후 gemma3-summarizer 모델 준비

backend/app에서 Celery 워커 실행

backend/app에서 FastAPI 서버 실행 (포트 4000)

front에서 npm run dev 실행 (포트 5173)

7. 자주 발생하는 이슈 및 해결 방법

포트 충돌

4000(FastAPI), 5173(Vite)이 이미 사용 중이면 다른 포트로 변경하고
VITE_API_URL도 같이 수정.

Tesseract 실행 오류

.env의 TESSERACT_CMD, TESSDATA_PREFIX 경로를 실제 설치 경로로 맞춤.

Redis / Memurai 연결 오류

Windows: Get-Service Memurai로 서비스 상태 확인

.env의 REDIS_URL과 Celery 브로커/백엔드 URL이 동일한지 확인.

Celery가 안 뜨는 경우 ('celery'은(는) 내부 또는 외부 명령이 아닙니다)

가상환경(ocrenv) 활성화 여부 확인

pip show celery로 설치 여부 확인 후 미설치 시 pip install celery

DB 연결 오류

.env의 DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_DRIVER 재확인

로컬 방화벽/외부 DB 접근 권한 설정 확인

CORS 에러

main.py의 CORS 설정(허용 origin 목록)과 실제 프론트 URL(5173 등)을 맞춰 줌.
