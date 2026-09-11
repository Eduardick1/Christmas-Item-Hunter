import { centerCamera, moveCamera, resizeCamera } from "./camera.js";

const MAP_DEFAULTS = Object.freeze({
  mapUrl: new URL('../img/map.svg', import.meta.url).href,
  baseScale: 1,
});

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const DRAG_THRESHOLD = 8;
const KEYBOARD_SPEED = 600;
const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function abortError() {
  return new DOMException("Загрузка карты отменена.", "AbortError");
}

async function loadMap(mapUrl, document, signal) {
  const response = await fetch(mapUrl, { signal });
  if (!response.ok) {
    throw new Error(`Не удалось загрузить карту: HTTP ${response.status}.`);
  }
  const source = await response.text();
  if (signal.aborted) throw abortError();
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (
    parsed.querySelector("parsererror") ||
    parsed.documentElement.localName !== "svg" ||
    parsed.documentElement.namespaceURI !== SVG_NAMESPACE
  ) {
    throw new Error("Файл карты должен содержать корректный SVG.");
  }

  const svg = document.importNode(parsed.documentElement, true);
  const viewBox = svg.getAttribute("viewBox");
  const bounds = viewBox
    ? viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number)
    : [];
  if (
    bounds.length !== 4 ||
    !bounds.every(Number.isFinite) ||
    bounds[2] <= 0 ||
    bounds[3] <= 0
  ) {
    throw new Error(
      "У карты должен быть viewBox с положительной шириной и высотой.",
    );
  }

  const items = new Map();
  for (const element of svg.querySelectorAll("[data-item-id]")) {
    const id = element.getAttribute("data-item-id");
    if (!id || id !== id.trim()) {
      throw new Error(
        "data-item-id должен быть непустым и без пробелов по краям.",
      );
    }
    if (items.has(id)) {
      throw new Error(`В карте повторяется data-item-id="${id}".`);
    }
    if (
      element.parentElement &&
      element.parentElement.closest("[data-item-id]")
    ) {
      throw new Error(
        `Предмет "${id}" вложен в другой предмет. Разметьте их отдельными группами.`,
      );
    }
    items.set(id, element);
  }
  svg.setAttribute("width", String(bounds[2]));
  svg.setAttribute("height", String(bounds[3]));
  return { svg, items, mapWidth: bounds[2], mapHeight: bounds[3] };
}

export class MapController {
  static get DEFAULTS() {
    return MAP_DEFAULTS;
  }

  constructor({
    viewport,
    mapUrl = MAP_DEFAULTS.mapUrl,
    baseScale = MAP_DEFAULTS.baseScale,
    signal,
  }) {
    if (!(viewport instanceof HTMLElement)) {
      throw new TypeError("Передайте HTML-контейнер карты в viewport.");
    }
    if (!Number.isFinite(baseScale) || baseScale <= 0) {
      throw new RangeError("baseScale должен быть больше нуля.");
    }
    if (!mapUrl) throw new TypeError("Укажите путь к SVG в mapUrl.");
    if (signal && signal.aborted) throw abortError();

    this.viewport = viewport;
    this.mapUrl = mapUrl;
    this.baseScale = baseScale;
    this.signal = signal;
    this.document = viewport.ownerDocument;
    this.window = this.document.defaultView;
    this.abortController = new AbortController();
    this.itemIds = new Set();
    this.items = new Map();
    this.onItemClick = null;
    this.world = null;
    this.svg = null;
    this.observer = null;
    this.loading = null;
    this.listeners = [];
    this.enabled = false;
    this.destroyed = false;
    this.camera = null;
    this.frameId = 0;
    this.previousFrameTime = 0;
    this.gesture = null;
    this.pointers = new Set();
    this.keys = new Set();

    for (const name of [
      "render",
      "resize",
      "resetInput",
      "pointerDown",
      "pointerMove",
      "pointerUp",
      "pointerCancel",
      "keyDown",
      "keyUp",
      "focusIn",
      "dragStart",
      "visibilityChange",
    ]) {
      this[name] = this[name].bind(this);
    }
    this.handleAbort = this.destroy.bind(this);
    if (signal)
      signal.addEventListener("abort", this.handleAbort, { once: true });
  }

