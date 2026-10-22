/* 문서 내용 분석: 항목 추출 · 출석률 계산 · 날짜 검증 · 신청정보 대조 */
const ContentAnalyzer = {
  WEEK: ['일', '월', '화', '수', '목', '금', '토'],

  // 한국 공휴일 (양력 고정 + 2023~2027 음력/대체공휴일) — 수업 가능일 계산 참고용
  HOLIDAYS: new Set([
    '2023-01-21', '2023-01-22', '2023-01-23', '2023-01-24', '2023-05-27', '2023-05-29', '2023-09-28', '2023-09-29', '2023-09-30', '2023-10-02',
    '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12', '2024-04-10', '2024-05-06', '2024-05-15', '2024-09-16', '2024-09-17', '2024-09-18', '2024-10-01',
    '2025-01-27', '2025-01-28', '2025-01-29', '2025-01-30', '2025-03-03', '2025-05-06', '2025-06-03', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-05',
    '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09', '2027-05-13', '2027-08-16', '2027-09-14', '2027-09-15', '2027-09-16', '2027-10-04', '2027-10-11'
  ]),
  FIXED_HOLIDAYS: ['01-01', '03-01', '05-05', '06-06', '08-15', '10-03', '10-09', '12-25'],

  isHoliday(d) {
    const s = U.fmtDate(d);
    return this.HOLIDAYS.has(s) || this.FIXED_HOLIDAYS.includes(s.slice(5));
  },

  // ── 날짜 찾기 ──
  findDates(lines) {
    const out = [];
    const res = [
      { re: /((?:19|20)\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})(?!\d)\s*일?\.?/g, y: 1, m: 2, d: 3 },
      { re: /(?<![\d.\/\-])(\d{2})\s?\.\s?(\d{1,2})\s?\.\s?(\d{1,2})(?![\d])\.?/g, y: 1, m: 2, d: 3, short: true }
    ];
    for (const ln of lines) {
      const spans = [];
      for (const r of res) {
        r.re.lastIndex = 0;
        let m;
        while ((m = r.re.exec(ln.text))) {
          const s = m.index, e = m.index + m[0].length;
          if (spans.some(sp => s < sp[1] && e > sp[0])) continue;
          let y = +m[r.y];
          if (r.short) { if (y < 10 || y > 60) continue; y += 2000; }
          const mo = +m[r.m], d = +m[r.d];
          const after = ln.text.slice(e);
          const wm = after.match(/^\s*[(（]\s*([월화수목금토일])\s*(?:요일)?\s*[)）]/);
          spans.push([s, e]);
          out.push(this.makeDate(ln, s, e + (wm ? wm[0].length : 0), y, mo, d, wm ? wm[1] : null, m[0]));
        }
      }
      // 연도 없는 월/일(요일) — 일자별 표
      const md = /(?<![\d.\/\-])(\d{1,2})\s*[\/.월]\s*(\d{1,2})\s*일?\s*[(（]\s*([월화수목금토일])\s*[)）]/g;
      let m;
      while ((m = md.exec(ln.text))) {
        const s = m.index, e = s + m[0].length;
        if (spans.some(sp => s < sp[1] && e > sp[0])) continue;
        spans.push([s, e]);
        out.push(this.makeDate(ln, s, e, null, +m[1], +m[2], m[3], m[0]));
      }
      ln.dateSpans = spans;
    }
    return out;
  },

  makeDate(ln, s, e, y, mo, d, wd, raw) {
    const valid = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && (y == null || d <= new Date(y, mo, 0).getDate());
    return { line: ln, s, e, y, m: mo, d, weekday: wd, raw: raw.trim(), valid, date: valid && y ? new Date(y, mo - 1, d) : null, region: U.regionFor(ln, s, e) };
  },

  // ── 숫자 찾기 (날짜 부분 제외) ──
  numbersIn(ln) {
    const out = [];
    const re = /(\d{1,4}(?:[.,]\d{1,3})?)\s*(%|％|일|회|시간|h|H|차시|분)?/g;
    let m;
    while ((m = re.exec(ln.text))) {
      const s = m.index, e = s + m[1].length;
      if ((ln.dateSpans || []).some(sp => s < sp[1] && e > sp[0])) continue;
      out.push({ v: parseFloat(m[1].replace(',', '.')), raw: m[1], unit: m[2] || '', s, e: s + m[0].length, line: ln });
    }
    return out;
  },

  LABELS: {
    total: ['총\\s*수\\s*업\\s*일\\s*수', '총\\s*수\\s*업\\s*횟\\s*수', '총\\s*수\\s*업\\s*일', '총\\s*강\\s*의\\s*일\\s*수', '총\\s*강\\s*의\\s*횟\\s*수', '총\\s*교\\s*육\\s*일\\s*수', '총\\s*출\\s*석\\s*대\\s*상', '총\\s*수\\s*업\\s*시\\s*간', '총\\s*교\\s*육\\s*시\\s*간', '총\\s*강\\s*의\\s*시\\s*간', '총\\s*일\\s*수', '총\\s*횟\\s*수', '총\\s*회\\s*차', '총\\s*시\\s*간', '전\\s*체\\s*(?:수\\s*업\\s*)?일\\s*수', '소\\s*정\\s*일\\s*수', '수\\s*업\\s*일\\s*수', '수\\s*업\\s*횟\\s*수', '교\\s*육\\s*일\\s*수', '강\\s*의\\s*일\\s*수', '수\\s*업\\s*시\\s*간', '총\\s*수\\s*업', '총\\s*강\\s*의'],
    attend: ['실\\s*출\\s*석\\s*일\\s*수', '출\\s*석\\s*일\\s*수', '출\\s*석\\s*횟\\s*수', '출\\s*석\\s*회\\s*수', '출\\s*석\\s*시\\s*간', '출\\s*석\\s*일', '출\\s*석\\s*수', '수\\s*강\\s*일\\s*수', '출\\s*석(?!\\s*[률율부확증여표현체관인대번])'],
    absent: ['결\\s*석\\s*일\\s*수', '결\\s*석\\s*횟\\s*수', '결\\s*석\\s*일', '결\\s*석(?!\\s*[률율])'],
    late: ['지\\s*각\\s*횟\\s*수', '지\\s*각\\s*일\\s*수', '지\\s*각'],
    early: ['조\\s*퇴\\s*횟\\s*수', '조\\s*퇴'],
    rate: ['출\\s*석\\s*률', '출\\s*석\\s*율', '출\\s*결\\s*률', '출\\s*석\\s*비\\s*율', '수\\s*강\\s*률', '수\\s*강\\s*율', '이\\s*수\\s*율', '출\\s*석\\s*%']
  },

  // 라벨 바로 뒤 숫자, 없으면 표의 아래 칸에서 찾기
  findLabeled(lines, key) {
    const isRate = key === 'rate';
    for (const src of this.LABELS[key]) {
      const re = new RegExp(src, 'g');
      for (const ln of lines) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(ln.text))) {
          const ls = m.index, le = m.index + m[0].length;
          // 같은 줄 바로 뒤
          const after = ln.text.slice(le);
          const gap = after.match(/^[\s:：=\-–()（）\[\]%％]*(?:\(?\s*(?:일|회|시간|%)\s*\)?)?[\s:：=]*/);
          const nums = this.numbersIn(ln).filter(n => n.s >= le && n.s <= le + (gap ? gap[0].length : 0) + 1);
          if (nums.length) {
            const n = nums[0];
            if (isRate && n.unit !== '%' && n.unit !== '％' && !/%|％/.test(m[0] + after.slice(0, 6)) && n.v <= 1) continue;
            if (!isRate && (n.unit === '%' || n.unit === '％')) continue;
            return this.pack(n, ln, ls, le);
          }
          // 표: 라벨 아래 줄의 같은 열
          const labelBox = U.regionFor(ln, ls, le);
          if (!labelBox) continue;
          const below = lines.filter(l => l.page === ln.page && l.yc > ln.yc && l.yc - ln.yc < 0.12).sort((a, b) => a.yc - b.yc).slice(0, 4);
          const lc = labelBox.x + labelBox.w / 2;
          for (const bl of below) {
            const cands = this.numbersIn(bl).map(n => ({ n, r: U.regionFor(bl, n.s, n.e) })).filter(c => c.r)
              .map(c => ({ ...c, dx: Math.abs(c.r.x + c.r.w / 2 - lc) }))
              .filter(c => c.dx < Math.max(labelBox.w, 0.05))
              .filter(c => isRate ? true : c.n.unit !== '%' && c.n.unit !== '％')
              .sort((a, b) => a.dx - b.dx);
            if (cands.length) return this.pack(cands[0].n, bl, ls, le, ln);
          }
        }
      }
    }
    return null;
  },

  pack(n, ln, ls, le, labelLine) {
    const dec = n.raw.includes('.') || n.raw.includes(',') ? n.raw.split(/[.,]/)[1].length : 0;
    return { value: n.v, raw: n.raw, unit: n.unit, decimals: dec, line: ln, region: U.regionFor(ln, n.s, n.e), labelRegion: U.regionFor(labelLine || ln, ls, le) };
  },

  // ── 항목 추출 ──
  extract(job, log) {
    const lines = job.doc.lines;
    const F = job.fields = {};
    F.dates = this.findDates(lines);
    for (const k of ['total', 'attend', 'absent', 'late', 'early', 'rate']) F[k] = this.findLabeled(lines, k);

    // "18 / 20", "20일 중 18일" 형태
    if (!F.attend || !F.total) {
      for (const ln of lines) {
        if (!/출\s*석|수\s*강|이\s*수/.test(ln.text)) continue;
        let m = ln.text.match(/(\d{1,4})\s*(?:일|회|시간)?\s*\/\s*(\d{1,4})\s*(일|회|시간)?/);
        if (m && +m[1] <= +m[2] * 1.5) {
          const s1 = m.index, s2 = ln.text.indexOf(m[2], s1 + m[1].length);
          F.attend = F.attend || { value: +m[1], raw: m[1], decimals: 0, unit: m[3] || '', line: ln, region: U.regionFor(ln, s1, s1 + m[1].length) };
          F.total = F.total || { value: +m[2], raw: m[2], decimals: 0, unit: m[3] || '', line: ln, region: U.regionFor(ln, s2, s2 + m[2].length) };
          break;
        }
        m = ln.text.match(/(\d{1,4})\s*(일|회|시간)?\s*중\s*(\d{1,4})\s*(일|회|시간)?/);
        if (m) {
          const s1 = m.index, s2 = ln.text.indexOf(m[3], s1 + m[1].length);
          F.total = F.total || { value: +m[1], raw: m[1], decimals: 0, unit: m[2] || '', line: ln, region: U.regionFor(ln, s1, s1 + m[1].length) };
          F.attend = F.attend || { value: +m[3], raw: m[3], decimals: 0, unit: m[4] || '', line: ln, region: U.regionFor(ln, s2, s2 + m[3].length) };
          break;
        }
      }
    }
    // 출석률: 라벨이 없으면 '출석'과 같은 줄의 % 숫자
    F.rates = [];
    for (const ln of lines) {
      if (!/출\s*석|출\s*결|수\s*강|이\s*수/.test(ln.text)) continue;
      for (const n of this.numbersIn(ln)) if ((n.unit === '%' || n.unit === '％') && n.v <= 200) F.rates.push(this.pack(n, ln, n.s, n.s));
    }
    if (!F.rate && F.rates.length) F.rate = F.rates[0];

    F.academy = this.findAcademy(job);
    F.name = this.findLabeledText(lines, ['성\\s*명', '이\\s*름', '수\\s*강\\s*생', '학\\s*생\\s*명', '수\\s*강\\s*자', '성\\s*함']);
    F.course = this.findLabeledText(lines, ['과\\s*정\\s*명', '강\\s*좌\\s*명', '수\\s*강\\s*과\\s*목', '과\\s*목\\s*명', '강\\s*의\\s*명', '수\\s*업\\s*명', '^\\s*반\\s*명', '^\\s*과\\s*정(?!\\s*[을를의에])', '^\\s*강\\s*좌(?!\\s*[을를의에])']);
    F.docNo = this.findLabeledText(lines, ['발\\s*급\\s*번\\s*호', '문\\s*서\\s*번\\s*호', '확\\s*인\\s*번\\s*호', '증\\s*명\\s*번\\s*호', '발\\s*행\\s*번\\s*호', '진\\s*위\\s*확\\s*인']);
    F.phones = [...new Set(lines.flatMap(l => (l.text.match(/0\d{1,2}[-.)\s]\s?\d{3,4}[-.\s]\d{4}|1[5-9]\d{2}-\d{4}/g) || [])))];

    this.findPeriod(job);
    this.findIssueDate(job);

    const show = (o, suf = '') => o ? o.raw + (o.unit || suf) : '-';
    log(`학원: ${F.academy || '-'} / 이름: ${F.name ? F.name.text : '-'}`);
    log(`총 ${show(F.total)} · 출석 ${show(F.attend)} · 결석 ${show(F.absent)} · 지각 ${show(F.late)} · 출석률 ${F.rate ? F.rate.raw + '%' : '-'}`);
    log(`수강기간: ${F.period ? U.fmtDate(F.period.start) + ' ~ ' + U.fmtDate(F.period.end) : '-'} / 발급일: ${F.issue ? U.fmtDate(F.issue.date) : '-'}`);
  },

  findLabeledText(lines, labels) {
    for (const src of labels) {
      const re = new RegExp('(' + src + ')\\s*[:：]?\\s*([^\\s:：|][^|]{0,30})');
      for (const ln of lines) {
        const m = ln.text.match(re);
        if (m) {
          let t = m[2].trim().split(/\s{2,}|\s(?=[가-힣]{2,4}\s*[:：])/)[0].trim();
          if (!t || t.length > 30) continue;
          const s = ln.text.indexOf(m[2], m.index);
          return { text: t, region: U.regionFor(ln, s, s + t.length) };
        }
      }
    }
    return null;
  },

  BRANDS: ['YBM', '와이비엠', '해커스', '파고다', '시원스쿨', '야나두', '민병철', '정철', '이익훈', '월스트리트', '링글', '튜터링', '캠블리', '베를리츠', '종로', 'EF', '에듀윌', '박문각', '랭귀지큐브', '스피킹맥스', '능률', '시사', '대교', '청담', '아발론', '토즈', '뉴욕', '해커스톡', '김영', '토마토', '어학원', '중국어', '일본어', '스페인어', '프랑스어', '독일어', 'JLPT', 'HSK'],

  findAcademy(job) {
    const cands = new Map();
    const re = /([가-힣A-Za-z0-9&·()\s]{0,18}?(?:외국어학원|어학원|학원|아카데미|Academy|ACADEMY|교육원|어학센터|외국어센터|랭귀지|Language|스쿨|School|교습소|평생교육원|센터))/g;
    for (const ln of job.doc.lines) {
      let m;
      while ((m = re.exec(ln.text))) {
        let t = m[1].replace(/^[\s()]+|[\s()]+$/g, '').replace(/^(발급기관|기관명|학원명|교육기관|발행처|발급처)\s*[:：]?\s*/, '');
        if (t.length < 3 || /^(학원|센터|스쿨)$/.test(t)) continue;
        const score = (cands.get(t) || 0) + 1 + (/(학원명|기관명|발급기관|발행처)/.test(ln.text) ? 3 : 0) + (/(장|원장|대표)/.test(ln.text.slice(ln.text.indexOf(t) + t.length, ln.text.indexOf(t) + t.length + 4)) ? 2 : 0);
        cands.set(t, score);
      }
    }
    const best = [...cands.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0];
    if (best) return best[0];
    const text = job.doc.text;
    const brand = this.BRANDS.find(b => text.includes(b) && b.length >= 2 && !['어학원', '중국어', '일본어', '스페인어', '프랑스어', '독일어', 'JLPT', 'HSK'].includes(b));
    return brand || null;
  },

  findPeriod(job) {
    const F = job.fields;
    const dates = F.dates.filter(d => d.y);
    // 같은 줄에서 "날짜 ~ 날짜"
    for (const a of dates) {
      const b = dates.find(x => x.line === a.line && x.s > a.s);
      if (!b) continue;
      const between = a.line.text.slice(a.e, b.s);
      if (/^\s*(~|∼|〜|-|–|—|부터|to|TO|\/)?\s*$/.test(between) || /^\s*(~|∼|〜|-|–|—|부터)\s*/.test(between) && between.length < 8) {
        F.period = { start: a.date, end: b.date, startD: a, endD: b, region: U.regionFor(a.line, a.s, b.e) };
        if (/기\s*간|수\s*강|교\s*육|수\s*업|과\s*정/.test(a.line.text)) break;
      }
    }
    // 라벨 줄에서 시작/종료 날짜 따로
    if (!F.period) {
      const st = dates.find(d => /(개강|시작|입학|수강\s*시작)/.test(d.line.text));
      const en = dates.find(d => /(종강|종료|수료|수강\s*종료)/.test(d.line.text));
      if (st && en) F.period = { start: st.date, end: en.date, startD: st, endD: en, region: U.unionBox([st.region, en.region].filter(Boolean)) };
    }
    // "2024년 3월" 처럼 월 단위
    if (!F.period) {
      for (const ln of job.doc.lines) {
        const m = ln.text.match(/((?:19|20)\d{2})\s*[.\-\/년]\s*(\d{1,2})\s*월?(?:\s*(?:~|∼|-|–)\s*(?:((?:19|20)\d{2})\s*[.\-\/년]\s*)?(\d{1,2})\s*월)?/);
        if (m && /(기\s*간|수\s*강|교\s*육|월\s*분|수\s*업|과\s*정)/.test(ln.text) && !(ln.dateSpans || []).some(sp => sp[0] <= m.index && sp[1] > m.index)) {
          const y = +m[1], m1 = +m[2], y2 = m[3] ? +m[3] : y, m2 = m[4] ? +m[4] : m1;
          if (m1 >= 1 && m1 <= 12 && m2 >= 1 && m2 <= 12) {
            F.period = { start: new Date(y, m1 - 1, 1), end: new Date(y2, m2, 0), monthly: true, region: U.regionFor(ln, m.index, m.index + m[0].length) };
            break;
          }
        }
      }
    }
  },

  findIssueDate(job) {
    const F = job.fields;
    const labelRe = /(발\s*급|발\s*행|출\s*력|작\s*성|확\s*인|증\s*명)\s*(일\s*자|일\s*시|일)/;
    const used = new Set(F.period ? [F.period.startD, F.period.endD] : []);
    for (const d of F.dates.filter(x => x.y && x.valid)) {
      if (used.has(d)) continue;
      const before = d.line.text.slice(Math.max(0, d.s - 14), d.s);
      if (labelRe.test(before)) { F.issue = { date: d.date, d, labeled: true, region: d.region }; return; }
    }
    // 라벨 다음 줄
    for (const ln of job.doc.lines) {
      if (!labelRe.test(ln.text)) continue;
      const nxt = F.dates.find(d => d.y && d.valid && !used.has(d) && d.line.page === ln.page && d.line.yc > ln.yc && d.line.yc - ln.yc < 0.05);
      if (nxt) { F.issue = { date: nxt.date, d: nxt, labeled: true, region: nxt.region }; return; }
    }
    // 문서 아래쪽의 마지막 날짜 (추정)
    const rest = F.dates.filter(d => d.y && d.valid && !used.has(d) && !/생\s*년|생\s*일|출\s*생/.test(d.line.text) && d.region && d.region.y > 0.45);
    if (rest.length) {
      const d = rest.sort((a, b) => (a.line.page - b.line.page) || (a.region.y - b.region.y)).pop();
      F.issue = { date: d.date, d, labeled: false, region: d.region };
    }
  },

  // ── 출석률 검증 ──
  checkRate(job, log) {
    const F = job.fields;
    const rule = (job.template && job.template.rule) || {};
    const T = F.total, A = F.attend, R = F.rate;
    const regs = (...xs) => xs.filter(x => x && x.region).map(x => x.region);

    if (!R && !(T && A)) {
      job.add('warn', '출석률', '출석률/출석일수를 자동으로 찾지 못함',
        job.ocrFailed ? '글자 인식에 실패했습니다.' : '문서에서 "출석률", "출석일수", "총 수업일수" 같은 항목을 찾지 못했습니다. 화면에서 직접 계산해 확인하세요.');
      log('출석 관련 숫자를 찾지 못했습니다.');
      return;
    }
    if (T && A && A.value > T.value) {
      job.add('danger', '출석률', '출석일수가 총 수업일수보다 많음', `출석 ${A.raw}${A.unit} > 총 ${T.raw}${T.unit} — 있을 수 없는 숫자입니다.`, regs(A, T));
    }
    if (R && R.value > 100) job.add('danger', '출석률', '출석률이 100%를 넘음', `문서의 출석률 ${R.raw}%`, regs(R));

    // 출석+결석 = 총
    const AB = F.absent;
    if (T && A && AB && Math.abs(A.value + AB.value - T.value) > 0.01) {
      job.add('warn', '출석률', '출석 + 결석 ≠ 총 수업일수', `출석 ${A.raw} + 결석 ${AB.raw} = ${A.value + AB.value}, 총 수업일수는 ${T.raw}입니다. 공결·휴강 등 다른 항목이 있는지 확인하세요.`, regs(A, AB, T));
    }

    if (R && T && A) {
      const d = rule.decimals != null && rule.decimals !== '' && rule.decimals !== 'auto' ? +rule.decimals : R.decimals;
      const method = rule.rounding || 'round';
      const rnd = v => method === 'floor' ? U.floorTo(v, d) : method === 'ceil' ? U.ceilTo(v, d) : U.roundTo(v, d);
      const late = F.late ? F.late.value : 0, early = F.early ? F.early.value : 0;
      const formulas = [
        { key: 'basic', name: '출석 ÷ 총 수업일수', v: A.value / T.value * 100 },
        { key: 'late-as-attend', name: '(출석 + 지각) ÷ 총 수업일수', v: (A.value + late) / T.value * 100, need: F.late },
        { key: 'minus-absent', name: '(총 − 결석) ÷ 총 수업일수', v: (T.value - (AB ? AB.value : 0)) / T.value * 100, need: AB },
        { key: 'late3', name: '(출석 − 지각 3회당 1) ÷ 총', v: (A.value - Math.floor(late / 3)) / T.value * 100, need: F.late },
        { key: 'lateearly3', name: '(출석 − (지각+조퇴) 3회당 1) ÷ 총', v: (A.value - Math.floor((late + early) / 3)) / T.value * 100, need: F.late || F.early }
      ];
      const preferred = rule.lateRule && rule.lateRule !== 'none' ? formulas.find(f => f.key === rule.lateRule) : formulas[0];
      const base = preferred || formulas[0];
      const computed = rnd(base.v);
      const methodName = { round: '반올림', floor: '버림', ceil: '올림' }[method];
      log(`계산: ${A.value} ÷ ${T.value} × 100 = ${base.v.toFixed(4)}% → 소수 ${d}자리 ${methodName} = ${computed}%`);
      job.fields.rateCalc = { formula: base.name, exact: base.v, computed, decimals: d, method: methodName };

      if (Math.abs(computed - R.value) < 1e-6) {
        job.add('ok', '출석률', `출석률 계산이 맞음 (${R.raw}%)`, `${base.name}: ${A.raw} ÷ ${T.raw} × 100 = ${base.v.toFixed(3)}% → 소수 ${d}자리 ${methodName} = <b>${computed}%</b>`, regs(R, A, T).map(r => ({ ...r, info: true })));
      } else {
        // 다른 반올림/공식으로 맞는지
        const alts = [];
        for (const f of formulas) {
          if (f.key !== 'basic' && !f.need) continue;
          const ok = [['반올림', U.roundTo], ['버림', U.floorTo], ['올림', U.ceilTo]]
            .filter(([mn, fn]) => Math.abs(fn(f.v, R.decimals) - R.value) < 1e-6 && !(f === base && mn === methodName)).map(x => x[0]);
          if (ok.length === 3) alts.push(f.name);
          else if (ok.length) alts.push(`${f.name} (${ok.join('/')})`);
        }
        if (alts.length) {
          job.add('warn', '출석률', `출석률이 다른 계산 방식으로만 맞음`,
            `기본 계산(${base.name}, ${methodName})으로는 <b>${computed}%</b>인데 문서에는 <b>${R.raw}%</b>로 적혀 있습니다.<br>다음 방식으로 계산하면 일치합니다: ${alts.slice(0, 3).join(', ')}.<br>해당 학원이 실제로 이 방식으로 출석률을 계산하는지 확인하세요. (확인 후 '정상 양식 등록'에서 학원별 계산 규칙을 저장할 수 있습니다)`,
            regs(R, A, T));
        } else {
          job.add('danger', '출석률', `출석률 계산이 맞지 않음 (문서 ${R.raw}% ↔ 계산 ${computed}%)`,
            `${A.raw} ÷ ${T.raw} × 100 = ${base.v.toFixed(3)}% 이므로 ${computed}%여야 하는데, 문서에는 ${R.raw}%로 적혀 있습니다. 지각 반영·반올림·버림 등 다른 계산법으로도 맞지 않습니다. 출석률이나 출석일수 중 하나가 고쳐졌을 가능성이 큽니다.`,
            regs(R, A, T));
        }
      }
    } else if (R && !(T && A)) {
      job.add('warn', '출석률', '출석률을 검산할 숫자가 부족함', `출석률 ${R.raw}%는 찾았지만 ${!T ? '총 수업일수' : ''}${!T && !A ? '·' : ''}${!A ? '출석일수' : ''}를 찾지 못해 계산이 맞는지 확인하지 못했습니다.`, regs(R));
    } else if (T && A && !R) {
      const v = A.value / T.value * 100;
      job.fields.rateCalc = { formula: '출석 ÷ 총 수업일수', exact: v, computed: U.roundTo(v, 1), decimals: 1, method: '반올림' };
      job.add('info', '출석률', `문서에 출석률 표시 없음 — 계산값 ${U.roundTo(v, 1)}%`, `${A.raw} ÷ ${T.raw} × 100 = ${v.toFixed(2)}%`, regs(A, T));
    }

    // 문서 안의 출석률 값끼리 비교
    const distinct = [...new Set(F.rates.map(r => r.value))];
    if (distinct.length > 1 && F.rates.length <= 6) {
      job.add('warn', '출석률', '문서 안에 서로 다른 출석률 값이 있음', `${distinct.map(v => v + '%').join(', ')} — 월별 출석률이라면 정상이지만, 요약값과 상세값이 다르다면 일부만 고쳐졌을 수 있습니다.`, F.rates.map(r => r.region).filter(Boolean));
    }

    // 표의 각 줄: (a, b, %) 조합 검산 (월별/과목별 표)
    let rowsOk = 0, rowsBad = [];
    for (const ln of job.doc.lines) {
      const nums = this.numbersIn(ln);
      const pcts = nums.filter(n => n.unit === '%' || n.unit === '％');
      const others = nums.filter(n => n.unit !== '%' && n.unit !== '％' && n.v > 0 && n.v < 2000);
      if (pcts.length !== 1 || others.length < 2 || (R && pcts[0].line === R.line)) continue;
      const p = pcts[0], dp = p.raw.includes('.') ? p.raw.split('.')[1].length : 0;
      let ok = false;
      for (const a of others) for (const b of others) {
        if (a === b || a.v > b.v) continue;
        const v = a.v / b.v * 100;
        if ([U.roundTo, U.floorTo, U.ceilTo].some(fn => Math.abs(fn(v, dp) - p.v) < 1e-6)) ok = true;
      }
      if (ok) rowsOk++; else rowsBad.push(p);
    }
    if (rowsBad.length && rowsOk >= 1) {
      job.add('danger', '출석률', `표의 일부 줄만 출석률 계산이 맞지 않음 (${rowsBad.length}줄)`,
        `같은 표의 다른 ${rowsOk}줄은 계산이 맞는데, 표시한 줄은 같은 줄의 숫자로 계산한 값과 다릅니다: ${rowsBad.map(p => p.raw + '%').join(', ')}`,
        rowsBad.map(p => U.regionFor(p.line, p.s, p.e)).filter(Boolean));
    }

    // 일자별 출석 표시 개수
    const marks = job.doc.pages.flatMap(pg => pg.items).map(it => it.str.trim());
    const attendMarks = marks.filter(s => /^(O|○|●|◯|◎|출|V|✓|✔)$/.test(s)).length;
    if (A && attendMarks >= 5 && attendMarks !== A.value) {
      job.add('warn', '출석률', '일자별 출석 표시 개수와 출석일수가 다름', `표 안의 출석 표시(○ 등) ${attendMarks}개 / 문서의 출석일수 ${A.raw}. 표시 기호가 다르게 쓰였을 수도 있으니 직접 세어 확인하세요.`, regs(A));
    }

    // 지원 기준
    const th = parseFloat(job.inputs.threshold);
    const rateVal = R ? R.value : (job.fields.rateCalc ? job.fields.rateCalc.computed : null);
    if (rateVal != null && !isNaN(th)) {
      if (rateVal < th) job.add('info', '출석률', `지원 기준(${th}%) 미달`, `출석률 ${rateVal}% — 어학교육 지원 기준에 미치지 못합니다.`);
      else if (rateVal - th <= 1.5) job.add('info', '출석률', `지원 기준(${th}%)을 간신히 넘음`, `출석률 ${rateVal}%. 위변조 사례는 기준을 살짝 넘기도록 고치는 경우가 많아 꼼꼼히 확인하길 권합니다.`, regs(R));
    }
  },

  // ── 날짜 검증 ──
  checkDates(job, log) {
    const F = job.fields;
    const today = U.today();
    const all = F.dates;
    log(`찾은 날짜 ${all.length}개`);
    if (!all.length) {
      job.add('warn', '날짜', '날짜를 찾지 못함', '문서에서 날짜를 자동으로 읽지 못했습니다. 수강기간과 발급일을 직접 확인하세요.');
      return;
    }
    let problems = 0;
    // 존재하지 않는 날짜
    const invalid = all.filter(d => !d.valid);
    if (invalid.length) {
      problems++;
      job.add('danger', '날짜', '달력에 없는 날짜', invalid.map(d => `"${U.escapeHtml(d.raw)}"`).join(', ') + ' — 존재하지 않는 날짜입니다(예: 2월 30일). 날짜를 손으로 고치면서 생기는 실수입니다.', invalid.map(d => d.region).filter(Boolean));
    }
    // 요일 불일치
    const yearGuess = F.period ? F.period.start.getFullYear() : (all.find(d => d.y) || {}).y;
    const wrongWd = [];
    for (const d of all) {
      if (!d.weekday || !d.valid) continue;
      let dt = d.date;
      if (!dt && yearGuess) {
        dt = new Date(yearGuess, d.m - 1, d.d);
        if (F.period && dt < F.period.start && d.m < F.period.start.getMonth() + 1) dt = new Date(yearGuess + 1, d.m - 1, d.d);
      }
      if (dt && this.WEEK[dt.getDay()] !== d.weekday) wrongWd.push({ d, real: this.WEEK[dt.getDay()] });
    }
    if (wrongWd.length) {
      problems++;
      job.add('danger', '날짜', `날짜와 요일이 맞지 않음 (${wrongWd.length}곳)`, wrongWd.slice(0, 8).map(w => `• "${U.escapeHtml(w.d.raw)}" → 실제는 ${w.real}요일`).join('<br>'), wrongWd.map(w => w.d.region).filter(Boolean));
    } else if (all.some(d => d.weekday)) {
      job.add('ok', '날짜', '날짜와 요일이 모두 맞음', `요일이 함께 적힌 날짜 ${all.filter(d => d.weekday).length}개를 달력과 대조했습니다.`);
    }

    const P = F.period, I = F.issue;
    if (P) {
      if (P.start > P.end) { problems++; job.add('danger', '날짜', '수강 시작일이 종료일보다 늦음', `${U.fmtDate(P.start)} ~ ${U.fmtDate(P.end)}`, [P.region].filter(Boolean)); }
      if (P.start > today) { problems++; job.add('danger', '날짜', '수강 시작일이 미래 날짜', U.fmtDate(P.start), [P.region].filter(Boolean)); }
      else if (P.end > today) job.add('warn', '날짜', '아직 끝나지 않은 수강기간', `종료일 ${U.fmtDate(P.end)} — 과정이 끝나기 전에 출석률이 확정될 수 없습니다.`, [P.region].filter(Boolean));
      const days = U.daysBetween(P.start, P.end) + 1;
      if (days > 400) job.add('info', '날짜', '수강기간이 1년이 넘음', `${days}일. 기간이 맞는지 확인하세요.`, [P.region].filter(Boolean));

      // 총 수업일수와 기간 비교
      const T = F.total;
      if (T && !/시간|h|H|분|차시/.test(T.unit || '') && P.start <= P.end) {
        let weekdays = 0;
        for (let d = new Date(P.start); d <= P.end; d.setDate(d.getDate() + 1)) {
          if (d.getDay() !== 0 && d.getDay() !== 6 && !this.isHoliday(d)) weekdays++;
        }
        F.periodDays = { days, weekdays };
        log(`기간 ${days}일 중 평일(공휴일 제외) ${weekdays}일 / 문서 총 수업일수 ${T.value}`);
        if (T.value > days) { problems++; job.add('danger', '날짜', '총 수업일수가 수강기간 날짜 수보다 많음', `기간은 ${days}일인데 총 수업일수가 ${T.raw}입니다.`, [T.region, P.region].filter(Boolean)); }
        else if (T.value > weekdays) job.add('warn', '날짜', '총 수업일수가 기간 내 평일 수보다 많음', `기간 내 평일(공휴일 제외)은 ${weekdays}일인데 총 수업일수가 ${T.raw}입니다. 주말·공휴일 수업이 있었는지 확인하세요.`, [T.region, P.region].filter(Boolean));
        else job.add('ok', '날짜', '총 수업일수가 수강기간과 맞음', `기간 ${days}일 (평일 ${weekdays}일) 안에 총 수업일수 ${T.raw}${T.unit || ''}.`);
      }
    } else {
      job.add('warn', '날짜', '수강기간을 찾지 못함', '"2024.03.01 ~ 2024.03.31" 같은 기간 표시를 찾지 못했습니다. 직접 확인하세요.');
    }

    if (I) {
      const lab = I.labeled ? '' : ' (문서 아래쪽 날짜로 추정)';
      if (I.date > today) { problems++; job.add('danger', '날짜', '발급일이 미래 날짜', U.fmtDate(I.date) + lab, [I.region].filter(Boolean)); }
      if (P && I.date < P.start) { problems++; job.add('danger', '날짜', '발급일이 수강 시작일보다 빠름', `발급 ${U.fmtDate(I.date)} < 시작 ${U.fmtDate(P.start)}${lab}`, [I.region, P.region].filter(Boolean)); }
      else if (P && I.date < P.end) job.add('warn', '날짜', '수강이 끝나기 전에 발급됨', `발급 ${U.fmtDate(I.date)} < 종료 ${U.fmtDate(P.end)}${lab}. 발급 시점 이후 출석은 반영되지 않았어야 합니다.`, [I.region, P.region].filter(Boolean));
      // 파일 생성일과 비교
      const M = job.doc.meta || {};
      if (job.kind === 'pdf' && M.creation && !job.doc.scanned) {
        const cd = new Date(M.creation.getFullYear(), M.creation.getMonth(), M.creation.getDate());
        const gap = U.daysBetween(I.date, cd);
        if (gap < -1) { problems++; job.add('danger', '날짜', '파일이 발급일보다 먼저 만들어짐', `PDF 생성 ${U.fmtDate(cd)} / 문서상 발급일 ${U.fmtDate(I.date)}${lab}. 발급되기 전에 파일이 존재할 수 없습니다. 발급일을 고쳤을 가능성이 있습니다.`, [I.region].filter(Boolean)); }
        else if (gap > 30) job.add('info', '날짜', '발급일보다 한참 뒤에 만들어진 파일', `PDF 생성 ${U.fmtDate(cd)} / 발급일 ${U.fmtDate(I.date)} (${gap}일 차이). 재발급·재출력일 수 있습니다.`);
        else job.add('ok', '날짜', '파일 생성일과 발급일이 맞음', `PDF 생성 ${U.fmtDate(cd)} / 발급일 ${U.fmtDate(I.date)}`);
      }
    }

    // 기간 밖의 날짜, 중복 날짜
    if (P) {
      const lo = new Date(P.start); lo.setDate(lo.getDate() - 1);
      const hi = new Date(I ? Math.max(I.date, P.end) : P.end); hi.setDate(hi.getDate() + 1);
      const daily = all.filter(d => d.date && d !== P.startD && d !== P.endD && (!I || d !== I.d) && !/생\s*년|생\s*일|출\s*생|등\s*록|접\s*수/.test(d.line.text));
      const out = daily.filter(d => d.date < lo || d.date > hi);
      if (out.length && daily.length >= 3) job.add('warn', '날짜', `수강기간 밖의 날짜 ${out.length}개`, out.slice(0, 8).map(d => `"${U.escapeHtml(d.raw)}"`).join(', '), out.map(d => d.region).filter(Boolean));
      const seen = new Map(), dup = [];
      for (const d of all.filter(x => x.weekday)) {
        const k = `${d.y || ''}-${d.m}-${d.d}`;
        if (seen.has(k)) dup.push(d); else seen.set(k, d);
      }
      if (dup.length) job.add('warn', '날짜', '같은 날짜가 두 번 나옴', dup.map(d => `"${U.escapeHtml(d.raw)}"`).join(', '), dup.map(d => d.region).filter(Boolean));
    }
    if (!problems && P && I) job.add('ok', '날짜', '수강기간·발급일 순서가 정상', `수강 ${U.fmtDate(P.start)} ~ ${U.fmtDate(P.end)}, 발급 ${U.fmtDate(I.date)}`);
  },

  // ── 신청 정보 대조 ──
  crossCheck(job, log) {
    const inp = job.inputs, F = job.fields;
    const text = U.compact(job.doc.text);
    const strong = job.kind === 'pdf' && !job.doc.scanned;
    if (inp.name) {
      if (text.includes(U.compact(inp.name))) job.add('ok', '교차검증', `신청자 이름 "${inp.name}" 확인`, '문서에 신청자 이름이 있습니다.', F.name && F.name.region ? [{ ...F.name.region, info: true }] : []);
      else job.add(strong ? 'danger' : 'warn', '교차검증', `신청자 이름 "${inp.name}"이(가) 문서에 없음`, (F.name ? `문서의 이름: "${U.escapeHtml(F.name.text)}". ` : '') + (strong ? '다른 사람의 출석증일 수 있습니다.' : '글자 인식 오류일 수도 있으니 화면에서 직접 확인하세요.'), F.name && F.name.region ? [F.name.region] : []);
    }
    if (inp.academy) {
      const a = U.compact(inp.academy);
      if (text.includes(a) || (F.academy && (U.compact(F.academy).includes(a) || a.includes(U.compact(F.academy))))) job.add('ok', '교차검증', `학원명 "${inp.academy}" 확인`, '');
      else job.add('warn', '교차검증', `신청서의 학원명 "${inp.academy}"이(가) 문서에 없음`, F.academy ? `문서에서 찾은 기관명: "${U.escapeHtml(F.academy)}"` : '');
    }
    if (inp.start || inp.end) {
      const P = F.period;
      const s = inp.start ? new Date(inp.start + 'T00:00:00') : null, e = inp.end ? new Date(inp.end + 'T00:00:00') : null;
      if (!P) job.add('warn', '교차검증', '신청 기간과 비교할 수강기간을 문서에서 찾지 못함', '');
      else {
        const bad = [];
        if (s && U.fmtDate(s) !== U.fmtDate(P.start)) bad.push(`시작일: 신청 ${U.fmtDate(s)} / 문서 ${U.fmtDate(P.start)}`);
        if (e && U.fmtDate(e) !== U.fmtDate(P.end)) bad.push(`종료일: 신청 ${U.fmtDate(e)} / 문서 ${U.fmtDate(P.end)}`);
        if (bad.length) job.add('warn', '교차검증', '신청한 수강기간과 문서의 기간이 다름', bad.join('<br>'), [P.region].filter(Boolean));
        else job.add('ok', '교차검증', '신청 기간과 문서 기간이 같음', `${U.fmtDate(P.start)} ~ ${U.fmtDate(P.end)}`);
      }
    }
  }
};
