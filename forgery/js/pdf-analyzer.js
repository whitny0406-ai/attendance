/* PDF 내부 구조 · 메타데이터 · 글꼴/배치 분석 */
const PdfAnalyzer = {
  MAX_PAGES: 10,

  // ── 1. 문서 열기 + 렌더링 + 텍스트 레이어 추출 ──
  async open(job, log) {
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({ data: job.bytes.slice(), isEvalSupported: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('암호가 걸린 PDF입니다. 암호를 해제한 파일을 요청하세요.');
      throw new Error('PDF를 열 수 없습니다. 파일이 손상되었을 수 있습니다. (' + (e.message || e) + ')');
    }
    job.pdf = pdf;
    job.doc.numPages = pdf.numPages;
    const n = Math.min(pdf.numPages, this.MAX_PAGES);
    if (pdf.numPages > n) log(`페이지가 많아 앞의 ${n}쪽만 분석합니다.`);

    for (let p = 1; p <= n; p++) {
      const page = await pdf.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(3, 1400 / vp1.width);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const opList = await page.getOperatorList();
      const tc = await page.getTextContent();
      const items = [];
      for (const it of tc.items) {
        if (typeof it.str !== 'string' || !it.str.trim()) continue;
        const tx = pdfjsLib.Util.transform(vp.transform, it.transform);
        const fh = Math.hypot(tx[2], tx[3]);
        const rotated = Math.abs(tx[1]) > 0.01 * fh || Math.abs(tx[2]) > 0.01 * fh;
        let w = (it.width || 0) * scale;
        if (!w) w = it.str.length * fh * 0.55;
        let realName = null;
        try {
          if (page.commonObjs.has(it.fontName)) {
            const f = page.commonObjs.get(it.fontName);
            realName = f && (f.name || null);
          }
        } catch (e) { /* 무시 */ }
        const style = tc.styles[it.fontName] || {};
        realName = realName || style.fontFamily || it.fontName;
        const prefixM = realName.match(/^([A-Z]{6})\+(.+)$/);
        items.push({
          str: it.str,
          x: tx[4] / vp.width,
          y: (tx[5] - fh * 0.85) / vp.height,
          w: w / vp.width,
          h: fh / vp.height,
          px: { x: tx[4], y: tx[5] - fh * 0.85, w, h: fh },
          sizePt: Math.hypot(it.transform[2], it.transform[3]),
          baselinePt: it.transform[5],
          fontId: it.fontName,
          font: realName,
          fontBase: prefixM ? prefixM[2] : realName,
          subset: prefixM ? prefixM[1] : null,
          rotated,
          source: 'text',
          page: p - 1
        });
      }

      const ops = this.analyzeOps(opList, vp);
      let annotations = [];
      try { annotations = await page.getAnnotations(); } catch (e) { /* 무시 */ }

      job.doc.pages.push({
        index: p - 1, canvas, width: canvas.width, height: canvas.height,
        ptWidth: vp1.width, ptHeight: vp1.height, viewport: vp,
        items, whiteRects: ops.whiteRects, images: ops.images, annotations
      });
      log(`${p}쪽: 텍스트 조각 ${items.length}개, 이미지 ${ops.images.length}개`);
    }

    // 스캔본(이미지로만 된 PDF) 판별
    const totalChars = job.doc.pages.reduce((s, pg) => s + pg.items.reduce((a, it) => a + it.str.trim().length, 0), 0);
    const bigImage = job.doc.pages.some(pg => pg.images.some(im => im.w * im.h > 0.6));
    job.doc.scanned = totalChars < 15 || (bigImage && totalChars < 40);
    job.doc.hasOcrLayer = !job.doc.scanned && bigImage;
    if (job.doc.scanned) log('글자 정보가 없는 스캔/사진 PDF입니다. 글자 인식(OCR)으로 전환합니다.');
    else if (job.doc.hasOcrLayer) log('스캔 이미지 위에 글자 레이어가 있는 PDF입니다.');
  },

  // 그리기 명령 분석: 흰색 채움 사각형, 이미지 배치 위치
  analyzeOps(opList, vp) {
    const OPS = pdfjsLib.OPS;
    const T = pdfjsLib.Util.transform;
    let ctm = [1, 0, 0, 1, 0, 0];
    let fillWhite = false;
    let pathBox = null;
    const stack = [];
    const whiteRects = [], images = [];
    const W = vp.width, H = vp.height;

    const boxFrom = (m, x1, y1, x2, y2) => {
      const full = T(vp.transform, m);
      const pts = [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].map(([x, y]) => [
        full[0] * x + full[2] * y + full[4], full[1] * x + full[3] * y + full[5]
      ]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const bx = Math.min(...xs), by = Math.min(...ys);
      return { x: bx / W, y: by / H, w: (Math.max(...xs) - bx) / W, h: (Math.max(...ys) - by) / H };
    };
    const isWhite = (args) => {
      if (!args) return false;
      const a0 = args[0];
      if (typeof a0 === 'string') {
        const m = a0.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        return !!m && [m[1], m[2], m[3]].every(h => parseInt(h, 16) >= 245);
      }
      const vals = Array.from(a0 && a0.length ? a0 : args).map(Number).filter(v => !isNaN(v));
      if (vals.length === 1) return vals[0] >= 0.97 && vals[0] <= 1 || vals[0] >= 245;
      if (vals.length === 4) return vals.every(v => v <= 0.03);
      if (vals.length !== 3) return false;
      const max = Math.max(...vals);
      return max > 1 ? vals.every(v => v >= 245) : vals.every(v => v >= 0.96);
    };

    const { fnArray, argsArray } = opList;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i], args = argsArray[i];
      switch (fn) {
        case OPS.save: stack.push([ctm, fillWhite]); break;
        case OPS.restore: { const s = stack.pop(); if (s) [ctm, fillWhite] = s; break; }
        case OPS.transform: ctm = T(ctm, args); break;
        case OPS.paintFormXObjectBegin:
          stack.push([ctm, fillWhite]);
          if (args && args[0]) ctm = T(ctm, args[0]);
          break;
        case OPS.paintFormXObjectEnd: { const s = stack.pop(); if (s) [ctm, fillWhite] = s; break; }
        case OPS.setFillRGBColor:
        case OPS.setFillGray:
        case OPS.setFillCMYKColor:
          fillWhite = isWhite(args); break;
        case OPS.setFillColor:
        case OPS.setFillColorN:
          fillWhite = isWhite(args); break;
        case OPS.constructPath: {
          const mm = args && args[2];
          if (mm && mm.length === 4 && mm.every(v => isFinite(v))) pathBox = boxFrom(ctm, mm[0], mm[1], mm[2], mm[3]);
          else pathBox = null;
          break;
        }
        case OPS.fill: case OPS.eoFill: case OPS.fillStroke: case OPS.eoFillStroke:
        case OPS.closeFillStroke: case OPS.closeEOFillStroke:
          if (fillWhite && pathBox && pathBox.w > 0.003 && pathBox.h > 0.003) whiteRects.push({ ...pathBox, op: i });
          pathBox = null; break;
        case OPS.endPath: case OPS.stroke: case OPS.closeStroke:
          pathBox = null; break;
        case OPS.paintImageXObject: case OPS.paintInlineImageXObject:
        case OPS.paintImageMaskXObject: case OPS.paintJpegXObject: case OPS.paintImageXObjectRepeat:
          images.push({ ...boxFrom(ctm, 0, 0, 1, 1), op: i });
          break;
      }
    }
    return { whiteRects, images };
  },

  // ── 2. 내부 구조 분석 ──
  async structure(job, log) {
    const raw = U.bytesToLatin1(job.bytes);
    job.doc.raw = raw;
    const S = job.doc.structure = {};

    const ver = raw.slice(0, 1024).match(/%PDF-(\d\.\d)/);
    S.version = ver ? ver[1] : '알 수 없음';
    if (!ver) job.add('warn', 'PDF 구조', 'PDF 머리글이 정상 위치에 없음', '파일 앞부분에 "%PDF-" 표시가 없습니다. 다른 형식의 파일을 PDF로 이름만 바꿨거나 손상된 파일일 수 있습니다.');

    S.linearized = /\/Linearized/.test(raw.slice(0, 2048));
    const eofs = [];
    let idx = raw.indexOf('%%EOF');
    while (idx !== -1) { eofs.push(idx); idx = raw.indexOf('%%EOF', idx + 5); }
    S.eofCount = eofs.length;
    const updates = Math.max(0, eofs.length - (S.linearized ? 2 : 1));
    S.incrementalUpdates = updates;
    log(`PDF ${S.version} / 저장 구간(%%EOF) ${eofs.length}개${S.linearized ? ' (웹 최적화 PDF)' : ''}`);

    S.hasJS = /\/JavaScript|\/JS\s*[(<\[]/.test(raw);
    S.hasEmbedded = /\/EmbeddedFile/.test(raw);
    S.hasSignature = /\/ByteRange\s*\[/.test(raw) && /\/Sig\b/.test(raw);
    S.hasAcroForm = /\/AcroForm/.test(raw);

    if (S.hasJS) job.add('warn', 'PDF 구조', '자바스크립트 코드 포함', '출석증에는 보통 필요 없는 스크립트가 들어 있습니다. 화면 표시 내용을 바꾸는 데 쓰일 수 있으니 주의하세요.');
    if (S.hasEmbedded) job.add('warn', 'PDF 구조', '파일 안에 다른 파일이 첨부됨', 'PDF 안에 별도의 첨부 파일이 들어 있습니다.');
    if (S.hasSignature) job.add(updates > 0 ? 'warn' : 'ok', 'PDF 구조', '전자서명 정보 있음',
      updates > 0 ? '전자서명이 있지만 서명 이후 추가 저장 이력이 있습니다. Adobe Reader로 열어 "서명 이후 문서가 변경됨" 경고가 있는지 확인하세요.'
        : '전자서명이 포함된 문서입니다. Adobe Reader에서 서명 패널을 열어 "유효한 서명"인지 확인하면 더 확실합니다.');

    // 증분 저장(덧붙여 저장) = 생성 후 수정 흔적
    if (updates > 0) {
      log(`생성 후 ${updates}번 더 저장된 흔적 발견 → 이전 버전 복원 시도`);
      await this.compareRevisions(job, eofs, raw, log);
    } else {
      job.add('ok', 'PDF 구조', '추가 저장(수정) 이력 없음', '문서가 처음 만들어진 뒤 덧붙여 저장된 흔적이 없습니다.');
    }

    // 페이지별: 주석, 숨겨진 글자, 겹친 글자, 흰 상자, 작은 이미지 조각
    for (const pg of job.doc.pages) {
      this.checkAnnotations(job, pg);
      if (!job.doc.scanned) {
        this.checkHiddenAndOverlap(job, pg);
        this.checkCoverObjects(job, pg);
      }
    }
  },

  async compareRevisions(job, eofs, raw, log) {
    const finalText = this.pageTexts(job.doc.pages);
    const startIdx = job.doc.structure.linearized ? 1 : 0;
    let found = false;
    job.doc.revisions = [];
    for (let k = startIdx; k < eofs.length - 1; k++) {
      let end = eofs[k] + 5;
      while (end < raw.length && (raw[end] === '\r' || raw[end] === '\n')) end++;
      try {
        const old = await pdfjsLib.getDocument({ data: job.bytes.slice(0, end), isEvalSupported: false, stopAtErrors: false }).promise;
        const oldPages = [];
        const n = Math.min(old.numPages, this.MAX_PAGES);
        for (let p = 1; p <= n; p++) {
          const page = await old.getPage(p);
          const tc = await page.getTextContent();
          oldPages.push(tc.items.filter(it => it.str && it.str.trim()).map(it => it.str.trim()));
          if (p === 1) {
            const vp1 = page.getViewport({ scale: 1 });
            const vp = page.getViewport({ scale: Math.min(2, 700 / vp1.width) });
            const c = document.createElement('canvas');
            c.width = Math.round(vp.width); c.height = Math.round(vp.height);
            const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: cx, viewport: vp }).promise;
            job.doc.revisions.push({ index: k + 1, canvas: c });
          }
        }
        // 텍스트 비교
        const removed = [], added = [];
        for (let p = 0; p < Math.max(oldPages.length, finalText.length); p++) {
          const a = this.countMap(oldPages[p] || []), b = this.countMap((finalText[p] || []).map(it => it.str.trim()));
          for (const [s, c] of a) if ((b.get(s) || 0) < c) removed.push({ p, s });
          for (const [s, c] of b) if ((a.get(s) || 0) < c) added.push({ p, s });
        }
        if (removed.length || added.length) {
          found = true;
          const regions = [];
          for (const ad of added.slice(0, 30)) {
            const it = (finalText[ad.p] || []).find(i => i.str.trim() === ad.s);
            if (it) regions.push({ page: ad.p, ...U.padBox(it) });
          }
          const fmt = arr => arr.slice(0, 12).map(x => `"${U.escapeHtml(x.s)}"`).join(', ') + (arr.length > 12 ? ` 외 ${arr.length - 12}개` : '');
          job.add('danger', 'PDF 구조', `처음 만든 뒤 글자 내용이 바뀜 (저장 ${k + 1}번째 버전과 비교)`,
            `파일 안에 남아 있는 이전 버전을 복원해 비교했더니 글자가 달라졌습니다.<br>` +
            (removed.length ? `• 사라진 글자: ${fmt(removed)}<br>` : '') +
            (added.length ? `• 새로 생긴 글자: ${fmt(added)}` : '') +
            `<br>'이전 버전' 탭에서 원래 모습을 확인할 수 있습니다.`, regions);
          log(`이전 버전과 글자 차이 발견 (사라짐 ${removed.length} / 추가 ${added.length})`);
        } else {
          log(`이전 버전 ${k + 1}과 글자 차이 없음`);
        }
      } catch (e) {
        log(`이전 버전 ${k + 1} 복원 실패: ${e.message || e}`);
      }
    }
    if (!found) {
      job.add('warn', 'PDF 구조', '생성 후 추가로 저장된 흔적 있음',
        `처음 만든 뒤 ${job.doc.structure.incrementalUpdates}번 더 저장되었습니다. 이전 버전과 글자 차이는 발견되지 않았지만, 주석·서명·도형 추가 또는 메타데이터 변경이 있었을 수 있습니다.`);
    }
  },

  countMap(arr) { const m = new Map(); for (const s of arr) m.set(s, (m.get(s) || 0) + 1); return m; },

  pageTexts(pages) { return pages.map(pg => pg.items.filter(it => it.source === 'text')); },

  checkAnnotations(job, pg) {
    const vp = pg.viewport;
    const toBox = (rect) => {
      const r = vp.convertToViewportRectangle(rect);
      const x = Math.min(r[0], r[2]), y = Math.min(r[1], r[3]);
      return { page: pg.index, x: x / vp.width, y: y / vp.height, w: Math.abs(r[2] - r[0]) / vp.width, h: Math.abs(r[3] - r[1]) / vp.height };
    };
    const editTypes = ['FreeText', 'Stamp', 'Square', 'Circle', 'Ink', 'Line', 'Polygon', 'PolyLine', 'Caret', 'StrikeOut', 'Highlight', 'Underline', 'Text', 'Redact'];
    const edits = pg.annotations.filter(a => editTypes.includes(a.subtype));
    if (edits.length) {
      const names = [...new Set(edits.map(a => a.subtype))].join(', ');
      const contents = edits.map(a => (a.contentsObj && a.contentsObj.str) || a.contents || '').filter(Boolean).slice(0, 5);
      job.add('danger', 'PDF 구조', `${pg.index + 1}쪽에 나중에 덧붙인 주석/도장 ${edits.length}개`,
        `PDF 뷰어의 주석 기능(${names})으로 덧붙인 내용이 있습니다. 글자 상자나 도장을 원래 글자 위에 올려 바꾸는 데 자주 쓰입니다.` +
        (contents.length ? `<br>주석 내용: ${contents.map(c => `"${U.escapeHtml(c)}"`).join(', ')}` : ''),
        edits.map(a => toBox(a.rect)));
    }
    const widgets = pg.annotations.filter(a => a.subtype === 'Widget' && a.fieldValue && String(a.fieldValue).trim());
    if (widgets.length) {
      job.add('warn', 'PDF 구조', `${pg.index + 1}쪽에 입력칸(폼 필드) ${widgets.length}개`,
        '누구나 값을 바꿔 넣을 수 있는 입력칸에 값이 들어 있습니다: ' +
        widgets.slice(0, 6).map(w => `"${U.escapeHtml(w.fieldValue)}"`).join(', '),
        widgets.map(a => toBox(a.rect)));
    }
  },

  // 렌더링 결과에 보이지 않는 글자(덮여서 가려진 원래 글자) + 겹쳐진 글자
  checkHiddenAndOverlap(job, pg) {
    const ctx = pg.canvas.getContext('2d', { willReadFrequently: true });
    const items = pg.items.filter(it => !it.rotated && it.str.trim().length);
    const hidden = [];
    for (const it of items) {
      const x = Math.max(0, Math.floor(it.px.x)), y = Math.max(0, Math.floor(it.px.y));
      const w = Math.min(pg.width - x, Math.ceil(it.px.w)), h = Math.min(pg.height - y, Math.ceil(it.px.h));
      if (w < 3 || h < 3 || x >= pg.width || y >= pg.height) continue;
      const d = ctx.getImageData(x, y, w, h).data;
      let mn = 255, mx = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = U.luma(d[i], d[i + 1], d[i + 2]);
        if (l < mn) mn = l; if (l > mx) mx = l;
      }
      if (mx - mn < 25) hidden.push(it);
    }
    for (const it of hidden) it.hidden = true;

    const textItems = items.length;
    if (hidden.length && hidden.length < textItems * 0.5) {
      const covered = [], alone = [];
      for (const h of hidden) {
        const over = items.find(o => o !== h && !o.hidden && o.str.trim() !== h.str.trim() && U.overlapRatio(o, h) > 0.3);
        if (over) covered.push({ h, over }); else alone.push(h);
      }
      if (covered.length) {
        job.add('danger', '글꼴·배치', `가려진 원래 글자 위에 다른 글자가 있음 (${covered.length}곳)`,
          '화면에는 보이지 않는 글자가 문서 안에 남아 있고, 그 위에 다른 글자가 적혀 있습니다. 원래 글자를 흰 상자로 덮고 새 글자를 써넣은 전형적인 수정 방법입니다.<br>' +
          covered.slice(0, 8).map(c => `• 숨겨진 "${U.escapeHtml(c.h.str.trim())}" → 보이는 "${U.escapeHtml(c.over.str.trim())}"`).join('<br>'),
          covered.map(c => ({ page: pg.index, ...U.padBox(U.unionBox([c.h, c.over])) })));
      }
      if (alone.length) {
        job.add('warn', '글꼴·배치', `화면에 보이지 않는 글자 ${alone.length}개`,
          '문서 안에는 있지만 화면에 보이지 않는 글자입니다(흰 상자로 덮였거나 흰색 글자). 표시된 위치를 확인하세요.<br>' +
          alone.slice(0, 10).map(h => `"${U.escapeHtml(h.str.trim())}"`).join(', '),
          alone.map(h => ({ page: pg.index, ...U.padBox(h) })));
      }
    }

    // 서로 다른 글자가 같은 자리에 겹침
    const overlaps = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.hidden) continue;
      for (let j = i + 1; j < items.length; j++) {
        const b = items[j];
        if (b.hidden) continue;
        if (Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) > Math.max(a.h, b.h)) continue;
        const sa = a.str.trim(), sb = b.str.trim();
        if (sa === sb || sa.includes(sb) || sb.includes(sa)) continue;
        if (U.overlapRatio(a, b) > 0.45) overlaps.push([a, b]);
      }
    }
    // 나중에 그려진 글자가 위에 보이므로, 먼저 그려진 글자는 가려진 원래 글자로 보고 내용 분석에서 뺀다
    for (const [a] of overlaps) a.hidden = true;
    if (overlaps.length) {
      job.add('danger', '글꼴·배치', `원래 글자 위에 다른 글자를 겹쳐 씀 (${overlaps.length}곳)`,
        '같은 자리에 서로 다른 글자가 두 번 적혀 있습니다. 원래 글자를 흰 상자 등으로 가리고 새 글자를 써넣은 흔적입니다. (아래쪽 글자가 원래 내용, 위쪽 글자가 지금 보이는 내용)<br>' +
        overlaps.slice(0, 8).map(([a, b]) => `• 원래 "${U.escapeHtml(a.str.trim())}" → 보이는 "${U.escapeHtml(b.str.trim())}"`).join('<br>'),
        overlaps.map(([a, b]) => ({ page: pg.index, ...U.padBox(U.unionBox([a, b])) })));
    }
  },

  // 글자 위를 덮는 흰 상자 / 작은 이미지 조각
  checkCoverObjects(job, pg) {
    const textItems = pg.items.filter(it => it.str.trim());
    const covers = pg.whiteRects.filter(r => r.w * r.h < 0.02 && textItems.some(t => U.overlapRatio(r, t) > 0.6 && t.hidden));
    if (covers.length) {
      job.add('danger', '글꼴·배치', `글자를 덮은 흰색 상자 ${covers.length}개`,
        '흰색으로 칠한 작은 상자가 원래 글자를 덮고 있습니다. 숫자·날짜를 지우는 데 흔히 쓰입니다.',
        covers.map(r => ({ page: pg.index, ...U.padBox(r) })));
    }
    // 작은 이미지 조각이 글자 위에 (붉은 직인은 제외)
    const ctx = pg.canvas.getContext('2d', { willReadFrequently: true });
    const patches = pg.images.filter(im => {
      if (im.w * im.h > 0.05 || im.w * im.h < 0.00005) return false;
      if (!textItems.some(t => U.overlapRatio(im, t) > 0.5)) return false;
      const x = Math.floor(im.x * pg.width), y = Math.floor(im.y * pg.height);
      const w = Math.max(1, Math.floor(im.w * pg.width)), h = Math.max(1, Math.floor(im.h * pg.height));
      try {
        const d = ctx.getImageData(x, y, w, h).data;
        let red = 0, n = 0;
        for (let i = 0; i < d.length; i += 16) { n++; if (d[i] > 140 && d[i] - d[i + 1] > 60 && d[i] - d[i + 2] > 40) red++; }
        return red / n < 0.05;
      } catch (e) { return true; }
    });
    if (patches.length) {
      job.add('warn', '글꼴·배치', `글자 위에 놓인 작은 이미지 조각 ${patches.length}개`,
        '글자 영역 위에 작은 그림 조각이 붙어 있습니다. 로고·서명일 수도 있지만, 숫자 이미지를 오려 붙인 경우일 수 있으니 확인하세요.',
        patches.map(r => ({ page: pg.index, ...U.padBox(r) })));
    }
  },

  // ── 3. 메타데이터 ──
  async metadata(job, log) {
    const M = job.doc.meta = {};
    try {
      const md = await job.pdf.getMetadata();
      const info = md.info || {};
      M.title = info.Title || '';
      M.author = info.Author || '';
      M.producer = info.Producer || '';
      M.creator = info.Creator || '';
      M.creationRaw = info.CreationDate || '';
      M.modRaw = info.ModDate || '';
      if (md.metadata) {
        try {
          const all = md.metadata.getAll();
          M.xmpCreatorTool = all['xmp:creatortool'] || '';
          M.xmpProducer = all['pdf:producer'] || '';
          M.xmpModify = all['xmp:modifydate'] || '';
          M.xmpCreate = all['xmp:createdate'] || '';
        } catch (e) { /* 무시 */ }
      }
    } catch (e) { log('메타데이터 읽기 실패: ' + e.message); }

    const raw = job.doc.raw || '';
    // 저장 버전마다 남은 Producer/Creator 문자열 (도구 사용 이력)
    const tools = new Set();
    for (const re of [/\/(?:Producer|Creator)\s*\(((?:\\.|[^\\)]){1,200})\)/g, /<(?:xmp:CreatorTool|pdf:Producer|stEvt:softwareAgent)>([^<]{1,200})</g]) {
      let m;
      while ((m = re.exec(raw))) {
        const s = this.decodePdfString(m[1]);
        if (s && s.trim()) tools.add(s.trim());
      }
    }
    if (M.producer) tools.add(M.producer);
    if (M.creator) tools.add(M.creator);
    if (M.xmpCreatorTool) tools.add(M.xmpCreatorTool);
    M.tools = [...tools];
    M.xmpActions = [...raw.matchAll(/stEvt:action[=>"]+(\w+)/g)].map(m => m[1]);

    M.creation = U.parsePdfDate(M.creationRaw) || U.parsePdfDate(M.xmpCreate);
    M.modified = U.parsePdfDate(M.modRaw) || U.parsePdfDate(M.xmpModify);

    log(`만든 프로그램: ${M.creator || '-'} / 변환 프로그램: ${M.producer || '-'}`);
    log(`생성: ${U.fmtDateTime(M.creation)} / 수정: ${U.fmtDateTime(M.modified)}`);

    MetaRules.evaluateTools(job, M.tools, 'PDF');

    if (!M.producer && !M.creator && !M.creation) {
      job.add('warn', '메타데이터', '문서 정보(메타데이터)가 비어 있음',
        '만든 프로그램과 날짜 정보가 모두 지워져 있습니다. 학원 시스템에서 바로 발급한 PDF에는 보통 이 정보가 있습니다. 일부 편집 도구는 흔적을 지우기 위해 이 정보를 삭제합니다.');
    }
    if (M.creation && M.modified) {
      const diff = (M.modified - M.creation) / 1000;
      if (diff > 120) {
        job.add('warn', '메타데이터', '생성 후 수정된 날짜 기록이 있음',
          `생성 ${U.fmtDateTime(M.creation)} → 수정 ${U.fmtDateTime(M.modified)} (${this.humanDiff(diff)} 뒤). 발급 후 누군가 파일을 다시 저장했다는 뜻입니다.`);
      } else if (diff < -60) {
        job.add('warn', '메타데이터', '수정일이 생성일보다 빠름', '날짜 기록이 비정상적입니다. 메타데이터를 직접 고쳤을 가능성이 있습니다.');
      } else {
        job.add('ok', '메타데이터', '생성일과 수정일이 같음', `생성/수정: ${U.fmtDateTime(M.creation)}`);
      }
    }
    const now = new Date();
    if (M.creation && M.creation - now > 86400000) {
      job.add('danger', '메타데이터', '파일 생성일이 미래 날짜', `생성일 ${U.fmtDateTime(M.creation)} — 컴퓨터 시간을 바꿔 만든 파일일 수 있습니다.`);
    }
    if (M.xmpActions.length) {
      const edits = M.xmpActions.filter(a => /edit|save|modif|convert|derive/i.test(a) && !/created/i.test(a));
      if (edits.length) job.add('warn', '메타데이터', '편집 이력(XMP History) 기록 발견', `파일 내부에 다음 작업 기록이 남아 있습니다: ${[...new Set(M.xmpActions)].join(', ')}`);
    }
  },

  humanDiff(sec) {
    if (sec < 3600) return Math.round(sec / 60) + '분';
    if (sec < 86400) return Math.round(sec / 3600) + '시간';
    return Math.round(sec / 86400) + '일';
  },

  decodePdfString(s) {
    let out = s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, c) => {
      if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
      return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c];
    });
    if (out.charCodeAt(0) === 0xfe && out.charCodeAt(1) === 0xff) {
      let r = '';
      for (let i = 2; i + 1 < out.length; i += 2) r += String.fromCharCode((out.charCodeAt(i) << 8) | out.charCodeAt(i + 1));
      return r;
    }
    // UTF-8 시도
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
  },

  // ── 4. 글꼴 · 크기 · 위치 분석 (텍스트 PDF) ──
  fonts(job, log) {
    const pages = job.doc.pages;
    const all = pages.flatMap(pg => pg.items.filter(it => it.source === 'text' && !it.rotated && !it.hidden));
    if (!all.length) return;
    const isNum = s => /\d/.test(s);

    // 글꼴별 글자 수
    const fontChars = new Map(), fontLines = new Map();
    for (const it of all) fontChars.set(it.fontBase, (fontChars.get(it.fontBase) || 0) + it.str.trim().length);
    const totalChars = [...fontChars.values()].reduce((a, b) => a + b, 0);
    job.doc.fontStats = [...fontChars.entries()].sort((a, b) => b[1] - a[1]).map(([f, c]) => ({ font: f, chars: c, share: c / totalChars }));
    log(`사용된 글꼴 ${fontChars.size}종: ${job.doc.fontStats.map(f => f.font).join(', ')}`);

    // 1) 같은 글꼴이 같은 쪽에 두 번 따로 심어짐 (다른 프로그램으로 글자 추가)
    for (const pg of pages) {
      const byBase = new Map();
      for (const it of pg.items) {
        if (!it.subset || it.source !== 'text') continue;
        if (!byBase.has(it.fontBase)) byBase.set(it.fontBase, new Map());
        const m = byBase.get(it.fontBase);
        if (!m.has(it.subset)) m.set(it.subset, []);
        m.get(it.subset).push(it);
      }
      for (const [base, m] of byBase) {
        if (m.size < 2) continue;
        const groups = [...m.values()].sort((a, b) => b.length - a.length);
        const minority = groups.slice(1).flat();
        const numeric = minority.some(it => isNum(it.str));
        job.add(numeric ? 'danger' : 'warn', '글꼴·배치', `같은 글꼴(${base})이 ${pg.index + 1}쪽에 따로 두 번 들어 있음`,
          `정상적으로 한 번에 만든 문서는 한 글꼴을 한 번만 넣습니다. 일부 글자가 나중에 다른 프로그램으로 추가되었을 가능성이 있습니다.<br>따로 들어간 글자: ` +
          minority.slice(0, 12).map(it => `"${U.escapeHtml(it.str.trim())}"`).join(', '),
          minority.map(it => ({ page: pg.index, ...U.padBox(it) })));
      }
    }

    // 줄 단위 비교
    let flaggedFont = 0, flaggedSize = 0, flaggedBase = 0;
    for (const ln of job.doc.lines) {
      const its = ln.items.filter(it => it.source === 'text' && !it.rotated && !it.hidden);
      if (its.length < 2) continue;
      for (const it of its) fontLines.set(it.fontBase, (fontLines.get(it.fontBase) || 0) + 1);
    }
    for (const ln of job.doc.lines) {
      const its = ln.items.filter(it => it.source === 'text' && !it.rotated && !it.hidden);
      if (its.length < 2) continue;
      const cnt = new Map();
      for (const it of its) cnt.set(it.fontBase, (cnt.get(it.fontBase) || 0) + it.str.trim().length);
      const major = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const it of its) {
        if (!isNum(it.str)) continue;
        const others = its.filter(o => o !== it);
        // 2) 숫자만 다른(드문) 글꼴
        if (it.fontBase !== major) {
          const share = (fontChars.get(it.fontBase) || 0) / totalChars;
          const usedLines = fontLines.get(it.fontBase) || 0;
          if (share < 0.06 && usedLines <= 3) {
            flaggedFont++;
            job.add(usedLines <= 1 ? 'danger' : 'warn', '글꼴·배치', `"${it.str.trim()}" 만 다른 글꼴로 쓰임`,
              `같은 줄의 다른 글자는 "${U.escapeHtml(major)}" 글꼴인데, 이 숫자는 문서 전체에서 거의 쓰이지 않는 "${U.escapeHtml(it.fontBase)}" 글꼴입니다. 숫자만 따로 고쳐 넣었을 때 생기는 흔적입니다.`,
              [{ page: ln.page, ...U.padBox(it) }]);
          }
        }
        // 3) 글자 크기 차이
        const sizes = others.map(o => o.sizePt);
        const med = U.median(sizes);
        const consistent = sizes.filter(s => Math.abs(s - med) / med < 0.02).length >= Math.min(2, sizes.length);
        if (med > 0 && consistent && Math.abs(it.sizePt - med) / med > 0.08 && it.fontBase === major) {
          flaggedSize++;
          job.add('warn', '글꼴·배치', `"${it.str.trim()}" 글자 크기가 같은 줄과 다름`,
            `같은 줄 글자 크기 ${med.toFixed(2)}pt, 이 글자 ${it.sizePt.toFixed(2)}pt (${Math.round((it.sizePt / med - 1) * 100)}% 차이).`,
            [{ page: ln.page, ...U.padBox(it) }]);
        }
        // 4) 기준선(밑줄 높이) 어긋남
        const bases = others.filter(o => Math.abs(o.sizePt - it.sizePt) / it.sizePt < 0.15).map(o => o.baselinePt);
        if (bases.length >= 2) {
          const bm = U.median(bases);
          const tight = bases.every(b => Math.abs(b - bm) < 0.15);
          const dev = Math.abs(it.baselinePt - bm);
          if (tight && dev > 0.35 && dev < it.sizePt * 0.5) {
            flaggedBase++;
            job.add('warn', '글꼴·배치', `"${it.str.trim()}" 높이가 같은 줄과 미세하게 어긋남`,
              `같은 줄의 다른 글자들은 정확히 같은 높이에 있는데, 이 글자만 ${dev.toFixed(2)}pt 위/아래로 벗어나 있습니다. 손으로 위치를 맞춰 끼워 넣은 글자에서 자주 보입니다.`,
              [{ page: ln.page, ...U.padBox(it) }]);
          }
        }
      }
    }
    if (!flaggedFont && !flaggedSize && !flaggedBase && !job.findings.some(f => f.category === '글꼴·배치' && f.level !== 'ok' && f.level !== 'info')) {
      job.add('ok', '글꼴·배치', '글꼴·크기·위치가 일관됨', `숫자와 날짜가 주변 글자와 같은 글꼴·크기·높이로 쓰여 있습니다. (글꼴 ${fontChars.size}종)`);
    }
  }
};

