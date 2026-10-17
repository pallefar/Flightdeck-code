export const WORKFLOW_CSS=`
.wf-editor{--wf-bg:var(--bg,#f3f6f7);--wf-panel:var(--surface,#fff);--wf-surface2:var(--surface2,#f8fafb);--wf-border:var(--line,#d5dfe5);--wf-text:var(--ink,#253d4b);--wf-muted:var(--muted,#586e7c);--wf-accent:var(--te,#e98300);--wf-success:var(--green,#367956);--wf-warning:var(--amber,#806620);--wf-danger:var(--red,#aa3122);background:var(--wf-bg);color:var(--wf-text);font-family:Arial,Helvetica,"Segoe UI",sans-serif;border:1px solid var(--wf-border);border-radius:10px;overflow:hidden;font-size:13px;text-align:left;accent-color:var(--wf-accent)}
.wf-editor *{box-sizing:border-box}
.wf-editor h2{font-size:22px;letter-spacing:-.5px;margin:7px 0 0}
.wf-editor h3{font-size:14px;margin:0 0 12px}
.wf-editor h4{font-size:12px;color:var(--wf-accent);margin:24px 0 10px}
.wf-editor p,.wf-editor li{color:var(--wf-muted);font-size:12px;line-height:1.55}
.wf-editor button{background:var(--wf-panel);border:1px solid var(--wf-border);border-radius:5px;color:var(--wf-text);font:inherit;font-size:12px;padding:9px 12px;cursor:pointer}
.wf-editor button:hover{background:color-mix(in srgb,var(--wf-accent) 12%,var(--wf-panel));border-color:var(--wf-accent)}
.wf-editor button:disabled{opacity:.45;cursor:not-allowed}
.wf-editor :is(button,input,textarea,select,summary,[tabindex]):focus-visible{outline:2px solid var(--wf-accent);outline-offset:2px}
.wf-editor input,.wf-editor textarea,.wf-editor select{background:var(--wf-bg);border:1px solid var(--wf-border);border-radius:5px;color:var(--wf-text);font:inherit;padding:9px;width:100%;min-width:0}
.wf-editor textarea{font-family:ui-monospace,SFMono-Regular,monospace;font-size:12px;line-height:1.5;resize:vertical;min-height:120px}
.wf-editor label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--wf-muted);margin:12px 0}
.wf-editor code{font-family:ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;color:var(--wf-muted);font-size:11px}
.wf-header{display:flex;gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--wf-border)}
.wf-header>div{flex:1}
.wf-kicker{font-size:10px;font-weight:700;letter-spacing:1.8px;color:var(--wf-accent)}
.wf-draft{font-size:11px;color:var(--wf-warning);background:color-mix(in srgb,var(--wf-warning) 8%,var(--wf-panel));border:1px solid color-mix(in srgb,var(--wf-warning) 35%,var(--wf-border));border-radius:5px;padding:7px 10px}
.wf-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--wf-border)}
.wf-name{flex:1;min-width:120px;max-width:420px;margin:0!important}
.wf-name input{padding:7px}
.wf-body{display:grid;grid-template-columns:220px minmax(340px,1fr) 270px}
.wf-palette,.wf-inspector{padding:18px;background:var(--wf-panel)}
.wf-palette{border-right:1px solid var(--wf-border)}
.wf-inspector{border-left:1px solid var(--wf-border)}
.wf-settings-dialog:not([open]){display:block;position:static;width:auto;max-width:none;max-height:none;margin:0;padding:0;border:0;background:var(--wf-panel);color:var(--wf-text);min-width:0;overflow:auto}
.wf-settings-dialog[open]{position:fixed;inset:0;width:min(680px,calc(100vw - 32px));max-width:680px;max-height:calc(100dvh - 48px);margin:auto;padding:0;border:1px solid var(--wf-border);border-radius:14px;background:var(--wf-panel);color:var(--wf-text);box-shadow:0 24px 80px #0005;overflow:auto}
.wf-settings-dialog::backdrop{background:#101b2b80;backdrop-filter:blur(3px)}
.wf-settings-dialog[open] .wf-inspector{border:0;overflow:visible}
.wf-settings-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid var(--wf-border)}
.wf-settings-header h2{margin:4px 0 0}
@media(max-width:1050px){.wf-settings-dialog:not([open]){grid-column:1/-1}}
.wf-palette>button{width:100%;margin-bottom:8px;text-align:left}
.wf-palette-item{text-align:left;width:100%;margin-bottom:8px;cursor:grab!important;display:flex;flex-direction:column;gap:5px;background:var(--wf-panel)!important;border-color:var(--wf-border)!important;padding:12px!important}
.wf-palette-item:hover{background:var(--wf-surface2)!important}
.wf-palette-item strong{font-size:12px;font-weight:600}
.wf-palette-item small{font-size:10px;line-height:1.5;color:var(--wf-muted)}
.wf-palette-item code{font-size:10px;color:var(--wf-accent)}
.wf-main{min-width:0}
.wf-canvasbar{flex-wrap:wrap;display:flex;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid var(--wf-border)}
.wf-canvasbar strong{flex:1;font-size:12px}
.wf-canvasbar span{font-size:10px;color:var(--wf-muted)}
.wf-canvasbar button{padding:5px 8px}
.wf-scroll{height:var(--workflow-canvas-height,clamp(300px,calc(100dvh - 310px),650px));overflow:auto;background:var(--wf-bg);overscroll-behavior:contain;min-width:0;scroll-padding:12px}
.wf-canvas{position:relative;background-image:radial-gradient(var(--wf-border) 1px,transparent 1px);background-size:20px 20px}
.wf-stage{position:relative;transform-origin:top left}
.wf-edges{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
.wf-edges path{fill:none;stroke:var(--wf-success);stroke-width:2}
.wf-edges text{fill:var(--wf-muted);font-size:11px;font-family:ui-monospace,monospace}
.wf-node{position:absolute;width:220px;background:var(--wf-panel);border:1px solid var(--wf-border);border-radius:8px;box-shadow:0 6px 15px color-mix(in srgb,var(--wf-text) 12%,transparent)}
.wf-node.is-selected{border:2px solid var(--wf-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-accent) 20%,transparent)}
.wf-node.is-source{border-color:var(--wf-warning)}
.wf-node-head{height:82px;overflow:hidden;display:flex;flex-direction:column;gap:10px;width:100%;text-align:left;border:0!important;background:transparent!important;padding:14px!important;cursor:grab!important;touch-action:none}
.wf-node-head:active{cursor:grabbing!important}
.wf-node-head strong{font-size:13px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;width:100%}
.wf-node-head .wf-node-title{display:flex;align-items:center;gap:5px;min-width:0;overflow:visible}
.wf-node-label{display:block;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wf-node-run-status{display:inline-flex;align-items:center;flex:none;white-space:nowrap;font-size:9px;font-weight:600;line-height:1.25;padding:2px 4px;border:1px solid currentColor;border-radius:4px;color:var(--wf-muted);background:color-mix(in srgb,currentColor 7%,var(--wf-panel));pointer-events:none}
.wf-node-run-status[data-local-run-status='completed']{color:var(--wf-success)}
.wf-node-run-status[data-local-run-status='paused']{color:var(--wf-warning)}
.wf-node-run-status[data-local-run-status='blocked']{color:var(--wf-danger)}
.wf-node-meta{font-size:10px;color:var(--wf-muted);padding:0 14px 12px}
.wf-ports{position:absolute;bottom:0;left:0;width:100%;height:38px;display:flex;justify-content:space-between;border-top:1px solid var(--wf-border);padding:5px;gap:3px}
.wf-ports button{font-size:10px;padding:5px 7px;border:0;background:transparent;color:var(--wf-success)}
.wf-node.is-compact .wf-node-head{height:48px;gap:3px;padding:6px 10px!important}
.wf-node.is-compact .wf-node-head strong{font-size:12px}
.wf-node.is-compact .wf-node-meta{display:none}
.wf-node.is-compact .wf-ports button{padding:3px;font-size:9px}
.wf-editor .wf-display{margin:0;flex-direction:row;align-items:center;gap:5px}
.wf-display select{padding:5px;width:auto}
.wf-palette-group{grid-column:1/-1}
.wf-palette-group h4{margin:16px 0 8px}
.wf-empty{padding:100px 50px;max-width:480px}
.wf-empty h3{font-size:20px}
.wf-connect{display:flex;align-items:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--wf-border)}
.wf-connect label{flex:1;margin:0;min-width:0}
.wf-connect label:nth-child(2){max-width:85px}
.wf-validation{border-top:1px solid var(--wf-border);padding:14px 18px;font-size:11px;color:var(--wf-accent)}
.wf-validation ul{padding-left:20px;margin:8px 0}
.wf-validation p{margin:7px 0}
.wf-run{border-top:1px solid var(--wf-border);padding:14px 18px}
.wf-run summary{cursor:pointer;color:var(--wf-accent)}
.wf-run pre{overflow:auto;font-size:11px}
.wf-position{display:flex;gap:10px}
.wf-position label{flex:1;min-width:0}
.wf-inspector>button{margin-top:16px}
.wf-inspector textarea{min-height:200px}
.wf-edge-row{padding:9px 0;border-bottom:1px solid var(--wf-border);display:flex;flex-direction:column;gap:7px}
.wf-edge-row button{align-self:flex-start;font-size:10px;padding:5px 8px}
.wf-danger{color:var(--wf-danger)!important;border-color:var(--wf-danger)!important;background:color-mix(in srgb,var(--wf-danger) 8%,var(--wf-panel))!important}
.wf-error{padding:12px 18px;background:color-mix(in srgb,var(--wf-danger) 8%,var(--wf-panel));border-bottom:1px solid var(--wf-danger);color:var(--wf-danger);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.wf-panel{border-top:1px solid var(--wf-border);padding:22px;background:var(--wf-panel)}
.wf-panel>textarea{min-height:260px}
.wf-panel button{margin:12px 8px 0 0}
.wf-checkbox{flex-direction:row!important;align-items:center}
.wf-checkbox input{width:16px!important;height:16px}
.wf-editor button{min-height:32px}
.wf-tabs{display:flex;gap:4px;border-bottom:1px solid var(--wf-border);margin:14px 0}
.wf-tabs [role="tab"]{flex:1;border:0;border-radius:4px 4px 0 0;border-bottom:3px solid transparent;background:transparent}
.wf-editor.wf-editor .wf-tabs [role="tab"]{white-space:nowrap;padding:6px;font-size:11px}
.wf-tabs [aria-selected="true"]{color:var(--wf-accent);border-bottom-color:var(--wf-accent);background:var(--wf-surface2)}
.wf-inspector [role="tabpanel"][hidden]{display:none}
.wf-mapping-row{min-width:0;border:1px solid var(--wf-border);border-radius:6px;padding:12px;margin:14px 0;background:var(--wf-surface2)}
.wf-mapping-row legend{font-size:11px;color:var(--wf-accent)}
.wf-results pre{max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:var(--wf-surface2);border:1px solid var(--wf-border);border-radius:5px;font-size:11px}
.wf-results dl{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px}
.wf-results dd{margin:0;color:var(--wf-muted)}
.wf-editor.wf-editor button{min-height:32px;padding:6px 10px}
.wf-editor.wf-editor summary{min-height:32px;padding:7px 8px}
.wf-editor.wf-editor .wf-canvasbar button{padding:5px 8px}
.wf-editor.wf-editor .wf-node .wf-ports button{min-height:24px;padding:3px 6px}
.wf-editor.wf-editor .wf-node-head{padding:14px!important}
.wf-editor.wf-editor .wf-node.is-compact .wf-node-head{padding:6px 10px!important}
.wf-editor [hidden]{display:none!important}
.wf-panel-toggles{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 12px;border-bottom:1px solid var(--wf-border)}
.wf-panel-toggles [aria-expanded="true"]{background:var(--wf-surface2);border-color:var(--wf-accent)}
.wf-body{display:grid;grid-template-columns:minmax(0,1fr);align-items:start}
.wf-body.has-palette{grid-template-columns:220px minmax(0,1fr)}
.wf-body.has-inspector{grid-template-columns:minmax(0,1fr) 280px}
.wf-body.has-palette.has-inspector{grid-template-columns:220px minmax(0,1fr) 280px}
.wf-settings-dialog:not([open]){grid-column:auto;max-height:640px}
.wf-palette{max-height:640px;overflow:auto}
.wf-editor{min-width:0;max-width:100%}
.wf-sr-only{position:absolute!important;width:1px!important;height:1px!important;margin:-1px!important;padding:0!important;overflow:hidden!important;clip-path:inset(50%);white-space:nowrap!important;border:0!important}
.wf-run-action{margin-left:auto;background:var(--wf-accent)!important;color:var(--ink,#253d4b)!important;border-color:var(--wf-accent)!important;font-weight:700!important}
.wf-graph-count{flex:1;min-width:170px;font-size:11px!important}
.wf-document-menu{margin-left:auto;position:relative}
.wf-editor summary{cursor:pointer;font-size:12px;min-height:32px;padding:8px;border-radius:4px}
.wf-document-menu>summary{border:1px solid var(--wf-border)}
.wf-document-menu>div{position:absolute;right:0;top:100%;z-index:5;padding:8px;width:170px;display:grid;gap:6px;background:var(--wf-panel);border:1px solid var(--wf-border);border-radius:6px;box-shadow:0 6px 18px #0002}
.wf-connection-tools,.wf-validation,.wf-run{border-top:1px solid var(--wf-border);padding:3px 12px}
.wf-palette,.wf-inspector{padding:14px;min-width:0;overflow-wrap:anywhere}
.wf-palette,.wf-settings-dialog:not([open]){max-height:clamp(400px,calc(100dvh - 200px),740px)}
.wf-editor .wf-node .wf-ports button{min-height:24px}
@media(max-width:760px){.wf-body,.wf-body.has-palette,.wf-body.has-inspector,.wf-body.has-palette.has-inspector{display:flex;flex-direction:column}
.wf-main{width:100%;order:0}.wf-palette{order:1;display:block;max-height:360px;width:100%}.wf-settings-dialog:not([open]){order:2;width:100%;max-height:460px}
.wf-inspector{border-left:0;border-top:1px solid var(--wf-border)}
.wf-connect{flex-wrap:wrap}.wf-connect label{min-width:85px}
.wf-canvasbar{gap:5px}.wf-graph-count{flex-basis:100%}
.wf-header .wf-draft{display:none}
.wf-name{max-width:none}.wf-toolbar{flex-wrap:nowrap}
.wf-panel-toggles{gap:4px}.wf-panel-toggles>button{padding:7px 8px}
.wf-document-menu{margin-left:0}
.wf-settings-header{position:sticky;top:0;background:var(--wf-panel);z-index:2}}
.wf-manifest{position:relative;min-width:0}
.wf-manifest>summary{border:1px solid var(--wf-border)}
.wf-manifest-body{position:absolute;right:0;top:100%;z-index:6;width:min(570px,calc(100vw - 48px));max-height:min(530px,70dvh);overflow:auto;overflow-wrap:anywhere;padding:16px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-panel);box-shadow:0 12px 36px #0002}
.wf-manifest-body ul{padding-left:18px}
.wf-manifest-nodes{list-style:none;padding:0!important;display:grid;gap:8px}
.wf-manifest-nodes li{border:1px solid var(--wf-border);border-radius:6px;padding:8px;display:grid;gap:5px}
.wf-manifest-nodes button{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;text-align:left}
.wf-manifest-warning{color:var(--wf-warning)}
@media(max-width:760px){.wf-manifest{margin-left:0}.wf-canvasbar .wf-graph-count{flex-basis:calc(100% - 82px);min-width:170px}.wf-manifest>summary{font-size:11px!important}}
.wf-node-content{position:relative;height:100%;border-radius:inherit}
.wf-reveal-node{animation:wf-node-reveal 138ms ease-out both}
.wf-reveal-edge{stroke-dasharray:1;animation:wf-edge-reveal 138ms ease-out both}
@keyframes wf-node-reveal{from{opacity:.25;filter:blur(.7px)}to{opacity:1;filter:none}}
@keyframes wf-edge-reveal{from{stroke-dashoffset:1;opacity:.3}to{stroke-dashoffset:0;opacity:1}}
@media(prefers-reduced-motion:reduce){.wf-editor *,.wf-editor *::before,.wf-editor *::after{animation:none!important;transition:none!important}}
.wf-node{border-top:3px solid var(--wf-accent);box-shadow:0 4px 18px color-mix(in srgb,var(--wf-text) 10%,transparent)}
.wf-node[data-family="Data"]{border-top-color:var(--wf-success)}
.wf-node[data-family="Logic / review"]{border-top-color:var(--wf-warning)}
.wf-node[data-family="Output / placeholders"]{border-top-color:var(--wf-muted)}
.wf-node-type{display:flex;align-items:center;gap:6px;min-width:0;width:100%}
.wf-node-type code{flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.wf-node-glyph{display:grid;place-items:center;width:23px;height:23px;flex-shrink:0;background:var(--wf-surface2);border:1px solid var(--wf-border);border-radius:5px;font:700 12px ui-monospace,monospace;color:var(--wf-accent)}
.wf-node-origin{font-size:8px;white-space:nowrap;color:var(--wf-muted)}
.wf-node-meta{padding:0 12px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:17px}
.wf-node-warning{color:var(--wf-warning);font-weight:700}
.wf-node.is-compact .wf-node-glyph,.wf-node.is-compact .wf-node-origin{display:none}
.wf-panel pre{max-width:100%;overflow:auto;font-size:11px}
.wf-editor .wf-toolbar{padding:6px 12px}
.wf-editor .wf-panel-toggles{padding:5px 12px}
.wf-editor .wf-canvasbar{padding:3px 12px;position:relative;overflow:visible}
.wf-manifest{position:static}
.wf-manifest-body{right:12px;width:min(570px,calc(100% - 24px));max-height:var(--workflow-canvas-height,clamp(300px,calc(100dvh - 310px),650px))}
@media(max-width:760px){.wf-manifest-body{position:absolute;right:12px;top:100%}}
/* Presentation is a retained inspector beside the canvas, never execution status. */
.wf-explain-action{white-space:nowrap;margin-left:auto}.wf-header .wf-run-action{margin-left:0;white-space:nowrap}
@media(max-width:360px){.wf-editor .wf-name{min-width:64px}.wf-editor .wf-header{gap:5px;padding-inline:8px}.wf-editor .wf-header button{padding-inline:7px}}
.wf-presentation{display:grid;grid-template-columns:minmax(0,1fr);min-width:0}
.wf-presentation.has-walkthrough{grid-template-columns:minmax(0,1fr) minmax(270px,320px)}
.wf-canvas-region{position:relative;min-width:0}
.wf-walkthrough{min-width:0;max-height:var(--workflow-canvas-height,clamp(300px,calc(100dvh - 310px),650px));height:100%;display:flex;flex-direction:column;border-left:1px solid var(--wf-border);background:var(--wf-panel);overflow:hidden}
.wf-walkthrough>header{padding:12px;display:flex;gap:6px;align-items:start;justify-content:space-between;border-bottom:1px solid var(--wf-border)}
.wf-walkthrough>header p{margin:4px 0 0;font-size:10px;color:var(--wf-accent)}
.wf-walkthrough-scroll{overflow:auto;overscroll-behavior:contain;padding:12px;min-height:0;scrollbar-gutter:stable}
.wf-walkthrough h3{margin:4px 0 8px;font-size:15px;line-height:1.4}
.wf-walkthrough p{margin:8px 0}
.wf-tour-boundary{font-size:10px!important}
.wf-tour-tip{background:var(--wf-surface2);border:1px solid var(--wf-border);border-radius:5px;padding:9px}
.wf-tour-tip strong{color:var(--wf-accent)}
.wf-tour-navigation{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0}
.wf-tour-navigation span{font-variant-numeric:tabular-nums;font-size:11px;color:var(--wf-muted)}
.wf-tour-footer{flex-shrink:0;padding:8px 10px;border-top:1px solid var(--wf-border);background:var(--wf-panel)}
.wf-tour-footer .wf-tour-navigation{margin:0 0 6px}
.wf-editor.wf-editor .wf-tour-footer button{font-size:11px;padding:5px 7px}
.wf-walkthrough>header{flex-shrink:0}
.wf-walkthrough-scroll{flex:1}
.wf-tour-controls{display:flex;flex-wrap:wrap;gap:5px}
.wf-walkthrough .wf-tour-checkbox{margin:12px 0;font-size:11px;flex-direction:row;align-items:center}.wf-tour-checkbox input{width:16px!important;height:16px}
.wf-creation-bar{position:absolute;z-index:3;pointer-events:none;bottom:10px;left:10px;right:10px;display:flex;align-items:center;gap:6px;padding:9px 10px;border:1px solid var(--wf-border);border-radius:7px;background:var(--wf-panel);box-shadow:0 4px 16px #0002}
.wf-creation-bar>div{flex:1;min-width:0;display:grid;gap:4px}
.wf-creation-bar strong{font-size:11px}.wf-creation-bar span{font-size:10px;color:var(--wf-muted)}
.wf-creation-bar button{pointer-events:auto;white-space:nowrap;font-size:11px}
/* Physical assembly moves only the decorative faceplate, never hit geometry. */
.wf-node-assembly{position:relative;isolation:isolate;height:100%;border-radius:inherit;opacity:1;filter:none}
.wf-assembly-plate{position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;background:var(--wf-panel);transform:none}
.wf-assembly-plate[data-assembly-phase="queued"]{opacity:0}
.wf-assembly-plate[data-assembly-phase="arriving"]{animation:wf-module-snap 210ms cubic-bezier(.2,.75,.25,1) both;box-shadow:inset 0 0 0 1px var(--wf-border)}
.wf-assembly-plate[data-assembly-phase="arriving"]::after{content:"";position:absolute;inset:4px;border:1px solid color-mix(in srgb,var(--wf-accent) 35%,transparent);border-radius:4px;pointer-events:none}
@keyframes wf-module-snap{0%{transform:translateY(-18px) scale(.97);opacity:.25}68%{transform:translateY(2px) scale(1);opacity:1}84%{transform:translateY(-1px) scale(1)}100%{transform:none;opacity:1}}
.wf-node[data-visual-assembly="true"]{background:transparent}
.wf-node[data-creation-queued="true"]{border-style:dashed;box-shadow:none}
.wf-node-assembly[data-creation-queued="true"] :is(.wf-node-head,.wf-node-meta){opacity:.38}
.wf-node-assembly[data-creation-current="true"]{outline:1px solid color-mix(in srgb,var(--wf-accent) 55%,transparent);outline-offset:4px}
.wf-ports button{position:relative}
.wf-ports button::after{content:"";position:absolute;top:50%;left:0;width:3px;height:8px;margin-top:-4px;border:1px solid var(--wf-border);border-radius:1px;pointer-events:none}
.wf-ports button:not(:first-child)::after{left:auto;right:0}
.wf-node[data-visual-assembly="true"] .wf-ports button::after{background:var(--wf-accent);border-color:var(--wf-accent)}
.wf-node[data-creation-queued="true"] .wf-ports button::after{background:transparent;border-color:var(--wf-muted);border-style:dashed}
.wf-node[data-creation-current="true"] .wf-ports button::after{animation:wf-port-seat var(--wf-assembly-duration,210ms) ease-out both;animation-play-state:var(--wf-assembly-state,paused)}
@keyframes wf-port-seat{0%,68%{background:transparent;border-color:var(--wf-border);box-shadow:none}84%{background:var(--wf-accent);border-color:var(--wf-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--wf-accent) 18%,transparent)}100%{background:var(--wf-accent);border-color:var(--wf-accent);box-shadow:none}}
.wf-edges g[data-creation-queued="true"]{opacity:.14}
.wf-edges g[data-creation-current="true"] path{stroke-dasharray:1;animation:wf-connection-lock var(--wf-assembly-duration,210ms) ease-out both;animation-play-state:var(--wf-assembly-state,paused)}
@keyframes wf-connection-lock{0%,60%{stroke-dashoffset:1;stroke:var(--wf-accent);opacity:.35}100%{stroke-dashoffset:0;stroke:var(--wf-success);opacity:1}}
.wf-node[data-explanation-current="true"]{outline:3px solid var(--wf-accent);outline-offset:5px}
.wf-edges g[data-explanation-route="true"] path{stroke:var(--wf-accent);stroke-width:3;stroke-dasharray:8 5}
.wf-edges g[data-explanation-route="true"] text{fill:var(--wf-accent);font-weight:700}
.wf-editor[data-presentation-motion="off"] .wf-node-assembly{opacity:1!important;filter:none!important}
.wf-editor[data-presentation-motion="off"] *{animation:none!important;transition:none!important}
.wf-editor[data-presentation-motion="off"] .wf-assembly-plate,[data-motion="off"] .wf-editor .wf-assembly-plate,.wf-editor[data-motion="off"] .wf-assembly-plate{animation:none!important;transform:none!important;opacity:1!important}
[data-motion="off"] .wf-editor *,[data-motion="off"] .wf-editor *::before,[data-motion="off"] .wf-editor *::after,.wf-editor[data-motion="off"] *,.wf-editor[data-motion="off"] *::before,.wf-editor[data-motion="off"] *::after,.wf-editor[data-presentation-motion="off"] *::before,.wf-editor[data-presentation-motion="off"] *::after{animation:none!important;transition:none!important}
@media(max-width:900px){.wf-presentation.has-walkthrough{grid-template-columns:minmax(0,1fr)}.wf-walkthrough{border-left:0;border-top:1px solid var(--wf-border);max-height:360px;height:360px}.wf-walkthrough>header{padding:8px 12px}.wf-creation-bar{flex-wrap:wrap}.wf-creation-bar>div{flex-basis:100%}}
@media(max-width:760px){.wf-editor .wf-walkthrough button{min-height:44px}.wf-editor .wf-walkthrough .wf-tour-checkbox{min-height:44px}.wf-panel-toggles>button[aria-controls$="-panel"]{font-size:11px}.wf-creation-bar span{display:none}}
@media(prefers-reduced-motion:reduce){.wf-node-assembly{opacity:1!important;filter:none!important}.wf-assembly-plate{transform:none!important;opacity:1!important}.wf-edges g[data-creation-queued="true"]{opacity:1}}
/* Command / Inspect: two compact command levels, retained local composer. */
.wf-editor .wf-toolbar{background:var(--wf-panel);padding:7px 12px;gap:12px;flex-wrap:nowrap}
.wf-editor .wf-name{min-width:140px;max-width:none;flex:1;gap:2px}
.wf-workspace-type{font-size:9px;font-weight:700;letter-spacing:1.3px;color:var(--wf-muted)}
.wf-editor .wf-name input{font-weight:700;font-size:14px;letter-spacing:-.2px;background:transparent;border-color:transparent;padding:2px 0}
.wf-editor .wf-name input:hover{border-color:var(--wf-border)}
.wf-editor .wf-draft{background:transparent;border:0;padding:0;white-space:nowrap;color:var(--wf-muted);font-size:10px}
.wf-editor .wf-panel-toggles{display:flex;flex:0 0 auto;border:0;padding:0;flex-wrap:nowrap;gap:4px}
.wf-editor .wf-document-menu{margin-left:4px}
.wf-editor .wf-document-menu>summary{border-color:transparent}
.wf-editor .wf-explain-action{margin-left:0;background:transparent}
.wf-editor .wf-run-action{background:color-mix(in srgb,var(--wf-accent) 12%,var(--wf-panel))!important;color:var(--wf-text)!important;border-color:color-mix(in srgb,var(--wf-accent) 60%,var(--wf-border))!important}
.wf-editor .wf-panel-toggles [aria-controls="workflow-palette"]{border-color:color-mix(in srgb,var(--wf-accent) 60%,var(--wf-border));font-weight:700}
.wf-editor .wf-canvasbar{background:var(--wf-surface2);padding:4px 12px;gap:5px;min-height:40px}
.wf-editor .wf-graph-count{font-variant-numeric:tabular-nums;min-width:140px;font-size:10px!important}
.wf-editor .wf-display select{background:var(--wf-panel);font-size:11px}
.wf-body{position:relative}
.wf-editor .wf-body.has-palette{grid-template-columns:260px minmax(0,1fr)}
.wf-editor .wf-body.has-palette.has-inspector{grid-template-columns:260px minmax(0,1fr) 280px}
.wf-editor .wf-palette{padding:0;max-height:calc(var(--workflow-canvas-height,clamp(300px,calc(100dvh - 310px),650px)) + 148px);scrollbar-gutter:stable}
.wf-composer-head{position:sticky;top:0;z-index:1;padding:12px 14px 7px;background:var(--wf-panel);border-bottom:1px solid var(--wf-border);display:grid;grid-template-columns:minmax(0,1fr) 86px;column-gap:6px}
.wf-composer-head>.wf-kicker,.wf-composer-head>h3,.wf-composer-head>p{grid-column:1/-1}
.wf-editor .wf-composer-head>.wf-composer-close{position:absolute;top:8px;right:10px}
.wf-composer-head h3{font-size:17px;letter-spacing:-.4px;margin:6px 0}
.wf-composer-head p{margin:4px 0 8px;font-size:10px}
.wf-composer-head label{margin:4px 0}
.wf-editor .wf-composer-close{float:right;border-color:transparent;padding:3px 6px;font-size:17px}
.wf-composer-actions{padding:10px 14px;background:var(--wf-surface2);border-bottom:1px solid var(--wf-border)}
.wf-composer-actions>strong{font-size:11px;color:var(--wf-text)}
.wf-composer-actions p{font-size:10px;margin:5px 0 0}
.wf-composer-actions>div{display:flex;gap:5px;margin-top:7px}
.wf-editor .wf-composer-actions button{font-size:10px;padding:5px 7px}
.wf-composer-unavailable{margin-bottom:0!important}
.wf-composer-list{padding:0 14px 12px}
.wf-composer-list h4{color:var(--wf-muted);display:flex;align-items:center;gap:7px;font-size:10px;text-transform:uppercase;letter-spacing:.65px;margin:18px 0 9px}
.wf-composer-list h4 span{font-size:9px;margin-left:auto}
.wf-editor .wf-palette-item{border-radius:6px;gap:4px;padding:8px!important;box-shadow:none}
.wf-palette-item strong{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700}
.wf-palette-item strong span{color:var(--wf-text);font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-palette-item strong code{font-size:9px;max-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0}
.wf-palette-item small{font-size:10px;line-height:1.4}.wf-palette-item small:not(.wf-palette-provenance){overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%;text-align:left}
.wf-editor .wf-palette-provenance{font-size:9px;color:var(--wf-muted);border-top:1px solid var(--wf-border);padding-top:6px;margin-top:3px}
.wf-editor .wf-palette-item[data-block-origin="local-wrapper"]{border-style:dashed}
.wf-editor .wf-palette-item[data-block-origin="placeholder"] .wf-palette-provenance{color:var(--wf-warning)}
.wf-composer-boundary{font-size:10px!important;margin:0 0 9px}
.wf-composer-templates{margin:0 14px 16px;border-top:1px solid var(--wf-border)}
.wf-composer-templates button{width:100%;text-align:left;margin:4px 0;font-size:11px!important}
.wf-manifest-facts{margin:0;display:grid;grid-template-columns:1fr 1fr;gap:0 18px;font-size:11px}
.wf-manifest-facts>div{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--wf-border)}
.wf-manifest-facts dt{color:var(--wf-muted)}
.wf-manifest-facts dd{margin:0;font-weight:700;color:var(--wf-text);font-variant-numeric:tabular-nums}
.wf-assembly-plate::before{content:"";position:absolute;inset:6px 6px auto;height:34px;background:var(--wf-surface2);border-bottom:1px solid var(--wf-border);border-radius:3px;pointer-events:none}
.wf-editor .wf-node{border-radius:6px}
.wf-editor .wf-node-glyph{background:var(--wf-panel);border-radius:3px}
.wf-editor .wf-node.is-compact .wf-assembly-plate::before{height:18px}
/* Native wrapper review: definition, typed inspection, explicit local commit. */
.wf-editor .wf-wrapper-dialog{position:fixed;inset:0;width:min(820px,calc(100vw - 32px));max-width:820px;max-height:calc(100dvh - 32px);padding:0;margin:auto;border:1px solid var(--wf-border);border-radius:10px;overflow:auto;background:var(--wf-panel);color:var(--wf-text);box-shadow:var(--shadow,0 12px 36px #0002)}
.wf-wrapper-dialog::backdrop{background:color-mix(in srgb,var(--wf-bg) 70%,transparent)}
.wf-wrapper-header{display:flex;align-items:start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--wf-border)}
.wf-wrapper-header h2{font-size:20px!important;margin:6px 0!important}
.wf-wrapper-header p{margin:0;font-size:11px}
.wf-editor .wf-wrapper-header button{margin:0;white-space:nowrap}
.wf-wrapper-body{display:grid;grid-template-columns:minmax(0,1fr) 240px;min-width:0}
.wf-wrapper-definition{padding:4px 20px 16px;min-width:0}
.wf-wrapper-definition textarea{min-height:230px;font-size:11px}
.wf-wrapper-definition details{font-size:11px}
.wf-wrapper-definition details p{font-size:11px}
.wf-wrapper-request p{font-size:10px;margin:5px 0 12px}
.wf-wrapper-preview{padding:18px;background:var(--wf-surface2);border-left:1px solid var(--wf-border);overflow-wrap:anywhere;min-width:0}
.wf-wrapper-preview h3{margin:10px 0 14px;font-size:14px}
.wf-wrapper-preview dl{font-size:11px;margin:0}
.wf-wrapper-preview dt{color:var(--wf-muted);font-size:10px;margin:12px 0 4px}
.wf-wrapper-preview dd{margin:0;line-height:1.5}
.wf-wrapper-preview h4{font-size:11px;color:var(--wf-text);margin:22px 0 6px}
.wf-wrapper-preview p{font-size:10px}
.wf-wrapper-footer{position:sticky;bottom:0;background:var(--wf-panel);padding:8px 20px 16px;border-top:1px solid var(--wf-border)}
.wf-wrapper-footer label{line-height:1.5;margin:8px 0;font-size:11px}
.wf-wrapper-footer>div{display:flex;gap:8px}
.wf-editor .wf-wrapper-footer button{margin:0;font-size:11px}
.wf-wrapper-footer button:first-child{border-color:var(--wf-accent);font-weight:700;background:color-mix(in srgb,var(--wf-accent) 10%,var(--wf-panel))}
@media(max-width:1050px) and (min-width:761px){.wf-editor .wf-draft{display:none}.wf-editor .wf-toolbar{gap:6px}.wf-editor .wf-body.has-palette.has-inspector{grid-template-columns:240px minmax(0,1fr) 260px}.wf-editor .wf-body.has-palette{grid-template-columns:240px minmax(0,1fr)}}
@media(max-width:760px){
 .wf-editor .wf-toolbar{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;padding:8px}
 .wf-editor .wf-workspace-type{font-size:8px;letter-spacing:1px}
 .wf-editor .wf-name{min-width:0}.wf-editor .wf-name input{font-size:12px}
 .wf-editor .wf-panel-toggles{grid-column:1/-1;grid-row:2;justify-content:space-between;gap:4px;width:100%}
 .wf-editor .wf-panel-toggles button,.wf-editor .wf-panel-toggles summary{min-height:44px}
 .wf-editor .wf-header>button{font-size:10px;padding:6px 8px;min-height:44px}
 .wf-editor .wf-canvasbar{padding:4px 8px;flex-wrap:nowrap}.wf-editor .wf-canvasbar .wf-graph-count{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;flex:0 0 1px;min-width:0}
 .wf-editor .wf-canvasbar button,.wf-editor .wf-canvasbar select,.wf-editor .wf-canvasbar summary{min-height:44px}
 .wf-editor .wf-body.has-palette,.wf-editor .wf-body.has-palette.has-inspector{display:flex;grid-template-columns:none}
 .wf-editor .wf-palette{position:absolute;z-index:7;top:0;left:0;width:min(340px,100%);max-height:min(540px,calc(100dvh - 170px));border-right:1px solid var(--wf-border);border-bottom:1px solid var(--wf-border);box-shadow:var(--shadow,0 6px 18px #0002)}
 .wf-editor .wf-composer-close{min-width:40px;min-height:40px}
 .wf-editor .wf-composer-actions button,.wf-editor .wf-composer-templates button{min-height:44px}
 .wf-editor .wf-wrapper-dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px);border-radius:8px}
 .wf-wrapper-header{padding:14px 12px}.wf-wrapper-header h2{font-size:17px!important}
 .wf-wrapper-body{grid-template-columns:minmax(0,1fr)}
 .wf-wrapper-definition{padding:0 12px 12px}.wf-wrapper-preview{border-left:0;border-top:1px solid var(--wf-border);padding:12px}
 .wf-wrapper-preview dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}.wf-wrapper-preview dt{margin:0}.wf-wrapper-preview h4{margin-top:14px}
 .wf-wrapper-footer{padding:8px 12px 12px}.wf-editor .wf-wrapper-footer button{min-height:44px}.wf-wrapper-footer label{min-height:44px}
}
/* Fragment review uses host tokens, native top layer and its own checkbox. */
.wf-editor .wf-fragment-dialog{position:fixed;inset:0;width:min(960px,calc(100vw - 24px));max-width:960px;max-height:calc(100dvh - 24px);padding:0;margin:auto;border:1px solid var(--wf-border);border-radius:10px;background:var(--wf-panel);color:var(--wf-text);box-shadow:var(--shadow,0 12px 36px #0002);overflow:auto}
.wf-fragment-dialog::backdrop{background:color-mix(in srgb,var(--wf-bg) 70%,transparent)}
.wf-fragment-header{display:flex;align-items:start;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid var(--wf-border)}
.wf-fragment-header p{margin-bottom:0}.wf-fragment-header button{white-space:nowrap}
.wf-fragment-body{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,340px);min-width:0}
.wf-fragment-body>section,.wf-fragment-body>aside{min-width:0;padding:12px 18px;overflow-wrap:anywhere}
.wf-fragment-body>aside{border-left:1px solid var(--wf-border);background:var(--wf-surface2)}
.wf-fragment-body textarea{height:250px;min-height:160px}.wf-fragment-body pre{font-size:10px;max-height:260px;overflow:auto}
.wf-fragment-identifiers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.wf-fragment-footer{position:sticky;bottom:0;padding:8px 18px 12px;background:var(--wf-panel);border-top:1px solid var(--wf-border)}
.wf-editor .wf-fragment-checkbox{display:flex;flex-direction:row;align-items:center;line-height:1.5;margin:4px 0 8px}.wf-fragment-checkbox input{width:18px!important;height:18px;flex-shrink:0}
.wf-fragment-footer>div{display:flex;gap:8px}
@media(max-width:760px){.wf-editor .wf-fragment-dialog{width:calc(100vw - 16px);max-height:calc(100dvh - 16px)}.wf-fragment-header{padding:10px 12px}.wf-fragment-header h2{font-size:18px}.wf-fragment-body{grid-template-columns:minmax(0,1fr)}.wf-fragment-body>section,.wf-fragment-body>aside{padding:8px 12px}.wf-fragment-body>aside{border-left:0;border-top:1px solid var(--wf-border)}.wf-fragment-footer{padding:8px 12px}.wf-fragment-dialog button,.wf-fragment-dialog input{min-height:44px}.wf-fragment-checkbox input{min-height:18px}}
/* Alternate topology projection; graph positions and shared settings stay intact. */
.wf-view-controls{display:flex;align-items:center;gap:5px;min-width:0;flex-wrap:wrap}
.wf-view-switch{display:flex;align-items:center;gap:2px;padding:2px;background:var(--wf-surface2);border:1px solid var(--wf-border);border-radius:6px;flex-shrink:0}
.wf-editor .wf-view-switch button{border:0;background:transparent;white-space:nowrap;font-size:11px;padding:5px 9px}
.wf-editor .wf-view-switch button[aria-pressed="true"]{background:var(--wf-panel);color:var(--wf-accent);box-shadow:0 1px 4px color-mix(in srgb,var(--wf-text) 12%,transparent);font-weight:700}
.wf-node.is-stacked{border-top:1px solid var(--wf-border);border-left:4px solid var(--wf-accent);border-radius:9px;box-shadow:0 3px 12px color-mix(in srgb,var(--wf-text) 9%,transparent)}
.wf-node.is-stacked[data-family="Data"]{border-left-color:var(--wf-success)}
.wf-node.is-stacked[data-family="Logic / review"]{border-left-color:var(--wf-warning)}
.wf-node.is-stacked[data-family="Output / placeholders"]{border-left-color:var(--wf-muted)}
.wf-node.is-stacked.is-selected{border-color:var(--wf-accent)}
.wf-node.is-stacked .wf-node-head,.wf-node.is-stacked .wf-node-head:active{cursor:pointer!important;touch-action:auto}
.wf-node.is-stacked .wf-node-head{height:90px}
.wf-node.is-stacked.is-compact .wf-node-head{height:62px}
.wf-editor[data-workflow-view="stacked"] .wf-edges>g>path{stroke:var(--wf-muted);stroke-width:1.6}
.wf-editor[data-workflow-view="stacked"] .wf-edges text{font:600 11px Arial,sans-serif;fill:var(--wf-text);paint-order:stroke;stroke:var(--wf-bg);stroke-width:6px;stroke-linejoin:round}
.wf-editor .wf-edges .wf-stack-arrow{fill:var(--wf-muted);stroke:none}
.wf-stack-note{position:absolute;left:12px;bottom:10px;z-index:2;padding:5px 8px;max-width:calc(100% - 24px);border:1px solid var(--wf-border);border-radius:5px;background:var(--wf-panel);color:var(--wf-muted);font-size:10px;pointer-events:none}
.wf-editor[data-workflow-view="stacked"] .wf-empty{padding:70px 24px;width:348px}
@media(max-width:760px){
 .wf-editor .wf-view-controls{overflow-x:auto;overflow-y:hidden;flex-wrap:nowrap;flex:1;scroll-padding:8px;scrollbar-width:thin}
 .wf-editor .wf-view-controls>*{flex-shrink:0}
 .wf-editor .wf-canvasbar>.wf-manifest{flex-shrink:0}
 .wf-editor .wf-view-switch button{min-height:40px}
 .wf-stack-note{font-size:9px;padding:4px 6px}
}
`;
