/* 학원별 정상 양식 등록 · 대조 (브라우저 localStorage에 저장) */
const TemplateStore = {
  KEY: 'forgery_templates_v1',

  all() { return U.storage.get(this.KEY, []); },
  saveAll(list) { return U.storage.set(this.KEY, list); },
  upsert(t) {
    const list = this.all();
    const i = list.findIndex(x => x.id === t.id);
    if (i >= 0) list[i] = t; else list.push(t);
    return this.saveAll(list);
  },
  remove(id) { this.saveAll(this.all().filter(t => t.id !== id)); },

  // 현재 분석한 문서에서 양식 특징 추출
  features(job) {
    const pg = job.doc.pages[0];
    const labels = [];
    for (const ln of job.doc.lines.filter(l => l.page === 0)) {
      for (const sp of ln.spans) {
        const s = sp.item.str.trim();
        if (s.length >= 2 && s.length <= 14 && U.hasHangul(s) && !U.hasDigit(s) && labels.length < 80) {
          labels.push({ t: U.compact(s), x: +sp.item.x.toFixed(4), y: +sp.item.y.toFixed(4) });
        }
      }
    }
    const M = job.doc.meta || {};
    return {
      kind: job.kind + (job.doc.scanned ? '-scan' : ''),
      producer: M.producer || M.software || '',
      creator: M.creator || M.creatorTool || '',
      ratio: pg ? +(pg.width / pg.height).toFixed(3) : null,
      fonts: (job.doc.fontStats || []).map(f => f.font).slice(0, 12),
      labels,
      stamp: pg && pg.stamp ? pg.stamp : null,
      pages: job.doc.numPages || 1
    };
  },

  findFor(job) {
    const list = this.all();
    if (!list.length) return null;
    const text = U.compact(job.doc.text);
    const names = t => [t.academy, ...(t.aliases || [])].map(U.compact).filter(Boolean);
    const inp = U.compact(job.inputs.academy || '');
    return list.find(t => names(t).some(n => (inp && (inp.includes(n) || n.includes(inp))) || text.includes(n))) || null;
  },

  compare(job, tpl) {
    const now = this.features(job), ref = tpl.features;
    const diffs = [], regions = [];
    let score = 0, max = 0;

    max += 15;
    if (ref.kind === now.kind) score += 15;
    else diffs.push(`파일 종류가 다름 (정상 양식: ${ref.kind}, 제출본: ${now.kind})`);

    if (ref.producer || ref.creator) {
      max += 20;
      const same = (a, b) => U.compact(a).toLowerCase() === U.compact(b).toLowerCase();
      if (same(ref.producer, now.producer) && same(ref.creator, now.creator)) score += 20;
      else diffs.push(`만든 프로그램이 다름 (정상: "${U.escapeHtml(ref.creator || '-')} / ${U.escapeHtml(ref.producer || '-')}", 제출본: "${U.escapeHtml(now.creator || '-')} / ${U.escapeHtml(now.producer || '-')}")`);
    }
    if (ref.ratio && now.ratio) {
      max += 10;
      if (Math.abs(ref.ratio - now.ratio) < 0.02) score += 10;
      else diffs.push(`용지 비율이 다름 (정상 ${ref.ratio}, 제출본 ${now.ratio})`);
    }
    if (ref.fonts.length && now.fonts.length && !ref.kind.includes('image') && !now.kind.includes('image')) {
      max += 20;
      const a = new Set(ref.fonts), b = new Set(now.fonts);
      const inter = [...a].filter(x => b.has(x)).length;
      const jac = inter / new Set([...a, ...b]).size;
      score += 20 * jac;
      const extra = [...b].filter(x => !a.has(x));
      if (extra.length) diffs.push(`정상 양식에 없는 글꼴 사용: ${extra.map(U.escapeHtml).join(', ')}`);
      const missing = [...a].filter(x => !b.has(x));
      if (missing.length) diffs.push(`정상 양식의 글꼴이 빠짐: ${missing.map(U.escapeHtml).join(', ')}`);
    }
    if (ref.labels.length) {
      max += 35;
      const nowMap = new Map();
      for (const l of now.labels) if (!nowMap.has(l.t)) nowMap.set(l.t, l);
      let found = 0, moved = [];
      for (const l of ref.labels) {
        const m = nowMap.get(l.t);
        if (!m) continue;
        found++;
        if (Math.abs(m.x - l.x) > 0.03 || Math.abs(m.y - l.y) > 0.03) moved.push({ l, m });
      }
      const ratio = found / ref.labels.length;
      score += 35 * ratio * (1 - Math.min(1, moved.length / Math.max(1, found)) * 0.6);
      if (ratio < 0.6) diffs.push(`정상 양식의 항목 이름 중 ${Math.round(ratio * 100)}%만 일치 (항목 구성이 다른 양식)`);
      if (moved.length) {
        diffs.push(`위치가 달라진 항목 ${moved.length}개: ${moved.slice(0, 6).map(x => `"${U.escapeHtml(x.l.t)}"`).join(', ')}`);
        for (const x of moved.slice(0, 10)) regions.push({ page: 0, x: x.m.x - 0.005, y: x.m.y - 0.004, w: 0.06, h: 0.025 });
      }
    }
    if (ref.stamp) {
      const st = job.doc.pages[0] && job.doc.pages[0].stamp;
      max += 0;
      if (!st) diffs.push('정상 양식에는 직인이 있는데 제출본에서는 찾지 못함');
      else if (Math.abs(st.x - ref.stamp.x) > 0.08 || Math.abs(st.y - ref.stamp.y) > 0.08) {
        diffs.push('직인 위치가 정상 양식과 다름');
        regions.push({ page: 0, ...st });
      }
    }
    return { score: max ? Math.round(score / max * 100) : null, diffs, regions };
  },

  // 파이프라인 단계
  run(job, log) {
    const F = job.fields;
    const tpl = this.findFor(job);
    job.template = tpl;
    const name = F.academy || job.inputs.academy;
    if (!tpl) {
      log(`등록된 정상 양식 없음 (발급기관: ${name || '찾지 못함'})`);
      job.add('info', '양식', name ? `"${name}"의 정상 양식이 아직 등록되지 않음` : '발급기관(학원) 이름을 찾지 못함',
        (name ? '같은 학원에서 받은 <b>진짜 출석증</b>을 한 번 등록해 두면, 다음부터 양식·글꼴·항목 위치·출석률 계산 규칙을 자동으로 대조합니다. ' : '') +
        '결과 화면의 검색 버튼으로 학원의 출석증 양식과 출석률 산정 기준을 찾아볼 수 있습니다.');
      if (F.docNo) job.add('info', '양식', `문서 확인번호 발견: ${U.escapeHtml(F.docNo.text)}`, '학원 홈페이지에 "증명서 진위확인" 메뉴가 있다면 이 번호로 진짜 발급 여부를 확인하세요.', F.docNo.region ? [{ ...F.docNo.region, info: true }] : []);
      return;
    }
    const r = this.compare(job, tpl);
    log(`"${tpl.academy}" 정상 양식과 일치도 ${r.score}%`);
    job.fields.templateScore = r.score;
    const ruleText = this.ruleText(tpl.rule);
    if (r.score >= 85 && !r.diffs.length) {
      job.add('ok', '양식', `"${tpl.academy}" 정상 양식과 일치 (${r.score}%)`, `등록된 정상 양식과 형식이 같습니다. 출석률 계산 규칙: ${ruleText}`);
    } else {
      job.add(r.score < 60 ? 'danger' : 'warn', '양식', `"${tpl.academy}" 정상 양식과 다른 점 발견 (일치도 ${r.score}%)`,
        r.diffs.map(d => '• ' + d).join('<br>') + `<br>출석률 계산 규칙: ${ruleText}` + (tpl.note ? `<br>메모: ${U.escapeHtml(tpl.note)}` : ''), r.regions);
    }
  },

  ruleText(rule = {}) {
    const r = { round: '반올림', floor: '버림', ceil: '올림' }[rule.rounding || 'round'];
    const d = rule.decimals == null || rule.decimals === '' || rule.decimals === 'auto' ? '문서 표기 자릿수' : `소수 ${rule.decimals}자리`;
    const l = { none: '출석 ÷ 총', 'late-as-attend': '지각도 출석 인정', late3: '지각 3회 = 결석 1회', lateearly3: '지각·조퇴 합산 3회 = 결석 1회', 'minus-absent': '(총−결석) ÷ 총' }[rule.lateRule || 'none'];
    return `${l}, ${d} ${r}`;
  }
};
