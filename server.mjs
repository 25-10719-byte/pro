import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_BODY_BYTES = 80_000;
const MAX_RECORD_LENGTH = 13_000;
const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

async function loadLocalEnv() {
  try {
    await access(join(ROOT, '.env'), constants.R_OK);
    const contents = await readFile(join(ROOT, '.env'), 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!match || match[1].startsWith('#') || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch {
    // .env is optional; process environment variables still work.
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  response.end(JSON.stringify(data));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('요청 내용이 너무 큽니다.'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('요청 형식이 올바르지 않습니다.'), { status: 400 });
  }
}

function cleanString(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeProfile(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('학생 정보를 확인해 주세요.'), { status: 400 });
  const grades = Array.isArray(input.grades) ? input.grades.slice(0, 30).map((item) => ({
    subject: cleanString(item?.subject, 24),
    term: cleanString(item?.term, 30),
    grade: cleanString(String(item?.grade ?? ''), 4)
  })).filter((item) => item.subject || item.grade) : [];
  if (grades.some((item) => {
    const value = Number(item.grade);
    return !item.subject || !Number.isInteger(value) || value < 1 || value > 5;
  })) throw Object.assign(new Error('과목 등급은 1~5 사이 정수로 입력해 주세요.'), { status: 400 });
  const record = cleanString(input.record, MAX_RECORD_LENGTH);
  if (!record && !grades.length) throw Object.assign(new Error('세특 또는 성적을 입력해 주세요.'), { status: 400 });
  return {
    grade: cleanString(input.grade, 1),
    track: cleanString(input.track, 30),
    major: cleanString(input.major, 50),
    interest: cleanString(input.interest, 140),
    record,
    grades
  };
}

const feedbackSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    gradeInsight: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    growth: { type: 'array', items: { type: 'string' } },
    tip: { type: 'string' },
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          tag: { type: 'string' }
        },
        required: ['title', 'body', 'tag']
      }
    }
  },
  required: ['summary', 'gradeInsight', 'strengths', 'growth', 'tip', 'topics']
};

const universitySchema = {
  type: 'object',
  properties: {
    note: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          university: { type: 'string' },
          major: { type: 'string' },
          category: { type: 'string', enum: ['도전 검토', '적정 검토', '지원 폭 탐색'] },
          reason: { type: 'string' }
        },
        required: ['university', 'major', 'category', 'reason']
      }
    }
  },
  required: ['note', 'recommendations']
};

function safeFeedback(value) {
  if (!value || typeof value !== 'object') throw new Error('AI 응답 형식이 올바르지 않습니다.');
  const textList = (items, maxItems) => Array.isArray(items)
    ? items.filter((item) => typeof item === 'string').slice(0, maxItems).map((item) => item.trim().slice(0, 260)).filter(Boolean)
    : [];
  const topics = Array.isArray(value.topics) ? value.topics.slice(0, 3).map((item) => ({
    title: cleanString(item?.title, 120),
    body: cleanString(item?.body, 260),
    tag: cleanString(item?.tag, 40)
  })).filter((item) => item.title && item.body) : [];
  const feedback = {
    summary: cleanString(value.summary, 260),
    gradeInsight: cleanString(value.gradeInsight, 360),
    strengths: textList(value.strengths, 3),
    growth: textList(value.growth, 3),
    tip: cleanString(value.tip, 260),
    topics
  };
  if (!feedback.summary || !feedback.gradeInsight || !feedback.strengths.length || !feedback.growth.length || !feedback.tip || !feedback.topics.length) {
    throw new Error('AI 응답에 필요한 항목이 빠져 있습니다.');
  }
  return feedback;
}

function safeUniversityRecommendations(value) {
  if (!value || typeof value !== 'object') throw new Error('대학 추천 응답 형식이 올바르지 않습니다.');
  const allowedCategories = ['도전 검토', '적정 검토', '지원 폭 탐색'];
  const recommendations = Array.isArray(value.recommendations) ? value.recommendations.slice(0, 3).map((item, index) => ({
    university: cleanString(item?.university, 80),
    major: cleanString(item?.major, 80),
    category: allowedCategories.includes(item?.category) ? item.category : allowedCategories[index],
    reason: cleanString(item?.reason, 300)
  })).filter((item) => item.university && item.major && item.reason) : [];
  if (recommendations.length !== 3) throw new Error('대학 추천 응답에 필요한 항목이 빠져 있습니다.');
  return {
    note: cleanString(value.note, 360) || '세특과 5등급제 성적을 함께 고려한 탐색용 제안입니다.',
    recommendations
  };
}

