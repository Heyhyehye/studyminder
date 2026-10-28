// 복습 기록은 서버를 거쳐 Neon DB에 저장하고, 화면은 불러온 기록으로 달력과 목록을 그린다.
let reviewItems = [];
let subjects = [];
let loadState = 'loading'; // 'loading' | 'error' | 'ready'
let loadErrorMessage = '';
let isSaving = false;
let statusFilter = 'todo'; // 'todo'(미완료) | 'done'(완료) | 'all'(전체)
const pendingIds = new Set(); // 완료 상태를 바꾸는 중인 항목 id
const deletingIds = new Set(); // 삭제 요청 중인 항목 id
let editingId = null; // 수정 중인 항목 id (null이면 새 항목 추가)
let editingOriginal = null; // 수정을 시작할 때의 항목 내용
let confirmingDeleteId = null; // 삭제 확인을 묻고 있는 항목 id

const STATUS_LABELS = { todo: '미완료', done: '완료', all: '전체' };

// 과목 선택지의 value. 과목명 앞에 접두어를 붙여 특수 값과 겹치지 않게 한다.
const NEW_SUBJECT = 'new';
const SUBJECT_PREFIX = 's:';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const todayKey = toDateKey(new Date());
let viewYear = new Date().getFullYear();
let viewMonth = new Date().getMonth(); // 0부터 시작
let selectedDate = null; // null이면 전체 보기

const formCard = document.querySelector('.form-card');
const formTitleText = document.getElementById('form-title-text');
const editBanner = document.getElementById('edit-banner');
const editTarget = document.getElementById('edit-target');
const cancelEditButton = document.getElementById('cancel-edit');
const form = document.getElementById('review-form');
const formFields = document.getElementById('form-fields');
const subjectLabel = document.getElementById('subject-label');
const subjectSelectWrap = document.getElementById('subject-select-wrap');
const subjectSelect = document.getElementById('subject-select');
const newSubjectWrap = document.getElementById('new-subject-wrap');
const newSubjectInput = document.getElementById('new-subject');
const contentInput = document.getElementById('content');
const dueDateInput = document.getElementById('due-date');
const memoInput = document.getElementById('memo');
const formMessage = document.getElementById('form-message');
const submitButton = document.getElementById('submit-button');

const calendarCard = document.querySelector('.calendar-card');
const calendarTitle = document.getElementById('calendar-title');
const calendarGrid = document.getElementById('calendar-grid');
const prevMonthButton = document.getElementById('prev-month');
const nextMonthButton = document.getElementById('next-month');

const listTitle = document.getElementById('list-title');
const itemCount = document.getElementById('item-count');
const showAllButton = document.getElementById('show-all');
const statusButtons = document.querySelectorAll('#status-filter .segment');
const listMessage = document.getElementById('list-message');
const loadStatus = document.getElementById('load-status');
const loadStatusText = document.getElementById('load-status-text');
const retryButton = document.getElementById('retry-button');
const emptyMessage = document.getElementById('empty-message');
const list = document.getElementById('review-list');

// ---------- 날짜 도우미 ----------

function pad(number) {
  return String(number).padStart(2, '0');
}

// 로컬 날짜 기준 'YYYY-MM-DD'
function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month: month - 1, day };
}

function weekdayOf(key) {
  const { year, month, day } = parseDateKey(key);
  return WEEKDAYS[new Date(year, month, day).getDay()];
}

// 예: 10월 28일 (수)
function formatShortDate(key) {
  const { month, day } = parseDateKey(key);
  return `${month + 1}월 ${day}일 (${weekdayOf(key)})`;
}

// 예: 2026. 10. 28 (수)
function formatFullDate(key) {
  const { year, month, day } = parseDateKey(key);
  return `${year}. ${month + 1}. ${day} (${weekdayOf(key)})`;
}

// ---------- 서버 요청 ----------

