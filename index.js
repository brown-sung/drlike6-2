// index.js
const express = require('express');
const { Client } = require('@upstash/qstash');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jStat = require('jstat');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const lmsData = require('./lms-data.js');
const { getDecisionPrompt } = require('./prompts.js');
const { generateShortChartUrl } = require('./plot-generator.js');

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, QSTASH_TOKEN, VERCEL_URL } = process.env;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const qstash = new Client({ token: QSTASH_TOKEN });
const userSessions = {};

function calculatePercentile(value, lms) {
    if (!lms || value == null) return null;
    const { L, M, S } = lms;
    const zScore = L !== 0 ? (Math.pow(value / M, L) - 1) / (L * S) : Math.log(value / M) / S;
    const percentile = jStat.normal.cdf(zScore, 0, 1) * 100;
    return parseFloat(percentile.toFixed(1));
}

function getPeerAverage(sex, age, type) {
    const ageKey = String(age);
    const lms = lmsData[sex]?.[type]?.[ageKey];
    if (!lms) return null;
    return lms.M;
}

async function callGeminiForDecision(session, userInput) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = getDecisionPrompt(session, userInput);
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI가 유효하지 않은 형식의 답변을 보냈습니다.");
    return JSON.parse(match[0]);
}

const createTextResponse = (text) => ({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });

// --- ★★★ 최종 수정: 캐러셀 응답 형식으로 변경 ★★★ ---
const createFinalReportResponse = (lastEntry, peerAverages, urls) => {
    const items = [];

    if (lastEntry.height_cm && lastEntry.h_percentile) {
        items.push({
            title: `키 성장 분석: ${lastEntry.height_cm}cm (${lastEntry.h_percentile}백분위)`,
            description: `또래 평균 키: 약 ${peerAverages.height.toFixed(1)}cm`,
            thumbnail: { imageUrl: urls.heightUrl },
            buttons: [{ action: "message", label: "처음부터 다시하기", messageText: "다시" }]
        });
    }

    if (lastEntry.weight_kg && lastEntry.w_percentile) {
        items.push({
            title: `몸무게 성장 분석: ${lastEntry.weight_kg}kg (${lastEntry.w_percentile}백분위)`,
            description: `또래 평균 몸무게: 약 ${peerAverages.weight.toFixed(1)}kg`,
            thumbnail: { imageUrl: urls.weightUrl },
            buttons: [{ action: "message", label: "처음부터 다시하기", messageText: "다시" }]
        });
    }

    return { version: "2.0", template: { outputs: [{ carousel: { type: "basicCard", items } }] } };
};

app.post('/skill', async (req, res) => {
    try {
        const userId = req.body.userRequest.user.id;
        const jobPayload = { reqBody: req.body, session: userSessions[userId] || { history: [] } };
        await qstash.publishJSON({ url: `https://${VERCEL_URL}/api/process-job`, body: jobPayload });
        res.json({ version: "2.0", useCallback: true });
    } catch (e) {
        res.status(500).json(createTextResponse("요청 처리 중 서버 오류가 발생했습니다."));
    }
});

app.post('/api/process-job', async (req, res) => {
    const { reqBody, session } = req.body;
    const { userRequest: { user: { id: userId }, utterance, callbackUrl } } = reqBody;
    let finalResponse;

    try {
        const decision = await callGeminiForDecision(session, utterance);
        const { action, data } = decision;

        if (data?.sex && !session.sex) session.sex = data.sex;

        if (action === 'add_data' && data.age_month && (data.height_cm || data.weight_kg)) {
            const newEntry = { age_month: data.age_month, height_cm: data.height_cm, weight_kg: data.weight_kg };
            const ageKey = String(newEntry.age_month);
            if (session.sex && newEntry.height_cm && lmsData[session.sex]?.height?.[ageKey]) {
                 newEntry.h_percentile = calculatePercentile(newEntry.height_cm, lmsData[session.sex].height[ageKey]);
            }
            if (session.sex && newEntry.weight_kg && lmsData[session.sex]?.weight?.[ageKey]) {
                 newEntry.w_percentile = calculatePercentile(newEntry.weight_kg, lmsData[session.sex].weight[ageKey]);
            }
            session.history.push(newEntry);
            const responseText = session.history.length >= 2 ? "정보가 추가되었습니다. '분석'이라고 말씀해주세요." : "정보가 입력되었습니다. 과거 정보를 1개 더 입력해주세요.";
            finalResponse = createTextResponse(responseText);
        } else if (action === 'generate_report' && session.history?.length >= 2) {
            const lastEntry = session.history[session.history.length - 1];
            const peerAverages = {
                height: getPeerAverage(session.sex, lastEntry.age_month, 'height'),
                weight: getPeerAverage(session.sex, lastEntry.age_month, 'weight')
            };
            
            const urls = await generateShortChartUrl(session); 
            
            finalResponse = createFinalReportResponse(lastEntry, peerAverages, urls);
            
            delete userSessions[userId];
        } else if (action === 'reset') {
            delete userSessions[userId];
            finalResponse = createTextResponse("네, 처음부터 다시 시작하겠습니다.");
        } else {
            finalResponse = createTextResponse(session.sex ? "다음 정보를 알려주세요." : "안녕하세요! 아이의 성별, 나이, 키, 몸무게를 알려주세요.");
        }
        
        if (action !== 'generate_report' && action !== 'reset') userSessions[userId] = session;

    } catch (e) {
        console.error("[/api/process-job] 처리 중 오류 발생:", e);
        finalResponse = createTextResponse(`분석 중 오류가 발생했습니다: ${e.message}`);
    }

    try {
        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalResponse)
        });
    } catch (e) {
        console.error("카카오 콜백 전송 실패:", e);
    }
    
    res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ Final JS Growth Bot (Reference Design) is running!"));

module.exports = app;
