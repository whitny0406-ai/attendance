/**
 * 인증 모듈
 * 위협 모델: URL을 모르는 외부인 접근 차단
 * 방식: 직원ID + 비밀번호(SHA-256 해시) + sessionStorage
 */

/** 로그인 처리 */
async function login(employeeId, password) {
  // 직원 목록 전체 조회 (읽기 전용 API 키 사용)
  const employees = await fetchEmployees();

  const employee = employees.find(e => e['직원ID'] === employeeId);

  if (!employee) {
    throw new Error('직원ID를 찾을 수 없습니다.');
  }

  if (employee['상태'] === '퇴직') {
    throw new Error('퇴직한 직원입니다. 관리자에게 문의하세요.');
  }

  // 비밀번호 해시 비교
  const inputHash = await sha256(password);
  if (inputHash !== employee['비밀번호(해시)']) {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }

  // sessionStorage에 저장 (탭 닫으면 자동 초기화)
  const userInfo = {
    employeeId: employee['직원ID'],
    name: employee['이름'],
    role: employee['권한(관리자/직원)'],
    department: employee['소속'],
    jobTitle: employee['직종'],
    scheduledIn: employee['예정출근시간'] || '',
    scheduledOut: employee['예정퇴근시간'] || '',
  };

  sessionStorage.setItem('user', JSON.stringify(userInfo));
  return userInfo;
}

/** 로그인 페이지 초기화 */
function initLoginPage() {
  // 이미 로그인된 경우 리다이렉트
  const user = getUser();
  if (user) {
    redirectByRole(user);
    return;
  }

  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = '로그인 중...';

    const employeeId = document.getElementById('employeeId').value.trim();
    const password = document.getElementById('password').value;

    if (!employeeId || !password) {
      errorEl.textContent = '직원ID와 비밀번호를 입력하세요.';
      submitBtn.disabled = false;
      submitBtn.textContent = '로그인';
      return;
    }

    try {
      const user = await login(employeeId, password);
      redirectByRole(user);
    } catch (err) {
      errorEl.textContent = err.message || '로그인에 실패했습니다.';
      submitBtn.disabled = false;
      submitBtn.textContent = '로그인';
    }
  });
}

/** 역할에 따라 적절한 페이지로 이동 */
function redirectByRole(user) {
  if (user.role === '관리자') {
    window.location.href = 'admin-dashboard.html';
  } else {
    window.location.href = 'my-page.html';
  }
}
