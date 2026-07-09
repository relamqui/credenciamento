const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

async function checkDocx() {
    const docPath = path.join(__dirname, 'termo de responsabilidade.docx');
    const content = fs.readFileSync(docPath);
    const zip = await JSZip.loadAsync(content);
    const docXml = await zip.file("word/document.xml").async("string");
    
    const cleanText = docXml.replace(/<[^>]+>/g, '');
    const indices = [...cleanText.matchAll(/\{\{/g)].map(a => a.index);
    for (let index of indices) {
        console.log(cleanText.substring(index - 10, index + 20));
    }
}

checkDocx();
