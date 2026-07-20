import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('anyrealm.openArchitect', () => {
      const panel = vscode.window.createWebviewPanel(
        'anyrealm-architect',
        'AnyRealm ROM Architect',
        vscode.ViewColumn.Two,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AnyRealm</title>
          </head>
          <body style="margin:0; padding:0; height:100vh;">
            <iframe src="http://localhost:3000" style="width:100%; height:100%; border:none;"></iframe>
          </body>
        </html>
      `;
    })
  );
}

export function deactivate() {}
