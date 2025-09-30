import * as path from 'path';
import * as vscode from 'vscode';

let currentSession: PreviewSession | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('mockPhonePreview.start', async (uri?: vscode.Uri) => {
      let document: vscode.TextDocument;

      if (uri) {
        // エクスプローラーから右クリックで実行された場合
        document = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
      } else {
        // コマンドパレットやエディタから実行された場合
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage('プレビューしたい HTML ファイルを開いてください。');
          return;
        }
        document = editor.document;
      }
      const isHtmlLanguage = document.languageId === 'html';
      const isHtmlExtension = document.uri.fsPath.match(/\.(html?|xhtml)$/i);

      if (!isHtmlLanguage && !isHtmlExtension) {
        vscode.window.showWarningMessage('Mock Phone Preview は HTML ファイル向けの機能です。');
        return;
      }

      if (document.isUntitled) {
        vscode.window.showWarningMessage('ファイルを保存してからプレビューを開始してください。');
        return;
      }

      await document.save();

      if (currentSession) {
        currentSession.dispose();
      }

      currentSession = new PreviewSession(context, document);
      context.subscriptions.push(currentSession);
    })
  );
}

export function deactivate(): void {
  if (currentSession) {
    currentSession.dispose();
    currentSession = undefined;
  }
}

type StylesheetLink = {
  href: string;
  uri: vscode.Uri;
  content: string;
};