// 실패하면 서버가 보낸 안내 문구(와 문제 칸 이름)를 담은 Error를 던진다.
async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error('서버에 연결하지 못했어요. 서버가 실행 중인지(npm start) 확인해 주세요.');
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok || data === null) {
    const error = new Error(data?.error || `서버 응답에 문제가 있어요. (상태 코드 ${response.status})`);
    error.field = data?.field;
    throw error;
  }
  return data;
}

// ---------- 과목 선택 ----------

// 저장된 기록에서 과목을 등록 순서(id 순)대로 중복 없이 모은다.
function collectSubjects(items) {
  const names = [...items].sort((a, b) => a.id - b.id).map((item) => item.subject);
  return [...new Set(names)];
}

function isNewSubjectMode() {
  return subjects.length === 0 || subjectSelect.value === NEW_SUBJECT;
}

function addOption(value, text) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  subjectSelect.append(option);
}

// 과목 선택지를 다시 그린다. value가 선택지에 있으면 그 값을 고르고,
// 없거나 주지 않으면 '과목을 선택해 주세요' 상태로 둔다.
function renderSubjectOptions(value = '') {
  subjectSelect.replaceChildren();
  addOption('', '과목을 선택해 주세요');
  subjects.forEach((subject) => addOption(SUBJECT_PREFIX + subject, subject));
  addOption(NEW_SUBJECT, '+ 새 과목 입력');

  const values = [...subjectSelect.options].map((option) => option.value);
  subjectSelect.value = values.includes(value) ? value : '';
  updateSubjectFields();
}

function updateSubjectFields() {
  const hasSubjects = subjects.length > 0;
  subjectSelectWrap.hidden = !hasSubjects;
  newSubjectWrap.hidden = !isNewSubjectMode();
  subjectLabel.htmlFor = hasSubjects ? 'subject-select' : 'new-subject';
}

function getSubjectValue() {
  if (isNewSubjectMode()) {
    return newSubjectInput.value.trim();
  }
  return subjectSelect.value.startsWith(SUBJECT_PREFIX) ? subjectSelect.value.slice(SUBJECT_PREFIX.length) : '';
}

function stickerClass(subject) {
  return `sticker sticker-${subjects.indexOf(subject) % 6}`;
}

// ---------- 입력 검사 ----------

// 칸별 검사: 오류가 있으면 { key, message, field }를, 없으면 null을 돌려준다.
function subjectError() {
  if (getSubjectValue() !== '') {
    return null;
  }
  if (isNewSubjectMode()) {
    return { key: 'subject', message: '과목 이름을 입력해 주세요. (공백만으로는 등록할 수 없어요)', field: newSubjectInput };
  }
  return { key: 'subject', message: '과목을 선택하거나 ‘+ 새 과목 입력’을 골라 주세요.', field: subjectSelect };
}

function contentError() {
  if (contentInput.value.trim() !== '') {
    return null;
  }
  return { key: 'content', message: '복습할 내용을 입력해 주세요. (공백만으로는 등록할 수 없어요)', field: contentInput };
}

function dueDateError() {
  const value = dueDateInput.value;
  // 연·월·일 중 일부만 입력하면 브라우저는 value를 빈 값으로 두고 badInput으로 알려 준다.
  if (dueDateInput.validity.badInput) {
    return { key: 'dueDate', message: '복습 예정일을 연·월·일까지 올바르게 입력해 주세요.', field: dueDateInput };
  }
  if (value === '') {
    return { key: 'dueDate', message: '복습 예정일을 선택해 주세요.', field: dueDateInput };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { key: 'dueDate', message: '복습 예정일을 올바른 날짜로 선택해 주세요.', field: dueDateInput };
  }
  return null;
}

const fieldCheckers = { subject: subjectError, content: contentError, dueDate: dueDateError };

// 필수값을 위에서부터 검사해 첫 번째 오류를 돌려준다.
function validate() {
  return subjectError() || contentError() || dueDateError();
}

