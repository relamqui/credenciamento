const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const ImageModule = require('docxtemplater-image-module-free');

try {
    const docPath = require('path').join(__dirname, 'termo de responsabilidade.docx');
    const content = fs.readFileSync(docPath, 'binary');
    const zip = new PizZip(content);
    
    let docXml = zip.file("word/document.xml").asText();
    // Converter chaves duplas para chaves simples!
    docXml = docXml.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
    zip.file("word/document.xml", docXml);
    
    const imageModule = new ImageModule({
        centered: false,
        getImage: (tagValue, tagName) => { return Buffer.alloc(10); },
        getSize: () => [100, 100]
    });
    
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        modules: [imageModule]
    });
    
    doc.render({
        $dia: "10",
        $nome: "Teste",
        $cpf: "123",
        assinatura: "none"
    });
    
    console.log("Compilou e renderizou com sucesso!");
} catch(e) {
    console.log("Erro:");
    if (e.properties && e.properties.errors) {
        e.properties.errors.forEach(err => console.log(err));
    } else {
        console.log(e);
    }
}
