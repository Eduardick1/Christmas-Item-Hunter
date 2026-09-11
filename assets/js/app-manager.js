import { levels } from './levels.js';
import { itemsById } from './items.js';
import { ScreenManager } from './screen-manager.js';
import { GameManager } from './game.js';
import { MapController } from './map-controller.js';
import { GameUiManager } from './game-ui.js';
import { InstructionsManager } from './instructions-slider.js';
import { FormManager } from './final-form.js';
import { collectGameImages, preloadImages } from './asset-loader.js';

const screens = ScreenManager.SCREENS;
const statuses = GameManager.STATUS;
const events = GameManager.EVENTS;

export class AppManager {
  constructor(root, { initialScreen = ScreenManager.INITIAL_SCREEN } = {}) {
    this.root = root;
    this.initialScreen = initialScreen;
    this.screens = new ScreenManager(root);
    this.game = null;
    this.map = null;
    this.ready = false;
    this.destroyed = false;
    this.preparation = null;
    this.loadAbort = null;
    this.loadVersion = 0;
    this.openVersion = 0;
    this.startRequested = false;
    this.loadError = '';

    const gameScreen = this.screens.get(screens.GAME);
    const instructionsScreen = this.screens.get(screens.INSTRUCTION);
    this.viewport = gameScreen.querySelector('[data-ui="map-viewport"]');
    this.instructionsStatus = instructionsScreen.querySelector('[data-ui="instructions-status"]');
    this.instructions = new InstructionsManager({
      root: instructionsScreen,
      onComplete: () => this.openGame(),
    });
    this.ui = new GameUiManager({
      root: gameScreen,
      levels,
      itemsById,
      onStartLevel: index => this.runGameAction(game => game.startLevel(index)),
      onPause: () => this.pauseGame(),
      onResume: () => this.resumeGame(),
      onRetry: () => {
        this.ready = false;
        this.showScreen(screens.INSTRUCTION);
        this.openGame();
      },
      onFoundDismiss: () => this.finishFind(),
    });
    this.form = new FormManager({
      root: this.screens.get(screens.COMPLETE).querySelector('[data-ui="final-form"]'),
      onSuccessClose: () => {
        this.showScreen(screens.WELCOME);
        window.scrollTo(0, 0);
      },
    });
    this.onClick = event => {
      const button = event.target.closest('[data-action="welcome-button"]');
      if (!button || !this.root.contains(button)) return;
      this.showScreen(screens.INSTRUCTION);
      this.prepareGame();
    };
    this.onProgress = event => this.ui.render(event.detail);
    this.onItemFound = event => this.ui.showFoundItem(event.detail);
    this.onPageHide = event => {
      if (!event.persisted) this.destroy();
    };
    root.addEventListener('click', this.onClick);
    window.addEventListener('pagehide', this.onPageHide);
  }

  start() {
    if (this.initialScreen === screens.GAME) {
      this.showScreen(screens.INSTRUCTION);
      this.openGame();
    } else {
      this.showScreen(this.initialScreen);
      this.prepareGame();
    }
  }

  showScreen(name) {
    const current = this.screens.current;
    if (current === name) return;
    if (current === screens.COMPLETE) this.form.reset();
    if (current === screens.GAME) {
      this.pauseGame();
      this.ui.hide();
    }
    if (current === screens.INSTRUCTION) {
      this.openVersion += 1;
      this.startRequested = false;
      this.instructions.setActionState();
    }
    this.screens.show(name);
    if (name === screens.INSTRUCTION) {
      this.instructions.reset();
      this.instructionsStatus.classList.add('is-hidden');
    }
  }

  pauseGame() {
    if (!this.game || this.game.getState().status !== statuses.PLAYING) return false;
    this.game.pause();
    return true;
  }

  resumeGame() {
    if (this.game && this.screens.current === screens.GAME && this.game.getState().status === statuses.PAUSED) {
      this.runGameAction(game => game.resume());
    }
  }

  runGameAction(action) {
    if (!this.game || !this.ready) return false;
    try {
      action(this.game);
      return true;
    } catch (error) {
      this.ui.showError(error.message);
      return false;
    }
  }

  releaseGame() {
    if (this.game) {
      this.game.removeEventListener(events.PROGRESS, this.onProgress);
      this.game.removeEventListener(events.ITEM_FOUND, this.onItemFound);
      this.game.destroy();
    } else if (this.map) {
      this.map.destroy();
    }
    this.game = null;
    this.map = null;
    this.ready = false;
  }

  prepareGame() {
    if (this.destroyed) return Promise.resolve(false);
    if (this.ready) return Promise.resolve(true);
    if (this.preparation) return this.preparation;
    const version = ++this.loadVersion;
    if (this.loadAbort) this.loadAbort.abort();
    this.releaseGame();
    const abort = new AbortController();
    this.loadAbort = abort;
    this.loadError = '';
    this.ui.showLoading();

    this.preparation = (async () => {
      let map = null;
      try {
        const images = collectGameImages(levels, itemsById);
        map = new MapController({
          viewport: this.viewport,
          signal: abort.signal,
        });
        this.map = map;
        await Promise.all([
          map.load(),
          preloadImages(images.urls, { signal: abort.signal, preloadUrls: images.cards }),
        ]);
        if (abort.signal.aborted || version !== this.loadVersion) {
          map.destroy();
          return false;
        }
        this.game = new GameManager({ map, levels });
        this.game.addEventListener(events.PROGRESS, this.onProgress);
        this.game.addEventListener(events.ITEM_FOUND, this.onItemFound);
        this.ready = true;
        this.ui.render(this.game.getState());
        return true;
      } catch (error) {
        abort.abort();
        if (map) map.destroy();
        if (version === this.loadVersion) {
          this.releaseGame();
          this.loadError = error.message;
        }
        return false;
      }
    })().finally(() => {
      if (version === this.loadVersion) this.preparation = null;
    });
    return this.preparation;
  }

  async openGame() {
    if (this.startRequested || this.destroyed) return;
    const version = ++this.openVersion;
    this.startRequested = true;
    this.instructions.setActionState({ loading: true });
    this.instructionsStatus.textContent = 'Готовим карту и изображения…';
    this.instructionsStatus.classList.remove('is-hidden');
    const prepared = await this.prepareGame();
    if (this.destroyed || version !== this.openVersion) return;
    this.startRequested = false;
    if (!prepared) {
      this.instructions.setActionState({ label: 'Повторить загрузку' });
      this.instructionsStatus.textContent = 'Не удалось загрузить игру. ' + this.loadError + ' Попробуйте ещё раз.';
      return;
    }
    this.instructionsStatus.classList.add('is-hidden');
    this.showScreen(screens.GAME);
    this.ui.showLevelIntro(0);
  }

  finishFind() {
    if (!this.game || this.screens.current !== screens.GAME) return;
    const state = this.game.getState();
    if (state.status === statuses.LEVEL_COMPLETE) {
      this.ui.showLevelIntro(state.levelIndex + 1);
    } else if (state.status === statuses.COMPLETE) {
      this.showScreen(screens.COMPLETE);
      window.scrollTo(0, 0);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadVersion += 1;
    this.openVersion += 1;
    this.startRequested = false;
    if (this.loadAbort) this.loadAbort.abort();
    this.releaseGame();
    this.ui.destroy();
    this.instructions.destroy();
    this.form.destroy();
    this.screens.destroy();
    this.root.removeEventListener('click', this.onClick);
    window.removeEventListener('pagehide', this.onPageHide);
  }
}