function fieldKey(field) {
  if (field === subjectSelect || field === newSubjectInput) {
    return 'subject';
  }
  return { content: 'content', 'due-date': 'dueDate', memo: 'memo' }[field.id];
}

// 서버가 알려 준 문제 칸 이름을 입력 요소로 바꾼다.
function fieldFromServer(name) {
  if (name === 'subject') {
    return isNewSubjectMode() ? newSubjectInput : subjectSelect;
  }
  return { content: contentInput, dueDate: dueDateInput, memo: memoInput }[name] || null;
}

const checkedFields = [subjectSelect, newSubjectInput, contentInput, dueDateInput, memoInput];

// 지금 보이는 안내의 종류
// null | { type: 'success' } | { type: 'field', key }(입력 오류) | { type: 'save' }(저장 실패)
let messageState = null;

function clearMessage() {
  formMessage.classList.remove('is-success');
  formMessage.textContent = '';
  checkedFields.forEach((field) => field.classList.remove('invalid'));
  messageState = null;
}

function showFieldError(error, { focus = true } = {}) {
  clearMessage();
  formMessage.textContent = error.message;
  messageState = { type: 'field', key: error.key };
  error.field.classList.add('invalid');
  if (focus) {
    error.field.focus();
  }
}

function showSaveError(saveError, prefix = '저장하지 못했어요.') {
  const message = `${prefix} ${saveError.message}`;
  const field = fieldFromServer(saveError.field);
  if (field) {
    showFieldError({ key: saveError.field, message, field });
    return;
  }
  clearMessage();
  formMessage.textContent = message;
  messageState = { type: 'save' };
}

function showSuccess(message) {
  clearMessage();
  formMessage.classList.add('is-success');
  formMessage.textContent = message;
  messageState = { type: 'success' };
}

// 다음 항목을 쓰기 시작하면 이전 저장 성공 문구만 지운다.
function dismissSuccess() {
  if (messageState?.type === 'success') {
    clearMessage();
  }
}

// 입력 오류가 난 칸을 고치면 그 칸을 다시 검사해 안내를 갱신한다.
// 다른 칸의 입력 오류나 저장 실패 안내는 그대로 둔다.
function recheckAfterEdit(field) {
  dismissSuccess();
  if (messageState?.type !== 'field' || messageState.key !== fieldKey(field)) {
    return;
  }
  const check = fieldCheckers[messageState.key];
  const error = check ? check() : null;
  if (error) {
    showFieldError(error, { focus: false });
  } else {
    clearMessage();
  }
}

function updateFormState() {
  const isEditing = editingId !== null;
  formFields.disabled = isSaving;
  submitButton.disabled = isSaving || loadState !== 'ready';
  if (isSaving) {
    submitButton.textContent = '저장하는 중…';
  } else if (loadState === 'loading') {
    submitButton.textContent = '기록을 불러오는 중…';
  } else if (loadState === 'error') {
    submitButton.textContent = '기록을 불러온 뒤 추가할 수 있어요';
  } else {
    submitButton.textContent = isEditing ? '수정 내용 저장' : '노트에 추가하기';
  }

  // 수정 모드 표시
  formCard.classList.toggle('is-editing', isEditing);
  formTitleText.textContent = isEditing ? '복습 기록 고치기' : '복습 계획 적기';
  editBanner.hidden = !isEditing;
  editTarget.textContent = isEditing ? `${editingOriginal.subject} · ${editingOriginal.content}` : '';
  cancelEditButton.hidden = !isEditing;
  cancelEditButton.disabled = isSaving;
}

// ---------- 달력 ----------

// 달력 건수는 아직 완료하지 않은 복습만 센다.
function countByDate() {
  const counts = new Map();
  reviewItems
    .filter((item) => !item.isDone)
    .forEach((item) => counts.set(item.dueDate, (counts.get(item.dueDate) || 0) + 1));
  return counts;
}

