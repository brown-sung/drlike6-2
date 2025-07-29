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

if (!GEMINI_API_KEY || !QSTASH_TOKEN || !VERCEL_URL) {
    console.error("CRITICAL: 환경 변수가 누락되었습니다!");
}

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

async function callGeminiForDecision(session, userInput) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = getDecisionPrompt(session, userInput);
    console.log("Gemini API 호출 시작...");
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    console.log("Gemini API 응답 수신 (Raw):", responseText);
    const match = responseText.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI가 유효하지 않은 형식의 답변을 보냈습니다.");
    const cleanedJsonString = match[0];
    console.log("정리된 JSON 문자열:", cleanedJsonString);
    return JSON.parse(cleanedJsonString);
}

const createTextResponse = (text) => ({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
const createFinalReportResponse = (urls, predictions) => {
    const items = [];
    if (urls.heightUrl) {
        let description = "예측 데이터가 부족합니다.";
        if (predictions.predHeight && !isNaN(predictions.avgHP)) {
            description = `${predictions.predHeight.toFixed(1)}cm (평균 ${predictions.avgHP.toFixed(1)}백분위 유지 시)`;
        }
        items.push({
            title: "키 성장 분석 (12개월 후 예상)",
            description: description,
            thumbnail: { imageUrl: urls.heightUrl },
            buttons: [{ action: "message", label: "처음부터 다시하기", messageText: "다시" }]
        });
    }
    if (urls.weightUrl) {
        let description = "예측 데이터가 부족합니다.";
         if (predictions.predWeight && !isNaN(predictions.avgWP)) {
            description = `${predictions.predWeight.toFixed(1)}kg (평균 ${predictions.avgWP.toFixed(1)}백분위 유지 시)`;
        }
        items.push({
            title: "몸무게 성장 분석 (12개월 후 예상)",
            description: description,
            thumbnail: { imageUrl: urls.weightUrl },
            buttons: [{ action: "message", label: "처음부터 다시하기", messageText: "다시" }]
        });
    }
    return { version: "2.0", template: { outputs: [{ carousel: { type: "basicCard", items } }] } };
};

app.post('/skill', async (req, res) => {
    try {
        console.log("[/skill] 요청 수신");
        const userId = req.body.userRequest.user.id;
        const jobPayload = { reqBody: req.body, session: userSessions[userId] || { history: [] } };
        await qstash.publishJSON({ url: `https://${VERCEL_URL}/api/process-job`, body: jobPayload });
        console.log("[/skill] QStash 작업 게시 완료");
        res.json({ version: "2.0", useCallback: true });
    } catch (e) {
        console.error("[/skill] 오류 발생:", e);
        res.status(500).json(createTextResponse("요청 처리 중 서버 오류가 발생했습니다."));
    }
});

app.post('/api/process-job', async (req, res) => {
    console.log("[/api/process-job] QStash로부터 작업 수신");
    const { reqBody, session } = req.body;
    const { userRequest: { user: { id: userId }, utterance, callbackUrl } } = reqBody;
    let finalResponse;

    try {
        const decision = await callGeminiForDecision(session, utterance);
        const { action, data } = decision;
        console.log(`[Action: ${action}]`, "Data:", data);

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
            console.log("예측값 및 그래프 생성 시작...");
            const sortedHistory = [...session.history].sort((a, b) => a.age_month - b.age_month);
            const lastEntry = sortedHistory[sortedHistory.length - 1];
            const predMonth = lastEntry.age_month + 12;

            const hPercentiles = sortedHistory.map(d => d.h_percentile).filter(p => p != null);
            const wPercentiles = sortedHistory.map(d => d.w_percentile).filter(p => p != null);
            const avgHP = hPercentiles.length > 0 ? hPercentiles.reduce((a, b) => a + b, 0) / hPercentiles.length : NaN;
            const avgWP = wPercentiles.length > 0 ? wPercentiles.reduce((a, b) => a + b, 0) / wPercentiles.length : NaN;
            
            const getPrediction = (avgP, type) => {
                const lms = lmsData[session.sex]?.[type]?.[String(predMonth)];
                if (!lms || isNaN(avgP)) return null;
                const z = jStat.normal.inv(Math.max(0.001, Math.min(99.999, avgP)) / 100, 0, 1);
                return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
            };

            const predHeight = getPrediction(avgHP, 'height');
            const predWeight = getPrediction(avgWP, 'weight');
            
            const urls = await generateShortChartUrl(session, { predHeight, predWeight }); 
            console.log("그래프 URL 생성 완료:", urls);
            
            finalResponse = createFinalReportResponse(urls, { predHeight, predWeight, avgHP, avgWP });
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
        console.log("카카오 콜백 URL로 최종 응답 전송 시도...");
        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalResponse)
        });
        console.log("카카오 콜백 전송 성공");
    } catch (e) {
        console.error("카카오 콜백 전송 실패:", e);
    }
    
    res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ Final JS Growth Bot (Vertical, with Logging) is running!"));

module.exports = app;
