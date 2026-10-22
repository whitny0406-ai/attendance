/* 이미지(JPG/PNG) · 스캔본 분석 + 글자 인식(OCR) */
const ImageAnalyzer = {
  ocrWorker: null,

  async open(job, log) {
    const img = await U.loadImageFromBlob(job.file);
    const canvas = U.canvasFromImage(img, 2400);
    job.doc.origSize = { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    job.doc.pages.push({ index: 0, canvas, width: canvas.width, height: canvas.height, items: [], whiteRects: [], images: [], annotations: [] });
    log(`이미지 크기 ${job.doc.origSize.w} × ${job.doc.origSize.h}px`);
    await this.ocrPages(job, log);
  },

  // ── 글자 인식 (Tesseract.js, 한국어+영어) ──
  async ensureOcr(log) {
    if (this.ocrWorker) return this.ocrWorker;
    if (typeof Tesseract === 'undefined') {
      log('글자 인식 엔진을 불러오는 중… (처음 한 번만, 약 10~20초)');
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = res; s.onerror = () => rej(new Error('글자 인식 엔진을 불러오지 못했습니다(인터넷 연결 확인).'));
        document.head.appendChild(s);
      });
    }
    let lastPct = -1;
    this.ocrWorker = await Tesseract.createWorker(['kor', 'eng'], 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.floor(m.progress * 10) * 10;
          if (pct !== lastPct) { lastPct = pct; log(`글자 인식 중… ${pct}%`, true); }
        }
      }
    });
    await this.ocrWorker.setParameters({ preserve_interword_spaces: '1' });
    return this.ocrWorker;
  },

  async ocrPages(job, log) {
    let worker;
    try { worker = await this.ensureOcr(log); }
    catch (e) {
      job.ocrFailed = true;
      job.add('warn', '텍스트 추출', '글자 인식(OCR) 실패', e.message + ' — 숫자·날짜 자동 검증을 하지 못했습니다. 직접 확인이 필요합니다.');
      return;
    }
    for (const pg of job.doc.pages.slice(0, 3)) {
      // 작은 이미지는 확대해서 인식률 향상
      let src = pg.canvas, k = 1;
      if (pg.width < 1600) {
        k = 1600 / pg.width;
        src = document.createElement('canvas');
        src.width = Math.round(pg.width * k); src.height = Math.round(pg.height * k);
        const cx = src.getContext('2d');
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(pg.canvas, 0, 0, src.width, src.height);
      }
      const { data } = await worker.recognize(src);
      const words = (data.words || []).filter(w => w.text && w.text.trim());
      for (const w of words) {
        const b = w.bbox;
        pg.items.push({
          str: w.text.trim(),
          x: b.x0 / k / pg.width, y: b.y0 / k / pg.height,
          w: (b.x1 - b.x0) / k / pg.width, h: (b.y1 - b.y0) / k / pg.height,
          px: { x: b.x0 / k, y: b.y0 / k, w: (b.x1 - b.x0) / k, h: (b.y1 - b.y0) / k },
          conf: w.confidence, source: 'ocr', page: pg.index, fontBase: 'OCR'
        });
      }
      log(`${pg.index + 1}쪽 글자 인식 완료: 단어 ${words.length}개 (평균 정확도 ${Math.round(data.confidence || 0)}%)`);
      if ((data.confidence || 0) < 55) {
        job.add('warn', '텍스트 추출', `${pg.index + 1}쪽 글자 인식 정확도가 낮음 (${Math.round(data.confidence || 0)}%)`,
          '사진이 흐리거나 기울어져 자동으로 읽은 숫자가 틀릴 수 있습니다. 자동 계산 결과를 그대로 믿지 말고 화면에서 직접 확인하세요.');
      }
    }
  },

  // ── 파일 내부 구조 (JPEG 마커 / PNG 청크) ──
  structure(job, log) {
    const b = job.bytes;
    const S = job.doc.structure = {};
    if (job.fileType === 'jpeg') {
      const segs = [];
      let i = 2, qtables = [];
      while (i + 4 < b.length && b[i] === 0xff) {
        const marker = b[i + 1];
        if (marker === 0xd9 || marker === 0xda) { segs.push({ marker, off: i }); break; }
        const len = (b[i + 2] << 8) | b[i + 3];
        const seg = b.subarray(i + 4, i + 2 + len);
        const head = String.fromCharCode(...seg.subarray(0, Math.min(30, seg.length)));
        segs.push({ marker, off: i, len, head });
        if (marker === 0xdb) {
          let p = 0;
          while (p < seg.length) {
            const pq = seg[p] >> 4, tq = seg[p] & 15; p++;
            const tbl = [];
            for (let k = 0; k < 64; k++) { tbl.push(pq ? (seg[p] << 8) | seg[p + 1] : seg[p]); p += pq ? 2 : 1; }
            qtables[tq] = tbl;
          }
        }
        i += 2 + len;
      }
      S.segments = segs.map(s => '0x' + s.marker.toString(16).toUpperCase() + (s.head ? `(${s.head.replace(/[^\x20-\x7e]/g, '').slice(0, 12)})` : ''));
      S.hasJFIF = segs.some(s => s.marker === 0xe0 && /JFIF/.test(s.head));
      S.hasExif = segs.some(s => s.marker === 0xe1 && /^Exif/.test(s.head));
      S.hasXmp = segs.some(s => s.marker === 0xe1 && /ns\.adobe\.com\/xap/.test(s.head));
      S.hasPhotoshop = segs.some(s => s.marker === 0xed && /Photoshop/.test(s.head));
      S.hasAdobe = segs.some(s => s.marker === 0xee && /Adobe/.test(s.head));
      S.quality = qtables[0] ? this.estimateQuality(qtables[0]) : null;
      // 파일 안에 JPEG 시작 표시가 여러 개(썸네일 외) 있는지
      let soi = 0;
      for (let k = 0; k + 2 < b.length; k++) if (b[k] === 0xff && b[k + 1] === 0xd8 && b[k + 2] === 0xff) soi++;
      S.soiCount = soi;
      log(`JPEG 품질 추정 ${S.quality ? S.quality + '%' : '-'} / EXIF ${S.hasExif ? '있음' : '없음'} / 포토샵 정보 ${S.hasPhotoshop ? '있음' : '없음'}`);

      if (S.hasPhotoshop) job.add('danger', '이미지', '포토샵 저장 정보(APP13) 포함', '이 사진은 Adobe Photoshop 계열 프로그램으로 저장된 흔적이 있습니다. 출석증 사진을 포토샵으로 다시 저장할 이유는 거의 없습니다.');
      else if (S.hasAdobe) job.add('warn', '이미지', 'Adobe 프로그램 저장 표시(APP14) 포함', 'Adobe 계열 프로그램에서 저장된 JPEG일 수 있습니다.');
      if (S.quality && S.quality < 70) job.add('info', '이미지', `압축 품질이 낮음 (약 ${S.quality}%)`, '메신저 전송 등으로 여러 번 압축된 이미지일 수 있습니다. 압축이 심하면 수정 흔적이 지워져 분석 정확도가 떨어집니다. 원본 파일을 요청하세요.');
    } else if (job.fileType === 'png') {
      const chunks = [];
      let i = 8;
      while (i + 8 < b.length) {
        const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
        const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
        if (type === 'tEXt' || type === 'iTXt') {
          const txt = String.fromCharCode(...b.subarray(i + 8, i + 8 + Math.min(len, 300)));
          chunks.push({ type, txt: txt.replace(/\0/g, ': ') });
        } else chunks.push({ type });
        i += 12 + len;
        if (type === 'IEND') break;
      }
      S.segments = chunks.map(c => c.type);
      S.pngText = chunks.filter(c => c.txt).map(c => c.txt);
      log(`PNG 블록: ${[...new Set(S.segments)].join(', ')}`);
      job.add('info', '이미지', 'PNG(무손실) 이미지', 'PNG는 압축 흔적이 남지 않아 압축오차(ELA) 분석이 어렵습니다. 화면 캡처본이라면 학원에 원본 PDF를 요청하는 것이 가장 확실합니다.');
    }
  },

  // 표준 휘도 양자화표와 비교해 JPEG 품질 추정
  estimateQuality(tbl) {
    const STD = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
    const sumT = tbl.reduce((a, b) => a + b, 0), sumS = STD.reduce((a, b) => a + b, 0);
    const scale = sumT / sumS * 100;
    const q = scale <= 100 ? (200 - scale) / 2 : 5000 / scale;
    return Math.max(1, Math.min(100, Math.round(q)));
  },

  // ── EXIF 메타데이터 + 썸네일 비교 ──
  async metadata(job, log) {
    const M = job.doc.meta = {};
    let ex = null;
    if (typeof exifr !== 'undefined') {
      try { ex = await exifr.parse(job.file, { tiff: true, exif: true, xmp: true, iptc: true, icc: false, mergeOutput: true }); }
      catch (e) { log('EXIF 읽기 실패: ' + e.message); }
    }
    ex = ex || {};
    M.make = ex.Make || ''; M.model = ex.Model || '';
    M.software = ex.Software || '';
    M.creatorTool = ex.CreatorTool || '';
    M.original = ex.DateTimeOriginal instanceof Date ? ex.DateTimeOriginal : null;
    M.modified = ex.ModifyDate instanceof Date ? ex.ModifyDate : null;
    M.creation = M.original || (ex.CreateDate instanceof Date ? ex.CreateDate : null);
    M.history = ex.HistorySoftwareAgent || ex.HistoryAction || '';
    M.raw = ex;
    log(`촬영기기: ${(M.make + ' ' + M.model).trim() || '-'} / 프로그램: ${M.software || M.creatorTool || '-'}`);

    const tools = [M.software, M.creatorTool, ...[].concat(M.history || [])].filter(Boolean).map(String);
    if (job.doc.structure && job.doc.structure.pngText) tools.push(...job.doc.structure.pngText.filter(t => /software/i.test(t)).map(t => t.replace(/^software:\s*/i, '')));
    M.tools = [...new Set(tools)];
    MetaRules.evaluateTools(job, M.tools, '이미지');

    if (!Object.keys(ex).length) {
      job.add('info', '메타데이터', '사진 정보(EXIF) 없음',
        '카카오톡 등 메신저로 받은 사진, 화면 캡처, 또는 편집 후 저장한 사진은 촬영 정보가 없습니다. 위변조 증거는 아니지만, 가능하면 휴대폰에서 찍은 원본 파일을 직접 받으세요.');
    } else if (M.make || M.model) {
      job.add('ok', '메타데이터', '촬영 기기 정보 확인', `${U.escapeHtml((M.make + ' ' + M.model).trim())}로 촬영된 사진입니다.` + (M.original ? ` 촬영 시각: ${U.fmtDateTime(M.original)}` : ''));
    }
    if (M.original && M.modified) {
      const diff = (M.modified - M.original) / 1000;
      if (diff > 120) job.add('warn', '메타데이터', '촬영 후 다시 저장된 기록', `촬영 ${U.fmtDateTime(M.original)} → 저장 ${U.fmtDateTime(M.modified)}. 촬영 후 편집 프로그램에서 다시 저장했을 수 있습니다.`);
    }
    if (M.creation && M.creation - new Date() > 86400000) {
      job.add('danger', '메타데이터', '촬영일이 미래 날짜', `${U.fmtDateTime(M.creation)} — 정상적인 사진이 아닙니다.`);
    }

    // 내장 썸네일과 실제 사진 비교 (사진만 고치고 썸네일은 그대로인 경우)
    if (job.fileType === 'jpeg' && typeof exifr !== 'undefined') {
      try {
        const th = await exifr.thumbnail(job.file);
        if (th && th.length > 500) {
          const timg = await U.loadImageFromBlob(new Blob([th], { type: 'image/jpeg' }));
          const diff = this.compareThumb(job.doc.pages[0].canvas, timg);
          job.doc.thumbnail = timg;
          log(`내장 썸네일 비교 차이값 ${diff.toFixed(1)}`);
          const ar1 = job.doc.origSize.w / job.doc.origSize.h, ar2 = timg.width / timg.height;
          if (Math.abs(ar1 - ar2) > 0.08 && Math.abs(ar1 - 1 / ar2) > 0.08) {
            job.add('warn', '이미지', '내장 썸네일과 사진 비율이 다름', '사진을 잘라내거나(크롭) 편집했지만 썸네일은 예전 모습이 남아 있을 수 있습니다. 결과의 "썸네일" 탭에서 비교해 보세요.');
          } else if (diff > 18) {
            job.add('danger', '이미지', '내장 썸네일과 실제 사진 내용이 다름', `파일 안에 저장된 작은 미리보기(썸네일)와 실제 사진이 다릅니다(차이값 ${diff.toFixed(1)}). 사진 내용을 고친 뒤 썸네일은 그대로 남은 경우입니다.`);
          } else {
            job.add('ok', '이미지', '내장 썸네일과 사진 일치', '사진 안의 미리보기 이미지와 실제 사진 내용이 같습니다.');
          }
        }
      } catch (e) { /* 썸네일 없음 */ }
    }
  },

  compareThumb(canvas, timg) {
    const W = 64, H = Math.max(8, Math.round(64 * timg.height / timg.width));
    const draw = (src) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0, W, H);
      const d = cx.getImageData(0, 0, W, H).data;
      const g = new Float32Array(W * H);
      for (let i = 0; i < g.length; i++) g[i] = U.luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      return g;
    };
    const a = draw(canvas), b = draw(timg);
    // 밝기 보정 후 평균 차이
    const ma = a.reduce((s, v) => s + v, 0) / a.length, mb = b.reduce((s, v) => s + v, 0) / b.length;
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs((a[i] - ma) - (b[i] - mb));
    return s / a.length;
  },

  // ── 픽셀 분석: ELA, 배경 일관성, OCR 기반 글자 크기/위치, 직인 ──
  async pixels(job, log) {
    const pages = job.doc.pages;
    const imageBased = job.kind === 'image' || job.doc.scanned || job.doc.hasOcrLayer;

    if (job.fileType === 'jpeg') {
      const pg = pages[0];
      const ela = await this.ela(pg.canvas);
      job.doc.ela = ela;
      log('압축오차(ELA) 지도 생성 완료');
      this.elaWords(job, pg, ela);
    }
    if (imageBased) {
      for (const pg of pages.slice(0, 3)) this.patchCheck(job, pg);
      for (const pg of pages.slice(0, 3)) this.backgroundCheck(job, pg);
    }
    for (const pg of pages.slice(0, 3)) this.findStamp(job, pg);
    const stamps = pages.filter(p => p.stamp);
    if (stamps.length) {
      job.add('info', '양식', '직인(붉은 도장)으로 보이는 영역 확인', '도장이 학원 이름과 맞는지, 흐릿하게 복사·붙여넣기 된 모양은 아닌지 눈으로 확인하세요.',
        stamps.map(p => ({ page: p.index, ...p.stamp, info: true })));
    } else {
      job.add('info', '양식', '직인(붉은 도장)이 보이지 않음', '대부분의 출석증에는 학원 직인이 찍혀 있습니다. 직인 없이 발급하는 학원인지 확인하세요. (흑백 스캔이라면 무시해도 됩니다)');
    }
  },

  async ela(canvas, quality = 0.9) {
    const W = canvas.width, H = canvas.height;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    const img = await U.loadImageFromBlob(blob);
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const cx2 = c2.getContext('2d', { willReadFrequently: true }); cx2.drawImage(img, 0, 0);
    const a = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const b = cx2.getImageData(0, 0, W, H).data;
    const diff = new Uint8Array(W * H);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < a.length; i += 4, p++) {
      const v = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      diff[p] = v; hist[v]++;
    }
    let acc = 0, p99 = 1;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= diff.length * 0.995) { p99 = Math.max(1, v); break; } }
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const ox = out.getContext('2d');
    const od = ox.createImageData(W, H);
    const k = 255 / p99;
    for (let p = 0; p < diff.length; p++) {
      const v = Math.min(255, diff[p] * k);
      // 어두운 남색 → 노랑 → 빨강 컬러맵
      od.data[p * 4] = Math.min(255, v * 1.6);
      od.data[p * 4 + 1] = Math.max(0, Math.min(255, v * 1.4 - 60));
      od.data[p * 4 + 2] = Math.max(0, 90 - v * 0.6);
      od.data[p * 4 + 3] = 255;
    }
    ox.putImageData(od, 0, 0);
    return { diff, W, H, canvas: out };
  },

  boxMean(arr, W, H, box) {
    const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(W, Math.ceil(box.x + box.w)), y1 = Math.min(H, Math.ceil(box.y + box.h));
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += arr[y * W + x]; n++; }
    return n ? s / n : 0;
  },

  elaWords(job, pg, ela) {
    const words = pg.items.filter(it => it.source === 'ocr' && (it.conf || 0) > 40 && it.px.w > 4);
    if (words.length < 6) return;
    const vals = words.map(w => this.boxMean(ela.diff, ela.W, ela.H, w.px));
    const med = U.median(vals);
    const mad = U.median(vals.map(v => Math.abs(v - med))) * 1.4826 + 0.3;
    const sus = [];
    words.forEach((w, i) => {
      if (!/\d/.test(w.str)) return;
      const z = (vals[i] - med) / mad;
      if (z > 4 && vals[i] > med * 1.8) sus.push({ w, v: vals[i], z });
    });
    if (sus.length) {
      job.add('warn', '이미지', `압축 흔적이 주변과 다른 숫자 ${sus.length}곳`,
        `다른 글자들보다 압축오차(ELA)가 유난히 큰 숫자입니다. 그 부분만 나중에 붙여넣거나 고쳐 그렸을 때 나타납니다. 'ELA 분석' 탭에서 해당 부분만 밝게 빛나는지 확인하세요.<br>` +
        sus.slice(0, 8).map(s => `• "${U.escapeHtml(s.w.str)}" (주변 평균의 ${(s.v / Math.max(0.1, med)).toFixed(1)}배)`).join('<br>'),
        sus.map(s => ({ page: pg.index, ...U.padBox(s.w) })));
    } else {
      job.add('ok', '이미지', '숫자 부분의 압축 흔적이 주변과 비슷함', '숫자만 따로 붙여넣은 흔적(압축오차 차이)은 발견되지 않았습니다.');
    }
  },

  // 종이 질감(잡티)이 없는 매끈한 영역 찾기 — 흰색으로 덧칠하거나 다른 조각을 붙인 자리
  patchCheck(job, pg) {
    const W = pg.width, H = pg.height, B = 8;
    const bw = Math.floor(W / B), bh = Math.floor(H / B);
    if (bw < 20 || bh < 20) return;
    const d = pg.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, bw * B, bh * B).data;
    const rowW = bw * B;
    const mean = new Float32Array(bw * bh), sd = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let s = 0, s2 = 0;
      for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
        const i = ((by * B + y) * rowW + bx * B + x) * 4;
        const l = U.luma(d[i], d[i + 1], d[i + 2]);
        s += l; s2 += l * l;
      }
      const m = s / 64, k = by * bw + bx;
      mean[k] = m; sd[k] = Math.sqrt(Math.max(0, s2 / 64 - m * m));
    }
    const bright = [];
    for (let k = 0; k < mean.length; k++) if (mean[k] > 150) bright.push(k);
    if (bright.length < 100) return;
    const paperSd = U.median(bright.map(k => sd[k])), paperMean = U.median(bright.map(k => mean[k]));
    pg.paper = { sd: paperSd, mean: paperMean };
    if (paperSd < 1.5) return; // 잡티가 없는 디지털 이미지(캡처 등)는 이 검사가 의미 없음
    const flatThr = Math.max(0.6, paperSd * 0.25);
    const flat = new Uint8Array(mean.length);
    for (const k of bright) if (sd[k] < flatThr) flat[k] = 1;

    // 연결된 매끈한 블록 묶기
    const seen = new Uint8Array(mean.length), comps = [];
    for (let k = 0; k < flat.length; k++) {
      if (!flat[k] || seen[k]) continue;
      const q = [k]; seen[k] = 1;
      let x1 = bw, y1 = bh, x2 = 0, y2 = 0, n = 0, ms = 0, edge = false;
      while (q.length) {
        const c = q.pop(), cx = c % bw, cy = (c / bw) | 0;
        n++; ms += mean[c];
        x1 = Math.min(x1, cx); y1 = Math.min(y1, cy); x2 = Math.max(x2, cx); y2 = Math.max(y2, cy);
        if (cx === 0 || cy === 0 || cx === bw - 1 || cy === bh - 1) edge = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const nk = ny * bw + nx;
          if (flat[nk] && !seen[nk]) { seen[nk] = 1; q.push(nk); }
        }
      }
      if (n >= 4 && !edge) comps.push({ x1, y1, x2, y2, n, m: ms / n });
    }
    // 가까운 조각 합치기
    const merged = [];
    for (const c of comps.sort((a, b) => b.n - a.n)) {
      const t = merged.find(m => c.x1 <= m.x2 + 2 && c.x2 >= m.x1 - 2 && c.y1 <= m.y2 + 2 && c.y2 >= m.y1 - 2);
      if (t) { t.x1 = Math.min(t.x1, c.x1); t.y1 = Math.min(t.y1, c.y1); t.x2 = Math.max(t.x2, c.x2); t.y2 = Math.max(t.y2, c.y2); t.m = (t.m * t.n + c.m * c.n) / (t.n + c.n); t.n += c.n; }
      else merged.push({ ...c });
    }
    const patches = merged.map(c => ({
      box: { x: c.x1 * B / W, y: c.y1 * B / H, w: (c.x2 - c.x1 + 1) * B / W, h: (c.y2 - c.y1 + 1) * B / H },
      diff: c.m - paperMean, n: c.n
    })).filter(p => p.box.w * p.box.h < 0.03);
    if (!patches.length) {
      job.add('ok', '이미지', '덧칠한 듯한 매끈한 영역 없음', `종이 질감(잡티 세기 ${paperSd.toFixed(1)})이 문서 전체에 고르게 있습니다.`);
      return;
    }
    const strong = patches.filter(p => Math.abs(p.diff) > 6);
    job.add(strong.length ? 'danger' : 'warn', '이미지', `종이 질감이 사라진 매끈한 영역 ${patches.length}곳`,
      `사진·스캔한 종이에는 어디에나 미세한 잡티가 있는데, 표시한 곳만 잡티가 전혀 없이 매끈합니다. 흰색으로 덧칠하거나 다른 이미지 조각을 붙인 자리에서 나타나는 특징입니다.` +
      (strong.length ? `<br>그중 ${strong.length}곳은 주변 종이보다 색도 ${strong.map(p => (p.diff > 0 ? '+' : '') + Math.round(p.diff)).join(', ')}만큼 다릅니다(더 하얗거나 어두움).` : ''),
      patches.map(p => ({ page: pg.index, ...U.padBox(p.box, 0.006, 0.004) })));
  },

  // 숫자 주변 배경이 같은 줄 다른 글자와 다른지 (덧칠/붙여넣기)
  backgroundCheck(job, pg) {
    const ctx = pg.canvas.getContext('2d', { willReadFrequently: true });
    const lines = job.doc.lines.filter(l => l.page === pg.index);
    const stat = (it) => {
      const padY = it.px.h * 0.2, padX = it.px.h * 0.15;
      const x = Math.max(0, Math.floor(it.px.x - padX)), y = Math.max(0, Math.floor(it.px.y - padY));
      const w = Math.min(pg.width - x, Math.ceil(it.px.w + padX * 2)), h = Math.min(pg.height - y, Math.ceil(it.px.h + padY * 2));
      if (w < 4 || h < 4) return null;
      const d = ctx.getImageData(x, y, w, h).data;
      const ls = [];
      for (let i = 0; i < d.length; i += 4) ls.push(U.luma(d[i], d[i + 1], d[i + 2]));
      const thr = this.otsu(ls);
      const bg = ls.filter(v => v > thr);
      if (bg.length < 10) return null;
      const mean = bg.reduce((a, b) => a + b, 0) / bg.length;
      const sd = Math.sqrt(bg.reduce((a, b) => a + (b - mean) * (b - mean), 0) / bg.length);
      return { mean, sd };
    };
    const sus = [];
    // 줄에 비교할 글자가 적으면(예: "출석률  90%") 같은 쪽의 일반 글자 전체와 비교
    const pageStats = lines.flatMap(l => l.items).filter(it => it.source === 'ocr' && it.px && it.px.w > 3 && !/\d/.test(it.str) && (it.conf || 0) > 60).slice(0, 80).map(stat).filter(Boolean);
    for (const ln of lines) {
      const its = ln.items.filter(it => it.source === 'ocr' && it.px && it.px.w > 3);
      if (!its.length) continue;
      const stats = its.map(stat);
      its.forEach((it, i) => {
        if (!/\d/.test(it.str) || !stats[i]) return;
        let peers = stats.filter((s, j) => j !== i && s && !/\d/.test(its[j].str));
        if (peers.length < 2) peers = pageStats;
        if (peers.length < 2) return;
        const pm = U.median(peers.map(s => s.mean)), ps = U.median(peers.map(s => s.sd));
        const reasons = [];
        if (Math.abs(stats[i].mean - pm) > Math.max(10, 3.5 * ps)) reasons.push(`배경 밝기 차이 ${Math.round(stats[i].mean - pm)}`);
        if (ps > 3 && stats[i].sd < ps * 0.35) reasons.push('배경이 지나치게 매끈함(잡티 없음)');
        if (reasons.length) sus.push({ it, reasons });
      });
    }
    if (sus.length) {
      job.add('warn', '이미지', `숫자 주변 배경이 같은 줄과 다름 (${sus.length}곳)`,
        '사진/스캔본은 종이 질감 때문에 배경에 고른 잡티가 있습니다. 숫자 주변만 배경색이 다르거나 너무 깨끗하면 지우고 다시 쓴 흔적일 수 있습니다.<br>' +
        sus.slice(0, 8).map(s => `• "${U.escapeHtml(s.it.str)}": ${s.reasons.join(', ')}`).join('<br>'),
        sus.map(s => ({ page: pg.index, ...U.padBox(s.it) })));
    } else if (lines.length) {
      job.add('ok', '이미지', '숫자 주변 배경이 자연스러움', '숫자 주변 배경의 밝기·잡티가 같은 줄의 다른 글자와 비슷합니다.');
    }
  },

  otsu(values) {
    const hist = new Array(256).fill(0);
    for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
    const total = values.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sumB += t * hist[t];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  },

  // OCR 단어 기준 숫자 크기·높이 비교
  ocrGeometry(job) {
    const sus = [];
    // 문서 전체는 잘 읽히는데 숫자만 유난히 안 읽히는 경우 (번짐·덧칠·합성 가능성)
    const all = job.doc.lines.flatMap(l => l.items).filter(it => it.source === 'ocr');
    const medConf = U.median(all.map(it => it.conf || 0));
    const blurry = medConf > 85 ? all.filter(it => /\d/.test(it.str) && (it.conf || 0) < 45) : [];
    if (blurry.length) {
      job.add('warn', '글꼴·배치', `다른 글자는 잘 읽히는데 숫자만 인식이 잘 안 됨 (${blurry.length}곳)`,
        `문서 전체 인식 정확도는 ${Math.round(medConf)}%인데 표시한 숫자는 ${blurry.map(b => Math.round(b.conf)).join(', ')}%입니다. 해당 부분이 번지거나 덧칠·합성되어 글자 모양이 주변과 다를 수 있으니 눈으로 확인하세요.`,
        blurry.map(b => ({ page: b.page, ...U.padBox(b) })));
    }
    for (const ln of job.doc.lines) {
      const its = ln.items.filter(it => it.source === 'ocr' && (it.conf || 0) > 50);
      const nums = its.filter(it => /^[\d.,%:\/\-~()]+$/.test(it.str) && /\d{1,}/.test(it.str) && it.str.replace(/\D/g, '').length >= 1);
      if (nums.length < 1 || its.length < 3) continue;
      const otherH = its.filter(it => !nums.includes(it)).map(it => it.px.h);
      const otherB = its.filter(it => !nums.includes(it)).map(it => it.px.y + it.px.h);
      if (otherH.length < 2) continue;
      const mh = U.median(otherH), mb = U.median(otherB);
      for (const n of nums) {
        const r = [];
        if (n.px.h > mh * 1.3 || n.px.h < mh * 0.6) r.push(`글자 높이가 주변의 ${Math.round(n.px.h / mh * 100)}%`);
        if (Math.abs(n.px.y + n.px.h - mb) > mh * 0.35) r.push('밑선 높이가 어긋남');
        if (r.length) sus.push({ n, r, page: ln.page });
      }
    }
    if (sus.length) {
      job.add('warn', '글꼴·배치', `크기·높이가 주변과 다른 숫자 ${sus.length}곳`,
        '같은 줄의 다른 글자에 비해 크기나 줄 높이가 어긋난 숫자입니다(사진 기울기·인식 오차일 수도 있음).<br>' +
        sus.slice(0, 8).map(s => `• "${U.escapeHtml(s.n.str)}": ${s.r.join(', ')}`).join('<br>'),
        sus.map(s => ({ page: s.page, ...U.padBox(s.n) })));
    }
  },

  findStamp(job, pg) {
    const S = 300;
    const k = Math.min(1, S / Math.max(pg.width, pg.height));
    const w = Math.max(1, Math.round(pg.width * k)), h = Math.max(1, Math.round(pg.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(pg.canvas, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let x1 = w, y1 = h, x2 = -1, y2 = -1, n = 0;
    // 붉은 픽셀이 가장 많이 모인 영역 찾기 (격자 6px)
    const G = 6, gw = Math.ceil(w / G), gh = Math.ceil(h / G), grid = new Uint16Array(gw * gh);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] > 130 && d[i] - d[i + 1] > 55 && d[i] - d[i + 2] > 35) { grid[Math.floor(y / G) * gw + Math.floor(x / G)]++; n++; }
    }
    if (n < 25) return;
    let best = -1, bi = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > best) { best = grid[i]; bi = i; }
    const cxg = bi % gw, cyg = Math.floor(bi / gw);
    // 주변 확장
    const R = 6;
    for (let gy = Math.max(0, cyg - R); gy <= Math.min(gh - 1, cyg + R); gy++) for (let gx = Math.max(0, cxg - R); gx <= Math.min(gw - 1, cxg + R); gx++) {
      if (grid[gy * gw + gx] >= 3) { x1 = Math.min(x1, gx * G); y1 = Math.min(y1, gy * G); x2 = Math.max(x2, gx * G + G); y2 = Math.max(y2, gy * G + G); }
    }
    if (x2 < 0) return;
    const box = { x: x1 / w, y: y1 / h, w: (x2 - x1) / w, h: (y2 - y1) / h };
    if (box.w * box.h < 0.0008) return;
    pg.stamp = box;
  }
};
