// Teste rápido de conversão
const convertToPdf = require('./doc_to_pdf');
const path = require('path');
const fs = require('fs');

// Pegar o último docx gerado
const dir = path.join(__dirname, 'documentos_assinados');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.docx'));
if (files.length === 0) {
    console.log("Nenhum .docx encontrado em documentos_assinados/");
    process.exit(1);
}
files.sort();
const lastDocx = path.join(dir, files[files.length - 1]);
const pdfOut = lastDocx.replace('.docx', '_test.pdf');

console.log("Convertendo:", lastDocx);
console.log("Para:", pdfOut);

convertToPdf(lastDocx, pdfOut)
    .then(() => console.log("✅ Conversão concluída!"))
    .catch(e => console.error("❌ Erro:", e.message));
