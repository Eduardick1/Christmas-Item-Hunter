const SCREENS = {
  WELCOME: "welcome",
  INSTRUCTION: "instructions",
  GAME: "game",
  COMPLETE: "complete",
};

export class ScreenManager {
  static get SCREENS() {
    return SCREENS;
  }

  static get INITIAL_SCREEN() {
    return SCREENS.WELCOME;
  }

  constructor(root) {
    this.root = root;
    this.screens = new Map();
    this.current = null;
    for (const screen of root.querySelectorAll("[data-screen]")) {
      this.screens.set(screen.dataset.screen, screen);
    }
  }

  get(name) {
    return this.screens.get(name);
  }

  show(name) {
    if (!this.screens.has(name)) throw new Error("Неизвестный экран: " + name);
    if (this.current === name) return;
    for (const [key, screen] of this.screens) {
      screen.classList.toggle("is-active", key === name);
    }
    this.current = name;
    document.body.classList.toggle("is-game-open", name === SCREENS.GAME);
  }

  destroy() {
    document.body.classList.remove("is-game-open");
  }
}
