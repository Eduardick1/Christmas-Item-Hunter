const TEXT = {
  START: "Старт",
  NEXT: "Далее →",
  LOADING: "Загрузка…",
};

export class InstructionsManager {
  constructor({ root, onComplete, breakpoint = 767 }) {
    this.root = root;
    this.onComplete = onComplete;
    this.steps = root.querySelector('[data-ui="howtoplay-steps"]');
    this.button = root.querySelector('[data-action="instructions-button"]');
    this.progress = root.querySelector('[data-ui="howtoplay-progress"]');
    this.slides = [...this.steps.children];
    this.container = this.steps.parentElement;
    this.sliderMode = window.matchMedia("(max-width: " + breakpoint + "px)");
    this.index = 0;
    this.completeLabel = TEXT.START;
    this.pending = false;
    this.progress.style.setProperty("--step-count", this.slides.length);
    this.handleClick = (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest(
        '[data-action="instructions-button"]',
      );
      if (action && root.contains(action)) this.advance();
    };
    this.handleResize = () => this.render();
    root.addEventListener("click", this.handleClick);
    this.sliderMode.addEventListener("change", this.handleResize);
    this.render();
  }

  render() {
    const isSlider = this.sliderMode.matches;
    const hasNext = isSlider && this.index < this.slides.length - 1;
    this.container.classList.toggle("is-slider", isSlider);
    this.steps.style.setProperty("--step-index", isSlider ? this.index : 0);
    this.progress.classList.toggle("is-hidden", !isSlider);
    this.progress.style.setProperty("--step-index", this.index);
    this.button.disabled = this.pending;
    this.button.textContent = this.pending
      ? TEXT.LOADING
      : hasNext
        ? TEXT.NEXT
        : this.completeLabel;
  }

  advance() {
    if (this.pending) return;
    if (this.sliderMode.matches && this.index < this.slides.length - 1) {
      this.index += 1;
      this.render();
    } else {
      this.onComplete();
    }
  }

  reset({ label = TEXT.START } = {}) {
    this.index = 0;
    this.pending = false;
    this.completeLabel = label;
    this.render();
  }

  setActionState({ loading = false, label = TEXT.START } = {}) {
    this.pending = loading;
    this.completeLabel = label;
    this.render();
  }

  destroy() {
    this.root.removeEventListener("click", this.handleClick);
    this.sliderMode.removeEventListener("change", this.handleResize);
  }
}
