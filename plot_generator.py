# plot_generator.py
import os
import matplotlib
matplotlib.use('Agg')  # Vercel과 같은 비-GUI 환경을 위한 필수 설정
import matplotlib.pyplot as plt
import numpy as np
from jstat import jstat
from lms_data import lms_data

def generate_growth_plot(user_id, session, vercel_url):
    """성장 기록과 예측치를 바탕으로 그래프를 생성하고 이미지 URL을 반환합니다."""
    
    sex = session['sex']
    history = sorted(session['history'], key=lambda x: x['age_month'])
    
    # 키/몸무게 각각의 평균 백분위 계산 (데이터가 있는 경우에만)
    h_percentiles = [d['h_percentile'] for d in history if d.get('h_percentile') is not None]
    w_percentiles = [d['w_percentile'] for d in history if d.get('w_percentile') is not None]
    avg_h_p = np.mean(h_percentiles) if h_percentiles else np.nan
    avg_w_p = np.mean(w_percentiles) if w_percentiles else np.nan
    
    last_entry = history[-1]
    
    # 12개월 후 예측
    pred_month = last_entry['age_month'] + 12
    pred_height, pred_weight = None, None
    
    # 키 예측
    lms_h = lms_data.get(sex, {}).get('height', {}).get(str(pred_month))
    if lms_h and not np.isnan(avg_h_p):
        z = jstat.normal.inv(avg_h_p / 100, 0, 1)
        pred_height = lms_h['M'] * ((lms_h['L'] * lms_h['S'] * z + 1) ** (1/lms_h['L'])) if lms_h['L'] != 0 else lms_h['M'] * np.exp(lms_h['S'] * z)

    # 몸무게 예측
    lms_w = lms_data.get(sex, {}).get('weight', {}).get(str(pred_month))
    if lms_w and not np.isnan(avg_w_p):
        z = jstat.normal.inv(avg_w_p / 100, 0, 1)
        pred_weight = lms_w['M'] * ((lms_w['L'] * lms_w['S'] * z + 1) ** (1/lms_w['L'])) if lms_w['L'] != 0 else lms_w['M'] * np.exp(lms_w['S'] * z)
        
    # --- 그래프 생성 시작 ---
    plt.style.use('dark_background')
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(8, 10), constrained_layout=True)
    plt.rc('font', family='NanumBarunGothic') # 시스템에 설치된 한글 폰트
    
    # 키(ax1)와 몸무게(ax2) 그래프 그리기
    axes = {'height': ax1, 'weight': ax2}
    colors = {'height': ('deeppink', 'hotpink'), 'weight': ('deepskyblue', 'lightskyblue')}
    labels = {'height': ('키(Height)', 'cm'), 'weight': ('몸무게(Weight)', 'kg')}

    for data_type, ax in axes.items():
        # 배경 성장 곡선
        for p in [3, 10, 50, 90, 97]:
            months, values = [], []
            for m_str, lms in lms_data[sex][data_type].items():
                z = jstat.normal.inv(p/100, 0, 1)
                val = lms['M'] * ((lms['L'] * lms['S'] * z + 1) ** (1/lms['L'])) if lms['L'] != 0 else lms['M'] * np.exp(lms['S'] * z)
                months.append(int(m_str)); values.append(val)
            ax.plot(sorted(months), [y for _, y in sorted(zip(months, values))], color='gray', lw=0.8)

        # 사용자 입력 데이터
        user_months = [d['age_month'] for d in history if d.get(f'{data_type}_cm' if data_type == 'height' else f'{data_type}_kg')]
        user_values = [d[f'{data_type}_cm' if data_type == 'height' else f'{data_type}_kg'] for d in history if d.get(f'{data_type}_cm' if data_type == 'height' else f'{data_type}_kg')]
        ax.plot(user_months, user_values, 'o-', color=colors[data_type][0], label='입력 데이터')
        
        # 예측 데이터
        pred_value = pred_height if data_type == 'height' else pred_weight
        if pred_value and user_values:
            ax.plot([last_entry['age_month'], pred_month], [user_values[-1], pred_value], 'o--', color=colors[data_type][1], label='12개월 후 예측')
            
        ax.set_title(labels[data_type][0] + ' 성장 곡선'); ax.set_ylabel(labels[data_type][1]); ax.legend()
    
    ax2.set_xlabel('개월수')

    # Vercel의 쓰기 가능한 임시 디렉토리 /tmp 에 저장
    filename = f'plot_{user_id}.png'
    filepath = os.path.join('/tmp', filename)
    plt.savefig(filepath, facecolor='#1E1E1E', bbox_inches='tight')
    plt.close(fig)
    
    image_url = f"https://{vercel_url}/static/{filename}"
    return image_url