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
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('toast-show'), 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/** 확인 팝업 (Promise 기반) */
function confirmDialog(message, confirmText = '확인', cancelText = '취소') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    overlay.innerHTML = `
      <div class="dialog-box">
        <p class="dialog-message">${message}</p>
        <div class="dialog-actions">
          <button class="btn btn-outline" id="dialogCancel">${cancelText}</button>
          <button class="btn btn-primary" id="dialogConfirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    setTimeout(() => overlay.classList.add('dialog-show'), 10);

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

/** 역할에 따라 네비게이션 링크 렌더링 */
function renderNavLinks(user) {
  const navEl = document.getElementById('navLinks');
  const mobileNavEl = document.getElementById('mobileNavLinks');
  if (!navEl) return;

  const currentPage = location.pathname.split('/').pop() || 'index.html';

  const adminLinks = [
    { href: 'admin-dashboard.html', label: '대시보드', icon: '📊' },
    { href: 'attendance.html',      label: '출퇴근 기록',  icon: '⏰' },
    { href: 'employee-list.html',   label: '직원 관리',  icon: '👥' },
    { href: 'schedule.html',        label: '스케줄',     icon: '📅' },
    { href: 'leave.html',           label: '휴가 관리',  icon: '🏖️', badge: true },
  ];

  const employeeLinks = [
    { href: 'my-page.html',    label: '내 정보',    icon: '👤' },
    { href: 'attendance.html', label: '출퇴근',     icon: '⏰' },
    { href: 'leave.html',      label: '휴가 신청',  icon: '🏖️' },
  ];

  const links = user.role === '관리자' ? adminLinks : employeeLinks;

  const renderLinks = (target) => {
    target.innerHTML = links.map(l => `
      <a href="${l.href}" class="nav-link${currentPage === l.href ? ' active' : ''}" aria-current="${currentPage === l.href ? 'page' : 'false'}">
        <span aria-hidden="true">${l.icon}</span>
        ${l.label}
        ${l.badge ? '<span class="nav-badge pending-leave-badge" style="display:none">0</span>' : ''}
      </a>
    `).join('');
  };

  renderLinks(navEl);
  if (mobileNavEl) renderLinks(mobileNavEl);

  // 모바일 메뉴 토글
  const hamburger = document.getElementById('hamburgerBtn');
  if (hamburger && mobileNavEl) {
    hamburger.addEventListener('click', () => {
      mobileNavEl.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', mobileNavEl.classList.contains('open'));
    });
  }
}

/** 페이지 공통 헤더 HTML 삽입 */
function renderHeader() {
  const headerEl = document.getElementById('siteHeader');
  if (!headerEl) return;

  headerEl.innerHTML = `
    <div class="header-inner">
      <a class="logo" href="#" aria-label="홈">
        <div class="logo-icon" aria-hidden="true">🎨</div>
        <span>출퇴근 관리</span>
      </a>
      <nav class="nav" id="navLinks" aria-label="주 메뉴"></nav>
      <div class="header-user">
        <span class="user-name" id="userNameDisplay"></span>
        <button class="btn btn-ghost btn-sm" onclick="logout()">로그아웃</button>
        <button class="hamburger" id="hamburgerBtn" aria-label="메뉴 열기" aria-expanded="false">☰</button>
      </div>
    </div>
    <nav class="mobile-nav" id="mobileNavLinks" aria-label="모바일 메뉴"></nav>
  `;
}

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
