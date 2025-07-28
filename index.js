// index.js
const express = require('express');
const path = require('path');
const { Client } = require('@upstash/qstash');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const jStat = require('jstat');

const lmsData = require('./lms-data.js');
const { getDecisionPrompt } = require('./prompts.js');
const { generateGrowthPlot } = require('./plot-generator.js');

const app = express();
app.use(express.json());

const { GEMINI_API_KEY, QSTASH_TOKEN, VERCEL_URL } = process.env;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const qstash = new Client({ token: QSTASH_TOKEN });

const userSessions = {}; // 휘발성 세션

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
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    return JSON.parse(responseText);
}

const createTextResponse = (text) => ({ version: "2.0", template: { outputs: [{ simpleText: { text } }] } });
const createImageResponse = (imageUrl, summary) => ({
    version: "2.0",
    template: {
        outputs: [{
            basicCard: {
                title: "성장 발달 분석 결과",
                description: summary,
                thumbnail: { imageUrl },
                buttons: [{ action: "message", label: "처음부터 다시하기", messageText: "다시" }]
            }
        }]
    }
});

app.use('/static', express.static(path.join(__dirname, 'static')));
app.get('/static/:filename', (req, res) => {
    res.sendFile(path.join('/tmp', req.params.filename));
});

app.post('/skill', async (req, res) => {
    try {
        const userId = req.body.userRequest.user.id;
        const jobPayload = { reqBody: req.body, session: userSessions[userId] || { history: [] } };
        
        await qstash.publishJSON({
            url: `https://${VERCEL_URL}/api/process-job`,
            body: jobPayload,
        });

        res.json({ version: "2.0", useCallback: true });
    } catch (e) {
        console.error("Error in /skill:", e);
        res.status(500).json(createTextResponse("요청 처리 중 오류가 발생했습니다."));
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
            const newEntry = {
                age_month: data.age_month,
                height_cm: data.height_cm,
                weight_kg: data.weight_kg,
            };
            if (session.sex && newEntry.height_cm) newEntry.h_percentile = calculatePercentile(newEntry.height_cm, lmsData[session.sex].height[newEntry.age_month]);
            if (session.sex && newEntry.weight_kg) newEntry.w_percentile = calculatePercentile(newEntry.weight_kg, lmsData[session.sex].weight[newEntry.age_month]);
            session.history.push(newEntry);
            const responseText = session.history.length >= 2 ? "정보가 추가되었습니다. '분석'이라고 말씀해주세요." : "정보가 입력되었습니다. 과거 정보를 1개 더 입력해주세요.";
            finalResponse = createTextResponse(responseText);
        } else if (action === 'generate_report' && session.history?.length >= 2) {
            const imagePath = await generateGrowthPlot(userId, session);
            const imageUrl = `https://${VERCEL_URL}/static/${path.basename(imagePath)}`;
            const summary = `${session.history.length}개 기록으로 분석했어요. 12개월 후 예상 성장치도 표시됩니다.`;
            finalResponse = createImageResponse(imageUrl, summary);
            delete userSessions[userId]; // 세션 초기화
        } else if (action === 'reset') {
            delete userSessions[userId];
            finalResponse = createTextResponse("네, 처음부터 다시 시작하겠습니다.");
        } else {
            finalResponse = createTextResponse(session.sex ? "다음 정보를 알려주세요." : "안녕하세요! 아이의 성별, 나이, 키, 몸무게를 알려주세요.");
        }
        
        if (action !== 'generate_report' && action !== 'reset') userSessions[userId] = session;

    } catch (e) {
        console.error("Error in /api/process-job:", e);
        finalResponse = createTextResponse(`분석 중 오류가 발생했습니다: ${e.message}`);
    }

    await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalResponse)
    });
    
    res.status(200).send("OK");
});

app.get("/", (req, res) => res.send("✅ JS Growth Chart Bot is running!"));

module.exports = app;