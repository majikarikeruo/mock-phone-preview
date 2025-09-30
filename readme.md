# Mock Phone Preview

Live phone-framed preview for HTML/CSS inside VSCode. View your web pages inside realistic device frames with real-time updates.

## Features

- **Real-time Preview**: Automatically updates as you edit HTML/CSS files
- **Realistic Device Frames**: Choose from latest flagship devices
  - iPhone 15 Pro / Pro Max
  - Galaxy S24 Ultra
  - Pixel 9 Pro
- **Customizable Wallpaper**: Set background color or upload custom images
- **Frame Toggle**: Show/hide device bezels and notches
- **Session Persistence**: Remembers your device and wallpaper settings

## Usage

**Easy way (Recommended for beginners):**
1. Right-click on any HTML file in the Explorer or Editor
2. Select `Preview in Phone Frame`
3. Edit your HTML/CSS and see changes in real-time

**Alternative way:**
1. Open an HTML file in VSCode
2. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
3. Run `Preview in Phone Frame`

## Controls

- **Device**: Select device model (iPhone, Galaxy, Pixel)
- **Wallpaper**: Choose background color with color picker
- **Image**: Upload custom wallpaper image
- **Frame**: Toggle device bezels and notches on/off

## Requirements

- VSCode 1.86.0 or higher
- HTML file saved to disk (untitled files not supported)

## Installation

### From VSIX
1. Download the `.vsix` file
2. Open VSCode
3. Go to Extensions view (`Cmd+Shift+X` / `Ctrl+Shift+X`)
4. Click `...` menu → `Install from VSIX...`
5. Select the downloaded file

### From Source
```bash
npm install
npm run compile
```
Press `F5` to run in Extension Development Host

## Known Limitations

- Screenshot feature removed (use OS screenshot tools instead)
- CSS `url()` paths must be relative to HTML file
- Live Share collaborative preview not yet implemented

## Contributing

Contributions welcome! Please open an issue or pull request on GitHub.

## License

MIT License - see LICENSE file for details

## Author

Created by **Tatsuya Kosuge**

## Credits

Device specifications based on:
- Apple Developer Human Interface Guidelines
- Android device size reference (genz.jp)