function createDayButton(key, day, count) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'day';
  button.dataset.date = key;

  const number = document.createElement('span');
  number.className = 'day-number';
  number.textContent = day;
  button.append(number);

  let label = formatShortDate(key);
  if (key === todayKey) {
    button.classList.add('is-today');
    button.setAttribute('aria-current', 'date');
    label += ', 오늘';
  }
  if (count > 0) {
    button.classList.add('has-items');
    const badge = document.createElement('span');
    badge.className = 'day-count';
    badge.textContent = count;
    // 아주 좁은 화면에서는 CSS로 '개'를 숨기고 숫자만 보인다.
    const unit = document.createElement('span');
    unit.className = 'count-unit';
    unit.textContent = '개';
    badge.append(unit);
    button.append(badge);
    label += `, 남은 복습 ${count}개`;
  }
  if (key === selectedDate) {
    button.classList.add('is-selected');
  }
  button.setAttribute('aria-pressed', String(key === selectedDate));
  button.setAttribute('aria-label', label);
  button.disabled = loadState !== 'ready';

  button.addEventListener('click', () => {
    selectedDate = key;
    hideListMessage();
    render();
  });
  return button;
}

function renderCalendar() {
  calendarTitle.textContent = `${viewYear}년 ${viewMonth + 1}월`;
  calendarCard.classList.toggle('is-waiting', loadState !== 'ready');

  const counts = countByDate();
  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    const blank = document.createElement('span');
    blank.className = 'day-blank';
    cells.push(blank);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
    cells.push(createDayButton(key, day, counts.get(key) || 0));
  }
  calendarGrid.replaceChildren(...cells);
}

function moveMonth(offset) {
  const target = new Date(viewYear, viewMonth + offset, 1);
  viewYear = target.getFullYear();
  viewMonth = target.getMonth();
  selectedDate = null;
  hideListMessage();
  render();
}

// ---------- 목록 ----------

function byDueDate(a, b) {
  return a.dueDate.localeCompare(b.dueDate) || a.id - b.id;
}

// 사용자 입력은 모두 textContent로 넣어 일반 텍스트로만 표시한다.
function createItemElement(item) {
  const li = document.createElement('li');
  li.className = item.isDone ? 'review-item is-done' : 'review-item';
  li.dataset.itemId = item.id;
  if (item.id === editingId) {
    li.classList.add('is-editing');
  }

  const top = document.createElement('div');
  top.className = 'item-top';

  const tags = document.createElement('span');
  tags.className = 'item-tags';

  const subject = document.createElement('span');
  subject.className = stickerClass(item.subject);
  subject.textContent = item.subject;
  tags.append(subject);

  if (item.isDone) {
    const stamp = document.createElement('span');
    stamp.className = 'done-stamp';
    stamp.textContent = '✓ 완료';
    tags.append(stamp);
  }
  if (item.id === editingId) {
    const editing = document.createElement('span');
    editing.className = 'editing-stamp';
    editing.textContent = '✎ 수정 중';
    tags.append(editing);
  }

  const date = document.createElement('span');
  date.className = 'item-date';
  date.textContent = `복습 예정일 ${formatFullDate(item.dueDate)}`;

  top.append(tags, date);

  const content = document.createElement('p');
  content.className = 'item-content';
  content.textContent = item.content;

  li.append(top, content);

  if (item.memo !== '') {
    const memo = document.createElement('p');
    memo.className = 'item-memo';
    memo.textContent = item.memo;
    li.append(memo);
  }

  li.append(createItemActions(item));
  return li;
}

function createActionButton(className, text, action, itemId) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.dataset.action = action;
  button.dataset.itemId = itemId;
  return button;
}

