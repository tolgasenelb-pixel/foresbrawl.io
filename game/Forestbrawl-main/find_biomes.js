const fs = require('fs');

const code = fs.readFileSync('./Forestbrawl-main/game/play.html', 'utf8');
const lines = code.split('\n');

console.log('Searching for getBiome, resource generation, and resource rendering:');
lines.forEach((line, idx) => {
  if (line.includes('function getBiome') || line.includes('_rebuildResourcesFromSeed') || line.includes('function drawResource') || line.includes('function _loadAssetImages') || line.includes('RESOURCE_TYPES') || line.includes('_RES_COL_FRAC')) {
    console.log(`L${idx+1}: ${line.trim()}`);
  }
});
