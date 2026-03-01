/**
 * 휴가 신청·승인 로직
 */

const LEAVE_TYPES = ['연차', '병가', '경조', '기타'];

/** 직원 - 휴가 신청 페이지 초기화 */
async function initLeaveEmployee() {
  const user = requireAuth();
  if (!user) return;

  renderUserInfo();
  renderNavLinks(user);

  await renderMyLeaveHistory(user.employeeId);

  const form = document.getElementById('leaveForm');
  if (!form) return;

  // 최소 날짜를 오늘로 설정
  const today = getTodayStr();
  document.getElementById('leaveStartDate').min = today;
  document.getElementById('leaveEndDate').min = today;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.getElementById('leaveType').value;
    const startDate = document.getElementById('leaveStartDate').value;
    const endDate = document.getElementById('leaveEndDate').value;
    const reason = document.getElementById('leaveReason').value.trim();

    if (!type || !startDate || !endDate) {
      showToast('모든 필드를 입력하세요.', 'error');
      return;
    }
    if (endDate < startDate) {
      showToast('종료일이 시작일보다 빠를 수 없습니다.', 'error');
      return;
    }

    const confirmed = await confirmDialog(
      `${type} 휴가를 신청하시겠습니까?\n기간: ${formatDate(startDate)} ~ ${formatDate(endDate)}`,
      '신청',
      '취소'
    );
    if (!confirmed) return;

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = '신청 중...';

    try {
      await submitLeaveRequest({
        employeeId: user.employeeId,
        employeeName: user.name,
        leaveType: type,
        startDate,
        endDate,
        reason,
      });
      showToast('휴가 신청이 완료되었습니다.');
      form.reset();
      await renderMyLeaveHistory(user.employeeId);
    } catch (err) {
      showApiError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '신청';
    }
  });
}

/** 내 휴가 이력 렌더링 */
async function renderMyLeaveHistory(employeeId) {
  const tbody = document.getElementById('myLeaveBody');
  if (!tbody) return;

  try {
    const records = await fetchLeaveByEmployee(employeeId);

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">휴가 신청 내역이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = records.map(r => {
      const statusClass = r['상태'] === '승인' ? 'status-done' : r['상태'] === '반려' ? 'status-absent' : 'status-warning';
      return `
        <tr>
          <td>${r['휴가유형'] || '-'}</td>
          <td>${formatDate(r['시작일'])} ~ ${formatDate(r['종료일'])}</td>
          <td>${r['사유'] || '-'}</td>
          <td>${r['신청일시'] ? r['신청일시'].substring(0, 10) : '-'}</td>
          <td><span class="status-badge ${statusClass} status-sm">${r['상태'] || '-'}</span></td>
          <td>${r['처리일시'] ? r['처리일시'].substring(0, 10) : '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">데이터를 불러오지 못했습니다.</td></tr>';
  }
}

/** 관리자 - 휴가 관리 페이지 초기화 */
async function initLeaveAdmin() {
  const user = requireAdmin();
  if (!user) return;

  renderUserInfo();
  renderNavLinks(user);

  await renderPendingLeaves();
  await renderAllLeaves();
}

/** 대기 중 휴가 신청 목록 렌더링 */
async function renderPendingLeaves() {
  const tbody = document.getElementById('pendingLeaveBody');
  if (!tbody) return;

  setLoading(true);
  try {
    const records = await fetchPendingLeaves();

    if (records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">대기 중인 신청이 없습니다.</td></tr>';
      updatePendingBadge(0);
      return;
    }

    updatePendingBadge(records.length);

    tbody.innerHTML = records.map(r => `
      <tr>
        <td>${r['이름'] || r['직원ID']}</td>
        <td>${r['휴가유형'] || '-'}</td>
        <td>${formatDate(r['시작일'])} ~ ${formatDate(r['종료일'])}</td>
        <td>${r['사유'] || '-'}</td>
        <td>${r['신청일시'] ? r['신청일시'].substring(0, 10) : '-'}</td>
        <td><span class="status-badge status-warning status-sm">대기</span></td>
        <td>
          <button class="btn btn-sm btn-success" onclick="handleLeaveAction('${r['신청ID']}', '승인')">승인</button>
          <button class="btn btn-sm btn-danger" onclick="handleLeaveAction('${r['신청ID']}', '반려')">반려</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showApiError(err.message);
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">데이터를 불러오지 못했습니다.</td></tr>';
  } finally {
    setLoading(false);
  }
}

/** 전체 휴가 이력 렌더링 */
async function renderAllLeaves() {
  const tbody = document.getElementById('allLeaveBody');
  if (!tbody) return;

  try {
    const records = await fetchLeaveRequests();
    const sorted = records.sort((a, b) => (b['신청일시'] > a['신청일시'] ? 1 : -1));

    if (sorted.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">휴가 신청 내역이 없습니다.</td></tr>';
      return;
    }

    tbody.innerHTML = sorted.map(r => {
      const statusClass = r['상태'] === '승인' ? 'status-done' : r['상태'] === '반려' ? 'status-absent' : 'status-warning';
      return `
        <tr>
          <td>${r['이름'] || r['직원ID']}</td>
          <td>${r['휴가유형'] || '-'}</td>
          <td>${formatDate(r['시작일'])} ~ ${formatDate(r['종료일'])}</td>
          <td>${r['사유'] || '-'}</td>
          <td>${r['신청일시'] ? r['신청일시'].substring(0, 10) : '-'}</td>
          <td><span class="status-badge ${statusClass} status-sm">${r['상태'] || '-'}</span></td>
          <td>${r['처리일시'] ? r['처리일시'].substring(0, 10) : '-'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">데이터를 불러오지 못했습니다.</td></tr>';
  }
}

/** 휴가 승인/반려 처리 */
async function handleLeaveAction(requestId, status) {
  const confirmed = await confirmDialog(
    `이 휴가 신청을 ${status}하시겠습니까?`,
    status,
    '취소'
  );
  if (!confirmed) return;

  try {
    await processLeaveRequest(requestId, status);
    showToast(`휴가 신청이 ${status}되었습니다.`);
    await renderPendingLeaves();
    await renderAllLeaves();
  } catch (err) {
    showApiError(err.message);
  }
}

/** 관리자 대시보드 배지 업데이트 */
function updatePendingBadge(count) {
  const badges = document.querySelectorAll('.pending-leave-badge');
  badges.forEach(b => {
    b.textContent = count;
    b.style.display = count > 0 ? 'inline-flex' : 'none';
  });
}
