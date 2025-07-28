# app.py (최종 수정본)

import os
import json
import httpx
import google.generativeai as genai
from flask import Flask, request, jsonify, send_from_directory
from qstash import Client as QStashClient
import numpy as np
import math # <-- scipy 대신 math 임포트

from prompts import get_decision_prompt
from plot_generator import generate_growth_plot
from lms_data import lms_data 

app = Flask(__name__)

GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
QSTASH_TOKEN = os.environ.get('QSTASH_TOKEN')
VERCEL_URL = os.environ.get('VERCEL_URL') 
if GEMINI_API_KEY: genai.configure(api_key=GEMINI_API_KEY)
if not QSTASH_TOKEN: raise ValueError("QSTASH_TOKEN 환경 변수가 설정되지 않았습니다.")
qstash_client = QStashClient(QSTASH_TOKEN)

user_sessions = {}

def calculate_percentile(value, lms):
    if not lms or value is None: return None
    L, M, S = lms['L'], lms['M'], lms['S']
    z_score = (((value / M) ** L) - 1) / (L * S) if L != 0 else np.log(value / M) / S
    percentile = (0.5 * (1 + math.erf(z_score / math.sqrt(2)))) * 100 # <-- scipy.stats.norm.cdf 대체
    return round(percentile, 1)

async def call_gemini_for_decision(session, user_input):
    model = genai.GenerativeModel('gemini-1.5-flash')
    prompt_text = get_decision_prompt(session, user_input)
    response = await model.generate_content_async(prompt_text, generation_config={"response_mime_type": "application/json"})
    return response.text

def create_text_response(text):
    return {"version": "2.0", "template": {"outputs": [{"simpleText": {"text": text}}]}}

def create_image_response(image_url, summary):
    return {"version": "2.0", "template": {"outputs": [{"basicCard": {"title": "성장 발달 분석 결과", "description": summary, "thumbnail": {"imageUrl": image_url}, "buttons": [{"action": "message", "label": "처음부터 다시하기", "messageText": "다시"}]}}]}}

@app.route('/static/<filename>')
def serve_static_from_tmp(filename):
    return send_from_directory('/tmp', filename)

@app.route('/skill', methods=['POST'])
def skill_waiter():
    req = request.json
    try:
        user_id = req['userRequest']['user']['id']
        job_payload = { "req_body": req, "session": user_sessions.get(user_id, {"history": []}) }
        qstash_client.publish_json({"url": f"https://{VERCEL_URL}/api/process-job", "body": job_payload})
        return jsonify({"version": "2.0", "useCallback": True})
    except Exception as e:
        return jsonify(create_text_response(f"요청 처리 중 오류가 발생했습니다: {e}"))

@app.route('/api/process-job', methods=['POST'])
async def process_job_chef():
    job = request.json
    req_body = job['req_body']
    session = job['session']
    user_id = req_body['userRequest']['user']['id']
    user_input = req_body['userRequest']['utterance']
    callback_url = req_body['userRequest']['callbackUrl']
    
    final_response = {}
    
    try:
        raw_decision = await call_gemini_for_decision(session, user_input)
        decision = json.loads(raw_decision)
        action, data = decision.get('action', 'unknown'), decision.get('data', {})

        if data.get('sex') and not session.get('sex'): session['sex'] = data['sex']
        
        if action == 'add_data' and 'age_month' in data and ('height_cm' in data or 'weight_kg' in data):
            new_entry = {k: data.get(k) for k in ['age_month', 'height_cm', 'weight_kg']}
            sex = session.get('sex')
            if sex and new_entry.get('height_cm'):
                lms = lms_data.get(sex, {}).get('height', {}).get(str(new_entry['age_month']))
                new_entry['h_percentile'] = calculate_percentile(new_entry['height_cm'], lms)
            if sex and new_entry.get('weight_kg'):
                lms = lms_data.get(sex, {}).get('weight', {}).get(str(new_entry['age_month']))
                new_entry['w_percentile'] = calculate_percentile(new_entry['weight_kg'], lms)
            session['history'].append(new_entry)
            responseText = ("정보가 추가되었습니다. 과거 정보를 더 입력하시거나, '분석'이라고 말씀해주세요." if len(session['history']) >= 2 
                            else "정보가 입력되었습니다. 정확한 분석을 위해 과거 정보 1개가 더 필요해요. (예: 12개월 75cm 9.8kg)")
            final_response = create_text_response(responseText)
        elif action == 'generate_report' and len(session.get('history', [])) >= 2:
            image_url = generate_growth_plot(user_id, session, VERCEL_URL)
            summary = f"{len(session['history'])}개의 성장 기록을 바탕으로 분석했어요.\n12개월 후의 예상 성장치도 점선으로 표시됩니다."
            final_response = create_image_response(image_url, summary)
            session = {"history": []}
        elif action == 'reset':
            session = {"history": []}
            final_response = create_text_response('네, 처음부터 다시 시작하겠습니다. 아이 정보를 알려주세요.')
        else:
            responseText = '안녕하세요! 아이의 성별, 나이, 키, 몸무게를 알려주세요.' if not session.get('sex') else "다음 정보를 알려주세요. (예: 12개월 75cm 9.8kg)"
            final_response = create_text_response(responseText)
            
        user_sessions[user_id] = session

    except Exception as e:
        final_response = create_text_response(f"분석 중 오류가 발생했습니다: {str(e)}")

    async with httpx.AsyncClient() as client:
        await client.post(callback_url, json=final_response, timeout=10)
    
    return "OK", 200

@app.route("/", methods=['GET'])
def health_check():
    return "✅ Lightweight Modular Growth Chart Bot is running!", 200
