import { GameManager } from "./game.js";

const statuses = GameManager.STATUS;
const FOUND_DURATION = 3000;
const PANELS = {
  STORY: "story",
  GOALS: "goals",
  TARGETS: "targets",
  FOUND: "found",
  LOADING: "loading",
  ERROR: "error",
};

export class GameUiManager {
  static get PANELS() {
    return PANELS;
  }

  static get FOUND_DURATION() {
    return FOUND_DURATION;
  }

  constructor({
    root,
    levels,
    itemsById,
    onStartLevel,
    onPause,
    onResume,
    onRetry,
    onFoundDismiss,
    foundDuration = FOUND_DURATION,
  }) {
    this.root = root;
    this.levels = levels;
    this.itemsById = itemsById;
    this.onStartLevel = onStartLevel;
    this.onPause = onPause;
    this.onResume = onResume;
    this.onRetry = onRetry;
    this.onFoundDismiss = onFoundDismiss;
    this.foundDuration = foundDuration;
    this.elements = {};
    for (const key of [
      "game-hud",
      "game-progress",
      "game-progress-segments",
      "item-list",
      "game-overlay",
      "targets-panel",
      "targets-list",
      "targets-title",
      "level-card",
      "level-title",
      "level-description",
      "level-illustration",
      "level-story",
      "level-goals",
      "level-goals-list",
      "found-card",
      "found-image",
      "found-name",
      "game-loading",
      "map-error",
      "map-error-message",
    ]) {
      this.elements[key] = root.querySelector('[data-ui="' + key + '"]');
    }
    this.levelButton = root.querySelector('[data-action="level-button"]');
    this.listeners = [];
    this.trayItems = new Map();
    this.targetItems = new Map();
    this.renderedFound = new Set();
    this.renderedFoundItem = null;
    this.snapshot = null;
    this.renderedLevel = -1;
    this.pendingLevel = 0;
    this.panel = null;
    this.panelVersion = 0;
    this.foundTimer = 0;
    this.resumeOnClose = false;
    this.dismissPointer = null;

    this.listen(root, "click", (event) => this.handleAction(event));
    this.listen(root, "pointerdown", (event) => this.startDismiss(event), true);
    this.listen(
      root,
      "pointercancel",
      () => {
        this.dismissPointer = null;
      },
      true,
    );
    this.listen(root, "click", (event) => this.finishDismiss(event), true);
    this.listen(document, "keydown", (event) => {
      if (
        event.key === "Escape" &&
        root.classList.contains("is-active") &&
        (this.panel === PANELS.TARGETS || this.panel === PANELS.FOUND)
      ) {
        event.preventDefault();
        this.dismiss();
      }
    });
  }

  listen(target, type, handler, capture = false) {
    target.addEventListener(type, handler, capture);
    this.listeners.push({ target, type, handler, capture });
  }

  clearTimer() {
    window.clearTimeout(this.foundTimer);
    this.foundTimer = 0;
  }

  handleAction(event) {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest("[data-action]");
    if (!action || !this.root.contains(action)) return;
    switch (action.dataset.action) {
      case "targets-button":
        this.toggleTargets();
        break;
      case "targets-close":
        this.dismiss();
        break;
      case "level-button":
        this.advanceIntro();
        break;
      case "retry-button":
        this.onRetry();
        break;
    }
  }

  setPanel(next) {
    if (this.panel === next) return;
    this.clearTimer();
    this.dismissPointer = null;
    this.panelVersion += 1;
    this.panel = next;
    this.root.classList.toggle("has-targets", next === PANELS.TARGETS);
    const intro = [
      PANELS.LOADING,
      PANELS.ERROR,
      PANELS.STORY,
      PANELS.GOALS,
    ].includes(next);
    const showHud =
      !intro && this.snapshot !== null && this.snapshot.levelIndex >= 0;
    const visibility = {
      "game-hud": showHud,
      "item-list": showHud,
      "game-overlay": next !== null && next !== PANELS.FOUND,
      "level-card": next === PANELS.STORY || next === PANELS.GOALS,
      "level-story": next === PANELS.STORY,
      "level-goals": next === PANELS.GOALS,
      "targets-panel": next === PANELS.TARGETS,
      "found-card": next === PANELS.FOUND,
      "game-loading": next === PANELS.LOADING,
      "map-error": next === PANELS.ERROR,
    };
    for (const [key, visible] of Object.entries(visibility)) {
      this.elements[key].classList.toggle("is-open", visible);
    }
  }

  buildGoals(list, level) {
    const entries = level.items.map((id) => {
      const item = document.createElement("li");
      item.textContent = this.itemsById.get(id).name;
      return [id, item];
    });
    list.replaceChildren(...entries.map((entry) => entry[1]));
    return new Map(entries);
  }

  buildTray(level) {
    this.trayItems.clear();
    this.elements["item-list"].replaceChildren(
      ...level.items.map((id) => {
        const definition = this.itemsById.get(id);
        const item = document.createElement("li");
        item.dataset.itemId = id;
        item.style.backgroundImage =
          'url("' + definition.images.placeholder + '")';
        const image = document.createElement("img");
        image.width = image.height = 56;
        image.src = definition.images.icon;
        image.alt = definition.name + " — ещё не найдено";
        item.append(image);
        this.trayItems.set(id, { item, image });
        return item;
      }),
    );
    this.elements["game-progress-segments"].replaceChildren(
      ...level.items.slice(1).map((item, index) => {
        const segment = document.createElement("span");
        segment.style.left = ((index + 1) / level.items.length) * 100 + "%";
        return segment;
      }),
    );
  }

