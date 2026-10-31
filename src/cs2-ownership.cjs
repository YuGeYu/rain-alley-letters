const manifest = require('./cs2-payload-manifest.json');
const botPlugins = new Set(['BotAI', 'BotAimImprover', 'BotBuy', 'BotControllerImpl', 'BotHiderImpl', 'BotRandomizer', 'BotState', 'NadeSystem', 'RoundDamageRecap'].map(x => x.toLowerCase()));
const botAddons = new Set(['BotController', 'BotHider', 'BotVision', 'RayTrace'].map(x => x.toLowerCase()));
function shared(relative) {
  const p = relative.replaceAll('\\', '/').toLowerCase();
  if (p.startsWith('addons/counterstrikesharp/plugins/')) return p.split('/').length === 4 && p.endsWith('/readme.txt');
  if (/^addons\/metamod\/(botcontroller|bothider|botvision|raytrace)\.vdf$/.test(p)) return false;
  return p.startsWith('addons/counterstrikesharp/') || p.startsWith('addons/metamod/') || /^addons\/metamod(?:_x64)?\.vdf$/.test(p);
}
const botFiles = new Set(manifest.files.filter(x => !shared(x.path)).map(x => x.path.toLowerCase()));
const inventoryFiles = new Set(require('./inventory-payload-manifest.json').files.map(x => x.path.toLowerCase()));
const runtimeFiles = new Set(manifest.files.filter(x => shared(x.path)).map(x => x.path.toLowerCase()));
// Compare file ownership on Windows without relying on saved UI installation flags.
function owned(relative) { const p = relative.replaceAll('\\', '/').toLowerCase(); return botFiles.has(p) || inventoryFiles.has(p) || botAddons.has(p.split('/')[1]) || (p.startsWith('addons/counterstrikesharp/plugins/') && botPlugins.has(p.split('/')[3])) || p.startsWith('addons/counterstrikesharp/configs/plugins/inventorysimulator/'); }
function retainedRuntime(relative) {
  const p = relative.replaceAll('\\', '/').toLowerCase();
  return runtimeFiles.has(p) || p.startsWith('addons/counterstrikesharp/configs/') || p.startsWith('addons/counterstrikesharp/logs/') || p.startsWith('addons/counterstrikesharp/dotnet/');
}
module.exports = { shared, owned, retainedRuntime, botPlugins, botAddons };
