const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function checkDocx() {
    const docPath = path.join(__dirname, 'termo de responsabilidade.docx');
    const content = fs.readFileSync(docPath);
    const zip = await JSZip.loadAsync(content);
    const docXml = await zip.file("word/document.xml").async("string");
    
    const cleanText = docXml.replace(/<[^>]+>/g, '');
    const index = cleanText.toLowerCase().indexOf('assinatura');
    if (index !== -1) {
        console.log("Found assinatura:", cleanText.substring(Math.max(0, index - 20), index + 40));
    } else {
        console.log("Assinatura not found");
    }
}

checkDocx();
