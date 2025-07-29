// plot-generator.js
const lmsData = require('./lms-data.js');
const { safeInv, getLmsValue } = require('./utils.js');

async function generateShortChartUrl(session, predictions) {
    const { sex, history } = session;
    const { predHeight, predWeight } = predictions;

    const sortedHistory = [...history].sort((a, b) => a.age_month - b.age_month);
    const lastEntry = sortedHistory[sortedHistory.length - 1];

    const xMin = Math.max(0, sortedHistory[0].age_month - 3);
    const xMax = lastEntry.age_month + 15;

    const createChartConfig = (type) => {
        const valueKey = type === 'height' ? 'height_cm' : 'weight_kg';
        const percentileKey = type === 'height' ? 'h_percentile' : 'w_percentile';
        
        const yMinRaw = getLmsValue(sex, xMin, type, 3);
        const yMaxRaw = getLmsValue(sex, xMax, type, 97);
        
        // --- ★★★ 최종 수정: 변수명 오타 수정 ★★★ ---
        const yMin = yMinRaw ? yMinRaw * 0.9 : 0;
        const yMax = yMaxRaw ? yMaxRaw * 1.1 : (type === 'height' ? 100 : 20);
        // ------------------------------------------

        const stepSize = type === 'height' ? 10 : 1;
        const predValue = type === 'height' ? predHeight : predWeight;

        const PERCENTILE_COLORS = { 3: '#4A8AF2', 5: '#4A8AF2', 10: '#4A8AF2', 25: '#87CEEB', 50: '#87CEEB', 75: '#FFC107', 90: '#FFA000', 95: '#FFA000', 97: '#FFA000' };

        const percentileDatasets = [3, 5, 10, 25, 50, 75, 90, 95, 97].map(p => {
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
            return { data, borderColor: PERCENTILE_COLORS[p], borderWidth: 1.5, pointRadius: 0, label: `${p}%` };
        });

        return {
            type: 'line',
            data: {
                datasets: [
                    ...percentileDatasets.map(d => ({ ...d, yAxisID: 'yValue' })),
                    { data: sortedHistory.map(d => ({ x: d.age_month, y: d[valueKey] })).filter(d => d.y != null), borderColor: '#00C853', borderWidth: 2.5, yAxisID: 'yValue', label: '내 아이', pointBackgroundColor: '#00C853', pointRadius: 5, pointStyle: 'circle' },
                    predValue && lastEntry[valueKey] && { data: [{ x: lastEntry.age_month, y: lastEntry[valueKey] }, { x: xMax, y: predValue }], borderColor: '#00C853', borderDash: [5, 5], borderWidth: 2.5, yAxisID: 'yValue', label: '예측' },
                    { data: sortedHistory.map(d => ({ x: d.age_month, y: d[percentileKey] })).filter(d => d.y != null), borderColor: 'rgba(0,0,0,0)', yAxisID: 'yPercentile', pointBackgroundColor: '#00C853', pointRadius: 5, pointStyle: 'circle', showLine: false },
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
                    yValue: {
                        type: 'linear',
                        position: 'left',
                        min: parseFloat(yMin.toFixed(1)), // <-- 변수명 오타 수정
                        max: parseFloat(yMax.toFixed(1)), // <-- 변수명 오타 수정
                        title: { display: true, text: type === 'height' ? '키(cm)' : '몸무게(kg)', color: '#333' },
                        ticks: { color: '#666', stepSize: stepSize },
                        grid: { color: 'rgba(0, 0, 0, 0.1)' }
                    },
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
            body: JSON.stringify({ chart: config, backgroundColor: 'white', width: 500, height: 700, format: 'png', version: '4' }),
        });
        if (!response.ok) throw new Error(`QuickChart API Error for ${type}`);
        return (await response.json()).url;
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