function normalizeRecommendationInput(input) {
  if (!input || typeof input !== 'object') throw Object.assign(new Error('대학 추천 입력을 확인해 주세요.'), { status: 400 });
  const rawProfile = input.profile && typeof input.profile === 'object' ? input.profile : {};
  const grades = Array.isArray(rawProfile.grades) ? rawProfile.grades.slice(0, 30).map((item) => ({
    subject: cleanString(item?.subject, 24),
    term: cleanString(item?.term, 30),
    grade: cleanString(String(item?.grade ?? ''), 4)
  })).filter((item) => item.subject || item.grade) : [];
  if (grades.some((item) => {
    const value = Number(item.grade);
    return !item.subject || !Number.isInteger(value) || value < 1 || value > 5;
  })) throw Object.assign(new Error('과목 등급은 1~5 사이 정수로 입력해 주세요.'), { status: 400 });
  const analysis = input.analysis && typeof input.analysis === 'object' ? input.analysis : {};
  const strengths = Array.isArray(analysis.strengths) ? analysis.strengths.filter((item) => typeof item === 'string').slice(0, 3).map((item) => cleanString(item, 260)) : [];
  const growth = Array.isArray(analysis.growth) ? analysis.growth.filter((item) => typeof item === 'string').slice(0, 3).map((item) => cleanString(item, 260)) : [];
  const summary = cleanString(analysis.summary, 360);
  const gradeInsight = cleanString(analysis.gradeInsight, 360);
  if (!summary || !gradeInsight) throw Object.assign(new Error('먼저 세특과 성적 분석을 완료해 주세요.'), { status: 400 });
  return {
    profile: {
      grade: cleanString(rawProfile.grade, 1),
      track: cleanString(rawProfile.track, 30),
      major: cleanString(rawProfile.major, 50),
      interest: cleanString(rawProfile.interest, 140),
      grades
    },
    analysis: { summary, gradeInsight, strengths, growth }
  };
}

async function requestGemini(profile) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Gemini API 키가 설정되지 않았습니다.'), { status: 503 });
  const model = /^[a-zA-Z0-9._-]+$/.test(process.env.GEMINI_MODEL || '') ? process.env.GEMINI_MODEL : DEFAULT_MODEL;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const prompt = [
    '당신은 한국 고등학생의 학습 성찰과 진로 탐색을 돕는 코치입니다.',
    '입력된 세특과 과목별 1~5등급 성적을 함께 읽으세요. 활동에서 드러난 교과 역량과 성적이 어떻게 연결되는지 근거를 들어 설명하고, 성적만으로 능력이나 잠재력을 단정하지 마세요.',
    '등급은 1등급이 가장 높고 5등급이 가장 낮은 5등급제입니다. 성적 자료와 생기부에 실제로 나타난 근거, 아직 확인할 수 없는 점을 구분하세요.',
    '합격 가능성, 대학 서열, 성격이나 능력에 대한 단정은 하지 마세요. 부족한 점은 비난하지 말고 실행 가능한 다음 행동으로 제안하세요.',
    '세특 문장을 학생 대신 새로 써주거나 하지 않은 활동을 만들어내지 마세요. 탐구 주제는 학생의 관심과 과목에 연결하고, 학교에서 할 수 있는 범위로 제안하세요.',
    '한국어로 짧고 구체적으로 답하세요. gradeInsight는 과목 등급과 세특 활동의 연결 또는 추가로 확인할 점을 설명하세요. strengths와 growth는 각각 2~3개, topics는 3개를 작성하세요.',
    '학생 입력 자료:', JSON.stringify(profile)
  ].join('\n');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseFormat: { text: { mimeType: 'application/json', schema: feedbackSchema } },
        maxOutputTokens: 1800
      }
    }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw Object.assign(new Error('Gemini API 요청에 실패했습니다.'), { status: 502 });
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw Object.assign(new Error('Gemini가 분석 내용을 반환하지 않았습니다.'), { status: 502 });
  try {
    return safeFeedback(JSON.parse(text));
  } catch (error) {
    throw Object.assign(new Error(error.message || 'Gemini 응답을 읽지 못했습니다.'), { status: 502 });
  }
}

