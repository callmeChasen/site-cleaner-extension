// 状态
let selectedTab = null;
let allTabs = [];

function getOrigin(url) {
    try {
        return new URL(url).origin;
    } catch (e) {
        return null;
    }
}

function isClearableUrl(url) {
    if (!url) return false;
    return url.startsWith('http://') || url.startsWith('https://');
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status ' + type;
    if (type === 'success') {
        setTimeout(() => { status.className = 'status'; }, 3000);
    }
}

function updateTargetDisplay() {
    // header 已移除，无需更新；保留函数以兼容调用点
}

function renderTabs() {
    const list = document.getElementById('tabList');
    const clearable = allTabs.filter(t => isClearableUrl(t.url));

    // 按 origin 去重
    const seen = new Map();
    clearable.forEach(t => {
        const origin = getOrigin(t.url);
        if (!seen.has(origin)) seen.set(origin, t);
    });
    const uniqueTabs = Array.from(seen.values());

    if (uniqueTabs.length === 0) {
        list.innerHTML = '<div class="empty">没有可清除的网页（仅支持 http/https）</div>';
        document.getElementById('clearBtn').disabled = true;
        return;
    }

    const selectedOrigin = selectedTab ? getOrigin(selectedTab.url) : null;
    const frag = document.createDocumentFragment();
    uniqueTabs.forEach(tab => {
        const origin = getOrigin(tab.url);
        const isSelected = selectedOrigin === origin;
        const item = document.createElement('div');
        item.className = 'tab-item' + (isSelected ? ' selected' : '');
        item.dataset.origin = origin;

        if (tab.favIconUrl) {
            const img = document.createElement('img');
            img.className = 'favicon';
            img.src = tab.favIconUrl;
            img.onerror = () => { img.style.visibility = 'hidden'; };
            item.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'favicon';
            item.appendChild(ph);
        }

        const info = document.createElement('div');
        info.className = 'info';
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = tab.title || origin;
        const originEl = document.createElement('div');
        originEl.className = 'origin';
        originEl.textContent = origin;
        info.appendChild(title);
        info.appendChild(originEl);
        item.appendChild(info);

        if (tab.active) {
            const badge = document.createElement('span');
            badge.className = 'badge-active';
            badge.textContent = '当前';
            item.appendChild(badge);
        }

        item.addEventListener('click', () => {
            if (selectedTab === tab) return;
            selectedTab = tab;
            updateTargetDisplay();
            // 仅切换 selected 类，避免整列表重建
            list.querySelectorAll('.tab-item.selected').forEach(el => el.classList.remove('selected'));
            item.classList.add('selected');
        });
        frag.appendChild(item);
    });
    list.innerHTML = '';
    list.appendChild(frag);
    document.getElementById('clearBtn').disabled = false;
}

async function loadTabs() {
    allTabs = await chrome.tabs.query({ currentWindow: true });
    const active = allTabs.find(t => t.active && isClearableUrl(t.url));
    if (active) {
        selectedTab = active;
    } else {
        selectedTab = allTabs.find(t => isClearableUrl(t.url)) || null;
    }
    updateTargetDisplay();
    renderTabs();
}

// 监听标签页切换 / 更新，自动跟随当前激活页（带 debounce 避免频繁重渲染）
let renderTimer = null;
function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(async () => {
        renderTimer = null;
        try {
            allTabs = await chrome.tabs.query({ currentWindow: true });
            renderTabs();
        } catch (e) { }
    }, 120);
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
    const tab = allTabs.find(t => t.id === tabId);
    if (tab && isClearableUrl(tab.url)) {
        selectedTab = tab;
        updateTargetDisplay();
    }
    scheduleRender();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl) {
        scheduleRender();
    }
});

// 清除按钮
document.getElementById('clearBtn').addEventListener('click', async () => {
    if (!selectedTab) {
        showStatus('请先选择一个网站', 'error');
        return;
    }
    const origin = getOrigin(selectedTab.url);
    if (!origin) {
        showStatus('无法识别该网站', 'error');
        return;
    }

    const originScoped = {
        cookies: document.getElementById('cookies').checked,
        localStorage: document.getElementById('localStorage').checked,
        indexedDB: document.getElementById('indexedDB').checked,
        serviceWorkers: document.getElementById('serviceWorkers').checked,
        cacheStorage: document.getElementById('cacheStorage').checked
    };
    const wantCache = document.getElementById('cache').checked;

    const btn = document.getElementById('clearBtn');
    btn.disabled = true;
    btn.textContent = '清除中...';

    const withTimeout = (p, ms) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error('操作超时')), ms))
    ]);

    try {
        if (Object.values(originScoped).some(v => v)) {
            await withTimeout(
                chrome.browsingData.remove({ origins: [origin] }, originScoped),
                8000
            );
        }
        if (wantCache) {
            await withTimeout(chrome.browsingData.removeCache({}), 8000);
        }

        if (document.getElementById('reload').checked) {
            // 立即触发刷新并关闭弹窗，避免感知卡顿
            chrome.tabs.reload(selectedTab.id, { bypassCache: true });
            window.close();
            return;
        }
        showStatus(wantCache ? '✓ 清除完成（HTTP 缓存为全局清除）' : '✓ 清除完成', 'success');
    } catch (err) {
        showStatus('清除失败: ' + err.message, 'error');
    } finally {
        btn.textContent = '一键清除';
        btn.disabled = false;
    }
});

