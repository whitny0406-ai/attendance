/* 공통 유틸리티 */
const U = {
  escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  },

  async sha256(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  },

  // 바이트 → latin1 문자열 (PDF 원시 구조 검색용)
  bytesToLatin1(bytes) {
    let out = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return out;
  },

  pad(n) { return String(n).padStart(2, '0'); },

  fmtDate(d) {
    if (!d || isNaN(d)) return '-';
    return `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-${U.pad(d.getDate())}`;
  },

  fmtDateTime(d) {
    if (!d || isNaN(d)) return '-';
    return `${U.fmtDate(d)} ${U.pad(d.getHours())}:${U.pad(d.getMinutes())}:${U.pad(d.getSeconds())}`;
  },

  // PDF 날짜 문자열 "D:20240305101010+09'00'" → Date
  parsePdfDate(s) {
    if (!s) return null;
    if (s instanceof Date) return s;
    const m = String(s).match(/D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+\-])?(\d{2})?'?(\d{2})?/);
    if (!m) {
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }
    const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
    let iso = `${y}-${mo}-${d}T${h}:${mi}:${se}`;
    if (tz === 'Z' || tz === 'z') iso += 'Z';
    else if (tz === '+' || tz === '-') iso += `${tz}${th}:${tm}`;
    const dt = new Date(iso);
    return isNaN(dt) ? null : dt;
  },

  today() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  },

  daysBetween(a, b) { return Math.round((b - a) / 86400000); },

  median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },

  // 반올림 (소수 d자리)
  roundTo(v, d) { const p = Math.pow(10, d); return Math.round(v * p + 1e-9) / p; },
  floorTo(v, d) { const p = Math.pow(10, d); return Math.floor(v * p + 1e-9) / p; },
  ceilTo(v, d) { const p = Math.pow(10, d); return Math.ceil(v * p - 1e-9) / p; },

  // 두 사각형(정규화 좌표)의 겹침 넓이 비율 (작은 쪽 기준)
  overlapRatio(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    if (x2 <= x1 || y2 <= y1) return 0;
    const inter = (x2 - x1) * (y2 - y1);
    return inter / Math.max(1e-9, Math.min(a.w * a.h, b.w * b.h));
  },

  unionBox(boxes) {
    if (!boxes.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const b of boxes) {
      x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  },

  // 정규화 영역에 약간 여백 추가
  padBox(b, px = 0.004, py = 0.003) {
    return { ...b, x: Math.max(0, b.x - px), y: Math.max(0, b.y - py), w: b.w + px * 2, h: b.h + py * 2 };
  },

  // 공백을 허용하는 키워드 정규식 조각 ("출석률" → "출\s*석\s*률")
  kw(word) {
    return [...word].map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  },

  compact(s) { return String(s || '').replace(/\s+/g, ''); },

  hasHangul(s) { return /[가-힣]/.test(s); },
  hasDigit(s) { return /\d/.test(s); },

  luma(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; },

  storage: {
    get(key, def) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
    }
  },

  // dHash (64bit, 16진 문자열) — 비슷한 문서 재사용 탐지용
  dHash(canvas) {
    const c = document.createElement('canvas');
    c.width = 9; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 9 + x) * 4, j = (y * 9 + x + 1) * 4;
        bits += U.luma(d[i], d[i + 1], d[i + 2]) > U.luma(d[j], d[j + 1], d[j + 2]) ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  },

  hamming(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return 64;
    let d = 0;
    for (let i = 0; i < h1.length; i++) {
      let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16);
      while (x) { d += x & 1; x >>= 1; }
    }
    return d;
  },

  canvasFromImage(img, maxDim = 2400) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height);
    return c;
  },

  loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없습니다.')); };
      img.src = url;
    });
  },

  // 텍스트 아이템들을 줄 단위로 묶기
  // item: {str, x, y, w, h} (정규화 좌표, 좌상단 원점)
  buildLines(items, pageIndex) {
    const sorted = items.filter(it => it.str && it.str.trim()).sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const lines = [];
    for (const it of sorted) {
      const yc = it.y + it.h / 2;
      let best = null, bestD = Infinity;
      for (let i = lines.length - 1; i >= Math.max(0, lines.length - 4); i--) {
        const ln = lines[i];
        const d = Math.abs(ln.yc - yc);
        if (d < 0.5 * Math.min(it.h, ln.h) && d < bestD) { best = ln; bestD = d; }
      }
      if (best) {
        best.items.push(it);
        best.yc = (best.yc * (best.items.length - 1) + yc) / best.items.length;
        best.h = Math.max(best.h, it.h);
      } else {
        lines.push({ page: pageIndex, yc, h: it.h, items: [it] });
      }
    }
    for (const ln of lines) {
      ln.items.sort((a, b) => a.x - b.x);
      let text = '';
      ln.spans = [];
      let prev = null;
      for (const it of ln.items) {
        if (prev) {
          const gap = it.x - (prev.x + prev.w);
          // 글자 인식(OCR)은 한글을 한 글자씩 끊어 읽는 경우가 많아 한글끼리는 더 넓은 간격일 때만 띄움
          const hangulOcr = it.source === 'ocr' && prev.source === 'ocr' && /[가-힣]$/.test(prev.str) && /^[가-힣]/.test(it.str);
          const need = gap > Math.min(it.h, prev.h) * (hangulOcr ? 0.45 : 0.22) && !/\s$/.test(text) && !/^\s/.test(it.str);
          if (need) text += ' ';
          // 칸 사이가 아주 넓으면 구분자 추가 (표 형태)
          if (gap > Math.min(it.h, prev.h) * 2.5) text += ' ';
        }
        const start = text.length;
        text += it.str;
        ln.spans.push({ start, end: text.length, item: it });
        prev = it;
      }
      ln.text = text;
      ln.box = U.unionBox(ln.items);
    }
    return lines;
  },

  // 줄 텍스트 내 [s,e) 구간에 해당하는 정규화 영역
  regionFor(line, s, e) {
    const boxes = [];
    for (const sp of line.spans) {
      if (sp.end <= s || sp.start >= e) continue;
      const it = sp.item;
      const len = Math.max(1, sp.end - sp.start);
      const a = Math.max(s, sp.start) - sp.start;
      const b = Math.min(e, sp.end) - sp.start;
      boxes.push({ x: it.x + it.w * (a / len), y: it.y, w: Math.max(it.w * ((b - a) / len), 0.004), h: it.h });
    }
    const u = U.unionBox(boxes);
    return u ? { page: line.page, ...U.padBox(u) } : null;
  }
};
