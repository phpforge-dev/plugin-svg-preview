import { bindImagePointer, clampZoom, fittedScale, svgBox, zoomAnchor } from './zoom';

export function activate(sdk: any) {
  const { tr, editorPreviewLayout, own } = sdk;
  const controller = mountSvgPreview(sdk.host.editor, sdk.host, sdk.api, { tr, editorPreviewLayout, own });
  sdk.provide('svgPreview', controller);
  return controller;
}

type Mode = 'editor' | 'split' | 'preview';

/** Serialized XML is rendered only as an image; it is never inserted into the IDE DOM. */
export function svgImageSource(text: string): string {
  if (text.length > 2 * 1024 * 1024) throw Error('SVG acima de 2 MiB.');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) throw Error('Declarações de entidades XML não são exibidas na prévia.');
  const source = text.replace(/<!DOCTYPE[^>]*>/gi, '');
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (!root || root.localName !== 'svg' || document.querySelector('parsererror')) throw Error('SVG inválido. Corrija o XML para atualizar a imagem.');
  if (root.namespaceURI && root.namespaceURI !== 'http://www.w3.org/2000/svg') throw Error('O documento não contém um elemento SVG válido.');
  if (!root.namespaceURI) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
}

function mountSvgPreview(editor: any, hooks: { path(): string | undefined; open?(path: string): Promise<void> }, api: any, sdk: { tr: (s: string) => string; editorPreviewLayout: (editor: any) => any; own: (value: any) => void }) {
  const { tr, editorPreviewLayout, own } = sdk;
  const isSvgPath = (path: string) => /\.svg$/i.test(path);
  const shared = editorPreviewLayout(editor);
  let mode: Mode = 'split';
  try {
    const saved = localStorage.getItem('php-ide-svg-mode');
    if (saved === 'editor' || saved === 'split' || saved === 'preview') mode = saved;
  } catch { /* Preference storage can be unavailable. */ }
  const active = () => { const path = hooks.path(); return !!path && isSvgPath(path) && !!editor.getModel(); };
  const bar = document.createElement('div');
  bar.id = 'svg-toolbar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', tr('Layout SVG'));
  bar.hidden = true;
  const modes: [Mode, string][] = [['editor', 'Fonte'], ['split', 'Fonte e imagem'], ['preview', 'Imagem']];
  const modeButtons = modes.map(([id, label]) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.dataset.mode = id;
    control.textContent = tr(label);
    control.title = tr(label) + ' · ⌘/Ctrl+Shift+V';
    control.setAttribute('aria-label', tr(label));
    control.onclick = () => setMode(id);
    return control;
  });
  bar.append(...modeButtons);
  document.getElementById('navigation')!.prepend(bar);
  const view = createSvgView(tr, { step, showSource: () => setMode('split') });
  const { preview, viewport, paint, setZoom, toggleFit, resetView, error, placeImage } = view;
  let generation = 0, timer: ReturnType<typeof setTimeout> | undefined, rendered = '', currentPath = '', siblings: string[] = [];

  function layout() {
    shared.update();
    modeButtons.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.mode === mode)));
    if (active()) paint();
  }
  function setMode(next: Mode) {
    mode = next;
    try { localStorage.setItem('php-ide-svg-mode', mode); } catch { /* Keep the choice for this session. */ }
    layout();
    render();
    if (mode === 'preview') viewport.focus();
    else editor.focus();
  }
  function render() {
    if (!active() || mode === 'editor') return;
    const model = editor.getModel()!;
    const key = model.uri.toString() + '\0' + model.getVersionId();
    if (key === rendered) return;
    rendered = key;
    const token = ++generation;
    const version = model.getVersionId();
    const text = model.getValue();
    let source: string;
    try { source = svgImageSource(text); } catch (reason) { error(tr((reason as Error).message)); return; }
    const next = new Image();
    next.alt = tr('Imagem SVG renderizada');
    next.draggable = false;
    next.decoding = 'sync';
    next.onload = () => {
      if (token !== generation || !active() || editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version) return;
      const box = next.naturalWidth > 0 && next.naturalHeight > 0 ? { width: next.naturalWidth, height: next.naturalHeight } : svgBox(text);
      if (!box) { error(tr('Não foi possível renderizar este SVG. Revise o fonte.')); return; }
      placeImage(next, box.width, box.height, version);
      document.defaultView?.requestAnimationFrame?.(() => { if (token === generation) paint(); });
    };
    next.onerror = () => { if (token === generation) error(tr('Não foi possível renderizar este SVG. Revise o fonte.')); };
    placeImage(undefined, 0, 0);
    preview.dataset.state = 'loading';
    next.src = source;
  }
  async function listSiblings(path: string) {
    siblings = [];
    view.setSiblings(false, false);
    if (typeof api?.tree !== 'function') return;
    try {
      const slash = path.lastIndexOf('/');
      const entries = await api.tree(slash < 0 ? '' : path.slice(0, slash));
      if (hooks.path() !== path) return;
      siblings = entries.filter((entry: { directory?: boolean; path: string }) => !entry.directory && isSvgPath(entry.path)).map((entry: { path: string }) => entry.path).sort((a: string, b: string) => a.localeCompare(b));
    } catch { siblings = [path]; }
    const index = siblings.indexOf(path);
    view.setSiblings(index > 0, index >= 0 && index < siblings.length - 1);
  }
  function step(direction: number) {
    const index = siblings.indexOf(hooks.path() ?? '');
    const target = index >= 0 ? siblings[index + direction] : undefined;
    if (target && hooks.open) void hooks.open(target);
  }
  own(shared.register({ active, mode: () => mode, preview, toolbar: bar }));
  own(editor.onDidChangeModel(() => {
    generation++;
    clearTimeout(timer);
    rendered = '';
    if (currentPath !== hooks.path()) { currentPath = hooks.path() ?? ''; resetView(); void listSiblings(currentPath); }
    layout();
    if (active()) render();
  }));
  own(editor.onDidChangeModelContent(() => { if (!active()) return; clearTimeout(timer); timer = setTimeout(render, 120); }));
  const observer = new ResizeObserver(() => { if (active()) paint(); });
  observer.observe(viewport);
  own(() => observer.disconnect());
  const keydown = (event: KeyboardEvent) => {
    if (!active() || !(event.metaKey || event.ctrlKey) || !event.shiftKey || event.code !== 'KeyV') return;
    event.preventDefault();
    event.stopPropagation();
    setMode(modes[(modes.findIndex(([id]) => id === mode) + 1) % modes.length][0]);
  };
  document.addEventListener('keydown', keydown, true);
  own(() => document.removeEventListener('keydown', keydown, true));
  viewport.onkeydown = event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
  };
  bindImagePointer(viewport, {
    zoomBy: (factor, x, y) => setZoom(factor, { x, y }),
    toggleFit: () => toggleFit(),
  }, cleanup => own(cleanup));
  own(() => { generation++; clearTimeout(timer); viewport.onkeydown = null; });
  layout();
  if (active()) { void listSiblings(hooks.path() ?? ''); render(); }
  return { setMode };
}

