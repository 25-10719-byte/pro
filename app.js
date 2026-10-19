(function () {
  'use strict';

  var STORAGE_KEY = 'nachimban.profile.v1';
  var demoProfile = {
    name: '장동우', grade: '2', track: '컴퓨터·AI', major: '인공지능·컴퓨터공학',
    interest: '생성형 AI, 데이터 시각화, 사회 문제 해결',
    record: '인공지능의 학습 원리에 관심을 갖고 지도학습과 비지도학습의 차이를 조사함. 공개된 기상 데이터를 활용해 기온과 강수량의 관계를 그래프로 시각화하고, 결측값 처리 방식에 따라 분석 결과가 달라지는 이유를 비교함. 팀 발표에서 데이터만으로 현상을 단정하기 어렵다는 한계를 짚고 추가로 확인할 자료를 제안함. 탐구 과정과 결과를 보고서로 정리하며 알고리즘의 편향 문제까지 주제를 확장함.',
    grades: [
      { subject: '수학', term: '2학년 1학기', grade: '2' },
      { subject: '영어', term: '2학년 1학기', grade: '2' },
      { subject: '통합과학', term: '2학년 1학기', grade: '2' },
      { subject: '정보', term: '2학년 1학기', grade: '3' }
    ]
  };
  var state = { profile: clone(demoProfile), analysis: null, hasRun: false, apiConfigured: false };
  var competencyNames = ['학업 탐구력', '진로 연계성', '탐구 지속성', '소통·협력'];
  var mapSteps = [
    { title: '관심 발견', phase: '지금 · 시작', desc: '관심 있는 현상과 수업에서 생긴 질문을 기록해 보세요.', cls: 'phase-now' },
    { title: '기초 개념 다지기', phase: '다음 · 학습', desc: '교과 개념을 정리하고 서로 다른 설명 자료를 비교해 보세요.', cls: 'phase-next' },
    { title: '작은 탐구 설계', phase: '다음 · 탐구', desc: '확인할 질문과 자료 수집 방법, 예상되는 한계를 먼저 적어 보세요.', cls: 'phase-next' },
    { title: '자료 분석과 해석', phase: '앞으로 · 분석', desc: '자료를 표나 그래프로 정리하고, 다른 해석 가능성도 함께 살펴보세요.', cls: 'phase-later' },
    { title: '배운 점 나누기', phase: '앞으로 · 공유', desc: '탐구 과정과 근거를 발표나 보고서로 정리해 다른 사람과 나눠 보세요.', cls: 'phase-later' },
    { title: '진로 경험 넓히기', phase: '앞으로 · 확장', desc: '관련 분야의 강연, 동아리, 교내 활동 중 할 수 있는 작은 경험을 찾아보세요.', cls: 'phase-later' },
    { title: '다음 질문 만들기', phase: '계속 · 성장', desc: '이번 탐구에서 남은 궁금증을 다음 학기의 질문으로 이어 보세요.', cls: 'phase-now' }
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }
  function getAverage(grades) {
    var numbers = (grades || []).map(function (item) { return Number(item.grade); }).filter(function (n) { return Number.isFinite(n) && n >= 1 && n <= 9; });
    if (!numbers.length) return 0;
    return numbers.reduce(function (sum, n) { return sum + n; }, 0) / numbers.length;
  }
  function getProfileFromForm() {
    var rows = Array.prototype.slice.call(document.querySelectorAll('#grade-rows tr'));
    var grades = rows.map(function (row) {
      return {
        subject: row.querySelector('.grade-subject').value.trim(),
        term: row.querySelector('.grade-term').value,
        grade: row.querySelector('.grade-value').value.trim()
      };
    }).filter(function (row) { return row.subject || row.grade; });
    return {
      name: document.getElementById('student-name').value.trim(),
      grade: document.getElementById('student-grade').value,
      track: document.getElementById('student-track').value,
      major: document.getElementById('student-major').value.trim(),
      interest: document.getElementById('student-interest').value.trim(),
      record: document.getElementById('student-record').value.trim(),
      grades: grades
    };
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: state.profile, analysis: state.analysis }));
      showToast('입력 내용이 이 브라우저에 저장됐어요.');
    } catch (error) {
      showToast('브라우저 저장 공간을 사용할 수 없어요.');
    }
  }
  function loadSavedState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && saved.profile && Array.isArray(saved.profile.grades)) {
        state.profile = Object.assign(clone(demoProfile), saved.profile);
        state.analysis = saved.analysis || null;
        state.hasRun = Boolean(saved.analysis);
        return true;
      }
    } catch (error) { /* damaged local data is ignored */ }
    return false;
  }
  function showToast(message) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () { toast.classList.remove('show'); }, 2400);
  }
  function showFormMessage(message, isError) {
    var target = document.getElementById('form-message');
    target.textContent = message || '';
    target.classList.toggle('error', Boolean(isError));
  }
  function updateAnalysisNotice() {
    var mode = document.getElementById('analysis-mode-pill');
    var privacy = document.getElementById('privacy-message');
    var note = document.getElementById('analysis-note');
    if (!mode || !privacy || !note) return;
    mode.textContent = state.apiConfigured ? 'Gemini API 연결됨' : '로컬 규칙 분석';
    privacy.textContent = state.apiConfigured
      ? 'Gemini 분석 시 이름을 제외한 입력 내용이 Google로 전송돼요.'
      : '입력 내용은 이 브라우저에서만 처리돼요.';
    if (state.analysis && state.analysis.aiPowered) {
      note.textContent = 'Gemini가 피드백을 생성했어요. 점수는 로컬 참고 지표이며, 대학별 입시 데이터는 연결되지 않았습니다.';
    } else if (state.apiConfigured) {
      note.textContent = 'AI 분석을 실행하면 이름을 제외한 입력 내용이 Google Gemini API로 전송됩니다.';
    } else {
      note.textContent = '키워드 기반 기본 분석입니다. 외부 AI·입시 데이터는 연결되지 않았으며, 점수는 참고용 지표예요.';
    }
  }
  function updateApiStatus() {
    fetch('/api/status', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('status');
      return response.json();
    }).then(function (result) {
      state.apiConfigured = Boolean(result.geminiConfigured);
      updateAnalysisNotice();
    }).catch(function () {
      state.apiConfigured = false;
      updateAnalysisNotice();
    });
  }
  async function requestAiFeedback(profile) {
    var response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: {
        grade: profile.grade, track: profile.track, major: profile.major,
        interest: profile.interest, record: profile.record, grades: profile.grades
      } })
    });
    var payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Gemini 분석에 실패했습니다.');
    if (!payload.feedback || !Array.isArray(payload.feedback.strengths) || !Array.isArray(payload.feedback.growth) || !Array.isArray(payload.feedback.topics)) {
      throw new Error('Gemini 응답 형식이 올바르지 않습니다.');
    }
    return payload.feedback;
  }
  function makeGradeRow(grade) {
    var row = document.createElement('tr');
    row.innerHTML = '<td><input class="grade-subject" maxlength="24" aria-label="과목명" placeholder="예: 수학" value="' + escapeHtml(grade.subject || '') + '"></td>' +
      '<td><select class="grade-term" aria-label="학기">' + ['1학년 1학기','1학년 2학기','2학년 1학기','2학년 2학기','3학년 1학기','3학년 2학기'].map(function (term) { return '<option' + (grade.term === term ? ' selected' : '') + '>' + term + '</option>'; }).join('') + '</select></td>' +
      '<td><input class="grade-value" type="number" min="1" max="9" step="0.1" inputmode="decimal" aria-label="등급 1에서 9" placeholder="1~9" value="' + escapeHtml(grade.grade || '') + '"></td>' +
      '<td><button class="grade-remove" type="button" aria-label="과목 삭제">×</button></td>';
    return row;
  }
  function renderGrades(grades) {
    var tbody = document.getElementById('grade-rows');
    tbody.innerHTML = '';
    (grades || []).forEach(function (grade) { tbody.appendChild(makeGradeRow(grade)); });
    if (!grades || !grades.length) tbody.appendChild(makeGradeRow({ subject: '', term: '1학년 1학기', grade: '' }));
  }
  function populateForm(profile) {
    document.getElementById('student-name').value = profile.name || '';
    document.getElementById('student-grade').value = profile.grade || '1';
    document.getElementById('student-track').value = profile.track || '기타';
    document.getElementById('student-major').value = profile.major || '';
    document.getElementById('student-interest').value = profile.interest || '';
    document.getElementById('student-record').value = profile.record || '';
    document.getElementById('record-count').textContent = String((profile.record || '').length);
    renderGrades(profile.grades || []);
  }

  function analyze(profile) {
    var record = (profile.record || '').trim();
    var average = getAverage(profile.grades);
    var text = record.toLowerCase();
    var inquiryWords = ['탐구','조사','실험','분석','비교','자료','데이터','보고서','시각화','제작','구현','설계','측정','모델','질문','발표','토론','프로젝트','해결','관찰','검증'];
    var evidenceWords = ['결과','근거','수치','그래프','표본','오차','한계','개선','비교','과정','검토','성찰','피드백','원인'];
    var teamWords = ['협력','팀','공동','토론','발표','의견','소통','역할','공유','도움','조율'];
    var depthWords = ['한계','후속','확장','추가','다시','개선','검증','대안','다른 관점','반례'];
    function countWords(words) { return words.reduce(function (count, word) { return count + (text.indexOf(word) >= 0 ? 1 : 0); }, 0); }
    var inquiryCount = countWords(inquiryWords);
    var evidenceCount = countWords(evidenceWords) + (/[0-9]+/.test(record) ? 1 : 0);
    var teamCount = countWords(teamWords);
    var depthCount = countWords(depthWords);
    var trackWords = {
      '컴퓨터·AI':['인공지능','알고리즘','데이터','코딩','컴퓨터','소프트웨어','모델','정보'],
      '자연·공학':['실험','설계','에너지','물리','화학','수학','공학','측정'],
      '생명·의학':['생명','생물','세포','의학','건강','유전자','생태','질병'],
      '경영·경제':['경제','시장','기업','소비','금융','경영','통계','사회'],
      '인문·사회':['사회','역사','문화','언어','정책','심리','인권','철학'],
      '교육':['교육','학습','학생','수업','교사','학교','발달','교육과정'],
      '예술·체육':['디자인','예술','음악','미술','운동','스포츠','창작','표현'],
      '기타':[]
    };
    var relatedWords = trackWords[profile.track] || [];
    var relatedCount = relatedWords.reduce(function (count, word) { return count + (text.indexOf(word) >= 0 ? 1 : 0); }, 0);
    var keywordList = (profile.interest || '').split(/[,，/·\s]+/).filter(function (part) { return part.length > 1; }).slice(0, 6);
    relatedCount += keywordList.filter(function (word) { return text.indexOf(word.toLowerCase()) >= 0; }).length;
    var recordScore = clamp(Math.round(45 + Math.min(record.length, 400) * 0.07 + inquiryCount * 2 + evidenceCount * 2 + depthCount * 2), 28, 96);
    var academic = clamp(Math.round(42 + inquiryCount * 5 + evidenceCount * 4 + Math.min(record.length, 300) * 0.06), 30, 96);
    var career = clamp(Math.round(48 + relatedCount * 8 + (profile.major ? 8 : 0)), 32, 96);
    var persistence = clamp(Math.round(45 + inquiryCount * 4 + depthCount * 7 + evidenceCount * 2), 30, 96);
    var collaboration = clamp(Math.round(48 + teamCount * 9 + (record.length > 160 ? 5 : 0)), 32, 95);
    var areas = [academic, career, persistence, collaboration];
    var overall = Math.round(areas.reduce(function (sum, n) { return sum + n; }, 0) / areas.length);
    var strengths = [];
    if (inquiryCount >= 3) strengths.push('수업에서 생긴 질문을 조사와 분석으로 이어가는 흐름이 보여요.');
    if (evidenceCount >= 2) strengths.push('자료나 근거를 바탕으로 결과를 설명하려는 태도가 드러나요.');
    if (relatedCount >= 2) strengths.push('관심 진로와 교과 활동이 연결되는 단서가 있어요.');
    if (teamCount >= 2) strengths.push('생각을 나누고 협력한 과정이 기록에 담겨 있어요.');
    if (depthCount >= 1) strengths.push('한계나 후속 질문을 살피며 탐구를 확장한 흔적이 보여요.');
    if (!strengths.length) strengths.push('관심 분야와 교과 경험을 바탕으로 성장 방향을 찾아가는 중이에요.');
    strengths = strengths.slice(0, 3);
    var growth = [];
    if (record.length < 100) growth.push('활동에서 맡은 역할과 직접 시도한 방법을 한두 문장 더 적어보세요.');
    if (evidenceCount < 2) growth.push('관찰한 자료, 수치, 비교 기준을 덧붙이면 생각의 근거가 또렷해져요.');
    if (depthCount < 1) growth.push('탐구의 한계나 새롭게 남은 질문을 적어 다음 탐구로 연결해 보세요.');
    if (teamCount < 1) growth.push('질문을 나눈 과정이나 피드백을 반영한 경험도 기록해 보세요.');
    if (!growth.length) growth.push('이번 탐구에서 남은 질문을 다른 교과의 개념과 연결해 확장해 보세요.');
    var weakSubjects = (profile.grades || []).filter(function (item) { return Number(item.grade) >= average + 0.6; }).sort(function (a,b) { return Number(b.grade) - Number(a.grade); }).slice(0, 2);
    var summary = record.length < 100 ? '기록이 짧아 기본적인 성장 단서 위주로 정리했어요.' : '입력된 기록에서 관심 분야와 탐구 과정의 연결점을 살펴봤어요.';
    var tip = growth[0] || '작은 질문 하나를 직접 확인해 보는 경험이 기록을 더 깊게 만들어요.';
    var major = profile.major || profile.track || '희망 진로';
    var topics = makeTopics(profile, keywordList, weakSubjects);
    return {
      overall: overall, average: average, strengths: strengths, growth: growth, areas: areas,
      recordScore: recordScore, summary: summary, tip: tip, weakSubjects: weakSubjects,
      topics: topics, major: major, keywordList: keywordList,
      fitScore: clamp(Math.round(92 - Math.max(0, average - 1) * 10 + (relatedCount > 1 ? 3 : 0)), 35, 96)
    };
  }
  function makeTopics(profile, keywords, weakSubjects) {
    var focus = keywords[0] || profile.track || '관심 분야';
    var subject = weakSubjects[0] ? weakSubjects[0].subject : '수학';
    var major = profile.major || profile.track || '희망 진로';
    return [
      { title: focus + '와 ' + subject + ' 개념은 어떻게 연결될까?', body: '수업에서 배운 개념을 하나 고르고, 관심 분야의 사례를 찾아 공통점과 차이를 표로 정리해 보세요.', tag: subject + ' × 진로' },
      { title: '자료를 고르는 방법에 따라 결론이 달라질까?', body: '공개 자료의 출처와 수집 기준을 비교하고, 표본이나 측정 방식이 결과 해석에 주는 영향을 살펴보세요.', tag: '자료 분석' },
      { title: major + ' 분야의 기술은 어떤 문제를 해결하고 있을까?', body: '실제 사례 한 가지를 골라 해결하려는 문제와 남아 있는 한계를 조사하고 개선 아이디어를 제안해 보세요.', tag: '진로 탐색' }
    ];
  }
  function renderAnalysis() {
    var profile = state.profile;
    var result = state.analysis || analyze(profile);
    state.analysis = result;
    var avgText = result.average ? result.average.toFixed(1) : '—';
    document.getElementById('snapshot-name').textContent = (profile.name || '학생') + ' 학생';
    document.getElementById('snapshot-major').textContent = (profile.major || profile.track || '진로 미입력') + ' 희망';
    document.getElementById('stat-score').textContent = String(result.overall);
    document.getElementById('stat-score-bar').style.width = result.overall + '%';
    document.getElementById('stat-grade').textContent = avgText;
    document.getElementById('stat-strengths').textContent = String(result.strengths.length).padStart(2, '0');
    document.getElementById('audit-score').textContent = String(result.overall);
    document.getElementById('score-ring').style.background = 'conic-gradient(#77985f 0deg,#a8bc7c ' + Math.round(result.overall * 3.6) + 'deg,#e9eee5 ' + Math.round(result.overall * 3.6) + 'deg 360deg)';
    document.getElementById('score-title').textContent = result.overall >= 78 ? '탐구를 확장하는 학생' : result.overall >= 58 ? '관심의 방향을 잡아가는 학생' : '성장의 단서를 모아가는 학생';
    document.getElementById('score-summary').textContent = result.summary;
    document.getElementById('audit-grade').textContent = profile.grade + '학년';
    document.getElementById('audit-record-length').textContent = profile.record.length + '자';
    var competencies = ['학업 탐구력','진로 연계성','탐구 지속성','소통·협력'];
    document.getElementById('competency-list').innerHTML = competencies.map(function (name, index) {
      return '<div class="competency-row"><span>' + name + '</span><span class="competency-track"><i style="width:' + result.areas[index] + '%"></i></span><b>' + result.areas[index] + '</b></div>';
    }).join('');
    document.getElementById('strength-list').innerHTML = result.strengths.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
    document.getElementById('growth-list').innerHTML = result.growth.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
    document.getElementById('next-step-tip').textContent = result.tip;
    document.getElementById('university-grid').innerHTML = makeUniversityCards(result, profile);
    document.getElementById('inquiry-focus').textContent = (profile.interest || profile.track || '관심 분야') + '와 교과를 잇는 질문의 출발점이에요.';
    document.getElementById('inquiry-grid').innerHTML = result.topics.map(function (topic, index) {
      return '<article class="inquiry-card"><span class="inquiry-number">QUESTION / 0' + (index + 1) + '</span><h3>' + escapeHtml(topic.title) + '</h3><p>' + escapeHtml(topic.body) + '</p><span class="inquiry-tag">' + escapeHtml(topic.tag) + '</span></article>';
    }).join('');
    renderResources(profile, result);
    renderRoadmap(profile);
    renderReport(profile, result);
    updateAnalysisNotice();
  }
  function makeUniversityCards(result, profile) {
    var avg = result.average || 4.5;
    var major = profile.major || profile.track || '관심 전공';
    var choices = [
      { name:'서울권 종합대학', note:'도전 검토', baseline:1.8, key:'stretch' },
      { name:'수도권 종합대학', note:'적정 검토', baseline:2.8, key:'fit' },
      { name:'지역 거점 국립대', note:'안정 검토', baseline:3.8, key:'safe' }
    ];
    return choices.map(function (choice) {
      var match = clamp(Math.round(88 - Math.abs(avg - choice.baseline) * 12 + (choice.key === 'stretch' && avg > 2.8 ? -5 : 0) + (choice.key === 'safe' && avg < 2 ? -5 : 0)), 38, 94);
      return '<article class="university-card"><div class="university-top"><span class="tier-pill tier-' + choice.key + '">' + choice.note + '</span><span class="university-match"><b>' + match + '</b> 참고 점수</span></div><h3>' + choice.name + '</h3><p>' + escapeHtml(major) + ' 계열 · 교과 탐색</p><div class="university-meta"><span>교과 평균 <strong>' + (result.average ? result.average.toFixed(1) : '입력 필요') + '</strong></span><span>시뮬레이션</span></div><div class="university-track"><i style="width:' + match + '%"></i></div></article>';
    }).join('');
  }
  function renderResources(profile, result) {
    var focus = profile.track || '관심 분야';
    var items = [
      { kind:'읽기 자료 · 출발점', initial:'읽', title:'교과 개념을 잇는 입문서', body:focus + '의 핵심 개념을 다루는 교과 연계 도서를 학교 도서관에서 골라보세요.', link:'도서관에서 찾아보기' },
      { kind:'온라인 학습 · 개념 보충', initial:'배', title:'부족한 교과 개념 채우기', body:(result.weakSubjects[0] ? result.weakSubjects[0].subject : '관심 교과') + '의 단원별 강의를 찾아 기본 개념과 용어를 정리해 보세요.', link:'학습 계획 세우기' },
      { kind:'탐구 방법 · 자료 활용', initial:'탐', title:'공개 자료로 작은 분석하기', body:'공공데이터와 연구 자료의 출처를 확인하고, 탐구 질문에 맞는 자료를 선택해 보세요.', link:'자료 출처 기록하기' }
    ];
    document.getElementById('resource-grid').innerHTML = items.map(function (item) {
      return '<article class="resource-card"><div class="resource-cover"><span class="cover-letter">' + item.initial + '</span></div><div class="resource-content"><span class="resource-kind">' + item.kind.toUpperCase() + '</span><h3>' + item.title + '</h3><p>' + escapeHtml(item.body) + '</p><span class="resource-link">' + item.link + ' <span>↗</span></span></div></article>';
    }).join('');
  }
  function renderRoadmap(profile) {
    var track = profile.major || profile.track || '나의 진로';
    document.getElementById('map-major').textContent = track + '\n진로 로드맵';
    document.getElementById('map-nodes').innerHTML = mapSteps.map(function (step, index) {
      return '<button type="button" class="map-node ' + step.cls + (index === 0 ? ' selected' : '') + '" data-map-step="' + index + '"><i></i><span class="node-phase">' + step.phase + '</span><strong>' + step.title + '</strong></button>';
    }).join('');
    document.getElementById('map-selected-title').textContent = mapSteps[0].title;
    document.getElementById('map-selected-desc').textContent = mapSteps[0].desc;
  }
  function renderReport(profile, result) {
    var date = new Date();
    var formattedDate = new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'long', day:'numeric' }).format(date);
    document.getElementById('report-date').textContent = formattedDate;
    document.getElementById('report-name').textContent = profile.name || '학생';
    document.getElementById('report-profile-meta').textContent = profile.grade + '학년 · ' + (profile.track || '계열 미입력') + ' · 교과 평균 ' + (result.average ? result.average.toFixed(1) : '—');
    document.getElementById('report-score').textContent = String(result.overall);
    document.getElementById('report-strengths').innerHTML = result.strengths.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
    document.getElementById('report-growth').innerHTML = result.growth.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('');
  }
  function loadSample() {
    state.profile = clone(demoProfile);
    state.analysis = analyze(state.profile);
    state.hasRun = true;
    populateForm(state.profile);
    renderAnalysis();
    showFormMessage('샘플 데이터가 준비됐어요. 내용을 바꾸고 다시 분석할 수 있어요.', false);
    showToast('샘플 프로필을 불러왔어요.');
  }
  async function handleAnalyze(event) {
    event.preventDefault();
    var profile = getProfileFromForm();
    var numbers = profile.grades.map(function (item) { return Number(item.grade); });
    if (!profile.record && !profile.grades.some(function (item) { return item.grade; })) {
      showFormMessage('세특 내용이나 성적을 하나 이상 입력해 주세요.', true);
      document.getElementById('student-record').focus();
      return;
    }
    if (numbers.some(function (n) { return !Number.isFinite(n) || n < 1 || n > 9; })) {
      showFormMessage('등급은 1~9 사이 숫자로 입력해 주세요.', true);
      return;
    }
    if (profile.grades.some(function (item) { return item.subject && !item.grade; })) {
      showFormMessage('과목을 입력한 행의 등급도 입력해 주세요.', true);
      return;
    }
    state.profile = profile;
    state.analysis = analyze(profile);
    state.hasRun = true;
    var button = document.getElementById('analyze-button');
    var previousButtonContent = button.innerHTML;
    var analysisMessage = '분석이 끝났어요. 결과는 이 기기에 저장됩니다.';
    button.disabled = true;
    button.textContent = state.apiConfigured ? 'Gemini 분석 중…' : '로컬 분석 중…';
    showFormMessage(state.apiConfigured ? '이름을 제외한 입력 내용을 Gemini에 보내고 있어요.' : '브라우저에서 입력 내용을 분석하고 있어요.', false);
    if (state.apiConfigured) {
      try {
        var feedback = await requestAiFeedback(profile);
        state.analysis.summary = feedback.summary;
        state.analysis.strengths = feedback.strengths.slice(0, 3);
        state.analysis.growth = feedback.growth.slice(0, 3);
        state.analysis.tip = feedback.tip;
        state.analysis.topics = feedback.topics.slice(0, 3);
        state.analysis.aiPowered = true;
      } catch (error) {
        analysisMessage = 'Gemini 연결에 실패해 기본 분석으로 결과를 만들었어요.';
      }
    }
    renderAnalysis();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ profile: state.profile, analysis: state.analysis })); } catch (error) { /* storage can be unavailable in private browsing */ }
    button.disabled = false;
    button.innerHTML = previousButtonContent;
    showFormMessage(analysisMessage, false);
    document.getElementById('audit').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function attachEvents() {
    document.getElementById('profile-form').addEventListener('submit', handleAnalyze);
    document.querySelectorAll('[data-sample]').forEach(function (button) { button.addEventListener('click', loadSample); });
    document.querySelectorAll('[data-print]').forEach(function (button) {
      button.addEventListener('click', function () { window.print(); });
    });
    document.getElementById('add-grade').addEventListener('click', function () {
      document.getElementById('grade-rows').appendChild(makeGradeRow({ subject:'', term:'1학년 1학기', grade:'' }));
    });
    document.getElementById('grade-rows').addEventListener('click', function (event) {
      var button = event.target.closest('.grade-remove');
      if (button) {
        var row = button.closest('tr');
        if (document.querySelectorAll('#grade-rows tr').length > 1) row.remove();
        else { row.querySelectorAll('input').forEach(function (input) { input.value = ''; }); }
      }
    });
    document.getElementById('student-record').addEventListener('input', function (event) {
      document.getElementById('record-count').textContent = String(event.target.value.length);
    });
    document.getElementById('map-nodes').addEventListener('click', function (event) {
      var button = event.target.closest('[data-map-step]');
      if (!button) return;
      var index = Number(button.getAttribute('data-map-step'));
      document.querySelectorAll('.map-node').forEach(function (node) { node.classList.toggle('selected', node === button); });
      document.getElementById('map-selected-title').textContent = mapSteps[index].title;
      document.getElementById('map-selected-desc').textContent = mapSteps[index].desc;
    });
    document.querySelectorAll('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        document.querySelectorAll('.nav-link').forEach(function (item) { item.classList.remove('active'); });
        link.classList.add('active');
      });
    });
  }
  function init() {
    var loaded = loadSavedState();
    if (!loaded) state.analysis = analyze(state.profile);
    populateForm(state.profile);
    renderAnalysis();
    attachEvents();
    updateApiStatus();
    document.getElementById('report-date').textContent = new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'long', day:'numeric' }).format(new Date());
    if (loaded) showFormMessage('저장된 프로필을 불러왔어요. 내용은 이 브라우저에만 남아 있어요.', false);
  }
  init();
}());
