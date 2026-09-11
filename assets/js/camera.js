const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const FULL_SCALE_VIEWPORT_SIZE = 640;
const MIN_VIEWPORT_SCALE = 0.5;

function constrain(camera) {
  return {
    ...camera,
    x: clamp(camera.x, camera.width - camera.mapWidth * camera.scale, 0),
    y: clamp(camera.y, camera.height - camera.mapHeight * camera.scale, 0),
  };
}

export function resizeCamera(
  { mapWidth, mapHeight, width, height, baseScale = 1 },
  previous = null,
) {
  if (
    ![mapWidth, mapHeight, baseScale].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  ) {
    throw new RangeError(
      "Размер карты и базовый масштаб должны быть положительными числами.",
    );
  }
  if (![width, height].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError(
      "Размер игрового окна должен быть неотрицательным числом.",
    );
  }
  if (width === 0 || height === 0) return null;

  const viewportScale = clamp(
    Math.min(width, height) / FULL_SCALE_VIEWPORT_SIZE,
    MIN_VIEWPORT_SCALE,
    1,
  );
  const scale = Math.max(baseScale * viewportScale, width / mapWidth, height / mapHeight);
  const centerX = previous
    ? (previous.width / 2 - previous.x) / previous.scale
    : mapWidth / 2;
  const centerY = previous
    ? (previous.height / 2 - previous.y) / previous.scale
    : mapHeight / 2;

  return constrain({
    x: width / 2 - centerX * scale,
    y: height / 2 - centerY * scale,
    scale,
    width,
    height,
    mapWidth,
    mapHeight,
  });
}

export function moveCamera(camera, dx, dy) {
  return constrain({ ...camera, x: camera.x + dx, y: camera.y + dy });
}

export function centerCamera(camera) {
  return {
    ...camera,
    x: (camera.width - camera.mapWidth * camera.scale) / 2,
    y: (camera.height - camera.mapHeight * camera.scale) / 2,
  };
}
