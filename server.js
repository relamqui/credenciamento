const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');
const { convertToPdf, initPowerShellWorker } = require('./doc_to_pdf');
const Minio = require('minio');
const multer = require('multer');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const { Pool } = require('pg');

// Configuração do Pool PostgreSQL
const pgPool = new Pool({
    user: 'wpcrm_user',
    host: '148.230.77.81',
    database: 'eventossysten',
    password: 'TROQUE_POR_SENHA_FORTE',
    port: 8080,
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const minioClient = new Minio.Client({
    endPoint: 'teste-minio.ioms5g.easypanel.host',
    port: 443,
    useSSL: true,
    accessKey: 'hjUv0Th2gJcIp5j9Pwu9',
    secretKey: 'NGBVzf8CMKxLQ4Qv93OmgZCQFYzz6tRCr9HJkMvo'
});

function sanitizeFilename(str) {
    if (!str) return 'Indefinido';
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "_");
}

let currentSessionData = { nome: '', cpf: '', escola: '', nome_formando: '', template: '' };
let globalPcSocketId = null;
let isModalOpen = false;

// Configuração de Upload
const upload = multer({ dest: path.join(__dirname, 'templates_temp') });

// Cria pastas se não existirem
const templatesDir = path.join(__dirname, 'templates');
const tempDir = path.join(__dirname, 'templates_temp');
if (!fs.existsSync(templatesDir)) fs.mkdirSync(templatesDir);
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

// API para listar templates
app.get('/api/templates', (req, res) => {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.docx'));
    res.json(files);
});

// API para upload de templates DOCX
app.post('/api/upload-template', upload.single('template'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('Nenhum arquivo enviado.');
        
        let safeName = sanitizeFilename(path.parse(req.file.originalname).name);
        if (!safeName || safeName === 'Indefinido') safeName = `template_${Date.now()}`;
        
        const templatePath = path.join(templatesDir, `${safeName}.docx`);
        fs.renameSync(req.file.path, templatePath);
        
        res.send('Upload concluído com sucesso!');
    } catch (e) {
        console.error('Erro no upload:', e);
        res.status(500).send('Erro ao salvar template.');
    }
});

// Serve arquivos estáticos da pasta 'public'
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json());

