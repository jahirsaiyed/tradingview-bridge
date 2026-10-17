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
  bottomPanelToggle: '.layout__area--bottom [data-name="toggle-visibility-button"]',
  applyToChartButton: '[data-name="pine-dialog"] [data-qa-id="add-script-to-chart"]',
  reportTab: '[id="Strategy report"]',
  tradesTab: '[id="List of Trades"]',
  pineLogsWidget: '.widgetbar-widget-pine_logs',
} as const;

export const TEXT = {
  reportLabels: ['Total PnL', 'Profit factor'],
  splitDialogTitle: 'Split the view?',
  splitConfirm: 'Move editor to split-view',
  pineLogsMenu: 'Pine logs',
  // Rendered "no lines" states of the logs widget: runtime error / logging script without output yet /
  // no logging script on the chart (the last two live-verified 2026-10-17).
  pineLogsEmptyStates: ['No data', 'Waiting on logs', 'How to work with logs'],
  helpCenter: 'Help Center',
} as const;