/* 프로그램(도구) 이름 판정 규칙 — PDF/이미지 공용 */
const MetaRules = {
  IMAGE_EDITORS: /photoshop|gimp|paint\.net|mspaint|\bpaint\b|pixlr|photopea|canva|picsart|snapseed|meitu|fotor|lightroom|affinity|illustrator|corel|krita|photoscape|포토스케이프|알씨|alsee|미리캔버스|befunky|faceapp|polarr|vsco|inshot/i,
  PDF_EDITORS: /smallpdf|ilovepdf|sejda|pdfescape|pdffiller|dochub|pdf ?candy|soda ?pdf|pdf-xchange|pdfxchange|foxit (phantom|pdf editor|editor)|phantompdf|pdfelement|wondershare|nitro|acrobat( pro| standard| dc)?|pdf24|pdf expert|xodo|kami|lightpdf|hipdf|pdf2go|easepdf|cleverpdf|abbyy|qoppa|master pdf|ezpdf|이지pdf|알pdf|alpdf|pdf ?editor/i,
  OFFICE: /microsoft.*(word|excel|powerpoint)|\bms ?word\b|\bexcel\b|powerpoint|hwp|hancom|한컴|한글|libreoffice|openoffice|\bpages\b|keynote|google docs|polaris|폴라리스/i,
  BROWSER: /skia\/pdf|chrom|\bedge\b|safari|firefox|webkit|print to pdf|microsoft: print|quartz pdfcontext|mac os x.*quartz/i,
  SCANNER: /camscanner|adobe scan|vflat|microsoft lens|office lens|genius scan|scanner|naps2|epson|canon|\bhp\b|hewlett|xerox|fuji|sindoh|신도|samsung|brother|kyocera|ricoh|konica|sharp|twain|scan/i,
  REPORT: /\boz\b|oz report|ozreport|crystal|clip ?report|ubi ?report|ubireport|report ?designer|rexpert|jasper|wkhtmltopdf|tcpdf|mpdf|fpdf|itext|pdfsharp|dompdf|reportlab|aspose|pdfkit|puppeteer|headless|qt |prince|fop|birt|dynamicpdf|abcpdf|syncfusion|pdf ?lib|pdfbox|ghostscript|pdftk/i,

  evaluateTools(job, tools, label) {
    if (!tools.length) return;
    const list = tools.map(t => `"${U.escapeHtml(t)}"`).join(', ');
    const img = tools.filter(t => this.IMAGE_EDITORS.test(t));
    const pdf = tools.filter(t => this.PDF_EDITORS.test(t) && !this.REPORT.test(t));
    const office = tools.filter(t => this.OFFICE.test(t) && !this.PDF_EDITORS.test(t));
    const browser = tools.filter(t => this.BROWSER.test(t));
    const scan = tools.filter(t => this.SCANNER.test(t));
    const report = tools.filter(t => this.REPORT.test(t));
    job.doc.toolClass = { img, pdf, office, browser, scan, report };

    if (img.length) {
      job.add('danger', '메타데이터', '이미지 편집 프로그램 사용 흔적',
        `${label} 안에 이미지 편집 프로그램 기록이 있습니다: ${img.map(t => `"${U.escapeHtml(t)}"`).join(', ')}. 출석증을 그림으로 열어 글자를 고쳤을 가능성이 높습니다.`);
    }
    if (pdf.length) {
      job.add('warn', '메타데이터', 'PDF 편집 프로그램 사용 흔적',
        `${pdf.map(t => `"${U.escapeHtml(t)}"`).join(', ')} 기록이 있습니다. 단순히 합치기·압축·다시 저장했을 수도 있지만, 글자를 수정할 수 있는 프로그램입니다. 학원 원본 파일과 비교가 필요합니다.`);
    }
    if (office.length && !img.length) {
      job.add('warn', '메타데이터', '문서 작성 프로그램(한글/워드/엑셀 등)으로 만든 PDF',
        `${office.map(t => `"${U.escapeHtml(t)}"`).join(', ')} 로 만든 파일입니다. 학원이 직접 작성했을 수도 있지만, 누구나 같은 양식을 만들어 숫자를 바꿀 수 있는 방식입니다. 학원 발급 방식과 맞는지 확인하세요.`);
    }
    if (browser.length) {
      job.add('warn', '메타데이터', '웹 브라우저로 인쇄한 PDF',
        `${browser.map(t => `"${U.escapeHtml(t)}"`).join(', ')} — 학원 홈페이지 화면을 PDF로 인쇄한 파일입니다. 인쇄 전에 브라우저 개발자 도구로 화면 글자를 바꿀 수 있으므로, 가능하면 담당자가 학원 홈페이지에서 직접 조회해 보세요.`);
    }
    if (scan.length) {
      job.add('info', '메타데이터', '스캔/촬영 앱으로 만든 파일', `${scan.map(t => `"${U.escapeHtml(t)}"`).join(', ')} — 종이 출석증을 스캔한 파일입니다. 이미지 분석 결과를 함께 보세요.`);
    }
    if (report.length && !img.length && !pdf.length && !office.length && !browser.length) {
      job.add('ok', '메타데이터', '시스템 자동 발급 형태의 PDF', `${report.map(t => `"${U.escapeHtml(t)}"`).join(', ')} — 학원 전산 시스템/보고서 엔진에서 자동으로 만든 파일로 보입니다.`);
    }
    if (!img.length && !pdf.length && !office.length && !browser.length && !scan.length && !report.length) {
      job.add('info', '메타데이터', '사용 프로그램 기록', `기록된 프로그램: ${list}`);
    }
  }
};
