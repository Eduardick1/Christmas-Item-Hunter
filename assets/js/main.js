import { AppManager } from './app-manager.js';

const app = new AppManager(document.querySelector('[data-ui="app"]'));
app.start();
