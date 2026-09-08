// ============================================
// 作業登記系統 v3.0 - 前端應用程式
// ============================================

// ============================================
// 全域變數
// ============================================

let GAS_URL = localStorage.getItem('gas_url') || '';
let API_TOKEN = localStorage.getItem('api_token') || '';
let loginPassword = localStorage.getItem('login_password') || '1234';

// 當前選擇
let currentYear = '';
let currentClass = '';
let currentSubject = '';
let currentUnit = '';
let currentAssignmentId = '';

// 學生資料
let students = [];
let records = {};

// 等第對應分數
const GRADE_MAP = {
  'A+': 100, 'A': 95, 'A-': 90,
  'B+': 85,  'B': 80, 'B-': 75,
  'C+': 70,  'C': 65, 'C-': 60,
  'D+': 55,  'D': 50, 'D-': 45,
  'E': 40
};

const GRADE_OPTIONS = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E'];

// ============================================
// 初始化
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // 載入設定
  document.getElementById('gas-url').value = GAS_URL;
  document.getElementById('gas-token').value = API_TOKEN;
  
  // 載入年度列表
  loadYears();
  
  // 檢查鎖屏
  const isLocked = sessionStorage.getItem('is_locked');
  if (isLocked === 'false') {
    document.getElementById('lock-screen').style.display = 'none';
  }
  
  // 鎖屏 Enter 鍵
  document.getElementById('lock-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') checkPassword();
  });
});

// ============================================
// 工具函數
// ============================================

function showLoading(msg = '載入中…') {
  document.getElementById('loading-msg').textContent = msg;
  document.getElementById('loading-overlay').classList.add('show');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('show');
}

function showToast(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

function openModal(id) {
  document.getElementById(id).classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

// ============================================
// API 請求
// ============================================

async function apiRequest(params) {
  if (!GAS_URL || !API_TOKEN) {
    showToast('請先設定 GAS 網址和 Token');
    return null;
  }
  
  const url = new URL(GAS_URL);
  url.searchParams.set('action', params.action);
  url.searchParams.set('token', API_TOKEN);
  
  if (params.method === 'POST') {
    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        mode: 'no-cors',
        body: JSON.stringify({ ...params, token: API_TOKEN })
      });
      // no-cors 模式下無法取得回應，假設成功
      return { success: true };
    } catch (error) {
      console.error('API Error:', error);
      showToast('請求失敗：' + error.message);
      return null;
    }
  } else {
    Object.entries(params).forEach(([key, value]) => {
      if (key !== 'action' && value) {
        url.searchParams.set(key, value);
      }
    });
    
    try {
      const response = await fetch(url.toString());
      return await response.json();
    } catch (error) {
      console.error('API Error:', error);
      showToast('請求失敗：' + error.message);
      return null;
    }
  }
}

// ============================================
// 鎖屏功能
// ============================================

function checkPassword() {
  const input = document.getElementById('lock-input');
  const password = input.value;
  
  if (password === loginPassword) {
    document.getElementById('lock-screen').style.display = 'none';
    sessionStorage.setItem('is_locked', 'false');
    input.value = '';
    input.classList.remove('error');
  } else {
    input.classList.add('error');
    setTimeout(() => input.classList.remove('error'), 300);
    input.value = '';
  }
}

// ============================================
// 標籤頁切換
// ============================================

function switchTab(tabName) {
  // 更新標籤
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  event.currentTarget.classList.add('active');
  
  // 更新頁面
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  document.getElementById(`page-${tabName}`).classList.add('active');
  
  // 載入對應資料
  if (tabName === 'input') {
    loadYears();
  } else if (tabName === 'report') {
    loadReportYears();
  } else if (tabName === 'manage') {
    loadManageYears();
  }
}

// ============================================
// 登記頁面 - 年度/班級/科目/單元選擇
// ============================================

async function loadYears() {
  const data = await apiRequest({ action: 'getYears' });
  if (!data || !data.success) return;
  
  const select = document.getElementById('sel-year');
  select.innerHTML = '<option value="">— 請選擇學年度 —</option>';
  
  data.years.forEach(year => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year + ' 學年度';
    select.appendChild(option);
  });
}

async function onYearChange() {
  currentYear = document.getElementById('sel-year').value;
  
  // 重置下級選項
  resetSelect('sel-class', '— 請先選學年度 —');
  resetSelect('sel-subject', '— 請先選班級 —');
  resetSelect('sel-unit', '— 請先選科目 —');
  
  if (!currentYear) return;
  
  const data = await apiRequest({ action: 'getClasses', year: currentYear });
  if (!data || !data.success) return;
  
  const select = document.getElementById('sel-class');
  data.classes.forEach(cls => {
    const option = document.createElement('option');
    option.value = cls;
    option.textContent = cls;
    select.appendChild(option);
  });
}

