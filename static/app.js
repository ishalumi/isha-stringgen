// 全局状态
let formats = {};
let currentEntry = null;
let editingEntryId = null;
let lastSavedPrefix = '';
let prefixSaveTimer = null;
let prefixRequestToken = 0;

// DOM 元素
const elements = {
    prefixInput: document.getElementById('prefix-input'),
    prefixStatus: document.getElementById('prefix-status'),
    formatSelect: document.getElementById('format-select'),
    formatDescription: document.getElementById('format-description'),
    lengthGroup: document.getElementById('length-group'),
    lengthInput: document.getElementById('length-input'),
    generateBtn: document.getElementById('generate-btn'),
    resultSection: document.getElementById('result-section'),
    generatedValue: document.getElementById('generated-value'),
    copyBtn: document.getElementById('copy-btn'),
    saveSection: document.getElementById('save-section'),
    nameInput: document.getElementById('name-input'),
    saveBtn: document.getElementById('save-btn'),

    manualName: document.getElementById('manual-name'),
    manualValue: document.getElementById('manual-value'),
    manualFormat: document.getElementById('manual-format'),
    manualSaveBtn: document.getElementById('manual-save-btn'),

    searchInput: document.getElementById('search-input'),
    entriesList: document.getElementById('entries-list'),
    statistics: document.getElementById('statistics'),
    refreshBtn: document.getElementById('refresh-btn'),
    exportBtn: document.getElementById('export-btn'),

    configBtn: document.getElementById('config-btn'),
    configModal: document.getElementById('config-modal'),
    configHost: document.getElementById('config-host'),
    configPort: document.getElementById('config-port'),
    configSaveBtn: document.getElementById('config-save-btn'),
    configCancelBtn: document.getElementById('config-cancel-btn'),
    configModalClose: document.getElementById('config-modal-close'),

    editModal: document.getElementById('edit-modal'),
    editName: document.getElementById('edit-name'),
    editValue: document.getElementById('edit-value'),
    editSaveBtn: document.getElementById('edit-save-btn'),
    editCancelBtn: document.getElementById('edit-cancel-btn'),
    editModalClose: document.getElementById('edit-modal-close'),

    toast: document.getElementById('toast')
};

// 初始化
async function init() {
    bindEvents();
    await Promise.all([
        loadFormats(),
        loadRuntimeConfig(),
        loadEntries()
    ]);
}

// 加载格式信息
async function loadFormats() {
    try {
        const response = await fetch('/api/formats');
        formats = await response.json();
        updateFormatDescription();
    } catch (error) {
        showToast('加载格式信息失败', 'error');
    }
}

// 加载当前运行时配置
async function loadRuntimeConfig() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();

        if (response.ok) {
            lastSavedPrefix = config.prefix || '';
            elements.prefixInput.value = lastSavedPrefix;
            setPrefixStatus('已同步，修改后自动保存', 'idle');
        } else {
            setPrefixStatus('加载失败', 'error');
            showToast(config.error || '加载配置失败', 'error');
        }
    } catch (error) {
        setPrefixStatus('网络错误', 'error');
        showToast('加载配置失败', 'error');
    }
}

// 设置前缀同步状态
function setPrefixStatus(message, state = 'idle') {
    elements.prefixStatus.textContent = message;
    elements.prefixStatus.className = `prefix-status prefix-status-${state}`;
}

// 校验前缀输入
function getPrefixValidationError(prefix) {
    if (!prefix) {
        return '前缀不能为空';
    }

    if (/[=\r\n\u0000]/.test(prefix)) {
        return '前缀不能包含控制字符或等号';
    }

    return '';
}

// 计划前缀保存
function schedulePrefixSave() {
    const prefix = elements.prefixInput.value.trim();
    const validationError = getPrefixValidationError(prefix);

    clearTimeout(prefixSaveTimer);

    if (validationError) {
        setPrefixStatus(validationError, 'error');
        return;
    }

    if (prefix === lastSavedPrefix) {
        setPrefixStatus('已同步，修改后自动保存', 'idle');
        return;
    }

    setPrefixStatus('检测到变更，准备保存...', 'pending');
    prefixSaveTimer = setTimeout(() => {
        savePrefix(prefix);
    }, 400);
}

