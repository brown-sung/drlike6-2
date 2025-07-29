// utils.js
const jStat = require('jstat');
const lmsData = require('./lms-data.js');

function safeInv(percentile) {
    const p = Math.max(0.001, Math.min(99.999, percentile)) / 100;
    return jStat.normal.inv(p, 0, 1);
}

function getClosestLms(sex, age, type) {
    const ageNum = parseInt(age);
    if (!lmsData[sex] || !lmsData[sex][type]) return null;
    const availableAges = Object.keys(lmsData[sex][type]).map(Number);
    const closestAge = availableAges.reduce((prev, curr) => 
        (Math.abs(curr - ageNum) < Math.abs(prev - ageNum) ? curr : prev)
    );
    return lmsData[sex][type][String(closestAge)];
}

function getLmsValue(sex, age, type, percentile) {
    const lms = getClosestLms(sex, age, type);
    if (!lms) return null;
    const z = safeInv(percentile);
    return lms.L !== 0 ? lms.M * Math.pow((lms.L * lms.S * z + 1), 1 / lms.L) : lms.M * Math.exp(lms.S * z);
}

module.exports = { safeInv, getClosestLms, getLmsValue };