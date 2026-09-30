const WORKER_URL = 'https://semicon-guide-ai.natsuki3m.workers.dev';
const PRESET_TAGS = ["先進封裝", "矽光子", "檢測設備", "第三代半導體"];

let fullCsvData = [];
let analyzedVendors = [];
let visitCardsData = [];

// 註冊 Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.error);
}

// 載入 CSV 資料
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('./semicon參展廠商_已填技術領域.csv');
    const text = await res.text();
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        fullCsvData = results.data;
        console.log(`成功載入 ${fullCsvData.length} 筆參展廠商資料`);
      }
    });
  } catch (err) {
    alert('廠商資料載入失敗，請確認 CSV 檔案放置位置。');
  }
});

// UI 元件
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const step3 = document.getElementById('step3');
const stepIndicator = document.getElementById('stepIndicator');
const loadingModal = document.getElementById('loadingModal');
const loadingText = document.getElementById('loadingText');

const vendorInput = document.getElementById('vendorInput');
const customTopicInput = document.getElementById('customTopicInput');
const presetTagButtons = document.querySelectorAll('.preset-tag');
const btnSearch = document.getElementById('btnSearch');
const vendorList = document.getElementById('vendorList');
const vendorCount = document.getElementById('vendorCount');
const btnSelectAll = document.getElementById('btnSelectAll');
const btnDeselectAll = document.getElementById('btnDeselectAll');
const btnBackToStep1 = document.getElementById('btnBackToStep1');
const btnGenerateCards = document.getElementById('btnGenerateCards');
const btnExportPDF = document.getElementById('btnExportPDF');
const btnBackToStep2 = document.getElementById('btnBackToStep2');
const pdfContent = document.getElementById('pdfContent');

// 標籤點選聯動
presetTagButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const tag = btn.dataset.tag;
    customTopicInput.value = tag;
    presetTagButtons.forEach(b => b.classList.remove('bg-blue-600', 'text-white'));
    btn.classList.add('bg-blue-600', 'text-white');
  });
});

function showLoading(msg) {
  loadingText.innerText = msg;
  loadingModal.classList.remove('hidden');
}
function hideLoading() {
  loadingModal.classList.add('hidden');
}

// 步驟一：搜尋與篩選邏輯
btnSearch.addEventListener('click', async () => {
  const customTopic = customTopicInput.value.trim();
  const rawVendors = vendorInput.value.split(/[\n,，]+/).map(s => s.trim()).filter(Boolean);
  
  if (!customTopic && rawVendors.length === 0) {
    alert('請至少輸入感興趣的廠商，或選擇/輸入一項技術領域！');
    return;
  }

  showLoading('正在檢索與分析廠商中...');

  try {
    let targetVendors = [];

    // 1. 處理手動輸入的廠商名稱 (模糊比對 CSV)
    if (rawVendors.length > 0) {
      for (const name of rawVendors) {
        const found = fullCsvData.find(row => 
          (row['廠商名稱'] && row['廠商名稱'].toLowerCase().includes(name.toLowerCase()))
        );
        if (found) {
          targetVendors.push({ name: found['廠商名稱'], booth: found['攤位編號'] || '待定' });
        } else {
          targetVendors.push({ name: name, booth: '自選廠商' });
        }
      }
    }

    // 2. 判斷是「預設標籤」或「自訂領域」
    if (customTopic) {
      const isPreset = PRESET_TAGS.includes(customTopic);
      if (isPreset) {
        // 從 CSV 內建技術領域過濾
        const matched = fullCsvData.filter(row => 
          row['技術領域'] && row['技術領域'].includes(customTopic)
        );
        matched.forEach(m => {
          if (!targetVendors.some(v => v.name === m['廠商名稱'])) {
            targetVendors.push({ name: m['廠商名稱'], booth: m['攤位編號'] || '待定' });
          }
        });

        // 呼叫 Cloudflare Worker 補齊簡介、產品技術、推薦理由與評分
        const res = await fetch(`${WORKER_URL}/api/analyze-vendors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vendors: targetVendors.slice(0, 30), topic: customTopic })
        });
        analyzedVendors = await res.json();
      } else {
        // 自訂領域：交由 AI 語意配對
        const sampleCandidates = fullCsvData.map(r => ({ name: r['廠商名稱'], booth: r['攤位編號'] })).slice(0, 150);
        const res = await fetch(`${WORKER_URL}/api/match-custom`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userTopic: customTopic, candidates: sampleCandidates })
        });
        analyzedVendors = await res.json();
      }
    } else {
      // 僅輸入廠商名單，分析這幾家廠商
      const res = await fetch(`${WORKER_URL}/api/analyze-vendors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendors: targetVendors, topic: "綜合評估" })
      });
      analyzedVendors = await res.json();
    }

    // 依星級降序排列
    analyzedVendors.sort((a, b) => (b.stars || 0) - (a.stars || 0));

    renderStep2List();
    goToStep(2);
  } catch (err) {
    alert('分析失敗：' + err.message);
  } finally {
    hideLoading();
  }
});

