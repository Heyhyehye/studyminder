// Neon PostgreSQL 연결과 복습 기록 쿼리.
// 접속정보(DATABASE_URL)는 서버 환경 변수에서만 읽고, 화면이나 로그로 내보내지 않는다.
const { neon } = require('@neondatabase/serverless');

let sql = null;

function getSql() {
  if (!process.env.DATABASE_URL) {
    const error = new Error('DATABASE_URL is not set');
    error.code = 'NO_DATABASE_URL';
    throw error;
  }
  if (!sql) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

// 예정일은 DB의 DATE를 'YYYY-MM-DD' 문자열로 바꿔 꺼낸다.
// JavaScript Date로 바꾸지 않으므로 시간대 때문에 날짜가 하루 밀리지 않는다.
function toItem(row) {
  return {
    id: row.id,
    subject: row.subject,
    content: row.content,
    dueDate: row.due_date,
    memo: row.memo,
    isDone: row.is_done,
  };
}

async function listItems() {
  const rows = await getSql()`
    SELECT id, subject, content, to_char(due_date, 'YYYY-MM-DD') AS due_date,
           COALESCE(memo, '') AS memo, is_done
    FROM review_items
    ORDER BY due_date, id
  `;
  return rows.map(toItem);
}

// 값은 모두 매개변수로 전달되어 SQL 문장과 섞이지 않는다.
async function createItem({ subject, content, dueDate, memo }) {
  const rows = await getSql()`
    INSERT INTO review_items (subject, content, due_date, memo)
    VALUES (${subject}, ${content}, ${dueDate}::date, ${memo === '' ? null : memo})
    RETURNING id, subject, content, to_char(due_date, 'YYYY-MM-DD') AS due_date,
              COALESCE(memo, '') AS memo, is_done
  `;
  return toItem(rows[0]);
}

// 완료 여부만 바꾼다. 해당 id가 없으면 null을 돌려준다.
async function setItemDone(id, isDone) {
  const rows = await getSql()`
    UPDATE review_items
    SET is_done = ${isDone}
    WHERE id = ${id}
    RETURNING id, subject, content, to_char(due_date, 'YYYY-MM-DD') AS due_date,
              COALESCE(memo, '') AS memo, is_done
  `;
  return rows.length > 0 ? toItem(rows[0]) : null;
}

// 과목·내용·예정일·메모만 바꾸고 완료 여부(is_done)는 그대로 둔다. 해당 id가 없으면 null.
async function updateItem(id, { subject, content, dueDate, memo }) {
  const rows = await getSql()`
    UPDATE review_items
    SET subject = ${subject}, content = ${content}, due_date = ${dueDate}::date,
        memo = ${memo === '' ? null : memo}
    WHERE id = ${id}
    RETURNING id, subject, content, to_char(due_date, 'YYYY-MM-DD') AS due_date,
              COALESCE(memo, '') AS memo, is_done
  `;
  return rows.length > 0 ? toItem(rows[0]) : null;
}

// 삭제했으면 true, 해당 id가 없으면 false
async function deleteItem(id) {
  const rows = await getSql()`
    DELETE FROM review_items
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}

module.exports = { listItems, createItem, setItemDone, updateItem, deleteItem };
