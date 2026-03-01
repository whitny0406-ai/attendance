/**
 * 장애예술인 출퇴근 관리 — Google Apps Script 웹앱
 *
 * ▶ 배포 방법 (Apps Script 에디터에서):
 *   배포 > 새 배포 > 유형: 웹 앱
 *   실행 계정: 나 (스프레드시트 소유자)
 *   액세스: 모든 사용자 (Anyone)
 *   → 배포 후 발급되는 URL을 js/config.js의 APPS_SCRIPT_URL에 입력
 *
 * ▶ 스프레드시트 ID 설정:
 *   아래 SPREADSHEET_ID를 실제 스프레드시트 ID로 교체하세요.
 */

const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE';

const SHEET_NAMES = {
  EMPLOYEES: '직원정보',
  ATTENDANCE: '출퇴근기록',
  LEAVE:      '휴가신청',
};

// ── CORS 허용 헤더 ──
function setCorsHeaders(output) {
  return output
    .setHeader('Access-Control-Allow-Origin', '*')
    .setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    .setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ── OPTIONS preflight 처리 ──
function doGet(e) {
  return setCorsHeaders(ContentService.createTextOutput('ok'));
}

// ── 메인 POST 핸들러 ──
function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  try {
    const body = JSON.parse(e.postData.contents);
    const { action, payload } = body;
    let result;

    switch (action) {
      case 'clockIn':         result = handleClockIn(payload);       break;
      case 'clockOut':        result = handleClockOut(payload);      break;
      case 'addAttendance':   result = handleAddAttendance(payload); break;
      case 'updateAttendance':result = handleUpdateAttendance(payload); break;
      case 'addEmployee':     result = handleAddEmployee(payload);   break;
      case 'updateEmployee':  result = handleUpdateEmployee(payload);break;
      case 'submitLeave':     result = handleSubmitLeave(payload);   break;
      case 'processLeave':    result = handleProcessLeave(payload);  break;
      case 'backup':          result = handleBackup();               break;
      default:
        throw new Error(`알 수 없는 액션: ${action}`);
    }

    output.setContent(JSON.stringify({ status: 'ok', data: result }));
  } catch (err) {
    output.setContent(JSON.stringify({ status: 'error', message: err.message }));
  }

  return setCorsHeaders(output);
}

// ─────────────────────────────────────────
//  헬퍼: 시트 및 데이터 접근
// ─────────────────────────────────────────

function getSheet(name) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`시트를 찾을 수 없습니다: ${name}`);
  return sheet;
}

function getHeaders(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

/** 시트 전체를 객체 배열로 반환 */
function getAllRows(sheetName) {
  const sheet = getSheet(sheetName);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    obj._rowIndex = data.indexOf(row) + 1; // 실제 행 번호
    return obj;
  });
}

/** 특정 컬럼 값으로 행 찾기 */
function findRow(sheetName, colName, value) {
  const rows = getAllRows(sheetName);
  return rows.find(r => String(r[colName]) === String(value)) || null;
}

/** 행 업데이트 */
function updateRow(sheetName, rowIndex, updates) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheet);
  const rowData = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];

  headers.forEach((h, i) => {
    if (updates[h] !== undefined) rowData[i] = updates[h];
  });

  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
}

/** 새 행 추가 */
function appendRow(sheetName, rowObj) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders(sheet);
  const rowData = headers.map(h => rowObj[h] !== undefined ? rowObj[h] : '');
  sheet.appendRow(rowData);
}

// ─────────────────────────────────────────
//  출퇴근 핸들러
// ─────────────────────────────────────────

