import { getDocument, GlobalWorkerOptions } from "../assets/pdfjs/pdf.js";

GlobalWorkerOptions.workerSrc = new URL("../assets/pdfjs/pdf.worker.js", import.meta.url).href;
const jobs = new WeakMap();

export function clear(container) {
  const job = jobs.get(container);
  if (job) {
    job.cancelled = true;
    if (job.renderTask) job.renderTask.cancel();
    if (job.loadingTask) job.loadingTask.destroy().catch(() => {});
    jobs.delete(container);
  }
  container.replaceChildren();
}

export async function render(container, url) {
  clear(container);
  const job = { cancelled: false };
  jobs.set(container, job);
  const status = document.createElement("p");
  status.className = "local-rules-loading";
  status.setAttribute("role", "status");
  status.textContent = "Cargando bases…";
  container.append(status);
  try {
    job.loadingTask = getDocument({
      url,
      cMapUrl: new URL("../assets/pdfjs/cmaps/", import.meta.url).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("../assets/pdfjs/standard_fonts/", import.meta.url).href,
      wasmUrl: new URL("../assets/pdfjs/wasm/", import.meta.url).href,
      isEvalSupported: false
    });
    const pdf = await job.loadingTask.promise;
    for (let number = 1; number <= pdf.numPages; number++) {
      if (job.cancelled) return;
      const page = await pdf.getPage(number);
      if (job.cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const width = Math.max(280, container.clientWidth - 32);
      const viewport = page.getViewport({ scale: Math.min(width / base.width, 1.6) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width * ratio);
      canvas.height = Math.ceil(viewport.height * ratio);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = "auto";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "Bases, página " + number + " de " + pdf.numPages);
      container.append(canvas);
      job.renderTask = page.render({
        canvas,
        canvasContext: canvas.getContext("2d"),
        viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0]
      });
      await job.renderTask.promise;
      if (job.cancelled) return;
      // El texto también queda disponible para lectores de pantalla.
      const text = await page.getTextContent();
      if (job.cancelled) return;
      const accessible = document.createElement("p");
      accessible.className = "local-rules-accessible";
      accessible.textContent = text.items.map(item => item.str || "").join(" ");
      container.append(accessible);
      status.textContent = "Cargando bases… " + number + " / " + pdf.numPages;
      page.cleanup();
    }
    status.remove();
  } catch (error) {
    if (!job.cancelled) status.textContent = "No se pudieron cargar las bases en este momento.";
  }
}