// 항목 아래 버튼 줄: 평소에는 수정·삭제·완료, 삭제 확인 중에는 확인 질문과 삭제·취소
function createItemActions(item) {
  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (confirmingDeleteId === item.id) {
    actions.classList.add('is-confirming');
    const question = document.createElement('p');
    question.className = 'confirm-text';
    question.textContent = '이 복습 기록을 삭제할까요? 삭제하면 되돌릴 수 없어요.';

    const buttons = document.createElement('div');
    buttons.className = 'confirm-buttons';
    const confirmButton = createActionButton('btn btn-danger btn-small', '삭제', 'confirm-delete', item.id);
    const cancelButton = createActionButton('btn btn-soft btn-small', '취소', 'cancel-delete', item.id);
    confirmButton.addEventListener('click', () => confirmDelete(item.id));
    cancelButton.addEventListener('click', cancelDelete);
    [confirmButton, cancelButton].forEach((button) => {
      button.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          cancelDelete();
        }
      });
    });
    buttons.append(confirmButton, cancelButton);
    actions.append(question, buttons);
    return actions;
  }

  const isBusy = pendingIds.has(item.id) || deletingIds.has(item.id);
  const tools = document.createElement('span');
  tools.className = 'item-tools';

  const editButton = createActionButton('btn btn-text', '수정', 'edit', item.id);
  editButton.disabled = isBusy;
  editButton.setAttribute('aria-label', `${item.content}: 수정`);
  editButton.addEventListener('click', () => startEdit(item.id));

  const deleteButton = createActionButton('btn btn-text btn-text-danger', '삭제', 'delete', item.id);
  // 수정 중인 항목은 먼저 수정을 끝내거나 취소해야 삭제할 수 있다.
  deleteButton.disabled = isBusy || item.id === editingId;
  deleteButton.title = item.id === editingId ? '수정 중인 기록은 수정을 취소한 뒤 삭제할 수 있어요.' : '';
  deleteButton.setAttribute('aria-label', `${item.content}: 삭제`);
  deleteButton.addEventListener('click', () => requestDelete(item.id));

  tools.append(editButton, deleteButton);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = item.isDone ? 'btn btn-soft btn-toggle' : 'btn btn-outline btn-toggle';
  toggle.dataset.id = item.id;
  toggle.disabled = isBusy;
  if (deletingIds.has(item.id)) {
    toggle.textContent = '삭제하는 중…';
  } else if (pendingIds.has(item.id)) {
    toggle.textContent = '저장하는 중…';
  } else {
    toggle.textContent = item.isDone ? '미완료로 되돌리기' : '✓ 복습 완료';
  }
  toggle.setAttribute('aria-label', `${item.content}: ${item.isDone ? '미완료로 되돌리기' : '복습 완료로 표시'}`);
  toggle.addEventListener('click', () => toggleDone(item.id));

  actions.append(tools, toggle);
  return actions;
}

function matchesStatus(item) {
  if (statusFilter === 'todo') {
    return !item.isDone;
  }
  if (statusFilter === 'done') {
    return item.isDone;
  }
  return true;
}

// 빈 목록일 때 날짜 범위와 완료 상태에 맞는 안내 문구
function emptyText(itemsInScope) {
  if (reviewItems.length === 0) {
    return '아직 등록된 복습 항목이 없어요. 공부 노트에 첫 복습 계획을 적어 보세요.';
  }
  const where = selectedDate === null ? '' : `${formatShortDate(selectedDate)}에는 `;
  if (itemsInScope.length === 0) {
    return `${formatShortDate(selectedDate)}에는 복습 일정이 없어요.`;
  }
  if (statusFilter === 'todo') {
    return `${where}남은 복습이 없어요. 완료한 복습은 ‘완료’에서 볼 수 있어요.`;
  }
  return `${where}완료한 복습이 아직 없어요.`;
}

function showListMessage(message, isError) {
  listMessage.textContent = message;
  listMessage.classList.toggle('is-error', isError);
  listMessage.hidden = false;
}

function hideListMessage() {
  listMessage.hidden = true;
  listMessage.textContent = '';
}

