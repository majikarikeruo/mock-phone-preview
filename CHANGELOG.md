# Change Log

All notable changes to the "Mock Phone Preview" extension will be documented in this file.

## [1.0.0] - 2025-10-15

### 🎉 Initial Release

#### ✨ Features
- **Device Frame Preview**: View HTML/CSS in realistic mobile device frames (iPhone 15 Pro/Max, Galaxy S24 Ultra, Pixel 9 Pro)
- **QR Code Preview**: Generate QR codes to test on actual mobile devices with live reload
- **Image Support**: Full support for images via `<img>` tags and CSS `background-image` with automatic path conversion
- **Real-time Updates**: Automatically refreshes preview as you edit HTML/CSS files
- **CSS Inline Processing**: Automatically inlines external stylesheets for accurate rendering
- **Customizable Wallpapers**: Choose background colors or upload custom images
- **Frame Toggle**: Show/hide device bezels and notches
- **Device Rotation**: Switch between portrait and landscape orientations
- **Multi-language Support**: English and Japanese (日本語) interface
- **Session Persistence**: Remembers device selection and wallpaper settings

#### 🚀 Performance
- Optimized bundle size: **39KB** (96% reduction from initial build)
- Webpack bundling for fast startup
- Only 11 files in distribution package

#### 🌍 Internationalization
- English localization (default)
- Japanese localization (日本語)
- Automatic language detection based on VS Code settings

#### 🔒 Security & Privacy
- All processing happens locally
- External preview server only accessible on local network
- No data sent to external servers

---

**Note**: This is the first stable release of Mock Phone Preview. Please report any issues on [GitHub](https://github.com/majikarikeruo/mock-phone-preview/issues).
