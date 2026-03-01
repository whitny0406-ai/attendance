/**
 * Google Sheets API 읽기 모듈 (API 키 방식)
 */

/**
 * 시트의 모든 데이터를 객체 배열로 반환
 * 첫 번째 행을 헤더로 사용
 */
async function fetchSheetData(sheetName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}?key=${CONFIG.API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `시트 읽기 실패 (${res.status})`);
  }

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

/** 전체 직원 목록 조회 */
async function fetchEmployees() {
  const rows = await fetchSheetData(CONFIG.SHEETS.EMPLOYEES);
  return rows;
}

/** 재직 중인 직원만 조회 */
async function fetchActiveEmployees() {
  const all = await fetchEmployees();
  return all.filter(e => e['상태'] === '재직');
}

/** 특정 직원ID로 직원 조회 */
async function fetchEmployeeById(employeeId) {
  const all = await fetchEmployees();
  return all.find(e => e['직원ID'] === employeeId) || null;
}

/** 전체 출퇴근기록 조회 */
async function fetchAttendance() {
  return await fetchSheetData(CONFIG.SHEETS.ATTENDANCE);
}

/** 특정 직원의 특정 날짜 출퇴근기록 조회 */
async function fetchAttendanceByEmployeeDate(employeeId, dateStr) {
  const all = await fetchAttendance();
  return all.find(r => r['직원ID'] === employeeId && r['날짜'] === dateStr) || null;
}

/** 특정 직원의 출퇴근기록 조회 (최신순) */
async function fetchAttendanceByEmployee(employeeId) {
  const all = await fetchAttendance();
  return all
    .filter(r => r['직원ID'] === employeeId)
    .sort((a, b) => (b['날짜'] > a['날짜'] ? 1 : -1));
}

/** 특정 날짜의 전체 출퇴근기록 조회 */
async function fetchAttendanceByDate(dateStr) {
  const all = await fetchAttendance();
  return all.filter(r => r['날짜'] === dateStr);
}

/** 특정 월의 출퇴근기록 조회 (YYYY-MM 형식) */
async function fetchAttendanceByMonth(yearMonth) {
  const all = await fetchAttendance();
  return all.filter(r => r['날짜'] && r['날짜'].startsWith(yearMonth));
}

/** 전체 휴가신청 조회 */
async function fetchLeaveRequests() {
  return await fetchSheetData(CONFIG.SHEETS.LEAVE);
}

/** 특정 직원의 휴가신청 조회 */
async function fetchLeaveByEmployee(employeeId) {
  const all = await fetchLeaveRequests();
  return all
    .filter(r => r['직원ID'] === employeeId)
    .sort((a, b) => (b['신청일시'] > a['신청일시'] ? 1 : -1));
}

/** 대기 중인 휴가신청 조회 (관리자용) */
async function fetchPendingLeaves() {
  const all = await fetchLeaveRequests();
  return all.filter(r => r['상태'] === '대기');
}