// 불러오는 중이거나 실패했을 때는 빈 목록 대신 상태 안내를 보여 준다.
function renderLoadStatus() {
  const isReady = loadState === 'ready';
  loadStatus.hidden = isReady;
  loadStatus.classList.toggle('is-error', loadState === 'error');
  retryButton.hidden = loadState !== 'error';
  if (loadState === 'loading') {
    loadStatusText.textContent = '저장된 복습 기록을 불러오는 중이에요…';
  } else if (loadState === 'error') {
    loadStatusText.textContent = `복습 기록을 불러오지 못했어요. ${loadErrorMessage}`;
  }
  return isReady;
}

function renderList() {
  const isReady = renderLoadStatus();
  statusButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.status === statusFilter));
    button.disabled = !isReady;
  });

  if (!isReady) {
    listTitle.textContent = '모든 날짜의 복습';
    itemCount.hidden = true;
    showAllButton.disabled = true;
    emptyMessage.hidden = true;
    list.replaceChildren();
    return;
  }

  // 날짜 범위(모든 날짜 / 선택한 날짜)와 완료 상태를 따로 적용한다.
  const itemsInScope = selectedDate === null
    ? reviewItems
    : reviewItems.filter((item) => item.dueDate === selectedDate);
  const visibleItems = itemsInScope.filter(matchesStatus).sort(byDueDate);

  listTitle.textContent = selectedDate === null ? '모든 날짜의 복습' : `${formatShortDate(selectedDate)} 복습`;
  itemCount.hidden = false;
  itemCount.textContent = `${STATUS_LABELS[statusFilter]} ${visibleItems.length}개`;
  showAllButton.disabled = selectedDate === null;

  if (visibleItems.length === 0) {
    emptyMessage.textContent = emptyText(itemsInScope);
  }
  emptyMessage.hidden = visibleItems.length > 0;

  list.replaceChildren(...visibleItems.map(createItemElement));
}

// 달력과 목록은 같은 reviewItems로 함께 다시 그린다.
function render() {
  renderCalendar();
  renderList();
  updateFormState();
}

// ---------- 불러오기와 저장 ----------

async function loadItems() {
  loadState = 'loading';
  render();
  try {
    const data = await requestJson('/api/items');
    reviewItems = data.items;
    subjects = collectSubjects(reviewItems);
    renderSubjectOptions();
    loadState = 'ready';
  } catch (error) {
    loadErrorMessage = error.message;
    loadState = 'error';
  }
  render();
}

// DB 변경에 성공한 경우에만 화면의 완료 상태를 바꾼다. 실패하면 이전 상태 그대로 두고 안내한다.
async function toggleDone(id) {
  const item = reviewItems.find((entry) => entry.id === id);
  if (!item || pendingIds.has(id) || deletingIds.has(id)) {
    return;
  }
  const nextDone = !item.isDone;
  pendingIds.add(id);
  hideListMessage();
  renderList();

  try {
    const data = await requestJson(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isDone: nextDone }),
    });
    reviewItems = reviewItems.map((entry) => (entry.id === id ? data.item : entry));
    showListMessage(
      data.item.isDone
        ? '복습을 완료했어요. ‘완료’ 목록에서 다시 볼 수 있어요.'
        : '미완료로 되돌렸어요. ‘미완료’ 목록에서 다시 볼 수 있어요.',
      false,
    );
  } catch (error) {
    showListMessage(`완료 상태를 바꾸지 못했어요. ${error.message}`, true);
  } finally {
    pendingIds.delete(id);
    render();
    // 항목이 목록에서 사라졌으면 결과 안내로 초점을 옮긴다.
    (list.querySelector(`[data-id="${id}"]`) || listMessage).focus();
  }
}

// ---------- 수정 ----------

function clearForm() {
  newSubjectInput.value = '';
  contentInput.value = '';
  dueDateInput.value = '';
  memoInput.value = '';
}

// 새 항목 작성 중이거나, 수정 중에 원래 내용과 달라진 값이 있으면 true
function hasUnsavedInput() {
  const subject = getSubjectValue();
  const content = contentInput.value.trim();
  const dueDate = dueDateInput.value;
  const memo = memoInput.value.trim();
  if (editingId === null) {
    return subject !== '' || content !== '' || dueDate !== '' || memo !== '' || dueDateInput.validity.badInput;
  }
  return subject !== editingOriginal.subject || content !== editingOriginal.content
    || dueDate !== editingOriginal.dueDate || memo !== editingOriginal.memo;
}

