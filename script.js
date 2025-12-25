const { PDFDocument, degrees } = PDFLib;
let originalPdfBytes = null;
let debounceTimer = null;

// --- 1. Event Listeners ---

document.getElementById('uploadInput').addEventListener('change', async function(e) {
    if (e.target.files.length > 0) {
        const file = e.target.files[0];
        document.getElementById('fileName').innerText = file.name;
        originalPdfBytes = await file.arrayBuffer();
        
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('pdfPreview').classList.remove('hidden');
        
        triggerUpdate(0);
    }
});

document.querySelectorAll('.input-text').forEach(input => {
    input.addEventListener('input', () => triggerUpdate(800));
});

document.querySelectorAll('.input-slider').forEach(input => {
    input.addEventListener('input', () => {
        if(input.id === 'opacity') document.getElementById('opacityVal').innerText = Math.round(input.value * 100) + '%';
        if(input.id === 'xOffset') document.getElementById('xValDisplay').innerText = input.value;
        if(input.id === 'yOffset') document.getElementById('yValDisplay').innerText = input.value;
        triggerUpdate(150);
    });
});

document.getElementById('downloadBtn').addEventListener('click', downloadPDF);

// --- 2. Logic Functions ---

function triggerUpdate(delayMs) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(updatePreview, delayMs);
}

function textToImageBytes(text, fontSize, colorHex) {
    const scale = 3; 
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontStr = `${fontSize * scale}px 'Sarabun', sans-serif`;

    ctx.font = fontStr;
    const textMetrics = ctx.measureText(text);
    const textWidth = Math.ceil(textMetrics.width);
    const textHeight = Math.ceil(fontSize * scale * 1.5);
    
    // Padding: พอประมาณให้ข้อความไม่ตกขอบ
    const padding = Math.max(textWidth, textHeight) * 0.5; 
    const canvasWidth = textWidth + (padding * 2); 
    const canvasHeight = textHeight + (padding * 2);

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.font = fontStr;
    ctx.fillStyle = colorHex;
    ctx.textAlign = "center";   
    ctx.textBaseline = "middle"; 
    
    ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    return { 
        bytes, 
        width: canvasWidth / scale, 
        height: canvasHeight / scale 
    };
}

async function generateWatermarkedPDF() {
    if (!originalPdfBytes) return null;

    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    
    const text = document.getElementById('watermarkText').value;
    const colorHex = document.getElementById('textColor').value;
    const opacity = parseFloat(document.getElementById('opacity').value);
    const size = parseInt(document.getElementById('textSize').value);
    const rotateAngle = parseInt(document.getElementById('rotate').value); // Angle in degrees
    const xOff = parseInt(document.getElementById('xOffset').value);
    const yOff = parseInt(document.getElementById('yOffset').value);

    // Generate Image
    const { bytes: imageBytes, width: imgW, height: imgH } = textToImageBytes(text, size, colorHex);
    const pngImage = await pdfDoc.embedPng(imageBytes);

    const pages = pdfDoc.getPages();
    pages.forEach(page => {
        const { width, height } = page.getSize();
        
        // --- FIXED: ROTATION LOGIC ---
        // 1. เป้าหมาย: จุดที่เราอยากให้ "กลางภาพ" ไปอยู่ (Center of Page + Offset)
        const targetCenterX = (width / 2) + xOff;
        const targetCenterY = (height / 2) + yOff;

        // 2. แปลงองศาเป็น Radian (pdf-lib หมุนตามเข็มนาฬิกาเป็นบวก)
        const rad = rotateAngle * (Math.PI / 180);

        // 3. คำนวณเวกเตอร์จาก "มุมซ้ายล่างของภาพ" ไปหา "จุดกึ่งกลางภาพ"
        // (ปกติคือ imgW/2, imgH/2 แต่ต้องหมุนเวกเตอร์นี้ตามองศาด้วย)
        // สูตร Rotation Matrix:
        // x' = x cos θ - y sin θ
        // y' = x sin θ + y cos θ
        
        const halfW = imgW / 2;
        const halfH = imgH / 2;

        // คำนวณ Offset ที่เกิดจากการหมุน (Rotated Vector from origin to center)
        const rotatedCmdX = (halfW * Math.cos(rad)) - (halfH * Math.sin(rad));
        const rotatedCmdY = (halfW * Math.sin(rad)) + (halfH * Math.cos(rad));

        // 4. หาจุดวาด (Draw Coordinates)
        // จุดวาด (มุมซ้ายล่าง) = จุดเป้าหมาย - เวกเตอร์ที่หมุนแล้ว
        const drawX = targetCenterX - rotatedCmdX;
        const drawY = targetCenterY - rotatedCmdY;

        page.drawImage(pngImage, {
            x: drawX,
            y: drawY,
            width: imgW,
            height: imgH,
            opacity: opacity,
            rotate: degrees(rotateAngle), // pdf-lib handles the visual rotation around drawX, drawY
        });
    });

    return await pdfDoc.save();
}

async function updatePreview() {
    if (!originalPdfBytes) return;

    const loading = document.getElementById('loading');
    loading.classList.remove('hidden');

    try {
        const pdfBytes = await generateWatermarkedPDF();
        if (pdfBytes) {
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            
            const iframe = document.getElementById('pdfPreview');
            if (iframe.src.startsWith('blob:')) {
                URL.revokeObjectURL(iframe.src);
            }
            
            iframe.src = URL.createObjectURL(blob);
        }
    } catch (e) {
        console.error("Preview Error:", e);
    } finally {
        loading.classList.add('hidden');
    }
}

async function downloadPDF() {
    const btn = document.getElementById('downloadBtn');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const pdfBytes = await generateWatermarkedPDF();
        if (!pdfBytes) return alert("Please upload a PDF first");

        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Signed_${Date.now()}.pdf`;
        link.click();
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}