async function onClassChange() {
  currentClass = document.getElementById('sel-class').value;
  
  // 重置下級選項
  resetSelect('sel-subject', '— 請先選班級 —');
  resetSelect('sel-unit', '— 請先選科目 —');
  
  if (!currentClass) return;
  
  const data = await apiRequest({ action: 'getSubjects', year: currentYear, class_name: currentClass });
  if (!data || !data.success) return;
  
  const select = document.getElementById('sel-subject');
  data.subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  });
}

async function onSubjectChange() {
  currentSubject = document.getElementById('sel-subject').value;
  
  // 重置下級選項
  resetSelect('sel-unit', '— 請先選科目 —');
  
  if (!currentSubject) return;
  
  const data = await apiRequest({ action: 'getUnits', year: currentYear, class_name: currentClass, subject: currentSubject });
  if (!data || !data.success) return;
  
  const select = document.getElementById('sel-unit');
  data.units.forEach(unit => {
    const option = document.createElement('option');
    option.value = unit.assignment_id;
    option.textContent = unit.unit;
    select.appendChild(option);
  });
  
  // 監聽單元選擇
  document.getElementById('sel-unit').addEventListener('change', onUnitChange);
}

async function onUnitChange() {
  currentAssignmentId = document.getElementById('sel-unit').value;
  
  if (!currentAssignmentId) {
    hideStudentCard();
    return;
  }
  
  await loadStudents();
  await loadRecords();
  showStudentCard();
}

function resetSelect(id, placeholder) {
  const select = document.getElementById(id);
  select.innerHTML = `<option value="">${placeholder}</option>`;
}

// ============================================
// 登記頁面 - 學生名單與紀錄
// ============================================

async function loadStudents() {
  const data = await apiRequest({ action: 'getStudents', year: currentYear, class_name: currentClass });
  if (!data || !data.success) return;
  
  students = data.students;
}

async function loadRecords() {
  const data = await apiRequest({ action: 'getRecords', assignment_id: currentAssignmentId });
  if (!data || !data.success) return;
  
  records = {};
  data.records.forEach(r => {
    records[r.seat_num] = {
      status: r.status,
      score: r.score,
      note: r.note
    };
  });
}

function showStudentCard() {
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('student-card').style.display = 'block';
  document.getElementById('progress-card').style.display = 'block';
  document.getElementById('grade-info-card').style.display = 'block';
  
  renderStudentList();
  updateProgress();
}

function hideStudentCard() {
  document.getElementById('empty-state').style.display = 'block';
  document.getElementById('student-card').style.display = 'none';
  document.getElementById('progress-card').style.display = 'none';
  document.getElementById('grade-info-card').style.display = 'none';
}