function handleClockIn(p) {
  // 이미 오늘 출근 기록이 있는지 확인
  const rows = getAllRows(SHEET_NAMES.ATTENDANCE);
  const existing = rows.find(r =>
    String(r['직원ID']) === String(p.employeeId) && String(r['날짜']) === String(p.date)
  );
  if (existing) throw new Error('이미 오늘 출근이 기록되어 있습니다.');

  appendRow(SHEET_NAMES.ATTENDANCE, {
    '기록ID':         p.recordId,
    '직원ID':         p.employeeId,
    '날짜':           p.date,
    '출근시간':       p.clockInTime,
    '퇴근시간':       '',
    '기록방식':       p.method || '자가',
    '상태':           '미퇴근',
    '비고':           p.note || '',
  });
  return { message: '출근 기록 완료' };
}

function handleClockOut(p) {
  const rows = getAllRows(SHEET_NAMES.ATTENDANCE);
  const rec = rows.find(r =>
    String(r['직원ID']) === String(p.employeeId) && String(r['날짜']) === String(p.date)
  );
  if (!rec) throw new Error('출근 기록을 찾을 수 없습니다.');

  updateRow(SHEET_NAMES.ATTENDANCE, rec._rowIndex, {
    '퇴근시간': p.clockOutTime,
    '상태':     '완료',
  });
  return { message: '퇴근 기록 완료' };
}

function handleAddAttendance(p) {
  appendRow(SHEET_NAMES.ATTENDANCE, {
    '기록ID':   p.recordId,
    '직원ID':   p.employeeId,
    '날짜':     p.date,
    '출근시간': p.clockInTime || '',
    '퇴근시간': p.clockOutTime || '',
    '기록방식': p.method || '관리자입력',
    '상태':     p.status || '완료',
    '비고':     p.note || '',
  });
  return { message: '출퇴근 기록 추가 완료' };
}

function handleUpdateAttendance(p) {
  const rows = getAllRows(SHEET_NAMES.ATTENDANCE);
  const rec = rows.find(r => String(r['기록ID']) === String(p.recordId));
  if (!rec) throw new Error(`기록ID를 찾을 수 없습니다: ${p.recordId}`);

  const updates = {};
  if (p.clockInTime  !== undefined) updates['출근시간'] = p.clockInTime;
  if (p.clockOutTime !== undefined) updates['퇴근시간'] = p.clockOutTime;
  if (p.status       !== undefined) updates['상태']     = p.status;
  if (p.note         !== undefined) updates['비고']      = p.note;

  updateRow(SHEET_NAMES.ATTENDANCE, rec._rowIndex, updates);
  return { message: '출퇴근 기록 수정 완료' };
}

// ─────────────────────────────────────────
//  직원 핸들러
// ─────────────────────────────────────────

function handleAddEmployee(p) {
  // 직원정보 시트 헤더 순서에 맞게 삽입
  appendRow(SHEET_NAMES.EMPLOYEES, {
    '직원ID':            p.employeeId,
    '이름':              p.name,
    '연락처':            p.phone || '',
    '소속':              p.department || '',
    '직종':              p.jobTitle || '',
    '권한(관리자/직원)': p.role || '직원',
    '비밀번호(해시)':    p.passwordHash,
    '등록일':            p.registeredAt,
    '상태':              '재직',
    '예정출근시간':      p.scheduledIn || '',
    '예정퇴근시간':      p.scheduledOut || '',
  });
  return { message: '직원 등록 완료', employeeId: p.employeeId };
}

function handleUpdateEmployee(p) {
  const rows = getAllRows(SHEET_NAMES.EMPLOYEES);
  const emp = rows.find(r => String(r['직원ID']) === String(p.employeeId));
  if (!emp) throw new Error(`직원ID를 찾을 수 없습니다: ${p.employeeId}`);

  const updates = {};
  if (p.name        !== undefined) updates['이름']              = p.name;
  if (p.phone       !== undefined) updates['연락처']            = p.phone;
  if (p.department  !== undefined) updates['소속']              = p.department;
  if (p.jobTitle    !== undefined) updates['직종']              = p.jobTitle;
  if (p.role        !== undefined) updates['권한(관리자/직원)'] = p.role;
  if (p.passwordHash!== undefined) updates['비밀번호(해시)']    = p.passwordHash;
  if (p.status      !== undefined) updates['상태']              = p.status;
  if (p.scheduledIn !== undefined) updates['예정출근시간']      = p.scheduledIn;
  if (p.scheduledOut!== undefined) updates['예정퇴근시간']      = p.scheduledOut;

  updateRow(SHEET_NAMES.EMPLOYEES, emp._rowIndex, updates);
  return { message: '직원 정보 수정 완료' };
}