// 입력 노트를 수정 모드로 바꾸고 기존 값을 채운다.
function startEdit(id) {
  const item = reviewItems.find((entry) => entry.id === id);
  if (!item || isSaving) {
    return;
  }
  if (editingId === id) {
    contentInput.focus();
    return;
  }
  if (hasUnsavedInput() && !window.confirm('작성 중인 내용이 있어요. 지우고 이 기록을 수정할까요?')) {
    return;
  }

  editingId = id;
  editingOriginal = { ...item };
  confirmingDeleteId = null;
  clearMessage();
  clearForm();
  renderSubjectOptions(SUBJECT_PREFIX + item.subject);
  contentInput.value = item.content;
  dueDateInput.value = item.dueDate;
  memoInput.value = item.memo;
  render();

  formCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  contentInput.focus({ preventScroll: true });
}

function exitEditMode() {
  editingId = null;
  editingOriginal = null;
}

// 수정 취소: DB에 아무것도 보내지 않고 입력 노트만 새 항목 추가 상태로 되돌린다.
function cancelEdit() {
  if (isSaving || editingId === null) {
    return;
  }
  const id = editingId;
  exitEditMode();
  clearForm();
  clearMessage();
  renderSubjectOptions();
  render();
  const editButton = list.querySelector(`[data-action="edit"][data-item-id="${id}"]`);
  (editButton || (subjects.length > 0 ? subjectSelect : newSubjectInput)).focus();
}

// ---------- 삭제 ----------

function requestDelete(id) {
  if (pendingIds.has(id) || deletingIds.has(id) || id === editingId) {
    return;
  }
  confirmingDeleteId = id;
  hideListMessage();
  renderList();
  // 실수로 지우지 않도록 '취소'에 먼저 초점을 둔다.
  list.querySelector(`[data-action="cancel-delete"][data-item-id="${id}"]`)?.focus();
}

function cancelDelete() {
  const id = confirmingDeleteId;
  confirmingDeleteId = null;
  renderList();
  list.querySelector(`[data-action="delete"][data-item-id="${id}"]`)?.focus();
}

// DB에서 삭제에 성공한 경우에만 화면에서 뺀다. 실패하면 기록을 그대로 두고 안내한다.
async function confirmDelete(id) {
  confirmingDeleteId = null;
  deletingIds.add(id);
  hideListMessage();
  renderList();

  try {
    await requestJson(`/api/items/${id}`, { method: 'DELETE' });
    reviewItems = reviewItems.filter((entry) => entry.id !== id);
    subjects = collectSubjects(reviewItems);
    // 작성 중인 입력의 과목 선택은 남은 과목이면 그대로 둔다.
    renderSubjectOptions(subjectSelect.value);
    showListMessage('복습 기록을 삭제했어요.', false);
  } catch (error) {
    showListMessage(`삭제하지 못했어요. ${error.message}`, true);
  } finally {
    deletingIds.delete(id);
    render();
    (list.querySelector(`[data-action="delete"][data-item-id="${id}"]`) || listMessage).focus();
  }
}

