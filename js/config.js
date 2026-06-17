/**
 * 구글 시트 연동 설정
 * 아래 값들을 실제 값으로 교체하세요.
 * gsheet-setup-guide.md 참조
 */
const CONFIG = {
  // Google Cloud Console에서 발급받은 API 키 (읽기 전용)
  API_KEY: 'AIzaSyAte7dFTY1o1h3L-FX8oE2YHPqDfYMRfxw',

  // 구글 스프레드시트 URL에서 확인 가능한 ID
  // 예: https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
  SPREADSHEET_ID: '1vBE-9w2ncKs7mHXMf2TRngxUu23BkWK-l9svT1GLxIw',

  // Google Apps Script 웹앱 배포 후 발급된 URL (쓰기 전용)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycby8iPBHuD2-MMLPSedLjtXN7gHpR1GS70CR-zJai0YgTknlu4wKJyjatXMvCOlhSTA/exec',

  // 업무일지 이미지 업로드 처리 서버 (가비아 호스팅에 올린 upload.php 경로)
  // 같은 서버에 호스팅되므로 보통 상대경로로 충분합니다.
  IMAGE_UPLOAD_URL: 'upload.php',

  // 시트 탭 이름 (구글 시트의 탭 이름과 동일해야 함)
  SHEETS: {
    EMPLOYEES: '직원정보',
    ATTENDANCE: '출퇴근기록',
    LEAVE: '휴가신청',
    NOTICE: '공지사항',
    WORK_JOURNAL: '업무일지',
  },
};
