export interface ChartLabel {
  readonly symbol: string;
  readonly interval: string;
}

const CHART_LABEL = /^Chart for (.+), ([^,]+)$/;

export function parseChartLabel(label: string): ChartLabel | null {
  const match = CHART_LABEL.exec(label.trim());
  return match ? { symbol: match[1]!, interval: match[2]!.trim() } : null;
}
