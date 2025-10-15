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
    frame: true,
    rotated: false,
    darkMode: 'system'
  };

  const state = Object.assign({}, DEFAULT_STATE, vscode.getState());

  const deviceSelect = document.getElementById('device-select');
  const wallpaperInput = document.getElementById('wallpaper-input');
  const wallpaperImageInput = document.getElementById('wallpaper-image');
  const frameToggle = document.getElementById('frame-toggle');
  const serverToggle = document.getElementById('server-toggle');
  const rotateBtn = document.getElementById('rotate-btn');
  const deviceFrame = document.getElementById('device-frame');
  const wallpaperLayer = document.getElementById('wallpaper');
  const frameOverlay = document.getElementById('frame-overlay');
  const previewWrapper = document.getElementById('preview-wrapper');
  const previewFrame = document.getElementById('preview');
  const fileLabel = document.getElementById('file-label');
  const statusLabel = document.getElementById('status');
  const qrPanel = document.getElementById('qr-panel');
  const qrCode = document.getElementById('qr-code');
  const serverUrl = document.getElementById('server-url');
  const qrCloseBtn = document.getElementById('qr-close-btn');

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

  function toggleRotation() {
    state.rotated = !state.rotated;

    if (state.rotated) {
      deviceFrame.classList.add('rotated');
    } else {
      deviceFrame.classList.remove('rotated');
    }

    persistState();
  }

  function cycleDarkMode() {
    console.log('[cycleDarkMode] Current mode:', state.darkMode);
    const modes = ['system', 'light', 'dark'];
    const currentIndex = modes.indexOf(state.darkMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    state.darkMode = modes[nextIndex];
    console.log('[cycleDarkMode] New mode:', state.darkMode);

    applyDarkMode(state.darkMode);
    persistState();
  }

  function applyDarkMode(mode) {
    console.log('[applyDarkMode] Mode:', mode, 'iframe:', !!previewFrame, 'contentDoc:', !!previewFrame?.contentDocument);
    try {
      const iframe = previewFrame;
      if (!iframe || !iframe.contentDocument) {
        console.warn('[applyDarkMode] iframe or contentDocument not available');
        return;
      }

      const doc = iframe.contentDocument;
      console.log('[applyDarkMode] Applying to document');

      // Remove existing dark mode style
      const existingStyle = doc.getElementById('mockphone-darkmode-style');
      if (existingStyle) {
        existingStyle.remove();
      }

      if (mode === 'system') {
        // No override, use system preference - just remove the override style
        console.log('[applyDarkMode] System mode - removed override');
        return;
      }

      // Inject dark mode override
      const style = doc.createElement('style');
      style.id = 'mockphone-darkmode-style';

      if (mode === 'dark') {
        style.textContent = `
          :root {
            color-scheme: dark !important;
            --bg-color: #1a1a1a !important;
            --text-color: #ffffff !important;
          }
          body {
            background-color: #1a1a1a !important;
            color: #ffffff !important;
          }
        `;
      } else if (mode === 'light') {
        style.textContent = `
          :root {
            color-scheme: light !important;
            --bg-color: #ffffff !important;
            --text-color: #000000 !important;
          }
          body {
            background-color: #ffffff !important;
            color: #000000 !important;
          }
        `;
      }

      doc.head.appendChild(style);

      // Update button appearance and tooltip
      if (mode === 'dark') {
        themeToggle.style.color = '#fbbf24'; // Yellow for dark mode
        themeToggle.title = 'ダークモード (次: システム)';
      } else if (mode === 'light') {
        themeToggle.style.color = '#60a5fa'; // Blue for light mode
        themeToggle.title = 'ライトモード (次: ダーク)';
      } else {
        themeToggle.style.color = '#9ca3af'; // Gray for system
        themeToggle.title = 'システム設定 (次: ライト)';
      }

      console.log('[applyDarkMode] Button updated, color:', themeToggle.style.color);
    } catch (error) {
      console.error('[applyDarkMode] Error:', error);
    }
  }

  function takeScreenshot() {
    console.log('[takeScreenshot] Starting, html2canvas available:', typeof html2canvas !== 'undefined');
    try {
      // Use html2canvas to capture the device frame
      if (typeof html2canvas === 'undefined') {
        console.log('[takeScreenshot] Loading html2canvas...');
        vscode.postMessage({
          type: 'notify',
          level: 'info',
          message: 'スクリーンショット機能を初期化中です。もう一度お試しください。'
        });

        // Load html2canvas dynamically
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        script.onload = () => {
          console.log('[takeScreenshot] html2canvas loaded');
          vscode.postMessage({
            type: 'notify',
            level: 'info',
            message: 'スクリーンショット機能の準備ができました。もう一度お試しください。'
          });
        };
        script.onerror = (err) => {
          console.error('[takeScreenshot] Failed to load html2canvas:', err);
        };
        document.head.appendChild(script);
        return;
      }

      console.log('[takeScreenshot] Capturing deviceFrame...');

      screenshotBtn.disabled = true;
      setStatus('スクリーンショットを撮影中...');

      // Clone iframe content to make it capturable
      const iframe = previewFrame;
      let clonedContent = null;
      let originalDisplay = null;

      try {
        if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
          console.log('[takeScreenshot] Cloning iframe content...');

          // Hide the iframe temporarily
          originalDisplay = previewWrapper.style.display;
          previewWrapper.style.display = 'none';

          // Clone the iframe content
          const iframeBody = iframe.contentDocument.body;
          const iframeHead = iframe.contentDocument.head;

          clonedContent = document.createElement('div');
          clonedContent.id = 'screenshot-clone';
          clonedContent.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
          `;

          // Copy styles from iframe
          const styles = Array.from(iframeHead.querySelectorAll('style, link[rel="stylesheet"]'));
          styles.forEach(style => {
            clonedContent.appendChild(style.cloneNode(true));
          });

          // Copy body content
          const bodyClone = iframeBody.cloneNode(true);
          const bodyStyle = window.getComputedStyle(iframeBody);
          Object.assign(bodyClone.style, {
            margin: bodyStyle.margin,
            padding: bodyStyle.padding,
            backgroundColor: bodyStyle.backgroundColor,
            color: bodyStyle.color,
          });
          clonedContent.appendChild(bodyClone);

          previewWrapper.appendChild(clonedContent);
        }
      } catch (err) {
        console.error('[takeScreenshot] Failed to clone iframe:', err);
      }

      html2canvas(deviceFrame, {
        backgroundColor: null,
        scale: 2,
        logging: true,
        useCORS: true
      }).then(canvas => {
        console.log('[takeScreenshot] Canvas created:', canvas.width, 'x', canvas.height);

        // Restore original state
        if (clonedContent) {
          clonedContent.remove();
        }
        if (originalDisplay !== null) {
          previewWrapper.style.display = originalDisplay;
        }

        // Convert to blob and download
        canvas.toBlob(blob => {
          console.log('[takeScreenshot] Blob created:', blob);

          if (!blob) {
            console.error('[takeScreenshot] Blob is null!');
            screenshotBtn.disabled = false;
            vscode.postMessage({
              type: 'notify',
              level: 'error',
              message: 'スクリーンショットの生成に失敗しました。'
            });
            return;
          }

          const url = URL.createObjectURL(blob);
          console.log('[takeScreenshot] Download URL:', url);

          const a = document.createElement('a');
          a.href = url;
          a.download = `mockphone-${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          screenshotBtn.disabled = false;
          setStatus('スクリーンショット保存完了');
          console.log('[takeScreenshot] Download triggered');
        }, 'image/png');
      }).catch(error => {
        console.error('[takeScreenshot] html2canvas error:', error);

        // Restore original state on error
        if (clonedContent) {
          clonedContent.remove();
        }
        if (originalDisplay !== null) {
          previewWrapper.style.display = originalDisplay;
        }

        screenshotBtn.disabled = false;
        vscode.postMessage({
          type: 'notify',
          level: 'error',
          message: 'スクリーンショットの撮影に失敗しました: ' + error.message
        });
      });
    } catch (error) {
      console.error('[takeScreenshot] Error:', error);
      screenshotBtn.disabled = false;
    }
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

    if (payload.iframeSrc) {
      console.log('[handlePreviewUpdate] Setting iframe src:', payload.iframeSrc);
      previewFrame.src = payload.iframeSrc;
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
    console.log('[bootstrap] Starting...');
    console.log('[bootstrap] Elements:', {
      deviceSelect: !!deviceSelect,
      wallpaperInput: !!wallpaperInput,
      frameToggle: !!frameToggle,
      serverToggle: !!serverToggle,
      rotateBtn: !!rotateBtn
    });

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

    serverToggle.addEventListener('change', () => {
      vscode.postMessage({
        type: 'toggleServer',
        enable: serverToggle.checked
      });
    });

    if (rotateBtn) {
      console.log('[bootstrap] Attaching rotate button listener');
      rotateBtn.addEventListener('click', () => {
        console.log('[rotateBtn] Clicked!');
        toggleRotation();
      });
    } else {
      console.error('[bootstrap] rotateBtn element not found!');
    }

    if (qrCloseBtn) {
      qrCloseBtn.addEventListener('click', () => {
        qrPanel.style.display = 'none';
        serverToggle.checked = false;
        vscode.postMessage({
          type: 'toggleServer',
          enable: false
        });
      });
    }

    // Apply initial rotation
    if (state.rotated) {
      deviceFrame.classList.add('rotated');
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (!message) {
        return;
      }

      if (message.type === 'update' && message.payload) {
        handlePreviewUpdate(message.payload);
      }

      if (message.type === 'serverStarted' && message.payload) {
        qrCode.src = message.payload.qrCode;
        serverUrl.textContent = message.payload.url;
        qrPanel.style.display = 'flex';
        setStatus('サーバー起動中 • 実機プレビュー有効');
      }

      if (message.type === 'serverStopped') {
        qrPanel.style.display = 'none';
        serverToggle.checked = false;
        setStatus('サーバー停止');
      }

      if (message.type === 'highlightSelection' && message.payload) {
        highlightElementInPreview(message.payload);
      }

      if (message.type === 'clearHighlight') {
        clearHighlightInPreview();
      }
    });
  }

  function highlightElementInPreview(payload) {
    try {
      console.log('[highlightElementInPreview] Payload:', payload);
      const iframe = previewFrame;
      if (!iframe || !iframe.contentDocument) {
        console.warn('[highlightElementInPreview] No iframe or contentDocument');
        return;
      }

      const doc = iframe.contentDocument;

      // Remove previous highlights
      clearHighlightInPreview();

      // Inject highlight styles if not already present
      if (!doc.getElementById('mockphone-highlight-styles')) {
        const style = doc.createElement('style');
        style.id = 'mockphone-highlight-styles';
        style.textContent = `
          @keyframes mockphone-highlight-pulse {
            0%, 100% { outline-color: #3b82f6; background: rgba(59, 130, 246, 0.15); }
            50% { outline-color: #60a5fa; background: rgba(59, 130, 246, 0.25); }
          }

          .mockphone-highlight {
            outline: 4px solid #3b82f6 !important;
            outline-offset: 3px !important;
            background: rgba(59, 130, 246, 0.2) !important;
            animation: mockphone-highlight-pulse 1.5s ease-in-out infinite !important;
            position: relative !important;
            z-index: 9999 !important;
            box-shadow: 0 0 20px rgba(59, 130, 246, 0.5) !important;
          }
        `;
        doc.head.appendChild(style);
      }

      if (!payload.selectedText) {
        console.warn('[highlightElementInPreview] No selectedText in payload');
        return;
      }

      const searchText = payload.selectedText.trim();
      const searchTextLower = searchText.toLowerCase();

      console.log('[highlightElementInPreview] Searching for:', searchText, 'tagName:', payload.tagName);

      // Strategy 1: If a full tag was selected, highlight that element
      if (payload.tagName) {
        const elements = doc.getElementsByTagName(payload.tagName);
        console.log('[highlightElementInPreview] Found', elements.length, 'elements with tag:', payload.tagName);

        // Extract text content from selected HTML (remove tags)
        const textWithoutTags = searchText.replace(/<[^>]*>/g, '').trim().toLowerCase();
        console.log('[highlightElementInPreview] Text without tags:', textWithoutTags);

        let bestMatch = null;
        let bestMatchSize = Infinity;

        for (let i = 0; i < elements.length; i++) {
          const elementText = elements[i].textContent?.toLowerCase().trim() || '';

          // Check if textContent contains the search text (without HTML tags)
          if (textWithoutTags && elementText.includes(textWithoutTags)) {
            const size = elementText.length;
            if (size < bestMatchSize) {
              bestMatch = elements[i];
              bestMatchSize = size;
            }
          }
        }

        if (bestMatch) {
          bestMatch.classList.add('mockphone-highlight');
          bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
          console.log('[highlightElementInPreview] Strategy 1: Highlighted element:', bestMatch.tagName, 'with text:', bestMatch.textContent?.substring(0, 30));
          return;
        } else {
          console.warn('[highlightElementInPreview] Strategy 1: No matching element found for tag:', payload.tagName);
        }
      }

      // Strategy 2: Text-only selection - find the smallest containing element
      console.log('[highlightElementInPreview] Strategy 2: Finding smallest element containing text');

      const allElements = doc.body.getElementsByTagName('*');
      let bestMatch = null;
      let bestMatchSize = Infinity;

      for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];

        // Skip non-visible elements
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD'].includes(element.tagName)) {
          continue;
        }

        const elementText = element.textContent?.toLowerCase().trim() || '';

        // Check if this element contains the search text
        if (elementText.includes(searchTextLower)) {
          const size = elementText.length;

          // Find the smallest element that contains the text
          if (size < bestMatchSize) {
            // Make sure this is a leaf-like element (not too many children)
            const childCount = element.children.length;
            if (childCount <= 3 || element.tagName === 'P' || element.tagName === 'H1' ||
                element.tagName === 'H2' || element.tagName === 'H3' || element.tagName === 'LI' ||
                element.tagName === 'BUTTON' || element.tagName === 'A') {
              bestMatchSize = size;
              bestMatch = element;
            }
          }
        }
      }

      if (bestMatch) {
        bestMatch.classList.add('mockphone-highlight');
        bestMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        console.log('[highlightElementInPreview] Strategy 2: Highlighted smallest element:', bestMatch.tagName, 'size:', bestMatchSize, 'children:', bestMatch.children.length);
      } else {
        console.warn('[highlightElementInPreview] No element found to highlight');
      }
    } catch (error) {
      console.error('[highlightElementInPreview] Error:', error);
    }
  }

  function clearHighlightInPreview() {
    try {
      const iframe = previewFrame;
      if (!iframe || !iframe.contentDocument) {
        return;
      }

      const doc = iframe.contentDocument;

      // Remove element highlights
      const highlighted = doc.querySelectorAll('.mockphone-highlight');
      highlighted.forEach(el => {
        el.classList.remove('mockphone-highlight');
      });
    } catch (error) {
      console.error('[clearHighlightInPreview] Error:', error);
    }
  }

  bootstrap();
})();
