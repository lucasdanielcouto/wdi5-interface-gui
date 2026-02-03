const btnScan = document.getElementById('btn-scan');
const fileList = document.getElementById('file-list');
const terminalOutput = document.getElementById('terminal-output');
const btnRun = document.getElementById('btn-run');
const activeSpecTitle = document.getElementById('active-spec-title');
const testList = document.getElementById('test-list');

// Internal State
let selectedSpec = null;
let currentTestMap = {}; // Maps test title to DOM element
let testQueue = []; // Array of { title, element, status } to track order


// --- SCAN LOGIC ---

btnScan.addEventListener('click', async () => {
    logToTerminal('Searching for specs...', 'text-yellow-500');
    const result = await window.electronAPI.scanSpecs();
    if (result.success) {
        logToTerminal(`Found ${result.files.length} files.`, 'text-green-500');
        renderFileList(result.files);
    } else {
        logToTerminal(`Error: ${result.error}`, 'text-red-500');
        fileList.innerHTML = `<div class="text-red-500 text-xs p-2">Error scanning: ${result.error}</div>`;
    }
});

// Listener GLOBAL
let logBuffer = '';

window.electronAPI.onTestOutput((chunk) => {
    // Append new chunk to buffer
    logBuffer += chunk;
    const lines = logBuffer.split('\n');
    logBuffer = lines.pop(); // Save incomplete line

    lines.forEach(line => {
        parseLogLineForRunner(line);
    });

    // Auto scroll
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
});


// --- SELECTION LOGIC ---

async function handleSelectSpec(fileObj) {
    selectedSpec = fileObj.path;

    // Update Header
    activeSpecTitle.innerHTML = `<span class="text-blue-600">${fileObj.name}</span> <span class="text-xs font-normal text-gray-400 block">${fileObj.path}</span>`;
    activeSpecTitle.classList.remove('text-gray-500');

    // Clear Previous Results
    terminalOutput.innerHTML = '<div class="text-gray-500 italic">> Ready to run.</div>';
    testList.innerHTML = '<div class="text-xs text-gray-500 text-center mt-4"><i class="fas fa-search"></i> Parsing spec file...</div>';

    // Parse File immediately to show steps
    try {
        const fileContent = await window.electronAPI.readFile(selectedSpec);
        const itBlocks = extractItBlocks(fileContent);
        const describeTitle = extractDescribeTitle(fileContent);
        renderTestList(itBlocks, describeTitle);
        logToTerminal(`Loaded spec: ${fileObj.name}`);
    } catch (e) {
        testList.innerHTML = `<div class="text-red-500 text-xs p-2">Error parsing file: ${e}</div>`;
        logToTerminal(`Error reading file: ${e}`, 'error');
    }
}


// --- RUN LOGIC ---

btnRun.addEventListener('click', async () => {
    if (!selectedSpec) {
        alert('Please select a spec file first.');
        return;
    }

    // 1. Prepare UI
    terminalOutput.innerHTML = '';

    // Refresh the parsed list just in case (optional, but ensures fresh state)
    // We already parsed on selection, but re-parsing ensures we clear "success" icons
    const fileContent = await window.electronAPI.readFile(selectedSpec); // Cached by OS mostly
    const itBlocks = extractItBlocks(fileContent);
    const describeTitle = extractDescribeTitle(fileContent);
    renderTestList(itBlocks, describeTitle);

    // 3. Start Test
    logToTerminal(`🚀 Starting: ${selectedSpec}`, 'info');

    // Set first item to running immediately
    setTestRunning(0);

    // Disable run button temporarily
    btnRun.disabled = true;
    btnRun.classList.add('opacity-50', 'cursor-not-allowed');
    btnRun.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Running';

    const result = await window.electronAPI.runTest(selectedSpec);

    btnRun.disabled = false;
    btnRun.classList.remove('opacity-50', 'cursor-not-allowed');
    btnRun.innerHTML = '<i class="fas fa-play"></i> Run Test';

    // STOP GLOBAL SPINNER
    const globalSpinner = document.getElementById('global-spinner');
    if (globalSpinner) globalSpinner.classList.add('hidden');

    if (result.success) {
        logToTerminal(`🏁 Finished with code ${result.code}`, result.code === 0 ? 'success' : 'error');
    } else {
        logToTerminal(`❌ Execution Error: ${result.error}`, 'error');
    }
});

