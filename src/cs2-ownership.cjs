const manifest = require('./cs2-payload-manifest.json');
const knownFiles = [...manifest.files, ...require('./cs2-legacy-payload-manifest.json').files];
const botPlugins = new Set(['BotAI', 'BotAimImprover', 'BotBuy', 'BotControllerImpl', 'BotHiderImpl', 'BotRandomizer', 'BotState', 'NadeSystem', 'RoundDamageRecap'].map(x => x.toLowerCase()));
const botAddons = new Set(['BotController', 'BotHider', 'BotVision', 'RayTrace'].map(x => x.toLowerCase()));
function shared(relative) {
  const p = relative.replaceAll('\\', '/').toLowerCase();
  if (p.startsWith('addons/counterstrikesharp/plugins/')) return p.split('/').length === 4 && p.endsWith('/readme.txt');
  if (/^addons\/metamod\/(botcontroller|bothider|botvision|raytrace)\.vdf$/.test(p)) return false;
  return p.startsWith('addons/counterstrikesharp/') || p.startsWith('addons/metamod/') || /^addons\/metamod(?:_x64)?\.vdf$/.test(p);
}
const botFiles = new Set(knownFiles.filter(x => !shared(x.path)).map(x => x.path.toLowerCase()));
const inventoryFiles = new Set([...require('./inventory-payload-manifest.json').files,...require('./inventory-legacy-payload-manifest.json').files].map(x => x.path.toLowerCase()));
const runtimeFiles = new Set(knownFiles.filter(x => shared(x.path)).map(x => x.path.toLowerCase()));
// Compare file ownership on Windows without relying on saved UI installation flags.
function owned(relative) { const p = relative.replaceAll('\\', '/').toLowerCase(); return botFiles.has(p) || inventoryFiles.has(p) || p.startsWith('addons/counterstrikesharp/plugins/inventorysimulator/') || botAddons.has(p.split('/')[1]) || (p.startsWith('addons/counterstrikesharp/plugins/') && botPlugins.has(p.split('/')[3])) || p.startsWith('addons/counterstrikesharp/configs/plugins/inventorysimulator/'); }
function retainedRuntime(relative) {
  const p = relative.replaceAll('\\', '/').toLowerCase();
  return runtimeFiles.has(p) || p.startsWith('addons/counterstrikesharp/configs/') || p.startsWith('addons/counterstrikesharp/logs/') || p.startsWith('addons/counterstrikesharp/dotnet/');
}
const demoFiles = new Set(require('./demo-payload-manifest.json').files.map(x => x.path.toLowerCase()));
function demoOwned(relative) { const p = relative.replaceAll('\\', '/').toLowerCase(); return demoFiles.has(p) || /^addons\/(?:dtr-controller|dtr-hider)\//.test(p) || /^addons\/counterstrikesharp\/(?:plugins|configs\/plugins)\/(?:demotracer|dtrhider)\//.test(p); }
function demoOverlap(relative) { const p = relative.replaceAll('\\', '/').toLowerCase(); return p.startsWith('addons/counterstrikesharp/plugins/botrandomizer/') || p.startsWith('addons/counterstrikesharp/shared/botrandomizerapi/') || p.startsWith('addons/counterstrikesharp/shared/0harmony/'); }
module.exports = { shared, owned: relative => owned(relative) || demoOwned(relative), retainedRuntime, botPlugins, botAddons, demoOverlap };