async function requestGeminiRecommendations(input) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Gemini API 키가 설정되지 않았습니다.'), { status: 503 });
  const model = /^[a-zA-Z0-9._-]+$/.test(process.env.GEMINI_MODEL || '') ? process.env.GEMINI_MODEL : DEFAULT_MODEL;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const prompt = [
    '당신은 한국 고등학생의 진로 및 대학 탐색을 돕는 코치입니다.',
    '이 요청은 앞 단계에서 생기부와 5등급제 성적을 먼저 분석한 뒤 이어지는 대학 탐색 단계입니다. 전달된 분석 요약, 강점, 성장 과제, 과목 등급을 근거로 국내 4년제 대학과 관련 학과 예시를 3개 제안하세요.',
    '1등급이 가장 높고 5등급이 가장 낮은 5등급제입니다. 성적 평균만으로 추천하지 말고 생기부의 활동과 희망 계열·학과를 함께 고려하세요.',
    'category는 도전 검토, 적정 검토, 지원 폭 탐색 중 하나로 나누세요. 실제 존재하는 대학을 제안하고, 대학이나 학과가 불확실하면 학교 이름을 추측해 만들지 말고 해당 범주의 대학 유형을 적으세요.',
    '최신 모집요강이나 입결 데이터는 제공되지 않았습니다. 합격 가능성·확률·컷 점수·학교 서열을 주장하지 말고, 결과를 지원 전략이 아닌 탐색 후보로 설명하세요. 공식 모집요강과 대학별 전형 정보를 별도로 확인해야 한다고 note에 짧게 적으세요.',
    '각 reason은 입력된 생기부 분석과 성적에서 확인되는 근거를 연결해 한국어로 짧게 작성하세요.',
    '학생 정보와 1차 분석 결과:', JSON.stringify(input)
  ].join('\n');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseFormat: { text: { mimeType: 'application/json', schema: universitySchema } },
        maxOutputTokens: 1200
      }
    }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw Object.assign(new Error('Gemini 대학 추천 요청에 실패했습니다.'), { status: 502 });
  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
  if (!text) throw Object.assign(new Error('Gemini가 대학 추천을 반환하지 않았습니다.'), { status: 502 });
  try {
    return safeUniversityRecommendations(JSON.parse(text));
  } catch (error) {
    throw Object.assign(new Error(error.message || 'Gemini 대학 추천 응답을 읽지 못했습니다.'), { status: 502 });
  }
}

function applyHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
}

await loadLocalEnv();
const PORT = Number(process.env.PORT || 4173);
const server = createServer(async (request, response) => {
  applyHeaders(response);
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/status' && request.method === 'GET') {
    return sendJson(response, 200, { geminiConfigured: Boolean(process.env.GEMINI_API_KEY), model: process.env.GEMINI_MODEL || DEFAULT_MODEL });
  }
  if (url.pathname === '/api/analyze') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST 요청을 사용해 주세요.' });
    try {
      const body = await readJsonBody(request);
      const profile = normalizeProfile(body.profile);
      const feedback = await requestGemini(profile);
      return sendJson(response, 200, { feedback });
    } catch (error) {
      return sendJson(response, error.status || 502, { error: error.message || 'AI 분석에 실패했습니다.' });
    }
  }
  if (url.pathname === '/api/recommend') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'POST 요청을 사용해 주세요.' });
    try {
      const body = await readJsonBody(request);
      const input = normalizeRecommendationInput(body);
      const recommendations = await requestGeminiRecommendations(input);
      return sendJson(response, 200, recommendations);
    } catch (error) {
      return sendJson(response, error.status || 502, { error: error.message || '대학 추천 분석에 실패했습니다.' });
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: '지원하지 않는 요청입니다.' });
  const staticFile = staticFiles.get(url.pathname);
  if (!staticFile) return sendJson(response, 404, { error: '페이지를 찾을 수 없습니다.' });
  try {
    const data = await readFile(join(ROOT, staticFile[0]));
    response.writeHead(200, { 'Content-Type': staticFile[1], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch {
    sendJson(response, 500, { error: '페이지를 읽지 못했습니다.' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('나침반 앱이 http://127.0.0.1:' + PORT + ' 에서 실행 중입니다.');
  console.log(process.env.GEMINI_API_KEY ? 'Gemini API 연결이 설정되어 있습니다.' : 'Gemini API 키가 없어 로컬 분석 모드로 실행됩니다.');
});
