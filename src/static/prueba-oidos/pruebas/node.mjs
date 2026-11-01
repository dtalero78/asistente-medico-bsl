// Corre pruebas/casos.js en la terminal: node src/static/prueba-oidos/pruebas/node.mjs
import { correr } from './casos.js';

let pasadas = 0;
const fallos = [];
correr({
    grupo: (nombre) => console.log(`\n${nombre}`),
    comprobar: (nombre, ok, detalle) => {
        console.log(`${ok ? '  ✓' : '  ✗'} ${nombre}${ok || detalle === undefined ? '' : `  → ${detalle}`}`);
        if (ok) pasadas++; else fallos.push(nombre);
    },
});
console.log(`\n${pasadas} pasadas, ${fallos.length} fallidas`);
process.exit(fallos.length ? 1 : 0);