// 立即保存前缀
async function flushPrefixSave() {
    const prefix = elements.prefixInput.value.trim();
    const validationError = getPrefixValidationError(prefix);

    clearTimeout(prefixSaveTimer);

    if (validationError) {
        setPrefixStatus(validationError, 'error');
        return;
    }

    if (prefix === lastSavedPrefix) {
        setPrefixStatus('已同步，修改后自动保存', 'idle');
        return;
    }

    await savePrefix(prefix);
}

// 保存前缀并立即生效
async function savePrefix(prefix) {
    const requestToken = ++prefixRequestToken;
    setPrefixStatus('前缀保存中...', 'pending');

    try {
        const response = await fetch('/api/config/prefix', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix })
        });

        const data = await response.json();

        if (requestToken !== prefixRequestToken) {
            return false;
        }

        if (response.ok) {
            lastSavedPrefix = data.prefix;
            elements.prefixInput.value = data.prefix;
            if (data.formats) {
                formats = data.formats;
                updateFormatDescription();
            }
            setPrefixStatus('前缀已保存，已立即生效', 'success');
            return true;
        } else {
            setPrefixStatus(data.error || '保存失败', 'error');
            return false;
        }
    } catch (error) {
        if (requestToken !== prefixRequestToken) {
            return false;
        }

        setPrefixStatus('网络错误，前缀未保存', 'error');
        return false;
    }
}

// 在执行依赖前缀的操作前，确保前缀已同步到后端
async function ensurePrefixSynced() {
    const prefix = elements.prefixInput.value.trim();
    const validationError = getPrefixValidationError(prefix);

    clearTimeout(prefixSaveTimer);

    if (validationError) {
        setPrefixStatus(validationError, 'error');
        showToast(validationError, 'error');
        return false;
    }

    if (prefix === lastSavedPrefix) {
        return true;
    }

    const saved = await savePrefix(prefix);
    if (!saved) {
        showToast('前缀保存失败，请稍后重试', 'error');
        return false;
    }

    return true;
}

// 更新格式描述
function updateFormatDescription() {
    const selectedFormat = elements.formatSelect.value;
    const formatInfo = formats[selectedFormat];

    if (formatInfo) {
        elements.formatDescription.textContent = `${formatInfo.description} - 示例: ${formatInfo.example}`;

        // 控制长度输入框显示
        const lengthHelpText = elements.lengthGroup.querySelector('.form-text');
        if (formatInfo.supports_length) {
            elements.lengthGroup.style.display = 'block';
            // 设置提示文本，如果有特殊说明则使用，否则使用默认
            lengthHelpText.textContent = formatInfo.length_note || '范围: 1-256';
        } else {
            elements.lengthGroup.style.display = 'none';
        }
    }
}

// 生成字符串
async function generateString() {
    const format = elements.formatSelect.value;
    const length = parseInt(elements.lengthInput.value);

    if (!(await ensurePrefixSynced())) {
        return;
    }

    elements.generateBtn.disabled = true;
    elements.generateBtn.textContent = '生成中...';

    try {
        const response = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ format, length })
        });

        const data = await response.json();

        if (response.ok) {
            currentEntry = data;
            elements.generatedValue.textContent = data.value;
            elements.resultSection.style.display = 'block';
            elements.saveSection.style.display = 'block';
            elements.nameInput.value = '';
            elements.nameInput.focus();
        } else {
            showToast(data.error || '生成失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    } finally {
        elements.generateBtn.disabled = false;
        elements.generateBtn.textContent = '🎲 生成随机字符串';
    }
}

// 复制到剪贴板
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('已复制到剪贴板', 'success');
    } catch (error) {
        // 降级方案
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('已复制到剪贴板', 'success');
    }
}

// 保存生成的字符串
async function saveEntry() {
    const name = elements.nameInput.value.trim();

    if (!name) {
        showToast('请输入名称', 'error');
        return;
    }

    if (!currentEntry) {
        showToast('没有可保存的字符串', 'error');
        return;
    }

    elements.saveBtn.disabled = true;

    try {
        const response = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name,
                value: currentEntry.value,
                format: currentEntry.format,
                length: currentEntry.length,
                enforce_prefix: false
            })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('保存成功', 'success');
            elements.nameInput.value = '';
            elements.saveSection.style.display = 'none';
            await loadEntries();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    } finally {
        elements.saveBtn.disabled = false;
    }
}

