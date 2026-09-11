const SUBMIT_DELAY = 1500;
const FORM_STATE = {
  IDLE: 'idle',
  SUBMITTING: 'submitting',
  SUCCESS: 'success',
};
const REQUIRED_MESSAGE = 'Обязательное поле для заполнения';

function formatPhone(value) {
  let digits = value.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('8')) digits = '7' + digits.slice(1);
  else if (!digits.startsWith('7')) digits = '7' + digits;
  const number = digits.slice(1, 11);
  let result = '+7';
  if (number.length) result += ' (' + number.slice(0, 3);
  if (number.length >= 3) result += ')';
  if (number.length > 3) result += ' ' + number.slice(3, 6);
  if (number.length > 6) result += '-' + number.slice(6, 8);
  if (number.length > 8) result += '-' + number.slice(8, 10);
  return result;
}

function formatBirthdate(value) {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('.');
}

function birthdateError(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (!match) return 'Введите дату в формате ДД.ММ.ГГГГ';
  const [day, month, year] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (year < 1 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return 'Введите существующую дату';
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date > today ? 'Дата рождения не может быть в будущем' : '';
}

/** Static form nodes, validation and submission presentation. */
export class FormManager {
  static get STATE() {
    return FORM_STATE;
  }

  static get SUBMIT_DELAY() {
    return SUBMIT_DELAY;
  }

  constructor({ root, onSuccessClose, submitDelay = SUBMIT_DELAY }) {
    this.root = root;
    this.screen = root.closest('[data-screen]');
    this.onSuccessClose = onSuccessClose;
    this.submitDelay = submitDelay;
    this.form = root.querySelector('[data-ui="bonus-form"]');
    this.fieldset = root.querySelector('[data-ui="bonus-fields"]');
    this.noCard = root.querySelector('[data-field="no-card"]');
    this.card = root.querySelector('[data-field="card"]');
    this.submit = root.querySelector('[data-action="bonus-submit"]');
    this.submitLabel = this.submit.textContent;
    this.loading = root.querySelector('[data-ui="bonus-loading"]');
    this.dialog = root.querySelector('[data-ui="bonus-success"]');
    this.overlay = root.querySelector('[data-ui="bonus-success-overlay"]');
    this.listeners = [];
    this.fields = new Map([...this.fieldset.querySelectorAll('.form-field [data-field]')].map(input => [input, {
      input,
      key: input.dataset.field,
      wrapper: input.closest('.form-field'),
      error: root.querySelector('[data-error="' + input.dataset.field + '"]'),
      touched: false,
      state: null,
    }]));
    this.state = FORM_STATE.IDLE;
    this.submitTimer = 0;
    this.destroyed = false;

    this.listen(this.form, 'input', event => this.handleInput(event));
    this.listen(this.form, 'beforeinput', event => this.handleBeforeInput(event));
    this.listen(this.form, 'focusout', event => {
      const field = this.fields.get(event.target);
      if (field && this.state === FORM_STATE.IDLE) this.validate(field);
    });
    this.listen(this.form, 'change', event => {
      if (event.target === this.noCard) this.syncCard();
    });
    this.listen(this.form, 'submit', event => this.handleSubmit(event));
    this.listen(root, 'click', event => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest('[data-action="bonus-success-close"]');
      if (action && root.contains(action)) this.closeSuccess();
    });
    this.listen(document, 'keydown', event => {
      if (event.key === 'Escape' && this.screen && this.screen.classList.contains('is-active')
        && this.dialog.classList.contains('is-open')) {
        event.preventDefault();
        this.closeSuccess();
      }
    });
    this.syncCard();
  }

  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.listeners.push({ target, type, handler });
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    const pending = next === FORM_STATE.SUBMITTING;
    this.form.classList.toggle('is-loading', pending);
    this.fieldset.disabled = next !== FORM_STATE.IDLE;
    this.submit.disabled = next !== FORM_STATE.IDLE;
    this.submit.textContent = pending ? 'Отправка…' : this.submitLabel;
    this.loading.classList.toggle('is-hidden', !pending);
  }

  showValidation(field, message, nextState) {
    if (field.error.textContent !== message) field.error.textContent = message;
    field.error.classList.toggle('is-hidden', !message);
    if (field.state === nextState) return;
    field.state = nextState;
    field.wrapper.classList.toggle('is-invalid', nextState === 'invalid');
    field.wrapper.classList.toggle('is-valid', nextState === 'valid');
  }

  validate(field) {
    const input = field.input;
    if (input.disabled) {
      this.showValidation(field, '', null);
      return true;
    }
    field.touched = true;
    const value = input.value.trim();
    let message = value ? '' : REQUIRED_MESSAGE;
    if (value) {
      if (field.key === 'phone' && !/^7\d{10}$/.test(value.replace(/\D/g, ''))) {
        message = 'Введите телефон полностью';
      } else if (field.key === 'birthdate') {
        message = birthdateError(value);
      } else if (field.key === 'email' && input.validity.typeMismatch) {
        message = 'Введите корректный email';
      } else if (field.key === 'card' && !/^\d+$/.test(value)) {
        message = 'Номер карты должен содержать только цифры';
      }
    }
    this.showValidation(field, message, message ? 'invalid' : 'valid');
    return !message;
  }

  formatInput(input) {
    const formatter = input.dataset.field === 'phone' ? formatPhone
      : input.dataset.field === 'birthdate' ? formatBirthdate : null;
    if (!formatter) return;
    const original = input.value;
    const formatted = formatter(original);
    if (original === formatted) return;
    const caret = input.selectionStart === null ? original.length : input.selectionStart;
    const digits = original.replace(/\D/g, '');
    let count = original.slice(0, caret).replace(/\D/g, '').length;
    if (input.dataset.field === 'phone' && digits && !/^[78]/.test(digits)) count += 1;
    input.value = formatted;
    let position = 0;
    while (position < formatted.length && count > 0) {
      if (/\d/.test(formatted[position])) count -= 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  }

  syncCard() {
    this.card.disabled = this.noCard.checked;
    this.card.required = !this.noCard.checked;
    const field = this.fields.get(this.card);
    if (this.noCard.checked) {
      field.touched = false;
      this.showValidation(field, '', null);
    }
  }

  handleInput(event) {
    const field = this.fields.get(event.target);
    if (!field || this.state !== FORM_STATE.IDLE) return;
    this.formatInput(field.input);
    if (field.touched) this.validate(field);
  }

  // Deleting beside mask punctuation removes a digit instead of restoring it.
  handleBeforeInput(event) {
    const input = event.target;
    if (this.state !== FORM_STATE.IDLE || !this.fields.has(input)
      || !['phone', 'birthdate'].includes(input.dataset.field)) return;
    const backward = event.inputType === 'deleteContentBackward';
    if (!backward && event.inputType !== 'deleteContentForward') return;
    if (input.selectionStart !== input.selectionEnd) return;
    let index = input.selectionStart - (backward ? 1 : 0);
    if (index < 0 || index >= input.value.length || /\d/.test(input.value[index])) return;
    while (index >= 0 && index < input.value.length && /\D/.test(input.value[index])) {
      index += backward ? -1 : 1;
    }
    if (index < 0 || index >= input.value.length) return;
    event.preventDefault();
    input.setRangeText('', index, index + 1, 'end');
    this.formatInput(input);
    const field = this.fields.get(input);
    if (field.touched) this.validate(field);
  }

  handleSubmit(event) {
    event.preventDefault();
    if (this.state !== FORM_STATE.IDLE || this.destroyed) return;
    let firstInvalid = null;
    for (const field of this.fields.values()) {
      this.formatInput(field.input);
      if (!this.validate(field) && !firstInvalid) firstInvalid = field.input;
    }
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }
    this.setState(FORM_STATE.SUBMITTING);
    this.submitTimer = window.setTimeout(() => {
      this.submitTimer = 0;
      if (this.destroyed || this.state !== FORM_STATE.SUBMITTING) return;
      this.setState(FORM_STATE.SUCCESS);
      this.overlay.classList.add('is-open');
      this.dialog.classList.add('is-open');
    }, this.submitDelay);
  }

  closeSuccess() {
    if (this.state !== FORM_STATE.SUCCESS || this.destroyed || !this.dialog.classList.contains('is-open')) return;
    this.dialog.classList.remove('is-open');
    this.overlay.classList.remove('is-open');
    this.onSuccessClose();
  }

  reset() {
    window.clearTimeout(this.submitTimer);
    this.submitTimer = 0;
    this.setState(FORM_STATE.IDLE);
    this.dialog.classList.remove('is-open');
    this.overlay.classList.remove('is-open');
    this.form.reset();
    this.syncCard();
    for (const field of this.fields.values()) {
      field.touched = false;
      this.showValidation(field, '', null);
    }
  }

  destroy() {
    this.destroyed = true;
    for (const { target, type, handler } of this.listeners) {
      target.removeEventListener(type, handler);
    }
    this.listeners = [];
    this.reset();
  }
}
