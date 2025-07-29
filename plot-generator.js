// plot-generator.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');
// datalabels 플러그인을 QuickChart에서 사용하기 위해 등록합니다.
const QuickChart = require('quickchart-js');
const ChartDataLabels = require('chartjs-plugin-datalabels');

// 백분위수가 0 또는 100에 가까울 때 z-score가 무한대로 가는 것을 방지하는 안정성 함수
function safeInv(percentile) {
    const p = Math.max(0.001, Math.min(99.999, percentile)) / 100;
    return jStat.normal.inv(p, 0, 1);
}

// 특정 개월, 특정 백분위의 값을 계산하는 함수
function getLmsValue(sex, age, type, percentile) {
    const ageNum = parseInt(age);
    if (!lmsData[sex] || !lmsData[sex][type]) return null;
    const availableAges = Object.keys(lmsData[sex][type]).map(Number);
    const closestAge = availableAges.reduce((prev, curr) => 
        (Math.abs(curr - ageNum) < Math.abs(prev - ageNum) ? curr : prev)
    );
    const lms = lmsData[sex][type][String(closestAge)];
    if (!lms) return null;
    const z = safeInv(percentile);
    return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
}

async function generateShortChartUrl(session, predictions) {
    const { sex, history } = session;
    const { predHeight, predWeight } = predictions;

    const sortedHistory = [...history].sort((a, b) => a.age_month - b.age_month);
    const lastEntry = sortedHistory[sortedHistory.length - 1];

    const xMin = Math.max(0, sortedHistory[0].age_month - 3);
    const xMax = lastEntry.age_month + 15;

    const createChartConfig = (type) => {
        const valueKey = type === 'height' ? 'height_cm' : 'weight_kg';
        
        const yMinRaw = getLmsValue(sex, xMin, type, 3);
        const yMaxRaw = getLmsValue(sex, xMax, type, 97);
        const yMin = yMinRaw ? yMinRaw * 0.9 : 0;
        const yMax = yMaxRaw ? yMaxRaw * 1.1 : (type === 'height' ? 100 : 20);
        const stepSize = type === 'height' ? 10 : 2;
        
        const predValue = type === 'height' ? predHeight : predWeight;

        const PERCENTILE_COLORS = { 3: '#4A8AF2', 5: '#4A8AF2', 10: '#4A8AF2', 25: '#87CEEB', 50: '#87CEEB', 75: '#FFC107', 90: '#FFA000', 95: '#FFA000', 97: '#FFA000' };

        const percentileDatasets = [3, 5, 10, 25, 50, 75, 90, 95, 97].map(p => {
            const data = Object.entries(lmsData[sex][type])
                .filter(([month]) => parseInt(month) >= xMin && parseInt(month) <= xMax) // X축 범위 내 데이터만 사용
                .map(([month, lms]) => {
                    const z = safeInv(p);
                    const value = lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
                    return { x: parseInt(month), y: parseFloat(value.toFixed(2)) };
                });
            return { data, borderColor: PERCENTILE_COLORS[p], borderWidth: 1.5, pointRadius: 0, label: `${p}%` };
        });

        return {
            type: 'line',
            data: {
                datasets: [
                    ...percentileDatasets,
                    { data: sortedHistory.map(d => ({ x: d.age_month, y: d[valueKey] })).filter(d => d.y != null), borderColor: '#00C853', borderWidth: 2.5, label: '내 아이', pointBackgroundColor: '#00C853', pointRadius: 5, pointStyle: 'circle' },
                    predValue && lastEntry[valueKey] && { data: [{ x: lastEntry.age_month, y: lastEntry[valueKey] }, { x: xMax, y: predValue }], borderColor: '#00C853', borderDash: [5, 5], borderWidth: 2.5, label: '예측' },
                ].filter(Boolean)
            },
            options: {
                plugins: {
                    legend: { display: false },
                    datalabels: {
                        color: '#555', align: 'end', anchor: 'end', font: { size: 10 },
                        // --- ★★★ 최종 수정: 3, 50, 97 백분위 선에만 라벨 표시 ★★★ ---
                        formatter: (value, context) => {
                            const dataset = context.dataset;
                            const label = dataset.label;
                            if (['3%', '50%', '97%'].includes(label) && context.dataIndex === dataset.data.length - 1) {
                                return label.replace('%', '');
                            }
                            return null;
                        }
                    }
                },
                scales: {
                    x: { type: 'linear', min: xMin, max: xMax, title: { display: true, text: '개월수 (월)', color: '#333' }, ticks: { color: '#666' }, grid: { color: 'rgba(0, 0, 0, 0.1)' } },
                    y: { // Y축은 하나만 사용
                        type: 'linear',
                        min: parseFloat(yMin.toFixed(1)),
                        max: parseFloat(yMax.toFixed(1)),
                        title: { display: true, text: type === 'height' ? '키(cm)' : '몸무게(kg)', color: '#333' },
                        ticks: { color: '#666', stepSize: stepSize },
                        grid: { color: 'rgba(0, 0, 0, 0.1)' }
                    },
                }
            }
        };
    };

    const createChartPromise = async (type) => {
        const config = createChartConfig(type);
        
        const chart = new QuickChart();
        chart.setConfig(config)
             .setBackgroundColor('white')
             .setWidth(500)
             .setHeight(700)
             .setVersion('4');
        
        // datalabels 플러그인을 사용하기 위해 플러그인 등록
        chart.registerPlugin(ChartDataLabels);

        return chart.getShortUrl();
    };
    
    const promises = [];
    if (sortedHistory.some(d => d.height_cm != null)) promises.push(createChartPromise('height'));
    else promises.push(Promise.resolve(null));

    if (sortedHistory.some(d => d.weight_kg != null)) promises.push(createChartPromise('weight'));
    else promises.push(Promise.resolve(null));

    const [heightUrl, weightUrl] = await Promise.all(promises);
    return { heightUrl, weightUrl };
}

module.exports = { generateShortChartUrl };
