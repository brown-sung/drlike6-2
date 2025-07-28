// plot-generator.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');

function generateGrowthPlotUrl(session) {
    const { sex, history } = session;
    const sortedHistory = [...history].sort((a, b) => a.age_month - b.age_month);

    const hPercentiles = sortedHistory.map(d => d.h_percentile).filter(p => p != null);
    const wPercentiles = sortedHistory.map(d => d.w_percentile).filter(p => p != null);
    const avgHP = hPercentiles.length > 0 ? hPercentiles.reduce((a, b) => a + b, 0) / hPercentiles.length : NaN;
    const avgWP = wPercentiles.length > 0 ? wPercentiles.reduce((a, b) => a + b, 0) / wPercentiles.length : NaN;

    const lastEntry = sortedHistory[sortedHistory.length - 1];
    const predMonth = lastEntry.age_month + 12;

    const getPrediction = (avgP, type) => {
        const lms = lmsData[sex]?.[type]?.[predMonth];
        if (!lms || isNaN(avgP)) return null;
        const z = jStat.normal.inv(avgP / 100, 0, 1);
        return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
    };

    const predHeight = getPrediction(avgHP, 'height');
    const predWeight = getPrediction(avgWP, 'weight');

    const createPercentileDataset = (type, p) => {
        const data = Object.entries(lmsData[sex][type]).map(([month, lms]) => {
            const z = jStat.normal.inv(p / 100, 0, 1);
            const value = lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
            return { x: parseInt(month), y: value };
        });
        return { type: 'line', data, borderColor: 'gray', borderWidth: 1, pointRadius: 0, label: `${p}%` };
    };
    
    // --- ★★★ 최종 수정: Chart.js v3 형식으로 options 객체 재작성 ★★★ ---
    const chartConfig = {
        type: 'line',
        data: {
            datasets: [
                ...[3, 10, 50, 90, 97].map(p => ({ ...createPercentileDataset('height', p), yAxisID: 'yHeight' })),
                { type: 'line', data: sortedHistory.map(d => ({ x: d.age_month, y: d.height_cm })), borderColor: 'deeppink', borderWidth: 2, yAxisID: 'yHeight', label: '키' },
                predHeight && { data: [{x: lastEntry.age_month, y: lastEntry.height_cm}, {x: predMonth, y: predHeight}], borderColor: 'hotpink', borderDash: [5, 5], borderWidth: 2, yAxisID: 'yHeight', label: '키 예측' },
                ...[3, 10, 50, 90, 97].map(p => ({ ...createPercentileDataset('weight', p), hidden: true })),
                { type: 'line', data: sortedHistory.map(d => ({ x: d.age_month, y: d.weight_kg })), borderColor: 'deepskyblue', borderWidth: 2, yAxisID: 'yWeight', label: '몸무게' },
                predWeight && { data: [{x: lastEntry.age_month, y: lastEntry.weight_kg}, {x: predMonth, y: predWeight}], borderColor: 'lightskyblue', borderDash: [5, 5], borderWidth: 2, yAxisID: 'yWeight', label: '몸무게 예측' },
            ].filter(Boolean)
        },
        options: {
            plugins: {
                title: { display: true, text: '소아 성장 발달 곡선', color: 'white', font: { size: 18 } },
                legend: { labels: { color: 'white' } }
            },
            scales: {
                x: {
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
                },
            }
        }
    };
    // -------------------------------------------------------------------

    const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?bkg=%231E1E1E&c=${encodedConfig}`;
}

module.exports = { generateGrowthPlotUrl };
