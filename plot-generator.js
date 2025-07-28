// plot-generator.js
const fs = require('fs');
const path = require('path');
const { ChartJSNodeCanvas } = require('chart.js-node-canvas');
const jStat = require('jstat');
const lmsData = require('./lms-data');

const width = 800;
const height = 1000;

const chartCallback = (ChartJS) => {
    ChartJS.defaults.font.family = 'Arial'; // Vercel 기본 폰트 사용
    ChartJS.register({
        id: 'custom_canvas_background_color',
        beforeDraw: (chart) => {
            const ctx = chart.canvas.getContext('2d');
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#1E1E1E';
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        }
    });
};

const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });

async function generateGrowthPlot(userId, session) {
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
        return {
            type: 'line', data, borderColor: 'gray', borderWidth: 0.8, pointRadius: 0,
        };
    };

    const configuration = {
        type: 'line',
        data: {
            datasets: [
                // Background percentiles
                ...[3, 10, 50, 90, 97].flatMap(p => [createPercentileDataset('height', p), createPercentileDataset('weight', p)]),
                // User data
                { type: 'line', data: sortedHistory.map(d => ({ x: d.age_month, y: d.height_cm })), borderColor: 'deeppink', yAxisID: 'yHeight', label: '키' },
                { type: 'line', data: sortedHistory.map(d => ({ x: d.age_month, y: d.weight_kg })), borderColor: 'deepskyblue', yAxisID: 'yWeight', label: '몸무게' },
                // Prediction data
                predHeight && { data: [{x: lastEntry.age_month, y: lastEntry.height_cm}, {x: predMonth, y: predHeight}], borderColor: 'hotpink', borderDash: [5, 5], yAxisID: 'yHeight', label: '키 예측' },
                predWeight && { data: [{x: lastEntry.age_month, y: lastEntry.weight_kg}, {x: predMonth, y: lastEntry.weight_kg}, {x: predMonth, y: predWeight}], borderColor: 'lightskyblue', borderDash: [5, 5], yAxisID: 'yWeight', label: '몸무게 예측' },
            ].filter(Boolean) // Filter out null prediction datasets
        },
        options: {
            scales: {
                x: { title: { display: true, text: '개월수', color: 'white' }, ticks: { color: 'white' }, grid: { color: 'rgba(255, 255, 255, 0.2)' } },
                yHeight: { type: 'linear', position: 'left', title: { display: true, text: '키(cm)', color: 'white' }, ticks: { color: 'white' }, grid: { color: 'rgba(255, 255, 255, 0.2)' } },
                yWeight: { type: 'linear', position: 'right', title: { display: true, text: '몸무게(kg)', color: 'white' }, ticks: { color: 'white' }, grid: { drawOnChartArea: false } },
            },
            plugins: { legend: { labels: { color: 'white' } } }
        }
    };
    
    // 이중 축 그래프를 그리기 위해 두 개의 차트를 하나로 합치는 대신, 한 차트에서 Y축을 분리합니다.
    // 위 configuration에서 yAxisID를 사용하여 이를 구현했습니다.

    const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    const filename = `plot_${userId}.png`;
    const filepath = path.join('/tmp', filename);
    fs.writeFileSync(filepath, buffer);
    return filepath;
}

module.exports = { generateGrowthPlot };