  async load() {
    if (this.destroyed) throw abortError();
    if (!this.loading) {
      this.loading = this.mount().catch((error) => {
        this.destroy();
        throw error;
      });
    }
    return this.loading;
  }

  async mount() {
    const map = await loadMap(
      this.mapUrl,
      this.document,
      this.abortController.signal,
    );
    if (this.destroyed || this.abortController.signal.aborted)
      throw abortError();
    if (this.viewport.querySelector(":scope > .map-world")) {
      throw new Error(
        "В этом контейнере уже есть карта. Сначала вызовите destroy().",
      );
    }

    this.svg = map.svg;
    this.items = map.items;
    this.itemIds = new Set(map.items.keys());
    this.mapWidth = map.mapWidth;
    this.mapHeight = map.mapHeight;
    this.world = this.document.createElement("div");
    this.world.className = "map-world";
    this.world.style.width = `${this.mapWidth}px`;
    this.world.style.height = `${this.mapHeight}px`;
    this.world.append(this.svg);
    this.viewport.classList.add("map-viewport", "is-disabled");
    this.viewport.classList.remove("is-dragging");
    this.viewport.append(this.world);

    this.listen(this.viewport, "pointerdown", this.pointerDown);
    this.listen(this.viewport, "pointermove", this.pointerMove);
    this.listen(this.viewport, "pointerup", this.pointerUp);
    this.listen(this.viewport, "pointercancel", this.pointerCancel);
    this.listen(this.viewport, "lostpointercapture", this.pointerCancel);
    this.listen(this.viewport, "dragstart", this.dragStart);
    this.listen(this.document, "keydown", this.keyDown);
    this.listen(this.document, "keyup", this.keyUp);
    this.listen(this.document, "focusin", this.focusIn);
    this.listen(this.document, "visibilitychange", this.visibilityChange);
    this.listen(this.window, "blur", this.resetInput);

    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(this.viewport);
    this.resize();
    return this;
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }

  requestFrame() {
    if (!this.destroyed && !this.frameId) {
      this.frameId = this.window.requestAnimationFrame(this.render);
    }
  }

  render(time) {
    this.frameId = 0;
    if (this.destroyed || !this.camera) return;
    if (this.enabled && this.keys.size) {
      const seconds = Math.min(
        Math.max(0, time - this.previousFrameTime) / 1000,
        0.05,
      );
      const dx =
        Number(this.keys.has("ArrowLeft")) -
        Number(this.keys.has("ArrowRight"));
      const dy =
        Number(this.keys.has("ArrowUp")) - Number(this.keys.has("ArrowDown"));
      const length = Math.hypot(dx, dy) || 1;
      this.camera = moveCamera(
        this.camera,
        (dx / length) * KEYBOARD_SPEED * seconds,
        (dy / length) * KEYBOARD_SPEED * seconds,
      );
      this.previousFrameTime = time;
      this.requestFrame();
    }
    this.world.style.transform = `translate(${this.camera.x}px, ${this.camera.y}px) scale(${this.camera.scale})`;
  }

  resetInput() {
    this.gesture = null;
    this.keys.clear();
    this.previousFrameTime = 0;
    if (this.world) this.viewport.classList.remove("is-dragging");
    for (const pointerId of this.pointers) {
      if (this.viewport.hasPointerCapture(pointerId)) {
        this.viewport.releasePointerCapture(pointerId);
      }
    }
    this.pointers.clear();
  }

  resize() {
    if (this.destroyed || !this.world) return;
    this.resetInput();
    const next = resizeCamera(
      {
        mapWidth: this.mapWidth,
        mapHeight: this.mapHeight,
        width: this.viewport.clientWidth,
        height: this.viewport.clientHeight,
        baseScale: this.baseScale,
      },
      this.camera,
    );
    if (next) {
      this.camera = next;
      this.requestFrame();
    }
  }

  getItemId(target) {
    const item =
      target instanceof this.window.Element
        ? target.closest("[data-item-id]")
        : null;
    return item &&
      this.svg.contains(item) &&
      !item.classList.contains("is-found")
      ? item.getAttribute("data-item-id")
      : null;
  }

