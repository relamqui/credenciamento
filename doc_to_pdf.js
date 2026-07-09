const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

let psProcess = null;
let commandQueue = [];
let isProcessing = false;

function initPowerShellWorker() {
    if (psProcess) return;
    
    if (os.platform() !== 'win32') return;

    console.log('[WordCOM] Iniciando instância persistente do Microsoft Word...');
    
    const psScript = `
$ErrorActionPreference = "Stop"
try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    Write-Host "WORD_READY"
} catch {
    Write-Host "WORD_ERROR: $_"
    exit
}

while ($true) {
    $line = [Console]::ReadLine()
    if ($line -eq "EXIT") { break }
    if ($line -match "^(.+)\\|(.+)$") {
        $docxPath = $matches[1]
        $pdfPath = $matches[2]
        try {
            $doc = $word.Documents.Open($docxPath, $false, $true)
            $doc.SaveAs([ref] $pdfPath, [ref] 17)
            $doc.Close($false)
            Write-Host "SUCCESS"
        } catch {
            Write-Host "ERROR: $_"
        }
    }
}
try {
    $word.Quit()
} catch {}
`;
    
    const psPath = path.join(os.tmpdir(), 'word_worker.ps1');
    fs.writeFileSync(psPath, psScript, 'utf8');

    psProcess = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psPath]);

    psProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').map(l => l.trim()).filter(l => l.length > 0);
        for (let line of lines) {
            if (line === 'WORD_READY') {
                console.log('[WordCOM] Word inicializado e pronto para conversões ultra-rápidas!');
            } else if (line === 'SUCCESS') {
                if (commandQueue.length > 0) {
                    const req = commandQueue.shift();
                    req.resolve(req.pdfPath);
                    processNext();
                }
            } else if (line.startsWith('ERROR:')) {
                if (commandQueue.length > 0) {
                    const req = commandQueue.shift();
                    req.reject(new Error(line));
                    processNext();
                }
            } else if (line.startsWith('WORD_ERROR:')) {
                console.error('[WordCOM] Erro fatal:', line);
            }
        }
    });

    psProcess.stderr.on('data', (data) => {
        console.error(`[WordCOM] stderr: ${data}`);
    });

    psProcess.on('close', (code) => {
        console.log(`[WordCOM] Processo encerrado com código ${code}`);
        psProcess = null;
    });
}

function processNext() {
    if (commandQueue.length === 0) {
        isProcessing = false;
        return;
    }
    isProcessing = true;
    const req = commandQueue[0];
    const cmd = `${req.docxPath}|${req.pdfPath}\n`;
    psProcess.stdin.write(cmd);
}

function convertToPdf(docxPath, pdfPath) {
    return new Promise((resolve, reject) => {
        if (os.platform() === 'win32') {
            if (!psProcess) {
                initPowerShellWorker();
            }
            
            commandQueue.push({ docxPath, pdfPath, resolve, reject });
            if (!isProcessing) {
                processNext();
            }
            
            setTimeout(() => {
                const idx = commandQueue.findIndex(r => r.resolve === resolve);
                if (idx !== -1) {
                    commandQueue.splice(idx, 1);
                    reject(new Error("Timeout: Conversão demorou mais de 25 segundos."));
                    
                    if (idx === 0 && psProcess) {
                        // O processo atual travou. Precisamos matá-lo para não corromper a fila
                        psProcess.kill();
                        psProcess = null;
                        isProcessing = false;
                        initPowerShellWorker();
                    } else {
                        processNext();
                    }
                }
            }, 25000);

        } else {
            const { exec } = require('child_process');
            const tmpOutDir = os.tmpdir();
            const cmd = `soffice --headless --invisible --nologo --nodefault --nofirststartwizard --norestore "-env:UserInstallation=file:///tmp/LibreOffice_Conversion_${Date.now()}" --convert-to pdf "${docxPath}" --outdir "${tmpOutDir}"`;
            
            exec(cmd, { timeout: 90000 }, (error, stdout) => {
                if (error) {
                    console.error("Erro via LibreOffice:", error);
                    return reject(error);
                }
                const generatedPdfPath = path.join(tmpOutDir, path.basename(docxPath, '.docx') + '.pdf');
                try {
                    if (fs.existsSync(generatedPdfPath)) {
                        fs.copyFileSync(generatedPdfPath, pdfPath);
                        fs.unlinkSync(generatedPdfPath);
                        resolve(pdfPath);
                    } else {
                        reject(new Error("LibreOffice completou sem erro, mas o PDF não foi encontrado em " + generatedPdfPath));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }
    });
}

module.exports = { convertToPdf, initPowerShellWorker };
