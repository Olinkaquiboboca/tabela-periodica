// ============================================================
// pdf.js — Geração do PDF A4 com as 4 imagens dos elementos
//
// Layout: 2 imagens por página, 2 páginas = 4 imagens totais.
// Cada imagem ocupa metade da página A4 (com margens).
//
// Correção de proporção: as imagens são redimensionadas com
// aspect-ratio fit (equivalente ao object-fit: contain do CSS),
// evitando achatamento independentemente das dimensões originais.
//
// Requisito do Cloudinary: CORS configurado para o domínio
// exato do GitHub Pages (não "*"). Sem isso, o fetch falha.
// ============================================================

async function generatePDF(elementNumbers, studentName, sessionCode) {
  if (!elementNumbers || elementNumbers.length !== 4) {
    throw new Error("São necessários exatamente 4 elementos para gerar o PDF.");
  }

  if (typeof window.jspdf?.jsPDF === "undefined") {
    throw new Error("jsPDF não está carregado. Verifique o CDN no HTML.");
  }

  const { jsPDF } = window.jspdf;

  // A4 portrait em mm
  const doc = new jsPDF({
    orientation: "portrait",
    unit:        "mm",
    format:      "a4",
  });

  const PAGE_W   = 210;
  const PAGE_H   = 297;
  const MARGIN   = 12;  // mm de margem lateral e entre células
  const FOOTER_H = 10;  // mm reservados para o rodapé

  // Célula de imagem: metade da página menos margens.
  // CELL_W × CELL_H define o bounding box máximo de cada imagem —
  // a imagem vai preencher o máximo possível desse espaço sem distorcer.
  const CELL_W = PAGE_W - 2 * MARGIN;
  const CELL_H = (PAGE_H - FOOTER_H - 3 * MARGIN) / 2;

  // Carrega todas as 4 imagens em paralelo antes de montar o PDF.
  // Promise.allSettled garante que o PDF é gerado mesmo se alguma
  // imagem falhar — o slot recebe um placeholder visual no lugar.
  const imageResults = await Promise.allSettled(
    elementNumbers.map(num => _loadImageAsDataURL(num))
  );

  // Monta o PDF: 2 páginas, 2 imagens por página
  for (let page = 0; page < 2; page++) {
    if (page > 0) doc.addPage();

    for (let slot = 0; slot < 2; slot++) {
      const idx    = page * 2 + slot;
      const result = imageResults[idx];

      // Posição do canto superior esquerdo da célula desta imagem
      const x = MARGIN;
      const y = MARGIN + slot * (CELL_H + MARGIN);

      if (result.status === "fulfilled" && result.value?.dataURL) {
        const { dataURL, format, naturalWidth, naturalHeight } = result.value;

        // ── Cálculo de proporção (aspect-ratio fit) ────────────
        // Queremos a maior imagem que caiba dentro de CELL_W × CELL_H
        // sem distorcer. A lógica é:
        //   1. Tenta preencher pela largura (drawH = CELL_W / ratio).
        //   2. Se a altura resultante não couber na célula,
        //      limita pela altura e recalcula a largura.
        // Isso é o equivalente exato do CSS: object-fit: contain.
        const ratio = naturalWidth / naturalHeight;
        let drawW = CELL_W;
        let drawH = CELL_W / ratio;

        if (drawH > CELL_H) {
          drawH = CELL_H;
          drawW = CELL_H * ratio;
        }

        // Centraliza a imagem dentro da célula em ambos os eixos,
        // distribuindo o espaço sobrante igualmente nos dois lados.
        const offsetX = x + (CELL_W - drawW) / 2;
        const offsetY = y + (CELL_H - drawH) / 2;

        doc.addImage(
          dataURL,
          format,
          offsetX, offsetY,  // posição centralizada
          drawW, drawH,       // dimensões respeitando proporção
          undefined,          // alias (não usado)
          "FAST"              // compressão
        );
      } else {
        // Placeholder para imagem que falhou ao carregar
        doc.setFillColor(20, 28, 46);
        doc.rect(x, y, CELL_W, CELL_H, "F");

        const el = ELEMENT_BY_NUMBER.get(elementNumbers[idx]);
        if (el) {
          doc.setFontSize(48);
          doc.setTextColor(80, 100, 140);
          doc.text(el.symbol, x + CELL_W / 2, y + CELL_H / 2 + 8, { align: "center" });
          doc.setFontSize(14);
          doc.text(el.name_pt, x + CELL_W / 2, y + CELL_H / 2 + 20, { align: "center" });
          doc.setFontSize(10);
          doc.text(`Nº ${el.number}`, x + CELL_W / 2, y + CELL_H / 2 + 28, { align: "center" });
        }

        doc.setTextColor(60, 80, 100);
        doc.setFontSize(8);
        doc.text("Imagem não disponível", x + CELL_W / 2, y + CELL_H - 6, { align: "center" });
      }
    }

    // Rodapé: nome do aluno + código de sessão + número da página
    doc.setFontSize(7);
    doc.setTextColor(120, 140, 160);
    doc.text(
      `${studentName}  ·  Sessão ${sessionCode}  ·  Página ${page + 1}/2`,
      PAGE_W / 2,
      PAGE_H - 4,
      { align: "center" }
    );
  }

  // Gera o blob e cria URL temporária para download
  const blob = doc.output("blob");
  const url  = URL.createObjectURL(blob);

  // Atualiza o link de download
  const link = document.getElementById("pdf-download-link");
  if (link) {
    link.href     = url;
    link.download = `elementos-${sessionCode}.pdf`;
  }

  // Libera a URL após 10 minutos para evitar memory leak
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);

  // Exibe a área de download
  document.getElementById("pdf-download-area")?.classList.remove("hidden");
  document.getElementById("conclude-confirm-area")?.classList.add("hidden");
}

