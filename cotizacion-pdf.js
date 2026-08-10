/* =============================================================
   MÓDULO COMPARTIDO: Exportación de cotizaciones a PDF
   Usado por cotizador.html (script.js) y cotizaciones.html
   (cotizaciones.js). Genera el PDF renderizando el contenedor HTML
   con html2canvas + jsPDF (NO usa window.print), y lo sube al bucket
   público "cotizaciones-pdf" de Supabase Storage, guardando la URL en
   la columna "pdf_url" de la fila correspondiente en "cotizaciones".

   Por qué NO usar window.print(): el diálogo de impresión del
   navegador depende del motor de impresión de cada dispositivo (en
   iPhone/Safari corta encabezados y repite mal los saltos de página).
   Al renderizar el contenido a un lienzo (canvas) con un ancho fijo
   dentro de un contenedor clonado fuera de pantalla, el resultado es
   idéntico sin importar el dispositivo desde el que se exporte.
   ============================================================= */
window.CotizacionPDF = (function () {
  const PDF_BUCKET = 'cotizaciones-pdf';

  function librariesReady() {
    return typeof window.html2canvas === 'function' && !!(window.jspdf && window.jspdf.jsPDF);
  }

  // Clona el elemento fuente dentro de un contenedor fijo, fuera de
  // pantalla, con un ancho constante (por defecto 800px). Esto es lo
  // que garantiza que el PDF se vea igual en cualquier dispositivo.
  function crearCloneFueraDePantalla(sourceEl, width) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.top = '0';
    wrapper.style.left = '-10000px';
    wrapper.style.top = '0';
    wrapper.style.width = width + 'px';
    wrapper.style.background = '#ffffff';
    wrapper.style.zIndex = '-1';
    wrapper.style.padding = '24px';
    wrapper.style.boxSizing = 'border-box';

    const clone = sourceEl.cloneNode(true);
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    clone.style.width = '100%';
    clone.style.display = 'block';

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    return wrapper;
  }

  async function elementoAPdfBlob(sourceEl, { width = 800, scale = 2 } = {}) {
    if (!librariesReady()) {
      throw new Error('No se pudieron cargar las librerías de exportación (html2canvas / jsPDF).');
    }
    const wrapper = crearCloneFueraDePantalla(sourceEl, width);
    try {
      // Pequeña espera para que las imágenes (logos) dentro del clon terminen de cargar.
      const imgs = Array.from(wrapper.querySelectorAll('img'));
      await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => {
        img.addEventListener('load', res, { once: true });
        img.addEventListener('error', res, { once: true });
      }))));

      const canvas = await window.html2canvas(wrapper, {
        scale,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: width,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      return pdf.output('blob');
    } finally {
      wrapper.remove();
    }
  }

  function descargarBlob(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }

  function slugify(text) {
    return String(text || 'cotizacion')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'cotizacion';
  }

  // Genera el PDF a partir de sourceEl, lo sube a Storage (sobrescribiendo
  // el PDF anterior de esa misma cotización, upsert:true) y guarda la URL
  // pública en cotizaciones.pdf_url. También dispara la descarga local.
  async function exportarCotizacionPDF({ sourceEl, supabaseClient, cotizacionId, nombreArchivo, onStatus }) {
    if (!sourceEl) throw new Error('No hay contenido para exportar.');
    if (!cotizacionId) throw new Error('La cotización debe estar guardada antes de exportar a PDF.');
    if (!supabaseClient) throw new Error('No se pudo conectar con Supabase.');

    onStatus && onStatus('Generando PDF...');
    const blob = await elementoAPdfBlob(sourceEl);

    onStatus && onStatus('Subiendo documento...');
    const path = `${cotizacionId}.pdf`;
    const { error: uploadError } = await supabaseClient
      .storage
      .from(PDF_BUCKET)
      .upload(path, blob, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabaseClient.storage.from(PDF_BUCKET).getPublicUrl(path);
    const publicUrl = urlData ? urlData.publicUrl : null;

    if (publicUrl) {
      const { error: updateError } = await supabaseClient
        .from('cotizaciones')
        .update({ pdf_url: publicUrl, fecha_pdf_generado: new Date().toISOString() })
        .eq('id', cotizacionId);
      if (updateError) console.warn('No se pudo guardar la URL del PDF en la cotización:', updateError);
    }

    onStatus && onStatus('Descargando...');
    descargarBlob(blob, slugify(nombreArchivo));

    return { publicUrl };
  }

  return { exportarCotizacionPDF, PDF_BUCKET, slugify };
})();
