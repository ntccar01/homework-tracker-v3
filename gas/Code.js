// ============================================
// 作業登記系統 v3.0 - Google Apps Script API
// ============================================

const TOKEN = 'your_secret_token_here'; // 請改為您的自訂金鑰

// 等第對應分數
const GRADE_MAP = {
  'A+': 100, 'A': 95, 'A-': 90,
  'B+': 85,  'B': 80, 'B-': 75,
  'C+': 70,  'C': 65, 'C-': 60,
  'D+': 55,  'D': 50, 'D-': 45,
  'E': 40
};

// ============================================
// 入口函數
// ============================================

function doGet(e) {
  const action = e.parameter.action;
  const token = e.parameter.token;

  // Token 驗證
  if (token !== TOKEN) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 403);
  }

  try {
    switch (action) {
      case 'getYears':        return getYears();
      case 'getClasses':      return getClasses();
      case 'getStudents':     return getStudents(e.parameter);
      case 'getSubjects':     return getSubjects(e.parameter);
      case 'getUnits':        return getUnits(e.parameter);
      case 'getAssignments':  return getAssignments(e.parameter);
      case 'getRecords':      return getRecords(e.parameter);
      case 'getOverview':     return getOverview(e.parameter);
      default:                return jsonResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const token = data.token;

  if (token !== TOKEN) {
    return jsonResponse({ success: false, error: 'Unauthorized' }, 403);
  }

  try {
    switch (data.action) {
      case 'saveRecord':    return saveRecord(data);
      case 'saveBulk':      return saveBulk(data);
      case 'addClass':      return addClass(data);
      case 'updateClass':   return updateClass(data);
      case 'deleteClass':   return deleteClass(data);
      case 'addSubject':    return addSubject(data);
      case 'deleteSubject': return deleteSubject(data);
      case 'addUnit':       return addUnit(data);
      case 'deleteUnit':    return deleteUnit(data);
      case 'addStudent':    return addStudent(data);
      case 'importStudents':return importStudents(data);
      case 'deleteStudent': return deleteStudent(data);
      case 'addYear':       return addYear(data);
      case 'deleteYear':    return deleteYear(data);
      default:              return jsonResponse({ success: false, error: 'Unknown action' });
    }
  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ============================================
// 工具函數
// ============================================

function jsonResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function generateId() {
  return Date.now().toString();
}

// ============================================
// GET 請求處理
// ============================================

function getYears() {
  const sheet = getSheet('students');
  const data = sheet.getDataRange().getValues();
  const years = [...new Set(data.slice(1).map(r => r[0]).filter(Boolean))];
  return jsonResponse({ success: true, years: years.sort((a, b) => b - a) });
}

function getClasses(params) {
  const sheet = getSheet('students');
  const data = sheet.getDataRange().getValues();
  const { year } = params;
  
  const classes = [...new Set(
    data.slice(1)
      .filter(r => !year || r[0] == year)
      .map(r => r[1])
      .filter(Boolean)
  )];
  
  return jsonResponse({ success: true, classes });
}

function getStudents(params) {
  const sheet = getSheet('students');
  const data = sheet.getDataRange().getValues();
  const { year, class_name } = params;
  
  const students = data.slice(1)
    .filter(r => r[0] == year && r[1] === class_name)
    .map(r => ({
      seat_num: r[2].toString().padStart(2, '0'),
      name: r[3]
    }))
    .sort((a, b) => a.seat_num - b.seat_num);
  
  return jsonResponse({ success: true, students });
}

function getSubjects(params) {
  const sheet = getSheet('assignments');
  const data = sheet.getDataRange().getValues();
  const { year, class_name } = params;
  
  const subjects = [...new Set(
    data.slice(1)
      .filter(r => r[1] == year && r[2] === class_name)
      .map(r => r[3])
      .filter(Boolean)
  )];
  
  return jsonResponse({ success: true, subjects });
}

function getUnits(params) {
  const sheet = getSheet('assignments');
  const data = sheet.getDataRange().getValues();
  const { year, class_name, subject } = params;
  
  const units = data.slice(1)
    .filter(r => r[1] == year && r[2] === class_name && r[3] === subject)
    .map(r => ({
      assignment_id: r[0],
      unit: r[4]
    }));
  
  return jsonResponse({ success: true, units });
}

function getAssignments(params) {
  const sheet = getSheet('assignments');
  const data = sheet.getDataRange().getValues();
  const { year, class_name } = params;
  
  const assignments = data.slice(1)
    .filter(r => r[1] == year && r[2] === class_name)
    .map(r => ({
      assignment_id: r[0],
      subject: r[3],
      unit: r[4]
    }));
  
  return jsonResponse({ success: true, assignments });
}

function getRecords(params) {
  const sheet = getSheet('records');
  const data = sheet.getDataRange().getValues();
  const { assignment_id } = params;
  
  const records = data.slice(1)
    .filter(r => r[0] == assignment_id)
    .map(r => ({
      seat_num: r[3].toString().padStart(2, '0'),
      status: r[4],
      score: r[5],
      note: r[6]
    }));
  
  return jsonResponse({ success: true, records });
}

function getOverview(params) {
  const sheet = getSheet('records');
  const data = sheet.getDataRange().getValues();
  const { year, class_name, subject } = params;
  
  // 先取得該班級科目所有作業
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  const assignmentIds = assignData.slice(1)
    .filter(r => r[1] == year && r[2] === class_name && r[3] === subject)
    .map(r => r[0]);
  
  // 取得學生名單
  const studentSheet = getSheet('students');
  const studentData = studentSheet.getDataRange().getValues();
  const students = studentData.slice(1)
    .filter(r => r[0] == year && r[1] === class_name)
    .map(r => ({
      seat_num: r[2].toString().padStart(2, '0'),
      name: r[3]
    }))
    .sort((a, b) => a.seat_num - b.seat_num);
  
  // 取得所有相關紀錄
  const records = data.slice(1)
    .filter(r => assignmentIds.includes(r[0]));
  
  // 建立總覽
  const overview = students.map(s => {
    const studentRecords = records
      .filter(r => r[3].toString().padStart(2, '0') === s.seat_num)
      .map(r => ({
        assignment_id: r[0],
        status: r[4],
        score: r[5],
        note: r[6]
      }));
    
    return {
      seat_num: s.seat_num,
      name: s.name,
      records: studentRecords
    };
  });
  
  return jsonResponse({ success: true, overview, assignment_count: assignmentIds.length });
}

// ============================================
// POST 請求處理 - 學年度管理
// ============================================

function addYear(data) {
  const { year } = data;
  const sheet = getSheet('students');
  const existing = sheet.getDataRange().getValues().slice(1).map(r => r[0]);
  
  if (existing.includes(year)) {
    return jsonResponse({ success: false, error: '學年度已存在' });
  }
  
  return jsonResponse({ success: true });
}

function deleteYear(data) {
  const { year } = data;
  
  // 刪除該學年度所有學生
  const studentSheet = getSheet('students');
  const studentData = studentSheet.getDataRange().getValues();
  const studentRows = studentData.slice(1)
    .map((r, i) => ({ row: i + 2, year: r[0] }))
    .filter(r => r.year == year)
    .map(r => r.row);
  
  for (let i = studentRows.length - 1; i >= 0; i--) {
    studentSheet.deleteRow(studentRows[i]);
  }
  
  // 刪除相關作業和紀錄（需要先查詢）
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  const assignIds = assignData.slice(1)
    .filter(r => r[1] == year)
    .map(r => r[0]);
  
  // 刪除紀錄
  if (assignIds.length > 0) {
    const recordSheet = getSheet('records');
    const recordData = recordSheet.getDataRange().getValues();
    const recordRows = recordData.slice(1)
      .map((r, i) => ({ row: i + 2, id: r[0] }))
      .filter(r => assignIds.includes(r.id))
      .map(r => r.row);
    
    for (let i = recordRows.length - 1; i >= 0; i--) {
      recordSheet.deleteRow(recordRows[i]);
    }
  }
  
  // 刪除作業
  for (let i = assignData.length - 1; i >= 1; i--) {
    if (assignData[i][1] == year) {
      assignSheet.deleteRow(i + 1);
    }
  }
  
  return jsonResponse({ success: true });
}

// ============================================
// POST 請求處理 - 班級管理
// ============================================

function addClass(data) {
  const { year, class_name, subjects } = data;
  const sheet = getSheet('students');
  const existing = sheet.getDataRange().getValues()
    .slice(1)
    .filter(r => r[0] == year && r[1] === class_name);
  
  if (existing.length > 0) {
    return jsonResponse({ success: false, error: '班級已存在' });
  }
  
  // 如果有提供科目，同時建立科目
  if (subjects && subjects.length > 0) {
    const assignSheet = getSheet('assignments');
    subjects.forEach(subject => {
      assignSheet.appendRow([generateId(), year, class_name, subject, '']);
    });
  }
  
  return jsonResponse({ success: true });
}

function updateClass(data) {
  const { year, old_name, new_name, subjects } = data;
  
  // 更新學生名單中的班級名稱
  const studentSheet = getSheet('students');
  const studentData = studentSheet.getDataRange().getValues();
  
  for (let i = 1; i < studentData.length; i++) {
    if (studentData[i][0] == year && studentData[i][1] === old_name) {
      studentSheet.getRange(i + 1, 2).setValue(new_name);
    }
  }
  
  // 更新作業表中的班級名稱
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  
  for (let i = 1; i < assignData.length; i++) {
    if (assignData[i][1] == year && assignData[i][2] === old_name) {
      assignSheet.getRange(i + 1, 3).setValue(new_name);
    }
  }
  
  // 更新紀錄中的班級名稱
  const recordSheet = getSheet('records');
  const recordData = recordSheet.getDataRange().getValues();
  
  for (let i = 1; i < recordData.length; i++) {
    if (recordData[i][1] == year && recordData[i][2] === old_name) {
      recordSheet.getRange(i + 1, 3).setValue(new_name);
    }
  }
  
  return jsonResponse({ success: true });
}

function deleteClass(data) {
  const { year, class_name } = data;
  
  // 刪除學生
  const studentSheet = getSheet('students');
  const studentData = studentSheet.getDataRange().getValues();
  const studentRows = studentData.slice(1)
    .map((r, i) => ({ row: i + 2, year: r[0], class: r[1] }))
    .filter(r => r.year == year && r.class === class_name)
    .map(r => r.row);
  
  for (let i = studentRows.length - 1; i >= 0; i--) {
    studentSheet.deleteRow(studentRows[i]);
  }
  
  // 刪除相關作業和紀錄
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  const assignIds = assignData.slice(1)
    .filter(r => r[1] == year && r[2] === class_name)
    .map(r => r[0]);
  
  // 刪除紀錄
  if (assignIds.length > 0) {
    const recordSheet = getSheet('records');
    const recordData = recordSheet.getDataRange().getValues();
    const recordRows = recordData.slice(1)
      .map((r, i) => ({ row: i + 2, id: r[0] }))
      .filter(r => assignIds.includes(r.id))
      .map(r => r.row);
    
    for (let i = recordRows.length - 1; i >= 0; i--) {
      recordSheet.deleteRow(recordRows[i]);
    }
  }
  
  // 刪除作業
  for (let i = assignData.length - 1; i >= 1; i--) {
    if (assignData[i][1] == year && assignData[i][2] === class_name) {
      assignSheet.deleteRow(i + 1);
    }
  }
  
  return jsonResponse({ success: true });
}

// ============================================
// POST 請求處理 - 科目管理
// ============================================

function addSubject(data) {
  const { year, class_name, subject } = data;
  const sheet = getSheet('assignments');
  const existing = sheet.getDataRange().getValues()
    .slice(1)
    .filter(r => r[1] == year && r[2] === class_name && r[3] === subject);
  
  if (existing.length > 0) {
    return jsonResponse({ success: false, error: '科目已存在' });
  }
  
  // 建立一個空的作業記錄
  sheet.appendRow([generateId(), year, class_name, subject, '']);
  
  return jsonResponse({ success: true });
}

function deleteSubject(data) {
  const { year, class_name, subject } = data;
  
  // 刪除相關作業和紀錄
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  const assignIds = assignData.slice(1)
    .filter(r => r[1] == year && r[2] === class_name && r[3] === subject)
    .map(r => r[0]);
  
  // 刪除紀錄
  if (assignIds.length > 0) {
    const recordSheet = getSheet('records');
    const recordData = recordSheet.getDataRange().getValues();
    const recordRows = recordData.slice(1)
      .map((r, i) => ({ row: i + 2, id: r[0] }))
      .filter(r => assignIds.includes(r.id))
      .map(r => r.row);
    
    for (let i = recordRows.length - 1; i >= 0; i--) {
      recordSheet.deleteRow(recordRows[i]);
    }
  }
  
  // 刪除作業
  for (let i = assignData.length - 1; i >= 1; i--) {
    if (assignData[i][1] == year && assignData[i][2] === class_name && assignData[i][3] === subject) {
      assignSheet.deleteRow(i + 1);
    }
  }
  
  return jsonResponse({ success: true });
}

// ============================================
// POST 請求處理 - 單元管理
// ============================================

function addUnit(data) {
  const { year, class_name, subject, unit } = data;
  const sheet = getSheet('assignments');
  const id = generateId();
  
  sheet.appendRow([id, year, class_name, subject, unit]);
  
  return jsonResponse({ success: true, assignment_id: id });
}

function deleteUnit(data) {
  const { assignment_id } = data;
  
  // 刪除相關紀錄
  const recordSheet = getSheet('records');
  const recordData = recordSheet.getDataRange().getValues();
  const recordRows = recordData.slice(1)
    .map((r, i) => ({ row: i + 2, id: r[0] }))
    .filter(r => r.id == assignment_id)
    .map(r => r.row);
  
  for (let i = recordRows.length - 1; i >= 0; i--) {
    recordSheet.deleteRow(recordRows[i]);
  }
  
  // 刪除作業
  const assignSheet = getSheet('assignments');
  const assignData = assignSheet.getDataRange().getValues();
  const assignRow = assignData.slice(1)
    .map((r, i) => ({ row: i + 2, id: r[0] }))
    .find(r => r.id == assignment_id);
  
  if (assignRow) {
    assignSheet.deleteRow(assignRow.row);
  }
  
  return jsonResponse({ success: true });
}

// ============================================
// POST 請求處理 - 學生管理
// ============================================

function addStudent(data) {
  const { year, class_name, seat_num, name } = data;
  const sheet = getSheet('students');
  
  sheet.appendRow([year, class_name, seat_num.toString().padStart(2, '0'), name]);
  
  return jsonResponse({ success: true });
}

function importStudents(data) {
  const { year, class_name, students } = data;
  const sheet = getSheet('students');
  
  // 先刪除該班級現有學生
  const existing = sheet.getDataRange().getValues();
  const rowsToDelete = existing.slice(1)
    .map((r, i) => ({ row: i + 2, year: r[0], class: r[1] }))
    .filter(r => r.year == year && r.class === class_name)
    .map(r => r.row);
  
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
  
  // 匯入新學生
  students.forEach(s => {
    sheet.appendRow([year, class_name, s.seat_num.toString().padStart(2, '0'), s.name]);
  });
  
  return jsonResponse({ success: true, imported: students.length });
}

function deleteStudent(data) {
  const { year, class_name, seat_num } = data;
  const sheet = getSheet('students');
  const existing = sheet.getDataRange().getValues();
  
  const rowIndex = existing.findIndex((r, i) => 
    i > 0 && r[0] == year && r[1] === class_name && r[2].toString().padStart(2, '0') === seat_num
  );
  
  if (rowIndex > 0) {
    sheet.deleteRow(rowIndex + 1);
    return jsonResponse({ success: true });
  }
  
  return jsonResponse({ success: false, error: '找不到學生' });
}

// ============================================
// POST 請求處理 - 登記紀錄
// ============================================

function saveRecord(data) {
  const { assignment_id, year, class_name, seat_num, status, score, note } = data;
  const sheet = getSheet('records');
  const existing = sheet.getDataRange().getValues();
  
  // 查找是否已有紀錄
  const rowIndex = existing.findIndex((r, i) => 
    i > 0 && r[0] == assignment_id && r[3].toString().padStart(2, '0') === seat_num
  );
  
  const rowData = [assignment_id, year, class_name, seat_num.toString().padStart(2, '0'), status, score, note || ''];
  
  if (rowIndex > 0) {
    // 更新現有紀錄
    sheet.getRange(rowIndex + 1, 1, 1, 7).setValues([rowData]);
  } else {
    // 新增紀錄
    sheet.appendRow(rowData);
  }
  
  return jsonResponse({ success: true });
}

function saveBulk(data) {
  const { records } = data;
  const sheet = getSheet('records');
  const existing = sheet.getDataRange().getValues();
  
  let updated = 0;
  let inserted = 0;
  
  records.forEach(record => {
    const { assignment_id, year, class_name, seat_num, status, score, note } = record;
    
    const rowIndex = existing.findIndex((r, i) => 
      i > 0 && r[0] == assignment_id && r[3].toString().padStart(2, '0') === seat_num
    );
    
    const rowData = [assignment_id, year, class_name, seat_num.toString().padStart(2, '0'), status, score, note || ''];
    
    if (rowIndex > 0) {
      sheet.getRange(rowIndex + 1, 1, 1, 7).setValues([rowData]);
      updated++;
    } else {
      sheet.appendRow(rowData);
      inserted++;
    }
  });
  
  return jsonResponse({ success: true, updated, inserted });
}
