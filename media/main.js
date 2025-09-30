(function () {
  const vscode = acquireVsCodeApi();

  const DEVICES = {
    'iphone-15-pro': {
      label: 'iPhone 15 Pro',
      viewport: { width: 393, height: 852, radius: 36, bezel: 18 },
      physical: { width: 1179, height: 2556 },
      devicePixelRatio: 3,
      notch: { width: 126, height: 36, radius: 18, offset: 16, opacity: 1 }
    },
    'iphone-15-pro-max': {
      label: 'iPhone 15 Pro Max',
      viewport: { width: 430, height: 932, radius: 38, bezel: 18 },
      physical: { width: 1290, height: 2796 },
      devicePixelRatio: 3,
      notch: { width: 132, height: 36, radius: 18, offset: 18, opacity: 1 }
    },
    'galaxy-s24-ultra': {
      label: 'Galaxy S24 Ultra',
      viewport: { width: 412, height: 915, radius: 34, bezel: 16 },
      physical: { width: 1440, height: 3120 },
      devicePixelRatio: 3.5,
      notch: { width: 24, height: 24, radius: '50%', offset: 16, opacity: 1 }
    },
    'pixel-9-pro': {
      label: 'Pixel 9 Pro',
      viewport: { width: 427, height: 952, radius: 32, bezel: 16 },
      physical: { width: 1280, height: 2856 },
      devicePixelRatio: 3,
      notch: { width: 20, height: 20, radius: '50%', offset: 18, opacity: 1 }
    }
  };

  const DEFAULT_STATE = {
    device: 'iphone-15-pro',
    wallpaper: '#111827',
    wallpaperImage: null,
    frame: true
  };

  const state = Object.assign({}, DEFAULT_STATE, vscode.getState());

  const deviceSelect = document.getElementById('device-select');
  const wallpaperInput = document.getElementById('wallpaper-input');
  const wallpaperImageInput = document.getElementById('wallpaper-image');
  const frameToggle = document.getElementById('frame-toggle');
  const deviceFrame = document.getElementById('device-frame');
  const wallpaperLayer = document.getElementById('wallpaper');
  const frameOverlay = document.getElementById('frame-overlay');
  const previewWrapper = document.getElementById('preview-wrapper');
  const previewFrame = document.getElementById('preview');
  const fileLabel = document.getElementById('file-label');
  const statusLabel = document.getElementById('status');

  function populateDeviceOptions() {
    deviceSelect.innerHTML = '';
    Object.entries(DEVICES).forEach(([value, device]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = device.label;
      deviceSelect.appendChild(option);
    });
  }

  function applyDevicePreset(deviceKey) {
    const preset = DEVICES[deviceKey] || DEVICES[DEFAULT_STATE.device];
    const viewport = resolveViewport(preset);
    const notch = preset.notch || {};

    deviceFrame.dataset.device = deviceKey;
    deviceFrame.style.setProperty('--device-width', `${viewport.width}px`);
    deviceFrame.style.setProperty('--device-height', `${viewport.height}px`);
    deviceFrame.style.setProperty('--device-radius', `${viewport.radius}px`);
    deviceFrame.style.setProperty('--device-bezel', `${viewport.bezel}px`);
    deviceFrame.style.setProperty('--notch-width', formatUnit(notch.width, 'px'));
    deviceFrame.style.setProperty('--notch-height', formatUnit(notch.height, 'px'));
    deviceFrame.style.setProperty('--notch-radius', formatUnit(notch.radius, 'px'));
    deviceFrame.style.setProperty('--notch-offset', formatUnit(notch.offset, 'px'));
    deviceFrame.style.setProperty('--notch-opacity', notch.opacity != null ? String(notch.opacity) : notch.width ? '1' : '0');
  }

  function applyWallpaper(value, imageDataUrl = null) {
    state.wallpaper = value;
    if (imageDataUrl !== undefined) {
      state.wallpaperImage = imageDataUrl;
    }

    console.log('[applyWallpaper]', { value, hasImage: !!state.wallpaperImage, imageLength: state.wallpaperImage?.length });

    const rgb = hexToRgb(value);
    const strong = toRgba(rgb, 0.82);
    const medium = toRgba(rgb, 0.38);
    const soft = toRgba(rgb, 0.18);
    const faint = toRgba(rgb, 0.08);

    if (state.wallpaperImage) {
      const imageUrl = state.wallpaperImage.substring(0, 50) + '...';
      console.log('[wallpaper] Setting image:', imageUrl);
      wallpaperLayer.style.backgroundImage = `url("${state.wallpaperImage}")`;
      wallpaperLayer.style.backgroundSize = 'cover';
      wallpaperLayer.style.backgroundPosition = 'center';
      wallpaperLayer.style.backgroundRepeat = 'no-repeat';
      wallpaperLayer.style.backgroundColor = 'transparent';
      wallpaperLayer.style.opacity = 1;
    } else {
      console.log('[wallpaper] Setting color:', strong);
      wallpaperLayer.style.backgroundImage = 'none';
      wallpaperLayer.style.backgroundColor = strong;
      wallpaperLayer.style.opacity = 1;
    }

    deviceFrame.style.setProperty('--wallpaper-color', medium);
    previewWrapper.style.setProperty('--wallpaper-tint', soft);
    previewWrapper.style.background = faint;
    previewFrame.style.background = toRgba(rgb, 0.04);

    document.body.style.background = `radial-gradient(circle at 30% 22%, ${toRgba(rgb, 0.55)}, ${toRgba(rgb, 0.22)} 55%, #050b1a 100%)`;
  }

  function toggleFrame(enable) {
    state.frame = enable;
    frameOverlay.style.display = enable ? 'block' : 'none';
  }

  function setStatus(message) {
    const preset = DEVICES[state.device];
    if (!preset) {
      statusLabel.textContent = message;
      return;
    }

    const viewport = resolveViewport(preset);
    const physical = preset.physical ? ` / ${preset.physical.width}×${preset.physical.height}px` : '';
    const ratio = preset.devicePixelRatio ? ` @${preset.devicePixelRatio}x` : '';
    statusLabel.textContent = `${message} • ${preset.label} ${viewport.width}×${viewport.height}px (CSS)${physical}${ratio}`;
  }

  function handlePreviewUpdate(payload) {
    if (payload.fileName) {
      fileLabel.textContent = payload.fileName;
      document.title = `Mock Phone Preview — ${payload.fileName}`;
    }

    if (payload.html) {
      previewFrame.srcdoc = payload.html;
    }

    if (payload.updatedAt) {
      const date = new Date(payload.updatedAt);
      setStatus(`Updated: ${date.toLocaleTimeString()}`);
    } else {
      setStatus('Updated');
    }
  }

  function persistState() {
    vscode.setState(state);
  }


  function resolveViewport(preset) {
    const base = preset.viewport || {};
    const width = base.width ?? Math.round((preset.physical?.width || 1179) / (preset.devicePixelRatio || 3));
    const height = base.height ?? Math.round((preset.physical?.height || 2556) / (preset.devicePixelRatio || 3));
    const radius = base.radius ?? 36;
    const bezel = base.bezel ?? 18;
    return { width, height, radius, bezel };
  }

  function formatUnit(value, defaultUnit) {
    if (value == null) {
      return '0px';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number') {
      return `${value}${defaultUnit}`;
    }
    return '0px';
  }

  function hexToRgb(value) {
    let hex = value.replace('#', '').trim();
    if (hex.length === 3) {
      hex = hex.split('').map(ch => ch + ch).join('');
    }
    const int = parseInt(hex, 16);
    if (Number.isNaN(int)) {
      return { r: 17, g: 24, b: 39 };
    }
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255
    };
  }

  function toRgba(rgb, alpha) {
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }

  function bootstrap() {
    populateDeviceOptions();

    deviceSelect.value = state.device;
    wallpaperInput.value = state.wallpaper.startsWith('#') ? state.wallpaper : '#111827';
    frameToggle.checked = state.frame;

    applyDevicePreset(state.device);
    applyWallpaper(state.wallpaper, state.wallpaperImage);
    toggleFrame(state.frame);

    setStatus('プレビューの読み込みを待機しています…');

    deviceSelect.addEventListener('change', () => {
      state.device = deviceSelect.value;
      applyDevicePreset(state.device);
      persistState();
    });

    wallpaperInput.addEventListener('input', () => {
      applyWallpaper(wallpaperInput.value, null);
      wallpaperImageInput.value = '';
      persistState();
    });

    wallpaperImageInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      console.log('[wallpaperImageInput] File selected:', file);
      if (!file) {
        return;
      }

      if (!file.type.startsWith('image/')) {
        vscode.postMessage({ type: 'notify', level: 'warning', message: '画像ファイルを選択してください。' });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result;
        console.log('[FileReader] onload, dataUrl length:', dataUrl?.length);
        if (typeof dataUrl === 'string') {
          applyWallpaper(state.wallpaper, dataUrl);
          persistState();
          console.log('[wallpaperImageInput] Applied and persisted');
        }
      };
      reader.onerror = (err) => {
        console.error('[FileReader] error:', err);
        vscode.postMessage({ type: 'notify', level: 'error', message: '画像の読み込みに失敗しました。' });
      };
      reader.readAsDataURL(file);
    });

    frameToggle.addEventListener('change', () => {
      toggleFrame(frameToggle.checked);
      persistState();
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message) {
        return;
      }

      if (message.type === 'update' && message.payload) {
        handlePreviewUpdate(message.payload);
      }
    });
  }

  bootstrap();
})();
