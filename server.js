const path = require('path');
const express = require('express');
const db = require('./db');

const LIMITS = { subject: 50, content: 200, memo: 500 };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 입력 검사 ----------

// 글자 수는 DB(VARCHAR)와 같은 기준인 '문자' 단위로 센다.
function charLength(text) {
  return [...text].length;
}

function isRealDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return false;
  }
  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// 통과하면 { value }, 아니면 { error, field }를 돌려준다.
function validateItem(body) {
  if (!body || typeof body !== 'object') {
    return { error: '요청 형식이 올바르지 않아요.' };
  }
  const { subject, content, dueDate, memo = '' } = body;

  if (typeof subject !== 'string' || subject.trim() === '') {
    return { error: '과목을 입력해 주세요. (공백만으로는 등록할 수 없어요)', field: 'subject' };
  }
  if (charLength(subject.trim()) > LIMITS.subject) {
    return { error: `과목은 ${LIMITS.subject}자까지 입력할 수 있어요.`, field: 'subject' };
  }
  if (typeof content !== 'string' || content.trim() === '') {
    return { error: '복습할 내용을 입력해 주세요. (공백만으로는 등록할 수 없어요)', field: 'content' };
  }
  if (charLength(content.trim()) > LIMITS.content) {
    return { error: `복습할 내용은 ${LIMITS.content}자까지 입력할 수 있어요.`, field: 'content' };
  }
  if (typeof dueDate !== 'string' || !isRealDate(dueDate)) {
    return { error: '복습 예정일을 올바른 날짜로 선택해 주세요.', field: 'dueDate' };
  }
  if (memo !== null && typeof memo !== 'string') {
    return { error: '메모 형식이 올바르지 않아요.', field: 'memo' };
  }
  const trimmedMemo = (memo || '').trim();
  if (charLength(trimmedMemo) > LIMITS.memo) {
    return { error: `메모는 ${LIMITS.memo}자까지 입력할 수 있어요.`, field: 'memo' };
  }

  return { value: { subject: subject.trim(), content: content.trim(), dueDate, memo: trimmedMemo } };
}

// URL의 항목 번호: 양의 정수(DB INTEGER 범위)만 받는다. 아니면 null.
function parseItemId(text) {
  if (!/^\d{1,10}$/.test(text)) {
    return null;
  }
  const id = Number(text);
  return id >= 1 && id <= 2147483647 ? id : null;
}

// ---------- DB 오류 처리 ----------

// 오류 메시지에 연결 문자열이 섞여 있어도 로그에 남지 않게 가린다.
function hideSecrets(text) {
  return String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, '[DATABASE_URL]');
}

// action은 로그용 이름, failedVerb는 안내 문구용 표현(예: '불러오지', '저장하지')
function sendDbError(res, error, action, failedVerb) {
  console.error(`[DB] ${action} 실패:`, error.code || '', hideSecrets(error.message));

  let message = `DB에서 기록을 ${failedVerb} 못했어요. 잠시 후 다시 시도해 주세요.`;
  if (error.code === 'NO_DATABASE_URL') {
    message = '서버에 DB 접속정보(DATABASE_URL)가 설정되지 않았어요. .env 파일을 확인해 주세요.';
  } else if (error.code === '42P01') {
    message = 'DB에 review_items 테이블이 없어요. Neon SQL Editor에서 schema.sql을 실행했는지 확인해 주세요.';
  } else if (error.code === '28P01') {
    message = 'DB 접속정보가 올바르지 않아요. .env의 DATABASE_URL을 확인해 주세요.';
  }
  res.status(500).json({ error: message });
}

// ---------- API ----------

app.get('/api/items', async (req, res) => {
  try {
    res.json({ items: await db.listItems() });
  } catch (error) {
    sendDbError(res, error, '불러오기', '불러오지');
  }
});

app.post('/api/items', async (req, res) => {
  const result = validateItem(req.body);
  if (result.error) {
    res.status(400).json({ error: result.error, field: result.field });
    return;
  }
  try {
    res.status(201).json({ item: await db.createItem(result.value) });
  } catch (error) {
    sendDbError(res, error, '저장', '저장하지');
  }
});

// 완료 여부 변경: body는 { isDone: true | false }
app.patch('/api/items/:id', async (req, res) => {
  const id = parseItemId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: '복습 항목 번호가 올바르지 않아요.' });
    return;
  }
  if (!req.body || typeof req.body.isDone !== 'boolean') {
    res.status(400).json({ error: '완료 여부는 true 또는 false로 보내야 해요.' });
    return;
  }
  try {
    const item = await db.setItemDone(id, req.body.isDone);
    if (!item) {
      res.status(404).json({ error: '해당 복습 항목을 찾을 수 없어요. 새로고침해 주세요.' });
      return;
    }
    res.json({ item });
  } catch (error) {
    sendDbError(res, error, '완료 상태 변경', '변경하지');
  }
});

// 기록 수정: body는 추가와 같은 { subject, content, dueDate, memo }. 완료 여부는 바꾸지 않는다.
app.put('/api/items/:id', async (req, res) => {
  const id = parseItemId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: '복습 항목 번호가 올바르지 않아요.' });
    return;
  }
  const result = validateItem(req.body);
  if (result.error) {
    res.status(400).json({ error: result.error, field: result.field });
    return;
  }
  try {
    const item = await db.updateItem(id, result.value);
    if (!item) {
      res.status(404).json({ error: '해당 복습 항목을 찾을 수 없어요. 새로고침해 주세요.' });
      return;
    }
    res.json({ item });
  } catch (error) {
    sendDbError(res, error, '수정', '수정하지');
  }
});

app.delete('/api/items/:id', async (req, res) => {
  const id = parseItemId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: '복습 항목 번호가 올바르지 않아요.' });
    return;
  }
  try {
    const deleted = await db.deleteItem(id);
    if (!deleted) {
      res.status(404).json({ error: '이미 삭제됐거나 찾을 수 없는 기록이에요. 새로고침해 주세요.' });
      return;
    }
    res.json({ id });
  } catch (error) {
    sendDbError(res, error, '삭제', '삭제하지');
  }
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: '요청한 API를 찾을 수 없어요.' });
});

// JSON 형식 오류 등 처리하지 못한 오류
app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: '요청 형식이 올바르지 않아요.' });
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: '입력 내용이 너무 길어요.' });
    return;
  }
  console.error('[서버] 처리하지 못한 오류:', hideSecrets(error.message));
  res.status(500).json({ error: '서버에서 문제가 생겼어요.' });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Studyminder 서버 실행 중: http://localhost:${port}`);
    if (!process.env.DATABASE_URL) {
      console.warn('주의: DATABASE_URL이 설정되지 않았어요. .env 파일을 확인해 주세요.');
    }
  });
}

module.exports = app;