  prepareLevel(index) {
    if (this.renderedLevel === index) return;
    const level = this.levels[index];
    this.elements["level-title"].textContent = level.title;
    this.elements["targets-title"].textContent = level.title;
    this.elements["level-description"].textContent = level.description;
    this.elements["level-illustration"].src = level.image;
    this.buildGoals(this.elements["level-goals-list"], level);
    this.targetItems = this.buildGoals(this.elements["targets-list"], level);
    this.buildTray(level);
    this.renderedLevel = index;
    this.renderedFound = new Set();
    this.updateProgress();
  }

  updateProgress() {
    const level = this.levels[this.renderedLevel];
    const count = this.renderedFound.size;
    const total = level.items.length;
    this.elements["game-progress"].style.setProperty(
      "--progress",
      count / total,
    );
  }

  updateFound(foundIds) {
    if (
      foundIds.length === this.renderedFound.size &&
      foundIds.every((id) => this.renderedFound.has(id))
    )
      return;
    const found = new Set(foundIds);
    for (const id of this.levels[this.renderedLevel].items) {
      const isFound = found.has(id);
      if (this.renderedFound.has(id) === isFound) continue;
      const definition = this.itemsById.get(id);
      const entry = this.trayItems.get(id);
      entry.item.classList.toggle("is-found", isFound);
      entry.image.alt =
        definition.name + (isFound ? " — найдено" : " — ещё не найдено");
      this.targetItems.get(id).classList.toggle("is-found", isFound);
    }
    const countChanged = found.size !== this.renderedFound.size;
    this.renderedFound = found;
    if (countChanged) this.updateProgress();
  }

  render(state) {
    this.snapshot = state;
    if (state.levelIndex < 0) return;
    this.prepareLevel(state.levelIndex);
    this.updateFound(state.foundIds);
  }

  showLevelIntro(index) {
    this.onPause();
    this.resumeOnClose = false;
    this.pendingLevel = index;
    this.prepareLevel(index);
    this.updateFound([]);
    this.levelButton.textContent = "Далее";
    this.setPanel(PANELS.STORY);
  }

  advanceIntro() {
    if (this.panel === PANELS.STORY) {
      this.levelButton.textContent = "Искать";
      this.setPanel(PANELS.GOALS);
    } else if (
      this.panel === PANELS.GOALS &&
      this.onStartLevel(this.pendingLevel)
    ) {
      this.resumeOnClose = false;
      this.setPanel(null);
    }
  }

  toggleTargets() {
    if (this.panel === PANELS.TARGETS) {
      this.dismiss();
    } else if (
      this.panel === null &&
      this.snapshot &&
      [statuses.PLAYING, statuses.PAUSED].includes(this.snapshot.status)
    ) {
      this.resumeOnClose = this.onPause();
      this.setPanel(PANELS.TARGETS);
    }
  }

  dismiss() {
    if (this.panel !== PANELS.TARGETS && this.panel !== PANELS.FOUND) return;
    const closed = this.panel;
    const shouldResume = this.resumeOnClose;
    this.resumeOnClose = false;
    this.setPanel(null);
    if (shouldResume) this.onResume();
    if (closed === PANELS.FOUND) this.onFoundDismiss();
  }

  showFoundItem({ itemId }) {
    this.resumeOnClose = this.onPause();
    if (this.renderedFoundItem !== itemId) {
      const item = this.itemsById.get(itemId);
      this.elements["found-image"].src = item.images.card;
      this.elements["found-name"].textContent = item.name;
      this.renderedFoundItem = itemId;
    }
    this.setPanel(PANELS.FOUND);
    const version = this.panelVersion;
    this.foundTimer = window.setTimeout(() => {
      if (version === this.panelVersion) this.dismiss();
    }, this.foundDuration);
  }

  startDismiss(event) {
    this.dismissPointer = null;
    if (event.button !== 0) return;
    if (
      this.panel === PANELS.FOUND ||
      (this.panel === PANELS.TARGETS &&
        event.target === this.elements["game-overlay"])
    ) {
      this.dismissPointer = {
        version: this.panelVersion,
        x: event.clientX,
        y: event.clientY,
      };
    }
  }

  finishDismiss(event) {
    const press = this.dismissPointer;
    this.dismissPointer = null;
    if (
      this.panel !== PANELS.FOUND &&
      !(
        this.panel === PANELS.TARGETS &&
        event.target === this.elements["game-overlay"]
      )
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (
      press &&
      press.version === this.panelVersion &&
      Math.hypot(event.clientX - press.x, event.clientY - press.y) <= 8
    )
      this.dismiss();
  }

  showLoading() {
    this.resumeOnClose = false;
    this.snapshot = null;
    this.renderedLevel = -1;
    this.setPanel(PANELS.LOADING);
  }

  showError(message) {
    this.onPause();
    this.resumeOnClose = false;
    this.elements["map-error-message"].textContent = message;
    this.setPanel(PANELS.ERROR);
  }

  hide() {
    this.resumeOnClose = false;
    this.setPanel(null);
  }

  destroy() {
    this.clearTimer();
    this.panelVersion += 1;
    this.dismissPointer = null;
    for (const { target, type, handler, capture } of this.listeners) {
      target.removeEventListener(type, handler, capture);
    }
    this.listeners = [];
  }
}
