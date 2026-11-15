const { createManager } = require('./bilidesk-manager.cjs');
exports.createManager = options => createManager({ ...options, client: 'XCMusic', profileEnv: 'RAIN_ALLEY_XCMUSIC_PROFILE' });
