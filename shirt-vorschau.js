(() => {
  const data = document.getElementById('shirt-preview-data');
  const link = document.getElementById('shirt-preview-link');
  if (!data || !link) return;
  const slides = JSON.parse(data.textContent);
  const image = document.getElementById('shirt-preview-image');
  const caption = document.getElementById('shirt-preview-caption');
  const counter = document.getElementById('shirt-counter');
  const pause = document.getElementById('shirt-pause');
  const figure = document.getElementById('beispiele');
  let index = 0;
  let paused = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(next) {
    index = (next + slides.length) % slides.length;
    const slide = slides[index];
    link.href = slide.original;
    link.dataset.caption = slide.caption;
    image.src = slide.preview;
    image.alt = slide.alt;
    caption.textContent = `${slide.caption} · Zum Vergrössern anklicken ↗`;
    counter.textContent = `${index + 1} / ${slides.length}`;
  }
  function updatePause() {
    pause.textContent = paused ? 'Start' : 'Pause';
    pause.setAttribute('aria-pressed', String(paused));
  }
  slides.forEach(slide => { const preload = new Image(); preload.src = slide.preview; });
  figure.querySelector('.slideshow-controls').hidden = false;
  document.getElementById('shirt-prev').addEventListener('click', () => show(index - 1));
  document.getElementById('shirt-next').addEventListener('click', () => show(index + 1));
  pause.addEventListener('click', () => { paused = !paused; updatePause(); });
  window.setInterval(() => {
    const dialog = document.getElementById('bild-dialog');
    if (!paused && !document.hidden && !dialog?.open && !figure.contains(document.activeElement)) show(index + 1);
  }, 3000);
  updatePause();
})();