// ---------- 추가·수정 저장 ----------

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isSaving || loadState !== 'ready') {
    return;
  }
  clearMessage();

  const subject = getSubjectValue();
  const content = contentInput.value.trim();
  const dueDate = dueDateInput.value;
  const memo = memoInput.value.trim();

  const error = validate();
  if (error) {
    showFieldError(error);
    return;
  }

  isSaving = true;
  updateFormState();

  // 수정 모드면 PUT으로 해당 항목을, 아니면 POST로 새 항목을 저장한다.
  const editId = editingId;
  let item;
  try {
    const data = await requestJson(editId === null ? '/api/items' : `/api/items/${editId}`, {
      method: editId === null ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, content, dueDate, memo }),
    });
    item = data.item;
  } catch (saveError) {
    // 저장에 실패하면 입력 내용과 선택한 과목을 그대로 두고 안내만 한다.
    isSaving = false;
    updateFormState();
    showSaveError(saveError, editId === null ? '저장하지 못했어요.' : '수정하지 못했어요.');
    return;
  }

  // DB 저장에 성공한 경우에만 화면 데이터에 넣고 폼을 비운다.
  isSaving = false;
  if (editId === null) {
    reviewItems.push(item);
    if (!subjects.includes(item.subject)) {
      subjects.push(item.subject);
    }
    // 방금 추가한 항목은 미완료이므로 미완료 목록에서 보이게 한다.
    statusFilter = 'todo';
  } else {
    reviewItems = reviewItems.map((entry) => (entry.id === item.id ? item : entry));
    // 과목을 바꿨을 수 있으므로 저장된 기록에서 과목 선택지를 다시 모은다.
    subjects = collectSubjects(reviewItems);
    // 수정한 항목이 지금 고른 완료 상태 목록에 없으면 그 항목이 보이는 상태로 바꾼다.
    if (!matchesStatus(item)) {
      statusFilter = item.isDone ? 'done' : 'todo';
    }
    exitEditMode();
  }

  // 방금 저장한 항목의 예정일로 달력을 옮기고 그 날짜를 선택한다.
  const { year, month } = parseDateKey(item.dueDate);
  viewYear = year;
  viewMonth = month;
  selectedDate = item.dueDate;
  hideListMessage();

  clearForm();
  renderSubjectOptions();
  render();
  if (editId !== null) {
    const updated = list.querySelector(`li[data-item-id="${item.id}"]`);
    updated?.classList.add('is-updated');
    updated?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  showSuccess(editId === null ? '복습 계획을 저장했어요.' : '수정 내용을 저장했어요.');
  // 수정 후에는 갱신된 항목이 보이도록 커서를 옮길 때 화면을 움직이지 않는다.
  (subjects.length > 0 ? subjectSelect : newSubjectInput).focus({ preventScroll: editId !== null });
});

cancelEditButton.addEventListener('click', cancelEdit);

subjectSelect.addEventListener('change', () => {
  updateSubjectFields();
  recheckAfterEdit(subjectSelect);
  if (subjectSelect.value === NEW_SUBJECT) {
    newSubjectInput.focus();
  }
});

// 과목 선택칸을 클릭하거나, 어느 칸에서든 키보드로 고르기·입력을 시작하면 성공 문구를 지운다.
// 칸 이동(Tab)이나 조합키만 누른 경우는 편집으로 보지 않는다.
const NON_EDIT_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape', 'CapsLock']);

subjectSelect.addEventListener('pointerdown', dismissSuccess);
checkedFields.forEach((field) => {
  field.addEventListener('keydown', (event) => {
    if (!NON_EDIT_KEYS.has(event.key)) {
      dismissSuccess();
    }
  });
});

// 값이 바뀌면 오류가 났던 칸인지 다시 검사한다. 날짜 선택기는 change로만 알리는 브라우저도 있어 둘 다 듣는다.
[newSubjectInput, contentInput, dueDateInput, memoInput].forEach((input) => {
  input.addEventListener('input', () => recheckAfterEdit(input));
});
dueDateInput.addEventListener('change', () => recheckAfterEdit(dueDateInput));

prevMonthButton.addEventListener('click', () => moveMonth(-1));
nextMonthButton.addEventListener('click', () => moveMonth(1));

showAllButton.addEventListener('click', () => {
  selectedDate = null;
  hideListMessage();
  render();
});

statusButtons.forEach((button) => {
  button.addEventListener('click', () => {
    statusFilter = button.dataset.status;
    hideListMessage();
    renderList();
  });
});

retryButton.addEventListener('click', loadItems);

renderSubjectOptions();
loadItems();
