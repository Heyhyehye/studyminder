# Studyminder

과목별 복습 체크리스트입니다. 복습할 내용과 예정일을 적어 두고, 달력과 날짜별 목록으로 확인합니다.
기록은 Neon PostgreSQL 데이터베이스에 저장되어 새로고침하거나 서버를 다시 켜도 남아 있습니다.

> 현재 단계: 복습 항목 **추가·조회, 완료·완료 취소, 미완료/완료/전체 구분, 수정·삭제**까지. 배포(GitHub, Vercel)는 전체 점검 후 진행합니다.

## 구조

```
브라우저(화면)  ──요청──▶  서버(Express)  ──SQL──▶  Neon PostgreSQL
public/*                  server.js, db.js          review_items 테이블
```

- **화면**: 입력 폼, 달력, 목록을 보여 주고 서버의 API에 기록을 요청하거나 저장을 부탁합니다.
- **서버**: 화면 파일을 브라우저에 보내 주고, API 요청을 받아 입력값을 다시 검사한 뒤 DB에 저장하거나 꺼내 줍니다.
- **DB**: 복습 기록을 영구 보관합니다.

## 용어

| 용어 | 뜻 |
|---|---|
| Node.js | 브라우저 밖(내 컴퓨터, 서버)에서 JavaScript를 실행하는 프로그램 |
| npm | Node.js용 패키지(남이 만들어 둔 코드 묶음)를 설치·실행하는 도구 |
| Express | Node.js로 웹 서버를 쉽게 만들게 해 주는 패키지 |
| API | 화면이 서버에 "목록 줘", "이거 저장해 줘"처럼 요청하는 주소 (예: `/api/items`) |
| SQL | 데이터베이스에 표를 만들거나 기록을 넣고 꺼낼 때 쓰는 언어 |
| 테이블 | DB 안의 표. 한 줄이 복습 항목 하나 |
| 연결 문자열 | DB 주소·사용자·비밀번호가 한 줄에 담긴 접속정보 (`postgresql://...`) |
| 환경 변수 / `.env` | 코드에 직접 적지 않고 실행할 때 넣어 주는 설정값. `.env`는 그 값을 적어 두는 내 컴퓨터 전용 파일 |

## 파일별 역할

| 파일 | 역할 |
|---|---|
| `public/index.html` | 화면 구조 (입력 폼, 달력, 목록, 안내) |
| `public/style.css` | 공부 노트 스타일 디자인 |
| `public/script.js` | 서버에서 기록 불러오기·저장, 완료·완료 취소, 수정 모드·삭제 확인, 과목 선택지, 달력(남은 미완료 수)·날짜별 목록, 미완료/완료/전체 구분, 입력 검사 |
| `public/logo.svg` | 로고와 브라우저 탭 아이콘 |
| `server.js` | Express 서버. 화면 파일 제공, `GET /api/items`(목록), `POST /api/items`(추가), `PATCH /api/items/:id`(완료 여부 변경, `{ "isDone": true/false }`), `PUT /api/items/:id`(수정, 완료 여부는 유지), `DELETE /api/items/:id`(삭제), 입력값 서버 검사 |
| `db.js` | Neon 연결과 SQL 실행. 접속정보는 여기서만 사용 |
| `schema.sql` | `review_items` 테이블을 만드는 SQL (Neon SQL Editor에서 한 번 실행) |
| `.env.example` | `.env` 작성 예시 (실제 값 없음) |
| `.env` | **내 컴퓨터에만 있는** 실제 DB 접속정보. GitHub에 올리지 않음 |
| `.gitignore` | Git이 무시할 파일 목록 (`.env`, `node_modules/` 등) |
| `package.json` | 프로젝트 정보, 필요한 패키지, 실행 명령 |
| `package-lock.json` | 설치된 패키지의 정확한 버전 기록 (자동 생성) |

## 저장하는 정보 (`review_items` 테이블)

| 칸 | 내용 |
|---|---|
| `id` | 자동으로 붙는 고유번호 |
| `subject` | 과목 (최대 50자) |
| `content` | 복습할 내용 (최대 200자) |
| `due_date` | 복습 예정일. 시간 없이 날짜만 저장(`DATE`)하고 문자열 `YYYY-MM-DD`로 주고받아 시간대 때문에 날짜가 바뀌지 않음 |
| `memo` | 선택 메모 (최대 500자, 없으면 비어 있음) |
| `is_done` | 완료 여부 (처음엔 미완료 `false`) |
| `created_at` | 등록 시각 |

과목 선택지는 따로 저장하지 않고, 저장된 기록의 과목을 모아 만듭니다.

## 처음 설정과 실행

1. **테이블 만들기**: Neon 콘솔 → `studyminder` 프로젝트 → 브랜치 `production` → SQL Editor에서 `schema.sql` 내용을 붙여 넣고 실행
2. **접속정보 넣기**: 프로젝트 폴더에서 `.env.example`을 복사해 `.env`를 만들고, `DATABASE_URL` 값을 Neon의 연결 문자열로 바꾸기
   ```bash
   cp .env.example .env
   ```
3. **패키지 설치** (처음 한 번, 이미 설치되어 있으면 생략)
   ```bash
   npm install
   ```
4. **서버 실행** 후 브라우저에서 <http://localhost:3000> 열기
   ```bash
   npm start        # 일반 실행
   npm run dev      # 코드를 고치면 서버가 자동으로 다시 시작
   ```
   서버를 끌 때는 터미널에서 `Ctrl + C`.

> `index.html`을 파일로 직접 열면 서버가 없어 기록을 불러오지 못합니다. 반드시 서버를 켠 뒤 `http://localhost:3000`으로 여세요.

## 저장 확인 방법

Neon SQL Editor에서 실행:

```sql
SELECT id, subject, content, due_date, memo, is_done, created_at
FROM review_items
ORDER BY id;
```

## 문제 해결

| 화면·터미널 안내 | 확인할 것 |
|---|---|
| DB 접속정보(DATABASE_URL)가 설정되지 않았어요 | `.env` 파일이 프로젝트 최상위에 있는지, 이름이 정확히 `DATABASE_URL`인지 |
| DB에 review_items 테이블이 없어요 | `schema.sql`을 실행했는지, `.env`의 DB와 SQL Editor에서 고른 브랜치·DB가 같은지 |
| DB 접속정보가 올바르지 않아요 | 연결 문자열을 빠짐없이 복사했는지 (비밀번호 포함) |
| 서버에 연결하지 못했어요 | 터미널에서 `npm start`가 실행 중인지 |
