// plot-generator.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');

// 백분위수가 0 또는 100에 가까울 때 z-score가 무한대로 가는 것을 방지하는 안정성 함수
function safeInv(percentile) {
    const p = Math.max(0.0001, Math.min(99.9999, percentile)) / 100;
    return jStat.normal.inv(p, 0, 1);
}

async function generateShortChartUrl(session) {
    const { sex, history } = session;
    if (!sex || !history || history.length === 0) {
        throw new Error("차트 생성을 위한 데이터(성별, 기록)가 부족합니다.");
    }
    const sortedHistory = [...history].sort((a, b) => a.age_month - b.age_month);

    const hPercentiles = sortedHistory.map(d => d.h_percentile).filter(p => p != null);
    const wPercentiles = sortedHistory.map(d => d.w_percentile).filter(p => p != null);
    const avgHP = hPercentiles.length > 0 ? hPercentiles.reduce((a, b) => a + b, 0) / hPercentiles.length : NaN;
    const avgWP = wPercentiles.length > 0 ? wPercentiles.reduce((a, b) => a + b, 0) / wPercentiles.length : NaN;

    const lastEntry = sortedHistory[sortedHistory.length - 1];
    const predMonth = lastEntry.age_month + 12;

    const getPrediction = (avgP, type) => {
        const lms = lmsData[sex]?.[type]?.[String(predMonth)];
        if (!lms || isNaN(avgP)) return null;
        const z = safeInv(avgP); // <-- 안전 함수 사용
        return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
    };

    const predHeight = getPrediction(avgHP, 'height');
    const predWeight = getPrediction(avgWP, 'weight');

    const createPercentileDataset = (type, p) => {
        const data = Object.entries(lmsData[sex][type])
            .filter(([month]) => { // 데이터 샘플링으로 URL 길이 최적화
                const m = parseInt(month);
                if (m <= 24) return m % 2 === 0;
                if (m <= 72) return m % 6 === 0;
                return m % 12 === 0;
            })
            .map(([month, lms]) => {
                const z = safeInv(p); // <-- 안전 함수 사용
                const value = lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
                return { x: parseInt(month), y: parseFloat(value.toFixed(2)) };
            });
        return { data, borderColor: 'rgba(255, 255, 255, 0.2)', borderWidth: 1, pointRadius: 0, label: `${p}%` };
    };
    
    // --- ★★★ Chart.js v4 공식 문서 기준 최종 검수 완료 ★★★ ---
    const chartConfig = {
        type: 'line',
        data: {
            datasets: [
                ...[3, 10, 50, 90, 97].map(p => ({ ...createPercentileDataset('height', p), yAxisID: 'yHeight' })),
                { data: sortedHistory.map(d => ({ x: d.age_month, y: d.height_cm })).filter(d => d.y != null), borderColor: 'deeppink', borderWidth: 2.5, yAxisID: 'yHeight', label: '키', pointBackgroundColor: 'deeppink', pointRadius: 3 },
                predHeight && lastEntry.height_cm && { data: [{ x: lastEntry.age_month, y: lastEntry.height_cm }, { x: predMonth, y: predHeight }], borderColor: 'hotpink', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yHeight', label: '키 예측' },
                ...[3, 10, 50, 90, 97].map(p => ({ ...createPercentileDataset('weight', p), hidden: true, yAxisID: 'yWeight' })),
                { data: sortedHistory.map(d => ({ x: d.age_month, y: d.weight_kg })).filter(d => d.y != null), borderColor: 'deepskyblue', borderWidth: 2.5, yAxisID: 'yWeight', label: '몸무게', pointBackgroundColor: 'deepskyblue', pointRadius: 3 },
                predWeight && lastEntry.weight_kg && { data: [{ x: lastEntry.age_month, y: lastEntry.weight_kg }, { x: predMonth, y: predWeight }], borderColor: 'lightskyblue', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yWeight', label: '몸무게 예측' },
            ].filter(Boolean)
        },
        options: {
            plugins: {
                title: { display: true, text: '소아 성장 발달 곡선', color: 'white', font: { size: 18 } },
                legend: { labels: { color: 'white', filter: (item) => !item.text.includes('%') } }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: '개월수', color: 'white' },
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                },
                yHeight: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: '키(cm)', color: 'white' },
                    ticks: { color: 'white' },
                    grid: { color: 'rgba(255, 255, 255, 0.2)' }
                },
                yWeight: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: '몸무게(kg)', color: 'white' },
                    ticks: { color: 'white' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    };

    const response = await fetch('https://quickchart.io/chart/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart: chartConfig, backgroundColor: '#1E1E1E', format: 'png', version: '4' }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("QuickChart API Error:", errorText);
        throw new Error("차트 이미지 생성에 실패했습니다.");
    }

    const result = await response.json();
    return result.url;
}

module.exports = { generateShortChartUrl };