loadTabs();

/* ==================== Header 规则管理 ==================== */
// 规则结构: { id, enabled, header, operation: 'set'|'remove', value }
// 全局结构: { enabled, urlFilter, rules: [...] }

const HR_STORAGE_KEY = 'headerRules';
const DEFAULT_HR = { enabled: false, urlFilter: '', rules: [] };
let hrState = { ...DEFAULT_HR };

function nextRuleId() {
    return Date.now() + Math.floor(Math.random() * 10000);
}

async function loadHeaderRules() {
    const data = await chrome.storage.local.get(HR_STORAGE_KEY);
    hrState = { ...DEFAULT_HR, ...(data[HR_STORAGE_KEY] || {}) };
    if (!Array.isArray(hrState.rules)) hrState.rules = [];
    // 兼容旧数据:历史 append 规则迁移为 set
    hrState.rules.forEach(r => {
        if (r.operation === 'append') r.operation = 'set';
    });
    document.getElementById('hrFilter').value = hrState.urlFilter || '';
    updatePlayButton();
    renderHeaderRules();
    // 启动时按当前 enabled 同步一次（确保浏览器重启后规则仍生效）
    syncDnrRules();
}

async function saveHeaderRules() {
    await chrome.storage.local.set({ [HR_STORAGE_KEY]: hrState });
    await syncDnrRules();
}

let _saveHrTimer = null;
function saveHeaderRulesDebounced() {
    if (_saveHrTimer) clearTimeout(_saveHrTimer);
    _saveHrTimer = setTimeout(() => {
        _saveHrTimer = null;
        saveHeaderRules();
    }, 250);
}

// 把 hrState 编译为 declarativeNetRequest 动态规则
async function syncDnrRules() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map(r => r.id);

    const addRules = [];
    if (hrState.enabled) {
        // header 名仅允许 token 字符 (RFC 7230): 字母数字以及 ! # $ % & ' * + - . ^ _ ` | ~
        const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;
        const validRules = hrState.rules.filter(r => {
            if (!r.enabled) return false;
            const name = (r.header || '').trim();
            return name && HEADER_NAME_RE.test(name);
        });
        const requestHeaders = validRules.map(r => {
            const item = { header: r.header.trim(), operation: r.operation };
            if (r.operation !== 'remove') item.value = r.value || '';
            return item;
        });
        if (requestHeaders.length > 0) {
            const condition = {
                resourceTypes: [
                    'main_frame', 'sub_frame', 'xmlhttprequest', 'script',
                    'stylesheet', 'image', 'font', 'media', 'websocket', 'other'
                ]
            };
            if (hrState.urlFilter && hrState.urlFilter.trim()) {
                condition.urlFilter = hrState.urlFilter.trim();
            }
            addRules.push({
                id: 1,
                priority: 1,
                action: { type: 'modifyHeaders', requestHeaders },
                condition
            });
        }
    }

    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds,
            addRules
        });
    } catch (e) {
        // updateDynamicRules 失败:通常是 header 名格式非法或值不合规
    }
}

