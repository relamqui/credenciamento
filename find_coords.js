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
    
    // Draw ruler
    for(let y = 100; y < height; y += 50) {
        lastPage.drawLine({
            start: { x: 0, y },
            end: { x: width, y },
            thickness: 1,
            color: rgb(1, 0, 0)
        });
        lastPage.drawText(`y=${y}`, {
            x: 10, y: y + 2, size: 10, color: rgb(1,0,0)
        });
    }

    const finalPdfBytes = await pdfDoc.save();
    fs.writeFileSync(path.join(__dirname, 'public', 'ruler.pdf'), finalPdfBytes);
    console.log("Ruler PDF saved.");
}

testPdf();
