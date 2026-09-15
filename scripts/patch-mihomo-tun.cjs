// Узкая воспроизводимая адаптация vendored runtime. При дрейфе апстрима — отказ.
const fs = require('node:fs');

function patchRuntime(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  let text = source.replace(/\r\n/g, '\n');
  function once(before, after) {
    if (text.split(before).length !== 2) throw new Error('Mihomo TUN patch: upstream changed; review required');
    text = text.replace(before, after);
  }
  once('    const tunOpt = opts.tun;', '    const tunOpt = opts.tun;\n    const tunStack = tunOpt?.stack === "mips" ? "mips" : "gvisor";');
  once('            device: `mitun${idx}`,\n            stack: "gvisor",', '            device: `mitun${idx}`,\n            stack: tunStack,');
  once('        const tun = {\n          enable: true,\n          stack: "gvisor",', '        const tun = {\n          enable: true,\n          stack: tunStack,');
  once('    const mihomoTunOpts = addTun ? { mode: options.mihomoPerProxyTun ? "listeners" : "tun" } : null;', '    const mihomoTunOpts = addTun ? { mode: options.mihomoPerProxyTun ? "listeners" : "tun", stack: options.mihomoTunStack === "mips" ? "mips" : "gvisor" } : null;');
  return text.replace(/\n/g, newline);
}

module.exports = { patchRuntime };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/patch-mihomo-tun.cjs <unpatched-runtime>');
  fs.writeFileSync(file, patchRuntime(fs.readFileSync(file, 'utf8')));
}
