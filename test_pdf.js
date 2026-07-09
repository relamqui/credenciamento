const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');
const path = require('path');

async function testPdf() {
    const pdfPath = path.join(__dirname, 'termo de responsabilidade.pdf');
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1]; // Page 3
    const { width, height } = lastPage.getSize();
    console.log(`Page size: ${width} x ${height}`);

    lastPage.drawText("18", {
        x: 215,
        y: height - 460, // Ajustado
        size: 14,
        color: rgb(0, 0, 0),
    });

    lastPage.drawText("João da Silva", {
        x: width / 2 - 100, 
        y: height - 745, // Ajustado
        size: 14,
        color: rgb(0, 0, 0),
    });

    const finalPdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(__dirname, 'teste_coordenadas.pdf'), finalPdfBytes);
    console.log("Salvo teste_coordenadas.pdf");
}

testPdf();
