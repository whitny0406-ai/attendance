/* 화면 제어 · 검사 순서 */
(function () {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const $ = s => document.querySelector(s);
  const HIST_KEY = 'forgery_history_v1';
  const LEVEL = {
    danger: { label: '이상징후', cls: 'danger' },
    warn: { label: '추가 확인', cls: 'warn' },
    ok: { label: '정상', cls: 'ok' },
    info: { label: '참고', cls: 'info' }
  };
  const STEPS = [
    { key: 'file', name: '파일 형식 확인', desc: '진짜 파일 형식, 지문(해시), 이전 제출 여부' },
    { key: 'open', name: '문서 열기 · 글자 추출', desc: 'PDF 글자 레이어 또는 글자 인식(OCR)' },
    { key: 'struct', name: '내부 구조 분석', desc: '수정 저장 이력, 이전 버전 복원, 숨겨진 글자' },
    { key: 'meta', name: '메타데이터 분석', desc: '만든 프로그램, 생성·수정 날짜, 촬영 정보' },
    { key: 'font', name: '글꼴 · 크기 · 위치 분석', desc: '숫자만 다른 글꼴/크기/높이' },
    { key: 'pixel', name: '이미지 변조 흔적 분석', desc: '압축오차(ELA), 배경 잡티, 직인' },
    { key: 'tpl', name: '발급기관 확인 · 양식 대조', desc: '학원 이름, 등록된 정상 양식과 비교' },
    { key: 'rate', name: '출석률 계산 검증', desc: '출석 ÷ 총 수업일수 → 반올림 비교' },
    { key: 'date', name: '날짜 검증', desc: '달력·요일·기간·발급일 순서' },
    { key: 'cross', name: '신청 정보 · 중복 제출 확인', desc: '이름·학원·기간 대조, 과거 제출본 비교' },
    { key: 'final', name: '종합 판정', desc: '' }
  ];

  let files = [];
  let jobs = [];
  let current = null;
  let viewMode = 'regions';
  let running = false;

  // ───────── 파일 선택 ─────────
  const dz = $('#dropzone'), input = $('#fileInput');
  input.addEventListener('change', () => addFiles(input.files));
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', e => addFiles(e.dataTransfer.files));
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });

  function addFiles(list) {
    for (const f of list) {
      if (!files.some(x => x.name === f.name && x.size === f.size)) files.push(f);
    }
    input.value = '';
    renderFileList();
  }
  function renderFileList() {
    $('#fileList').innerHTML = files.map((f, i) => `
      <li><span class="ftype ${/pdf$/i.test(f.name) ? 'pdf' : 'img'}">${U.escapeHtml((f.name.split('.').pop() || '').toUpperCase())}</span>
      <span class="fname">${U.escapeHtml(f.name)}</span><span class="fsize">${U.fmtBytes(f.size)}</span>
      <button class="x" data-i="${i}" aria-label="삭제">✕</button></li>`).join('');
    $('#fileList').querySelectorAll('.x').forEach(b => b.onclick = () => { files.splice(+b.dataset.i, 1); renderFileList(); });
    $('#runBtn').disabled = !files.length || running;
    $('#runBtn').textContent = files.length > 1 ? `${files.length}개 파일 위변조 검사 시작` : '위변조 검사 시작';
  }

  $('#runBtn').addEventListener('click', async () => {
    if (running || !files.length) return;
    running = true;
    $('#runBtn').disabled = true;
    const inputs = {
      name: $('#inName').value.trim(), academy: $('#inAcademy').value.trim(),
      start: $('#inStart').value, end: $('#inEnd').value, threshold: $('#inThreshold').value
    };
    const batch = files.slice();
    files = []; renderFileList();
    $('#analysis').hidden = false;
    const newJobs = batch.map(f => createJob(f, inputs));
    jobs = newJobs.concat(jobs).slice(0, 20);
    renderJobTabs();
    $('#analysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
    for (const job of newJobs) {
      select(job);
      await runJob(job);
      if (current === job) renderAll();
    }
    running = false;
    renderFileList();
    renderHistory();
  });

  // ───────── 검사 실행 ─────────
  function createJob(file, inputs) {
    const job = {
      id: Math.random().toString(36).slice(2),
      file, inputs, findings: [], logs: [],
      doc: { pages: [], lines: [], text: '' }, fields: {},
      steps: STEPS.map(s => ({ ...s, status: 'wait', note: '' })),
      state: 'wait', currentStep: null
    };
    job.add = (level, category, title, detail = '', regions = []) => {
      job.findings.push({ id: job.findings.length + 1, level, category, title, detail, regions: (regions || []).filter(Boolean), step: job.currentStep });
    };
    return job;
  }

  function rebuildLines(job) {
    job.doc.lines = job.doc.pages.flatMap(pg => U.buildLines(pg.items.filter(it => !it.hidden), pg.index));
    job.doc.text = job.doc.lines.map(l => l.text).join('\n');
  }

  async function runJob(job) {
    job.state = 'running';
    const log = (msg, replaceLast) => {
      if (replaceLast && job.logs.length && job.logs[job.logs.length - 1].replaceable) job.logs.pop();
      job.logs.push({ t: `[${job.currentStep || ''}] ${msg}`, replaceable: !!replaceLast });
      const st = job.steps.find(s => s.key === job.currentStep);
      if (st) st.note = msg;
      if (current === job) renderProcess();
    };

    const fns = {
      file: () => fileCheck(job, log),
      open: async () => {
        if (job.kind === 'pdf') {
          await PdfAnalyzer.open(job, log);
          if (job.doc.scanned) await ImageAnalyzer.ocrPages(job, log);
        } else {
          await ImageAnalyzer.open(job, log);
        }
        rebuildLines(job);
        log(`읽은 줄 ${job.doc.lines.length}개`);
        if (!job.doc.lines.length) job.add('warn', '텍스트 추출', '글자를 읽지 못함', '문서에서 글자를 읽지 못했습니다. 숫자·날짜 검증은 직접 해야 합니다.');
      },
      struct: async () => {
        if (job.kind === 'pdf') await PdfAnalyzer.structure(job, log);
        else ImageAnalyzer.structure(job, log);
        rebuildLines(job);
      },
      meta: async () => {
        if (job.kind === 'pdf') await PdfAnalyzer.metadata(job, log);
        else await ImageAnalyzer.metadata(job, log);
      },
      font: () => {
        if (job.kind === 'pdf' && !job.doc.scanned) PdfAnalyzer.fonts(job, log);
        else { ImageAnalyzer.ocrGeometry(job); log('글자 인식 결과로 숫자 크기·높이를 비교했습니다.'); }
      },
      pixel: () => ImageAnalyzer.pixels(job, log),
      tpl: () => { ContentAnalyzer.extract(job, log); TemplateStore.run(job, log); },
      rate: () => ContentAnalyzer.checkRate(job, log),
      date: () => ContentAnalyzer.checkDates(job, log),
      cross: () => { ContentAnalyzer.crossCheck(job, log); duplicateCheck(job, log); },
      final: () => finalize(job, log)
    };

    for (const st of job.steps) {
      job.currentStep = st.key;
      st.status = 'run';
      if (current === job) renderProcess();
      await new Promise(r => setTimeout(r, 30));
      const before = job.findings.length;
      try {
        await fns[st.key]();
        const mine = job.findings.slice(before);
        st.status = mine.some(f => f.level === 'danger') ? 'danger' : mine.some(f => f.level === 'warn') ? 'warn' : 'done';
        if (st.key !== 'final') st.note = summarizeStep(mine) || st.note;
      } catch (e) {
        console.error(e);
        st.status = 'error';
        st.note = e.message || String(e);
        log('오류: ' + st.note);
        if (st.key === 'file' || st.key === 'open') {
          job.add('warn', '파일', '파일을 분석할 수 없음', U.escapeHtml(st.note));
          job.steps.filter(s => s.status === 'wait').forEach(s => s.status = 'skip');
          finalize(job, log);
          break;
        }
        job.add('warn', '시스템', `"${st.name}" 단계를 끝까지 하지 못함`, U.escapeHtml(st.note) + ' — 이 부분은 직접 확인하세요.');
      }
      if (current === job) renderProcess();
    }
    job.state = 'done';
  }

  function summarizeStep(list) {
    const d = list.filter(f => f.level === 'danger').length, w = list.filter(f => f.level === 'warn').length;
    if (d || w) return [d ? `이상징후 ${d}건` : '', w ? `추가 확인 ${w}건` : ''].filter(Boolean).join(' · ');
    const ok = list.find(f => f.level === 'ok');
    return ok ? ok.title : '';
  }

  async function fileCheck(job, log) {
    const buf = await job.file.arrayBuffer();
    job.bytes = new Uint8Array(buf);
    const b = job.bytes;
    const head = U.bytesToLatin1(b.subarray(0, 1024));
    let type = 'unknown';
    if (head.includes('%PDF-')) type = 'pdf';
    else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) type = 'jpeg';
    else if (b[0] === 0x89 && head.slice(1, 4) === 'PNG') type = 'png';
    else if (head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP') type = 'webp';
    else if (/ftyp(heic|heix|mif1|hevc)/.test(head.slice(4, 16))) type = 'heic';
    else if (head.slice(0, 3) === 'GIF') type = 'gif';
    job.fileType = type;
    job.kind = type === 'pdf' ? 'pdf' : 'image';
    job.hash = await U.sha256(buf);
    log(`실제 형식: ${type.toUpperCase()} / 크기 ${U.fmtBytes(b.length)} / 지문 ${job.hash.slice(0, 16)}…`);

    if (type === 'unknown') throw new Error('PDF나 이미지 파일이 아닙니다.');
    if (type === 'heic') throw new Error('아이폰 HEIC 사진은 브라우저에서 열 수 없습니다. JPG로 변환해 다시 받아 주세요.');
    const ext = (job.file.name.split('.').pop() || '').toLowerCase();
    const expect = { pdf: ['pdf'], jpeg: ['jpg', 'jpeg', 'jfif'], png: ['png'], webp: ['webp'], gif: ['gif'] }[type] || [];
    if (!expect.includes(ext)) {
      job.add('warn', '파일', '확장자와 실제 형식이 다름', `파일 이름은 ".${U.escapeHtml(ext)}"인데 실제 내용은 ${type.toUpperCase()}입니다. 다른 형식으로 저장한 뒤 이름만 바꿨을 수 있습니다.`);
    } else {
      job.add('ok', '파일', `정상 ${type.toUpperCase()} 파일`, `파일 이름과 실제 형식이 같습니다. 파일 지문(SHA-256): <code>${job.hash}</code>`);
    }
    if (type === 'pdf' && head.indexOf('%PDF-') > 0) job.add('warn', 'PDF 구조', 'PDF 시작 부분 앞에 다른 데이터가 있음', '정상 PDF는 파일 맨 앞이 "%PDF-"로 시작합니다.');
  }

  function duplicateCheck(job, log) {
    const hist = U.storage.get(HIST_KEY, []);
    const pg = job.doc.pages[0];
    job.dhash = pg ? U.dHash(pg.canvas) : null;
    const same = hist.filter(h => h.hash === job.hash);
    if (same.length) {
      const diffPerson = same.filter(h => h.applicant && job.inputs.name && h.applicant !== job.inputs.name);
      job.add(diffPerson.length ? 'danger' : 'info', '교차검증',
        diffPerson.length ? '다른 신청자가 낸 파일과 완전히 같은 파일' : '이전에 검사한 적 있는 파일',
        same.slice(0, 5).map(h => `• ${U.fmtDateTime(new Date(h.at))} — ${U.escapeHtml(h.fileName)} ${h.applicant ? '(' + U.escapeHtml(h.applicant) + ')' : ''} → ${h.verdict}`).join('<br>'));
    } else if (job.dhash) {
      const near = hist.filter(h => h.dhash && U.hamming(h.dhash, job.dhash) <= 3);
      if (near.length) {
        job.add('info', '교차검증', `이전 제출 문서와 겉모습이 매우 비슷함 (${near.length}건)`,
          '같은 학원 양식이라 비슷할 수 있습니다. 다만 다른 사람의 출석증에서 이름·숫자만 바꾼 경우도 이렇게 나타나니, 아래 문서와 나란히 비교해 보세요.<br>' +
          near.slice(0, 5).map(h => `• ${U.fmtDateTime(new Date(h.at))} — ${U.escapeHtml(h.fileName)} ${h.applicant ? '(' + U.escapeHtml(h.applicant) + ')' : ''}`).join('<br>'));
      }
    }
    log(`검사 이력 ${hist.length}건과 비교 완료`);
  }

  function finalize(job, log) {
    const d = job.findings.filter(f => f.level === 'danger').length;
    const w = job.findings.filter(f => f.level === 'warn').length;
    job.verdict = d ? 'danger' : w ? 'warn' : 'ok';
    job.score = Math.min(100, d * 35 + w * 8);
    job.verdictText = { danger: '이상징후 발견', warn: '추가 확인 필요', ok: '이상징후 미발견' }[job.verdict];
    log(`최종: ${job.verdictText} (이상징후 ${d}, 추가 확인 ${w})`);
    const st = job.steps.find(s => s.key === 'final');
    if (st) st.note = job.verdictText;
    job.actions = buildActions(job);

    const hist = U.storage.get(HIST_KEY, []);
    hist.unshift({
      at: Date.now(), fileName: job.file.name, hash: job.hash, dhash: job.dhash || null,
      verdict: job.verdictText, level: job.verdict, score: job.score, applicant: job.inputs.name || (job.fields.name && job.fields.name.text) || '',
      academy: job.fields.academy || job.inputs.academy || '', rate: job.fields.rate ? job.fields.rate.raw + '%' : ''
    });
    U.storage.set(HIST_KEY, hist.slice(0, 300));
  }

  function buildActions(job) {
    const a = [];
    const has = (cat, lv) => job.findings.some(f => f.category === cat && (!lv || lv.includes(f.level)));
    const tc = job.doc.toolClass || {};
    if (job.verdict === 'danger') a.push('신청자에게 학원에서 <b>새로 발급받은 원본</b>(학원 홈페이지에서 직접 내려받은 PDF)을 다시 요청하세요.');
    a.push('학원에 직접 연락해 출석률·수강기간을 확인하세요. 전화번호는 문서에 적힌 번호가 아닌 <b>학원 공식 홈페이지 번호</b>를 쓰세요.' + (job.fields.phones && job.fields.phones.length ? ` (문서상 번호: ${job.fields.phones.map(U.escapeHtml).join(', ')})` : ''));
    if (job.kind === 'image' || job.doc.scanned) a.push('사진·스캔본은 위변조 흔적이 지워지기 쉬워요. 가능하면 <b>PDF 원본</b>으로 받으세요.');
    if (tc.browser && tc.browser.length) a.push('웹 화면을 인쇄한 PDF예요. 담당자가 학원 홈페이지(수강생 출결 조회)를 신청자와 함께 직접 확인하면 가장 확실해요.');
    if (job.fields.docNo) a.push(`문서 확인번호 <b>${U.escapeHtml(job.fields.docNo.text)}</b>로 학원 홈페이지 진위확인 메뉴를 이용하세요.`);
    if (has('출석률', ['warn']) && !job.template) a.push('학원의 출석률 계산 방식(지각 처리·반올림)을 확인한 뒤 "정상 양식 관리"에 규칙을 저장해 두세요.');
    if (!job.template && job.verdict !== 'danger') a.push('이 학원 출석증이 진본으로 확인되면 <b>정상 양식으로 등록</b>해 두세요. 다음 검사부터 양식을 자동 대조해요.');
    return a;
  }

  // ───────── 화면 그리기 ─────────
  function select(job) { current = job; viewMode = 'regions'; renderJobTabs(); renderAll(); }

  function renderJobTabs() {
    const el = $('#jobTabs');
    if (jobs.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = jobs.map(j => `<button class="job-tab ${j === current ? 'on' : ''}" data-id="${j.id}">
      <i class="dot ${j.verdict || (j.state === 'running' ? 'run' : 'wait')}"></i>${U.escapeHtml(j.file.name)}</button>`).join('');
    el.querySelectorAll('.job-tab').forEach(b => b.onclick = () => select(jobs.find(j => j.id === b.dataset.id)));
  }

  function renderAll() { renderProcess(); renderResult(); renderViewer(); renderJobTabs(); }

  function renderProcess() {
    const job = current;
    if (!job) return;
    const icon = s => ({
      wait: '<span class="si wait"></span>',
      run: '<span class="si run"><span class="spin"></span></span>',
      done: '<span class="si done">✓</span>',
      warn: '<span class="si warn">!</span>',
      danger: '<span class="si danger">!</span>',
      error: '<span class="si danger">×</span>',
      skip: '<span class="si wait">–</span>'
    }[s]);
    $('#steps').innerHTML = job.steps.map((s, i) => `
      <li class="step ${s.status}">
        ${icon(s.status)}
        <div class="step-body">
          <div class="step-name"><span class="step-no">${i + 1}</span>${s.name}</div>
          <div class="step-note">${U.escapeHtml(s.status === 'wait' ? s.desc : (s.note || s.desc))}</div>
        </div>
      </li>`).join('');
    const pill = $('#procState');
    const done = job.steps.filter(s => !['wait', 'run'].includes(s.status)).length;
    pill.textContent = job.state === 'done' ? '완료' : job.state === 'running' ? `진행 중 ${done}/${job.steps.length}` : '대기';
    pill.className = 'pill ' + (job.state === 'done' ? 'done' : job.state === 'running' ? 'run' : '');
    const lg = $('#log');
    lg.textContent = job.logs.map(l => l.t).join('\n');
    lg.scrollTop = lg.scrollHeight;
  }

  function renderResult() {
    const job = current, el = $('#result');
    $('#printBtn').disabled = !(job && job.state === 'done');
    if (!job || job.state !== 'done') {
      el.className = 'result-empty';
      el.innerHTML = `<div class="spinner-lg"></div><p>${job && job.state === 'running' ? '꼼꼼하게 검사하고 있어요…' : '검사가 끝나면 결과가 여기에 나타나요'}</p>`;
      return;
    }
    el.className = '';
    const F = job.fields;
    const cnt = lv => job.findings.filter(f => f.level === lv).length;
    const vIcon = { danger: '!', warn: '?', ok: '✓' }[job.verdict];
    const vDesc = {
      danger: '위변조가 의심되는 흔적이 발견됐어요. 아래 빨간 항목과 의심 영역을 확인하세요.',
      warn: '확실한 위변조 흔적은 없지만, 직접 확인이 필요한 부분이 있어요.',
      ok: '자동 검사에서 이상한 점을 찾지 못했어요. 그래도 중요한 건은 학원에 확인하세요.'
    }[job.verdict];
    const val = (o, u = '') => o ? `${U.escapeHtml(o.raw)}${U.escapeHtml(o.unit || u)}` : '<span class="muted">찾지 못함</span>';
    const rc = F.rateCalc;
    const rateMismatch = F.rate && rc && Math.abs(rc.computed - F.rate.value) > 1e-6;
    const rows = [
      ['발급기관', F.academy ? U.escapeHtml(F.academy) : '<span class="muted">찾지 못함</span>'],
      ['이름', F.name ? U.escapeHtml(F.name.text) : '<span class="muted">찾지 못함</span>'],
      ['과정', F.course ? U.escapeHtml(F.course.text) : '<span class="muted">-</span>'],
      ['수강기간', F.period ? `${U.fmtDate(F.period.start)} ~ ${U.fmtDate(F.period.end)}${F.periodDays ? ` <span class="muted">(${F.periodDays.days}일, 평일 ${F.periodDays.weekdays}일)</span>` : ''}` : '<span class="muted">찾지 못함</span>'],
      ['발급일', F.issue ? U.fmtDate(F.issue.date) + (F.issue.labeled ? '' : ' <span class="muted">(추정)</span>') : '<span class="muted">찾지 못함</span>'],
      ['총 수업일수', val(F.total)],
      ['출석', val(F.attend)],
      ['결석 · 지각 · 조퇴', `${val(F.absent)} · ${val(F.late)} · ${val(F.early)}`],
      ['출석률 (문서)', F.rate ? `<b class="${rateMismatch ? 't-danger' : ''}">${U.escapeHtml(F.rate.raw)}%</b>` : '<span class="muted">찾지 못함</span>'],
      ['출석률 (다시 계산)', rc ? `<b class="${rateMismatch ? 't-danger' : 't-ok'}">${rc.computed}%</b> <span class="muted">${rc.exact.toFixed(3)}% → 소수 ${rc.decimals}자리 ${rc.method}</span>` : '<span class="muted">계산 불가</span>']
    ];
    if (F.templateScore != null) rows.push(['정상 양식 일치도', `${F.templateScore}%`]);

    const order = { danger: 0, warn: 1, info: 2, ok: 3 };
    const list = job.findings.slice().sort((a, b) => order[a.level] - order[b.level]);
    const q = encodeURIComponent((F.academy || job.inputs.academy || '').trim());

    el.innerHTML = `
      <div class="verdict ${job.verdict}">
        <div class="v-icon">${vIcon}</div>
        <div class="v-body">
          <div class="v-label">${job.verdictText}</div>
          <div class="v-desc">${vDesc}</div>
        </div>
      </div>
      <div class="score">
        <div class="score-top"><span>위험도</span><b>${job.score}<small>/100</small></b></div>
        <div class="bar"><i style="width:${Math.max(3, job.score)}%" class="${job.verdict}"></i></div>
      </div>
      <div class="counts">
        <button class="cnt danger" data-f="danger"><b>${cnt('danger')}</b>이상징후</button>
        <button class="cnt warn" data-f="warn"><b>${cnt('warn')}</b>추가 확인</button>
        <button class="cnt ok" data-f="ok"><b>${cnt('ok')}</b>정상</button>
        <button class="cnt info" data-f="info"><b>${cnt('info')}</b>참고</button>
      </div>

      <h3 class="sub">출석증에서 읽은 내용</h3>
      <table class="kv">${rows.map(r => `<tr><th>${r[0]}</th><td>${r[1]}</td></tr>`).join('')}</table>

      <div class="sub-row">
        <h3 class="sub">세부 검토 결과</h3>
        <div class="seg small" id="fFilter">
          <button data-f="all" class="on">전체</button><button data-f="danger">이상징후</button><button data-f="warn">추가 확인</button><button data-f="ok">정상</button>
        </div>
      </div>
      <ul class="findings" id="findings">
        ${list.map(f => `
          <li class="finding ${f.level}" data-level="${f.level}">
            <div class="f-top">
              <span class="chip ${f.level}">${LEVEL[f.level].label}</span>
              <span class="f-cat">${U.escapeHtml(f.category)}</span>
              ${f.regions.length && f.level !== 'ok' ? `<button class="f-loc" data-id="${f.id}">위치 보기 <b>#${f.id}</b></button>` : ''}
            </div>
            <div class="f-title">${U.escapeHtml(f.title)}</div>
            ${f.detail ? `<div class="f-detail">${f.detail}</div>` : ''}
          </li>`).join('')}
      </ul>

      <h3 class="sub">이렇게 확인해 보세요</h3>
      <ol class="actions">${job.actions.map(a => `<li>${a}</li>`).join('')}</ol>

      <div class="btn-row">
        ${job.state === 'done' && job.doc.pages.length ? `<button class="btn btn-soft" id="regTpl">${job.template ? '정상 양식 다시 등록' : '진본 확인됨 · 정상 양식으로 등록'}</button>` : ''}
        ${q ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/search?q=${q}+%EC%B6%9C%EC%84%9D%EC%A6%9D+%EC%96%91%EC%8B%9D">학원 출석증 양식 검색</a>
        <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/search?q=${q}+%EC%B6%9C%EC%84%9D%EB%A5%A0+%EA%B8%B0%EC%A4%80+%EC%A7%80%EA%B0%81">출석률 산정 기준 검색</a>` : ''}
      </div>`;

    el.querySelectorAll('.cnt, #fFilter button').forEach(b => b.onclick = () => filterFindings(b.dataset.f));
    el.querySelectorAll('.f-loc').forEach(b => b.onclick = () => focusFinding(+b.dataset.id));
    const rb = el.querySelector('#regTpl');
    if (rb) rb.onclick = () => openTplModal({ job });
  }

  function filterFindings(f) {
    document.querySelectorAll('#fFilter button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
    document.querySelectorAll('#findings .finding').forEach(li => li.hidden = !(f === 'all' || li.dataset.level === f));
    document.querySelector('#findings').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ───────── 뷰어 ─────────
  const urlCache = new WeakMap();
  function canvasUrl(c) {
    if (!urlCache.has(c)) urlCache.set(c, c.toDataURL('image/png'));
    return urlCache.get(c);
  }

  function renderViewer() {
    const job = current;
    const tabsEl = $('#viewTabs'), v = $('#viewer');
    if (!job || !job.doc.pages.length) {
      tabsEl.innerHTML = ''; v.innerHTML = `<p class="muted center">${job && job.state === 'running' ? '문서를 여는 중…' : '표시할 문서가 없어요'}</p>`;
      return;
    }
    const tabs = [['regions', '의심 영역']];
    if (job.kind === 'pdf' && !job.doc.scanned) tabs.push(['fonts', '글꼴 지도']);
    if (job.doc.ela) tabs.push(['ela', 'ELA 분석']);
    if (job.doc.revisions && job.doc.revisions.length) tabs.push(['revision', '이전 버전']);
    if (job.doc.thumbnail) tabs.push(['thumb', '썸네일 비교']);
    tabs.push(['text', '읽은 글자'], ['meta', '파일 정보']);
    if (!tabs.some(t => t[0] === viewMode)) viewMode = 'regions';
    tabsEl.innerHTML = tabs.map(([k, n]) => `<button data-m="${k}" class="${k === viewMode ? 'on' : ''}">${n}</button>`).join('');
    tabsEl.querySelectorAll('button').forEach(b => b.onclick = () => { viewMode = b.dataset.m; renderViewer(); });

    if (viewMode === 'regions' || viewMode === 'ela') {
      const pages = viewMode === 'ela' ? job.doc.pages.slice(0, 1) : job.doc.pages;
      v.innerHTML = (viewMode === 'ela' ? `<p class="hint">밝게 빛나는 곳은 다시 압축할 때 오차가 큰 곳이에요. 글자 테두리는 원래 밝게 보여요. <b>숫자 한두 개만 유난히 밝거나 네모 모양으로 튀는 부분</b>이 있다면 붙여넣은 흔적일 수 있어요.</p>` : '') +
        pages.map(pg => {
          const src = viewMode === 'ela' ? canvasUrl(job.doc.ela.canvas) : canvasUrl(pg.canvas);
          const boxes = [];
          for (const f of job.findings) {
            if (f.level === 'ok') continue;
            if (viewMode === 'ela' && f.category !== '이미지') continue;
            f.regions.filter(r => (r.page || 0) === pg.index).forEach(r => {
              const lv = r.info || f.level === 'info' ? 'info' : f.level;
              boxes.push(`<div class="box ${lv}" data-fid="${f.id}" title="#${f.id} ${U.escapeHtml(f.title)}" style="left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%"><span>${f.id}</span></div>`);
            });
          }
          return `<div class="page-wrap">${job.doc.pages.length > 1 ? `<div class="page-label">${pg.index + 1}쪽</div>` : ''}
            <div class="stage"><img src="${src}" alt="${pg.index + 1}쪽">${boxes.join('')}</div></div>`;
        }).join('');
      v.querySelectorAll('.box').forEach(b => b.onclick = () => {
        const li = document.querySelector(`.f-loc[data-id="${b.dataset.fid}"]`);
        if (li) { li.closest('.finding').scrollIntoView({ behavior: 'smooth', block: 'center' }); li.closest('.finding').classList.add('flash'); setTimeout(() => li.closest('.finding').classList.remove('flash'), 1600); }
      });
    } else if (viewMode === 'fonts') {
      const fonts = (job.doc.fontStats || []).map(f => f.font);
      const palette = ['#3182F6', '#00B386', '#F04452', '#FF9500', '#8B5CF6', '#00A3D9', '#E94FAE', '#6B7684', '#B38600', '#2D3540'];
      const col = f => palette[Math.max(0, fonts.indexOf(f)) % palette.length];
      v.innerHTML = `<p class="hint">글꼴마다 다른 색으로 표시했어요. <b>숫자 하나만 다른 색</b>이면 그 글자만 따로 고쳐 넣었을 수 있어요.</p>
        <div class="font-legend">${(job.doc.fontStats || []).map(f => `<span><i style="background:${col(f.font)}"></i>${U.escapeHtml(f.font)} <em>${Math.round(f.share * 100)}%</em></span>`).join('')}</div>` +
        job.doc.pages.map(pg => `<div class="page-wrap">${job.doc.pages.length > 1 ? `<div class="page-label">${pg.index + 1}쪽</div>` : ''}<div class="stage dim"><img src="${canvasUrl(pg.canvas)}">` +
          pg.items.filter(it => it.source === 'text').map(it => `<div class="fbox" title="${U.escapeHtml(it.font)} · ${it.sizePt.toFixed(2)}pt" style="left:${it.x * 100}%;top:${it.y * 100}%;width:${it.w * 100}%;height:${it.h * 100}%;border-color:${col(it.fontBase)};background:${col(it.fontBase)}22"></div>`).join('') +
          `</div></div>`).join('');
    } else if (viewMode === 'revision') {
      v.innerHTML = `<p class="hint">파일 안에 남아 있던 <b>이전 버전</b>을 복원했어요. 지금 모습과 나란히 비교해 보세요.</p><div class="compare">` +
        job.doc.revisions.map(r => `<figure><img src="${canvasUrl(r.canvas)}"><figcaption>이전 버전 (${r.index}번째 저장)</figcaption></figure>`).join('') +
        `<figure><img src="${canvasUrl(job.doc.pages[0].canvas)}"><figcaption>제출된 최종 모습</figcaption></figure></div>`;
    } else if (viewMode === 'thumb') {
      v.innerHTML = `<p class="hint">사진 파일 안에 들어 있는 작은 미리보기(썸네일)와 실제 사진이에요. 내용이 다르면 사진을 고친 흔적이에요.</p><div class="compare">
        <figure><img src="${job.doc.thumbnail.src}" style="image-rendering:auto"><figcaption>내장 썸네일</figcaption></figure>
        <figure><img src="${canvasUrl(job.doc.pages[0].canvas)}"><figcaption>실제 사진</figcaption></figure></div>`;
    } else if (viewMode === 'text') {
      v.innerHTML = `<p class="hint">${job.doc.lines.some(l => l.items.some(i => i.source === 'ocr')) ? '사진에서 글자 인식(OCR)으로 읽은 내용이에요. 인식 오류가 있을 수 있어요.' : 'PDF 안에 들어 있는 글자 정보예요.'}</p><pre class="textdump">${U.escapeHtml(job.doc.text || '(읽은 글자 없음)')}</pre>`;
    } else if (viewMode === 'meta') {
      const M = job.doc.meta || {}, S = job.doc.structure || {};
      const rows = [
        ['파일 이름', job.file.name], ['실제 형식', (job.fileType || '').toUpperCase()], ['크기', U.fmtBytes(job.file.size)], ['SHA-256', job.hash || '-'],
        ['페이지 수', job.doc.numPages || 1]
      ];
      if (job.kind === 'pdf') {
        rows.push(['PDF 버전', S.version], ['저장 구간(%%EOF)', S.eofCount], ['추가 저장 횟수', S.incrementalUpdates], ['웹 최적화', S.linearized ? '예' : '아니오'],
          ['전자서명', S.hasSignature ? '있음' : '없음'], ['제목', M.title || '-'], ['작성자', M.author || '-'], ['만든 프로그램(Creator)', M.creator || '-'], ['변환 프로그램(Producer)', M.producer || '-'],
          ['생성일', U.fmtDateTime(M.creation)], ['수정일', U.fmtDateTime(M.modified)], ['파일에 남은 프로그램 기록', (M.tools || []).join(' / ') || '-'],
          ['스캔본 여부', job.doc.scanned ? '예 (글자 인식 사용)' : job.doc.hasOcrLayer ? '스캔 + 글자 레이어' : '아니오'],
          ['사용 글꼴', (job.doc.fontStats || []).map(f => f.font).join(', ') || '-']);
      } else {
        rows.push(['이미지 크기', job.doc.origSize ? `${job.doc.origSize.w} × ${job.doc.origSize.h}` : '-'], ['촬영 기기', `${M.make || ''} ${M.model || ''}`.trim() || '-'],
          ['프로그램', M.software || M.creatorTool || '-'], ['촬영 시각', U.fmtDateTime(M.original)], ['수정 시각', U.fmtDateTime(M.modified)],
          ['JPEG 품질 추정', S.quality ? S.quality + '%' : '-'], ['파일 구성 블록', (S.segments || []).join(' ')]);
      }
      v.innerHTML = `<table class="kv wide">${rows.map(r => `<tr><th>${r[0]}</th><td>${U.escapeHtml(r[1] == null ? '-' : r[1])}</td></tr>`).join('')}</table>`;
    }
  }

  function focusFinding(id) {
    viewMode = current.doc.ela && current.findings.find(f => f.id === id).category === '이미지' && current.fileType === 'jpeg' ? viewMode : 'regions';
    if (viewMode !== 'regions' && viewMode !== 'ela') viewMode = 'regions';
    renderViewer();
    const boxes = document.querySelectorAll(`#viewer .box[data-fid="${id}"]`);
    if (boxes.length) {
      boxes[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      boxes.forEach(b => { b.classList.add('pulse'); setTimeout(() => b.classList.remove('pulse'), 2400); });
    } else {
      $('#viewer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  $('#printBtn').onclick = () => {
    viewMode = 'regions'; renderViewer();
    setTimeout(() => window.print(), 200);
  };

  // ───────── 정상 양식 관리 ─────────
  let modalCtx = null;
  function openTplModal(ctx) {
    modalCtx = ctx;
    const t = ctx.tpl;
    $('#modalTitle').textContent = t ? `"${t.academy}" 설정 수정` : ctx.job ? '정상 양식으로 등록' : '학원 계산 규칙 등록';
    $('#mAcademy').value = t ? t.academy : (ctx.job ? (ctx.job.fields.academy || ctx.job.inputs.academy || '') : '');
    $('#mAliases').value = t ? (t.aliases || []).join(', ') : '';
    const r = (t && t.rule) || {};
    $('#mLate').value = r.lateRule || 'none';
    $('#mRound').value = r.rounding || 'round';
    $('#mDec').value = r.decimals == null ? 'auto' : String(r.decimals);
    $('#mNote').value = t ? t.note || '' : '';
    $('#modal').hidden = false;
    $('#mAcademy').focus();
  }
  $('#mCancel').onclick = () => { $('#modal').hidden = true; };
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  $('#mSave').onclick = () => {
    const academy = $('#mAcademy').value.trim();
    if (!academy) { toast('학원명을 입력해 주세요'); return; }
    const ctx = modalCtx || {};
    const old = ctx.tpl;
    const tpl = {
      id: old ? old.id : 'tpl_' + Date.now(),
      academy,
      aliases: $('#mAliases').value.split(',').map(s => s.trim()).filter(Boolean),
      rule: { lateRule: $('#mLate').value, rounding: $('#mRound').value, decimals: $('#mDec').value === 'auto' ? null : +$('#mDec').value },
      note: $('#mNote').value.trim(),
      features: ctx.job ? TemplateStore.features(ctx.job) : (old ? old.features : null),
      sourceFile: ctx.job ? ctx.job.file.name : (old ? old.sourceFile : ''),
      createdAt: old ? old.createdAt : Date.now(), updatedAt: Date.now()
    };
    if (!TemplateStore.upsert(tpl)) { toast('저장하지 못했어요 (브라우저 저장공간 확인)'); return; }
    $('#modal').hidden = true;
    renderTemplates();
    toast(`"${academy}" 저장 완료`);
  };

  function renderTemplates() {
    const list = TemplateStore.all();
    $('#tplList').innerHTML = list.length ? list.map(t => `
      <div class="tpl">
        <div class="tpl-main">
          <div class="tpl-name">${U.escapeHtml(t.academy)} ${t.features ? '<span class="chip ok">양식</span>' : ''} <span class="chip info">계산 규칙</span></div>
          <div class="tpl-meta">${TemplateStore.ruleText(t.rule)}${t.aliases && t.aliases.length ? ' · 다른 이름: ' + t.aliases.map(U.escapeHtml).join(', ') : ''}</div>
          <div class="tpl-meta muted">${t.sourceFile ? '원본: ' + U.escapeHtml(t.sourceFile) + ' · ' : ''}${U.fmtDate(new Date(t.updatedAt || t.createdAt))}${t.note ? ' · ' + U.escapeHtml(t.note) : ''}</div>
        </div>
        <div class="tpl-actions"><button class="btn btn-ghost btn-sm" data-edit="${t.id}">수정</button><button class="btn btn-ghost btn-sm danger" data-del="${t.id}">삭제</button></div>
      </div>`).join('') : `<div class="empty">아직 등록된 양식이 없어요.<br><span class="muted">검사 결과 화면에서 "정상 양식으로 등록"을 누르거나, "계산 규칙만 등록"으로 학원별 출석률 계산법을 저장하세요.</span></div>`;
    $('#tplList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openTplModal({ tpl: TemplateStore.all().find(t => t.id === b.dataset.edit) }));
    $('#tplList').querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const t = TemplateStore.all().find(x => x.id === b.dataset.del);
      if (t && confirm(`"${t.academy}" 양식을 삭제할까요?`)) { TemplateStore.remove(t.id); renderTemplates(); }
    });
  }
  $('#tplAddRule').onclick = () => openTplModal({});
  $('#tplExport').onclick = () => {
    const blob = new Blob([JSON.stringify(TemplateStore.all(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `정상양식_${U.fmtDate(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#tplImport').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const arr = JSON.parse(await f.text());
      if (!Array.isArray(arr)) throw new Error();
      const cur = TemplateStore.all();
      for (const t of arr) if (t && t.id && t.academy) { const i = cur.findIndex(x => x.id === t.id); if (i >= 0) cur[i] = t; else cur.push(t); }
      TemplateStore.saveAll(cur); renderTemplates(); toast(`${arr.length}개 양식을 가져왔어요`);
    } catch (err) { toast('올바른 양식 파일이 아니에요'); }
    e.target.value = '';
  };

  // ───────── 검사 이력 ─────────
  function renderHistory() {
    const hist = U.storage.get(HIST_KEY, []);
    $('#histList').innerHTML = hist.length ? `<div class="table-wrap"><table class="hist"><thead><tr><th>검사 시각</th><th>파일</th><th>신청자</th><th>학원</th><th>출석률</th><th>결과</th></tr></thead><tbody>` +
      hist.slice(0, 100).map(h => `<tr><td>${U.fmtDateTime(new Date(h.at))}</td><td class="ellipsis">${U.escapeHtml(h.fileName)}</td><td>${U.escapeHtml(h.applicant || '-')}</td><td class="ellipsis">${U.escapeHtml(h.academy || '-')}</td><td>${U.escapeHtml(h.rate || '-')}</td><td><span class="chip ${h.level}">${U.escapeHtml(h.verdict)}</span></td></tr>`).join('') +
      `</tbody></table></div>` : '<div class="empty">아직 검사 이력이 없어요.</div>';
  }
  $('#histClear').onclick = () => { if (confirm('검사 이력을 모두 지울까요? (중복 제출 확인에 쓰이는 정보도 함께 지워져요)')) { U.storage.set(HIST_KEY, []); renderHistory(); } };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2400);
  }

  if (!window.pdfjsLib) toast('PDF 분석 도구를 불러오지 못했어요. 인터넷 연결을 확인하세요.');
  renderTemplates();
  renderHistory();
})();
