<?php
/**
 * 이미지 제공 스크립트
 * uploads/ 폴더의 이미지를 이 스크립트를 통해 제공합니다.
 * 사용 예: /serve.php?f=journal_1234_abcd.jpg
 */

header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

$file = isset($_GET['f']) ? basename($_GET['f']) : '';

// 이미지 확장자만 허용
if (!$file || !preg_match('/\.(jpg|jpeg|png|gif|webp)$/i', $file)) {
  http_response_code(404);
  exit;
}

$path = __DIR__ . '/uploads/' . $file;

if (!file_exists($path) || !is_file($path)) {
  http_response_code(404);
  exit;
}

$info = @getimagesize($path);
$mime = $info ? $info['mime'] : 'image/jpeg';

header('Content-Type: ' . $mime);
header('Cache-Control: public, max-age=86400');
header('Content-Length: ' . filesize($path));
readfile($path);
