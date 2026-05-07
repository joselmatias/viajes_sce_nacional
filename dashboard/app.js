// UI wiring — sidebar, timeline, modal, clock
(function() {
  const list     = document.getElementById('country-list');
  const timeline = document.getElementById('timeline');
  const modal    = document.getElementById('modal-backdrop');
  const clockEl  = document.getElementById('clock');

  let currentIdx = 0;
  let filter = 'all';

  // ---- Clock ----
  function tick() {
    const d = new Date();
    clockEl.textContent =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }
  tick(); setInterval(tick, 1000);

  // ---- Icon Ecuador flag (replaces country flags) ----
  function renderFlag(visit, size = { w: 32, h: 22 }) {
    const { type } = visit.flag;
    const w = size.w, h = size.h;
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.style.display = 'block';

    function rect(x, y, ww, hh, f) {
      const r = document.createElementNS(svgNS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', y);
      r.setAttribute('width', ww); r.setAttribute('height', hh);
      r.setAttribute('fill', f);
      svg.appendChild(r);
    }

    // Bandera del Ecuador: amarillo (mitad) / azul (1/4) / rojo (1/4)
    if (type === 'ecuador') {
      rect(0, 0,       w, h / 2,   '#FFD100');
      rect(0, h / 2,   w, h / 4,   '#003DA5');
      rect(0, h * 3/4, w, h / 4,   '#C8102E');
    }
    return svg;
  }

  // ---- Filtros ----
  document.querySelectorAll('.filter-row button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.filter-row button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      filter = b.dataset.filter;
      renderList();
    });
  });

  function matchesFilter(v) {
    if (filter === 'all')          return true;
    if (filter === 'cooperacion')  return /cooperación/i.test(v.type);
    if (filter === 'territorial')  return /convenio|reunión|sesión|congreso|jornada|foro/i.test(v.type);
    if (filter === 'rendicion')    return /rendición/i.test(v.type);
    return true;
  }

  // ---- Lista de recorridos ----
  function renderList() {
    list.innerHTML = '';
    const items = window.VISITS.filter(matchesFilter);
    items.forEach((v) => {
      const globalIdx = window.VISITS.indexOf(v);
      const row = document.createElement('div');
      row.className = 'country-row';
      row.dataset.code = v.code;
      row.innerHTML = `
        <div class="flag"></div>
        <div class="info">
          <div class="name">${v.name}</div>
          <div class="sub">${v.province.toUpperCase()} · ${v.dateLong}</div>
        </div>
        <div class="idx">N° ${String(globalIdx + 1).padStart(2, '0')}</div>
      `;
      row.querySelector('.flag').appendChild(renderFlag(v, { w: 32, h: 22 }));
      row.addEventListener('click', () => {
        document.querySelectorAll('.country-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        focusVisit(v.code);
        setTimeout(() => openModal(globalIdx), 500);
      });
      row.addEventListener('mouseenter', () => {
        focusVisit(v.code);
        if (!v.isOrigin) {
          window.dispatchEvent(new CustomEvent('plane:launch', { detail: v.code }));
        }
      });
      list.appendChild(row);
    });
  }

  // ---- Timeline ----
  function renderTimeline() {
    timeline.innerHTML = '';
    const sorted = [...window.VISITS].sort((a, b) => b.date.localeCompare(a.date));
    sorted.forEach(v => {
      const item = document.createElement('div');
      item.className = 'tl-item';
      item.innerHTML = `
        <div class="tl-date">${v.dateLong}</div>
        <div class="tl-body">
          <div class="t"><em>${v.capital}</em> · ${v.province}</div>
          <div class="sub">${stripHtml(v.event)}</div>
        </div>
      `;
      item.addEventListener('click', () => openModal(window.VISITS.indexOf(v)));
      item.style.cursor = 'pointer';
      timeline.appendChild(item);
    });
  }
  function stripHtml(s) { return s ? s.replace(/<[^>]+>/g, '') : ''; }

  function focusVisit(code) {
    window.dispatchEvent(new CustomEvent('visit:focus', { detail: code }));
  }

  // ---- Modal ----
  function openModal(idx) {
    if (idx < 0) return;
    currentIdx = idx;
    const v = window.VISITS[idx];
    document.getElementById('m-title').innerHTML = `${v.capital} · <em>${v.province}</em>`;
    document.getElementById('m-kick').textContent = `${v.dateLong} · ${v.organizer.toUpperCase()}`;
    document.getElementById('m-expediente').textContent = v.expediente;
    document.getElementById('m-brief').innerHTML = v.brief;
    document.getElementById('m-event').innerHTML = v.eventLong;
    document.getElementById('m-organizer').textContent = v.organizer;
    document.getElementById('m-s1').textContent = v.stats.dias;
    document.getElementById('m-s3').textContent = v.stats.distancia.toLocaleString();

    const photoSection = document.querySelector('.m-photo');
    if (v.photo) {
      photoSection.style.display = '';
      document.getElementById('m-photo-img').src = v.photo;
      document.getElementById('m-photo-cap').textContent = `${v.capital} · ${v.dateLong}`;
    } else {
      photoSection.style.display = 'none';
    }

    const flagEl = document.getElementById('m-flag');
    flagEl.innerHTML = '';
    flagEl.appendChild(renderFlag(v, { w: 80, h: 54 }));
    modal.classList.add('open');
    focusVisit(v.code);
  }

  document.getElementById('modal-close').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (modal.classList.contains('open')) {
      if (e.key === 'ArrowRight') navigate(1);
      if (e.key === 'ArrowLeft')  navigate(-1);
    }
  });
  document.getElementById('m-next').addEventListener('click', () => navigate(1));
  document.getElementById('m-prev').addEventListener('click', () => navigate(-1));

  function navigate(dir) {
    currentIdx = (currentIdx + dir + window.VISITS.length) % window.VISITS.length;
    openModal(currentIdx);
  }
  function closeModal() {
    modal.classList.remove('open');
    window.dispatchEvent(new Event('visit:resetview'));
  }

  window.addEventListener('visit:selected', (e) => {
    openModal(window.VISITS.findIndex(v => v.code === e.detail));
  });

  renderList();
  renderTimeline();
})();
