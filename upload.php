<?php
/**
 * 이미지 업로드 스크립트 (가비아 웹호스팅용)
 *
 * ▶ 설치 방법
 * ① 이 파일(upload.php)을 FileZilla로 웹사이트 루트 폴더에 업로드
 * ② 같은 위치에 uploads 폴더가 없으면 자동 생성됨 (쓰기 권한 필요 — 보통 기본 권한으로 충분)
 * ③ js/config.js 의 IMAGE_UPLOAD_URL 을
 *    'https://내도메인.com/upload.php' 로 설정
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  http_response_code(405);
  echo json_encode(['error' => 'POST 요청만 허용됩니다.']);
  exit;
}

$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!$data || empty($data['image'])) {
  http_response_code(400);
  echo json_encode(['error' => '이미지 데이터가 없습니다.']);
  exit;
}

$image  = $data['image'];
$prefix = isset($data['prefix']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $data['prefix']) : 'img';

// data:image/jpeg;base64,... 형태에서 형식과 데이터 분리 (이미지 외 형식은 거부)
if (!preg_match('/^data:image\/(jpeg|jpg|png|gif|webp);base64,(.+)$/', $image, $matches)) {
  http_response_code(400);
  echo json_encode(['error' => '지원하지 않는 이미지 형식입니다.']);
  exit;
}

$ext        = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
$binary     = base64_decode($matches[2]);

if ($binary === false) {
  http_response_code(400);
  echo json_encode(['error' => '이미지 디코딩에 실패했습니다.']);
  exit;
}

$maxBytes = 10 * 1024 * 1024; // 10MB
if (strlen($binary) > $maxBytes) {
  http_response_code(413);
  echo json_encode(['error' => '이미지 용량은 10MB를 초과할 수 없습니다.']);
  exit;
}

$uploadDir = __DIR__ . '/uploads/';
if (!is_dir($uploadDir)) {
  mkdir($uploadDir, 0755, true);
}

// 고유 파일명 생성 (충돌 방지 + 추측 불가)
$fileName = $prefix . '_' . time() . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
$filePath = $uploadDir . $fileName;

if (file_put_contents($filePath, $binary) === false) {
  http_response_code(500);
  echo json_encode(['error' => '파일 저장에 실패했습니다. uploads 폴더 쓰기 권한을 확인하세요.']);
  exit;
}

$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://';
$host     = $_SERVER['HTTP_HOST'];
$basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['PHP_SELF'])), '/');

echo json_encode(['url' => $protocol . $host . $basePath . '/uploads/' . $fileName]);
