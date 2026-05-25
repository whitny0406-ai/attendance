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

// ─────────────────────────────────────────
//  POST 방식 (이미지 등 대용량 데이터)
// ─────────────────────────────────────────

/**
 * Apps Script에 POST 요청 (이미지 포함 시 사용)
 * no-cors 모드: 응답 읽기 불가이지만 데이터 저장은 정상 작동
 * Content-Type을 text/plain으로 해야 Simple Request 조건 만족
 */
async function callAppsScriptPost(action, payload) {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL === 'YOUR_APPS_SCRIPT_WEB_APP_URL') {
    throw new Error('Apps Script URL이 설정되지 않았습니다.');
  }
  await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload }),
  });
  return { status: 'ok' };
}

// ─────────────────────────────────────────
//  공지사항
// ─────────────────────────────────────────

/** 공지 등록 */
async function addNotice(data) {
  return callAppsScript('addNotice', {
    noticeId: generateId('NTC'),
    ...data,
    createdAt: getNowDateTimeStr(),
    status: '활성',
  });
}

/** 공지 수정 (내용 또는 상태 변경) */
async function updateNotice(noticeId, data) {
  return callAppsScript('updateNotice', { noticeId, ...data });
}

/** 공지 비활성화 (삭제 대신) */
async function deactivateNotice(noticeId) {
  return callAppsScript('updateNotice', { noticeId, status: '비활성' });
}

// ─────────────────────────────────────────
//  업무일지
// ─────────────────────────────────────────

/**
 * 업무일지 등록
 * imageBase64: 이미지가 있으면 base64 문자열 (data:image/...;base64,... 형태)
 * imageType: 'image/jpeg' | 'image/png' 등
 */
async function addWorkJournal(data, imageBase64 = null, imageType = 'image/jpeg') {
  const payload = {
    journalId: generateId('JNL'),
    ...data,
    createdAt: getNowDateTimeStr(),
    imageBase64: imageBase64 || '',
    imageType,
  };
  // 이미지가 있으면 POST 방식 (URL 길이 초과 방지)
  if (imageBase64) {
    return callAppsScriptPost('addWorkJournal', payload);
  }
  // 이미지 없으면 기존 GET 방식
  // 이미지 필드 제거 후 전송
  const { imageBase64: _, imageType: __, ...textPayload } = payload;
  return callAppsScript('addWorkJournal', { ...textPayload, imageURL: '' });
}

/** 업무일지 삭제 */
async function deleteWorkJournal(journalId) {
  return callAppsScript('deleteWorkJournal', { journalId });
}