function renderStudentList() {
  const container = document.getElementById('student-list');
  container.innerHTML = '';
  
  students.forEach(student => {
    const record = records[student.seat_num] || {};
    const status = record.status || '';
    const score = record.score || '';
    const note = record.note || '';
    
    const row = document.createElement('div');
    row.className = `student-row ${status ? 'selected-' + status : ''}`;
    row.innerHTML = `
      <div class="student-num">${student.seat_num}</div>
      <div class="student-name">${student.name}</div>
      <div class="status-btns">
        <button class="status-btn ${status === 'submitted' ? 'active-submitted' : ''}" 
                onclick="setStatus('${student.seat_num}', 'submitted')" title="已繳">✅</button>
        <button class="status-btn ${status === 'late' ? 'active-late' : ''}" 
                onclick="setStatus('${student.seat_num}', 'late')" title="補交">⏰</button>
        <button class="status-btn ${status === 'missing' ? 'active-missing' : ''}" 
                onclick="setStatus('${student.seat_num}', 'missing')" title="缺交">❌</button>
        <button class="status-btn ${status === 'exempt' ? 'active-exempt' : ''}" 
                onclick="setStatus('${student.seat_num}', 'exempt')" title="免交">〇</button>
      </div>
      <select class="grade-select" id="grade-${student.seat_num}" 
              onchange="setGrade('${student.seat_num}', this.value)"
              ${(status !== 'submitted' && status !== 'late') ? 'disabled' : ''}>
        <option value="">等第</option>
        ${GRADE_OPTIONS.map(g => `<option value="${g}" ${score === GRADE_MAP[g] ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
      <div class="score-display" id="score-${student.seat_num}">${score || '-'}</div>
    `;
    
    container.appendChild(row);
  });
}

function setStatus(seatNum, status) {
  // 初始化紀錄
  if (!records[seatNum]) {
    records[seatNum] = { status: '', score: '', note: '' };
  }
  
  // 如果點擊相同狀態，則取消
  if (records[seatNum].status === status) {
    records[seatNum] = { status: '', score: '', note: '' };
  } else {
    records[seatNum].status = status;
    
    // 根據狀態設定分數
    if (status === 'missing') {
      records[seatNum].score = 0;
      records[seatNum].note = '';
    } else if (status === 'exempt') {
      records[seatNum].score = '免交';
      records[seatNum].note = '';
    } else if (status === 'late') {
      records[seatNum].note = '補交';
      // 保持現有分數或等待選擇等第
    } else if (status === 'submitted') {
      records[seatNum].note = '';
    }
  }
  
  renderStudentList();
  updateProgress();
}

function setGrade(seatNum, grade) {
  if (!records[seatNum]) {
    records[seatNum] = { status: 'submitted', score: '', note: '' };
  }
  
  if (grade && GRADE_MAP[grade] !== undefined) {
    records[seatNum].score = GRADE_MAP[grade];
  } else {
    records[seatNum].score = '';
  }
  
  // 更新分數顯示
  document.getElementById(`score-${seatNum}`).textContent = records[seatNum].score || '-';
}

function updateProgress() {
  let submitted = 0, late = 0, missing = 0, total = students.length;
  
  students.forEach(s => {
    const record = records[s.seat_num];
    if (record && record.status) {
      if (record.status === 'submitted') submitted++;
      else if (record.status === 'late') late++;
      else if (record.status === 'missing') missing++;
    }
  });
  
  const registered = submitted + late + missing;
  const percent = total > 0 ? Math.round((registered / total) * 100) : 0;
  
  document.getElementById('prog-label-left').textContent = `已登記 ${registered} 人`;
  document.getElementById('prog-label-right').textContent = `${percent}%`;
  
  // 更新進度條
  const submittedPercent = total > 0 ? (submitted / total * 100) : 0;
  const latePercent = total > 0 ? (late / total * 100) : 0;
  const missingPercent = total > 0 ? (missing / total * 100) : 0;
  
  document.getElementById('prog-submitted').style.width = submittedPercent + '%';
  document.getElementById('prog-late').style.width = latePercent + '%';
  document.getElementById('prog-missing').style.width = missingPercent + '%';
}

// ============================================
// 登記頁面 - 批次操作
// ============================================

function batchSet(status) {
  students.forEach(s => {
    if (!records[s.seat_num]) {
      records[s.seat_num] = { status: '', score: '', note: '' };
    }
    
    if (status === '') {
      // 清除
      records[s.seat_num] = { status: '', score: '', note: '' };
    } else {
      records[s.seat_num].status = status;
      
      if (status === 'missing') {
        records[s.seat_num].score = 0;
        records[s.seat_num].note = '';
      } else if (status === 'exempt') {
        records[s.seat_num].score = '免交';
        records[s.seat_num].note = '';
      } else if (status === 'submitted') {
        records[s.seat_num].note = '';
      }
    }
  });
  
  renderStudentList();
  updateProgress();
}

function clearAll() {
  if (!confirm('確定要清除所有登記紀錄嗎？')) return;
  
  students.forEach(s => {
    records[s.seat_num] = { status: '', score: '', note: '' };
  });
  
  renderStudentList();
  updateProgress();
}

// ============================================
// 登記頁面 - 送出資料
// ============================================

async function submitData() {
  const recordsToSave = [];
  
  students.forEach(s => {
    const record = records[s.seat_num];
    if (record && record.status) {
      recordsToSave.push({
        assignment_id: currentAssignmentId,
        year: currentYear,
        class_name: currentClass,
        seat_num: s.seat_num,
        status: record.status,
        score: record.score,
        note: record.note
      });
    }
  });
  
  if (recordsToSave.length === 0) {
    showToast('沒有需要儲存的紀錄');
    return;
  }
  
  showLoading('儲存中…');
  
  const result = await apiRequest({
    action: 'saveBulk',
    method: 'POST',
    records: recordsToSave
  });
  
  hideLoading();
  
  if (result && result.success) {
    showToast('儲存成功！');
  } else {
    showToast('儲存失敗，請稍後再試');
  }
}

// ============================================
// 報表頁面
// ============================================

let reportMode = 'single';

function setReportMode(mode) {
  reportMode = mode;
  
  document.getElementById('report-mode-single').className = mode === 'single' ? 'btn btn-primary' : 'btn btn-outline';
  document.getElementById('report-mode-overview').className = mode === 'overview' ? 'btn btn-primary' : 'btn btn-outline';
  
  document.getElementById('report-panel-single').style.display = mode === 'single' ? 'block' : 'none';
  document.getElementById('report-panel-overview').style.display = mode === 'overview' ? 'block' : 'none';
}

async function loadReportYears() {
  const data = await apiRequest({ action: 'getYears' });
  if (!data || !data.success) return;
  
  ['r-sel-year', 'ov-sel-year'].forEach(id => {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">— 請選擇學年度 —</option>';
    data.years.forEach(year => {
      const option = document.createElement('option');
      option.value = year;
      option.textContent = year + ' 學年度';
      select.appendChild(option);
    });
  });
}

async function rOnYearChange() {
  const year = document.getElementById('r-sel-year').value;
  resetSelect('r-sel-class', '— 請先選學年度 —');
  resetSelect('r-sel-subject', '— 請先選班級 —');
  resetSelect('r-sel-unit', '— 請先選科目 —');
  
  if (!year) return;
  
  const data = await apiRequest({ action: 'getClasses', year });
  if (!data || !data.success) return;
  
  const select = document.getElementById('r-sel-class');
  data.classes.forEach(cls => {
    const option = document.createElement('option');
    option.value = cls;
    option.textContent = cls;
    select.appendChild(option);
  });
}

async function rOnClassChange() {
  const year = document.getElementById('r-sel-year').value;
  const cls = document.getElementById('r-sel-class').value;
  resetSelect('r-sel-subject', '— 請先選班級 —');
  resetSelect('r-sel-unit', '— 請先選科目 —');
  
  if (!cls) return;
  
  const data = await apiRequest({ action: 'getSubjects', year, class_name: cls });
  if (!data || !data.success) return;
  
  const select = document.getElementById('r-sel-subject');
  data.subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  });
}

async function rOnSubjectChange() {
  const year = document.getElementById('r-sel-year').value;
  const cls = document.getElementById('r-sel-class').value;
  const subject = document.getElementById('r-sel-subject').value;
  resetSelect('r-sel-unit', '— 請先選科目 —');
  
  if (!subject) return;
  
  const data = await apiRequest({ action: 'getUnits', year, class_name: cls, subject });
  if (!data || !data.success) return;
  
  const select = document.getElementById('r-sel-unit');
  data.units.forEach(unit => {
    const option = document.createElement('option');
    option.value = unit.assignment_id;
    option.textContent = unit.unit;
    select.appendChild(option);
  });
}

async function generateReport() {
  const assignmentId = document.getElementById('r-sel-unit').value;
  if (!assignmentId) {
    showToast('請選擇要查看的作業');
    return;
  }
  
  showLoading('生成報表中…');
  
  const data = await apiRequest({ action: 'getRecords', assignment_id: assignmentId });
  
  hideLoading();
  
  if (!data || !data.success) {
    showToast('無法載入報表資料');
    return;
  }
  
  // 整理資料
  const records = data.records;
  const submitted = records.filter(r => r.status === 'submitted');
  const late = records.filter(r => r.status === 'late');
  const missing = records.filter(r => r.status === 'missing');
  
  const year = document.getElementById('r-sel-year').value;
  const cls = document.getElementById('r-sel-class').value;
  const subject = document.getElementById('r-sel-subject').value;
  const unit = document.getElementById('r-sel-unit').options[document.getElementById('r-sel-unit').selectedIndex].text;
  
  // 更新報表
  document.getElementById('r-title').textContent = `${subject} - ${unit}`;
  document.getElementById('r-meta').textContent = `${year} 學年度 | ${cls}`;
  
  document.getElementById('r-count-submitted').textContent = submitted.length;
  document.getElementById('r-count-late').textContent = late.length;
  document.getElementById('r-count-missing').textContent = missing.length;
  document.getElementById('r-count-total').textContent = records.length;
  
  // 渲染名單
  renderReportList('r-submitted-list', submitted, '✅');
  renderReportList('r-late-list', late, '⏰');
  renderReportList('r-missing-list', missing, '❌');
  
  // 顯示/隱藏區塊
  document.getElementById('r-submitted-section').style.display = submitted.length > 0 ? 'block' : 'none';
  document.getElementById('r-late-section').style.display = late.length > 0 ? 'block' : 'none';
  document.getElementById('r-missing-section').style.display = missing.length > 0 ? 'block' : 'none';
  
  // 繳交率
  const total = records.length;
  const rate = total > 0 ? Math.round(((submitted.length + late.length) / total) * 100) : 0;
  document.getElementById('r-footer-left').textContent = `繳交率 ${rate}%`;
  
  // 顯示報表
  document.getElementById('report-output').classList.add('show');
  document.getElementById('download-section').classList.add('show');
}

function renderReportList(containerId, records, icon) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  records.forEach(r => {
    const cell = document.createElement('div');
    cell.className = 'report-student-cell';
    cell.innerHTML = `
      <span class="status-icon">${icon}</span>
      <span>${r.seat_num} ${r.name || ''}</span>
    `;
    container.appendChild(cell);
  });
}

// 全班總覽
async function ovOnYearChange() {
  const year = document.getElementById('ov-sel-year').value;
  resetSelect('ov-sel-class', '— 請先選學年度 —');
  resetSelect('ov-sel-subject', '— 請先選班級 —');
  
  if (!year) return;
  
  const data = await apiRequest({ action: 'getClasses', year });
  if (!data || !data.success) return;
  
  const select = document.getElementById('ov-sel-class');
  data.classes.forEach(cls => {
    const option = document.createElement('option');
    option.value = cls;
    option.textContent = cls;
    select.appendChild(option);
  });
}

async function ovOnClassChange() {
  const year = document.getElementById('ov-sel-year').value;
  const cls = document.getElementById('ov-sel-class').value;
  resetSelect('ov-sel-subject', '— 請先選班級 —');
  
  if (!cls) return;
  
  const data = await apiRequest({ action: 'getSubjects', year, class_name: cls });
  if (!data || !data.success) return;
  
  const select = document.getElementById('ov-sel-subject');
  data.subjects.forEach(subject => {
    const option = document.createElement('option');
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  });
}

async function generateOverview() {
  const year = document.getElementById('ov-sel-year').value;
  const cls = document.getElementById('ov-sel-class').value;
  const subject = document.getElementById('ov-sel-subject').value;
  
  if (!year || !cls || !subject) {
    showToast('請完整選擇學年度、班級和科目');
    return;
  }
  
  showLoading('載入總覽中…');
  
  const data = await apiRequest({ action: 'getOverview', year, class_name: cls, subject });
  
  hideLoading();
  
  if (!data || !data.success) {
    showToast('無法載入總覽資料');
    return;
  }
  
  // 渲染總覽表格
  const container = document.getElementById('overview-table-wrap');
  let html = '<table class="preview-table"><thead><tr><th>座號</th><th>姓名</th>';
  
  // 表頭：作業數量
  for (let i = 1; i <= data.assignment_count; i++) {
    html += `<th>作業${i}</th>`;
  }
  html += '</tr></thead><tbody>';
  
  // 資料列
  data.overview.forEach(student => {
    html += `<tr><td>${student.seat_num}</td><td>${student.name}</td>`;
    student.records.forEach(r => {
      const icon = r.status === 'submitted' ? '✅' : 
                   r.status === 'late' ? '⏰' : 
                   r.status === 'missing' ? '❌' : 
                   r.status === 'exempt' ? '〇' : '-';
      html += `<td>${icon} ${r.score || ''}</td>`;
    });
    html += '</tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
  
  document.getElementById('overview-output').style.display = 'block';
}

// 報表下載
function copyReportText() {
  const title = document.getElementById('r-title').textContent;
  const meta = document.getElementById('r-meta').textContent;
  const submitted = document.getElementById('r-count-submitted').textContent;
  const late = document.getElementById('r-count-late').textContent;
  const missing = document.getElementById('r-count-missing').textContent;
  const total = document.getElementById('r-count-total').textContent;
  
  const text = `📊 作業繳交報告
${title}
${meta}

✅ 已繳：${submitted} 人
⏰ 補交：${late} 人
❌ 缺交：${missing} 人
👥 總人數：${total} 人`;
  
  navigator.clipboard.writeText(text).then(() => {
    showToast('已複製到剪貼簿');
  });
}

function downloadImage() {
  const element = document.getElementById('report-output');
  html2canvas(element).then(canvas => {
    const link = document.createElement('a');
    link.download = '作業報表.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

function downloadPDF() {
  showToast('PDF 下載功能開發中');
}

// ============================================
// 班級管理頁面
// ============================================

let manageYear = '';
let manageClass = '';
let newSubjectTags = [];

async function loadManageYears() {
  const data = await apiRequest({ action: 'getYears' });
  if (!data || !data.success) return;
  
  const container = document.getElementById('year-list');
  container.innerHTML = '';
  
  data.years.forEach(year => {
    const item = document.createElement('div');
    item.className = `year-item ${year == manageYear ? 'active' : ''}`;
    item.innerHTML = `
      <span onclick="selectManageYear('${year}')">${year} 學年度</span>
      <span class="year-del" onclick="deleteYear('${year}')">✕</span>
    `;
    container.appendChild(item);
  });
}

function selectManageYear(year) {
  manageYear = year;
  loadManageClasses();
}

async function loadManageClasses() {
  if (!manageYear) return;
  
  const data = await apiRequest({ action: 'getClasses', year: manageYear });
  if (!data || !data.success) return;
  
  const container = document.getElementById('class-grid');
  container.innerHTML = '';
  
  if (data.classes.length === 0) {
    container.innerHTML = `
      <div class="no-class-state">
        <div class="icon">🏫</div>
        <p>尚未建立任何班級<br>點擊上方「＋ 新增班級」開始</p>
      </div>
    `;
    return;
  }
  
  data.classes.forEach(cls => {
    const card = document.createElement('div');
    card.className = `class-card ${cls === manageClass ? 'selected-class' : ''}`;
    card.onclick = () => selectManageClass(cls);
    card.innerHTML = `
      <div class="class-card-header">
        <div class="class-card-name">${cls}</div>
      </div>
      <div class="class-actions">
        <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();editClass('${cls}')">✏️ 編輯</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteClass('${cls}')">🗑 刪除</button>
      </div>
    `;
    container.appendChild(card);
  });
}

function selectManageClass(cls) {
  manageClass = cls;
  loadManageRoster();
  loadManageSubjects();
  
  // 更新選中狀態
  document.querySelectorAll('.class-card').forEach(card => card.classList.remove('selected-class'));
  event.currentTarget.classList.add('selected-class');
}

// 年度管理
function toggleYearForm() {
  const form = document.getElementById('add-year-form');
  form.classList.toggle('show');
  if (form.classList.contains('show')) {
    document.getElementById('new-year-input').focus();
  }
}

async function addYear() {
  const year = document.getElementById('new-year-input').value.trim();
  if (!year) {
    showToast('請輸入學年度');
    return;
  }
  
  const data = await apiRequest({
    action: 'addYear',
    method: 'POST',
    year
  });
  
  if (data && data.success) {
    showToast('新增成功');
    document.getElementById('new-year-input').value = '';
    toggleYearForm();
    loadManageYears();
  } else {
    showToast(data?.error || '新增失敗');
  }
}

async function deleteYear(year) {
  if (!confirm(`確定要刪除 ${year} 學年度嗎？\n此操作將刪除該年度所有班級、學生和紀錄，且無法復原。`)) {
    return;
  }
  
  showLoading('刪除中…');
  
  const data = await apiRequest({
    action: 'deleteYear',
    method: 'POST',
    year
  });
  
  hideLoading();
  
  if (data && data.success) {
    showToast('刪除成功');
    if (manageYear === year) {
      manageYear = '';
      manageClass = '';
    }
    loadManageYears();
  } else {
    showToast('刪除失敗');
  }
}

// 班級管理
function toggleClassForm() {
  const form = document.getElementById('add-class-form');
  form.classList.toggle('show');
  newSubjectTags = [];
  document.getElementById('new-subject-tags').innerHTML = '';
  document.getElementById('new-class-name').value = '';
  document.getElementById('new-subject-input').value = '';
}

function addSubjectTag() {
  const input = document.getElementById('new-subject-input');
  const subject = input.value.trim();
  
  if (!subject) return;
  if (newSubjectTags.includes(subject)) {
    showToast('科目已存在');
    return;
  }
  
  newSubjectTags.push(subject);
  renderSubjectTags('new-subject-tags', newSubjectTags, true);
  input.value = '';
}

function renderSubjectTags(containerId, tags, deletable = false) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  tags.forEach((tag, index) => {
    const item = document.createElement('span');
    item.className = 'tag-item';
    item.innerHTML = `
      ${tag}
      ${deletable ? `<span class="tag-del" onclick="removeSubjectTag(${index}, '${containerId}')">✕</span>` : ''}
    `;
    container.appendChild(item);
  });
}

function removeSubjectTag(index, containerId) {
  if (containerId === 'new-subject-tags') {
    newSubjectTags.splice(index, 1);
    renderSubjectTags(containerId, newSubjectTags, true);
  }
}

async function saveNewClass() {
  const className = document.getElementById('new-class-name').value.trim();
  
  if (!manageYear) {
    showToast('請先選擇學年度');
    return;
  }
  
  if (!className) {
    showToast('請輸入班級名稱');
    return;
  }
  
  showLoading('建立中…');
  
  const data = await apiRequest({
    action: 'addClass',
    method: 'POST',
    year: manageYear,
    class_name: className,
    subjects: newSubjectTags
  });
  
  hideLoading();
  
  if (data && data.success) {
    showToast('班級建立成功');
    toggleClassForm();
    loadManageClasses();
  } else {
    showToast(data?.error || '建立失敗');
  }
}

function editClass(cls) {
  // TODO: 實作編輯功能
  showToast('編輯功能開發中');
}

async function deleteClass(cls) {
  if (!confirm(`確定要刪除 ${cls} 嗎？`)) return;
  
  showLoading('刪除中…');
  
  const data = await apiRequest({
    action: 'deleteClass',
    method: 'POST',
    year: manageYear,
    class_name: cls
  });
  
  hideLoading();
  
  if (data && data.success) {
    showToast('刪除成功');
    if (manageClass === cls) {
      manageClass = '';
    }
    loadManageClasses();
  } else {
    showToast('刪除失敗');
  }
}

// 學生名冊管理
async function loadManageRoster() {
  if (!manageYear || !manageClass) return;
  
  const data = await apiRequest({ action: 'getStudents', year: manageYear, class_name: manageClass });
  if (!data || !data.success) return;
  
  document.getElementById('roster-section').style.display = 'block';
  document.getElementById('roster-class-name').textContent = manageClass;
  document.getElementById('roster-count').textContent = data.students.length + ' 人';
  
  const container = document.getElementById('roster-list');
  container.innerHTML = '';
  
  data.students.forEach(student => {
    const row = document.createElement('div');
    row.className = 'mgmt-student-row';
    row.innerHTML = `
      <div class="student-num">${student.seat_num}</div>
      <div class="student-name">${student.name}</div>
      <button class="del-btn" onclick="deleteStudent('${student.seat_num}')">✕</button>
    `;
    container.appendChild(row);
  });
  
  document.getElementById('current-roster').style.display = data.students.length > 0 ? 'block' : 'none';
  document.getElementById('csv-preview').style.display = 'none';
}

// CSV 上傳
let csvData = [];

function onDragOver(e) {
  e.preventDefault();
  e.currentTarget.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    parseCSV(file);
  } else {
    showToast('請上傳 CSV 檔案');
  }
}

function handleCSV(e) {
  const file = e.target.files[0];
  if (file) parseCSV(file);
}

function parseCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.split('\n').filter(line => line.trim());
    
    // 跳過標題列
    csvData = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(p => p.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        csvData.push({
          seat_num: parts[0].padStart(2, '0'),
          name: parts[1]
        });
      }
    }
    
    // 顯示預覽
    const tbody = document.getElementById('preview-tbody');
    tbody.innerHTML = '';
    
    csvData.slice(0, 5).forEach(student => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${student.seat_num}</td><td>${student.name}</td>`;
      tbody.appendChild(row);
    });
    
    document.getElementById('preview-count').textContent = `共 ${csvData.length} 筆資料`;
    document.getElementById('csv-preview').style.display = 'block';
    document.getElementById('upload-zone').style.display = 'none';
  };
  
  reader.readAsText(file);
}