function renderHeaderRules() {
    // 清理上次渲染时挂在 body 上的下拉菜单
    document.querySelectorAll('body > .op-menu').forEach(m => m.remove());
    const list = document.getElementById('hrList');
    if (!hrState.rules.length) {
        list.innerHTML = '<div class="hr-empty">暂无规则</div>';
        return;
    }
    list.innerHTML = '';
    const frag = document.createDocumentFragment();
    hrState.rules.forEach(rule => {
        const row = document.createElement('div');
        row.className = 'hr-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!rule.enabled;
        cb.addEventListener('change', () => {
            rule.enabled = cb.checked;
            saveHeaderRules();
        });

        const op = document.createElement('div');
        op.className = 'op-select';
        op.tabIndex = 0;
        const opLabel = document.createElement('span');
        opLabel.className = 'op-label';
        opLabel.textContent = rule.operation;
        const opCaret = document.createElement('span');
        opCaret.className = 'op-caret';
        op.appendChild(opLabel);
        op.appendChild(opCaret);

        // 菜单挂到 body 避免被裁剪/覆盖
        const opMenu = document.createElement('div');
        opMenu.className = 'op-menu hidden';
        ['set', 'remove'].forEach(v => {
            const item = document.createElement('div');
            item.className = 'op-item' + (rule.operation === v ? ' active' : '');
            item.textContent = v;
            item.addEventListener('click', ev => {
                ev.stopPropagation();
                rule.operation = v;
                opLabel.textContent = v;
                opMenu.querySelectorAll('.op-item').forEach(el => {
                    el.classList.toggle('active', el.textContent === v);
                });
                valInput.disabled = v === 'remove';
                closeOpMenu();
                saveHeaderRules();
            });
            opMenu.appendChild(item);
        });
        document.body.appendChild(opMenu);

        function closeOpMenu() {
            opMenu.classList.add('hidden');
            op.classList.remove('open');
            document.removeEventListener('click', onDocClick, true);
        }
        function onDocClick(e) {
            if (!op.contains(e.target) && !opMenu.contains(e.target)) closeOpMenu();
        }
        function openOpMenu() {
            // 关闭其他打开的菜单
            document.querySelectorAll('.op-menu').forEach(m => {
                if (m !== opMenu) m.classList.add('hidden');
            });
            document.querySelectorAll('.op-select').forEach(s => {
                if (s !== op) s.classList.remove('open');
            });
            opMenu.classList.remove('hidden');
            op.classList.add('open');
            // 计算位置:优先向下,空间不够则向上
            const rect = op.getBoundingClientRect();
            opMenu.style.minWidth = rect.width + 'px';
            opMenu.style.left = rect.left + 'px';
            const menuH = opMenu.offsetHeight;
            const viewportH = window.innerHeight;
            const spaceBelow = viewportH - rect.bottom;
            if (spaceBelow >= menuH + 8 || spaceBelow >= viewportH - rect.top - 8) {
                opMenu.style.top = (rect.bottom + 4) + 'px';
            } else {
                opMenu.style.top = (rect.top - menuH - 4) + 'px';
            }
            // 延迟绑定,避免当前 click 立即触发关闭
            setTimeout(() => {
                document.addEventListener('click', onDocClick, true);
            }, 0);
        }
        op.addEventListener('click', e => {
            e.stopPropagation();
            if (opMenu.classList.contains('hidden')) {
                openOpMenu();
            } else {
                closeOpMenu();
            }
        });

        const headerInput = document.createElement('input');
        headerInput.type = 'text';
        headerInput.placeholder = 'Header 名';
        headerInput.value = rule.header || '';
        headerInput.addEventListener('input', () => {
            rule.header = headerInput.value.trim();
            saveHeaderRulesDebounced();
        });

        const valInput = document.createElement('input');
        valInput.type = 'text';
        valInput.placeholder = '值';
        valInput.value = rule.value || '';
        valInput.disabled = rule.operation === 'remove';
        valInput.addEventListener('input', () => {
            rule.value = valInput.value;
            saveHeaderRulesDebounced();
        });

        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '×';
        del.title = '删除';
        del.addEventListener('click', () => {
            hrState.rules = hrState.rules.filter(r => r.id !== rule.id);
            renderHeaderRules();
            saveHeaderRules();
        });

        row.appendChild(cb);
        row.appendChild(op);
        row.appendChild(headerInput);
        row.appendChild(valInput);
        row.appendChild(del);
        frag.appendChild(row);
    });
    list.appendChild(frag);
}

document.getElementById('hrFilter').addEventListener('input', e => {
    hrState.urlFilter = e.target.value.trim();
    saveHeaderRulesDebounced();
});

document.getElementById('hrAdd').addEventListener('click', () => {
    hrState.rules.push({
        id: nextRuleId(),
        enabled: true,
        header: '',
        operation: 'set',
        value: ''
    });
    renderHeaderRules();
    // 不立即 save (header 还为空，会被 filter 掉)
});

/* ----- 播放/暂停按钮：全局开启/暂停拦截 ----- */
const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');

const ICON_PLAY = '<polygon points="6 4 20 12 6 20 6 4"/>';
const ICON_PAUSE = '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>';

function updatePlayButton() {
    const on = !!hrState.enabled;
    playBtn.classList.toggle('on', on);
    playIcon.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    playBtn.title = on ? '暂停' : '开始';
}

playBtn.addEventListener('click', () => {
    hrState.enabled = !hrState.enabled;
    updatePlayButton();
    saveHeaderRules();
});

/* ----- Tab 切换 ----- */
const ACTIVE_TAB_KEY = 'activeTab';

function activateTab(target) {
    document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === target);
    });
    document.querySelectorAll('.tab-pane').forEach(p => {
        p.classList.toggle('hidden', p.id !== `pane-${target}`);
    });
}

document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        activateTab(target);
        chrome.storage.local.set({ [ACTIVE_TAB_KEY]: target });
    });
});

chrome.storage.local.get(ACTIVE_TAB_KEY, res => {
    const saved = res && res[ACTIVE_TAB_KEY];
    if (saved) activateTab(saved);
});

loadHeaderRules();