function extractDescribeTitle(content) {
    const regex = /describe\s*\(\s*['"`](.+?)['"`]/;
    const match = regex.exec(content);
    return match ? match[1] : 'Test Suite Execution';
}

function extractItBlocks(content) {
    const regex = /it\s*\(\s*['"`](.+?)['"`]/g;
    let match;
    const titles = [];
    while ((match = regex.exec(content)) !== null) {
        titles.push(match[1]);
    }
    return titles;
}

function renderTestList(titles, describeTitle = 'Test Suite Execution') {
    testList.innerHTML = '';
    currentTestMap = {};
    testQueue = [];

    // RESET GLOBAL STATES
    globalErrorLines.clear();
    isSummarySection = false;

    if (titles.length === 0) {
        testList.innerHTML = '<div class="text-xs text-gray-400 p-2 italic">No "it" blocks found (or using dynamic tests).</div>';
        return;
    }

    // 1. GLOBAL HEADER
    const headerDiv = document.createElement('div');
    headerDiv.className = 'mb-2 pb-2 border-b border-gray-100';
    headerDiv.innerHTML = `
        <div class="flex items-center text-sm font-bold text-gray-700">
            <span class="truncate flex-1">${describeTitle}</span>
        </div>
        
        <div id="global-error-container" class="hidden mt-2 bg-red-50 border border-red-200 rounded p-2 shadow-sm">
            <div class="flex items-center text-red-700 font-bold text-xs mb-1">
                <i class="fas fa-exclamation-triangle mr-1"></i> Errors
            </div>
            <div id="global-error-badges" class="flex flex-wrap gap-1 mb-1"></div>
            <div id="global-error-logs" class="text-[10px] font-mono text-red-600 max-h-40 overflow-y-auto whitespace-pre-wrap break-all p-1 bg-white rounded border border-red-100"></div>
        </div>
    `;
    testList.appendChild(headerDiv);

    // 2. LIST
    const listContainer = document.createElement('div');
    listContainer.className = 'space-y-1';
    testList.appendChild(listContainer);

    titles.forEach((title, index) => {
        const div = document.createElement('div');
        div.className = 'test-item flex items-center p-2 py-1.5 rounded border border-transparent hover:bg-gray-50 text-xs transition-all cursor-default';

        div.innerHTML = `
            <div class="w-5 h-5 flex items-center justify-center mr-2 shrink-0">
                <i class="fas fa-circle text-gray-200 text-[8px] status-icon"></i>
            </div>
            <span class="text-gray-600 font-medium truncate select-none flex-1" title="${title}">${title}</span>
        `;

        listContainer.appendChild(div);
        currentTestMap[title.trim()] = div;

        const item = {
            title: title.trim(),
            element: div,
            status: 'queued',
            logs: []
        };
        testQueue.push(item);
    });
}

// Function to set a specific item to "Running" state
let currentRunningIndex = -1;

function setTestRunning(index) {
    if (index >= 0 && index < testQueue.length) {
        currentRunningIndex = index;
        const item = testQueue[index];
        if (item.status !== 'queued') return;

        item.status = 'running';

        // SHOW GLOBAL SPINNER
        const globalSpinner = document.getElementById('global-spinner');
        if (globalSpinner) globalSpinner.classList.remove('hidden');

        // Update UI
        item.element.className = 'test-item flex items-center p-2 py-1.5 rounded bg-blue-50 border-blue-200 text-xs transition-all border';
    }
}

function getStatusIcon(status) {
    switch (status) {
        case 'running': return { class: 'fas fa-circle-notch fa-spin text-blue-500 text-xs status-icon' };
        case 'success': return { class: 'fas fa-check-circle text-green-500 text-sm status-icon' };
        case 'error': return { class: 'fas fa-times-circle text-red-500 text-sm status-icon' };
        default: return { class: 'fas fa-circle text-gray-200 text-[8px] status-icon' };
    }
}

// --- PARSER FOR STATUS UPDATE ---

const globalErrorLines = new Set();
let isSummarySection = false;

function parseLogLineForRunner(line) {
    logToTerminal(line, 'default'); // Always log raw

    const cleanLine = line.replace(/\u001b\[\d+m/g, '');

    // DETECT SUMMARY
    if (/\d+\s+failing/.test(cleanLine)) {
        isSummarySection = true;
    }

    // Helper
    const isErrorLog = (str) => {
        return str.includes('Error:') || str.includes('failed') || str.includes('AssertionError') || str.trim().startsWith('at ') || str.includes('Expected:') || str.includes('Received:') || str.includes('TypeError:');
    };

    if (isErrorLog(cleanLine) && !isSummarySection) {
        // REVEAL GLOBAL ERROR CONTAINER
        const container = document.getElementById('global-error-container');
        if (container) container.classList.remove('hidden');

        let lineNo = null;
        const stackMatch = cleanLine.match(/at .*[ \(](.*):(\d+):(\d+)\)?/);
        if (stackMatch && !stackMatch[1].includes('node_modules')) {
            lineNo = stackMatch[2];
        }

        // APPEND TO GLOBAL LOGS
        const logsDiv = document.getElementById('global-error-logs');
        if (logsDiv) {
            if (!logsDiv.lastChild || logsDiv.lastChild.textContent !== cleanLine) {
                const logEntry = document.createElement('div');
                logEntry.className = 'mb-1 border-b border-red-50 pb-1 px-1 rounded hover:bg-red-50';

                // Linkify
                const stackPathRegex = /((?:[a-zA-Z]:\\|\/)[a-zA-Z0-9_\-\\\/.]+\.(?:js|ts|jsx|tsx):\d+:\d+)/g;
                const formattedLine = cleanLine.replace(stackPathRegex, (match) => {
                    if (match.includes('node_modules')) return `<span class="text-gray-400">${match}</span>`;
                    const safeMatch = match.replace(/"/g, '&quot;').replace(/\\/g, '\\\\');
                    return `<span class="text-blue-600 hover:text-blue-800 underline cursor-pointer font-bold" onclick="window.electronAPI.openInVSCode('${safeMatch}')" title="Open in VS Code">${match}</span>`;
                });

                logEntry.innerHTML = formattedLine;
                if (lineNo && !globalErrorLines.has(lineNo)) logEntry.id = `err-log-${lineNo}`;
                logsDiv.appendChild(logEntry);
            }
        }
    }

    // Success/Fail Patterns
    const successMatch = cleanLine.match(/✓\s+(.+)/);
    if (successMatch) {
        let title = successMatch[1].replace(/\s+\(\d+ms\).*$/, '').trim();
        updateTestStatus(title, 'success');
        return;
    }

    const failMatch = cleanLine.match(/✖\s+(.+)/);
    if (failMatch) {
        let title = failMatch[1].replace(/\s+\(\d+ms\).*$/, '').trim();
        updateTestStatus(title, 'error');
        return;
    }
}

function updateTestStatus(title, status) {
    let bestMatchIndex = -1;
    let bestMatchScore = 0;

    testQueue.forEach((item, index) => {
        if (item.status === 'success' || item.status === 'error') return;

        let score = 0;
        if (title === item.title) score = 10;
        else if (title.startsWith(item.title)) score = 5;
        else if (title.includes(item.title) || item.title.includes(title)) score = 1;

        if (score > bestMatchScore) {
            bestMatchScore = score;
            bestMatchIndex = index;
        }
    });

    if (bestMatchIndex !== -1) {
        const item = testQueue[bestMatchIndex];
        const index = bestMatchIndex;
        item.status = status;

        // Update Icon
        const iconInfo = getStatusIcon(status);
        const iconContainer = item.element.querySelector('.status-icon');
        iconContainer.className = iconInfo.class;

        // Update Style
        const baseClass = 'test-item flex items-center p-2 py-1.5 rounded border shadow-sm text-xs transition-all ';
        if (status === 'success') {
            item.element.className = baseClass + 'bg-green-50 border-green-200';
        } else if (status === 'error') {
            item.element.className = baseClass + 'bg-red-50 border-red-200';
            const errorContainer = document.getElementById('global-error-container');
            if (errorContainer) errorContainer.classList.remove('hidden');
        }

        // TRIGGER NEXT
        setTestRunning(index + 1);
    }
}

// --- FILE LIST RENDERING ---

function groupFilesByFolder(files) {
    const groups = {};
    files.forEach(file => {
        const parts = file.relative.split(/[/\\]/);
        parts.pop();
        const folder = parts.length > 0 ? parts.join('/') : 'Raiz';
        if (!groups[folder]) groups[folder] = [];
        groups[folder].push(file);
    });
    return groups;
}

function renderFileList(cleanFiles) {
    fileList.innerHTML = '';
    const grouped = groupFilesByFolder(cleanFiles);
    const folders = Object.keys(grouped).sort();

    folders.forEach(folderName => {
        const details = document.createElement('details');
        details.open = true;
        details.className = 'group/folder mb-1';

        const summary = document.createElement('summary');
        summary.className = 'cursor-pointer list-none font-bold text-gray-500 text-[10px] uppercase tracking-wider py-1 px-2 hover:bg-gray-100 rounded flex items-center select-none';
        summary.innerHTML = `<i class="fas fa-folder-open text-blue-300 mr-2"></i> ${folderName}`;
        details.appendChild(summary);

        const fileContainer = document.createElement('div');
        fileContainer.className = 'pl-1 space-y-0.5 mt-0.5 border-l border-gray-100 ml-2';

        grouped[folderName].forEach(fileObj => {
            const div = document.createElement('div');
            // Clean, compact item
            div.className = 'group w-full text-left p-1.5 rounded border border-transparent cursor-pointer text-gray-600 text-xs hover:bg-white hover:shadow-sm transition-all flex flex-col hover:border-gray-200';
            div.innerHTML = `<span class="font-semibold text-gray-700 truncate">${fileObj.title}</span><span class="text-[9px] text-gray-400 truncate opacity-75">${fileObj.name}</span>`;

            div.onclick = (e) => {
                e.stopPropagation();
                // Visual Selection
                document.querySelectorAll('#file-list div.group').forEach(el => {
                    el.classList.remove('bg-blue-50', 'border-blue-400', 'shadow-sm');
                    el.classList.add('border-transparent');
                });
                div.classList.remove('border-transparent');
                div.classList.add('bg-blue-50', 'border-blue-400', 'shadow-sm');

                handleSelectSpec(fileObj);
            };
            fileContainer.appendChild(div);
        });

        details.appendChild(fileContainer);
        fileList.appendChild(details);
    });
}


// --- UTILS ---

function logToTerminal(message, type = 'default') {
    if (!message || !message.trim()) return;
    const div = document.createElement('div');
    const color = type === 'error' ? 'text-red-400 font-bold' : type === 'success' ? 'text-green-400 font-bold' : type === 'info' ? 'text-blue-300' : 'text-gray-300';
    div.className = `mb-0.5 ${color} break-all whitespace-pre-wrap font-mono text-xs opacity-90 leading-tight`;

    const isError = message.includes('Error') || message.includes('Stack');
    if (isError) div.className += ' pl-2 border-l-2 border-red-800 bg-red-900/10';

    div.textContent = `> ${message}`;
    terminalOutput.appendChild(div);
}

// Auto Init
setTimeout(() => {
    if (btnScan) btnScan.click();
}, 500);