function cancelCSV() {
  csvData = [];
  document.getElementById('csv-preview').style.display = 'none';
  document.getElementById('upload-zone').style.display = 'block';
  document.getElementById('csv-file-input').value = '';
}

async function confirmCSV() {
  if (csvData.length === 0) {
    showToast('沒有可匯入的資料');
    return;
  }
  
  showLoading('匯入中…');
  
  const data = await apiRequest({
    action: 'importStudents',
    method: 'POST',
    year: manageYear,
    class_name: manageClass,
    students: csvData
  });
  
  hideLoading();
  
  if (data && data.success) {
    showToast(`成功匯入 ${data.imported} 位學生`);
    cancelCSV();
    loadManageRoster();
  } else {
    showToast('匯入失敗');
  }
}

function reupload() {
  document.getElementById('current-roster').style.display = 'none';
  document.getElementById('upload-zone').style.display = 'block';
}

async function deleteStudent(seatNum) {
  if (!confirm(`確定要刪除座號 ${seatNum} 的學生嗎？`)) return;
  
  const data = await apiRequest({
    action: 'deleteStudent',
    method: 'POST',
    year: manageYear,
    class_name: manageClass,
    seat_num: seatNum
  });
  
  if (data && data.success) {
    showToast('刪除成功');
    loadManageRoster();
  } else {
    showToast('刪除失敗');
  }
}

