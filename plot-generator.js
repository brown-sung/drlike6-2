// plot-generator.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');

function safeInv(percentile) {
    const p = Math.max(0.001, Math.min(99.999, percentile)) / 100;
    return jStat.normal.inv(p, 0, 1);
}

// 특정 개월 수에 가장 가까운 LMS 데이터를 찾는 헬퍼 함수
function getClosestLms(sex, age, type) {
    const ageNum = parseInt(age);
    const availableAges = Object.keys(lmsData[sex][type]).map(Number);
    const closestAge = availableAges.reduce((prev, curr) => 
        (Math.abs(curr - ageNum) < Math.abs(prev - ageNum) ? curr : prev)
    );
    return lmsData[sex][type][String(closestAge)];
}

// 특정 개월, 특정 백분위의 값을 계산하는 함수
function getLmsValue(sex, age, type, percentile) {
    const lms = getClosestLms(sex, age, type);
    if (!lms) return null;
    const z = safeInv(percentile);
    return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
}

async function generateChartUrls(session) {
    const { sex, history } = session;
    if (!sex || !history || history.length === 0) {
        throw new Error("차트 생성을 위한 데이터가 부족합니다.");
    }
    const sortedHistory = [...history].sort((a, b) => a.age_month - b.age_month);

    const xMin = Math.max(0, sortedHistory[0].age_month - 3);
    const xMax = sortedHistory[sortedHistory.length - 1].age_month + 15;

    const createChartConfig = (type) => {
        const valueKey = type === 'height' ? 'height_cm' : 'weight_kg';
        const percentileKey = type === 'height' ? 'h_percentile' : 'w_percentile';
        
        const yMin = getLmsValue(sex, xMin, type, 3) * 0.9;
        const yMax = getLmsValue(sex, xMax, type, 97) * 1.1;
        const stepSize = type === 'height' ? 10 : 1;
        
        const lastEntry = sortedHistory[sortedHistory.length - 1];
        const avgP = sortedHistory.map(d => d[percentileKey]).filter(p => p != null).reduce((a, b) => a + b, 0) / sortedHistory.length;
        
        const getPrediction = (p) => {
            const lms = getClosestLms(sex, xMax, type);
            if (!lms || isNaN(p)) return null;
            const z = safeInv(p);
            return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
        };
        const predValue = getPrediction(avgP);

        const PERCENTILE_COLORS = { 3: '#4A8AF2', 5: '#4A8AF2', 10: '#4A8AF2', 25: '#87CEEB', 50: '#87CEEB', 75: '#FFC107', 90: '#FFA000', 95: '#FFA000', 97: '#FFA000' };

        const percentileDatasets = [3, 5, 10, 25, 50, 75, 90, 95, 97].map(p => {
            const data = Object.entries(lmsData[sex][type]).map(([month, lms]) => {
                const z = safeInv(p);
                const value = lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
                return { x: parseInt(month), y: parseFloat(value.toFixed(2)) };
            });
            return { data, borderColor: PERCENTILE_COLORS[p], borderWidth: 1.5, pointRadius: 0, label: `${p}%`, yAxisID: 'yValue' };
        });

        return {
            type: 'line',
            data: {
                datasets: [
                    ...percentileDatasets,
                    { data: sortedHistory.map(d => ({ x: d.age_month, y: d[valueKey] })).filter(d => d.y != null), borderColor: '#00C853', borderWidth: 2.5, yAxisID: 'yValue', label: '내 아이', pointBackgroundColor: '#00C853', pointRadius: 5, pointStyle: 'circle' },
                    predValue && lastEntry[valueKey] && { data: [{ x: lastEntry.age_month, y: lastEntry[valueKey] }, { x: xMax, y: predValue }], borderColor: '#00C853', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yValue', label: '예측' },
                    { data: sortedHistory.map(d => ({ x: d.age_month, y: d[percentileKey] })).filter(d => d.y != null), borderColor: 'rgba(255, 99, 132, 0)', yAxisID: 'yPercentile', pointBackgroundColor: '#00C853', pointRadius: 5, pointStyle: 'circle', showLine: false },
                ].filter(Boolean)
            },
            options: {
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        color: '#555', align: 'end', anchor: 'end', font: { size: 10 },
                        formatter: (v, ctx) => ctx.dataset.label.includes('%') && ctx.dataIndex === ctx.dataset.data.length - 1 ? ctx.dataset.label.replace('%', '') : null
                    }
                },
                scales: {
                    x: { type: 'linear', min: xMin, max: xMax, title: { display: true, text: '개월수 (월)', color: '#333' }, ticks: { color: '#666' }, grid: { color: 'rgba(0, 0, 0, 0.1)' } },
                    yValue: { type: 'linear', position: 'left', min: parseFloat((yMin).toFixed(1)), max: parseFloat((yMax).toFixed(1)), title: { display: true, text: type === 'height' ? '키(cm)' : '몸무게(kg)', color: '#333' }, ticks: { color: '#666', stepSize: stepSize }, grid: { color: 'rgba(0, 0, 0, 0.1)' } },
                    yPercentile: { type: 'linear', position: 'right', min: 0, max: 100, title: { display: true, text: '백분위', color: '#333' }, ticks: { color: '#666', stepSize: 25 }, grid: { drawOnChartArea: false } }
                }
            }
        };
    };

    const createChartPromise = async (type) => {
        const config = createChartConfig(type);
        const response = await fetch('https://quickchart.io/chart/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chart: config, backgroundColor: 'white', format: 'png', version: '4' }),
        });
        if (!response.ok) throw new Error(`QuickChart API Error for ${type}`);
        return (await response.json()).url;
    };

    const [heightUrl, weightUrl] = await Promise.all([
        createChartPromise('height'),
        createChartPromise('weight')
    ]);

    return { heightUrl, weightUrl };
}

module.exports = { generateShortChartUrl: generateChartUrls }; // 이름 변경