// 保存手动输入
async function saveManualEntry() {
    const name = elements.manualName.value.trim();
    const value = elements.manualValue.value.trim();
    const format = elements.manualFormat.value;

    if (!(await ensurePrefixSynced())) {
        return;
    }

    if (!name) {
        showToast('请输入名称', 'error');
        return;
    }

    if (!value) {
        showToast('请输入字符串值', 'error');
        return;
    }

    elements.manualSaveBtn.disabled = true;

    try {
        const response = await fetch('/api/entries', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, value, format })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('保存成功', 'success');
            elements.manualName.value = '';
            elements.manualValue.value = '';
            await loadEntries();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    } finally {
        elements.manualSaveBtn.disabled = false;
    }
}

// 加载列表
async function loadEntries(search = '') {
    elements.entriesList.innerHTML = '<div class="loading">加载中...</div>';

    try {
        const url = search ? `/api/entries?search=${encodeURIComponent(search)}` : '/api/entries';
        const response = await fetch(url);
        const data = await response.json();

        if (response.ok) {
            renderEntries(data.entries);
            await loadStatistics();
        } else {
            showToast(data.error || '加载失败', 'error');
        }
    } catch (error) {
        elements.entriesList.innerHTML = '<div class="loading">加载失败</div>';
        showToast('网络错误', 'error');
    }
}

// 渲染列表
function renderEntries(entries) {
    if (entries.length === 0) {
        elements.entriesList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 48px; height: 48px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                </div>
                <p>暂无保存的字符串</p>
            </div>
        `;
        return;
    }

    elements.entriesList.innerHTML = entries.map(entry => `
        <div class="entry-item">
            <div class="entry-header">
                <div class="entry-name">${escapeHtml(entry.name)}</div>
                <div class="entry-actions">
                    <button class="btn btn-icon btn-small" onclick="copyEntryValue(${entry.id})" title="复制">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-small" onclick="editEntry(${entry.id})" title="编辑">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="btn btn-icon btn-small" onclick="deleteEntry(${entry.id})" title="删除">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                </div>
            </div>
            <div class="entry-value">${escapeHtml(entry.value)}</div>
            <div class="entry-meta">
                <span class="entry-badge">${escapeHtml(entry.format)}</span>
                <span>创建: ${formatDate(entry.created_at)}</span>
                ${entry.length !== null && entry.length !== undefined ? `<span>长度: ${entry.length}</span>` : ''}
            </div>
        </div>
    `).join('');
}

// 加载统计信息
async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        const data = await response.json();

        if (response.ok) {
            const formatStats = Object.entries(data.by_format)
                .map(([format, count]) => `${escapeHtml(format)}: ${count}`)
                .join(' | ');

            const iconSvg = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><rect x="18" y="3" width="4" height="18"></rect><rect x="10" y="8" width="4" height="13"></rect><rect x="2" y="13" width="4" height="8"></rect></svg>`;
            
            elements.statistics.innerHTML = `${iconSvg} 总计: ${data.total} 条${formatStats ? ` | ${formatStats}` : ''}`;
        }
    } catch (error) {
        console.error('加载统计信息失败', error);
    }
}

// 复制条目值
async function copyEntryValue(id) {
    try {
        const response = await fetch(`/api/entries/${id}`);
        const entry = await response.json();

        if (response.ok) {
            await copyToClipboard(entry.value);
        }
    } catch (error) {
        showToast('复制失败', 'error');
    }
}

// 编辑条目
async function editEntry(id) {
    try {
        const response = await fetch(`/api/entries/${id}`);
        const entry = await response.json();

        if (response.ok) {
            editingEntryId = id;
            elements.editName.value = entry.name;
            elements.editValue.value = entry.value;
            elements.editModal.classList.add('active');
        }
    } catch (error) {
        showToast('加载失败', 'error');
    }
}

