/**
 * 출퇴근 기록 로직
 */

/** 오늘 출근 상태 확인 */
async function getTodayStatus(employeeId) {
  const record = await fetchAttendanceByEmployeeDate(employeeId, getTodayStr());
  if (!record) return { state: 'none', record: null };
  if (record['퇴근시간'] && record['상태'] === '완료') return { state: 'done', record };
  return { state: 'clocked-in', record };
}

/** 지각 여부 판단 */
function isLate(actualTime, scheduledTime) {
  if (!scheduledTime || !actualTime) return false;
  return isLater(actualTime, scheduledTime);
}

/** 조기퇴근 여부 판단 */
function isEarlyLeave(actualTime, scheduledTime) {
  if (!scheduledTime || !actualTime) return false;
  return isLater(scheduledTime, actualTime);
}

/** 직원 출퇴근 페이지 초기화 */
async function initAttendancePage() {
  const user = requireAuth();
  if (!user) return;

  renderUserInfo();
  renderNavLinks(user);

  const statusEl = document.getElementById('attendanceStatus');
  const clockInBtn = document.getElementById('clockInBtn');
  const clockOutBtn = document.getElementById('clockOutBtn');
  const todayInfoEl = document.getElementById('todayInfo');
  const scheduleEl = document.getElementById('scheduleDisplay');

  // 스케줄 표시
  if (scheduleEl) {
    scheduleEl.textContent = user.scheduledIn && user.scheduledOut
      ? `예정 근무: ${user.scheduledIn} ~ ${user.scheduledOut}`
      : '스케줄 미설정';
  }

  setLoading(true);
  try {
    const { state, record } = await getTodayStatus(user.employeeId);

    if (state === 'none') {
      statusEl.textContent = '미출근';
      statusEl.className = 'status-badge status-absent';
      clockInBtn.disabled = false;
      clockOutBtn.disabled = true;
      if (todayInfoEl) todayInfoEl.textContent = '-';
    } else if (state === 'clocked-in') {
      statusEl.textContent = '출근 완료';
      statusEl.className = 'status-badge status-present';
      clockInBtn.disabled = true;
      clockOutBtn.disabled = false;
      if (todayInfoEl) todayInfoEl.textContent = `출근: ${record['출근시간']}  퇴근: 미기록`;
    } else {
      statusEl.textContent = '퇴근 완료';
      statusEl.className = 'status-badge status-done';
      clockInBtn.disabled = true;
      clockOutBtn.disabled = true;
      if (todayInfoEl) todayInfoEl.textContent = `출근: ${record['출근시간']}  퇴근: ${record['퇴근시간']}`;
    }

    // 최근 기록 불러오기
    await renderRecentHistory(user.employeeId);

  } catch (err) {
    showApiError(err.message);
  } finally {
    setLoading(false);
  }

  // 출근 버튼
  clockInBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      `지금 출근하시겠습니까?\n현재 시각: ${getCurrentTimeStr()}`,
      '출근 기록',
      '취소'
    );
    if (!confirmed) return;

    clockInBtn.disabled = true;
    clockInBtn.textContent = '기록 중...';
    try {
      await recordClockIn(user.employeeId, user.name);
      showToast('출근이 기록되었습니다.');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      showApiError(err.message);
      clockInBtn.disabled = false;
      clockInBtn.textContent = '출근';
    }
  });

  // 퇴근 버튼
  clockOutBtn.addEventListener('click', async () => {
    const confirmed = await confirmDialog(
      `지금 퇴근하시겠습니까?\n현재 시각: ${getCurrentTimeStr()}`,
      '퇴근 기록',
      '취소'
    );
    if (!confirmed) return;

    clockOutBtn.disabled = true;
    clockOutBtn.textContent = '기록 중...';
    try {
      await recordClockOut(user.employeeId, getTodayStr());
      showToast('퇴근이 기록되었습니다.');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      showApiError(err.message);
      clockOutBtn.disabled = false;
      clockOutBtn.textContent = '퇴근';
    }
  });
}

