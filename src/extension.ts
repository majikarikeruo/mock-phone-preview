import * as path from "path";
import * as vscode from "vscode";
import * as http from "http";
import * as os from "os";
import * as QRCode from "qrcode";
import * as fs from "fs";

let currentSession: PreviewSession | undefined;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mockPhonePreview.start",
      async (uri?: vscode.Uri) => {
        let document: vscode.TextDocument;

        if (uri) {
          // エクスプローラーから右クリックで実行された場合
          document = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(document, {
            preview: false,
            preserveFocus: false,
          });
        } else {
          // コマンドパレットやエディタから実行された場合
          const editor = vscode.window.activeTextEditor;
          if (!editor) {
            vscode.window.showInformationMessage(
              vscode.l10n.t("message.openHtmlFile")
            );
            return;
          }
          document = editor.document;
        }
        const isHtmlLanguage = document.languageId === "html";
        const isHtmlExtension = document.uri.fsPath.match(/\.(html?|xhtml)$/i);

        if (!isHtmlLanguage && !isHtmlExtension) {
          vscode.window.showWarningMessage(
            vscode.l10n.t("message.htmlOnly")
          );
          return;
        }

        if (document.isUntitled) {
          vscode.window.showWarningMessage(
            vscode.l10n.t("message.saveFile")
          );
          return;
        }

        await document.save();

        if (currentSession) {
          currentSession.dispose();
        }

        currentSession = new PreviewSession(context, document);
        context.subscriptions.push(currentSession);
      }
    )
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
  private httpServer: http.Server | undefined;
  private serverPort: number = 3000;
  private connectedClients: http.ServerResponse[] = [];
  private tempHtmlPath: string | undefined;
  private currentHtml: string = "";
  private localServerUrl: string = "";

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly htmlDocument: vscode.TextDocument
  ) {
    const column = vscode.window.activeTextEditor?.viewColumn;
    const title = `Mock Phone Preview — ${path.basename(
      htmlDocument.fileName
    )}`;

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      htmlDocument.uri
    );
    const localResourceRoots = [
      vscode.Uri.joinPath(context.extensionUri, "media"),
    ];
    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder.uri);
      console.log('[PreviewSession] Using workspace folder:', workspaceFolder.uri.fsPath);
    } else {
      const htmlDir = vscode.Uri.file(path.dirname(htmlDocument.uri.fsPath));
      localResourceRoots.push(htmlDir);
      console.log('[PreviewSession] Using HTML directory:', htmlDir.fsPath);
    }

    console.log('[PreviewSession] localResourceRoots:', localResourceRoots.map(r => r.fsPath));

    this.panel = vscode.window.createWebviewPanel(
      "mockPhonePreview",
      title,
      column ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots,
      }
    );

    this.panel.webview.html = this.getWebviewScaffold(this.panel.webview);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (!message || typeof message !== "object") {
          return;
        }

        if (message.type === "notify" && typeof message.message === "string") {
          const level =
            message.level === "warning"
              ? "warning"
              : message.level === "error"
              ? "error"
              : "info";
          if (level === "warning") {
            vscode.window.showWarningMessage(message.message);
          } else if (level === "error") {
            vscode.window.showErrorMessage(message.message);
          } else {
            vscode.window.showInformationMessage(message.message);
          }
        }

        if (message.type === "toggleServer") {
          if (message.enable) {
            await this.startExternalServer();
          } else {
            await this.stopExternalServer();
          }
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.matchesWatchedUri(event.document.uri)) {
          this.scheduleRefresh("change");
        }
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (this.matchesWatchedUri(document.uri)) {
          this.scheduleRefresh("save");
        }
      }),
      vscode.workspace.onDidDeleteFiles((event) => {
        for (const file of event.files) {
          if (this.matchesWatchedUri(file)) {
            vscode.window.showWarningMessage(
              vscode.l10n.t("message.fileDeleted", path.basename(file.fsPath))
            );
            this.scheduleRefresh("delete");
          }
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (
          event.textEditor.document.uri.toString() ===
          this.htmlDocument.uri.toString()
        ) {
          this.handleSelectionChange(event);
        }
      })
    );

    void this.startLocalServer().then(() => {
      console.log('[Constructor] Server started, calling refresh');
      void this.refresh();
    }).catch((error) => {
      console.error('[Constructor] Failed to start server:', error);
    });
  }

  dispose(): void {
    if (this.httpServer) {
      try {
        this.httpServer.close();
      } catch (error) {
        console.error('Failed to close server:', error);
      }
      this.httpServer = undefined;
    }

    this.connectedClients.forEach((client) => {
      try {
        client.end();
      } catch (error) {
        // ignore
      }
    });
    this.connectedClients = [];

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
      console.log('[refresh] Starting, localServerUrl:', this.localServerUrl);

      const htmlText = this.htmlDocument.getText();
      const stylesheetLinks = await this.collectStylesheets(htmlText);
      this.updateCssLinks(stylesheetLinks);

      const inlinedHtml = await this.composeHtml(htmlText, stylesheetLinks);
      this.currentHtml = inlinedHtml;

      console.log('[refresh] HTML composed, length:', inlinedHtml.length);

      const payload = {
        iframeSrc: this.localServerUrl,
        fileName: path.basename(this.htmlDocument.fileName),
        updatedAt: Date.now(),
      };

      console.log('[refresh] Sending payload:', payload);
      await this.panel.webview.postMessage({ type: "update", payload });

      // Notify connected mobile clients to reload
      this.notifyClientsToReload();
    } catch (error) {
      console.error('[refresh] Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        vscode.l10n.t("message.updateFailed", message)
      );
    }
  }

  private async collectStylesheets(
    htmlText: string
  ): Promise<StylesheetLink[]> {
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
      if (/^https?:/i.test(href) || href.startsWith("data:")) {
        continue;
      }

      const normalizedHref = href.split("#")[0];
      const resourcePart = normalizedHref.split("?")[0];

      const resolvedPath = path.resolve(
        path.dirname(this.htmlDocument.uri.fsPath),
        resourcePart
      );
      const cssUri = vscode.Uri.file(resolvedPath);

      try {
        const content = await this.getDocumentText(cssUri);
        links.push({ href, uri: cssUri, content });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(
          vscode.l10n.t("message.cssLoadFailed", href, message)
        );
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

  private async composeHtml(
    originalHtml: string,
    stylesheetLinks: StylesheetLink[]
  ): Promise<string> {
    let html = originalHtml;

    html = html.replace(/<base[^>]*>/gi, "");
    html = html.replace(/<link\s+[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "");

    const cssPromises = stylesheetLinks.map(async (link) => {
      return `/* ${path.basename(link.uri.fsPath)} */\n${link.content}`;
    });
    const inlinedStyles = (await Promise.all(cssPromises)).join("\n\n");

    const styleTag = stylesheetLinks.length
      ? `<style data-mockphone-inline>${inlinedStyles}</style>`
      : "";

    html = this.injectIntoHead(html, styleTag);

    return html;
  }


  private injectIntoHead(html: string, injection: string): string {
    const headOpenRegex = /<head[^>]*>/i;
    const htmlOpenRegex = /<html[^>]*>/i;

    if (headOpenRegex.test(html)) {
      return html.replace(headOpenRegex, (match) => `${match}\n${injection}\n`);
    }

    if (htmlOpenRegex.test(html)) {
      return html.replace(
        htmlOpenRegex,
        (match) => `${match}\n<head>\n${injection}\n</head>`
      );
    }

    return `<head>\n${injection}\n</head>\n${html}`;
  }



  private convertImagePaths(html: string): string {
    const htmlDir = path.dirname(this.htmlDocument.uri.fsPath);
    console.log('[convertImagePaths] HTML directory:', htmlDir);

    let imageCount = 0;
    // Convert <img src="...">
    html = html.replace(/<img\s+([^>]*)>/gi, (match, attrs) => {
      return `<img ${attrs.replace(
        /\bsrc\s*=\s*(["'])([^"']+)\1/gi,
        (srcMatch: string, quote: string, src: string) => {
          // Skip absolute URLs and data URIs
          if (/^(https?:|data:|\/\/)/i.test(src)) {
            console.log('[convertImagePaths] Skipping absolute URL:', src);
            return srcMatch;
          }
          const absolutePath = path.resolve(htmlDir, src);
          const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString();
          console.log(`[convertImagePaths] ${++imageCount}. Converting:`, src, '→', webviewUri);
          return `src=${quote}${webviewUri}${quote}`;
        }
      )}>`;
    });

    // Convert inline style background-image
    html = html.replace(
      /\bstyle\s*=\s*(["'])([^"']*)\1/gi,
      (match, quote, styleContent) => {
        const newStyle = styleContent.replace(
          /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
          (urlMatch: string, urlQuote: string, url: string) => {
            if (/^(https?:|data:|\/\/)/i.test(url)) {
              return urlMatch;
            }
            const absolutePath = path.resolve(htmlDir, url);
            const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString();
            return `url(${urlQuote}${webviewUri}${urlQuote})`;
          }
        );
        return `style=${quote}${newStyle}${quote}`;
      }
    );

    return html;
  }

  private convertCssUrls(css: string, cssUri: vscode.Uri): string {
    const cssDir = path.dirname(cssUri.fsPath);
    console.log('[convertCssUrls] CSS directory:', cssDir);

    let urlCount = 0;
    return css.replace(
      /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
      (match, quote, url) => {
        // Skip absolute URLs and data URIs
        if (/^(https?:|data:|#|\/\/)/i.test(url)) {
          return match;
        }
        const absolutePath = path.resolve(cssDir, url);
        const webviewUri = this.panel.webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString();
        console.log(`[convertCssUrls] ${++urlCount}. Converting:`, url, '→', webviewUri);
        return `url(${quote}${webviewUri}${quote})`;
      }
    );
  }

  private splitResourceSuffix(resource: string): [string, string] {
    const queryIndex = resource.indexOf("?");
    const hashIndex = resource.indexOf("#");
    let cutoff = resource.length;
    if (queryIndex !== -1) {
      cutoff = Math.min(cutoff, queryIndex);
    }
    if (hashIndex !== -1) {
      cutoff = Math.min(cutoff, hashIndex);
    }
    const base = resource.slice(0, cutoff);
    const suffix = cutoff < resource.length ? resource.slice(cutoff) : "";
    return [base, suffix];
  }

  private async getDocumentText(uri: vscode.Uri): Promise<string> {
    const openDocument = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === uri.toString()
    );
    if (openDocument) {
      return openDocument.getText();
    }

    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString("utf8");
  }

  private getWebviewScaffold(webview: vscode.Webview): string {
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "styles.css")
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js")
    );
    const nonce = this.generateNonce();

    // Prepare localized strings for webview
    const l10n = {
      device: vscode.l10n.t("ui.device"),
      wallpaper: vscode.l10n.t("ui.wallpaper"),
      image: vscode.l10n.t("ui.image"),
      frame: vscode.l10n.t("ui.frame"),
      externalPreview: vscode.l10n.t("ui.externalPreview"),
      rotate: vscode.l10n.t("ui.rotate"),
      qrTitle: vscode.l10n.t("ui.qrTitle"),
      qrHint: vscode.l10n.t("ui.qrHint"),
      status: vscode.l10n.t("ui.status"),
      close: vscode.l10n.t("ui.close"),
    };

    return `<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: http: blob: data:; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; style-src ${webview.cspSource} 'unsafe-inline'; frame-src ${webview.cspSource} http://127.0.0.1:*;" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${stylesUri}" />
    <title>Mock Phone Preview</title>
    <script nonce="${nonce}">window.l10n = ${JSON.stringify(l10n)};</script>
  </head>
  <body>
    <header class="top-bar">
      <div class="file-label" id="file-label">Mock Phone Preview</div>
      <div class="controls">
        <label class="control">
          <span data-l10n="device">${l10n.device}</span>
          <select id="device-select" class="input"></select>
        </label>
        <label class="control">
          <span data-l10n="wallpaper">${l10n.wallpaper}</span>
          <input id="wallpaper-input" class="input" type="color" value="#111827" />
        </label>
        <label class="control">
          <span data-l10n="image">${l10n.image}</span>
          <input id="wallpaper-image" class="input-file" type="file" accept="image/*" />
        </label>
        <label class="control control-inline">
          <span data-l10n="frame">${l10n.frame}</span>
          <input id="frame-toggle" class="switch" type="checkbox" checked />
        </label>
        <label class="control control-inline">
          <span data-l10n="externalPreview">${l10n.externalPreview}</span>
          <input id="server-toggle" class="switch" type="checkbox" />
        </label>
        <button id="rotate-btn" class="icon-button" title="${l10n.rotate}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
          </svg>
        </button>
      </div>
    </header>
    <main class="preview-stage">
      <div id="qr-panel" class="qr-panel" style="display: none;">
        <button id="qr-close-btn" class="qr-close-btn" title="${l10n.close}">×</button>
        <div class="qr-content">
          <h3 data-l10n="qrTitle">${l10n.qrTitle}</h3>
          <img id="qr-code" class="qr-code" alt="QR Code" />
          <div id="server-url" class="server-url"></div>
          <p class="qr-hint" data-l10n="qrHint">${l10n.qrHint}</p>
        </div>
      </div>
      <div id="wallpaper" class="wallpaper"></div>
      <div id="device-frame" class="device" data-device="iphone-14">
        <div id="preview-wrapper" class="preview-frame-wrapper">
          <iframe id="preview" class="preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
        <div id="frame-overlay" class="frame-overlay"></div>
      </div>
      <div class="status" id="status" data-l10n="status">${l10n.status}</div>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }

  private async startLocalServer(): Promise<void> {
    if (this.httpServer) {
      return;
    }

    try {
      this.httpServer = http.createServer((req, res) => {
        // Handle Server-Sent Events for auto-reload
        if (req.url === "/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          });
          res.write("data: connected\n\n");
          this.connectedClients.push(res);

          req.on("close", () => {
            const index = this.connectedClients.indexOf(res);
            if (index !== -1) {
              this.connectedClients.splice(index, 1);
            }
          });
          return;
        }

        // Serve HTML with auto-reload script
        if (req.url === "/" || req.url === "") {
          console.log('[HTTP Server] Serving HTML, currentHtml length:', this.currentHtml.length);

          if (!this.currentHtml) {
            console.warn('[HTTP Server] currentHtml is empty!');
            res.writeHead(503, { "Content-Type": "text/plain" });
            res.end("Preview not ready yet");
            return;
          }

          const autoReloadScript = `
<script>
(function() {
  const evtSource = new EventSource('/events');
  evtSource.onmessage = function(e) {
    if (e.data === 'reload') {
      window.location.reload();
    }
  };
  evtSource.onerror = function() {
    console.log('EventSource failed, retrying in 1s...');
    setTimeout(() => window.location.reload(), 1000);
  };
})();
</script>`;
          const htmlWithReload = this.currentHtml.replace(
            "</body>",
            `${autoReloadScript}</body>`
          );
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlWithReload);
          return;
        }

        // Serve other resources (images, etc.)
        const resourcePath = req.url?.slice(1) || "";
        const htmlDir = path.dirname(this.htmlDocument.uri.fsPath);
        const filePath = path.join(htmlDir, resourcePath);

        Promise.resolve(vscode.workspace.fs.readFile(vscode.Uri.file(filePath)))
          .then((data) => {
            const ext = path.extname(filePath).toLowerCase();
            const contentTypes: { [key: string]: string } = {
              ".html": "text/html",
              ".css": "text/css",
              ".js": "application/javascript",
              ".json": "application/json",
              ".png": "image/png",
              ".jpg": "image/jpeg",
              ".jpeg": "image/jpeg",
              ".gif": "image/gif",
              ".svg": "image/svg+xml",
              ".webp": "image/webp",
              ".ico": "image/x-icon",
            };
            const contentType = contentTypes[ext] || "application/octet-stream";
            res.writeHead(200, { "Content-Type": contentType });
            res.end(data);
          })
          .catch(() => {
            res.writeHead(404);
            res.end("Not Found");
          });
      });

      // Start server on all network interfaces (0.0.0.0)
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.once("error", reject);
        this.httpServer!.listen(this.serverPort, "0.0.0.0", () => {
          this.localServerUrl = `http://127.0.0.1:${this.serverPort}`;
          console.log('[startLocalServer] Server started:', this.localServerUrl);
          resolve();
        });
      });
    } catch (error: any) {
      console.error('[startLocalServer] Failed:', error);
      throw error;
    }
  }

  private getLocalIpAddress(): string | undefined {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;

      for (const addr of iface) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (addr.family === "IPv4" && !addr.internal) {
          return addr.address;
        }
      }
    }
    return undefined;
  }

  private async startExternalServer(): Promise<void> {
    const localIp = this.getLocalIpAddress();
    if (!localIp) {
      vscode.window.showErrorMessage(
        vscode.l10n.t("message.noLocalIp")
      );
      return;
    }

    try {
      const serverUrl = `http://${localIp}:${this.serverPort}`;
      const qrCodeDataUrl = await this.generateQRCode(serverUrl);

      await this.panel.webview.postMessage({
        type: "serverStarted",
        payload: {
          url: serverUrl,
          qrCode: qrCodeDataUrl,
        },
      });

      vscode.window.showInformationMessage(
        vscode.l10n.t("message.externalServer", serverUrl)
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        vscode.l10n.t("message.qrFailed", message)
      );
    }
  }

  private async stopExternalServer(): Promise<void> {
    try {
      void this.panel.webview.postMessage({
        type: "serverStopped",
      });
    } catch (error) {
      // Panel already disposed, ignore
    }
  }

  private async generateQRCode(url: string): Promise<string> {
    try {
      return await QRCode.toDataURL(url, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000",
          light: "#FFFFFF",
        },
      });
    } catch (error) {
      console.error("QR code generation failed:", error);
      throw error;
    }
  }

  private notifyClientsToReload(): void {
    this.connectedClients.forEach((client) => {
      try {
        client.write("data: reload\n\n");
      } catch (error) {
        // ignore
      }
    });
  }

  private handleSelectionChange(
    event: vscode.TextEditorSelectionChangeEvent
  ): void {
    const selection = event.selections[0];

    console.log(`[handleSelectionChange] isEmpty=${selection?.isEmpty}, kind=${event.kind}`);

    if (!selection || selection.isEmpty) {
      console.log('[handleSelectionChange] Selection is empty, clearing highlight');
      void this.panel.webview.postMessage({
        type: "clearHighlight",
      });
      return;
    }

    const selectedText = event.textEditor.document.getText(selection);
    const startLine = selection.start.line;
    const endLine = selection.end.line;

    // Extract tag name if selecting an HTML tag
    const tagMatch = selectedText.match(/<\s*(\w+)[^>]*>/);
    const tagName = tagMatch ? tagMatch[1] : null;

    console.log(`[handleSelectionChange] Sending: "${selectedText.substring(0, 50)}..." (${selectedText.length} chars), tagName=${tagName}`);

    void this.panel.webview.postMessage({
      type: "highlightSelection",
      payload: {
        selectedText: selectedText.trim(),
        tagName,
        startLine,
        endLine,
      },
    });
  }

  private generateNonce(): string {
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
