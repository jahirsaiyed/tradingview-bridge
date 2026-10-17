export const SOURCES = {
  valid: `//@version=6
indicator("TV Bridge Smoke", overlay=true)
plot(close)
`,
  broken: `//@version=6
indicator("TV Bridge Smoke", overlay=true)
f(x) =>
    y = math.max(x, open) * 2
    z = (y > 0) ? y : -y
    z
plot(f(close) +)
`,
  runtimeError: `//@version=6
indicator("TV Bridge Smoke")
a = array.new_float(1, 1.0)
if barstate.islast
    log.info("x={0}", array.get(a, 5))
plot(close)
`,
  strategy: `//@version=6
strategy("TV Bridge Smoke", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=100)
fast = ta.sma(close, 10)
slow = ta.sma(close, 30)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.close("L")
if barstate.islast
    log.info("last bar close={0} fast={1}", close, fast)
plot(fast)
plot(slow)
`,
} as const;
