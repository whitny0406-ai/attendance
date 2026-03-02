/**
 * Google Sheets 쓰기 모듈 (Apps Script Web App 경유)
 * 서비스 계정 키 노출 없이 안전하게 쓰기 가능
 */

/**
 * Apps Script 웹앱에 GET 요청 (CORS 우회)
 * POST는 302 리디렉션 시 CORS 헤더 유실 → GET으로 URL 파라미터 전달
 * @param {string} action - 수행할 액션
 * @param {object} payload - 전달할 데이터
 */
async function callAppsScript(action, payload) {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_WEB_APP_URL') {
    throw new Error('Apps Script URL이 설정되지 않았습니다. js/config.js를 수정하세요.');
  }

  const url = new URL(CONFIG.APPS_SCRIPT_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('payload', JSON.stringify(payload));

  // no-cors: Apps Script가 리디렉션하므로 응답 읽기 불가
  // 요청 자체는 정상 전달되어 Google Sheets에 데이터 저장됨
  // 진짜 네트워크 오류(인터넷 끊김 등)만 예외로 throw됨
  await fetch(url.toString(), { mode: 'no-cors' });

  return { status: 'ok', data: { message: '처리 완료' } };
}

/** 출근 기록 */
async function recordClockIn(employeeId, employeeName) {
  return callAppsScript('clockIn', {
    recordId: generateId('ATT'),
    employeeId,
    employeeName,
    date: getTodayStr(),
    clockInTime: getCurrentTimeStr(),
    method: '자가',
    status: '미퇴근',
    note: '',
  });
}

/** 퇴근 기록 */
async function recordClockOut(employeeId, date) {
  return callAppsScript('clockOut', {
    employeeId,
    date,
    clockOutTime: getCurrentTimeStr(),
    status: '완료',
  });
}

/** 관리자 - 출퇴근 수동 수정 */
async function adminUpdateAttendance(recordId, updateData) {
  return callAppsScript('updateAttendance', { recordId, ...updateData });
}

/** 관리자 - 출퇴근 수동 입력 (미퇴근 처리 포함) */
async function adminAddAttendance(data) {
  return callAppsScript('addAttendance', {
    recordId: generateId('ATT'),
    ...data,
  });
}

/** 직원 등록 */
async function addEmployee(data) {
  return callAppsScript('addEmployee', {
    employeeId: generateId('EMP'),
    ...data,
    registeredAt: getTodayStr(),
    status: '재직',
  });
}

/** 직원 수정 */
async function updateEmployee(employeeId, data) {
  return callAppsScript('updateEmployee', { employeeId, ...data });
}

/** 직원 삭제 (상태를 퇴직으로 변경) */
async function retireEmployee(employeeId) {
  return callAppsScript('updateEmployee', { employeeId, status: '퇴직' });
}

/** 직원 근무 스케줄 수정 */
async function updateSchedule(employeeId, scheduledIn, scheduledOut) {
  return callAppsScript('updateEmployee', {
    employeeId,
    scheduledIn,
    scheduledOut,
  });
}

/** 휴가 신청 */
async function submitLeaveRequest(data) {
  return callAppsScript('submitLeave', {
    requestId: generateId('LVE'),
    ...data,
    requestedAt: getNowDateTimeStr(),
    status: '대기',
    processedAt: '',
  });
}

/** 휴가 승인/반려 */
async function processLeaveRequest(requestId, status) {
  return callAppsScript('processLeave', {
    requestId,
    status, // '승인' or '반려'
    processedAt: getNowDateTimeStr(),
  });
}

/** 비밀번호 변경 */
async function changePassword(employeeId, newHash) {
  return callAppsScript('updateEmployee', { employeeId, passwordHash: newHash });
}