// API: Listar todos os convidados agrupados por formando (de todas as tabelas de formatura)
app.get('/api/convidados', async (req, res) => {
    const client = await pgPool.connect();
    try {
        // Busca dinamicamente todas as tabelas que começam com 'formatura'
        const tablesResult = await client.query(`
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
            AND table_name ILIKE 'formatura%'
            ORDER BY table_name;
        `);

        const eventos = [];

        for (const tableRow of tablesResult.rows) {
            const tableName = tableRow.table_name;
            const eventName = tableName.replace(/^formatura\s*-?\s*/i, '').trim() || tableName;

            // Busca todos os registros da tabela
            const rows = await client.query(`SELECT * FROM "${tableName}" ORDER BY id`);

            // Separa formandos e convidados
            const formandos = rows.rows.filter(r => r.cargo === 'formando');
            const convidados = rows.rows.filter(r => r.cargo === 'convidado');

            // Agrupa: para cada formando, lista seus convidados
            const formandosComConvidados = formandos.map(formando => ({
                id: formando.id,
                nome: formando.nome,
                cpf: formando.documento,
                numero: formando.numero,
                escola: formando.escola,
                mesa: formando.mesa,
                status: formando.status,
                convidados: convidados.filter(c => c.cpf_formando === formando.documento).map(c => ({
                    id: c.id,
                    nome: c.nome,
                    documento: c.documento,
                    mesa: c.mesa,
                    status: c.status,
                    token: c.token,
                }))
            }));

            // Convidados sem formando vinculado
            const cpfsFormandos = new Set(formandos.map(f => f.documento));
            const convidadosSemFormando = convidados.filter(c => !cpfsFormandos.has(c.cpf_formando)).map(c => ({
                id: c.id,
                nome: c.nome,
                documento: c.documento,
                mesa: c.mesa,
                status: c.status,
                token: c.token,
            }));

            eventos.push({
                evento: eventName,
                tabela: tableName,
                totalFormandos: formandos.length,
                totalConvidados: convidados.length,
                formandos: formandosComConvidados,
                convidadosSemVinculo: convidadosSemFormando,
            });
        }

        res.json({ success: true, eventos });
    } catch (err) {
        console.error('Erro ao buscar convidados:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// API: Adicionar novo convidado
app.post('/api/convidados', async (req, res) => {
    const { tabela, nome, documento, cpf_formando, escola, numero } = req.body;
    if (!tabela || !nome || !documento || !cpf_formando) {
        return res.status(400).json({ success: false, error: 'Campos obrigatórios: tabela, nome, documento, cpf_formando' });
    }
    const client = await pgPool.connect();
    try {
        const result = await client.query(
            `INSERT INTO "${tabela}" (escola, nome, cargo, numero, documento, status, cpf_formando, "createdAt", "updatedAt")
             VALUES ($1, $2, 'convidado', $3, $4, 'nao_enviado', $5, NOW(), NOW()) RETURNING *`,
            [escola || '', nome, numero || '', documento, cpf_formando]
        );
        res.json({ success: true, convidado: result.rows[0] });
    } catch (err) {
        console.error('Erro ao adicionar convidado:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// API: Editar convidado (atualiza nome, documento e seta status = nao_enviado)
app.put('/api/convidados', async (req, res) => {
    const { tabela, id, nome, documento } = req.body;
    if (!tabela || !id || !nome || !documento) {
        return res.status(400).json({ success: false, error: 'Campos obrigatórios: tabela, id, nome, documento' });
    }
    const client = await pgPool.connect();
    try {
        const result = await client.query(
            `UPDATE "${tabela}" SET nome = $1, documento = $2, status = 'nao_enviado', "updatedAt" = NOW() WHERE id = $3 RETURNING *`,
            [nome, documento, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Convidado não encontrado' });
        res.json({ success: true, convidado: result.rows[0] });
    } catch (err) {
        console.error('Erro ao editar convidado:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// API: Excluir convidado
app.delete('/api/convidados', async (req, res) => {
    const { tabela, id } = req.body;
    if (!tabela || !id) {
        return res.status(400).json({ success: false, error: 'Campos obrigatórios: tabela, id' });
    }
    const client = await pgPool.connect();
    try {
        const result = await client.query(`DELETE FROM "${tabela}" WHERE id = $1`, [id]);
        if (result.rowCount === 0) return res.status(404).json({ success: false, error: 'Convidado não encontrado' });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir convidado:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Inicializar Worker do PowerShell Word COM logo na inicialização
initPowerShellWorker();


// Gerencia conexões via WebSockets (Socket.IO)
io.on('connection', (socket) => {
    console.log('Um usuário se conectou:', socket.id);
    
    // Informa o celular se o PC está pronto para receber assinatura
    socket.emit('modal_status', isModalOpen);

    socket.on('modal_opened', () => {
        isModalOpen = true;
        socket.broadcast.emit('modal_status', true);
    });

    socket.on('modal_closed', () => {
        isModalOpen = false;
        socket.broadcast.emit('modal_status', false);
    });

    // Recebe traços do celular e repassa para todos os clientes conectados (PC)
    socket.on('draw', (data) => {
        socket.broadcast.emit('draw', data);
    });

    // Recebe inicio de traço (para mover sem desenhar linha)
    socket.on('start_stroke', (data) => {
        socket.broadcast.emit('start_stroke', data);
    });

    // Recebe dados do formulario para o PDF
    socket.on('prepare_signature', (data) => {
        globalPcSocketId = socket.id;
        currentSessionData = data;
    });

    // Evento para limpar o canvas
    socket.on('clear', () => {
        socket.broadcast.emit('clear');
    });

    // Recebe assinatura finalizada (do celular)
    socket.on('signature_done', async (base64Image) => {
        try {
            socket.broadcast.emit('signature_done', base64Image);
            if (globalPcSocketId) {
                io.to(globalPcSocketId).emit('progress_step', 1);
            } else {
                socket.broadcast.emit('progress_step', 1);
            }

            console.log('Recebendo assinatura para gerar DOCX e PDF...');
            
            const templateName = currentSessionData.template;
            let docPath = path.join(__dirname, 'termo de responsabilidade.docx'); // default
            if (templateName) {
                const tPath = path.join(templatesDir, templateName);
                if (fs.existsSync(tPath)) docPath = tPath;
            }
            
            const content = fs.readFileSync(docPath, 'binary');
            const zip = new PizZip(content);
            let docXml = zip.file("word/document.xml").asText();
            docXml = docXml.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
            zip.file("word/document.xml", docXml);
            
            const base64Data = base64Image.replace(/^data:image\/png;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            
            const opts = {
                centered: false,
                getImage: (tagValue, tagName) => {
                    if(tagName === 'assinatura') return imageBuffer;
                    return null;
                },
                getSize: (img, tagValue, tagName) => {
                    if(tagName === 'assinatura') return [250, 60]; 
                    return [100, 100];
                }
            };
            const imageModule = new ImageModule(opts);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, modules: [imageModule] });
            
            const today = new Date();
            const day = String(today.getDate()).padStart(2, '0');
            
            doc.render({
                $dia: day,
                $nome: currentSessionData.nome || 'Nome não informado',
                $cpf: currentSessionData.cpf || 'CPF não informado',
                assinatura: "signature.png"
            });
            
            const buf = doc.getZip().generate({ type: 'nodebuffer' });
            
            const esc = sanitizeFilename(currentSessionData.escola);
            const resp = sanitizeFilename(currentSessionData.nome);
            const form = sanitizeFilename(currentSessionData.nome_formando);
            
            const baseName = `${esc}_${resp}_${form}`;
            const filenameDocx = `${baseName}_${Date.now()}.docx`;
            const docxSavePath = path.join(__dirname, 'documentos_assinados', filenameDocx);
            fs.writeFileSync(docxSavePath, buf);
            
            socket.emit('progress_step', 2); // para o celular
            if (globalPcSocketId) {
                io.to(globalPcSocketId).emit('progress_step', 2); // para o PC
            }
            
            const filenamePdf = filenameDocx.replace('.docx', '.pdf');
            const pdfSavePath = path.join(__dirname, 'documentos_assinados', filenamePdf);
            
            // --- Gera o PDF diretamente do HTML via Puppeteer (sem LibreOffice) ---
            console.log('Gerando PDF via Puppeteer (HTML)...');
            let htmlTemplatePath = path.join(__dirname, 'templates', 'termo_de_responsabilidade.html');
            let htmlContent = fs.readFileSync(htmlTemplatePath, 'utf8');
            htmlContent = htmlContent
                .replace(/\{\{\$dia\}\}/g, day)
                .replace(/\{\{\$nome\}\}/g, currentSessionData.nome || 'Nome não informado')
                .replace(/\{\{\$cpf\}\}/g, currentSessionData.cpf || 'CPF não informado')
                .replace(/\{%assinatura\}/g, `<img src="${base64Image}" style="max-height:80px; max-width:250px; display:block; margin:0 auto;">`);

            const browser = await puppeteer.launch({
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                headless: true
            });
            const page = await browser.newPage();
            await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
            await page.pdf({ path: pdfSavePath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
            await browser.close();
            console.log('PDF gerado com sucesso em:', pdfSavePath);

            // Upload para MinIO
            console.log('Enviando para o MinIO...');
            try {
                await minioClient.fPutObject('eventosdocs', filenamePdf, pdfSavePath, {
                    'Content-Type': 'application/pdf'
                });
                console.log('Upload para MinIO concluído com sucesso!');
            } catch (err) {
                console.error('Erro no upload para o MinIO:', err);
            }

            socket.emit('pdf_signed', filenamePdf); // celular
            if (globalPcSocketId) {
                io.to(globalPcSocketId).emit('pdf_signed', filenamePdf); // pc
            }

        } catch (error) {
            console.error('Erro ao gerar arquivo final:', error);
        }
    });

    // Gera o PDF de pré-visualização preenchido com dados mas sem assinatura
    socket.on('request_preview', async (data) => {
        try {
            console.log('Gerando PDF de pré-visualização...');
            const templateName = data.template;
            let docPath = path.join(__dirname, 'termo de responsabilidade.docx');
            if (templateName) {
                const tPath = path.join(templatesDir, templateName);
                if (fs.existsSync(tPath)) docPath = tPath;
            }
            
            const content = fs.readFileSync(docPath, 'binary');
            const zip = new PizZip(content);
            let docXml = zip.file("word/document.xml").asText();
            docXml = docXml.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
            zip.file("word/document.xml", docXml);

            const blankBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsQAAA7EAZUrDhsAAAANSURBVBhXY3jP4PgfAAWgA4FEz9yHAAAAAElFTkSuQmCC";
            const imageBuffer = Buffer.from(blankBase64, 'base64');
            const opts = {
                centered: false,
                getImage: (tagValue, tagName) => {
                    if(tagName === 'assinatura') return imageBuffer;
                    return null;
                },
                getSize: (img, tagValue, tagName) => {
                    if(tagName === 'assinatura') return [1, 1]; 
                    return [100, 100];
                }
            };
            const imageModule = new ImageModule(opts);
            const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, modules: [imageModule] });
            
            const today = new Date();
            const day = String(today.getDate()).padStart(2, '0');
            
            doc.render({
                $dia: day,
                $nome: data.nome || 'Nome não informado',
                $cpf: data.cpf || 'CPF não informado',
                assinatura: "signature.png"
            });

            const buf = doc.getZip().generate({ type: 'nodebuffer' });
            const filenameDocx = `preview_${Date.now()}.docx`;
            const docxSavePath = path.join(__dirname, 'public', filenameDocx);
            fs.writeFileSync(docxSavePath, buf);

            const filenamePdf = filenameDocx.replace('.docx', '.pdf');
            const pdfSavePath = path.join(__dirname, 'public', filenamePdf);
            
            await convertToPdf(docxSavePath, pdfSavePath).catch(err => {
                console.error("Erro na conversão preview:", err);
                throw err;
            });
            console.log('Pré-visualização gerada:', filenamePdf);
            
            setTimeout(() => {
                socket.emit('preview_ready', filenamePdf);
            }, 600);
            
            try { fs.unlinkSync(docxSavePath); } catch(e){}
        } catch (error) {
            console.error('Erro na pré-visualização:', error);
            socket.emit('preview_ready', 'termo_mra.pdf'); 
        }
    });

    socket.on('disconnect', () => {
        console.log('Usuário desconectado:', socket.id);
    });
});

const PORT = process.env.PORT || 3001;
const os = require('os');
const networkInterfaces = os.networkInterfaces();
let localIp = 'localhost';

// Encontrar o IP local da máquina
for (const interfaceName in networkInterfaces) {
    for (const net of networkInterfaces[interfaceName]) {
        if (net.family === 'IPv4' && !net.internal) {
            localIp = net.address;
            break;
        }
    }
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n==============================================`);
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`==============================================`);
    console.log(`Para acessar, utilize o domínio configurado no seu painel.`);
    console.log(`Página principal (PC):     /`);
    console.log(`Assinatura (Celular):      /assinatura.html`);
    console.log(`==============================================\n`);
});