// ── Carrega imagem como Data URL ──────────────────────────────
// Além do dataURL e do formato, agora retorna também as dimensões
// naturais da imagem (naturalWidth e naturalHeight), que são
// necessárias para o cálculo de proporção no PDF.
async function _loadImageAsDataURL(elementNumber) {
  // Busca a URL do Cloudinary no banco
  const { data, error } = await window._supabase
    .from("elements")
    .select("cloudinary_url")
    .eq("number", elementNumber)
    .single();

  if (error || !data?.cloudinary_url) {
    throw new Error(`Sem URL para elemento ${elementNumber}`);
  }

  const url = data.cloudinary_url;

  // Tenta carregar via fetch (requer CORS no Cloudinary)
  const res = await fetch(url, { mode: "cors" });

  if (!res.ok) {
    throw new Error(`Falha ao carregar imagem: HTTP ${res.status}`);
  }

  const blob    = await res.blob();
  const format  = blob.type.includes("png") ? "PNG" : "JPEG";
  const dataURL = await _blobToDataURL(blob);

  // Lê as dimensões reais decodificando a imagem num <img> temporário.
  // Isso é feito DEPOIS do fetch para não duplicar o download —
  // usamos o dataURL que já temos, sem ir ao Cloudinary de novo.
  const dims = await _getImageDimensions(dataURL);

  return { dataURL, format, naturalWidth: dims.w, naturalHeight: dims.h };
}

// ── Lê as dimensões naturais de uma imagem a partir do seu dataURL ──
// Cria um elemento <img> em memória (fora do DOM), aguarda o
// evento onload (que garante que as dimensões estão disponíveis),
// e resolve a Promise com { w, h }.
function _getImageDimensions(dataURL) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    img.onload  = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Falha ao ler dimensões da imagem"));
    img.src      = dataURL;
  });
}

// ── Converte Blob para Data URL via FileReader ────────────────
function _blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader     = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = () => reject(new Error("Falha na leitura do blob"));
    reader.readAsDataURL(blob);
  });
}
