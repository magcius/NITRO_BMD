
// Build our WAT WebAssembly modules.

const wabt = require('wabt');
const fs = require('fs');

function buildModuleArray(filename) {
    const wat = fs.readFileSync(filename);
    const wasmModule = wabt.parseWat(filename, wat);
    wasmModule.resolveNames();
    wasmModule.validate();
    const binary = wasmModule.toBinary({});
    const binData = new Uint8Array(binary.buffer);
    const binStr = binData.join(',');
    const src = `new Uint8Array([${binStr}]);`;
    return src;
}

function buildModuleCode(module) {
    const exportName = module.exportName;
    const filename = module.filename;
    const binArrayStr = buildModuleArray(filename);

    return `
// ${filename}
const ${exportName}Code = ${binArrayStr};
export const ${exportName} = new WebAssembly.Module(${exportName}Code);
`;
}

function buildModulesFile(modules) {
    let s = `// Generated by build_wat.js\n`;
    for (const module of modules) {
        s += buildModuleCode(module);
    }
    return s;
}

function main() {
    const out = buildModulesFile([
        { exportName: 'yaz0Module', filename: 'yaz0.wat' },
    ]);
    fs.writeFileSync('wat_modules.ts', out);
}

main();