/** 최근 출퇴근 기록 렌더링 */
async function renderRecentHistory(employeeId) {
  const tbody = document.getElementById('historyTableBody');
  if (!tbody) return;

  try {
    const records = await fetchAttendanceByEmployee(employeeId);
    const recent = records.slice(0, 10);

    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-row">출퇴근 기록이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(r => {
      const lateTag = r['출근시간'] && r['예정출근시간'] && isLate(r['출근시간'], r['예정출근시간'])
        ? '<span class="tag tag-warning">지각</span>' : '';
      const statusClass = r['상태'] === '완료' ? 'status-done' : 'status-absent';
      return `
        <tr>
          <td>${formatDate(r['날짜'])}</td>
          <td>${r['출근시간'] || '-'} ${lateTag}</td>
          <td>${r['퇴근시간'] || '-'}</td>
          <td><span class="status-badge ${statusClass} status-sm">${r['상태'] || '-'}</span></td>
          <td>${r['비고'] || '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">기록을 불러오지 못했습니다.</td></tr>';
  }
}

/** 관리자 - 전체 출퇴근 현황 렌더링 */
async function renderAdminAttendance() {
  const user = requireAdmin();
  if (!user) return;

  renderUserInfo();
  renderNavLinks(user);

  const dateInput = document.getElementById('dateFilter');
  if (dateInput) dateInput.value = getTodayStr();

  await loadAttendanceTable();

  if (dateInput) {
    dateInput.addEventListener('change', loadAttendanceTable);
  }
}

async function loadAttendanceTable() {
  const dateInput = document.getElementById('dateFilter');
  const dateStr = dateInput ? dateInput.value : getTodayStr();
  const tbody = document.getElementById('adminAttendanceBody');
  if (!tbody) return;

  setLoading(true);
  try {
    const [employees, records] = await Promise.all([
      fetchActiveEmployees(),
      fetchAttendanceByDate(dateStr),
    ]);

    const recordMap = {};
    records.forEach(r => { recordMap[r['직원ID']] = r; });

    if (employees.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">직원이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = employees.map(emp => {
      const rec = recordMap[emp['직원ID']];
      const statusText = rec ? (rec['상태'] === '완료' ? '퇴근완료' : '미퇴근') : '미출근';
      const statusClass = rec ? (rec['상태'] === '완료' ? 'status-done' : 'status-warning') : 'status-absent';
      const lateTag = rec && emp['예정출근시간'] && isLate(rec['출근시간'], emp['예정출근시간'])
        ? '<span class="tag tag-warning">지각</span>' : '';

      return `
        <tr>
          <td>${emp['이름']}</td>
          <td>${emp['소속'] || '-'}</td>
          <td>${emp['예정출근시간'] || '-'} ~ ${emp['예정퇴근시간'] || '-'}</td>
          <td>${rec ? rec['출근시간'] : '-'} ${lateTag}</td>
          <td>${rec ? (rec['퇴근시간'] || '미기록') : '-'}</td>
          <td><span class="status-badge ${statusClass} status-sm">${statusText}</span></td>
          <td>
            <button class="btn btn-sm btn-outline" onclick="openAdminEditModal('${emp['직원ID']}', '${emp['이름']}', '${dateStr}')">수정</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    showApiError(err.message);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">데이터를 불러오지 못했습니다.</td></tr>';
  } finally {
    setLoading(false);
  }
}

/** 관리자 - 출퇴근 수동 수정 모달 */
let currentEditEmployeeId = '';
let currentEditDate = '';

async function openAdminEditModal(employeeId, employeeName, dateStr) {
  currentEditEmployeeId = employeeId;
  currentEditDate = dateStr;

  const record = await fetchAttendanceByEmployeeDate(employeeId, dateStr).catch(() => null);

  document.getElementById('editModalTitle').textContent = `${employeeName} — ${formatDate(dateStr)}`;
  document.getElementById('editClockIn').value = record?.['출근시간'] || '';
  document.getElementById('editClockOut').value = record?.['퇴근시간'] || '';
  document.getElementById('editNote').value = record?.['비고'] || '';
  document.getElementById('editRecordId').value = record?.['기록ID'] || '';

  document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
  document.getElementById('editModal').style.display = 'none';
}

async function submitAdminEdit(e) {
  e.preventDefault();
  const clockIn = document.getElementById('editClockIn').value;
  const clockOut = document.getElementById('editClockOut').value;
  const note = document.getElementById('editNote').value;
  const recordId = document.getElementById('editRecordId').value;

  if (!clockIn) {
    showToast('출근 시간을 입력하세요.', 'error');
    return;
  }

  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true;

  try {
    const status = clockOut ? '완료' : '미퇴근';
    if (recordId) {
      await adminUpdateAttendance(recordId, { clockInTime: clockIn, clockOutTime: clockOut, status, note });
    } else {
      const user = getUser();
      await adminAddAttendance({
        employeeId: currentEditEmployeeId,
        date: currentEditDate,
        clockInTime: clockIn,
        clockOutTime: clockOut,
        method: '관리자입력',
        status,
        note,
      });
    }
    showToast('출퇴근 기록이 수정되었습니다.');
    closeEditModal();
    await loadAttendanceTable();
  } catch (err) {
    showApiError(err.message);
  } finally {
    submitBtn.disabled = false;
  }
}
