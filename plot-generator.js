// plot-generator.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');

function safeInv(percentile) {
    const p = Math.max(0.001, Math.min(99.999, percentile)) / 100;
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
        const z = safeInv(avgP);
        return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
    };

    const predHeight = getPrediction(avgHP, 'height');
    const predWeight = getPrediction(avgWP, 'weight');

    const createPercentileDataset = (type, p) => {
        const data = Object.entries(lmsData[sex][type])
            .filter(([month]) => {
                const m = parseInt(month);
                if (m <= 24) return m % 2 === 0;
                if (m <= 72) return m % 6 === 0;
                return m % 12 === 0;
            })
            .map(([month, lms]) => {
                const z = safeInv(p);
                const value = lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
                return { x: parseInt(month), y: parseFloat(value.toFixed(2)) };
            });
        return { data, borderColor: '#E0E0E0', borderWidth: 1.5, pointRadius: 0, label: `${p}%` };
    };
    
    // --- ★★★ 최종 수정: 흰색 배경 테마 및 백분위 라벨링 적용 ★★★ ---
    const chartConfig = {
        type: 'line',
        data: {
            datasets: [
                ...[3, 10, 25, 50, 75, 90, 97].map(p => ({ ...createPercentileDataset('height', p), yAxisID: 'yHeight' })),
                { data: sortedHistory.map(d => ({ x: d.age_month, y: d.height_cm })).filter(d => d.y != null), borderColor: '#FF6384', borderWidth: 2.5, yAxisID: 'yHeight', label: '키', pointBackgroundColor: '#FF6384', pointRadius: 4 },
                predHeight && lastEntry.height_cm && { data: [{ x: lastEntry.age_month, y: lastEntry.height_cm }, { x: predMonth, y: predHeight }], borderColor: '#FF9F40', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yHeight', label: '키 예측', pointBackgroundColor: '#FF9F40', pointRadius: 4 },
                ...[3, 10, 25, 50, 75, 90, 97].map(p => ({ ...createPercentileDataset('weight', p), hidden: true, yAxisID: 'yWeight' })),
                { data: sortedHistory.map(d => ({ x: d.age_month, y: d.weight_kg })).filter(d => d.y != null), borderColor: '#36A2EB', borderWidth: 2.5, yAxisID: 'yWeight', label: '몸무게', pointBackgroundColor: '#36A2EB', pointRadius: 4 },
                predWeight && lastEntry.weight_kg && { data: [{ x: lastEntry.age_month, y: lastEntry.weight_kg }, { x: predMonth, y: predWeight }], borderColor: '#99E2FF', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yWeight', label: '몸무게 예측', pointBackgroundColor: '#99E2FF', pointRadius: 4 },
            ].filter(Boolean)
        },
        options: {
            plugins: {
                title: { display: true, text: '소아 성장 발달 곡선', color: '#333', font: { size: 22, weight: 'bold' } },
                legend: { labels: { color: '#333', filter: (item) => !item.text.includes('%') } },
                // 백분위 라벨을 곡선 끝에 추가하는 플러그인 설정
                datalabels: {
                    color: '#888',
                    align: 'end',
                    anchor: 'end',
                    font: { size: 10 },
                    // 마지막 데이터 포인트에만, 그리고 백분위(%) 데이터셋에만 라벨을 표시
                    formatter: (value, context) => {
                        const dataset = context.dataset;
                        if (dataset.label.includes('%') && context.dataIndex === dataset.data.length - 1) {
                            return dataset.label;
                        }
                        return null; // 그 외에는 라벨 숨김
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: '개월수', color: '#333' },
                    ticks: { color: '#666' },
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                },
                yHeight: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: '키(cm)', color: '#333' },
                    ticks: { color: '#666' },
                    grid: { color: 'rgba(0, 0, 0, 0.1)' }
                },
                yWeight: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: '몸무게(kg)', color: '#333' },
                    ticks: { color: '#666' },
                    grid: { drawOnChartArea: false }
                }
            }
        }
    };

    const response = await fetch('https://quickchart.io/chart/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chart: chartConfig, backgroundColor: 'white', format: 'png', version: '4' }),
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
