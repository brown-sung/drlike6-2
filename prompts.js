// prompts.js
function getDecisionPrompt(session, userInput) {
    const history_count = session.history ? session.history.length : 0;

    let action_rules;
    if (history_count >= 2 && ["분석", "그만", "완료", "그래프", "결과", "리포트"].includes(userInput)) {
        action_rules = "- 'generate_report': If the user requests analysis (e.g., '분석', '그만', '완료').";
    } else {
        action_rules = `- "reset": If the user wants to start over ("다시", "초기화").
- "add_data": If valid child growth data is extracted.
- "ask_for_info": If essential information is still missing.`;
    }

    return `You are a data extractor for a child growth chatbot. Analyze the user's message, extract key information, and decide the next action based on strict rules.

**Current Session Data (Previous entries):**
${JSON.stringify(session, null, 2)}

**User's New Message:**
"${userInput}"

**Extraction Rules:**
- \`sex\`: "남자", "남아", "아들" -> "male"; "여자", "여아", "딸" -> "female".
- \`age_month\`: Convert years/terms to months. (e.g., "3살" -> 36; "두돌" -> 24).
- \`height_cm\`, \`weight_kg\`: If two numbers like "100 15", infer larger is height, smaller is weight.

**Action Decision Rules:**
${action_rules}

**Your Output MUST be a single, valid JSON object with "action" and "data" keys.**
Example (adding data): User: "우리 딸 24개월 85cm 11.5kg" -> Output: {"action": "add_data", "data": {"sex": "female", "age_month": 24, "height_cm": 85, "weight_kg": 11.5}}
Example (analysis): User: "분석해줘" -> Output: {"action": "generate_report", "data": {}}`;
}
module.exports = { getDecisionPrompt };