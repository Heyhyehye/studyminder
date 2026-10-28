-- Studyminder 복습 기록 테이블
-- Neon 콘솔 > studyminder 프로젝트 > production 브랜치 > SQL Editor에서 실행하세요.
-- 이미 테이블이 있으면 아무것도 바꾸지 않으므로 여러 번 실행해도 안전합니다.

CREATE TABLE IF NOT EXISTS review_items (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject     VARCHAR(50)  NOT NULL CHECK (length(btrim(subject)) > 0),
  content     VARCHAR(200) NOT NULL CHECK (length(btrim(content)) > 0),
  due_date    DATE         NOT NULL,
  memo        VARCHAR(500),
  is_done     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 예정일 순 조회를 빠르게 하기 위한 색인
CREATE INDEX IF NOT EXISTS review_items_due_date_idx ON review_items (due_date, id);