  pointerDown(event) {
    if (!this.enabled || !this.camera || event.button !== 0) return;
    event.preventDefault();
    this.pointers.add(event.pointerId);
    this.viewport.setPointerCapture(event.pointerId);
    if (this.pointers.size !== 1) {
      this.gesture = null;
      this.viewport.classList.remove("is-dragging");
      return;
    }
    this.keys.clear();
    this.previousFrameTime = 0;
    this.gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      camera: this.camera,
      itemId: this.getItemId(event.target),
      dragged: false,
    };
  }

  pointerMove(event) {
    if (!this.gesture || this.gesture.id !== event.pointerId) return;
    if (event.pointerType === "mouse" && !(event.buttons & 1)) {
      this.resetInput();
      return;
    }
    const dx = event.clientX - this.gesture.x;
    const dy = event.clientY - this.gesture.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD) this.gesture.dragged = true;
    if (this.gesture.dragged) {
      this.viewport.classList.add("is-dragging");
      this.camera = moveCamera(this.gesture.camera, dx, dy);
      this.requestFrame();
    }
  }

  pointerUp(event) {
    const ended = this.gesture;
    const isTap =
      ended &&
      ended.id === event.pointerId &&
      this.pointers.size === 1 &&
      !ended.dragged &&
      Math.hypot(event.clientX - ended.x, event.clientY - ended.y) <=
        DRAG_THRESHOLD;
    this.gesture = null;
    this.pointers.delete(event.pointerId);
    this.viewport.classList.remove("is-dragging");
    if (this.viewport.hasPointerCapture(event.pointerId)) {
      this.viewport.releasePointerCapture(event.pointerId);
    }
    if (
      this.enabled &&
      isTap &&
      ended.itemId &&
      this.onItemClick &&
      this.getItemId(
        this.document.elementFromPoint(event.clientX, event.clientY),
      ) === ended.itemId
    ) {
      this.onItemClick(ended.itemId);
    }
  }

  pointerCancel(event) {
    this.pointers.delete(event.pointerId);
    if (this.gesture && this.gesture.id === event.pointerId)
      this.gesture = null;
    if (!this.gesture) this.viewport.classList.remove("is-dragging");
  }

  isEditable(target) {
    return (
      target instanceof this.window.Element &&
      Boolean(target.closest(EDITABLE_SELECTOR))
    );
  }

  keyDown(event) {
    if (
      !this.enabled ||
      !ARROW_KEYS.has(event.key) ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      this.isEditable(event.target)
    )
      return;
    event.preventDefault();
    if (this.pointers.size) this.resetInput();
    if (!this.keys.size) this.previousFrameTime = this.window.performance.now();
    this.keys.add(event.key);
    this.requestFrame();
  }

  keyUp(event) {
    if (this.keys.delete(event.key) && !this.isEditable(event.target)) {
      event.preventDefault();
    }
  }

  focusIn(event) {
    if (this.isEditable(event.target)) this.resetInput();
  }

  dragStart(event) {
    event.preventDefault();
  }

  visibilityChange() {
    if (this.document.hidden) this.resetInput();
  }

  setEnabled(value) {
    if (this.destroyed || !this.world) return;
    const enabled = Boolean(value);
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.viewport.classList.toggle("is-disabled", !enabled);
    if (enabled) this.resize();
    else this.resetInput();
  }

  setFoundItems(ids) {
    if (this.destroyed) return;
    const found = new Set(ids);
    for (const [id, element] of this.items) {
      const isFound = found.has(id);
      if (element.classList.contains("is-found") !== isFound) {
        element.classList.toggle("is-found", isFound);
      }
    }
  }

  resetView() {
    if (this.destroyed) return;
    this.resetInput();
    if (this.camera) this.camera = centerCamera(this.camera);
    this.requestFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.enabled = false;
    this.onItemClick = null;
    this.resetInput();
    this.abortController.abort();
    if (this.signal) this.signal.removeEventListener("abort", this.handleAbort);
    for (const [target, type, handler] of this.listeners) {
      target.removeEventListener(type, handler);
    }
    this.listeners = [];
    if (this.observer) this.observer.disconnect();
    this.window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    if (this.world) {
      this.viewport.classList.add("is-disabled");
      this.world.remove();
    }
  }
}
