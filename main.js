const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#1a1a1a' // Dark mode base
  });

  mainWindow.loadFile('index.html');

  // Open the DevTools.
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Fase 2: Navegador de Arquivos Recursivo
// Função auxiliar para extrair o título do describe
function extractDescribeTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Regex para capturar describe("Titulo" ou describe('Titulo'
    // Pega o primeiro que aparecer
    const match = content.match(/describe\s*\(\s*['"`](.+?)['"`]/);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

ipcMain.handle('scan-specs', async () => {
  const projectRoot = process.cwd();
  // Pastas comuns de testes em projetos UI5/WDI5
  const testDirs = ['test', 'tests', 'webapp/test', 'specs'];

  let foundFiles = [];

  const walkSync = (dir, filelist = []) => {
    if (!fs.existsSync(dir)) return filelist;
    const files = fs.readdirSync(dir);

    files.forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        if (file !== 'node_modules' && file !== '.git') {
          walkSync(filePath, filelist);
        }
      } else {
        // Filtra por .spec.js, .test.js ou .ts
        if (/\.(spec|test)\.(js|ts)$/.test(file)) {
          // Extrai o título do describe
          const describeTitle = extractDescribeTitle(filePath);

          filelist.push({
            name: file,
            relative: path.relative(projectRoot, filePath),
            path: filePath,
            title: describeTitle || file // Fallback para nome do arquivo se não achar describe
          });
        }
      }
    });
    return filelist;
  };

  testDirs.forEach(d => {
    walkSync(path.join(projectRoot, d), foundFiles);
  });

  return { success: true, files: foundFiles };
});

// Fase 3: Motor de Execução
const { spawn } = require('child_process');
let currentProcess = null;

ipcMain.handle('run-test', (event, specPath) => {
  return new Promise((resolve) => {
    if (currentProcess) {
      return resolve({ success: false, error: 'Já existe um teste em execução.' });
    }

    // Check for wdio config to decide mode
    const wdioConfigExists = fs.existsSync(path.join(process.cwd(), 'wdio.conf.js'));

    let cmd, args;

    if (wdioConfigExists) {
      // MODO REAL: Executa o wdi5 de verdade
      console.log('[Runner] Modo Real detectado (wdio.conf.js encontrado).');
      // Usando shell: true, não precisamos do .cmd no Windows, 'npx' basta
      cmd = 'npx';
      args = ['wdio', 'run', 'wdio.conf.js', '--spec', specPath];
    } else {
      // MODO SIMULAÇÃO
      console.log('[Runner] Modo Simulação (sem wdio.conf.js).');
      cmd = process.platform === 'win32' ? 'cmd.exe' : 'bash';
      const mockCmd = process.platform === 'win32'
        ? `echo [MOCK] wdi5 não detectado. Simulando teste em: ${specPath} & timeout 2 & echo [MOCK] Fim.`
        : `echo "[MOCK] wdi5 não detectado. Simulando teste em: ${specPath}"; sleep 2; echo "[MOCK] Fim."`;

      args = process.platform === 'win32' ? ['/c', mockCmd] : ['-c', mockCmd];
    }

    try {
      // Adicionado { shell: true } para corrigir EINVAL no Windows
      currentProcess = spawn(cmd, args, { shell: true });

      currentProcess.stdout.on('data', (data) => {
        event.sender.send('test-output', data.toString());
      });

      currentProcess.stderr.on('data', (data) => {
        event.sender.send('test-output', `ERRO: ${data.toString()}`);
      });

      currentProcess.on('error', (err) => {
        event.sender.send('test-output', `ERRO FATAL (Spawn): ${err.message}`);
        currentProcess = null; // Cleanup
      });

      currentProcess.on('close', (code) => {
        currentProcess = null;
        resolve({ success: true, code });
      });
    } catch (err) {
      resolve({ success: false, error: `Falha ao iniciar processo: ${err.message}` });
    }
  });
});

ipcMain.handle('stop-test', () => {
  if (currentProcess) {
    try {
      if (process.platform === 'win32') {
        // No Windows, usa taskkill para forçar o encerramento da árvore de processos (/T) à força (/F)
        spawn('taskkill', ['/pid', currentProcess.pid, '/f', '/t']);
      } else {
        // Em Linux/Mac, o kill padrão costuma funcionar melhor, mas podemos usar -9 se necessário
        currentProcess.kill();
      }
      currentProcess = null;
      return true;
    } catch (e) {
      console.error("Falha ao matar processo:", e);
      return false;
    }
  }
  return false;
});

// Fase 4: Integração com VS Code (Retornando ao spawn, mas com correção de 'zumbi')
// Usamos { detached: true, stdio: 'ignore' } e .unref() para soltar o processo do VS Code
// Isso permite clicar quantas vezes quiser sem travar o app.

ipcMain.handle('open-in-vscode', (event, fileLocation) => {
  // fileLocation formato: "c:/path/to/file.js:42:5"
  console.log(`[VSCode] Abrindo: ${fileLocation}`);

  // Remove aspas internas por segurança
  const safeLocation = fileLocation.replace(/"/g, '');

  const subprocess = spawn('code', ['--goto', safeLocation], {
    shell: true,
    detached: true,
    stdio: 'ignore'
  });

  subprocess.unref();

  return true;
});

// Fase 5: Leitura de Arquivo (Para extrair 'it' blocks)
ipcMain.handle('read-file', (event, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return `Error reading file: ${e.message}`;
  }
});