function createSvgView(tr: (text: string) => string, actions: { step(direction: number): void; showSource(): void }) {
  const preview = document.createElement('section');
  preview.id = 'svg-preview';
  preview.setAttribute('aria-label', tr('Prévia SVG'));
  preview.hidden = true;
  const tools = document.createElement('div');
  tools.className = 'svg-preview-tools';
  const button = (text: string, label: string, action: () => void) => {
    const control = document.createElement('button');
    control.type = 'button';
    control.textContent = text;
    control.title = tr(label);
    control.setAttribute('aria-label', tr(label));
    control.onclick = action;
    return control;
  };
  let fit = true, scale = 1, width = 0, height = 0, image: HTMLImageElement | undefined, showGrid = false;
  const zoomOut = button('−', 'Diminuir zoom', () => setZoom(1 / 1.25));
  zoomOut.id = 'svg-zoom-out';
  const zoomIn = button('+', 'Aumentar zoom', () => setZoom(1.25));
  zoomIn.id = 'svg-zoom-in';
  const fitButton = button(tr('Ajustar'), 'Ajustar imagem à área', () => { fit = true; paint(); });
  fitButton.id = 'svg-fit';
  const actualButton = button('100%', 'Tamanho original', () => setZoom(0, undefined, 1));
  actualButton.id = 'svg-actual';
  const gridButton = button(tr('Grade'), 'Mostrar grade', () => { showGrid = !showGrid; grid.hidden = !showGrid; gridButton.setAttribute('aria-pressed', String(showGrid)); });
  gridButton.id = 'svg-grid-toggle';
  const previous = button('‹', 'Imagem anterior nesta pasta', () => actions.step(-1));
  previous.id = 'svg-previous';
  const next = button('›', 'Imagem seguinte nesta pasta', () => actions.step(1));
  next.id = 'svg-next';
  const background = document.createElement('select');
  background.id = 'svg-background';
  background.setAttribute('aria-label', tr('Fundo da imagem'));
  for (const [value, label] of [['checker', 'Quadriculado'], ['light', 'Claro'], ['dark', 'Escuro']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = tr(label);
    background.append(option);
  }
  const viewport = document.createElement('div');
  viewport.className = 'svg-viewport';
  viewport.tabIndex = 0;
  viewport.dataset.background = 'checker';
  viewport.setAttribute('aria-label', tr('Imagem SVG · role para zoom, arraste para mover'));
  background.onchange = () => { viewport.dataset.background = background.value; };
  tools.append(zoomOut, zoomIn, fitButton, actualButton, gridButton, previous, next, background);
  const stage = document.createElement('div');
  stage.className = 'svg-stage';
  const frame = document.createElement('div');
  frame.className = 'image-frame';
  const grid = document.createElement('div');
  grid.className = 'image-grid';
  grid.hidden = true;
  frame.append(grid);
  stage.append(frame);
  viewport.append(stage);
  const info = document.createElement('div');
  info.id = 'svg-preview-info';
  info.setAttribute('role', 'status');
  info.setAttribute('aria-live', 'polite');
  preview.append(tools, viewport, info);
  function paint() {
    const ready = !!image && width > 0 && height > 0;
    for (const control of [zoomOut, zoomIn, fitButton, actualButton, gridButton]) control.disabled = !ready;
    if (!ready || !image) return;
    const measured = fit ? fittedScale(width, height, viewport.clientWidth, viewport.clientHeight) : scale;
    if (measured !== undefined && fit) scale = measured;
    const rendered = measured === undefined ? 1 : Math.min(scale, 16384 / width, 16384 / height);
    image.style.width = width * rendered + 'px';
    image.style.height = height * rendered + 'px';
    grid.style.setProperty('--image-grid', Math.max(rendered, 8) + 'px');
    viewport.dataset.pixelated = String(rendered >= 2);
    info.textContent = `${Math.round(width)} × ${Math.round(height)} · ${Math.round(rendered * 100)}%`;
    fitButton.setAttribute('aria-pressed', String(fit && measured !== undefined));
  }
  function setZoom(factor: number, anchor?: { x: number; y: number }, absolute?: number) {
    const before = scale || 1;
    fit = false;
    scale = clampZoom(absolute ?? before * factor);
    paint();
    if (anchor && before > 0) zoomAnchor(viewport, anchor.x, anchor.y, scale / before);
  }
  function toggleFit() { if (fit) setZoom(0, undefined, 1); else { fit = true; paint(); } }
  function resetView() { fit = true; scale = 1; width = 0; height = 0; image = undefined; frame.replaceChildren(grid); }
  function error(message: string) {
    image = undefined;
    frame.replaceChildren(grid);
    const box = document.createElement('div');
    box.className = 'svg-preview-error';
    box.setAttribute('role', 'alert');
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    box.append(paragraph, button(tr('Ver fonte'), 'Ver fonte', () => actions.showSource()));
    frame.append(box);
    preview.dataset.state = 'error';
    info.textContent = tr('Prévia SVG indisponível');
    paint();
  }
  function placeImage(next: HTMLImageElement | undefined, nextWidth: number, nextHeight: number, version?: number) {
    image = next;
    width = nextWidth;
    height = nextHeight;
    frame.replaceChildren(grid);
    if (next) frame.insertBefore(next, grid);
    if (version !== undefined) { preview.dataset.state = 'ready'; preview.dataset.version = String(version); }
    paint();
  }
  function setSiblings(hasPrevious: boolean, hasNext: boolean) { previous.disabled = !hasPrevious; next.disabled = !hasNext; }
  return { preview, viewport, paint, setZoom, toggleFit, resetView, error, placeImage, setSiblings };
}
