const GAME_STATUS = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  LEVEL_COMPLETE: 'level-complete',
  COMPLETE: 'complete',
});

const GAME_EVENTS = Object.freeze({
  PROGRESS: 'progress',
  ITEM_FOUND: 'itemfound',
});

function isId(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function validateLevels(levels, itemIds) {
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new TypeError('Добавьте хотя бы один уровень в конфигурацию игры.');
  }

  const levelIds = new Set();
  return levels.map((level, index) => {
    if (!level || !isId(level.id)) {
      throw new TypeError(`Уровень ${index + 1}: id должен быть непустой строкой без пробелов по краям.`);
    }
    if (levelIds.has(level.id)) {
      throw new Error(`Повторяется id уровня: «${level.id}».`);
    }
    levelIds.add(level.id);

    if (!Array.isArray(level.items) || level.items.length === 0) {
      throw new TypeError(`Уровень «${level.id}»: добавьте хотя бы один предмет.`);
    }

    const uniqueItems = new Set();
    const items = level.items.map((itemId) => {
      if (!isId(itemId)) {
        throw new TypeError(`Уровень «${level.id}»: id предмета должен быть непустой строкой без пробелов по краям.`);
      }
      if (uniqueItems.has(itemId)) {
        throw new Error(`Уровень «${level.id}»: предмет «${itemId}» указан несколько раз.`);
      }
      if (!itemIds.has(itemId)) {
        throw new Error(`Уровень «${level.id}»: предмет «${itemId}» не найден в SVG. Добавьте группе data-item-id="${itemId}".`);
      }
      uniqueItems.add(itemId);
      return itemId;
    });

    return { id: level.id, items };
  });
}

export class GameManager extends EventTarget {
  static get STATUS() {
    return GAME_STATUS;
  }

  static get EVENTS() {
    return GAME_EVENTS;
  }

  constructor({ map, levels }) {
    super();
    if (!map || !(map.itemIds instanceof Set)) {
      throw new TypeError('Передайте загруженный контроллер карты в map.');
    }
    this.levels = validateLevels(levels, map.itemIds);
    this.map = map;
    this.foundIds = new Set();
    this.status = GAME_STATUS.IDLE;
    this.levelIndex = -1;
    this.destroyed = false;
    this.run = 0;
    this.handleItemClick = this.handleItemClick.bind(this);
    this.map.onItemClick = this.handleItemClick;
  }

  getState() {
    const level = this.levels[this.levelIndex];
    return {
      status: this.status,
      levelIndex: this.levelIndex,
      levelId: level ? level.id : null,
      foundIds: [...this.foundIds],
      total: level ? level.items.length : 0,
    };
  }

  startLevel(index) {
    this.assertAlive();
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) {
      throw new RangeError(`Индекс уровня должен быть целым числом от 0 до ${this.levels.length - 1}.`);
    }
    this.run += 1;
    this.levelIndex = index;
    this.foundIds.clear();
    this.status = GAME_STATUS.PLAYING;
    this.map.setFoundItems([]);
    this.map.setEnabled(true);
    this.emitProgress();
  }

  pause() {
    this.assertAlive();
    if (this.status !== GAME_STATUS.PLAYING) return;
    this.status = GAME_STATUS.PAUSED;
    this.map.setEnabled(false);
    this.emitProgress();
  }

  resume() {
    this.assertAlive();
    if (this.status !== GAME_STATUS.PAUSED) return;
    this.status = GAME_STATUS.PLAYING;
    this.map.setEnabled(true);
    this.emitProgress();
  }

  restart() {
    this.assertAlive();
    this.map.resetView();
    this.startLevel(0);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.run += 1;
    this.map.onItemClick = null;
    this.map.destroy();
  }

  assertAlive() {
    if (this.destroyed) {
      throw new Error('Игра уже уничтожена. Создайте новый экземпляр.');
    }
  }

  emitProgress() {
    this.dispatchEvent(new CustomEvent(GAME_EVENTS.PROGRESS, { detail: this.getState() }));
  }

  handleItemClick(itemId) {
    if (
      this.destroyed || this.status !== GAME_STATUS.PLAYING ||
      this.foundIds.has(itemId) ||
      !this.levels[this.levelIndex].items.includes(itemId)
    ) return;

    this.foundIds.add(itemId);
    if (this.foundIds.size === this.levels[this.levelIndex].items.length) {
      this.status = this.levelIndex === this.levels.length - 1
        ? GAME_STATUS.COMPLETE : GAME_STATUS.LEVEL_COMPLETE;
    }

    const run = this.run;
    this.map.setFoundItems([...this.foundIds]);
    this.map.setEnabled(this.status === GAME_STATUS.PLAYING);
    this.emitProgress();
    if (this.destroyed || run !== this.run) return;

    this.dispatchEvent(new CustomEvent(GAME_EVENTS.ITEM_FOUND, {
      detail: { itemId, state: this.getState() },
    }));
  }
}