// 渲染步驟二列表
function renderStep2List() {
  vendorList.innerHTML = '';
  vendorCount.innerText = analyzedVendors.length;

  analyzedVendors.forEach((v, idx) => {
    const card = document.createElement('div');
    card.className = "bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-start gap-3";
    
    // 星星 HTML
    const starsHtml = [1, 2, 3].map(i => 
      `<span class="${i <= (v.stars || 3) ? 'star-active' : 'star-inactive'}">★</span>`
    ).join('');

    card.innerHTML = `
      <input type="checkbox" id="vendor-chk-${idx}" data-idx="${idx}" checked class="vendor-checkbox mt-1.5 w-6 h-6 rounded text-blue-600 focus:ring-blue-500 cursor-pointer" />
      <div class="flex-1">
        <div class="flex items-center justify-between mb-1">
          <label for="vendor-chk-${idx}" class="font-bold text-lg text-slate-800 cursor-pointer">${v.name}</label>
          <span class="text-sm font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${v.booth || 'N/A'}</span>
        </div>
        <div class="text-sm mb-2 flex items-center gap-1">
          <span class="text-slate-500 font-medium">技術相關性：</span>
          <span class="text-lg leading-none">${starsHtml}</span>
        </div>
        <div class="text-sm text-slate-600 space-y-1">
          <p><span class="font-semibold text-slate-800">1. 公司介紹：</span>${v.intro || '暫無資料'}</p>
          <p><span class="font-semibold text-slate-800">2. 產品技術：</span>${v.tech || '暫無資料'}</p>
          <p><span class="font-semibold text-slate-800">3. 關注原因：</span>${v.reason || '暫無資料'}</p>
        </div>
      </div>
    `;
    vendorList.appendChild(card);
  });
}

// 全選 / 取消全選
btnSelectAll.addEventListener('click', () => {
  document.querySelectorAll('.vendor-checkbox').forEach(cb => cb.checked = true);
});
btnDeselectAll.addEventListener('click', () => {
  document.querySelectorAll('.vendor-checkbox').forEach(cb => cb.checked = false);
});

btnBackToStep1.addEventListener('click', () => goToStep(1));
btnBackToStep2.addEventListener('click', () => goToStep(2));

// 步驟二 -> 步驟三：產生 Visit Cards
btnGenerateCards.addEventListener('click', async () => {
  const checkedBoxes = document.querySelectorAll('.vendor-checkbox:checked');
  if (checkedBoxes.length === 0) {
    alert('請至少勾選一家欲拜訪的廠商！');
    return;
  }

  const selectedList = Array.from(checkedBoxes).map(cb => {
    const idx = parseInt(cb.dataset.idx);
    return analyzedVendors[idx];
  });

  showLoading('正在為已選廠商生成 Visit Cards...');
  try {
    const res = await fetch(`${WORKER_URL}/api/generate-cards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedVendors: selectedList })
    });
    visitCardsData = await res.json();

    // 關鍵需求：按照攤位表的字母排序（例如 A123, B456, Q6134...）
    visitCardsData.sort((a, b) => {
      const boothA = (a.booth || "ZZZ").toUpperCase();
      const boothB = (b.booth || "ZZZ").toUpperCase();
      return boothA.localeCompare(boothB, undefined, { numeric: true, sensitivity: 'base' });
    });

    renderStep3Cards();
    goToStep(3);
  } catch (err) {
    alert('生成拜訪卡片失敗：' + err.message);
  } finally {
    hideLoading();
  }
});

// 渲染步驟三卡片
function renderStep3Cards() {
  pdfContent.innerHTML = '';
  visitCardsData.forEach(card => {
    const el = document.createElement('div');
    el.className = "bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3";
    el.innerHTML = `
      <div class="flex items-center justify-between border-b pb-2 border-slate-100">
        <h3 class="text-xl font-bold text-blue-900">${card.name}</h3>
        <span class="text-base font-bold bg-amber-100 text-amber-900 px-3 py-1 rounded-lg border border-amber-300">
          攤位：${card.booth || 'N/A'}
        </span>
      </div>
      <div class="text-base space-y-2 text-slate-700">
        <div>
          <span class="font-bold text-slate-900 block text-sm text-blue-700">1. 為什麼值得看：</span>
          <p class="mt-0.5 leading-relaxed">${card.why}</p>
        </div>
        <div>
          <span class="font-bold text-slate-900 block text-sm text-blue-700">2. 我應該看甚麼：</span>
          <p class="mt-0.5 leading-relaxed">${card.whatToSee}</p>
        </div>
        <div>
          <span class="font-bold text-slate-900 block text-sm text-blue-700">3. 我應該問甚麼：</span>
          <p class="mt-0.5 leading-relaxed whitespace-pre-line">${card.whatAsk || card.whatToAsk}</p>
        </div>
        <div>
          <span class="font-bold text-slate-900 block text-sm text-blue-700">4. 我應該帶走的資訊：</span>
          <p class="mt-0.5 leading-relaxed">${card.takeaways}</p>
        </div>
      </div>
    `;
    pdfContent.appendChild(el);
  });
}

// 一鍵輸出 PDF
btnExportPDF.addEventListener('click', () => {
  showLoading('正在產生 PDF，請稍候...');
  const element = document.getElementById('pdfContent');
  const opt = {
    margin: [10, 10, 10, 10],
    filename: `Semicon_Visit_Cards_${new Date().toISOString().slice(0,10)}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(opt).from(element).save().then(() => {
    hideLoading();
  }).catch(err => {
    hideLoading();
    alert('PDF 導出失敗：' + err.message);
  });
});

// 切換步驟
function goToStep(num) {
  step1.classList.add('hidden');
  step2.classList.add('hidden');
  step3.classList.add('hidden');

  if (num === 1) {
    step1.classList.remove('hidden');
    stepIndicator.innerText = "步驟 1 / 3";
  } else if (num === 2) {
    step2.classList.remove('hidden');
    stepIndicator.innerText = "步驟 2 / 3";
  } else if (num === 3) {
    step3.classList.remove('hidden');
    stepIndicator.innerText = "步驟 3 / 3";
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}