// ─────────────────────────────────────────
//  휴가 핸들러
// ─────────────────────────────────────────

function handleSubmitLeave(p) {
  // 직원 이름 조회
  const emp = findRow(SHEET_NAMES.EMPLOYEES, '직원ID', p.employeeId);

  appendRow(SHEET_NAMES.LEAVE, {
    '신청ID':   p.requestId,
    '직원ID':   p.employeeId,
    '이름':     emp ? emp['이름'] : p.employeeName || '',
    '휴가유형': p.leaveType,
    '시작일':   p.startDate,
    '종료일':   p.endDate,
    '사유':     p.reason || '',
    '신청일시': p.requestedAt,
    '상태':     '대기',
    '처리일시': '',
  });
  return { message: '휴가 신청 완료' };
}

function handleProcessLeave(p) {
  const rows = getAllRows(SHEET_NAMES.LEAVE);
  const rec = rows.find(r => String(r['신청ID']) === String(p.requestId));
  if (!rec) throw new Error(`신청ID를 찾을 수 없습니다: ${p.requestId}`);

  updateRow(SHEET_NAMES.LEAVE, rec._rowIndex, {
    '상태':     p.status, // '승인' or '반려'
    '처리일시': p.processedAt,
  });
  return { message: `휴가 ${p.status} 처리 완료` };
}

// ─────────────────────────────────────────
//  백업 핸들러 (월 1회 자동 실행 or 수동)
// ─────────────────────────────────────────

function handleBackup() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}`;

  const sheetsToCopy = [
    SHEET_NAMES.EMPLOYEES,
    SHEET_NAMES.ATTENDANCE,
    SHEET_NAMES.LEAVE,
  ];

  sheetsToCopy.forEach(name => {
    const src = ss.getSheetByName(name);
    if (!src) return;
    const backupName = `backup_${stamp}_${name}`;
    // 기존 백업 시트가 있으면 삭제 후 재생성
    const existing = ss.getSheetByName(backupName);
    if (existing) ss.deleteSheet(existing);
    src.copyTo(ss).setName(backupName);
  });

  return { message: `백업 완료: ${stamp}`, sheets: sheetsToCopy };
}

// ─────────────────────────────────────────
//  Apps Script 시간 기반 트리거 (월 1회 자동 백업)
//  아래 함수를 Apps Script 에디터에서 트리거로 등록하세요.
//  트리거 유형: 시간 기반 > 월별
// ─────────────────────────────────────────

function scheduledBackup() {
  handleBackup();
  Logger.log('자동 백업 완료');
}

// ─────────────────────────────────────────
//  초기 시트 구조 생성 (최초 1회 실행)
//  Apps Script 에디터에서 직접 실행하세요.
// ─────────────────────────────────────────

function initializeSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  const schema = {
    [SHEET_NAMES.EMPLOYEES]: [
      '직원ID', '이름', '연락처', '소속', '직종', '권한(관리자/직원)',
      '비밀번호(해시)', '등록일', '상태', '예정출근시간', '예정퇴근시간'
    ],
    [SHEET_NAMES.ATTENDANCE]: [
      '기록ID', '직원ID', '날짜', '출근시간', '퇴근시간',
      '기록방식', '상태', '비고'
    ],
    [SHEET_NAMES.LEAVE]: [
      '신청ID', '직원ID', '이름', '휴가유형', '시작일', '종료일',
      '사유', '신청일시', '상태', '처리일시'
    ],
  };

  Object.entries(schema).forEach(([name, headers]) => {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
    }
    // 헤더가 없으면 첫 행에 삽입
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  Logger.log('시트 초기화 완료');
}
