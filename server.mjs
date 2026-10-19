import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_BODY_BYTES = 80_000;
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
    return !item.subject || !Number.isFinite(value) || value < 1 || value > 9;
  })) throw Object.assign(new Error('과목 등급은 1~9 사이 숫자로 입력해 주세요.'), { status: 400 });
  const record = cleanString(input.record, 4000);
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
  required: ['summary', 'strengths', 'growth', 'tip', 'topics']
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
    strengths: textList(value.strengths, 3),
    growth: textList(value.growth, 3),
    tip: cleanString(value.tip, 260),
    topics
  };
  if (!feedback.summary || !feedback.strengths.length || !feedback.growth.length || !feedback.tip || !feedback.topics.length) {
    throw new Error('AI 응답에 필요한 항목이 빠져 있습니다.');
  }
  return feedback;
}

async function requestGemini(profile) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('Gemini API 키가 설정되지 않았습니다.'), { status: 503 });
  const model = /^[a-zA-Z0-9._-]+$/.test(process.env.GEMINI_MODEL || '') ? process.env.GEMINI_MODEL : DEFAULT_MODEL;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const prompt = [
    '당신은 한국 고등학생의 학습 성찰과 진로 탐색을 돕는 코치입니다.',
    '입력된 세특을 과장 없이 읽고, 기록에 실제로 나타난 근거와 아직 확인할 수 없는 점을 구분하세요.',
    '합격 가능성, 대학 서열, 성격이나 능력에 대한 단정은 하지 마세요. 부족한 점은 비난하지 말고 실행 가능한 다음 행동으로 제안하세요.',
    '세특 문장을 학생 대신 새로 써주거나 하지 않은 활동을 만들어내지 마세요. 탐구 주제는 학생의 관심과 과목에 연결하고, 학교에서 할 수 있는 범위로 제안하세요.',
    '한국어로 짧고 구체적으로 답하세요. strengths와 growth는 각각 2~3개, topics는 3개를 작성하세요.',
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
