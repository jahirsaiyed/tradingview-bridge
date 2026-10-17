export const SEL = {
  overlayRoot: '[data-name="pine-dialog"]',
  splitRoot: '#pine-editor-dialog',
  openEditorButton: '[data-name="pine-dialog-button"]',
  editorSurface: '.monaco-editor .view-lines',
  overlayMoreButton: '[data-name="pine-dialog"] [data-qa-id="script-more-options"]',
  menu: '[role="menu"]',
  toOverlayButton: 'button[title="Move split-view to overlay"]',
  chartCanvas: 'canvas[data-qa-id="pane-top-canvas"]',
  signInButton: '[data-name="header-user-menu-sign-in"]',
  legendRoot: '[data-qa-id="legend"]',
  legendItem: '[data-qa-id="legend-source-item"]',
  legendTitle: '[data-qa-id~="legend-source-title"]',
  legendStatus: '[data-qa-id="legend-source-item-status"]',
  legendDelete: '[data-qa-id="legend-delete-action"]',
  legendToggler: '[data-qa-id="legend-toggler"]',
  legendSources: '[data-qa-id="legend-sources-wrapper"]',
  reportTab: '[id="Strategy report"]',
  tradesTab: '[id="List of Trades"]',
} as const;

export const TEXT = {
  reportLabels: ['Total PnL', 'Profit factor'],
  splitDialogTitle: 'Split the view?',
  splitConfirm: 'Move editor to split-view',
  pineLogsMenu: 'Pine logs',
  helpCenter: 'Help Center',
} as const;