class PreviewSession implements vscode.Disposable {
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly cssLinks: Map<string, StylesheetLink> = new Map();
  private updateTimer: NodeJS.Timeout | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly htmlDocument: vscode.TextDocument) {
    const column = vscode.window.activeTextEditor?.viewColumn;
    const title = `Mock Phone Preview — ${path.basename(htmlDocument.fileName)}`;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(htmlDocument.uri);
    const localResourceRoots = [vscode.Uri.joinPath(context.extensionUri, 'media')];
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder.uri);
    } else {
      localResourceRoots.push(vscode.Uri.file(path.dirname(htmlDocument.uri.fsPath)));
    }

    this.panel = vscode.window.createWebviewPanel(
      'mockPhonePreview',
      title,
      column ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots
      }
    );

    this.panel.webview.html = this.getWebviewScaffold(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(async message => {
        if (!message || typeof message !== 'object') {
          return;
        }

        if (message.type === 'notify' && typeof message.message === 'string') {
          const level = message.level === 'warning' ? 'warning' : message.level === 'error' ? 'error' : 'info';
          if (level === 'warning') {
            vscode.window.showWarningMessage(message.message);
          } else if (level === 'error') {
            vscode.window.showErrorMessage(message.message);
          } else {
            vscode.window.showInformationMessage(message.message);
          }
        }
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        if (this.matchesWatchedUri(event.document.uri)) {
          this.scheduleRefresh('change');
        }
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        if (this.matchesWatchedUri(document.uri)) {
          this.scheduleRefresh('save');
        }
      }),
      vscode.workspace.onDidDeleteFiles(event => {
        for (const file of event.files) {
          if (this.matchesWatchedUri(file)) {
            vscode.window.showWarningMessage(`${path.basename(file.fsPath)} が削除されたため、プレビューを更新できません。`);
            this.scheduleRefresh('delete');
          }
        }
      })
    );

    void this.refresh();
  }

  dispose(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = undefined;
    }

    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      try {
        disposable?.dispose();
      } catch (error) {
        console.error(error);
      }
    }

    try {
      this.panel.dispose();
    } catch (error) {
      // already disposed
    }

    currentSession = undefined;
  }

  private scheduleRefresh(_reason: string): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }

    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      void this.refresh();
    }, 150);
  }

  private matchesWatchedUri(uri: vscode.Uri): boolean {
    if (uri.toString() === this.htmlDocument.uri.toString()) {
      return true;
    }
    return this.cssLinks.has(uri.toString());
  }

  private async refresh(): Promise<void> {
    try {
      const htmlText = this.htmlDocument.getText();
      const stylesheetLinks = await this.collectStylesheets(htmlText);
      this.updateCssLinks(stylesheetLinks);

      const inlinedHtml = this.composeHtml(htmlText, stylesheetLinks);
      const payload = {
        html: inlinedHtml,
        fileName: path.basename(this.htmlDocument.fileName),
        updatedAt: Date.now()
      };

      await this.panel.webview.postMessage({ type: 'update', payload });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Mock Phone Preview の更新に失敗しました: ${message}`);
    }
  }

  private async collectStylesheets(htmlText: string): Promise<StylesheetLink[]> {
    const links: StylesheetLink[] = [];
    const regex = /<link\s+[^>]*rel=["']?stylesheet["']?[^>]*>/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(htmlText)) !== null) {
      const tag = match[0];
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i);
      if (!hrefMatch) {
        continue;
      }

      const href = hrefMatch[1].trim();
      if (/^https?:/i.test(href) || href.startsWith('data:')) {
        continue;
      }

      const normalizedHref = href.split('#')[0];
      const resourcePart = normalizedHref.split('?')[0];

      const resolvedPath = path.resolve(path.dirname(this.htmlDocument.uri.fsPath), resourcePart);
      const cssUri = vscode.Uri.file(resolvedPath);

      try {
        const content = await this.getDocumentText(cssUri);
        links.push({ href, uri: cssUri, content });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(`CSS を読み込めませんでした: ${href} (${message})`);
      }
    }

    return links;
  }

  private updateCssLinks(links: StylesheetLink[]): void {
    this.cssLinks.clear();
    for (const link of links) {
      this.cssLinks.set(link.uri.toString(), link);
    }
  }

  private composeHtml(originalHtml: string, stylesheetLinks: StylesheetLink[]): string {
    let html = originalHtml;

    html = html.replace(/<base[^>]*>/gi, '');
    html = html.replace(/<link\s+[^>]*rel=["']?stylesheet["']?[^>]*>/gi, '');

    const baseHref = this.panel.webview.asWebviewUri(this.htmlDocument.uri).toString();
    const baseTag = `<base href="${baseHref}">`;

    const inlinedStyles = stylesheetLinks
      .map(link => {
        const rewrittenCss = this.rewriteCssUrls(link.content, link.uri);
        return `/* ${path.basename(link.uri.fsPath)} */\n${rewrittenCss}`;
      })
      .join('\n\n');

    const styleTag = stylesheetLinks.length
      ? `<style data-mockphone-inline>${inlinedStyles}</style>`
      : '';

    html = this.injectIntoHead(html, baseTag + styleTag);

    return html;
  }

  private injectIntoHead(html: string, injection: string): string {
    const headOpenRegex = /<head[^>]*>/i;
    const htmlOpenRegex = /<html[^>]*>/i;

    if (headOpenRegex.test(html)) {
      return html.replace(headOpenRegex, match => `${match}\n${injection}\n`);
    }

    if (htmlOpenRegex.test(html)) {
      return html.replace(htmlOpenRegex, match => `${match}\n<head>\n${injection}\n</head>`);
    }

    return `<head>\n${injection}\n</head>\n${html}`;
  }

  private rewriteCssUrls(content: string, cssUri: vscode.Uri): string {
    const urlRegex = /url\(\s*(["']?)([^"')]+)\1\s*\)/gi;
    return content.replace(urlRegex, (_match, quote: string, rawUrl: string) => {
      const trimmed = rawUrl.trim();
      if (!trimmed || /^([a-z]+:|#)/i.test(trimmed)) {
        return `url(${quote}${trimmed}${quote})`;
      }

      const [resourcePath, suffix] = this.splitResourceSuffix(trimmed);
      const absolutePath = path.resolve(path.dirname(cssUri.fsPath), resourcePath);
      const assetUri = vscode.Uri.file(absolutePath);
      const webviewUri = this.panel.webview.asWebviewUri(assetUri).toString();
      return `url('${webviewUri}${suffix}')`;
    });
  }

  private splitResourceSuffix(resource: string): [string, string] {
    const queryIndex = resource.indexOf('?');
    const hashIndex = resource.indexOf('#');
    let cutoff = resource.length;
    if (queryIndex !== -1) {
      cutoff = Math.min(cutoff, queryIndex);
    }
    if (hashIndex !== -1) {
      cutoff = Math.min(cutoff, hashIndex);
    }
    const base = resource.slice(0, cutoff);
    const suffix = cutoff < resource.length ? resource.slice(cutoff) : '';
    return [base, suffix];
  }

  private async getDocumentText(uri: vscode.Uri): Promise<string> {
    const openDocument = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (openDocument) {
      return openDocument.getText();
    }

    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  }

  private getWebviewScaffold(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const nonce = this.generateNonce();

    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob: data:; script-src 'nonce-${nonce}'; style-src ${webview.cspSource} 'unsafe-inline';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${stylesUri}" />
    <title>Mock Phone Preview</title>
  </head>
  <body>
    <header class="top-bar">
      <div class="file-label" id="file-label">Mock Phone Preview</div>
      <div class="controls">
        <label class="control">
          <span>Device</span>
          <select id="device-select" class="input"></select>
        </label>
        <label class="control">
          <span>Wallpaper</span>
          <input id="wallpaper-input" class="input" type="color" value="#111827" />
        </label>
        <label class="control">
          <span>Image</span>
          <input id="wallpaper-image" class="input-file" type="file" accept="image/*" />
        </label>
        <label class="control control-inline">
          <span>Frame</span>
          <input id="frame-toggle" class="switch" type="checkbox" checked />
        </label>
      </div>
    </header>
    <main class="preview-stage">
      <div id="wallpaper" class="wallpaper"></div>
      <div id="device-frame" class="device" data-device="iphone-14">
        <div id="preview-wrapper" class="preview-frame-wrapper">
          <iframe id="preview" class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
        <div id="frame-overlay" class="frame-overlay"></div>
      </div>
      <div class="status" id="status">プレビューの準備中…</div>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private generateNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
