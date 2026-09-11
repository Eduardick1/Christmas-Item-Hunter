function abortError() {
  return new DOMException("Загрузка изображений отменена.", "AbortError");
}

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const image = new Image();
    const filename = new URL(url).pathname.split("/").pop() || url;
    let settled = false;

    function finish(error) {
      if (settled) return;
      settled = true;
      image.onerror = null;
      signal.removeEventListener("abort", onAbort);
      if (error) {
        image.removeAttribute("src");
        reject(error);
      } else {
        resolve();
      }
    }

    function onAbort() {
      finish(abortError());
    }

    image.onerror = () =>
      finish(new Error(`Не удалось загрузить изображение «${filename}».`));
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      image.src = url;
      image.decode().then(
        () => finish(),
        () =>
          finish(
            new Error(`Не удалось декодировать изображение «${filename}».`),
          ),
      );
    } catch {
      finish(new Error(`Не удалось подготовить изображение «${filename}».`));
    }
  });
}

export async function preloadImages(urls, { signal, preloadUrls = [] } = {}) {
  if (signal && signal.aborted) throw abortError();

  const lifetime = new AbortController();
  const preloadLinks = [];
  const onAbort = () => lifetime.abort();
  if (signal) signal.addEventListener("abort", onAbort);

  try {
    const hintedUrls = new Set(
      Array.from(preloadUrls, (url) => new URL(url, document.baseURI).href),
    );
    const uniqueUrls = new Set(
      Array.from(urls, (url) => new URL(url, document.baseURI).href),
    );
    const existingUrls = new Set(
      [...document.querySelectorAll('link[rel="preload"][as="image"]')].map(
        (link) => link.href,
      ),
    );
    for (const url of hintedUrls) {
      uniqueUrls.add(url);
      if (existingUrls.has(url)) continue;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "image";
      link.href = url;
      preloadLinks.push(link);
      document.head.append(link);
    }
    await Promise.all(
      [...uniqueUrls].map((url) => loadImage(url, lifetime.signal)),
    );
    if (lifetime.signal.aborted) throw abortError();
  } catch (error) {
    lifetime.abort();
    for (const link of preloadLinks) link.remove();
    throw error;
  } finally {
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export function collectGameImages(levels, itemsById) {
  const urls = new Set();
  const cards = new Set();
  for (const level of levels) {
    urls.add(level.image);
    for (const id of level.items) {
      const item = itemsById.get(id);
      if (!item) throw new Error("Нет описания предмета «" + id + "».");
      for (const url of Object.values(item.images)) urls.add(url);
      cards.add(item.images.card);
    }
  }
  return { urls, cards };
}
