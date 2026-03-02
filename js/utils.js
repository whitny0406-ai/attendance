/**
 * 공통 유틸리티 함수
 */

/** 오늘 날짜를 YYYY-MM-DD 형식으로 반환 */
function getTodayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** 현재 시각을 HH:MM 형식으로 반환 */
function getCurrentTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** 현재 날짜+시각을 YYYY-MM-DD HH:MM:SS 형식으로 반환 */
function getNowDateTimeStr() {
  const now = new Date();
  return `${getTodayStr()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/** SHA-256 해시 생성 */
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** 고유 ID 생성 (타임스탬프 기반) */
function generateId(prefix = 'ID') {
  return `${prefix}${Date.now()}`;
}

/** 날짜 포맷 변환 (YYYY-MM-DD → M월 D일) */
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const [, month, day] = dateStr.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

/** 시간 비교: time1 > time2 이면 true (HH:MM 형식) */
function isLater(time1, time2) {
  if (!time1 || !time2) return false;
  return time1.replace(':', '') > time2.replace(':', '');
}

/** 두 시간의 차이를 분으로 반환 (HH:MM 형식) */
function diffMinutes(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/** 분을 시간:분 형식으로 변환 */
function minutesToHHMM(minutes) {
  if (minutes <= 0) return '0분';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

/** sessionStorage에서 로그인된 사용자 정보 반환 */
function getUser() {
  const raw = sessionStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

/** 로그인된 사용자가 없으면 로그인 페이지로 이동 */
function requireAuth() {
  const user = getUser();
  if (!user) {
    window.location.href = 'index.html';
    return null;
  }
  return user;
}

/** 관리자만 접근 가능 */
function requireAdmin() {
  const user = requireAuth();
  if (user && user.role !== '관리자') {
    window.location.href = 'my-page.html';
    return null;
  }
  return user;
}

/** 토스트 알림 표시 */
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : 'success'}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/** 확인 팝업 (Promise 기반) */
function confirmDialog(message, confirmText = '확인', cancelText = '취소') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';

    overlay.innerHTML = `
      <div class="confirm-box">
        <p>${message}</p>
        <div class="confirm-actions">
          <button class="btn btn-outline" id="dialogCancel">${cancelText}</button>
          <button class="btn btn-primary" id="dialogConfirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#dialogConfirm').addEventListener('click', () => {
      overlay.remove();
      resolve(true);
    });
    overlay.querySelector('#dialogCancel').addEventListener('click', () => {
      overlay.remove();
      resolve(false);
    });
  });
}

/** 로딩 스피너 표시/숨기기 */
function setLoading(visible) {
  const loader = document.getElementById('globalLoader');
  if (loader) loader.style.display = visible ? 'flex' : 'none';
}

/** 오류 메시지 표시 (API 장애 등) */
function showApiError(message = '서버 연결에 문제가 있습니다. 관리자에게 수동 입력을 요청하세요.') {
  showToast(message, 'error');
}

/** 헤더에 사용자 이름 표시 */
function renderUserInfo() {
  const user = getUser();
  const el = document.getElementById('userNameDisplay');
  if (el && user) el.textContent = `${user.name} (${user.role})`;
}

/** 로그아웃 */
function logout() {
  sessionStorage.removeItem('user');
  window.location.href = 'index.html';
}

/** 사이드바 렌더링 */
function renderSidebar(user) {
  const currentPage = location.pathname.split('/').pop() || 'index.html';

  const adminLinks = [
    { href: 'admin-dashboard.html', label: '대시보드',   icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/></svg>' },
    { href: 'attendance.html',      label: '출퇴근 기록', icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' },
    { href: 'employee-list.html',   label: '직원 관리',   icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>' },
    { href: 'schedule.html',        label: '스케줄 관리', icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>' },
    { href: 'leave.html',           label: '휴가 관리',   icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>', badge: true },
  ];

  const employeeLinks = [
    { href: 'my-page.html',    label: '내 정보',   icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>' },
    { href: 'attendance.html', label: '출퇴근',    icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>' },
    { href: 'leave.html',      label: '휴가 신청', icon: '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>' },
  ];

  const links = user.role === '관리자' ? adminLinks : employeeLinks;
  const isAdmin = user.role === '관리자';

  const sidebarHTML = `
    <div class="sidebar-logo">
      <h1>bkl <span>HR</span></h1>
      <div class="role-badge">${isAdmin ? '관리자' : '직원'}</div>
    </div>
    <nav>
      <div class="nav-section">
        <div class="nav-section-title">메뉴</div>
        ${links.map(l => `
          <a href="${l.href}" class="nav-item${currentPage === l.href ? ' active' : ''}">
            ${l.icon}
            ${l.label}
            ${l.badge ? '<span class="nav-badge pending-leave-badge">0</span>' : ''}
          </a>
        `).join('')}
      </div>
    </nav>
    <div class="sidebar-footer">
      <div class="user-info">
        <div class="user-avatar">${user.name ? user.name[0] : '?'}</div>
        <div>
          <div class="user-name">${user.name}</div>
          <div class="user-role-text">${isAdmin ? 'Administrator' : 'Artist'}</div>
        </div>
      </div>
      <button class="btn-logout" onclick="logout()">로그아웃</button>
    </div>
  `;

  let sidebar = document.getElementById('sidebar');
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    sidebar.id = 'sidebar';
    document.body.insertBefore(sidebar, document.body.firstChild);
  }
  sidebar.innerHTML = sidebarHTML;

  // 모바일 토글 버튼
  let toggle = document.getElementById('mobileToggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.className = 'mobile-toggle';
    toggle.id = 'mobileToggle';
    toggle.setAttribute('aria-label', '메뉴 열기');
    toggle.innerHTML = '<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h14M3 10h14M3 14h14"/></svg>';
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.body.insertBefore(toggle, document.body.firstChild);
  }
}

/** renderNavLinks는 renderSidebar로 대체 (하위 호환) */
function renderNavLinks(user) {
  renderSidebar(user);
}

/** renderHeader는 사이드바 레이아웃에서 사용 안 함 (하위 호환) */
function renderHeader() {}

/** 탭 전환 초기화 */
function initTabs(defaultTab) {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  function activateTab(tabId) {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
    panels.forEach(p => p.classList.toggle('active', p.id === tabId));
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });

  activateTab(defaultTab || buttons[0]?.dataset.tab);
}