// 保存编辑
async function saveEdit() {
    const name = elements.editName.value.trim();
    const value = elements.editValue.value.trim();

    if (!(await ensurePrefixSynced())) {
        return;
    }

    if (!name || !value) {
        showToast('名称和值不能为空', 'error');
        return;
    }

    elements.editSaveBtn.disabled = true;

    try {
        const response = await fetch(`/api/entries/${editingEntryId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, value, enforce_prefix: false })
        });

        const data = await response.json();

        if (response.ok) {
            showToast('更新成功', 'success');
            closeEditModal();
            await loadEntries();
        } else {
            showToast(data.error || '更新失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    } finally {
        elements.editSaveBtn.disabled = false;
    }
}

// 关闭编辑模态框
function closeEditModal() {
    elements.editModal.classList.remove('active');
    editingEntryId = null;
}

// 删除条目
async function deleteEntry(id) {
    if (!confirm('确定要删除这条记录吗？')) {
        return;
    }

    try {
        const response = await fetch(`/api/entries/${id}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok) {
            showToast('删除成功', 'success');
            await loadEntries();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    }
}

// 导出数据
async function exportData() {
    try {
        const response = await fetch('/api/export');

        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'strings-export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            showToast('导出成功', 'success');
        } else {
            showToast('导出失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    }
}

// 显示 Toast 通知
function showToast(message, type = 'success') {
    elements.toast.textContent = message;
    elements.toast.className = `toast ${type} show`;

    setTimeout(() => {
        elements.toast.classList.remove('show');
    }, 3000);
}

// 工具函数：转义 HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 工具函数：格式化日期
function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 打开配置模态框
async function openConfigModal() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();

        if (response.ok) {
            elements.configHost.value = config.server_host || '';
            elements.configPort.value = config.server_port || '';
            elements.configModal.classList.add('active');
        } else {
            showToast('加载配置失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    }
}

// 关闭配置模态框
function closeConfigModal() {
    elements.configModal.classList.remove('active');
}

// 保存配置
async function saveConfig() {
    const host = elements.configHost.value.trim();
    const port = parseInt(elements.configPort.value);

    if (!host) {
        showToast('服务器地址不能为空', 'error');
        return;
    }

    if (!port || port < 1 || port > 65535) {
        showToast('端口必须在 1-65535 之间', 'error');
        return;
    }

    elements.configSaveBtn.disabled = true;

    try {
        const response = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ host, port })
        });

        const data = await response.json();

        if (response.ok) {
            showToast(data.message || '配置已保存', 'success');
            closeConfigModal();
        } else {
            showToast(data.error || '保存失败', 'error');
        }
    } catch (error) {
        showToast('网络错误', 'error');
    } finally {
        elements.configSaveBtn.disabled = false;
    }
}

// 绑定事件
function bindEvents() {
    // 实时前缀
    elements.prefixInput.addEventListener('input', schedulePrefixSave);
    elements.prefixInput.addEventListener('blur', flushPrefixSave);
    elements.prefixInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            flushPrefixSave();
        }
    });

    // 格式选择变化
    elements.formatSelect.addEventListener('change', updateFormatDescription);

    // 生成按钮
    elements.generateBtn.addEventListener('click', generateString);

    // 复制按钮
    elements.copyBtn.addEventListener('click', () => {
        if (currentEntry) {
            copyToClipboard(currentEntry.value);
        }
    });

    // 保存按钮
    elements.saveBtn.addEventListener('click', saveEntry);

    // 手动保存按钮
    elements.manualSaveBtn.addEventListener('click', saveManualEntry);

    // 搜索
    let searchTimeout;
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadEntries(e.target.value);
        }, 300);
    });

    // 刷新按钮
    elements.refreshBtn.addEventListener('click', () => loadEntries());

    // 导出按钮
    elements.exportBtn.addEventListener('click', exportData);

    // 配置按钮
    elements.configBtn.addEventListener('click', openConfigModal);
    elements.configSaveBtn.addEventListener('click', saveConfig);
    elements.configCancelBtn.addEventListener('click', closeConfigModal);
    elements.configModalClose.addEventListener('click', closeConfigModal);

    // 点击配置模态框外部关闭
    elements.configModal.addEventListener('click', (e) => {
        if (e.target === elements.configModal) {
            closeConfigModal();
        }
    });

    // 编辑模态框
    elements.editSaveBtn.addEventListener('click', saveEdit);
    elements.editCancelBtn.addEventListener('click', closeEditModal);
    elements.editModalClose.addEventListener('click', closeEditModal);

    // 点击编辑模态框外部关闭
    elements.editModal.addEventListener('click', (e) => {
        if (e.target === elements.editModal) {
            closeEditModal();
        }
    });

    // 回车快捷键
    elements.nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            saveEntry();
        }
    });
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