// 科目與單元管理
async function loadManageSubjects() {
  if (!manageYear || !manageClass) return;
  
  const data = await apiRequest({ action: 'getUnits', year: manageYear, class_name: manageClass });
  if (!data || !data.success) return;
  
  const container = document.getElementById('subject-unit-manager');
  container.innerHTML = '';
  
  // 按科目分組
  const subjectMap = {};
  data.units.forEach(unit => {
    if (!subjectMap[unit.subject]) {
      subjectMap[unit.subject] = [];
    }
    subjectMap[unit.subject].push(unit);
  });
  
  Object.entries(subjectMap).forEach(([subject, units]) => {
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
      <div class="subject-header">
        <div class="subject-name">${subject}</div>
        <button class="btn btn-outline btn-sm" onclick="deleteSubject('${subject}')">🗑 刪除科目</button>
      </div>
      <div class="unit-list">
        ${units.map(u => `
          <div class="unit-item">
            <span>${u.unit}</span>
            <button class="del-btn" onclick="deleteUnit('${u.assignment_id}')">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-outline btn-sm" style="width:100%;margin-top:8px" onclick="addUnit('${subject}')">＋ 新增單元</button>
    `;
    container.appendChild(card);
  });
  
  if (Object.keys(subjectMap).length === 0) {
    container.innerHTML = '<div class="empty-state"><p>尚未建立任何科目</p></div>';
  }
}

async function addUnit(subject) {
  const unit = prompt('請輸入單元名稱：');
  if (!unit) return;
  
  const data = await apiRequest({
    action: 'addUnit',
    method: 'POST',
    year: manageYear,
    class_name: manageClass,
    subject,
    unit
  });
  
  if (data && data.success) {
    showToast('新增成功');
    loadManageSubjects();
  } else {
    showToast('新增失敗');
  }
}

async function deleteUnit(assignmentId) {
  if (!confirm('確定要刪除此單元嗎？')) return;
  
  const data = await apiRequest({
    action: 'deleteUnit',
    method: 'POST',
    assignment_id: assignmentId
  });
  
  if (data && data.success) {
    showToast('刪除成功');
    loadManageSubjects();
  } else {
    showToast('刪除失敗');
  }
}

async function deleteSubject(subject) {
  if (!confirm(`確定要刪除「${subject}」科目嗎？\n此操作將刪除該科目所有單元和紀錄，且無法復原。`)) {
    return;
  }
  
  const data = await apiRequest({
    action: 'deleteSubject',
    method: 'POST',
    year: manageYear,
    class_name: manageClass,
    subject
  });
  
  if (data && data.success) {
    showToast('刪除成功');
    loadManageSubjects();
  } else {
    showToast('刪除失敗');
  }
}

// ============================================
// 設定頁面
// ============================================

function saveGasUrl() {
  const url = document.getElementById('gas-url').value.trim();
  if (!url) {
    showToast('請輸入 GAS 網址');
    return;
  }
  
  GAS_URL = url;
  localStorage.setItem('gas_url', url);
  
  testGasConnection();
}

function saveGasToken() {
  const token = document.getElementById('gas-token').value.trim();
  if (!token) {
    showToast('請輸入 API Token');
    return;
  }
  
  API_TOKEN = token;
  localStorage.setItem('api_token', token);
  
  showToast('Token 已儲存');
}

function savePassword() {
  const newPwd = document.getElementById('new-password').value.trim();
  if (!newPwd || newPwd.length < 4) {
    showToast('密碼至少需要 4 位');
    return;
  }
  
  loginPassword = newPwd;
  localStorage.setItem('login_password', newPwd);
  
  showToast('密碼已更新');
  document.getElementById('new-password').value = '';
}

async function testGasConnection() {
  const statusEl = document.getElementById('gas-status');
  statusEl.style.display = 'block';
  statusEl.style.background = 'var(--surface-2)';
  statusEl.style.color = 'var(--ink)';
  statusEl.textContent = '測試連線中…';
  
  const data = await apiRequest({ action: 'getYears' });
  
  if (data && data.success) {
    statusEl.style.background = 'var(--submitted-soft)';
    statusEl.style.color = 'var(--submitted)';
    statusEl.textContent = '✅ 連線成功！';
  } else {
    statusEl.style.background = 'var(--missing-soft)';
    statusEl.style.color = 'var(--missing)';
    statusEl.textContent = '❌ 連線失敗，請檢查設定';
  }
}

function openGasGuide() {
  showToast('GAS 設置說明請參考 docs/GAS_SETUP.md');
}

function syncAllFromCloud() {
  showToast('同步功能開發中');
}

function clearAllData() {
  if (!confirm('確定要清除所有本機資料嗎？\n此操作不會影響雲端資料。')) {
    return;
  }
  
  localStorage.clear();
  sessionStorage.clear();
  
  showToast('本機資料已清除');
  location.reload();
}
